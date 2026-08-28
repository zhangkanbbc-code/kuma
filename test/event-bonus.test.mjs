import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

import {
  KNOWN_SOURCE_CONFLICTS,
  buildEventBonusPack,
  UNMODELED_BONUSES,
  extractBonusTable,
  parseRate,
  parseWikiTable,
  splitEventSections,
  stripWiki,
  tablesIn,
} from '../scripts/lib/event-bonus.mjs'

// ---- 合成夹具：结构照着真实倍卡表捏的，内容是虚构的 ----
// 上游原文按矿脉纪律不随仓库分发，所以核心判据必须能脱离真实数据被测。
// 这里刻意把三个踩过的坑都摆进来：
//   ① 中段的小节标题（"个别舰倍卡"）与真正的列头形状完全一样；
//   ② rowspan 从上面几行盖下来，且本行自己还有行标题；
//   ③ 数值有确定值、区间、问号、"-" 四种写法。
const SYNTHETIC = `==倍卡表==
===E9倍卡表===
{| class="wikitable"
! colspan="6" |E9 倍卡表（2099.01.01）
|-
! rowspan="2" |
! colspan="2" | 舰种
! colspan="3" | 国籍
|-
! 驱逐<br/>DD
! 重巡<br/>CA
! 甲国
! 乙国
! 丙国
|-
| '''全图<sup>[1]</sup>'''
| 1.10
| -
| 1.20
| 1.30?
| -
|-
| rowspan="2" | '''P1 Boss（A点）'''
| 1.11
| 1.22
| -
| -
| -
|-
| 1.12
| 1.23
| -
| -
| -
|-
! colspan="6" |个别舰倍卡
|-
|'''全图'''
| colspan="5" style="text-align:left;" |[[某舰|Alpha]]: 1.4321<br/>Beta: 1.5000~1.5001<br/>Gamma: 1.66?
|-
! colspan="6" |削甲
|-
!A点
| colspan="5" style="text-align:left;" |[[某敌舰]]：装甲值 '''-40'''
|}
`

const synthetic = extractBonusTable(tablesIn(splitEventSections(SYNTHETIC).E9)[0])
const sfind = (scope, by, key) =>
  synthetic.entries.find(
    (x) => (scope ? String(x.scope).includes(scope) : true) && x.by === by && x.key === key,
  )

test('列头要取第一个——中段小节标题的形状与真列头一模一样', () => {
  // 取最后一个会让列头变成「个别舰倍卡」，整张表一条也提不出来（实测踩过）
  assert.match(synthetic.title, /E9 倍卡表（2099\.01\.01）/)
  assert.ok(synthetic.entries.length >= 8, `只提取到 ${synthetic.entries.length} 条`)
})

test('rowspan 占位要按列号填，不能整批插到行首', () => {
  // 行首整批插入会把本行自己的行标题挤到后面，整行错位（实测踩过）
  const rows = parseWikiTable(tablesIn(splitEventSections(SYNTHETIC).E9)[0])
  // rowspan 覆盖到的行，第 0 列应当重复出现行标题，本行自己的数据紧随其后。
  // 旧写法在行首整批插占位，会把数据挤到后面去（真实表里表现为
  // "P3 Boss（S点）" 跑到第 4 列）。
  const second = rows.find((r) => r[1]?.text === '1.12')
  assert.ok(second, '找不到 rowspan 覆盖的第二行')
  assert.equal(stripWiki(second[0].text), 'P1 Boss（A点）')
  assert.equal(second[2].text, '1.23')
  assert.equal(second.length, 6, `列数错位：${second.map((c) => c.text).join('|')}`)
  // 分类行按 colspan 展开
  const category = rows.find((r) => r.some((c) => c.text === '舰种'))
  assert.equal(category.filter((c) => c.text === '舰种').length, 2)
  assert.equal(category.filter((c) => c.text === '国籍').length, 3)
})

test('舰种与国籍分列，各自归到正确的判据类别', () => {
  assert.equal(sfind('全图', 'stype', '驱逐').value, 1.1)
  assert.equal(sfind('全图', 'nation', '甲国').value, 1.2)
  assert.equal(sfind('A点', 'stype', '重巡').value, 1.22)
  // 该范围下写 "-" 的不许冒出来
  assert.equal(sfind('全图', 'stype', '重巡'), undefined)
  assert.equal(sfind('全图', 'nation', '丙国'), undefined)
})

test('区间与推定值不许当成确定值', () => {
  assert.equal(sfind('全图', 'ship', 'Alpha').certain, true)
  const beta = sfind('全图', 'ship', 'Beta')
  assert.equal(beta.value, 1.5)
  assert.equal(beta.max, 1.5001)
  assert.equal(beta.certain, false)
  assert.equal(sfind('全图', 'ship', 'Gamma').certain, false)

  assert.deepEqual(parseRate('1.06'), { value: 1.06, max: 1.06, certain: true, note: null })
  assert.equal(parseRate('1.77?').certain, false)
  assert.equal(parseRate('1.7063~1.7064').max, 1.7064)
  // "-" 是「本项不适用」，绝不能变成 0——0 会被当作「打不出伤害」
  assert.equal(parseRate('-'), null)
  assert.equal(parseRate(''), null)
  assert.equal(parseRate('未知'), null)
})

test('wiki 标记不能混进名字与数值', () => {
  assert.equal(stripWiki("'''全图<sup>[1]</sup>'''"), '全图')
  assert.equal(stripWiki('[[贝阿恩|Béarn]]'), 'Béarn')
  assert.equal(stripWiki('[[足柄]]'), '足柄')
  assert.equal(stripWiki('[[维斯比|{{Red|维斯比}}]]'), '维斯比')
  assert.equal(sfind('全图', 'ship', 'Alpha').value, 1.4321) // [[某舰|Alpha]] 取显示名
})

// ---- 真实格式验证：夹具在本机才跑 ----
// 生成方式（开发期一次性）：
//   node -e "fetch('https://zh.kcwiki.cn/api.php?action=parse&page='+encodeURIComponent('2026年夏季活动')+'&prop=wikitext&format=json&formatversion=2').then(r=>r.json()).then(j=>require('fs').writeFileSync('assets/review/event-bonus.wikitext.txt', j.parse.wikitext))"
const REAL = new URL('../assets/review/event-bonus.wikitext.txt', import.meta.url)
const hasReal = existsSync(REAL)

test('真实倍卡表：E4 各项如实提取', { skip: hasReal ? false : '缺 assets/review/event-bonus.wikitext.txt' }, () => {
  const wikitext = readFileSync(REAL, 'utf8')
  const secs = splitEventSections(wikitext)
  assert.deepEqual(Object.keys(secs), ['E1', 'E2', 'E3', 'E4', 'E5'])
  const tables = tablesIn(secs.E4)
  const e4 = extractBonusTable(tables[0])
  const find = (scope, by, key) =>
    e4.entries.find((x) => String(x.scope).includes(scope) && x.by === by && x.key === key)

  assert.equal(find('全图', 'stype', '驱逐').value, 1.04)
  assert.equal(find('全图', 'nation', '英').value, 1.15)
  // X 点 = 本次排查那一场的 Boss 点
  assert.equal(find('X点', 'stype', '重巡').value, 1.13)
  assert.equal(find('X点', 'stype', '驱逐').value, 1.06)
  assert.equal(find('X点', 'stype', '海防'), undefined)

  // 特效装备表：X 点的组倍率与组成员
  const equip = extractBonusTable(tables[1])
  const groupAt = (scope, key) =>
    equip.entries.find((x) => String(x.scope).includes(scope) && x.by === 'equipGroup' && x.key === key)
  assert.equal(groupAt('X点', 'A组').value, 1.12)
  assert.equal(groupAt('X点', 'B组').value, 1.08)
  assert.equal(groupAt('X点', 'C组').value, 1.04)
  const members = (key) =>
    equip.entries.find((x) => x.by === 'equipGroupMembers' && x.key === key)?.raw ?? ''
  assert.match(members('B组'), /九七式中戦車\(チハ\)/)
  assert.match(members('C组'), /特四式内火艇/)
})

test('kcwiki 与 wikiwiki 的 Mogador 冲突要保留，解析层不许擅自抹平', {
  skip: hasReal ? false : '缺 assets/review/event-bonus.wikitext.txt',
}, () => {
  const e4 = extractBonusTable(tablesIn(splitEventSections(readFileSync(REAL, 'utf8')).E4)[0])
  const find = (key) => e4.entries.find((x) => x.by === 'ship' && x.key === key)
  // kcwiki 写 1.659，wikiwiki 写 1.6959。已核对上游搬运贴，原文就是 1.659——
  // **kcwiki 没有抄错**，分歧在更上游。第三方 zekamashi 给 1.66?，只能由 1.659
  // 舍入而来（1.6959 会舍成 1.70），所以采信 1.659，详见 KNOWN_SOURCE_CONFLICTS。
  // 这里只钉住「解析层如实读出 kcwiki 的原值」：取舍是合并层的事，
  // 免得有人在解析阶段偷偷改数、把两源冲突抹平。
  assert.equal(find('Mogador').value, 1.659)
  for (const name of ['Vautour', 'Algérie', 'Gloire', 'Commandant Teste', 'Richelieu', 'Jean Bart', 'Béarn']) {
    const digits = String(find(name).value).split('.')[1]?.length ?? 0
    assert.equal(digits, 4, `${name} 的位数变了，Mogador 的离群判据要重新看`)
  }
})

test('倍卡这一项上 wikiwiki 不是权威——三源核对钉死这个例外', () => {
  // README 的通用事实层优先级是「wikiwiki 日文一手 > kcwiki 搬运」，
  // 但倍卡这一项上它是反的：2026-08-07 三源逐行核对，wikiwiki 那张 E4 表
  // 有三处独立错误，zekamashi 每一处都站 kcwiki 那边。
  // 台账留在源码里，是为了挡住「照通则把 wikiwiki 判赢」这种回退。
  assert.equal(KNOWN_SOURCE_CONFLICTS.length, 3)
  for (const c of KNOWN_SOURCE_CONFLICTS) {
    assert.equal(c.prefer, 'kcwiki', `${c.key} 的采信方向变了`)
    assert.notEqual(c.wikiwiki, c.kcwiki, `${c.key} 已经不冲突了，台账该清理`)
    // 第三方独立源必须与采信方一致，否则这条裁决就没有依据
    assert.ok(
      Math.abs(c.zekamashi - c.kcwiki) < 0.01,
      `${c.key}: zekamashi ${c.zekamashi} 与采信值 ${c.kcwiki} 不符`,
    )
    // 且必须**不**支持被否定的那个值
    assert.ok(
      Math.abs(c.zekamashi - c.wikiwiki) >= 0.01,
      `${c.key}: zekamashi ${c.zekamashi} 同样支持 wikiwiki，裁决依据不成立`,
    )
  }
})

test('上游收敛之后条目不删，只多一个日期——痕迹与采信方向都要留着', () => {
  // 2026-08-24 复核：三条分歧在上游全部消失了，wikiwiki 已改成与 kcwiki 同值。
  // 但**不删条目**（口径与 map-drops / map-enemy-comps 两处台账一致）：
  // 删掉只会让下一轮把同一件事当成新的待裁项重新冒出来，而「当初为什么定
  // kcwiki 优先」的痕迹没了——那正是这张台账存在的全部理由。
  for (const c of KNOWN_SOURCE_CONFLICTS) {
    assert.match(
      c.resolvedUpstreamAt ?? '',
      /^\d{4}-\d{2}-\d{2}$/,
      `${c.key} 缺复核日期：台账里的每条分歧都要能说清「最后一次去看是什么时候」`,
    )
    // 收敛了也不改采信方向：倍卡域 kcwiki 优先是已裁定的例外，与当下两家是否
    // 一致无关。改方向要重新走一次三源核对，不是看一眼「现在一样了」就翻。
    assert.equal(c.prefer, 'kcwiki')
  }
})

// ---- 舰载机 / 陆航两列：整列被静默丢弃过一次 ----
//
// 2026-08-28 实测：本期 E4/E5 的「特效装备倍卡表」里，「舰载机加成」与「陆航」
// 两列的格子写的是**分组代号: 数值**（"C2: 1.06\nC3: 1.03"），而提取器只有一条
// 要求裸数字的路，parseRate 失败后 `continue`，**整列无声消失**。
// 同一张表的「装备组加成」那三列因为写的是裸数字 1.12 而活了下来，
// 于是包里看着有数据、测试也绿，谁也没发现陆航那一列从来没进来过。
//
// 这个夹具把那张表的形状原样捏出来（colspan 分类行 + rowspan + "-" + 代号格），
// 好让判据脱离真实数据也能被钉住。
const SYNTHETIC_EQUIP = `==倍卡表==
===E8倍卡表===
{| class="wikitable"
! colspan="7" | E8 特效装备倍卡表（2099.01.01）
|-
! rowspan="2" |
! colspan="2" | 舰载机加成
! 陆航
! colspan="3" | 装备组加成
|-
! Group A
! Group B
! Group C
! A组
! B组
! C组
|-
| '''全图'''
| A1: 1.06<br />A2: 1.05
| -
| -
| -
| -
| -
|-
| '''P1 Boss（D点）'''
| rowspan="2" | -
| B1: 1.04
| C2: 1.20<br/>C3: 1.03
| 1.12
| 1.08
| 1.04
|-
| '''P2 Boss（X点）'''
| -
| -
| -
| -
| -
|}
`

const eq = extractBonusTable(tablesIn(splitEventSections(SYNTHETIC_EQUIP).E8)[0])
const efind = (scope, by, key) =>
  eq.entries.find(
    (x) => (scope ? String(x.scope).includes(scope) : true) && x.by === by && x.key === key,
  )

test('陆航那一列不许再被静默丢掉——"C2: 1.20" 这种代号格要按代号拆开', () => {
  assert.equal(efind('D点', 'lbas', 'C2').value, 1.2)
  assert.equal(efind('D点', 'lbas', 'C3').value, 1.03)
  // 只有 D 点那一行有陆航倍率；写 "-" 的两行绝不许冒出条目
  assert.equal(eq.entries.filter((x) => x.by === 'lbas').length, 2)
  assert.equal(efind('全图', 'lbas', 'C2'), undefined)
  assert.equal(efind('X点', 'lbas', 'C2'), undefined)
})

test('舰载机加成同样按代号拆，且两类判据不许互相串台', () => {
  assert.equal(efind('全图', 'plane', 'A1').value, 1.06)
  assert.equal(efind('全图', 'plane', 'A2').value, 1.05)
  assert.equal(efind('D点', 'plane', 'B1').value, 1.04)
  // A1/A2 是舰载机不是陆航，C2/C3 是陆航不是舰载机——串了会让整队倍率算错
  assert.equal(efind(null, 'lbas', 'A1'), undefined)
  assert.equal(efind(null, 'plane', 'C2'), undefined)
})

test('key 取分组代号而不是列名——"Group C" 不许当成一个组漏出去', () => {
  // 列名在上游两张表里措辞并不一致（"Group C" / "陆航"），拿它当 key 会让
  // 运行时按组名匹配时对不上；代号（C2）本身已经带着组别字母。
  for (const bad of ['Group A', 'Group B', 'Group C', '陆航', '舰载机加成']) {
    assert.equal(
      eq.entries.some((x) => x.key === bad),
      false,
      `列名 ${bad} 漏成了条目的 key`,
    )
  }
})

test('装备组那三列是裸数字，改动不能把它们一起带坏', () => {
  // 这三列本来就是好的——加陆航那条路时最容易顺手改坏的就是它们
  assert.equal(efind('D点', 'equipGroup', 'A组').value, 1.12)
  assert.equal(efind('D点', 'equipGroup', 'B组').value, 1.08)
  assert.equal(efind('D点', 'equipGroup', 'C组').value, 1.04)
  assert.equal(efind('全图', 'equipGroup', 'A组'), undefined)
})

test('真实表：E4/E5 的陆航倍率与两站独立核对过的值一致', {
  skip: hasReal ? false : '缺 assets/review/event-bonus.wikitext.txt',
}, () => {
  // 数值来源：kcwiki「2026年夏季活动」特效装备倍卡表；
  // 同一批数由 wikiwiki「反撃！第三十一戦隊の戦い/E4・E5」的「航空機特効」表
  // （表头原文 `基地c` → C1/C2/C3 三列）独立核对，boss 点逐格一致。
  const pack = buildEventBonusPack(readFileSync(REAL, 'utf8'))
  const lbasOf = (ev) => pack.events[ev].entries.filter((x) => x.by === 'lbas')

  // E4：C2 1.06 / C3 1.03，四个 boss 点各一对
  const e4 = lbasOf('E4')
  assert.equal(e4.length, 8)
  for (const scope of ['D点', 'S点', 'X点', 'Z点']) {
    const at = e4.filter((x) => x.scope.includes(scope))
    assert.equal(at.find((x) => x.key === 'C2')?.value, 1.06, `E4 ${scope} 的 C2`)
    assert.equal(at.find((x) => x.key === 'C3')?.value, 1.03, `E4 ${scope} 的 C3`)
  }

  // E5：只有 C2 = 1.2，且只在三处
  const e5 = lbasOf('E5')
  assert.equal(e5.length, 3)
  assert.ok(e5.every((x) => x.key === 'C2' && x.value === 1.2))
  assert.ok(e5.some((x) => x.scope.includes('J2点')))
  assert.ok(e5.some((x) => x.scope.includes('S点')))

  // E1–E3 一条都没有。wikiwiki 对这三张图明写「基地航空隊特効：なし」，
  // 两站一致——这里是**确认没有**，不是「没解析出来」。
  for (const ev of ['E1', 'E2', 'E3']) {
    assert.equal(lbasOf(ev).length, 0, `${ev} 冒出了陆航倍率`)
  }
})

test('随机补正不能当固定倍率乘进去', () => {
  const visby = UNMODELED_BONUSES.find((x) => x.key === 'Visby')
  assert.ok(visby, 'Visby 的随机补正被人悄悄建模了？')
  assert.match(visby.raw, /1\.2\/1\.45/)
  assert.match(visby.reason, /随机/)
})

test('资料包构建：条目与装备组都要落进去，冲突台账要随包走', {
  skip: hasReal ? false : '缺 assets/review/event-bonus.wikitext.txt',
}, () => {
  const pack = buildEventBonusPack(readFileSync(REAL, 'utf8'))
  assert.deepEqual(Object.keys(pack.events), ['E1', 'E2', 'E3', 'E4', 'E5'])
  const e4 = pack.events.E4
  assert.ok(e4.entries.length > 40, `E4 只有 ${e4.entries.length} 条`)
  assert.deepEqual(Object.keys(e4.equipGroups).sort(), ['A组', 'B组', 'C组'])
  assert.ok(e4.equipGroups['B组'].some((n) => n.includes('九七式中戦車(チハ)')))

  // X 点那几项要在
  const atX = e4.entries.filter((x) => x.scope.includes('X点'))
  assert.equal(atX.find((x) => x.by === 'stype' && x.key === '重巡')?.value, 1.13)
  assert.equal(atX.find((x) => x.by === 'equipGroup' && x.key === 'B组')?.value, 1.08)

  // 冲突台账必须随包分发——倍卡这项 kcwiki 胜 wikiwiki 是反通则的，
  // 不留痕下次就会被「按分层纠正」回去
  assert.equal(pack.conflicts.length, 3)
  assert.ok(pack.conflicts.every((c) => c.prefer === 'kcwiki'))
  assert.equal(pack.unmodeled.length, 1)
})
