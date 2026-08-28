// 常规海图特效舰：台账形状护栏 + 渲染产物护栏。
//
// 这一族最容易出的两种错都不报错、也不会被源码文本护栏逮到：
//   ① 列序读反——上游那张表是「点位组 × 舰组」的二维表，倍率抄错一列，
//      数看着都对，只是挂到了别的点上；
//   ② 「没数据的图零痕迹」写反——常规图绝大多数没有特效，判定写反的后果是
//      一百多张图各多出一块空牌子，而源码里那行 `if (!entry) return ''` 照样在。
// 所以①靠真数据与结构自洽逐条对，②靠真渲染一遍看产物。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { loadStart2MasterArray } from '../scripts/lib/start2.mjs'
import { NORMAL_MAP_BONUSES, normalMapBonusOf } from '../src/shared/normal-map-bonus.ts'
import { renderMapBonus } from './fixtures/render-map-bonus.mjs'

const root = path.join(fileURLToPath(import.meta.url), '..', '..')

// ---- ① 台账自洽 ----

test('台账：每张图都给得出来源页、最后编辑日期与核对日期', () => {
  assert.ok(NORMAL_MAP_BONUSES.length > 0, '台账空了？那 normalMapBonusOf 就是死代码')
  const seen = new Set()
  for (const entry of NORMAL_MAP_BONUSES) {
    const at = `台账 ${entry.code}`
    assert.match(entry.code, /^\d+-\d+$/, `${at} 海图编号写法非法`)
    assert.ok(!seen.has(entry.code), `${at} 重复登记`)
    seen.add(entry.code)
    assert.ok(entry.source.includes('wikiwiki'), `${at} 没写日文出处是哪一页`)
    assert.match(entry.sourceUpdatedAt, /^\d{4}-\d{2}-\d{2}$/, `${at} 来源页最后编辑日期写法非法`)
    assert.match(entry.checkedAt, /^\d{4}-\d{2}-\d{2}$/, `${at} 核对日期写法非法`)
    assert.ok(entry.evidence.length > 20, `${at} 没写上游凭什么这么说`)
  }
})

test('台账：倍率与点位逐条自洽，同一组舰不会在一个点上有两个倍率', () => {
  for (const entry of NORMAL_MAP_BONUSES) {
    assert.ok(entry.rows.length > 0, `台账 ${entry.code} 一行补正都没有`)
    for (const row of entry.rows) {
      const at = `${entry.code} / ${row.subject.kind === 'stype' ? row.subject.ja : row.subject.zh}`
      assert.ok(row.cells.length > 0, `${at} 一格倍率都没有`)
      const claimed = new Set()
      for (const cell of row.cells) {
        assert.ok(cell.nodes.length > 0, `${at} 有一格没写适用点位`)
        for (const node of cell.nodes) {
          assert.match(node, /^[A-Z]\d?$/, `${at} 点位 ${node} 写法非法`)
          assert.ok(!claimed.has(node), `${at} 的 ${node} 点被两格同时认领——多半是列读串了`)
          claimed.add(node)
        }
        // 特效是「打得更疼」，1.00 与超过 2 倍都只可能是抄错了位
        assert.ok(cell.value > 1 && cell.value < 2, `${at} 倍率 ${cell.value} 越界`)
        assert.equal(
          Math.round(cell.value * 100),
          Number((cell.value * 100).toFixed(0)),
          `${at} 倍率 ${cell.value} 不是两位小数`,
        )
      }
    }
    // Boss 点是拿来在 UI 上标红的：标了一个这张图根本吃不到补正的点，玩家会去找那一格
    const covered = new Set(entry.rows.flatMap((row) => row.cells.flatMap((cell) => [...cell.nodes])))
    assert.ok(entry.bossNodes.length > 0, `台账 ${entry.code} 没写 Boss 点`)
    for (const boss of entry.bossNodes) {
      assert.ok(covered.has(boss), `台账 ${entry.code} 的 Boss 点 ${boss} 不在任何一格补正里`)
    }
  }
})

test('台账：点名到舰的那几行，每条都带号与日文原名且不重号', () => {
  for (const entry of NORMAL_MAP_BONUSES) {
    for (const row of entry.rows) {
      if (row.subject.kind === 'stype') {
        assert.ok(Number.isInteger(row.subject.stypeId) && row.subject.stypeId > 0)
        assert.ok(row.subject.ja.length > 0)
        continue
      }
      const at = `${entry.code} / ${row.subject.zh}`
      assert.ok(row.subject.zh.length > 0 && row.subject.ja.length > 0, `${at} 名义没写全`)
      assert.ok(row.subject.ships.length > 0, `${at} 一条舰都没点到`)
      const ids = new Set()
      for (const ship of row.subject.ships) {
        assert.ok(Number.isInteger(ship.id) && ship.id > 0, `${at} 的 ${ship.ja} 号非法`)
        assert.ok(!ids.has(ship.id), `${at} 重复登记 ${ship.ja}`)
        ids.add(ship.id)
        assert.ok(ship.ja.length > 0, `${at} 有一条只有号没有名字`)
      }
    }
  }
})

test('台账：没收录的图返回 null（渲染方据此整节不出）', () => {
  assert.equal(normalMapBonusOf('1-1'), null)
  assert.equal(normalMapBonusOf('7-3'), null)
  assert.equal(normalMapBonusOf(''), null)
  assert.ok(normalMapBonusOf('7-4'))
})

test('台账：7-4 的四个数就是日文一手那四个', () => {
  const entry = normalMapBonusOf('7-4')
  const valueAt = (stypeId, node) =>
    entry.rows
      .find((row) => row.subject.kind === 'stype' && row.subject.stypeId === stypeId)
      ?.cells.find((cell) => cell.nodes.includes(node))?.value
  // 海防艦（stype 1）：J/L ×1.25、P(ボス) ×1.33
  assert.equal(valueAt(1, 'J'), 1.25)
  assert.equal(valueAt(1, 'L'), 1.25)
  assert.equal(valueAt(1, 'P'), 1.33)
  // 練習巡洋艦（stype 21）：J/L ×1.15、P(ボス) ×1.23
  assert.equal(valueAt(21, 'J'), 1.15)
  assert.equal(valueAt(21, 'L'), 1.15)
  assert.equal(valueAt(21, 'P'), 1.23)
})

// ---- ② 真数据层 ----

const masterShips = loadStart2MasterArray('api_mst_ship', root)
const masterStypes = loadStart2MasterArray('api_mst_stype', root)

test(
  '真数据：点名到的每个号都是一条真船，日文名一字不差',
  { skip: masterShips.length ? false : '缺 api_start2 主数据快照' },
  () => {
    const byId = new Map(masterShips.map((ship) => [Number(ship.api_id), ship]))
    for (const entry of NORMAL_MAP_BONUSES) {
      for (const row of entry.rows) {
        if (row.subject.kind !== 'ships') continue
        for (const ship of row.subject.ships) {
          const mst = byId.get(ship.id)
          assert.ok(mst, `${entry.code} 的 ${ship.ja}(${ship.id}) 在主数据里没有这条船`)
          assert.equal(mst.api_name, ship.ja, `${entry.code} 的 ${ship.id} 名字对不上`)
        }
      }
    }
  },
)

test(
  '真数据：舰种行钉的 stype 号在主数据里就是那个舰种',
  { skip: masterStypes.length ? false : '缺 api_start2 主数据快照' },
  () => {
    const byId = new Map(masterStypes.map((stype) => [Number(stype.api_id), stype]))
    for (const entry of NORMAL_MAP_BONUSES) {
      for (const row of entry.rows) {
        if (row.subject.kind !== 'stype') continue
        const mst = byId.get(row.subject.stypeId)
        assert.ok(mst, `${entry.code} 的 stype ${row.subject.stypeId} 主数据里没有`)
        assert.equal(mst.api_name, row.subject.ja, `${entry.code} 的 stype ${row.subject.stypeId} 名字对不上`)
      }
    }
  },
)

test('真数据：台账写的点位字母在随包海图拓扑里都真的存在', () => {
  // 海图包（poi fcd）与日文页是两份独立资料，拿它来对点位字母是这一族唯一
  // 能自动做的第二票：抄错一个字母，UI 会去标一个这张图上根本没有的点。
  const fcd = JSON.parse(
    fs.readFileSync(path.join(root, 'assets', 'lodes', 'poi-fcd-map.json'), 'utf8'),
  ).data
  for (const entry of NORMAL_MAP_BONUSES) {
    const spots = fcd?.[entry.code]?.spots
    assert.ok(spots, `海图包里没有 ${entry.code}，这一条对不了点位`)
    for (const row of entry.rows) {
      for (const cell of row.cells) {
        for (const node of cell.nodes) {
          assert.ok(node in spots, `${entry.code} 的 ${node} 点在海图包的拓扑里不存在`)
        }
      }
    }
    for (const boss of entry.bossNodes) {
      assert.ok(boss in spots, `${entry.code} 的 Boss 点 ${boss} 在海图包的拓扑里不存在`)
    }
  }
})

// ---- ③ 渲染产物 ----

test('渲染：台账没收录的图整节不出，一个字节都不留', () => {
  for (const code of ['1-1', '2-5', '7-1', '7-3', '6-5']) {
    assert.equal(renderMapBonus(code), '', `${code} 不该有特效舰一节`)
  }
})

test('渲染：7-4 列出两个舰种与四格倍率，Boss 点标出来', () => {
  const html = renderMapBonus('7-4', { ships: {}, stypes: { 1: '海防艦', 21: '練習巡洋艦' } })
  assert.match(html, /class="sec map-bonus"/)
  assert.match(html, /特效舰/)
  // 舰种走译名出口，号要对：1 = 海防艦、21 = 練習巡洋艦
  assert.match(html, /data-name="shipType:1"[^>]*>海防艦</)
  assert.match(html, /data-name="shipType:21"[^>]*>練習巡洋艦</)
  for (const value of ['×1.25', '×1.33', '×1.15', '×1.23']) {
    assert.ok(html.includes(value), `7-4 少了 ${value}`)
  }
  // P 是 Boss，J/L 不是——标红这件事必须真跑一遍才验得了写没写反
  assert.match(html, /<i class="boss" title="Boss 点">P<\/i>/)
  assert.match(html, /<i title="道中">J<\/i>/)
  assert.match(html, /<i title="道中">L<\/i>/)
  assert.ok(!html.includes('class="boss" title="Boss 点">J'), 'J 点被当成了 Boss')
  // 舰种行不列舰名：那等于把整个舰种抄一遍
  assert.ok(!html.includes('mb-ships'), '7-4 不该有点名到舰的那一段')
})

test('渲染：7-5 三组史实补正各就各位，舰名连回图鉴', () => {
  const html = renderMapBonus('7-5', { ships: {}, stypes: {} })
  assert.match(html, /泗水海战/)
  assert.match(html, /巴达维亚海战/)
  // Houston / Perth 两场都参加，走的是「上記両海戦」那一行
  assert.match(html, /<a data-el="mstShip:595">Houston<\/a>/)
  assert.match(html, /<a data-el="mstShip:613">Perth<\/a>/)
  assert.match(html, /<a data-el="mstShip:64">足柄<\/a>/)
  for (const value of ['×1.08', '×1.13', '×1.14', '×1.06', '×1.15']) {
    assert.ok(html.includes(value), `7-5 少了 ${value}`)
  }
  // K / Q / T 是三条血条的 Boss，B 是道中
  for (const boss of ['K', 'Q', 'T']) {
    assert.ok(html.includes(`<i class="boss" title="Boss 点">${boss}</i>`), `${boss} 没标成 Boss`)
  }
  assert.match(html, /<i title="道中">B<\/i>/)
  // 上游划掉的那条船不许混进来（白雲 964）
  assert.ok(!html.includes('mstShip:964'), '白雲被收进来了')
})

test('渲染：主数据在场时用游戏里的名字，不在场时台账自带的日文名顶上', () => {
  const withMaster = renderMapBonus('7-5', { ships: { 64: { name: '足柄改二' } }, stypes: {} })
  assert.match(withMaster, /<a data-el="mstShip:64">足柄改二<\/a>/)
  const bare = renderMapBonus('7-5')
  assert.match(bare, /<a data-el="mstShip:64">足柄<\/a>/)
  assert.ok(!bare.includes('undefined'), '主数据缺席时渲染出了 undefined')
})

test('渲染：一眼位置只有数据本体，出处与那一句人话收进悬停', () => {
  const html = renderMapBonus('7-5', { ships: {}, stypes: {} })
  const tips = [...html.matchAll(/title="([^"]*)"/g)].map((hit) => hit[1])
  assert.ok(
    tips.some((tip) => tip.includes('wikiwiki') && tip.includes('2026-08-25')),
    '来源页与核对日期没有随节一起给出',
  )
  assert.ok(
    tips.some((tip) => tip.includes('白雲')),
    '「白雲为什么不在名单里」没有留在悬停里',
  )
  // 悬停里的东西不许漏进正文：一眼位置只放「谁在哪几个点吃多少」
  const visible = html.replace(/<[^>]+>/g, '')
  assert.ok(!visible.includes('白雲'), '那一句人话跑进了正文')
})

test('渲染：台账里的维护者字段一个字都不上屏', () => {
  // evidence / deferred 是给复核用的（脚注考据、为什么不收某条船的长篇判据），
  // 与矿脉包的 maintainerNote 同一口径：玩家侧一个字都不该读到。
  for (const entry of NORMAL_MAP_BONUSES) {
    const html = renderMapBonus(entry.code, { ships: {}, stypes: {} })
    for (const text of [entry.evidence, ...(entry.deferred ?? [])]) {
      // 整段与首句都比对：截断后混进悬停一样算漏
      assert.ok(!html.includes(text), `${entry.code} 的维护者字段整段上屏了`)
      assert.ok(!html.includes(text.slice(0, 24)), `${entry.code} 的维护者字段被截断后上屏了`)
    }
  }
})

test('渲染：没有那一句人话的图不挂「口径」标', () => {
  const bonus74 = renderMapBonus('7-4', { ships: {}, stypes: {} })
  assert.ok(!normalMapBonusOf('7-4').playerNote, '7-4 现在有 playerNote 了，这条护栏要跟着改')
  assert.ok(!bonus74.includes('>口径<'), '7-4 挂了一个空的口径标')
  assert.ok(bonus74.includes('>源<'), '7-4 少了出处标')
  assert.ok(renderMapBonus('7-5', { ships: {}, stypes: {} }).includes('>口径<'))
})
