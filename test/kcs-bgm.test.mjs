import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import bgmModule from '../dist/shared/kcs-bgm.js'
import heardModule from '../dist/shared/bgm-heard.js'
import { joinBgmByDuration } from '../scripts/lib/bgm-duration-join.mjs'
import {
  NOT_THE_SAME_SONG,
  REFERENCE_TYPOS,
  auditBgmNames,
  foldPunctuation,
} from '../scripts/lib/bgm-name-audit.mjs'
import { KNOWN_TRANSCRIPTION_FIXES, parseKcwikiBgmList } from '../scripts/lib/kcwiki-bgm.mjs'
import { mountMgstate } from './fixtures/render-mgstate.mjs'

const { LOCAL_PORT_BGM_NAMES, bgmMasterCandidates, bgmSongName, parseKcsBgmPath } = bgmModule
const {
  EAR_REJECTED_BGM,
  HEARD_BGM_NAMES,
  HEARD_PORT_BGM_NAMES,
  heardBgmNameOf,
  heardPortBgmNameOf,
} = heardModule

test('BGM requests distinguish persistent port and battle music from fanfares and voices', () => {
  assert.deepEqual(
    parseKcsBgmPath('/kcs2/resources/bgm/port/115_1441.mp3', 1234),
    {
      kind: 'port',
      id: 115,
      pathname: '/kcs2/resources/bgm/port/115_1441.mp3',
      ts: 1234,
    },
  )
  assert.deepEqual(
    parseKcsBgmPath('/kcs2/resources/bgm/battle/274_5423.mp3', 5678),
    {
      kind: 'battle',
      id: 274,
      pathname: '/kcs2/resources/bgm/battle/274_5423.mp3',
      ts: 5678,
    },
  )
  assert.equal(parseKcsBgmPath('/kcs2/resources/bgm/fanfare/001_7793.mp3'), null)
  assert.equal(parseKcsBgmPath('/kcs/sound/kc123/456.mp3'), null)
})

test('主数据只认母港树的号，战斗树一个也不借', () => {
  // 母港树与 api_mst_bgm 是同一套号（实测 port/115 = 主数据 115「雨とお酒と艦娘」）
  assert.deepEqual(bgmMasterCandidates('port', 115), [115])
  // 战斗树是另一套。2026-08-24 逐号核过：旧的「+200」与「≥200 直查」两条都对不上
  //（battle/6 会被读成主数据 206「明石の工廠」，实际是「我、敵機動部隊ト交戦ス」；
  // battle/229 是 2023 夏活动曲，主数据 229 是「提督と艦娘の食卓」）。
  assert.deepEqual(bgmMasterCandidates('battle', 8), [])
  assert.deepEqual(bgmMasterCandidates('battle', 229), [])
  assert.deepEqual(bgmMasterCandidates('battle', 274), [])
})

test('曲名分层：母港先游戏一手再耳测母港层，战斗先誊写层再耳测战斗层，都没有就不给名', () => {
  const master = { 115: '雨とお酒と艦娘', 118: '鎮守府の秋祭り', 229: '提督と艦娘の食卓' }
  const names = { battle: { 118: '梅雨明けの白露', 229: '抜錨！鵜来型海防艦' } }
  // 母港：主数据说了算，下面几层都不越位（同号在两棵树上本来就是两首曲）
  assert.equal(bgmSongName('port', 115, master, names), '雨とお酒と艦娘')
  assert.equal(bgmSongName('port', 118, master, names), '鎮守府の秋祭り')
  // 耳测**战斗层**记的是战斗树的号，绝不许漏到母港侧去
  assert.equal(bgmSongName('port', 4, master, names), null)
  // 耳测**母港层**只补主数据查不到的号：103 是画面主题曲（出击选择画面），
  // 设不成母港曲、不上蓄音机，`api_mst_bgm` 结构性地永远不给它名字
  assert.equal(bgmSongName('port', 103, master, names), '海原越えて')
  assert.equal(bgmSongName('port', 103, master, null), '海原越えて')
  // **不越位**：主数据哪天真收了这个号，耳测母港层当场让位，一行都不用改
  assert.equal(bgmSongName('port', 103, { ...master, 103: '主数据后来收的' }, names), '主数据后来收的')
  // 两棵树同号是两首不同的曲：battle/103 是耳测战斗层的「捷号決戦前夜」，
  // 母港那个名字一个字也不许漏过来（08-24 主会话真把「海原越えて」与
  // battle/14「海原へ」混作一谈过，这两行钉的就是那件事）
  assert.equal(bgmSongName('battle', 103, master, names), '捷号決戦前夜')
  assert.notEqual(bgmSongName('battle', 103, master, names), '海原越えて')
  assert.equal(bgmSongName('battle', 14, master, names), '海原へ')
  // 战斗：誊写层补上主数据给不了的那一半，且绝不回落到同号的母港曲名
  //（118 这一格现在两层都有话说、且说的一样——层间先后由下面 4 号那条单钉）
  assert.equal(bgmSongName('battle', 118, master, names), '梅雨明けの白露')
  assert.equal(bgmSongName('battle', 229, master, names), '抜錨！鵜来型海防艦')
  // 誊写层没有的号落到耳测层（4 号提督亲耳确认过）
  assert.equal(bgmSongName('battle', 4, master, names), '二水戦の航跡')
  // 誊写层优先于耳测层：同号真撞上时以按文件名键入的那层为准
  assert.equal(bgmSongName('battle', 4, master, { battle: { 4: '誊写层说的' } }), '誊写层说的')
  // 三层都没有：如实交白卷，由调用方显示编号
  assert.equal(bgmSongName('battle', 279, master, names), null)
  assert.equal(bgmSongName('port', 999, master, names), null)
  // 包没装/装失败时不许炸，也不许拿主数据顶战斗曲；耳测层是随源码走的，仍在。
  // 这里换 229 来钉「不许拿主数据顶」：主数据 229 是母港树的「提督と艦娘の食卓」，
  // 战斗树的 229 只在誊写层里——包一没就该交白卷。
  //（原先这一行钉的是 118，2026-08-24 第三波耳测把 118 收进耳测层之后它不再交白卷，
  // 改由下一行钉「出的是战斗树那首、不是母港那首」，反倒比原来更贴这条断言的本意。）
  assert.equal(bgmSongName('battle', 229, master, null), null)
  assert.equal(bgmSongName('battle', 118, master, null), '梅雨明けの白露')
  assert.notEqual(bgmSongName('battle', 118, master, null), master[118])
  assert.equal(bgmSongName('battle', 4, master, null), '二水戦の航跡')
  assert.equal(bgmSongName('port', 115, master, null), '雨とお酒と艦娘')
})

test('耳测层:每条都带得出日期，号在资源路径的取值范围内，且与誊写层零重叠', () => {
  const pack = JSON.parse(
    fs.readFileSync(new URL('../assets/lodes/kcwiki-bgm.json', import.meta.url), 'utf8'),
  ).data.battle
  assert.ok(HEARD_BGM_NAMES.length >= 30, `耳测层只剩 ${HEARD_BGM_NAMES.length} 条`)
  const seen = new Set()
  for (const entry of HEARD_BGM_NAMES) {
    assert.ok(Number.isInteger(entry.id) && entry.id >= 1 && entry.id <= 999, `${entry.id} 越界`)
    assert.ok(!seen.has(entry.id), `${entry.id} 在耳测层里重复`)
    seen.add(entry.id)
    assert.ok(entry.name && !entry.name.includes('不明'), `${entry.id} 的曲名是占位串`)
    assert.match(entry.heardAt, /^\d{4}-\d{2}-\d{2}$/, `${entry.id} 没有确认日期`)
    // 零重叠是这一层的前提：撞上了说明两个一手来源打架，要挂出来单独裁，
    // 不许靠「谁排前面」把分歧静默压掉。
    assert.equal(pack[`${entry.id}`], undefined, `${entry.id} 与誊写层撞号，需人工裁定`)
  }
  // 听过并判定「索引那个名字是错的」的号，永远不许带着**那个错名**进任何一层。
  // 判死钉的是错名而不是「这个号没名字」：162 就是先判死错名、后由他实听定出
  // 真名「雪風の奇跡」的。所以这里断言的是「发的名字不等于错名」，
  // 不能断言「发不出名字」——那会把后来查实的真名一起挡掉。
  for (const rejected of EAR_REJECTED_BGM) {
    assert.notEqual(heardBgmNameOf(rejected.id), rejected.wrongName, `${rejected.id} 的错名回到了耳测层`)
    assert.notEqual(pack[`${rejected.id}`], rejected.wrongName, `${rejected.id} 的错名被捡回来了`)
    assert.match(rejected.heardAt, /^\d{4}-\d{2}-\d{2}$/)
  }
  // 162 这条同时管两头：真名要发得出，错名要挡得住
  assert.equal(heardBgmNameOf(162), '雪風の奇跡')
})

test('耳测母港层:只补主数据的空,来路逐条写明,且与战斗树各算各的号', () => {
  assert.ok(HEARD_PORT_BGM_NAMES.length >= 1, '母港耳测层空了')
  const seen = new Set()
  for (const entry of HEARD_PORT_BGM_NAMES) {
    assert.ok(Number.isInteger(entry.id) && entry.id >= 1 && entry.id <= 999, `${entry.id} 越界`)
    assert.ok(!seen.has(entry.id), `${entry.id} 在母港耳测层里重复`)
    seen.add(entry.id)
    assert.ok(entry.name && !entry.name.includes('不明'), `${entry.id} 的曲名是占位串`)
    assert.match(entry.heardAt, /^\d{4}-\d{2}-\d{2}$/, `${entry.id} 没有确认日期`)
    // 这一层的来路全在他的耳朵里，没有第二方能复核，所以每条都必须写明白凭什么
    assert.ok(entry.note, `${entry.id} 没写来路`)
    // **不越位的机器判据**（不是断言源码文本）：同一个号主数据一旦给了名字，
    // 出来的就该是主数据那个。这一层是补空的，不是改写游戏一手的。
    assert.equal(
      bgmSongName('port', entry.id, { [entry.id]: '主数据后来收的' }, null),
      '主数据后来收的',
      `${entry.id} 上耳测母港层越过了主数据`,
    )
    // 主数据交白卷时才轮到它
    assert.equal(bgmSongName('port', entry.id, {}, null), entry.name)
    // 母港号绝不漏到战斗树去（那是另一套编号）
    assert.notEqual(bgmSongName('battle', entry.id, {}, null), entry.name, `${entry.id} 漏到了战斗树`)
  }
  assert.equal(heardPortBgmNameOf(103), '海原越えて')
  // 战斗树的查询函数看不见母港层，反之亦然——两张表、两个入口，不共用一个 Map
  assert.equal(heardBgmNameOf(103), '捷号決戦前夜')
  assert.equal(heardPortBgmNameOf(4), null)
  assert.equal(heardPortBgmNameOf(14), null)
})

test('母港本地补名:官方连名字都没有的号才轮到它,主数据一给名就当场让位', () => {
  const master = { 115: '雨とお酒と艦娘' }
  // 132：本机 api_start2 快照的 api_mst_bgm 共 128 条，这个号整个缺席
  //（2026-08-27 实证）。活动「选择奖励」界面放的那首母港曲，用户拍板叫「获取」。
  assert.equal(bgmSongName('port', 132, master, null), '获取')
  assert.equal(bgmSongName('port', 132, {}, { battle: { 132: '战斗树那首' } }), '获取')
  // **不越位**：主数据哪天真收了这个号，本地名当场让位，一行都不用改。
  // 这是这一层最要紧的一条——本地名是补空的，不是跟官方抢的。
  assert.equal(bgmSongName('port', 132, { ...master, 132: '官方后来给的' }, null), '官方后来给的')
  // 主数据在册的号一律照旧走官方，本地表一个字也漏不过去
  assert.equal(bgmSongName('port', 115, master, null), '雨とお酒と艦娘')
  // 母港号绝不漏到战斗树去（两套编号，battle/132 是另一首曲）
  assert.notEqual(bgmSongName('battle', 132, {}, null), '获取')
  // 没收进来的号照旧交白卷，绝不编（122/134/135 是同一轮扫号里判不准的三个）
  for (const id of [122, 134, 135]) assert.equal(bgmSongName('port', id, {}, null), null)

  for (const [id, name] of Object.entries(LOCAL_PORT_BGM_NAMES)) {
    assert.match(id, /^\d{1,3}$/, `本地补名的号 ${id} 超出资源路径的取值范围`)
    assert.ok(Number(id) >= 1 && Number(id) <= 999, `${id} 越界`)
    assert.ok(name && name.trim() === name, `${id} 的本地名是空串或带空白`)
    // 与耳测母港层**不许重号**：那一层排在前面，重了这一条就是永远走不到的死名，
    // 而死名的害处是它看起来还在管事。两张表分工不同（官方确有其名 / 官方没有名字），
    // 同一个号只该落在其中一张上。
    assert.equal(heardPortBgmNameOf(Number(id)), null, `${id} 在耳测母港层里已经有名字了`)
    assert.equal(bgmSongName('port', Number(id), {}, null), name)
    assert.equal(bgmSongName('port', Number(id), { [id]: '官方后来给的' }, null), '官方后来给的')
  }
})

test('活动图配曲留存:趁在场抄下的一手行,撤场后仍答得出,且不冒充常规图', async () => {
  const { EVENT_MAP_BGM, archivedMapBgmOf } = (await import('../dist/shared/event-map-bgm.js'))
    .default
  assert.ok(EVENT_MAP_BGM.length >= 1)
  for (const archive of EVENT_MAP_BGM) {
    assert.match(archive.capturedAt, /^\d{4}-\d{2}-\d{2}$/, `${archive.area} 没写抄自哪天`)
    assert.ok(archive.areaName, `${archive.area} 没有区名`)
    assert.ok(archive.maps.length >= 1)
    for (const row of archive.maps) {
      // api_id 的构成是「区号×10 + 图号」，留存必须落在本区号段里，
      // 否则会在图鉴里顶替掉别的图的 BGM 行
      assert.equal(Math.floor(row.mapId / 10), archive.area, `${row.mapId} 不属于 ${archive.area} 区`)
      for (const id of [row.api_moving_bgm, ...row.api_map_bgm, ...row.api_boss_bgm]) {
        assert.ok(Number.isInteger(id) && id >= 1 && id <= 999, `${row.mapId} 的资源号 ${id} 越界`)
      }
    }
  }
  // 本期五张图逐格钉死（2026-08-24 抄自主数据快照）
  assert.deepEqual(archivedMapBgmOf(623), {
    mapId: 623,
    api_moving_bgm: 275,
    api_map_bgm: [276, 276],
    api_boss_bgm: [277, 277],
  })
  // 62-5 的 Boss 用的是旧号 124，不是 62-4 那套——抄错这一格没人看得出来
  assert.deepEqual(archivedMapBgmOf(625).api_boss_bgm, [124, 124])
  // 常规图永远走主数据，留存里一条都不该有
  assert.equal(archivedMapBgmOf(11), null)
  assert.equal(archivedMapBgmOf(75), null)
})

test('海域卷的 BGM 行真的接了留存回退，且顺序是「主数据优先」', () => {
  // ---- 为什么这一条用源码文本（家法要求注明理由）----
  // 钉的是**存在性**：「ji 的 BGM 行上接没接那一档回退」。ji 是几千行的渲染模块，
  // 没有可 import 的纯函数能表达它；而漏接的后果不会报错——活动撤场那天
  // （约九月上旬）BGM 行会安静地整行消失，谁也不会当场发现。
  // 逻辑那一半已经在上一条里真跑过了（archivedMapBgmOf 逐格断言）。
  const ji = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  const line = /const mapBgmLineHtml[\s\S]{0,600}?if \(!row\) return ''/.exec(ji)
  assert.ok(line, 'mapBgmLineHtml 的取行那一段变了，判据要跟着改')
  assert.match(line[0], /api_mst_mapbgm/, 'BGM 行必须先查当下的主数据')
  assert.match(line[0], /archivedMapBgmOf\(mapId\)/, 'BGM 行没接活动撤场后的留存回退')
  // 顺序不能反：活动在场期间以官方当刻下发的为准（期中改配曲的先例是有的）
  assert.ok(
    line[0].indexOf('api_mst_mapbgm') < line[0].indexOf('archivedMapBgmOf'),
    '留存被排到了主数据前面——那会让在场期间的改动显示不出来',
  )
})

// ---------------------------------------------------------------- 抓取器

const PAGE = `
==镇守府BGM==
1.<big><b>{{lang|ja|「母港」}}</b></big><small>（母港） 时长：1:40</small>
<div style="display:flex">
<flashmp3>CommonBGM1.mp3</flashmp3>{{download|File=CommonBGM1.mp3}}
</div>

==通常海域BGM==
1.<big><b>{{lang|ja|「砲雷撃戦、始め！」}}</b></big><small>（炮雷击战，开始！） 时长：2:11</small>
<div style="display:flex">
<flashmp3>BattleBGM01.mp3</flashmp3>{{download|File=BattleBGM01.mp3}}
</div>

2.<big><b>{{lang|ja|「長波、駆ける」}}</b></big><small>（奔跑吧，长波） 时长：1:17</small>
<div style="display:flex">
<flashmp3>133_7810.mp3</flashmp3>{{download|File=133_7810.mp3}}
</div>

==期间限定海域BGM==
===2018年冬季活动{{lang|ja|「捷号決戦」}}===
1.<big><b>{{lang|ja|「新編「海上護衛隊」抜錨！」}}</b></big><br /><small>时长：1:42</small>
<div style="display:flex">
<flashmp3>110 4321.mp3</flashmp3>{{download|File=110 4321.mp3}}
</div>

2.<big><b> {{lang|ja|「友軍艦隊！反撃開始」}}<!--jawiki89--></b></big> <small>时长：1:36</small>
<div style="display:flex">
<flashmp3>1_res.sounds.battle.BGM_113.mp3</flashmp3>{{download|File=1_res.sounds.battle.BGM_113.mp3}}
</div>

3.<big><b> {{lang|ja|(曲名不明85)}}</b></big> <small>时长：1:34</small>
<div style="display:flex">
<flashmp3>148_5310.mp3</flashmp3>{{download|File=148_5310.mp3}}
</div>

4.<big><b> {{lang|ja|「地中海の潮風」}}</b></big> <small>时长：1:13</small>
<div style="display:flex">
<flashmp3>145_7487.mp3</flashmp3>{{download|File=145_7487.mp3}}
</div>

===2019年秋季活动{{lang|ja|「南方作戦」}}===
1.<big><b> {{lang|ja|「南方の戦闘哨戒」}}</b></big> <small>时长：0:44</small>
<div style="display:flex">
<flashmp3>145_6045.mp3</flashmp3>{{download|File=145_6045.mp3}}
</div>

2.<big><b> {{lang|ja|}}</b></big> <small>时长：1:33</small>
<div style="display:flex">
<flashmp3>BGM_Battle_282.mp3</flashmp3>{{download|File=BGM_Battle_282.mp3}}
</div>

==事件BGM==
1.<big><b> (战斗评级S BGM)</b></big> <small>时长：0:08</small>
<div style="display:flex">
<flashmp3>001 7793.mp3</flashmp3>{{download|File=001 7793.mp3}}
</div>
`

test('拆包BGM列表:只认游戏原文件名的号，站方上传名一律不当资源号', () => {
  const { battle, reused, unnamed, warnings } = parseKcwikiBgmList(PAGE)
  // 收得下的：三种游戏原文件名形状都认
  assert.equal(battle[133], '長波、駆ける')
  assert.equal(battle[110], '新編「海上護衛隊」抜錨！') // 曲名自带「」，只剥最外一对
  assert.equal(battle[113], '友軍艦隊！反撃開始') // 站方保留资源路径的那种写法
  // 站方上传名（CommonBGM1 / BattleBGM01）里的数字是站内序号——真按号读会把
  // 「砲雷撃戦、始め！」写成资源 1，而它真正的号并不是 1。整条丢弃。
  assert.equal(battle[1], undefined)
  // 母港树与 fanfare 树不进这个包：事件BGM 的 `001 7793` 是结算音，
  // 镇守府BGM 的 CommonBGM1 是母港曲——两者都不该出现在战斗曲表里
  assert.equal(Object.keys(battle).sort((a, b) => a - b).join(','), '110,113,133')
  // 官方还没公布曲名的照实记成「没有名字」，不拿占位串当曲名
  assert.deepEqual(unnamed, [148, 282])
  // 号被后来的活动挪去挂别的曲：分不开就不发名
  assert.deepEqual(reused[145], ['地中海の潮風', '南方の戦闘哨戒'])
  assert.equal(battle[145], undefined)
  assert.ok(warnings.some((line) => line.includes('上传名')))
})

/** 只放一条 124 的页面，用来单测转写台账；曲名由入参决定 */
const pageWithBgm124 = (title) => `
==期间限定海域BGM==
===2018年初秋季活动{{lang|ja|「抜錨！連合艦隊、西へ！」}}===
1.<big><b> {{lang|ja|「${title}」}}</b></big> <small>时长：1:14</small>
<div style="display:flex">
<flashmp3>124_8714.mp3</flashmp3>{{download|File=124_8714.mp3}}
</div>
`

test('转写台账:上游把「北大西洋」写成「北太平洋」的那一笔，出包时改回官方原名', () => {
  // 「太」与「大」在日文里差一整个大洋。官方曲目表（OST vol.VI【雪】Tr.23）、
  // Fandom 的罗马音 Kessen! Kita-taiseiyou、wikiwiki 全页 7 处「北大西洋」三票一致；
  // 初出的 2018 初秋活动 E-5 最终 Boss 那张图，敌方点名也逐字写着「深海北大西洋艦隊」。
  const { battle, warnings } = parseKcwikiBgmList(pageWithBgm124('決戦！北太平洋'))
  assert.equal(battle[124], '決戦！北大西洋')
  assert.equal(warnings.filter((line) => line.includes('124')).length, 0, '正常打补丁不该报警')
})

test('转写台账:指纹对不上就不打补丁,只告警——源改了就该重新核', () => {
  // 上游改成了第三种写法：既不是台账记的错值，也不是官方原名 → 一个字都不许动
  const changed = parseKcwikiBgmList(pageWithBgm124('決戦！南太平洋'))
  assert.equal(changed.battle[124], '決戦！南太平洋')
  assert.ok(changed.warnings.some((line) => line.includes('指纹对不上')), changed.warnings.join('/'))
  // 上游自己改对了：不重复打补丁，改成提示台账可以退役
  const fixed = parseKcwikiBgmList(pageWithBgm124('決戦！北大西洋'))
  assert.equal(fixed.battle[124], '決戦！北大西洋')
  assert.ok(fixed.warnings.some((line) => line.includes('可以退役')), fixed.warnings.join('/'))
})

test('转写台账:每条都记得住上游错成什么样、官方原名是什么、凭什么这么判', () => {
  assert.ok(KNOWN_TRANSCRIPTION_FIXES.length >= 1)
  for (const fix of KNOWN_TRANSCRIPTION_FIXES) {
    assert.ok(Number.isInteger(fix.id) && fix.id >= 1 && fix.id <= 999, `${fix.id} 越界`)
    assert.ok(fix.upstream && fix.official && fix.upstream !== fix.official, `${fix.id} 的两个值没差别`)
    assert.ok(fix.why, `${fix.id} 没写凭什么改`)
    assert.match(fix.checkedAt, /^\d{4}-\d{2}-\d{2}$/, `${fix.id} 没写核对日期`)
    // 台账只管誊写层；耳测层是另一份一手证据，不许在这里被改写
    assert.equal(heardBgmNameOf(fix.id), null, `${fix.id} 同时在耳测层里，需人工裁定`)
  }
})

// ---------------------------------------------------------------- 官方曲名字形总校

test('字形总校:约物差异不算发现,汉字差一个字才算,且尺子自己错的那几格已裁', () => {
  const reference = {
    albums: [
      {
        vol: 'I',
        volName: '暁',
        tracks: [
          { no: 3, name: '全艦娘、突撃!', duration: '2:33' }, // 半角！
          { no: 7, name: '海上護衛艦', duration: '3:31' }, // 参考表自己错的那一格
          { no: 9, name: '決戦!鉄底海峡を抜けて', duration: '3:23' },
        ],
      },
      { vol: 'VI', volName: '雪', tracks: [{ no: 23, name: '決戦！北大西洋', duration: '2:36' }] },
    ],
  }
  const audit = auditBgmNames(reference, [
    { layer: '耳测战斗层', tree: 'battle', id: 3, name: '全艦娘、突撃！' }, // 只差全半角
    { layer: '拆包层', tree: 'battle', id: 124, name: '決戦！北大西洋' }, // 逐字相同
    { layer: '耳测战斗层', tree: 'battle', id: 7, name: '海上護衛戦' }, // 参考表错，我们对
    { layer: '拆包层', tree: 'battle', id: 109, name: '決戦!鉄底海峡を抜けた' }, // 真的差一个字
    { layer: '拆包层', tree: 'battle', id: 999, name: '八戸の盾' }, // 碟上没有
  ])
  assert.deepEqual(audit.exact.map((r) => r.id), [124])
  // 约物那一档单独成筐：**不算发现**，因为各家自己都不统一（vol.I 半角、vol.VI 全角）
  assert.deepEqual(audit.punctOnly.map((r) => r.id), [3])
  assert.deepEqual(audit.absent.map((r) => r.id), [999])
  // 差一个汉字才进「要人看」那一筐
  assert.deepEqual(audit.pending.map((r) => r.id), [109])
  assert.equal(audit.pending[0].d, 1)
  // 已裁的不再冒出来当待看，但仍留在 nearMiss 里带着裁定理由
  const settled = audit.nearMiss.find((r) => r.id === 7)
  assert.ok(settled?.settled?.includes('海上護衛艦'), '7 号那条裁定理由丢了')
  assert.ok(!audit.pending.some((r) => r.id === 7))
  // 归一只吃约物，一个汉字都不许动——不然「太/大」这种就被抹平了
  assert.equal(foldPunctuation('決戦！北大西洋'), '決戦!北大西洋')
  assert.notEqual(foldPunctuation('決戦！北大西洋'), foldPunctuation('決戦！北太平洋'))
})

test('字形总校:两张裁定台账都不许留过期条目——名字改了就该跟着改', () => {
  const reference = JSON.parse(
    fs.readFileSync(new URL('../scripts/ost-tracklists.json', import.meta.url), 'utf8'),
  )
  const pack = JSON.parse(
    fs.readFileSync(new URL('../assets/lodes/kcwiki-bgm.json', import.meta.url), 'utf8'),
  ).data.battle
  const ours = new Set([
    ...Object.values(pack),
    ...HEARD_BGM_NAMES.map((e) => e.name),
    ...HEARD_PORT_BGM_NAMES.map((e) => e.name),
  ])
  // 台账的键是**我们的写法**：哪天那个名字被改掉，台账那条就成了死条目，
  // 而死条目的害处不是没用——是它会让「已裁」的账看起来还在，掩住新的分歧
  for (const [name, why] of [...REFERENCE_TYPOS, ...NOT_THE_SAME_SONG]) {
    assert.ok(ours.has(name), `裁定台账里的「${name}」已经不在任何一层了，该退役`)
    assert.ok(why && why.length > 20, `「${name}」没写凭什么这么裁`)
  }
  // 全跑一遍真数据：待看那一筐必须是空的。**新差异冒出来就该在这里当场红**
  const rows = [
    ...Object.entries(pack).map(([id, name]) => ({ layer: '拆包层', tree: 'battle', id: Number(id), name })),
    ...HEARD_BGM_NAMES.map((e) => ({ layer: '耳测战斗层', tree: 'battle', id: e.id, name: e.name })),
    ...HEARD_PORT_BGM_NAMES.map((e) => ({ layer: '耳测母港层', tree: 'port', id: e.id, name: e.name })),
  ]
  const audit = auditBgmNames(reference, rows)
  assert.deepEqual(
    audit.pending.map((r) => `${r.tree}/${r.id} 我们「${r.name}」/参考表「${r.reference}」${r.at}`),
    [],
    '字形总校冒出了没裁过的差异——逐条看完再决定是进转写台账还是进裁定台账',
  )
  assert.ok(audit.exact.length >= 100, `逐字相同只剩 ${audit.exact.length} 条，参考表多半坏了`)
})

test('官方 OST 参考表:九卷都在,曲序不重不漏,且把三条边界写在自己脸上', async () => {
  // 「运行时零读取、不随包」那半句要能兑现：打包过滤真跑一遍，别只写在 note 里
  const { isPackageIgnored } = await import('../scripts/lib/package-ignore.mjs')
  assert.equal(isPackageIgnored('/scripts/ost-tracklists.json'), true, '官方曲目表会被打进产物')
  assert.equal(isPackageIgnored('/scripts/bgm-name-audit.mjs'), true)
  const reference = JSON.parse(
    fs.readFileSync(new URL('../scripts/ost-tracklists.json', import.meta.url), 'utf8'),
  )
  assert.equal(reference.schemaVersion, 1)
  assert.equal(reference.albumCount, reference.albums.length)
  assert.ok(reference.albums.length >= 9, `只剩 ${reference.albums.length} 卷`)
  assert.deepEqual(reference.warnings, [], '抓取器留了告警没处理')
  let total = 0
  for (const album of reference.albums) {
    assert.ok(album.volName && album.title.includes(album.volName), `${album.vol} 卷名对不上标题`)
    assert.ok(album.tracks.length >= 10, `vol.${album.vol} 只剩 ${album.tracks.length} 曲`)
    const nos = album.tracks.map((t) => t.no)
    assert.equal(new Set(nos).size, nos.length, `vol.${album.vol} 曲序有重复`)
    assert.deepEqual(nos, [...nos].sort((a, b) => a - b), `vol.${album.vol} 曲序没排好`)
    for (const track of album.tracks) {
      assert.ok(track.name, `vol.${album.vol} Tr.${track.no} 没有曲名`)
      assert.match(track.duration, /^\d+:\d{2}$/, `vol.${album.vol} Tr.${track.no} 时长格式不对`)
    }
    total += album.tracks.length
  }
  assert.equal(reference.trackCount, total)
  assert.ok(total >= 200, `只剩 ${total} 曲`)
  // 三条边界必须写在数据自己身上——这份表会被别人捡起来用，而误用的代价各不相同
  const note = reference.note.join('\n')
  assert.match(note, /不随包/)
  assert.match(note, /约物/, '没写「约物不是官方原样」')
  assert.match(note, /bgm-duration-align/, '没写「时长不许喂给时长对齐」')
  assert.match(note, /碟序不是资源号|专辑收录 ≠ 游戏内编号/, '没写「碟序不是资源号」')
  // 锚定事实：124 那笔转写错的官方原名就在 vol.VI【雪】Tr.23
  const yuki = reference.albums.find((a) => a.volName === '雪')
  assert.equal(yuki.tracks.find((t) => t.no === 23)?.name, '決戦！北大西洋')
  // port/103 那条 note 引的官方一手：OST vol.I【暁】Tr.2 确有一首「出撃」
  const akatsuki = reference.albums.find((a) => a.volName === '暁')
  assert.equal(akatsuki.tracks.find((t) => t.no === 2)?.name, '出撃')
})

test('官方 OST 的时长绝不许喂给时长对齐——碟面是完整版,游戏内是循环版', () => {
  // ---- 为什么这一条用源码文本（家法要求注明理由）----
  // 钉的是**不存在性**：「时长对齐那条流水线有没有伸手去读这份表」。
  // 没法用行为测出来——真读了也不会报错，只会安静地把一批号配错名，
  // 而错因（碟面 2:53 / 游戏内 1:28，实案在档的是「華の二水戦」）当场看不出来。
  const align = fs.readFileSync(new URL('../scripts/bgm-duration-align.mjs', import.meta.url), 'utf8')
  assert.ok(!align.includes('ost-tracklists'), '时长对齐伸手去读官方碟面时长了')
  const join = fs.readFileSync(new URL('../scripts/lib/bgm-duration-join.mjs', import.meta.url), 'utf8')
  assert.ok(!join.includes('ost-tracklists'), '时长配对里出现了官方碟面时长')
})

// ---------------------------------------------------------------- 时长对齐

/** 两边都认得的一个号，用来先验「站方标的时长与本机实测是同一个口径」 */
const CALIBRATION = [{ id: 275, name: '戦隊を統べる月の花', seconds: 53 }]
const CALIBRATED_TRACK = { id: 275, seconds: 53.05 }
/** 校准用的那首本来就已经定了名，它不该再被当成「新发现」 */
const CALIBRATION_TAKEN = { '戦隊を統べる月の花': 275 }

test('时长对齐:校准不过就整层停，一条都不收', () => {
  // 站方标 53s、本机实测 61s：口径根本不是一回事，这时候放宽容差就是自欺
  const stopped = joinBgmByDuration({
    tracks: [{ id: 275, seconds: 61 }, { id: 900, seconds: 40 }],
    songs: [{ name: '某首曲', seconds: 40 }],
    calibration: CALIBRATION,
  })
  assert.equal(stopped.stopped, true)
  assert.equal(stopped.reason, 'calibration-failed')
  assert.deepEqual(stopped.matched, [])
  // 一个校准样本都对不上号（本机没有那一首）时同样停——不许在没校准的情况下开工
  const blind = joinBgmByDuration({
    tracks: [{ id: 900, seconds: 40 }],
    songs: [{ name: '某首曲', seconds: 40 }],
    calibration: CALIBRATION,
  })
  assert.equal(blind.stopped, true)
  assert.equal(blind.reason, 'no-calibration')
  assert.deepEqual(blind.matched, [])
})

test('时长对齐:双向唯一才算命中，撞时长的一律不判', () => {
  const result = joinBgmByDuration({
    tracks: [
      CALIBRATED_TRACK,
      { id: 900, seconds: 40.2 }, // 唯一命中
      { id: 901, seconds: 70.0 }, // 容差里有两首曲 → 不判
      { id: 902, seconds: 88.0 }, // 与 903 都贴合同一首曲 → 反向不唯一
      { id: 903, seconds: 88.9 },
      { id: 904, seconds: 200 }, // 站方时长里根本没有对应
    ],
    songs: [
      { name: '戦隊を統べる月の花', seconds: 53 },
      { name: '唯一的那首', seconds: 40 },
      { name: '撞时长甲', seconds: 69 },
      { name: '撞时长乙', seconds: 71 },
      { name: '被两个号夹着的', seconds: 88.5 },
    ],
    calibration: CALIBRATION,
    taken: CALIBRATION_TAKEN,
  })
  assert.equal(result.stopped, false)
  // 275 认回它自己那首是复核不是新发现（撞名规则只挡「归了**别的**号」），留着无害
  assert.deepEqual(
    result.matched.map((m) => [m.id, m.name]),
    [
      [275, '戦隊を統べる月の花'],
      [900, '唯一的那首'],
    ],
  )
  const ambiguous = new Map(result.ambiguous.map((a) => [a.id, a]))
  assert.deepEqual(ambiguous.get(901).candidates, ['撞时长甲', '撞时长乙'])
  // 反向撞号：曲名侧只有一首，但它同时贴合 902 和 903，两个号都不许落账
  assert.deepEqual(ambiguous.get(902).alsoFits, [902, 903])
  assert.deepEqual(ambiguous.get(903).alsoFits, [902, 903])
  assert.deepEqual(result.silent, [904])
})

test('时长对齐:名字已经归了别的号就不算命中，挂出来让人裁', () => {
  // 2026-08-24 真撞上的那一课：274 的时长唯一贴合「華の二水戦（インストver）」，
  // 可那个名字已经由提督实听钉在 13 号上了——同一首曲的全长版与游戏内循环
  // 各占一个号是常态，所以这不是矛盾，是歧义，歧义不自动落账。
  const result = joinBgmByDuration({
    tracks: [CALIBRATED_TRACK, { id: 274, seconds: 173.9 }],
    songs: [
      { name: '戦隊を統べる月の花', seconds: 53 },
      { name: '華の二水戦（インストver）', seconds: 173 },
    ],
    calibration: CALIBRATION,
    taken: { ...CALIBRATION_TAKEN, '華の二水戦（インストver）': 13 },
  })
  assert.equal(result.stopped, false)
  // 落账的只有校准那首自己的复核，274 一条没收
  assert.deepEqual(result.matched.map((m) => m.id), [275])
  assert.deepEqual(result.contested, [
    { id: 274, name: '華の二水戦（インストver）', heldBy: 13 },
  ])
})

test('随包的战斗曲曲名表:号在资源路径的取值范围内，且都带得出名字', () => {
  const pack = JSON.parse(
    fs.readFileSync(new URL('../assets/lodes/kcwiki-bgm.json', import.meta.url), 'utf8'),
  )
  assert.equal(pack.data.schemaVersion, 1)
  const entries = Object.entries(pack.data.battle)
  // 2026-08-24 建包基线 97 个号。掉到 80 以下说明上游改版或解析器认错了文件名形状
  assert.ok(entries.length >= 80, `战斗曲曲名只剩 ${entries.length} 个号`)
  for (const [id, name] of entries) {
    // `bgm/battle/NNN_XXXX.mp3` 只有三位数——越界即说明序号被当成了资源号
    assert.match(id, /^\d{1,3}$/, `资源号 ${id} 超出资源路径的取值范围`)
    assert.ok(Number(id) >= 1 && Number(id) <= 999, `资源号 ${id} 越界`)
    assert.ok(name && !name.includes('曲名不明'), `${id} 的曲名是占位串`)
  }
  // 本期活动那几首必须在（api_mst_mapbgm 的 62-x 取 275/276/277，278 同批）。
  // 2026-08-24 又拿 kcwiki「2026年夏季活动」页复核过一遍：那页的播放器挂的也是
  // 游戏原文件名（275_1741 / 276_6374 / 277_2510 / 278_1978 / 279_7311 / 280_9007 /
  // 281_5230），与拆包页逐位相同——**号是从文件名读出来的，不是按曲目顺序数的**。
  // 页上那七行标的时长里，本机缓存量得到的三首也逐首对上（275=53.05s/站方 0:53、
  // 276=82.08s/1:22、277=75.15s/1:15），所以这四个名字挂在这四个号上是对的。
  // 279/280/281 两页都留着空名，照旧只显示编号。
  assert.equal(pack.data.battle['275'], '戦隊を統べる月の花')
  assert.equal(pack.data.battle['276'], '第三十一戦隊駆逐艦の出撃')
  assert.equal(pack.data.battle['277'], '反撃開始、艦隊全艦突入！')
  assert.equal(pack.data.battle['278'], '遠すぎた泊地へ！')
  for (const id of [279, 280, 281]) {
    assert.equal(pack.data.battle[`${id}`], undefined, `${id} 官方还没公布曲名，不许编`)
  }
  // 转写台账落到随包数据上：重抓一次也不许把上游那个错名带回来
  for (const fix of KNOWN_TRANSCRIPTION_FIXES) {
    assert.equal(pack.data.battle[`${fix.id}`], fix.official, `${fix.id} 没按台账改写`)
    assert.notEqual(pack.data.battle[`${fix.id}`], fix.upstream, `${fix.id} 的上游错名回到包里了`)
  }
  // 62-5 的 Boss 昼夜都读这个号（见 shared/event-map-bgm），玩家眼下就看得见这一格
  assert.equal(pack.data.battle['124'], '決戦！北大西洋')
  // 2026-08-24 字形总校揪出的繁体「擊」转写错（109 那笔同日又叠出改题，见下）
  assert.equal(pack.data.battle['136'], '母艦攻撃隊、発艦始め!')
  // 2026-08-24 悬案终审（铭·按号试听，提督逐号实听）三笔：
  // 109 同曲改题采现行 OST 名；152/153 上游整对错位，官推分工＋实听角色互证。
  // 122/123 提督同轮裁定拆包层本来就对，所以不在台账里、这里也不另钉。
  assert.equal(pack.data.battle['109'], '決戦前夜')
  assert.equal(pack.data.battle['152'], '令和桃の節句')
  assert.equal(pack.data.battle['153'], '沖に立つ波')
})

test('曲名里不许出现繁体「擊」——日文官方一律用新字体「撃」', () => {
  // 这是**整层**的判据，不是逐条钉死：2026-08-24 逮到的两笔（109/136）都是
  // 中文平台转写时把「撃」写成「擊」，而这一类错换一个号还会再犯。
  // 日文官方曲名没有一个用「擊」——本包另外那十几个带「撃」的（突撃/迎撃/反撃/攻撃…）
  // 就是自证。所以整层扫一遍比逐条钉更管用。
  const pack = JSON.parse(
    fs.readFileSync(new URL('../assets/lodes/kcwiki-bgm.json', import.meta.url), 'utf8'),
  ).data.battle
  const rows = [
    ...Object.entries(pack).map(([id, name]) => [`battle/${id}`, name]),
    ...HEARD_BGM_NAMES.map((e) => [`耳测 battle/${e.id}`, e.name]),
    ...HEARD_PORT_BGM_NAMES.map((e) => [`耳测 port/${e.id}`, e.name]),
  ]
  for (const [where, name] of rows) {
    assert.ok(!name.includes('擊'), `${where}「${name}」用了繁体「擊」，官方是「撃」`)
  }
  // 反面：这一层确实在用「撃」，所以上面那条不是在扫一个空集合
  assert.ok(rows.filter(([, name]) => name.includes('撃')).length >= 20)
})

// ---------------------------------------------------------------- 按号试听（调试门后）
//
// 这把钥匙最初为 109 / 122 / 123 / 152 / 153 那五桩悬案而造：拆包层与 EN Fandom
// 各说各话，而那五个号不在任何一张现役图上——正式界面里没有能挂 ♪ 的行，没处听。
// 2026-08-24 提督用它逐号听完，五桩全部闭案（判词进了 KNOWN_TRANSCRIPTION_FIXES
// 与 耳测清单-BGM.md 第五节）。钥匙留着：往后再有号源打架，终审还走这条路。
// 三条护栏各钉一件事：发布形态零注入、编号解析、以及**这个口子没有自己的播放路径**。

test('按号试听:发布形态零注入,调试态才生成那张卡', () => {
  const release = mountMgstate({ debugUi: false })
  assert.ok(!release.pane.innerHTML.includes('mg-bgm-probe'), '发布形态里冒出了按号试听的卡')
  assert.ok(!release.pane.innerHTML.includes('mg-bgm-no'), '发布形态里冒出了编号输入框')
  assert.equal(release.probeHtml(), null, '发布形态里那一枚 ♪ 词条不该存在')

  const debug = mountMgstate({ debugUi: true })
  assert.ok(debug.pane.innerHTML.includes('mg-bgm-probe'), '调试态也没有按号试听——门关死了')
  assert.match(debug.pane.innerHTML, /class="mg-bgm-no"[^>]*max="999"/)
  // 一装上就能听：默认号是那五桩悬案里的第一个（109）
  assert.match(debug.probeHtml(), /data-bgm-url="[^"]*bgm\/battle\/109_/)
})

test('按号试听:只认 1–999,越界与非数字一律不给按钮', async () => {
  const mg = mountMgstate({ debugUi: true })
  const placeholder = /填 1–999/
  for (const bad of ['0', '1000', '-5', '', 'abc', '12.5abc']) {
    mg.typeBgmNo(bad)
    assert.match(mg.probeHtml(), placeholder, `${JSON.stringify(bad)} 竟然被当成了合法编号`)
    assert.ok(!mg.probeHtml().includes('data-bgm-url'), `${JSON.stringify(bad)} 还渲染出了可点的按钮`)
  }
  // 两个端点都要收（资源路径就是三位数）
  for (const ok of ['1', '999', '153']) {
    mg.typeBgmNo(ok)
    assert.match(
      mg.probeHtml(),
      new RegExp(`data-bgm-url="[^"]*bgm/battle/${ok.padStart(3, '0')}_`),
      `${ok} 是合法编号却没给出试听地址`,
    )
  }
  // 没碰树的开关时，号一律按**战斗树**解释（默认档），一个也不许自作主张送去母港树
  assert.ok(
    mg.bgmUrlCalls().every(([, kind]) => kind === 'battle'),
    '按号试听把号送去了母港树',
  )
})

test('按号试听:两棵树都听得到,树要自己选,默认仍是战斗树', () => {
  const mg = mountMgstate({ debugUi: true })
  // 默认档是战斗树——那五桩悬案是这把钥匙最初的用处，加了母港档也不许换默认
  assert.match(mg.pane.innerHTML, /class="mg-bgm-tree"/, '没有树的开关')
  assert.equal(mg.bgmTree(), 'battle')
  assert.match(mg.probeHtml(), /data-bgm-url="[^"]*bgm\/battle\/109_/)

  // 切到母港树：同一个框里的号改按母港树解释。103 是画面主题曲，
  // 主数据永远不给名，曲名来自耳测母港层——同一条 bgmSongName，不是这里另写的查表
  mg.pickBgmTree('port')
  mg.typeBgmNo(103)
  assert.match(mg.probeHtml(), /data-bgm-url="[^"]*bgm\/port\/103_/)
  assert.match(mg.probeHtml(), /♪ 海原越えて/)
  assert.ok(
    mg.bgmUrlCalls().some(([id, kind]) => id === 103 && kind === 'port'),
    '母港树那一档根本没被调用',
  )

  // 同一个号切回战斗树是另一首曲——这正是「树必须自己选、程序不许猜」的理由
  mg.pickBgmTree('battle')
  assert.match(mg.probeHtml(), /data-bgm-url="[^"]*bgm\/battle\/103_/)
  assert.match(mg.probeHtml(), /♪ 捷号決戦前夜/)

  // 越界判据两棵树共用一套：切了树也不许把 1000 放进来
  mg.pickBgmTree('port')
  mg.typeBgmNo(1000)
  assert.match(mg.probeHtml(), /填 1–999/)
  assert.ok(!mg.probeHtml().includes('data-bgm-url'))
})

test('按号试听:曲名走那一份收口,播放走既有的那条链,不新开出口', async () => {
  const mg = mountMgstate({
    debugUi: true,
    lodes: { 'kcwiki-bgm': { data: { battle: { 109: '誊写层说的' } } } },
  })
  // 曲名表是异步到的：到之前只写编号（真机上就是这样），到之后补一拍换成曲名
  assert.match(mg.probeHtml(), /♪ #109/)
  assert.match(await mg.settled(), /♪ 誊写层说的/)
  // 誊写层没有的号落到耳测层——同一条 bgmSongName，不是这里另写的一份查表
  mg.typeBgmNo(62)
  assert.match(mg.probeHtml(), /♪ 水底から/)
  // 三层都没有的号如实只报编号，绝不编
  mg.typeBgmNo(280)
  assert.match(mg.probeHtml(), /♪ #280/)

  // 档案实物优先：留下来的那一份是零联网的，词条也该标出来
  const kept = mountMgstate({
    debugUi: true,
    archive: { 'battle/153': 'file:///kanso/bgm/153.mp3' },
  })
  kept.typeBgmNo(153)
  assert.match(kept.probeHtml(), /class="bgm-pv kept" data-bgm-url="file:\/\/\/kanso\/bgm\/153\.mp3"/)
  assert.match(kept.probeHtml(), /档案实物 · 零联网/)

  // 钥里关掉「不联网补取」而档案里又没有：退化成说明文字，不渲染点不响的死按钮。
  // 维护者也该看见玩家看见的那一面，这里不开例外。
  const offline = mountMgstate({ debugUi: true, remoteArt: false })
  offline.typeBgmNo(153)
  assert.ok(!offline.probeHtml().includes('data-bgm-url'), '联不了网还挂了个点不响的按钮')
  assert.match(offline.probeHtml(), /class="bgm-pv muted"/)

  // 「不新开出口」的硬判据：铭自己既不拼试听地址、也不碰 Audio——
  // 那一枚词条是 bgm-preview 拼的，点击由它那条唯一的全局委托接管。
  const panel = fs.readFileSync(new URL('../src/renderer/modules/mgstate.ts', import.meta.url), 'utf8')
  assert.match(panel, /import \{ bgmPreviewHtml \} from '\.\.\/bgm-preview'/)
  assert.ok(!/new Audio\(/.test(panel), '铭里出现了自己的播放器')
  assert.ok(!/data-bgm-url/.test(panel), '铭里自己拼了试听地址，等于绕开那条唯一的播放链')
  assert.ok(!/kcs2\/resources\/bgm/.test(panel), '铭里自己拼了 BGM 资源路径')
  // 那张卡与它的输入委托都在门后（与沉浸特效模拟台同一道门）
  assert.match(panel, /const bgmProbeCardHtml = \(\): string =>\s*\n\s*DEBUG_UI\s*\n\s*\?/)
  assert.match(panel, /if \(DEBUG_UI\) \{[\s\S]{0,800}?classList\.contains\('mg-bgm-no'\)/)
})
