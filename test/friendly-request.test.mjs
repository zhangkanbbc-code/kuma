// 友军要請：状态怎么进账本，以及镝的夜战阻断条怎么因它改口。
//
// 机制（wikiwiki 友軍艦隊页，2026-08-26 查证）：友军夜战**先行**，
// 「一連の攻撃後に敵艦隊の状況が判定され」——打完之后重新判定交战对象。
// 所以友军把残余护卫扫掉，本队夜战就直接对上敌一队；而夜战交战对象的判别式读的是
// 友军介入**前**的状态，此刻照原样劝「省弹药 / 撤退」会让玩家白白放弃能翻的那一场。
//
// 两侧都测真代码：reducer 走切片编译（不许 import store.ts，那会开用户真账本），
// 横幅走 fixtures/render-di-battle.mjs 的真编译产物。
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  friendlyRequest,
  reset,
  restart,
  setFriendlyRequest,
  setFriendlyRequestRaw,
} from './fixtures/store-friendly-request.mjs'
import {
  battleOf,
  renderBlockedBossNight,
  setFriendlyRequest as stageFriendlyRequest,
  shipOf,
  sortieOf,
} from './fixtures/render-di-battle.mjs'

// ---- 账本这一侧 ----

test('没收到过这条报文时字段缺席 —— 那是「未知」，不是「关」', () => {
  reset()
  assert.equal(friendlyRequest(), undefined)
})

test('两次切换取末次值（本机账本 18:39 強力 → 18:47 通常 那两条的形状）', () => {
  reset()
  assert.deepEqual(setFriendlyRequest(1, 1), ['friendlyRequest'])
  assert.deepEqual(friendlyRequest(), { flag: 1, type: 1 })
  // 第二条同端点报文必须覆盖，不是合并、也不是只认第一条
  assert.deepEqual(setFriendlyRequest(1, 0), ['friendlyRequest'])
  assert.deepEqual(friendlyRequest(), { flag: 1, type: 0 })
})

test('post 参数是数字字符串，落账要转成数（字符串 "1" 过不了 === 1）', () => {
  reset()
  setFriendlyRequest(1, 0)
  assert.equal(typeof friendlyRequest().flag, 'number')
  assert.equal(typeof friendlyRequest().type, 'number')
})

test('参数缺席或不是数：什么都不动，宁可留着「未知」', () => {
  reset()
  assert.deepEqual(setFriendlyRequestRaw({}), [])
  assert.equal(friendlyRequest(), undefined)
  assert.deepEqual(setFriendlyRequestRaw({ api_request_flag: 'x', api_request_type: 'y' }), [])
  assert.equal(friendlyRequest(), undefined)
})

test('快照往返：关机再开还认得住要請状态', () => {
  reset()
  setFriendlyRequest(1, 1)
  const persisted = restart()
  assert.deepEqual(persisted.friendlyRequest, { flag: 1, type: 1 })
  assert.deepEqual(friendlyRequest(), { flag: 1, type: 1 })
})

test('快照往返：没观测过的仍然是缺席，不许被回灌成 flag 0', () => {
  reset()
  const persisted = restart()
  // JSON 序列化会把 undefined 的键整个丢掉，这正是我们要的「未知」
  assert.equal('friendlyRequest' in persisted, false)
  assert.equal(friendlyRequest(), undefined)
})

// ---- 横幅这一侧 ----

/** Boss 格、昼战刚打完、battleresult 还没到，且二队仍有战力 —— 判别式判 'escort'。 */
const blockedAt = (mapArea) => {
  const main = Array.from({ length: 6 }, (_, i) => ({
    ...shipOf(i, `敌舰${i + 1}`),
    fleet: 'main',
    position: i,
    hpEnd: i === 0 ? 100 : 50,
    hpMax: 100,
    name: i === 0 ? '戦艦棲姫' : `敌舰${i + 1}`,
  }))
  const escort = [0, 1, 2].map((i) => ({
    ...shipOf(6 + i, `护卫${i + 1}`),
    fleet: 'escort',
    position: i,
    hpEnd: 100,
    hpMax: 100,
    name: `护卫${i + 1}`,
  }))
  return sortieOf({
    mapArea,
    mapNo: 3,
    bossCell: 3,
    currentCell: 3,
    nodes: [{ cell: 3, eventId: 5 }],
    battle: battleOf({ kind: 'day', hasNight: false, result: null, eShips: [...main, ...escort] }),
  })
}

const NEW_LINE = '已开启友军请求 · 友军先清理残余'

test('活动图 + 要請已开：副行改说友军，角标换成「友军先行」', () => {
  stageFriendlyRequest({ flag: 1, type: 0 })
  const html = renderBlockedBossNight(blockedAt(46))
  assert.match(html, new RegExp(NEW_LINE))
  assert.match(html, /友军先行<\/span>/)
  // 标题一律不动：改的是副行与角标
  assert.match(html, /敌护卫仍有战力 · 夜战预估无法攻击 戦艦棲姫/)
  assert.equal(/夜战将消耗弹药/.test(html), false)
  assert.equal(/撤退可用/.test(html), false)
})

test('要請未开：维持原文案', () => {
  stageFriendlyRequest({ flag: 0, type: 0 })
  const html = renderBlockedBossNight(blockedAt(46))
  assert.match(html, /夜战将消耗弹药/)
  assert.match(html, /撤退可用<\/span>/)
  assert.equal(html.includes(NEW_LINE), false)
})

test('要請状态未知：也维持原文案 —— 少说不错说', () => {
  stageFriendlyRequest(null)
  const html = renderBlockedBossNight(blockedAt(46))
  assert.match(html, /夜战将消耗弹药/)
  assert.match(html, /撤退可用<\/span>/)
  assert.equal(html.includes(NEW_LINE), false)
})

test('常规图即便要請开着也不提友军：那是活动海域限定的机制', () => {
  stageFriendlyRequest({ flag: 1, type: 0 })
  const html = renderBlockedBossNight(blockedAt(5))
  assert.match(html, /夜战将消耗弹药/)
  assert.match(html, /撤退可用<\/span>/)
  assert.equal(html.includes(NEW_LINE), false)
})

test('判别式判「打得到旗舰」时不受要請影响：那一支本来就在劝进夜战', () => {
  stageFriendlyRequest({ flag: 1, type: 0 })
  const s = blockedAt(46)
  // 二队只剩两艘大破 → 判别式判 'main'，走的是 v-cyan 那一支
  s.battle.eShips = s.battle.eShips.filter((ship) => ship.fleet === 'main').concat(
    [0, 1].map((i) => ({
      ...shipOf(6 + i, `护卫${i + 1}`),
      fleet: 'escort',
      position: i,
      hpEnd: 20,
      hpMax: 100,
      name: `护卫${i + 1}`,
    })),
  )
  const html = renderBlockedBossNight(s)
  assert.match(html, /敌护卫已残破 · 夜战预估可攻击 戦艦棲姫/)
  assert.match(html, /夜战机会<\/span>/)
  assert.equal(html.includes(NEW_LINE), false)
})
