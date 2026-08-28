// 远征 / 入渠 / 建造的倒计时能不能熬过一次重启。
//
// 用户报的症状是「每次重启艦素，**总有一两支**舰队的远征倒计时没了，其余还在」。
// 「一两支」这三个字正是线索：decks 此前确实会恢复，只不过恢复的是
// **最后一次 api_port/port 那一刻的定格**——回港之后才从远征页派出去的那几支，
// 游戏不会再发一次 port，落盘清单里又没有 decks，于是它们无处可存。
//
// 实证（用户机账本，2026-08-27 22:37 那次重启）：
//   22:11:20  api_port/port          ← 定格：第 3 队在远征（38 号，完成 00:31）
//   22:11:25  api_req_mission/start  ← 第 4 队派出（2 号，完成 22:41）
//   22:11:26  api_get_member/deck    ← 3/4 两队都在远征
//   22:37:17  重启
// 重启后第 3 队的倒计时还在（port 快照带回来的），第 4 队没了。
// 这一族用例就是钉住这个差别的：下面第一条如果因为「decks 又被从落盘清单里拿掉」
// 而回到旧行为，它会直接红。
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  coldBoot,
  deckOf,
  decks,
  domainSnapshot,
  expeditionChipClass,
  expeditionChipCds,
  expeditionChipLabel,
  hydrateFromDomain,
  kdocks,
  memberDeck,
  memberKdock,
  memberNdock,
  missionResult,
  missionStart,
  ndocks,
  rawDeck,
  rawKdock,
  rawNdock,
  renderBuildDocks,
  renderDocks,
  renderExpeditions,
  replayPortSnapshot,
  replayRequireInfo,
  syncToRenderer,
  wouldPersist,
} from './fixtures/store-fleet-restart.mjs'

const MIN = 60_000
const HOUR = 60 * MIN

/** 用户机那一局的形状：回港时第 3 队已在远征，回港后第 4 队才派出去。 */
const playTheEvening = (now) => {
  const deck3Done = now + 2 * HOUR + 20 * MIN
  const deck4Done = now + 30 * MIN
  // ① 回港：port 报文带回四支队，只有第 3 队在远征。这一份同时被写进 port 原始快照。
  const portDecks = [
    rawDeck(1, { ships: [11, 12] }),
    rawDeck(2, { ships: [21] }),
    rawDeck(3, { mission: [1, 38, deck3Done, 0], ships: [31, 32] }),
    rawDeck(4, { ships: [41, 42] }),
  ]
  memberDeck(portDecks)
  // ② 五秒后玩家进远征页，把第 4 队也派出去。游戏**不会**再发一次 port。
  assert.deepEqual(missionStart(4, 2, deck4Done), ['decks'])
  return { portDecks, deck3Done, deck4Done }
}

test('回港之后才派出去的那一支：只回放 port 快照必丢，这正是「每次丢一两支」的来源', () => {
  coldBoot()
  const now = Date.now()
  const { portDecks, deck3Done, deck4Done } = playTheEvening(now)
  assert.deepEqual(deckOf(3).mission, [1, 38, deck3Done, 0])
  assert.deepEqual(deckOf(4).mission, [1, 2, deck4Done, 0])

  // 关机（领域快照冲刷）
  const persisted = domainSnapshot()

  // ---- 旧通道：重启后只回放 port 原始快照 ----
  coldBoot()
  replayPortSnapshot({ decks: portDecks })
  assert.deepEqual(deckOf(3).mission, [1, 38, deck3Done, 0], '定格时就在远征的那支活得下来')
  assert.deepEqual(
    deckOf(4).mission,
    [0, 0, 0, 0],
    '定格之后才派出去的那支就是这么没的——港快照里她本来就没在远征',
  )

  // ---- 新通道：port 快照回放完，再按更新的时间戳回灌领域快照 ----
  coldBoot()
  replayPortSnapshot({ decks: portDecks })
  hydrateFromDomain(persisted)
  assert.deepEqual(deckOf(3).mission, [1, 38, deck3Done, 0])
  assert.deepEqual(deckOf(4).mission, [1, 2, deck4Done, 0], '这一支现在也留得住了')
})

test('改到这三样的报文一到就得排落盘 —— reducer 报的 section 与落盘清单必须对得上', () => {
  coldBoot()
  memberDeck([rawDeck(1), rawDeck(2), rawDeck(3), rawDeck(4)])
  // 左边是**真 reducer 的返回值**，右边是**真 DOMAIN_SECTIONS**。
  // 任一头改了名字或漏了一项，这条就红——比拿正则去比对源码文本靠得住。
  assert.ok(wouldPersist(missionStart(4, 2, Date.now() + HOUR)), '远征派出后必须落盘')
  assert.ok(wouldPersist(memberNdock([rawNdock(1)])), '入渠状态变了必须落盘')
  assert.ok(wouldPersist(memberKdock([rawKdock(1)])), '建造坞状态变了必须落盘')
  assert.ok(wouldPersist(memberDeck([rawDeck(1)])), '编成整份换了必须落盘')
  assert.ok(wouldPersist(missionResult(1)), '远征收了也得落盘，否则重启又冒出个假倒计时')
})

test('落盘清单里必须真的带着母港舰队三件套（少一样就又开始丢倒计时）', () => {
  coldBoot()
  memberDeck([rawDeck(1, { mission: [1, 5, Date.now() + HOUR, 0] })])
  memberNdock([rawNdock(1, { shipId: 77, completeTime: Date.now() + HOUR, state: 1 })])
  memberKdock([rawKdock(1, { state: 2, completeTime: Date.now() + HOUR, fuel: 30 })])
  const persisted = domainSnapshot()
  for (const key of ['decks', 'ndocks', 'kdocks']) {
    assert.ok(Array.isArray(persisted[key]), `domainSnapshot 少了 ${key}，重启后这一样又会退回定格`)
  }
})

test('入渠：定格之后开的渠也熬得过重启，完成时刻一分不差', () => {
  coldBoot()
  const done = Date.now() + 40 * MIN
  // 回港时四个渠都空
  const portNdocks = [1, 2, 3, 4].map((id) => rawNdock(id))
  memberNdock(portNdocks)
  // 回港后才把 77 号送进第 2 渠
  memberNdock([
    rawNdock(1),
    rawNdock(2, { shipId: 77, completeTime: done, state: 1 }),
    rawNdock(3),
    rawNdock(4),
  ])
  const persisted = domainSnapshot()

  coldBoot()
  replayPortSnapshot({ ndocks: portNdocks })
  assert.equal(ndocks().find((d) => d.id === 2).shipId, 0, '旧通道：这条渠在港快照里是空的')

  hydrateFromDomain(persisted)
  const dock = ndocks().find((d) => d.id === 2)
  assert.equal(dock.shipId, 77)
  assert.equal(dock.completeTime, done, '完成时刻是绝对戳，回灌后倒计时天然还是对的')
  assert.equal(dock.state, 1)
})

test('建造：定格之后开的坞也熬得过重启（kdock 此前只靠登录时那份 require_info）', () => {
  coldBoot()
  const done = Date.now() + 3 * HOUR
  // 登录那一刻四个坞：1 号锁着，其余空
  const loginKdocks = [
    rawKdock(1, { state: -1 }),
    rawKdock(2),
    rawKdock(3),
    rawKdock(4),
  ]
  memberKdock(loginKdocks)
  // 登录后才开的大型建造
  memberKdock([
    rawKdock(1, { state: -1 }),
    rawKdock(2, { state: 2, completeTime: done, fuel: 4000 }),
    rawKdock(3),
    rawKdock(4),
  ])
  const persisted = domainSnapshot()

  coldBoot()
  replayRequireInfo(loginKdocks)
  assert.equal(kdocks().find((d) => d.id === 2).state, 0, '旧通道：登录快照里这个坞还是空的')

  hydrateFromDomain(persisted)
  const dock = kdocks().find((d) => d.id === 2)
  assert.equal(dock.state, 2)
  assert.equal(dock.completeTime, done)
  assert.equal(dock.recipeFuel, 4000, '燃料投入要跟着走：大型/通常的判据全靠它')
})

test('回灌之后顶栏第一帧就是倒计时芯片，不是「等待同步」', () => {
  coldBoot()
  const now = Date.now()
  const { deck3Done, deck4Done } = playTheEvening(now)
  const persisted = domainSnapshot()

  // 冷启动、什么都没回灌时，顶栏本来就该说「等待同步」
  coldBoot()
  assert.match(renderExpeditions(), /等待同步/)

  hydrateFromDomain(persisted)
  const html = renderExpeditions()
  assert.doesNotMatch(html, /等待同步/, '回灌之后不该再有「等待同步」')
  // 芯片挂的绝对完成时刻就是每秒 updateCountdowns 读的那个数
  assert.equal(expeditionChipCds(3), deck3Done)
  assert.equal(expeditionChipCds(4), deck4Done)
  assert.match(expeditionChipClass(4), /\bon\b/, '在外的队要戴「on」')
  // 真的 fmtCountdownShort：30 分钟后返港 → 「30分」
  assert.equal(expeditionChipLabel(4), '30分')
  assert.equal(expeditionChipLabel(3), '2:20')
  // 第 2 队没派出去，仍是空闲——回灌不许把没在远征的说成在远征
  assert.equal(expeditionChipLabel(2), '空闲')
})

test('已返港未收的那支：回灌后照实显示「返港」，不是凭空复活一段倒计时', () => {
  coldBoot()
  const done = Date.now() - 10 * MIN // 艦素关着的时候就到点了
  memberDeck([rawDeck(1), rawDeck(2), rawDeck(3, { mission: [1, 38, done, 0] }), rawDeck(4)])
  const persisted = domainSnapshot()

  coldBoot()
  hydrateFromDomain(persisted)
  // 游戏那头确实还没收——这一格就该显示「已返港，去港口收」，不是清空
  assert.equal(deckOf(3).mission[2], done)
  assert.equal(expeditionChipLabel(3), '返港')
  assert.match(expeditionChipClass(3), /\bback\b/)
})

test('顶栏入渠 / 建造两格同样在回灌后就有内容', () => {
  coldBoot()
  const done = Date.now() + 45 * MIN
  memberNdock([rawNdock(1, { shipId: 77, completeTime: done, state: 1 }), rawNdock(2)])
  memberKdock([rawKdock(1, { state: 2, completeTime: done, fuel: 30 }), rawKdock(2)])
  const persisted = domainSnapshot()

  coldBoot()
  assert.match(renderDocks(), /等待同步/)
  assert.equal(renderBuildDocks(), '', '一个坞都没有时建造那格整段不出现')

  hydrateFromDomain(persisted)
  assert.doesNotMatch(renderDocks(), /等待同步/)
  assert.match(renderDocks(), new RegExp(`data-cds="${done}"`))
  assert.match(renderBuildDocks(), new RegExp(`data-cds="${done}"`))
})

test('下一个权威报文整份盖回来：回灌的值不许赖着不走', () => {
  coldBoot()
  const now = Date.now()
  playTheEvening(now)
  const persisted = domainSnapshot()

  coldBoot()
  hydrateFromDomain(persisted)
  assert.equal(deckOf(4).mission[0], 1)

  // 艦素关着的时候玩家在游戏里把第 4 队收了、又把第 2 队派出去了。
  // 重启后第一份权威编成一到，两边都得按游戏说的算。
  const fresh = now + 5 * MIN
  memberDeck([
    rawDeck(1),
    rawDeck(2, { mission: [1, 6, fresh + HOUR, 0] }),
    rawDeck(3, { mission: [1, 38, now + 2 * HOUR, 0] }),
    rawDeck(4),
  ])
  syncToRenderer()
  assert.deepEqual(deckOf(4).mission, [0, 0, 0, 0], '游戏说她回来了，就是回来了')
  assert.equal(deckOf(2).mission[1], 6, '游戏说第 2 队出去了，回灌的旧「空闲」不许盖回去')
  assert.equal(expeditionChipLabel(4), '空闲')

  // 入渠 / 建造同理
  memberNdock([rawNdock(1), rawNdock(2)])
  assert.equal(ndocks().every((d) => d.shipId === 0), true)
  memberKdock([rawKdock(1), rawKdock(2)])
  assert.equal(kdocks().every((d) => d.state === 0), true)
})

test('旧快照里没有这三个键：保持原样，不许被回灌成空', () => {
  coldBoot()
  const done = Date.now() + HOUR
  memberDeck([rawDeck(1, { mission: [1, 5, done, 0] })])
  memberNdock([rawNdock(1, { shipId: 9, completeTime: done, state: 1 })])
  memberKdock([rawKdock(1, { state: 2, completeTime: done })])
  // 升级前写下的 domain.json 长这样：这三个键根本不存在
  hydrateFromDomain({ quests: {}, useitems: {} })
  assert.equal(decks().length, 1)
  assert.deepEqual(deckOf(1).mission, [1, 5, done, 0])
  assert.equal(ndocks()[0].shipId, 9)
  assert.equal(kdocks()[0].state, 2)
})
