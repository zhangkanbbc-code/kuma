import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import firstEncounter from '../dist/shared/first-encounter.js'
import remodelChainModule from '../dist/shared/ship-remodel-chain.js'

const { buildShipRemodelChains } = remodelChainModule

const {
  buildFirstEncounterIndex,
  emptyFirstEncounterIndex,
  foldFirstEncounter,
  isFirstEncounterHere,
  isTrustedFirstKill,
} = firstEncounter

const encounter = (over = {}) => ({
  ts: 1000,
  map: 64,
  cell: 12,
  isBoss: false,
  comp: [],
  dropMst: null,
  sunkMask: null,
  ...over,
})

test('first drop keeps the earliest sighting no matter what order records arrive in', () => {
  const index = buildFirstEncounterIndex([
    encounter({ ts: 3000, map: 25, cell: 5, dropMst: 200 }),
    encounter({ ts: 1000, map: 64, cell: 12, dropMst: 200, isBoss: true }),
    encounter({ ts: 2000, map: 64, cell: 12, dropMst: 200 }),
  ])
  assert.deepEqual(index.drops[200], {
    mstId: 200,
    ts: 1000,
    map: 64,
    cell: 12,
    isBoss: true,
  })
  // 后到的记录（增量写入路径）不能顶掉更早的那条
  foldFirstEncounter(index, encounter({ ts: 9000, map: 11, cell: 3, dropMst: 200 }))
  assert.equal(index.drops[200].ts, 1000)
  assert.equal(index.drops[200].map, 64)
})

test('battles without a sink mask never count as a first kill', () => {
  // sunk_mask 是后加的列：老记录只知道打过，不知道谁沉了。
  // 若把 null 当成「一艘都没沉」，首杀就会被错记到后面那一场，凭空造出假里程碑。
  const index = buildFirstEncounterIndex([
    encounter({ ts: 1000, comp: [1501, 1502], sunkMask: null }),
    encounter({ ts: 2000, comp: [1501, 1502], sunkMask: 0b01 }),
  ])
  assert.equal(index.kills[1501].ts, 2000)
  assert.equal(index.kills[1502], undefined)
  // 击沉可信起点跟着掩码走，不跟着最早那场遭遇走
  assert.equal(index.dropsFrom, 1000)
  assert.equal(index.killsFrom, 2000)
})

test('sink mask bits line up with the enemy composition slot by slot', () => {
  const index = buildFirstEncounterIndex([
    encounter({ ts: 1000, comp: [1501, 1502, 1503, 1504], sunkMask: 0b1010 }),
  ])
  assert.equal(index.kills[1501], undefined)
  assert.equal(index.kills[1502].ts, 1000)
  assert.equal(index.kills[1503], undefined)
  assert.equal(index.kills[1504].ts, 1000)
})

test('two identical ships sunk in one battle only book the first slot', () => {
  const index = buildFirstEncounterIndex([
    encounter({ ts: 1000, map: 64, cell: 12, comp: [1501, 1501], sunkMask: 0b11 }),
  ])
  assert.equal(Object.keys(index.kills).length, 1)
  assert.equal(index.kills[1501].ts, 1000)
})

test('an empty ledger reports no first-encounter horizon at all', () => {
  const index = emptyFirstEncounterIndex()
  assert.deepEqual(index, {
    drops: {}, kills: {}, dropsFrom: null, killsFrom: null, metSince: {},
  })
  // 起点为 null 时 UI 才知道不能说「账本自 X 起」
  assert.equal(index.dropsFrom, null)
  assert.equal(index.killsFrom, null)
})

test('sortie-side matching needs the same place and a timestamp inside this run', () => {
  const record = { mstId: 200, ts: 5000, map: 64, cell: 12, isBoss: true }
  assert.equal(isFirstEncounterHere(record, 64, 12, 4000), true)
  // 同图不同点 / 同点不同图 / 首见发生在本轮开始之前，都不算眼前这一条
  assert.equal(isFirstEncounterHere(record, 64, 13, 4000), false)
  assert.equal(isFirstEncounterHere(record, 65, 12, 4000), false)
  assert.equal(isFirstEncounterHere(record, 64, 12, 6000), false)
  assert.equal(isFirstEncounterHere(null, 64, 12, 4000), false)
})

test('the badge is withheld unless a real first can be established', () => {
  // 起初只把「账本之前不可知」写进 tooltip，但徽章本身仍在断言「首次」，
  // 玩家不会先悬停——于是一艘早就在手的舰被标了「首次获得」。
  const badge = fs.readFileSync(new URL('../src/renderer/first-encounter.ts', import.meta.url), 'utf8')
  assert.match(badge, /const owned = firstOwnedAt\(mstId\)/)
  assert.match(badge, /isTrustedFirstKill\(index, record\)/)
  assert.match(badge, /确认不了就不标/)
  // 排除不掉的仍要能看到记录，只是不叫首次。
  // 2026-08-26 文案清扫：「记账之前你就已经有它了」那半句记账起点声明缩成
  //「更早的不可知」，「最早的一条」与「不可知」这两个必须说清的口径照钉。
  assert.match(badge, /最早的一条/)
  assert.match(badge, /更早的不可知/)
  // 只钉渲染出去的那句（同样的话在源码注释里说明判据，那是该留的）
  assert.doesNotMatch(badge, /记账之前你就已经有它了/, '记账起点免责句又回到界面上了')
  // 敌我两个标记必须真的不同——符号与配色都不能共用
  assert.match(badge, /kind === 'drop' \? '⚓' : '⚔'/)
  const html =
    fs.readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8') +
    fs.readFileSync(new URL('../src/renderer/assets/battle-replay.css', import.meta.url), 'utf8')
  assert.match(html, /\.first-mark\.drop \{[^}]*color: #8fd0ff/)
  // #ff9fae 已收编为 --abyss-ink（深海亮字 token），语义不变
  assert.match(html, /\.first-mark\.kill \{[^}]*color: var\(--abyss-ink\)/)
})

test('a ship already on hand before the ledger started never counts as a first catch', () => {
  // 用户实测撞出来的：狄风早就在手，却因为「账本里最早的一条」被标成首次获得。
  // 判据现在用铃一直在维护的持有基线——它按谱系、只增不减，拆解也不丢，
  // 首次运行时把当时持有的全部记成 OWNED_BEFORE_LEDGER（时刻不可知）。
  const badge = fs.readFileSync(new URL('../src/renderer/first-encounter.ts', import.meta.url), 'utf8')
  assert.match(badge, /const owned = firstOwnedAt\(mstId\)/)
  assert.match(badge, /if \(owned === OWNED_BEFORE_LEDGER\) return null/)
  assert.match(badge, /return owned >= record\.ts \? record : null/)
  // 从没见过它在手时没有反证，仍然算数（例如捞到就拆）
  assert.match(badge, /if \(owned == null\) return record/)
  // 不再自己查 ship_life_state：那份痕迹在拆解后就没了
  const ledger = fs.readFileSync(new URL('../src/main/mg/ledger.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(ledger, /ownedSince/)
})

test('the owned baseline lives in one place and both consumers read it', () => {
  const shared = fs.readFileSync(new URL('../src/renderer/ship-first-owned.ts', import.meta.url), 'utf8')
  // 三条性质缺一不可：拆解不丢、按谱系、首次运行不误报
  assert.match(shared, /只增不减/)
  assert.match(shared, /export const expandFamilies/)
  assert.match(shared, /const stamp = first \? OWNED_BEFORE_LEDGER : ts/)
  // 旧版铃存的是 number\[\]，读到要迁移成「时刻不可知」
  assert.match(shared, /const LEGACY_KEY = 'lg\.owned'/)
  assert.match(shared, /legacy\.map\(\(id\) => \[id, OWNED_BEFORE_LEDGER\]\)/)
  // 痕迹可能记在改造后的形态上，查询要按谱系回退
  assert.match(shared, /痕迹可能记在同谱系的其他形态上/)

  // 谱系归属走共用那份，不再自己搓并查集：手搓的那版只吃 afterShipId，
  // 原生升级表独有的边整条丢掉，一条谱系被劈成两家 → 同一艘舰的两个形态
  // 各标一次「首次获得」，全局只标一次的口径就破了。
  assert.match(shared, /buildShipRemodelChains\(/)
  assert.doesNotMatch(shared, /const find = |const parent = new Map/)

  const notices = fs.readFileSync(new URL('../src/renderer/modules/lg.ts', import.meta.url), 'utf8')
  assert.match(notices, /const fresh = observeOwnedShips\(\)/)
  assert.match(notices, /if \(fresh\.length\) \{/, '空名单不该发通知')
  // 铃不再自己维护一份并查集与基线
  assert.doesNotMatch(notices, /ensureOwnedFamilyIds|expandOwnedFamilies|ownedBaseline/)
})

test('首见的谱系归属：升级表独有的边也得判成同一族', () => {
  // 上一测是源码钉，判据本身钉成行为：可逆改装（Tuscaloosa 923↔928）双方
  // aftershipid 都是 0，只在 api_mst_shipupgrade 里有条目。手搓 afterShipId 并查集
  // 会把这条链劈成两家——首见志据此判「全局第一次」，劈开后 923 标一次 ⚓、
  // 之后 928 再标一次，同一艘舰的里程碑被发了两遍。
  const upgradeOnly = buildShipRemodelChains(
    [
      { id: 923, sortNo: 923, afterId: 0 },
      { id: 928, sortNo: 928, afterId: 0 },
    ],
    [{ targetId: 928, currentShipId: 923, originalShipId: 923, stage: 1 }],
  )
  assert.equal(upgradeOnly.rootOf.get(928), upgradeOnly.rootOf.get(923), '两个形态必须同族')
  // expandFamilies 拿 chainOf 把「刚入手的形态」摊成整条谱系：两头进都得摊出两个
  assert.deepEqual(upgradeOnly.chainOf.get(upgradeOnly.rootOf.get(923)), [923, 928])
  assert.deepEqual(upgradeOnly.chainOf.get(upgradeOnly.rootOf.get(928)), [923, 928])

  // aftershipid 独有的边一样不许丢（两类边都在，才叫「一条谱系只标一次」）
  const aftershipOnly = buildShipRemodelChains(
    [
      { id: 501, sortNo: 1, afterId: 502 },
      { id: 502, sortNo: 2, afterId: 0 },
    ],
    [],
  )
  assert.equal(aftershipOnly.rootOf.get(502), aftershipOnly.rootOf.get(501))
  assert.deepEqual(aftershipOnly.chainOf.get(aftershipOnly.rootOf.get(501)), [501, 502])
})

test('a first kill needs the sink mask to have covered every prior meeting', () => {
  const record = { mstId: 1501, ts: 9000, map: 64, cell: 12, isBoss: true }
  const base = { ...emptyFirstEncounterIndex(), kills: { 1501: record }, killsFrom: 8000 }
  // 掩码上线前就遇到过 → 那几场谁沉了不可知，这条「最早」不作数
  assert.equal(isTrustedFirstKill({ ...base, metSince: { 1501: 3000 } }, record), false)
  // 第一次遇到它时掩码已经在记 → 首杀可信
  assert.equal(isTrustedFirstKill({ ...base, metSince: { 1501: 8500 } }, record), true)
  // 压根没有可用的掩码起点 → 什么都不敢说
  assert.equal(isTrustedFirstKill({ ...base, killsFrom: null }, record), false)
})

test('sink-mask-less battles stay excluded on the write side too', () => {
  // 遭遇志写入端与任务计数共用真实击沉口径，演习不入志。
  const chronicle = fs.readFileSync(new URL('../src/main/mg/chronicle.ts', import.meta.url), 'utf8')
  assert.match(chronicle, /isEnemyReallySunk\(ship\) \? mask \| \(1 << i\) : mask/)
  const combat = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  assert.match(combat, /const firstKillMarkOf[\s\S]*?if \(b\.practice \|\| s\.practice \|\| b\.kind === 'baseDefense'\) return \(\) => ''/)
  assert.match(combat, /const firstKillMarkOf[\s\S]*?if \(!ship\.sunk \|\| marked\.has\(ship\.mstId\)\) return ''/)
})

test('malformed rows are skipped instead of poisoning the index', () => {
  const index = buildFirstEncounterIndex([
    encounter({ ts: Number.NaN, dropMst: 200 }),
    encounter({ ts: 1000, comp: [0, -1, 1501], sunkMask: 0b111 }),
  ])
  assert.equal(index.drops[200], undefined)
  assert.equal(index.kills[0], undefined)
  assert.equal(index.kills[-1], undefined)
  assert.equal(index.kills[1501].ts, 1000)
})
