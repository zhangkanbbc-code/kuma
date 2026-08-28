import assert from 'node:assert/strict'
import test from 'node:test'

import {
  EVENT_COMP_CONFLICT_NOTES,
  EVENT_SOURCE_QUALITY,
  KCNAV_WITNESSED_COMPS,
  KNOWN_ABYSSAL_LABEL_FIXES,
  RESOLVED_EVENT_COMP_CONFLICTS,
  eventCompWitnessKey,
  staleKcnavWitnesses,
  abyssalJoinKey,
  applyAbyssalLabelFixes,
  buildNodeAlignment,
  compConfigKey,
  compJoinKey,
  eventCompConflictFingerprint,
  eventCompCorroborationOf,
  eventDropCorroborationOf,
  mergeEventDifficultyComps,
  splitEventDifficultyTabs,
  staleEventCompNotes,
  staleEventCompVerdicts,
} from '../scripts/lib/map-intel-event-comps.mjs'

const kcNode = (comps) => ({ nodeColor: '3baef5', enemyComps: comps, drops: [] })
const wwNode = (comps, ships = []) => ({ ships, emptyDrop: 'unknown', enemyComps: comps })

test('活动页按甲乙丙丁四个 tab 切开，末段用页脚引用块收口', () => {
  const tab = (title, body) => `<div class="tabbertab" title="${title}"><p>${body}</p></div>`
  const html =
    `${tab('海图概览', '地图')}${tab('甲作战', 'K')}${tab('乙作战', 'O')}` +
    `${tab('丙作战', 'H')}${tab('丁作战', 'T')}` +
    '<div class="mw-references-wrap">页脚自述</div><div>页尾攻略正文</div>'
  const tabs = splitEventDifficultyTabs(html)
  assert.deepEqual([...tabs.keys()], ['甲', '乙', '丙', '丁'])
  assert.match(tabs.get('甲'), />K</)
  assert.doesNotMatch(tabs.get('甲'), />O</)
  // 末段（丁）没有下一个 tab 当右界。收在引用块之前——否则页尾的攻略正文
  // 会被卷进丁难度，那一段里任何像编成的表格都会变成丁的假编成。
  assert.match(tabs.get('丁'), />T</)
  assert.doesNotMatch(tabs.get('丁'), /页尾攻略正文/)
  assert.doesNotMatch(tabs.get('丁'), /页脚自述/)
})

test('末段没有引用块时退到文末，宁可多切也不少一段编成', () => {
  const html =
    '<div class="tabbertab" title="甲作战"><p>K</p></div>' +
    '<div class="tabbertab" title="丁作战"><p>T</p></div><p>尾</p>'
  assert.match(splitEventDifficultyTabs(html).get('丁'), /尾/)
})

test('配对键吃得下两家写法：注解与站位说明不进键，等级进键', () => {
  // 同一条编成两家的写法（2026-08-24 实测取自 62-1 A2 / A1）
  assert.equal(abyssalJoinKey('軽母ヌ級改flagship(C)(艦載機赤)'), '軽母ヌ級改|flagship')
  assert.equal(abyssalJoinKey('軽母ヌ級改 flagship 艦載機鳥赤'), '軽母ヌ級改|flagship')
  assert.equal(abyssalJoinKey('(後衛)軽母ヌ級elite(E)(艦載機白弱)'), '軽母ヌ級|elite')
  assert.equal(abyssalJoinKey('軽母ヌ級elite 艦載機白'), '軽母ヌ級|elite')
  // 等级必须进键：flagship 与 elite 是不同的敌人，混成一条就会配错号
  assert.notEqual(abyssalJoinKey('潜水カ級flagship'), abyssalJoinKey('潜水カ級elite'))
  // 没写等级的那一档也要能表达，不能塌成同一个键
  assert.equal(abyssalJoinKey('軽母ヌ級'), '軽母ヌ級|')
  assert.notEqual(abyssalJoinKey('軽母ヌ級'), abyssalJoinKey('軽母ヌ級elite'))
})

test('展示序键保持顺序，配置键不认顺序——跨源对齐只能用后者', () => {
  assert.notEqual(
    compJoinKey(['戦艦タ級elite', '駆逐ハ級']),
    compJoinKey(['駆逐ハ級', '戦艦タ級elite']),
  )
  // 日站会把「同一支舰队的两种阵形」拆成两条 パターン 行，而两行的排列顺序不一样
  //（2026-08-24 实测 62-5 X 点甲：パターン1 ヌ級改elite 打头 輪形、パターン2 タ級flagship
  // 打头 単縦，同一支队）。拿保持顺序的键去跨源配，其中一条永远配不上。
  assert.equal(
    compConfigKey(['戦艦タ級elite', '駆逐ハ級']),
    compConfigKey(['駆逐ハ級', '戦艦タ級elite']),
  )
  // 但**变体档**照旧要进键：elite 与非 elite 是两套配置，不许塌成一条
  assert.notEqual(compConfigKey(['軽巡ツ級elite']), compConfigKey(['軽巡ツ級']))
})

test('两家 wiki 都收也只算「同源转录」——舰娘百科的活动页自述转录自日站', () => {
  // 这一条是本域最容易写反的判据。常规图编成域把两家算成两张独立票，
  // 活动域**不能照抄**：五张活动海域页 5/5 挂着「主要数据来源为日wiki」。
  const merged = mergeEventDifficultyComps({
    code: '62-1',
    difficulty: '甲',
    kcwikiNodes: {
      A: kcNode([{ formation: 1, ships: [1501, 1502], labels: ['駆逐イ級', '駆逐ロ級'] }]),
    },
    wikiwikiNodes: { A: wwNode([{ formation: 1, ships: ['駆逐イ級', '駆逐ロ級'] }]) },
  })
  assert.deepEqual(merged.nodes.A[0].votes, ['kcwiki', 'wikiwiki'])
  assert.equal(eventCompCorroborationOf(merged.nodes.A[0]), '同源转录')
  assert.equal(merged.stats.transcribed, 1)
  assert.equal(merged.stats.multi, 0)
})

test('本机遭遇志那一票才把条目抬到「多源一致」，且按难度层归票', () => {
  const kcwikiNodes = {
    A: kcNode([{ formation: 1, ships: [1501, 1502], labels: ['駆逐イ級', '駆逐ロ級'] }]),
  }
  const wikiwikiNodes = { A: wwNode([{ formation: 1, ships: ['駆逐イ級', '駆逐ロ級'] }]) }
  const ledger = new Map([['62-1|丙|1501,1502', { samples: 3 }]])
  const hit = mergeEventDifficultyComps({
    code: '62-1',
    difficulty: '丙',
    kcwikiNodes,
    wikiwikiNodes,
    ledger,
  })
  assert.deepEqual(hit.nodes.A[0].votes, ['kcwiki', 'wikiwiki', 'ledger'])
  assert.equal(eventCompCorroborationOf(hit.nodes.A[0]), '多源一致')
  // 同一套阵容、同一张图，但玩家打的是丙——甲那一层拿不到这张票。
  // 账本带 difficulty 列正是为了不让「我在丙见过」冒充「甲也这样」。
  const miss = mergeEventDifficultyComps({
    code: '62-1',
    difficulty: '甲',
    kcwikiNodes,
    wikiwikiNodes,
    ledger,
  })
  assert.equal(eventCompCorroborationOf(miss.nodes.A[0]), '同源转录')
})

test('日站独有的编成照收不丢，但**不给号**——猜号那条路已经退役', () => {
  const merged = mergeEventDifficultyComps({
    code: '62-1',
    difficulty: '甲',
    kcwikiNodes: {},
    wikiwikiNodes: {
      A: wwNode([{ formation: 4, ships: ['潜水カ級flagship'], phase: '最终形态' }]),
    },
  })
  assert.equal(merged.nodes.A.length, 1)
  assert.deepEqual(merged.nodes.A[0].ships, ['潜水カ級flagship'])
  assert.equal(merged.nodes.A[0].labels, undefined)
  assert.deepEqual(merged.nodes.A[0].votes, ['wikiwiki'])
  assert.equal(merged.nodes.A[0].phase, '最终形态')
  assert.equal(eventCompCorroborationOf(merged.nodes.A[0]), '单源待印证')
  assert.equal(merged.stats.wikiwikiOnly, 1)
  assert.equal(merged.stats.withIds, 0)
})

test('舰娘百科多出来的点照收（实测 62-1 的 AB），阶段标注从日站带过来', () => {
  const merged = mergeEventDifficultyComps({
    code: '62-1',
    difficulty: '甲',
    kcwikiNodes: {
      AB: kcNode([{ formation: 3, ships: [1501], labels: ['駆逐イ級'] }]),
      X: kcNode([{ formation: 1, ships: [1502], labels: ['駆逐ロ級'] }]),
    },
    wikiwikiNodes: { X: wwNode([{ formation: 1, ships: ['駆逐ロ級'], phase: '最终形态' }]) },
  })
  assert.deepEqual(Object.keys(merged.nodes).sort(), ['AB', 'X'])
  assert.equal(merged.nodes.AB[0].votes.length, 1)
  assert.equal(merged.stats.kcwikiOnly, 1)
  // 削甲/最终形态只有日站给；配对上就要带过来，换源不该顺手丢掉它
  assert.equal(merged.nodes.X[0].phase, '最终形态')
})

test('阵形只是覆盖差不算冲突，互斥才算——取值按基座源，且不代人拍板', () => {
  const cover = mergeEventDifficultyComps({
    code: '62-5',
    difficulty: '丙',
    kcwikiNodes: { G: kcNode([{ formation: '単縦 梯形', ships: [1501], labels: ['駆逐イ級'] }]) },
    wikiwikiNodes: { G: wwNode([{ formation: '単縦', ships: ['駆逐イ級'] }]) },
  })
  assert.equal(cover.conflicts.length, 0)
  assert.equal(cover.nodes.G[0].conflict, undefined)

  const clash = mergeEventDifficultyComps({
    code: '62-5',
    difficulty: '丙',
    kcwikiNodes: { G: kcNode([{ formation: 3, ships: [1501], labels: ['駆逐イ級'] }]) },
    wikiwikiNodes: { G: wwNode([{ formation: 1, ships: ['駆逐イ級'] }]) },
  })
  assert.equal(clash.conflicts.length, 1)
  assert.equal(clash.conflicts[0].kind, 'formation')
  assert.equal(clash.conflicts[0].kcwikiFormation, 3)
  assert.equal(clash.conflicts[0].wikiwikiFormation, 1)
  // 取值按基座源 kcwiki，但条目上打冲突标；裁决是人的事，脚本一条都不许自己裁
  assert.equal(clash.nodes.G[0].formation, 3)
  assert.equal(clash.nodes.G[0].conflict, 'formation')
  assert.equal(eventCompCorroborationOf(clash.nodes.G[0]), '冲突待裁')
  assert.equal(clash.conflicts[0].verdict, undefined)
})

test('同一点同一舰列多条：按池择优配对，不编出根本不存在的冲突', () => {
  // 1-6 的 C 点那种形状：同一套舰列出现在两行，阵形不同。
  // 「第一条先到先得」会把第二条拿去和第一条比，凭空造出冲突。
  const merged = mergeEventDifficultyComps({
    code: '62-3',
    difficulty: '乙',
    kcwikiNodes: {
      B1: kcNode([
        { formation: 4, ships: [1501, 1502], labels: ['駆逐イ級', '駆逐ロ級'] },
        { formation: 5, ships: [1501, 1502], labels: ['駆逐イ級', '駆逐ロ級'] },
      ]),
    },
    wikiwikiNodes: {
      B1: wwNode([
        { formation: 5, ships: ['駆逐イ級', '駆逐ロ級'] },
        { formation: 4, ships: ['駆逐イ級', '駆逐ロ級'] },
      ]),
    },
  })
  assert.equal(merged.conflicts.length, 0)
  assert.equal(merged.stats.transcribed, 2)
  assert.equal(merged.stats.wikiwikiOnly, 0)
})

test('一套配置多个阵形模式：两家各记到一半不算冲突（62-5 X 点的真形状）', () => {
  // 2026-08-24 实测 62-5 丙 X：舰娘百科把非 elite 档并成一行写「単縦 輪形」，
  // 日站拆成两行、且两行的排列顺序不一样。旧的「保持顺序 + 先到先得」配对
  // 会让日站那条 ヌ級 打头的行永远配不上，以一条**没有号的重复行**落进包里。
  const merged = mergeEventDifficultyComps({
    code: '62-5',
    difficulty: '丙',
    kcwikiNodes: {
      X: kcNode([
        {
          formation: '単縦 輪形',
          ships: [1542, 1777, 1591],
          labels: ['戦艦タ級elite', '軽母ヌ級 elite 艦載機黒', '軽巡ツ級'],
        },
      ]),
    },
    wikiwikiNodes: {
      X: wwNode([
        // 同一支队，日站排在前面的是 ヌ級——顺序不同，但配置一样
        { formation: 3, ships: ['軽母ヌ級elite(D)(艦載機黒)', '戦艦タ級elite', '軽巡ツ級'] },
        { formation: 1, ships: ['戦艦タ級elite', '軽母ヌ級elite(D)(艦載機黒)', '軽巡ツ級'] },
      ]),
    },
  })
  assert.equal(merged.conflicts.length, 0)
  // 两条日站行说的都是基座源已经记下的模式，一条重复行都不该多出来
  assert.equal(merged.nodes.X.length, 1)
  assert.deepEqual(merged.nodes.X[0].votes, ['kcwiki', 'wikiwiki'])
  assert.equal(merged.stats.wikiwikiOnly, 0)
})

test('同一配置在两源阵形一个都不沾，才是真冲突——变体档不同则各判各的', () => {
  // 同一个点上两档变体：elite 那一档两家互斥（真冲突），非 elite 那一档有交集（不报）。
  // 这正是 62-5 丙 X 的形状；旧逻辑在非 elite 档上还会多吐一条没号的重复行。
  const merged = mergeEventDifficultyComps({
    code: '62-5',
    difficulty: '丙',
    kcwikiNodes: {
      X: kcNode([
        { formation: 1, ships: [1542, 1592], labels: ['戦艦タ級elite', '軽巡ツ級elite'] },
        { formation: '単縦 輪形', ships: [1542, 1591], labels: ['戦艦タ級elite', '軽巡ツ級'] },
      ]),
    },
    wikiwikiNodes: {
      X: wwNode([
        { formation: 3, ships: ['戦艦タ級elite', '軽巡ツ級elite'] },
        { formation: 3, ships: ['戦艦タ級elite', '軽巡ツ級'] },
      ]),
    },
  })
  assert.equal(merged.conflicts.length, 1)
  assert.deepEqual(merged.conflicts[0].labels, ['戦艦タ級elite', '軽巡ツ級elite'])
  assert.equal(merged.conflicts[0].kcwikiFormation, 1)
  assert.equal(merged.conflicts[0].wikiwikiFormation, 3)
  // 非 elite 那一档不许被 elite 档的冲突带下水
  assert.equal(merged.nodes.X.length, 2)
  assert.equal(merged.nodes.X[0].conflict, 'formation')
  assert.equal(merged.nodes.X[1].conflict, undefined)
  assert.equal(merged.stats.conflict, 1)
})

test('冲突那一格不吐第二行：取值按基座源等人裁，不把互斥摆成两个并存的模式', () => {
  const merged = mergeEventDifficultyComps({
    code: '62-5',
    difficulty: '丙',
    kcwikiNodes: { G: kcNode([{ formation: 3, ships: [1755], labels: ['欧州棲姫'] }]) },
    wikiwikiNodes: { G: wwNode([{ formation: 1, ships: ['欧州棲姫(A)'], phase: '最终形态' }]) },
  })
  assert.equal(merged.nodes.G.length, 1)
  assert.equal(merged.nodes.G[0].formation, 3)
  assert.equal(merged.nodes.G[0].phase, '最终形态')
  assert.equal(merged.stats.wikiwikiOnly, 0)
})

test('日站多记到的那个阵形模式补一行；只是多写一档覆盖的不补', () => {
  // 补：日站这一行的阵形与基座源记到的一个都不沾 → 另一个模式，照收（但不给号）
  const extra = mergeEventDifficultyComps({
    code: '62-3',
    difficulty: '丙',
    kcwikiNodes: { W: kcNode([{ formation: 1, ships: [1501], labels: ['駆逐イ級'] }]) },
    wikiwikiNodes: {
      W: wwNode([
        { formation: 1, ships: ['駆逐イ級'] },
        { formation: 3, ships: ['駆逐イ級'] },
      ]),
    },
  })
  assert.equal(extra.conflicts.length, 0)
  assert.equal(extra.nodes.W.length, 2)
  assert.equal(extra.nodes.W[1].formation, 3)
  assert.deepEqual(extra.nodes.W[1].votes, ['wikiwiki'])
  assert.deepEqual(extra.nodes.W[1].ships, ['駆逐イ級'])

  // 不补：2026-08-24 实测 62-4 丙 J 的形状——舰娘百科写「警戒 単縦」、
  // 日站写「単縦 複縦 警戒」，说的是同一个模式，日站只是多写了一档。
  // 按「没被完全盖住」去补，会补出一条几乎一模一样的重复行。
  const cover = mergeEventDifficultyComps({
    code: '62-4',
    difficulty: '丙',
    kcwikiNodes: { J: kcNode([{ formation: '警戒 単縦', ships: [1501], labels: ['駆逐イ級'] }]) },
    wikiwikiNodes: { J: wwNode([{ formation: '単縦 複縦 警戒', ships: ['駆逐イ級'] }]) },
  })
  assert.equal(cover.conflicts.length, 0)
  assert.equal(cover.nodes.J.length, 1)
  assert.equal(cover.stats.wikiwikiOnly, 0)
})

test('旁证注记只进报告，不改取值也不撤冲突标；认领不上要报出来', () => {
  // 注记不是裁决，它只是「核这一条时手头有什么」——写了注记的那一格照旧挂着冲突标。
  for (const one of EVENT_COMP_CONFLICT_NOTES) {
    assert.match(one.fingerprint, /^\d+-\d+\/[甲乙丙丁]\/[A-Z]+\d*\[[\d.]+\]f:.+\|.+$/)
    // 注记必须写清「这不是裁决」，免得下一个人把旁证当结论用
    assert.match(one.note, /不构成裁决|终审/)
  }
  // 拿一条**临时注记**跑行为，而不是拿表里现存的条目——2026-08-24 62-5 丙 G/X 两条结案后
  // 注记表清空了，只按表遍历的话这条护栏会变成空转（写反了也照样绿）。
  const live = {
    map: '62-9',
    difficulty: '丙',
    node: 'Q',
    ships: [1755, 1776],
    kcwikiFormation: 3,
    wikiwikiFormation: 1,
  }
  const noted = Object.freeze([
    { fingerprint: eventCompConflictFingerprint(live), note: '……不构成裁决', watch: '留意阵形' },
  ])
  const stale = (conflicts) =>
    noted.filter((one) => !conflicts.some((c) => eventCompConflictFingerprint(c) === one.fingerprint))
  assert.equal(stale([live]).length, 0)
  // 上游把那一格改了 → 注记认领不上，报成待重核
  assert.equal(stale([{ ...live, kcwikiFormation: 5 }]).length, 1)
  // 真表也要走一遍同一条判据：认领不上的一条都不许悄悄留着
  assert.deepEqual(staleEventCompNotes([]), [...EVENT_COMP_CONFLICT_NOTES])
})

test('注记表与裁决表不许收同一枚指纹——报告不能既说结案又挂着观察指引', () => {
  const decided = new Set(RESOLVED_EVENT_COMP_CONFLICTS.map((one) => one.fingerprint))
  for (const one of EVENT_COMP_CONFLICT_NOTES) {
    assert.ok(!decided.has(one.fingerprint), `${one.fingerprint} 两张表各留了一份`)
  }
})

test('标注转写台账按 mstId 改写，撞了同一条错标注的那个对的号不许误伤', () => {
  // 1765（真·鳥白）与 1778（实为黒）在舰娘百科被写了同一条标注，只差一个空格。
  // 按标注文本去改必然把 1765 也改掉——那正是这条台账最容易写错的地方。
  const nodes = {
    X: {
      enemyComps: [
        {
          formation: 1,
          ships: [1778, 1765, 1543],
          labels: ['軽母ヌ級改 elite 艦載機鳥白', '軽母ヌ級改elite 艦載機鳥白', '戦艦タ級flagship'],
        },
      ],
    },
  }
  const result = applyAbyssalLabelFixes(nodes)
  assert.equal(nodes.X.enemyComps[0].labels[0], '軽母ヌ級改 elite 艦載機黒')
  // 1765 那一格一个字都不许动
  assert.equal(nodes.X.enemyComps[0].labels[1], '軽母ヌ級改elite 艦載機鳥白')
  assert.equal(nodes.X.enemyComps[0].labels[2], '戦艦タ級flagship')
  assert.equal(result.applied.get(1778), 1)
  assert.equal(result.applied.get(1765), undefined)
  // 号一个都不许动——号是这一域换源的全部理由
  assert.deepEqual(nodes.X.enemyComps[0].ships, [1778, 1765, 1543])
})

test('上游自己改对了就报退役；改成第三种写法就报指纹对不上，一律不硬改', () => {
  const fix = KNOWN_ABYSSAL_LABEL_FIXES[0]
  const fixed = { A: { enemyComps: [{ formation: 1, ships: [fix.mstId], labels: [fix.correct] }] } }
  const done = applyAbyssalLabelFixes(fixed)
  assert.deepEqual(done.retire, [fix.mstId])
  assert.equal(done.applied.get(fix.mstId), undefined)

  const drifted = {
    A: { enemyComps: [{ formation: 1, ships: [fix.mstId], labels: ['軽母ヌ級改 elite 艦載機緑'] }] },
  }
  const stale = applyAbyssalLabelFixes(drifted)
  assert.deepEqual(stale.mismatched, [{ mstId: fix.mstId, found: '軽母ヌ級改 elite 艦載機緑' }])
  // 对不上就**不打补丁**：源变了该重新核，不该继续照旧改写
  assert.equal(drifted.A.enemyComps[0].labels[0], '軽母ヌ級改 elite 艦載機緑')
  assert.equal(stale.applied.size, 0)
})

test('台账每条都要写清判据与核对日，且改的只能是标注不是号', () => {
  assert.ok(KNOWN_ABYSSAL_LABEL_FIXES.length > 0)
  for (const fix of KNOWN_ABYSSAL_LABEL_FIXES) {
    assert.ok(Number.isInteger(fix.mstId) && fix.mstId > 0)
    assert.notEqual(fix.upstream, fix.correct)
    // 判据必须落到可复算的东西上（制空値），不能只写「看着像」
    assert.match(fix.why, /制空/)
    assert.match(fix.checkedAt, /^\d{4}-\d{2}-\d{2}$/)
    // 改标注不许顺手改基名与等级——那会把配对键也改了
    assert.equal(abyssalJoinKey(fix.upstream), abyssalJoinKey(fix.correct))
  }
})

test('跨难度对齐表把两站每条模式逐行摊平，标明哪站哪难度哪模式', () => {
  const table = buildNodeAlignment({
    code: '62-5',
    node: 'X',
    byDifficulty: {
      甲: {
        kcwiki: [{ formation: 1, air: 132, ships: [1543], labels: ['戦艦タ級flagship'] }],
        wikiwiki: [
          { formation: 3, ships: ['軽母ヌ級改elite(C)(艦載機黒)'] },
          { formation: 1, ships: ['戦艦タ級flagship'] },
        ],
      },
    },
  })
  assert.equal(table.map, '62-5')
  assert.equal(table.node, 'X')
  assert.equal(table.rows.length, 3)
  assert.deepEqual(
    table.rows.map((r) => [r.难度, r.源, r.模式, r.阵形]),
    [
      ['甲', 'kcwiki', 'K1', 1],
      ['甲', 'wikiwiki', 'パターン1', 3],
      ['甲', 'wikiwiki', 'パターン2', 1],
    ],
  )
  // 日站那几行要如实写「没有号」，别让人以为是漏抓
  assert.match(table.rows[1].号, /日站从不给号/)
  assert.equal(table.rows[0].号, '1543')
})

test('每条未裁冲突都要带一句「打到这格留意什么」——账本才是终审', () => {
  // 2026-08-24 起注记表是空的（62-5 丙 G/X 两条都裁完了），所以下面这个循环现在是空转。
  // 空转的循环不是护栏：真正拦住「结案了还挂着观察指引」的是上面那条两表指纹互斥的断言，
  // 这里只负责给下一条**未裁**注记定形状。
  for (const one of EVENT_COMP_CONFLICT_NOTES) {
    assert.ok(one.watch, `${one.fingerprint} 缺观察指引`)
    // 指引要说清「留意什么」，不是复述结论
    assert.match(one.watch, /留意/)
    assert.ok(one.watch.length < 120, '观察指引要是一句话')
  }
})

test('印证四档认的是「两根独立的根」，不是「票够两张」', () => {
  const at = (votes) => eventCompCorroborationOf({ votes })
  assert.equal(at(['kcwiki']), '单源待印证')
  assert.equal(at(['kcwiki', 'wikiwiki']), '同源转录', '两家同祖，几张都只算一根')
  assert.equal(at(['kcwiki', 'wikiwiki', 'ledger']), '多源一致')
  // KCNav 人肉见证与本机遭遇志同属「一手实测」那一根
  assert.equal(at(['wikiwiki', 'kcnav']), '多源一致')
  assert.equal(at(['kcwiki', 'kcnav']), '多源一致')
  // 只有实测票、一张 wiki 票都没有 → 那是一手观察，不是两源一致
  assert.equal(at(['kcnav']), '单源待印证')
  assert.equal(at(['ledger']), '单源待印证')
  assert.equal(at(['ledger', 'kcnav']), '同源转录', '两张实测票也还是一根')
  // 冲突标压过一切：没裁完之前不许靠票数升档
  assert.equal(eventCompCorroborationOf({ votes: ['kcwiki', 'wikiwiki', 'kcnav'], conflict: 'formation' }), '冲突待裁')
})

test('KCNav 见证票按舰列认领，认领上的升「多源一致」；认领不上要报出来', () => {
  const labels = [
    '欧州棲姫',
    '軽母ヌ級 elite 艦載機鳥白',
    '重巡リ級',
    '軽巡ツ級',
    '駆逐ハ級後期型',
    '駆逐ハ級後期型',
  ]
  const ships = [1755, 1776, 1509, 1591, 1577, 1577]
  const merged = mergeEventDifficultyComps({
    code: '62-5',
    difficulty: '丙',
    kcwikiNodes: { G: kcNode([{ formation: 3, ships, labels }]) },
    wikiwikiNodes: { G: wwNode([{ formation: 1, ships: labels }]) },
  })
  const comp = merged.nodes.G[0]
  assert.deepEqual(comp.votes, ['kcwiki', 'wikiwiki', 'kcnav'])
  assert.equal(eventCompCorroborationOf(comp), '多源一致')
  assert.equal(merged.stats.kcnavWitnessed, 1)
  assert.equal(merged.stats.multi, 1)
  assert.deepEqual(merged.witnessKeys, ['62-5/丙/G[1755.1776.1509.1591.1577.1577]'])

  // 上游改了舰列 → 票认领不上，编成一个字都不动，而且要报成无主票。
  // 这里两站阵形一致（不触发冲突），把「票认领不上」这一件事单独摘出来看。
  const moved = mergeEventDifficultyComps({
    code: '62-5',
    difficulty: '丙',
    kcwikiNodes: { G: kcNode([{ formation: 3, ships: [...ships.slice(0, 5), 1578], labels }]) },
    wikiwikiNodes: { G: wwNode([{ formation: 3, ships: labels }]) },
  })
  assert.deepEqual(moved.nodes.G[0].votes, ['kcwiki', 'wikiwiki'])
  assert.equal(eventCompCorroborationOf(moved.nodes.G[0]), '同源转录')
  assert.deepEqual(moved.witnessKeys, [])
  assert.equal(staleKcnavWitnesses([]).length, KCNAV_WITNESSED_COMPS.length)
})

test('每张见证票都写得出样本数、见证日、和逐格钉号的依据；键是这一域算得出的形状', () => {
  const seen = new Set()
  for (const one of KCNAV_WITNESSED_COMPS) {
    assert.match(one.key, /^\d+-\d+\/[甲乙丙丁]\/[A-Z]+\d*\[.+\]$/, `${one.key} 不是这一域的键形状`)
    assert.ok(Number.isInteger(one.samples) && one.samples > 0, `${one.key} 没写样本数`)
    assert.match(one.witnessedAt ?? '', /^\d{4}-\d{2}-\d{2}$/, `${one.key} 没写见证日期`)
    // 发票门槛就是这一栏：写不出逐格钉号的依据，这票不该发
    assert.ok(one.pinned?.length > 40, `${one.key} 没写逐格指纹钉号的依据`)
    assert.ok(!seen.has(one.key), `键重复：${one.key}`)
    seen.add(one.key)
  }
  // 键要真能由 (图/难度/点/舰列) 算出来，不然它永远认领不上，而这一点不会有任何报错表现
  assert.equal(
    eventCompWitnessKey({ map: '62-5', difficulty: '丙', node: 'G', ships: [1977, 1570, 1570, 1591, 1577, 1577] }),
    KCNAV_WITNESSED_COMPS[1].key,
  )
  // 实测里只有 62-5 丙 G 展开过悬浮卡：X 点一票都不许发（身份钉不住）
  assert.ok(!KCNAV_WITNESSED_COMPS.some((one) => one.key.includes('/X[')), 'X 点的卡还没展开，不该有票')
})

test('两站的毛病清单要写得出是哪一格实证的——它是后面每次取舍的前提', () => {
  assert.ok(EVENT_SOURCE_QUALITY.kcwiki.length >= 2)
  assert.ok(EVENT_SOURCE_QUALITY.wikiwiki.length >= 1)
  for (const line of [...EVENT_SOURCE_QUALITY.kcwiki, ...EVENT_SOURCE_QUALITY.wikiwiki]) {
    assert.match(line, /\d+-\d+/, `毛病清单里有一条没写实证的那一格：${line}`)
  }
  // kcwiki 会整档漏收 —— 这条是「日站独有配置照收不丢」那条规矩的根据，丢了它规矩就成了拍脑袋
  assert.ok(EVENT_SOURCE_QUALITY.kcwiki.some((line) => line.includes('漏收')))
})

test('掉落域只有「有没有账本票」两档——舰娘百科的活动掉落表不分难度，投不了票', () => {
  assert.equal(eventDropCorroborationOf({ id: 1, votes: ['wikiwiki'] }), '单源待印证')
  assert.equal(eventDropCorroborationOf({ id: 1, votes: ['wikiwiki', 'ledger'] }), '多源一致')
  assert.equal(eventDropCorroborationOf({ id: 1 }), '单源待印证')
})

test('冲突指纹认那一格的内容，上游一改旧裁决就认领不上', () => {
  const base = {
    map: '62-5',
    difficulty: '丙',
    node: 'G',
    ships: [1755, 1776],
    kcwikiFormation: 3,
    wikiwikiFormation: 1,
  }
  const moved = { ...base, kcwikiFormation: 1 }
  assert.notEqual(eventCompConflictFingerprint(base), eventCompConflictFingerprint(moved))
  // 一条都认领不上时全表都是无主裁决——「有裁决作废了」必须报得出来，
  // 不然上游改一格只表现成「又多了几条待裁」，谁也看不出是裁决失效了
  assert.deepEqual(staleEventCompVerdicts([]), [...RESOLVED_EVENT_COMP_CONFLICTS])
})

test('每条裁决都写得出裁给谁、哪天裁的、凭什么、证据链，且指纹不重复', () => {
  const seen = new Set()
  for (const one of RESOLVED_EVENT_COMP_CONFLICTS) {
    assert.ok(one.verdict?.length, `${one.fingerprint} 没写裁给谁`)
    assert.match(one.decidedAt ?? '', /^\d{4}-\d{2}-\d{2}$/, `${one.fingerprint} 没写裁定日期`)
    assert.ok(one.why?.length > 30, `${one.fingerprint} 的裁语是空话`)
    // 证据链必填、且要逐条列开：揉成一段散文就分不出「一手实测」和「旁证」
    assert.ok(Array.isArray(one.evidence), `${one.fingerprint} 没写证据链`)
    assert.ok(one.evidence.length >= 2, `${one.fingerprint} 的证据链只有一条腿`)
    for (const line of one.evidence) assert.ok(line.length > 20, `${one.fingerprint} 有一条证据是空话`)
    // 指纹必须是这一域真算得出来的形状，不然它永远认领不上，而这一点不会有任何报错表现
    assert.match(
      one.fingerprint,
      /^\d+-\d+\/[甲乙丙丁]\/[A-Z]+\d*\[[\d.]+\]f:.+\|.+$/,
      `${one.fingerprint} 不是这一域的指纹形状`,
    )
    assert.ok(!seen.has(one.fingerprint), `指纹重复：${one.fingerprint}`)
    seen.add(one.fingerprint)
  }
  // 2026-08-24 KCNav 人肉见证那一批：62-5 丙的 G 与 X，两条都裁给 kcwiki
  assert.deepEqual(
    RESOLVED_EVENT_COMP_CONFLICTS.map((one) => one.fingerprint),
    [
      '62-5/丙/G[1755.1776.1509.1591.1577.1577]f:3|1',
      '62-5/丙/X[1542.1777.1592.1578.1578.1503]f:1|3',
    ],
  )
  for (const one of RESOLVED_EVENT_COMP_CONFLICTS) {
    assert.equal(one.verdict, 'kcwiki')
    assert.ok(one.evidence.some((line) => line.includes('KCNav')), '裁语里没写那一手票是谁给的')
  }
})

// 62-5 丙 X 的真形状（elite 档两站阵形一个都不沾）——指纹要与裁决表里那一条逐字对上
const X_LABELS = [
  '戦艦タ級elite',
  '軽母ヌ級 elite 艦載機黒',
  '軽巡ツ級elite',
  '駆逐ニ級後期型',
  '駆逐ニ級後期型',
  '駆逐ハ級',
]
const decidedNodeX = ({ ships = [1542, 1777, 1592, 1578, 1578, 1503] } = {}) =>
  mergeEventDifficultyComps({
    code: '62-5',
    difficulty: '丙',
    kcwikiNodes: { X: kcNode([{ formation: 1, ships, labels: X_LABELS }]) },
    wikiwikiNodes: { X: wwNode([{ formation: 3, ships: X_LABELS }]) },
  })

test('结案的冲突：撤掉 conflict 标，取值一个字段都不动', () => {
  const merged = decidedNodeX()
  const comp = merged.nodes.X[0]
  assert.equal(comp.conflict, undefined, '裁完了还挂着待裁标')
  // 「撤标」不许顺手改数：阵形照旧是基座源那一格的 単縦(1)，号与标注一字不动
  assert.equal(comp.formation, 1)
  assert.deepEqual(comp.ships, [1542, 1777, 1592, 1578, 1578, 1503])
  assert.deepEqual(comp.labels, X_LABELS)
  // votes 也不动：KCNav 那一手票不是包里的取值来源，塞进 votes 就是假装多了一个源
  assert.deepEqual(comp.votes, ['kcwiki', 'wikiwiki'])
  assert.equal(eventCompCorroborationOf(comp), '同源转录')
  // 被否掉的那一侧不许补成「另一个并存的模式」
  assert.equal(merged.nodes.X.length, 1)
  assert.equal(merged.stats.wikiwikiOnly, 0)
  // 印证计数跟着走：这一条不再进「冲突待裁」桶
  assert.equal(merged.stats.conflict, 0)
  assert.equal(merged.stats.transcribed, 1)

  // 条目本身不删：照旧进对账报告，多带裁语与证据链
  assert.equal(merged.conflicts.length, 1)
  assert.equal(merged.conflicts[0].verdict, 'kcwiki')
  assert.equal(merged.conflicts[0].decidedAt, '2026-08-24')
  assert.ok(merged.conflicts[0].evidence.length >= 2)
  // 已结案的不再带观察指引——「打到这格留意什么」的意思是这一格还没定
  assert.equal(merged.conflicts[0].watch, undefined)
  assert.equal(merged.conflicts[0].note, undefined)
})

test('没裁过的那一格照旧挂标：上游改了一格，旧裁决就认领不上', () => {
  // 只把一个号换掉 → 指纹变 → 裁决认领不上 → 重新以未裁形态出现
  const merged = decidedNodeX({ ships: [1542, 1777, 1592, 1578, 1578, 1504] })
  const comp = merged.nodes.X[0]
  assert.equal(comp.conflict, 'formation', '指纹都变了，旧裁决还在给这一格撤标')
  assert.equal(comp.formation, 1, '未裁项的取值也照旧按基座源，不因为待裁就换成另一边')
  assert.equal(merged.stats.conflict, 1)
  assert.equal(merged.conflicts[0].verdict, undefined)
})

test('62-5 丙 G 同批结案：欧州棲姫那一档撤标，轮形照旧', () => {
  const labels = [
    '欧州棲姫',
    '軽母ヌ級 elite 艦載機鳥白',
    '重巡リ級',
    '軽巡ツ級',
    '駆逐ハ級後期型',
    '駆逐ハ級後期型',
  ]
  const merged = mergeEventDifficultyComps({
    code: '62-5',
    difficulty: '丙',
    kcwikiNodes: {
      G: kcNode([{ formation: 3, ships: [1755, 1776, 1509, 1591, 1577, 1577], labels }]),
    },
    wikiwikiNodes: { G: wwNode([{ formation: 1, ships: labels, phase: '最终形态' }]) },
  })
  assert.equal(merged.nodes.G[0].conflict, undefined)
  assert.equal(merged.nodes.G[0].formation, 3, '裁给 kcwiki 却把取值换成了日站那个単縦')
  assert.equal(merged.nodes.G[0].phase, '最终形态', '阶段标注是日站给的那一半，别跟着冲突一起丢')
  assert.equal(merged.nodes.G.length, 1)
  assert.equal(merged.stats.conflict, 0)
  assert.equal(merged.conflicts[0].verdict, 'kcwiki')
})
