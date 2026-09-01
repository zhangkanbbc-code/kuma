// 图鉴衣装归属的护栏。
//
// 盯的是「写反了也不报错」那一类：把村雨改（244，一艘真实形态）当成一套衣装挂到
// 村雨底下，界面照样画得出来，只是那一格永远是错的舰；把装备图鉴（同一个端点）
// 的条目当成舰船条目收进来，会凭空多出一堆归属不明的「衣装」。
// 所以判据全部真调用纯函数，用**真实报文形状**当样本（取自本机账本里那几份
// picture_book：村雨 No.81 / 村雨改二 No.298 / 装备图鉴的条目形状）。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import costume from '../dist/shared/ship-costume.js'
import artPlan from '../dist/shared/art-archive-plan.js'

const {
  costumeOwnerOf,
  mergeShipCostumes,
  parsePictureBookCostumes,
  sanitizeShipCostumeMap,
  shipCostumeIndex,
} = costume
const { artArchiveUsage } = artPlan

// 主数据里真实存在的那些形态（样本取自本机 api_mst_ship：44 村雨、244 村雨改、
// 498 村雨改二、497 白露改二、42 白露、242 白露改；5xxx/6xxx 一个都不在里面）
const SHIP_IDS = new Set([42, 44, 242, 244, 497, 498])
const isShipMstId = (id) => SHIP_IDS.has(id)

/** 真实报文形状：舰船图鉴（api_type=1）的一条 */
const shipEntry = (indexNo, name, tableId) => ({
  api_index_no: indexNo,
  api_state: tableId.map(() => [1, 1, 0, 0, 0]),
  api_table_id: tableId,
  api_name: name,
  api_stype: 2,
})

const MURASAME = shipEntry(81, '村雨', [44, 244, 5191, 5201, 5226, 5309, 5478, 6023])
const MURASAME_K2 = shipEntry(298, '村雨改二', [498, 5310, 5403, 5479, 6024])
const SHIRATSUYU_K2 = shipEntry(297, '白露改二', [497, 5359, 5447])
/** 装备图鉴（api_type=2）走**同一个端点**，条目的 api_table_id 是装备 id */
const EQUIP_ENTRY = {
  api_index_no: 3,
  api_state: [1, 0, 0, 0, 0],
  api_table_id: [3],
  api_name: '10cm連装高角砲',
  api_type: [1, 1, 1, 1],
}

const book = (...list) => ({ api_list: list })

test('衣装是「不在主数据里的那几个号」，真实改造形态不许被当成衣装', () => {
  const learned = parsePictureBookCostumes(book(MURASAME_K2), isShipMstId)
  assert.deepEqual(
    learned.map((entry) => entry.graphId),
    [5310, 5403, 5479, 6024],
  )
  assert.deepEqual(learned[0].owners, [498])

  // 村雨那条打头的是 44 与 244 两个**真实形态**。按「第一个之后都是衣装」判的话，
  // 244 村雨改会被记成一套衣装挂到村雨底下——画得出来、就是错的舰。
  const both = parsePictureBookCostumes(book(MURASAME), isShipMstId)
  assert.deepEqual(
    both.map((entry) => entry.graphId),
    [5191, 5201, 5226, 5309, 5478, 6023],
  )
  assert.ok(
    !both.some((entry) => entry.graphId === 244),
    '244 村雨改是主数据里的真实形态，不是一套衣装',
  )
  // 一条图鉴条目覆盖两个形态时，衣装归属两个都算——报文没有再往下细分
  assert.deepEqual(both[0].owners, [44, 244])
})

test('装备图鉴走同一个端点：它的条目一条都不许被收成衣装', () => {
  assert.deepEqual(parsePictureBookCostumes(book(EQUIP_ENTRY), isShipMstId), [])
  // 与舰船条目混在一份报文里时也只收舰船那一半
  const mixed = parsePictureBookCostumes(book(EQUIP_ENTRY, SHIRATSUYU_K2), isShipMstId)
  assert.deepEqual(
    mixed.map((entry) => entry.graphId),
    [5359, 5447],
  )
})

test('主数据还没到位时一条都不学，而不是把整条 api_table_id 当成衣装', () => {
  // 判据必须来自主数据。给不出判据时宁可这一次学不到——
  // 把 44/244/498 全记成衣装，界面会把三艘真实形态摆成「谁的衣装」。
  assert.deepEqual(parsePictureBookCostumes(book(MURASAME, MURASAME_K2), () => false), [])
})

test('形状不对的报文一律落空，不抛异常', () => {
  for (const bad of [null, undefined, {}, { api_list: null }, { api_list: [null, 1, 'x'] }]) {
    assert.deepEqual(parsePictureBookCostumes(bad, isShipMstId), [])
  }
  // 整包（带 api_data 外壳）与剥好的 api_data 两种都收
  const wrapped = parsePictureBookCostumes({ api_data: book(SHIRATSUYU_K2) }, isShipMstId)
  assert.equal(wrapped.length, 2)
})

test('并表只在真变了的时候算变化：同一份报文再来一遍是空操作', () => {
  const map = {}
  const learned = parsePictureBookCostumes(book(MURASAME_K2), isShipMstId)
  assert.equal(mergeShipCostumes(map, learned), 4)
  assert.equal(mergeShipCostumes(map, learned), 0, '同一份报文重放不该被当成新归属')
  // 归属集合变大（同一套衣装又在另一个形态的条目里露面）算变化
  assert.equal(mergeShipCostumes(map, [{ graphId: 5310, owners: [497] }]), 1)
  assert.deepEqual(map['5310'], [497, 498])
})

test('落盘那份不裸信：号与归属都收敛，认不出的整条丢掉', () => {
  const clean = sanitizeShipCostumeMap({
    5310: [498],
    '5403': ['498', 498, 0, -1],
    0: [498], // 号不合法
    abc: [498], // 号不合法
    5479: [], // 没有归属
    5480: 'nope',
  })
  assert.deepEqual(clean, { 5310: [498], 5403: [498] })
  assert.deepEqual(sanitizeShipCostumeMap(null), {})
  assert.deepEqual(sanitizeShipCostumeMap('x'), {})
})

test('按舰查衣装：一套衣装可以同时挂在同一条图鉴条目的几个形态下', () => {
  const map = {}
  mergeShipCostumes(map, parsePictureBookCostumes(book(MURASAME, MURASAME_K2), isShipMstId))
  const index = shipCostumeIndex(map)
  assert.deepEqual(index.get(498), [5310, 5403, 5479, 6024])
  assert.deepEqual(index.get(44), [5191, 5201, 5226, 5309, 5478, 6023])
  assert.deepEqual(index.get(244), [5191, 5201, 5226, 5309, 5478, 6023])
  assert.equal(index.get(497), undefined, '没学到的舰就是没有，不该凭空长出衣装')
})

test('统计口径：衣装归到舰，不许被数成一艘新舰娘', () => {
  const map = {}
  mergeShipCostumes(map, parsePictureBookCostumes(book(MURASAME_K2), isShipMstId))
  assert.equal(costumeOwnerOf(map, 5310), 498)
  // 没学到归属的照旧算它自己：如实，不猜
  assert.equal(costumeOwnerOf(map, 5359), 5359)

  const entry = (mstId, type, sha1) => ({
    pathname: `/kcs2/resources/ship/${type}/${`${mstId}`.padStart(4, '0')}_1234.png`,
    mstId,
    type,
    version: '61',
    sha1,
    bytes: 500_000,
    firstSeen: 1_000,
    lastSeen: 2_000,
    seen: 1,
  })
  const entries = [
    entry(498, 'character_full', 'a'.repeat(16)),
    entry(5310, 'character_full', 'b'.repeat(16)),
    entry(5403, 'character_full', 'c'.repeat(16)),
  ]
  // 不换算：村雨改二 + 她的两套衣装 = 「三个形态」，多出来的两个是幽灵编号
  assert.equal(artArchiveUsage(entries, 0).forms, 3)
  assert.equal(
    artArchiveUsage(entries, 0, (mstId) => costumeOwnerOf(map, mstId)).forms,
    1,
    '衣装被数成了新舰娘',
  )
})

// ============================ 接线守卫 ============================
//
// 上面那些是纯函数，写对了也可能**没人调用**。这一节只兜住调用点：
// 判据落在源码文本上，弱，但它守的恰恰是「整条链断在哪一环」这种断不了的事
//（逻辑本身的对错已经由上面那几条真跑过一遍，见共享记忆
//  source-pattern-guards-miss-logic-bugs 说的分工）。
const src = (rel) => fs.readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8')

test('归属只从游戏自己返回的报文里学，两条进货渠道都接上了', () => {
  const mg = src('main/mg/index.ts')
  // ① 实时：玩家正在翻图鉴
  assert.match(mg, /apiPath === '\/kcsapi\/api_get_member\/picture_book'\) learnCostumesFrom\(body\)/)
  // ② 回灌：账本里已经存着的那些报文（游标推进，扫过的不再扫）
  assert.match(mg, /ledger\.queryPictureBookBodies\(shipCostumeBackfillCursor\(\)\)/)
  assert.match(mg, /noteShipCostumeBackfill\(lastId\)/)
  // 分界线必须来自主数据，不许在这里另写一个号段规则
  assert.match(mg, /rememberPictureBookCostumes\([^)]*isShipMstId\)/)
  assert.equal(
    /costume[\s\S]{0,400}?(mstId|id)\s*>=?\s*5000/.test(mg),
    false,
    'mg 里自己写了一条「≥5000 就是衣装」的号段规则——判据只许来自主数据',
  )
  // 这一路**绝不发请求**：只解析报文，别在这里出现取图/取字节的调用
  const backfill = mg.slice(
    mg.indexOf('const backfillShipCostumes'),
    mg.indexOf('setTimeout(backfillShipCostumes'),
  )
  assert.equal(/fetch\(|net\.|http/.test(backfill), false, '回灌那一段碰了网络')
})

test('衣装归属是玩家的东西：缓存急救的保住名单里有它', () => {
  const yu = src('main/yu.ts')
  const preserved = /export const PRESERVED_ENTRIES = (\[[\s\S]*?\n\])/.exec(yu)
  assert.ok(preserved, '保住名单必须是可解析的字面量数组')
  const keep = JSON.parse(
    preserved[1]
      .replace(/\/\/[^\n]*/g, '')
      .replace(/,(\s*])/g, '$1')
      .replace(/'/g, '"'),
  )
  assert.ok(keep.includes('ship-costumes.json'), '衣装归属表不在保住名单里')
})

test('立绘页真的摆了衣装段，且排在本体之后、档案旧版之前', () => {
  const ji = src('renderer/modules/ji.ts')
  assert.match(ji, /const costumes = costumeCellsHtml\(mstId\)/)
  assert.match(ji, /<div class="cg-grid" data-cg-grid>\$\{cells\}\$\{costumes\.html\}\$\{archived\}<\/div>/)
  // 衣装格带入档身份与**自己那套**的版号：透传本体版号会让归因串到另一张图上
  const section = ji.slice(ji.indexOf('const costumeCellsHtml'), ji.indexOf('const archivedArtCellsHtml'))
  assert.match(section, /shipImageVersionOf\(graphId\)/)
  assert.equal(
    /shipImageVersionOf\(mstId\)/.test(section),
    false,
    '衣装格透传了本体的版号',
  )
  assert.match(section, /data-cg-path="\$\{esc\(im\.pathname\)\}"/)
})

test('取图回退链与「本机有没有」的判据是同一句话', () => {
  const kcs = src('renderer/kcs-image.ts')
  // 三档顺序：本地缓存 → 档案实物 → 远端
  const chain = kcs.slice(kcs.indexOf('export const shipImageUrl'), kcs.indexOf('export const noteShipArtDisplayed'))
  const cacheAt = chain.indexOf('cachedFile(pathname)')
  const archiveAt = chain.indexOf('archivedArtUrlForPath(pathname)')
  const remoteAt = chain.indexOf('remoteUrl(pathname)')
  assert.ok(cacheAt >= 0 && archiveAt >= 0 && remoteAt >= 0, '回退链少了一档')
  assert.ok(cacheAt < archiveAt && archiveAt < remoteAt, '回退链的顺序反了')
  // 「缺哪些」必须问同一句话，不然屏幕上会摆一句与眼前的图矛盾的话
  assert.match(kcs, /return cachedFile\(pathname\) \?\? archivedArtUrlForPath\(pathname\)/)
  assert.match(kcs, /missingShipImages[\s\S]{0,200}?!localShipImage\(mstId, type, damaged\)/)
})
