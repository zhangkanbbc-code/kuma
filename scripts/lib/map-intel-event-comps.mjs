// 活动图敌编成的**定号换源**（多源汇编批次 3）与该域的四档印证。
//
// ---- 为什么现在必须做 ----
//
// 2026-08-22 常规图编成换源时，`lodes:map-intel-pin` / `-observe` 两条「靠名字猜号」
// 的流水线整条退役（护栏在 test/abyssal-id-pin.test.mjs），当时留了一句挂账：
// 「活动图的号由批次 3（活动图换源）从 kcwiki 原生取，不走猜名字这条路」。
// 那句话不是备忘，是**一枚定时炸弹**：活动页每刷新一次，抓取器就整层重写
// `difficulties[难度].nodes[点].enemyComps`，而定号那一步已经没有了——
// 2026-08-24 实测，照旧刷一次 1494 条已定号的活动编成会**全部掉号**，
// 镝的战前「精确档」在用户正打的这期活动上当场变哑，而且一条报错都不会有。
//
// 所以这一层把活动图也接到 kcwiki 的「深海配置」上：那张表**自带 mstId**，
// 而且活动页按 `甲作战/乙作战/丙作战/丁作战` 四个 tab 分好了难度，
// 与我们的四难度层天然对齐（2026-08-24 实测 E1–E5 五页 20 个 tab 全有）。
//
// ---- ⚠ 票的独立性在这一域**与常规图编成域不同** ----
//
// 常规图编成域（scripts/lib/map-enemy-comps.mjs）把 kcwiki 与 wikiwiki 算成两张独立票。
// **活动域不能照抄那个判断。** 2026-08-24 逐页实测：舰娘百科的五张活动海域页
//（`2026年夏季活动/E-1` … `/E-5`）**5/5 都挂着**与常规海域页同一行页脚自述：
//
//     「主要数据来源为日wiki，补充数据来自英文wikia，如果有冲突默认以日wiki为准」
//
// 也就是说「哪一套阵容出现在哪个点」这件事上，两家 wiki 是**同一张票抄了两遍**。
// 于是本域的四档收紧为：
//
//   · 多源一致    有**一手实测票**印证 + 至少一张 wiki 票（两根独立的根）
//   · 同源转录    kcwiki 与 wikiwiki 都收了，但没有实测票；同祖，**不升级**
//   · 单源待印证  只有一家收；**照收不丢**
//   · 冲突待裁    两票在阵形上互斥；进台账等人裁，脚本一条都不代拍
//
// 「一手实测票」有两种，都独立于 wiki 那条转录链，但**不是一回事**，别混着写：
//   · `ledger`  本机遭遇志：第一方、机器记的，脚本自己读得到（`loadLedgerEventVotes`），带难度列。
//   · `kcnav`   KCNav 人肉见证：第三方统计站的样本，**人眼读卡 + 转述**两道手，所以它
//               只在「逐格数值指纹钉得住这一条的身份」时才发票——光有行数与阵形、
//               没展开悬浮卡的不发（判据与台账见 `KCNAV_WITNESSED_COMPS` 头注）。
//               该站与艦ログ一样只许人肉浏览，kuma 没有对它的抓取脚本。
//
// 但**号本身另算**：日站从不公布 mstId，它只给「軽母ヌ級改flagship(C)(艦載機赤)」这样的
// 人读标注。号是舰娘百科编辑自己填的一手贡献，转录声明管不到它。所以
// 「阵容事实」按同源降档，「mstId」照旧采信 kcwiki——两件事分开判，别混成一句。
//
// ---- 两站各自的毛病（实证清单，`EVENT_SOURCE_QUALITY` 是同一份，会进对账报告）----
//
// 「同源转录」说的是两家的**祖宗**是一个，不是说两家抄得一样好。各自会错在哪，
// 是这一域后面每一次取舍的前提，逐条记在案：
//
//   kcwiki（舰娘百科，基座源：号只有它给）
//     · **整档漏收**：2026-08-24 实证，62-5 丙 G 点它只记两档，漏了「潜水夏姫II(B)/ソ級/
//       ヌ級/ハ級後期×2/ロ級」那一档；日站有，KCNav 实测 ×3（3/114 ≈ 2.6%，低频档）。
//       ⇒ 「kcwiki 没写」永远不能读成「不存在」——日站独有的配置照收不丢那条规矩，
//       不是宽容，是这个毛病的兜底。
//     · **涂装标注写错**：同名同数值、只有搭载机不同的变体会被填成同一条标注
//       （台账见 `KNOWN_ABYSSAL_LABEL_FIXES`）。号是对的，错的是号旁边那行字。
//
//   wikiwiki（艦これ攻略 Wiki，标注与难度别掉落的来源）
//     · **某一层阵形整列填同一个值**：2026-08-24 实证，62-5 丙层 G 与 X 两个点的
//       パターン 阵形格分别整列「単縦」「輪形」，而它自己甲乙丁三层都是有变化的；
//       两格都被 KCNav 实测否掉（裁决见 `RESOLVED_EVENT_COMP_CONFLICTS`）。
//       ⇒ 丙层的阵形栏单独看不足信；跨难度四层摊开才看得出哪一层是填下来的。
//
// ---- 配对键为什么是「基名+等级」而不是整条标注 ----
//
// 两家的形态注解词汇不一样：同一条编成 wikiwiki 写 `軽母ヌ級改flagship(C)(艦載機赤)`，
// kcwiki 写 `軽母ヌ級改 flagship 艦載機鳥赤`（连「鳥」都多一个字）。拿整条标注当键，
// 配对率会掉到个位数，然后整包变成「两边各说各的」——那不是事实，是解析失败。
// 所以配对只认 `基名|等级` 序列，注解不进键。注解仍旧原样存进包（`labels`），
// 展示层照旧显示——它是主数据没有的那一半信息。
//
// ---- 掉落域为什么没有 kcwiki 这张票（穷举结论，不是漏做）----
//
// 活动海域页确实有「稀有掉落」表，但它自己在表头第一行写着：
//     「以下掉落信息**未进行难度区分**，默认为甲级S胜」
// 而我们的活动掉落是**逐难度**的（wikiwiki 的難易度別ドロップ表按甲乙丙丁分列）。
// 一张不分难度的稀有掉落清单既不能印证乙丙丁三层，也不能否证任何一层
//（未列出 ≠ 确认不掉，本项目一贯口径）。所以掉落域的第二张票只有本机遭遇志。

import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'

import { userDataPathIfAny } from './data-dir.mjs'
import { compKey, formationIdsOf } from './map-enemy-comps.mjs'

const require = createRequire(import.meta.url)

export { compKey, formationIdsOf }

/** 舰娘百科活动页的难度 tab 标题 → 我们的难度字。 */
export const EVENT_DIFFICULTY_TABS = Object.freeze({
  甲作战: '甲',
  乙作战: '乙',
  丙作战: '丙',
  丁作战: '丁',
})

/**
 * 把一张活动海域页切成四段难度 HTML。
 *
 * 末段（丁作战）没有下一个 tab 当右界，用页脚的 `mw-references-wrap` 收口——
 * 2026-08-24 实测五页：引用块都在正文最末、且块内一条 `hfText` 都没有，
 * 拿它当界不会把编成截掉，也不会把页尾的攻略正文卷进来。
 * 找不到引用块才退到文末（宁可多切一点，也不要少一段编成）。
 */
export const splitEventDifficultyTabs = (html) => {
  const source = `${html ?? ''}`
  const marks = [...source.matchAll(/<div class="tabbertab"[^>]*title="([^"]*)"/g)].map(
    (match) => ({ title: match[1], at: match.index }),
  )
  const tail = source.indexOf('mw-references-wrap')
  const out = new Map()
  for (let index = 0; index < marks.length; index += 1) {
    const difficulty = EVENT_DIFFICULTY_TABS[marks[index].title]
    if (!difficulty) continue
    const next = marks[index + 1]?.at ?? (tail > marks[index].at ? tail : source.length)
    out.set(difficulty, source.slice(marks[index].at, next))
  }
  return out
}

/**
 * 舰娘百科深海标注的**转写修正台账**（范式照 scripts/lib/kcwiki-bgm.mjs 的
 * KNOWN_TRANSCRIPTION_FIXES：钉上游现在写的东西，对不上就只告警、绝不硬改）。
 *
 * ---- 这一层为什么会错 ----
 *
 * 号是舰娘百科编辑填的一手贡献（日站从不给号），**这一半没人插手**；
 * 但号旁边那条人读标注是**手打的**，会打错。两件事分开判，别混成一句。
 *
 * ---- 怎么逮住的（2026-08-24，用户复查 62-5 X 点问出来的）----
 *
 * 軽母ヌ級 一族里，同名同数值、只有搭载机不同的变体靠标注区分（艦載機鳥白／黒／赤）。
 * 变体不同 = **不同的 mstId**，而搭载机不同 ⇒ **制空値必不同**——于是制空値就是
 * 涂装变体的独立指纹。取「整队只有它一个能带机」的干净格逐个量，两站各量一遍：
 *
 *   mstId 1765  kcwiki 干净格制空 106 ×4  ┃ wikiwiki「軽母ヌ級改elite(B)(艦載機鳥白)」106 ×4
 *   mstId 1778  kcwiki 干净格制空 132 ×5  ┃ wikiwiki「軽母ヌ級改elite(C)(艦載機黒)」 132 ×6
 *   mstId 1766  kcwiki 干净格制空 132 ×6  ┃ wikiwiki「軽母ヌ級改flagship(B)(艦載機鳥赤)」132 ×6
 *   mstId 1779  kcwiki 干净格制空 107 ×10 ┃ wikiwiki「軽母ヌ級改flagship(C)(艦載機赤)」107 ×10
 *
 * 逐格重合（1765 落 62-2 乙 J/K/M/N，1778 落 62-3 甲 Y、62-5 甲 X/P，
 * 1779 落 62-1 甲 A2/F/H/I，1766 落 62-2 甲 J/K/M/N），号与制空値两站**完全一致**，
 * 分歧只在那个词上。
 *
 * **裁哪一边错不靠「信谁」，靠自洽性**：舰娘百科把**同一条标注给了两个不同 mstId**
 *（1765 与 1778 都写「軽母ヌ級改 elite 艦載機鳥白」，1766 与 1779 都写「…艦載機鳥赤」），
 * 而两个 id 的制空値不同——同一条标注不可能同时对两种搭载机成立，这是**页内自相矛盾**，
 * 不需要相信任何一方就能判定它错。日站那边两个变体用两个词、且与制空値一一对应，自洽。
 * ⇒ 错在舰娘百科的标注，不在它的号。
 *
 * 只改**标注文本**，一个号都不动——号是这一域换源的全部理由，动它就把地基拆了。
 */
export const KNOWN_ABYSSAL_LABEL_FIXES = Object.freeze([
  {
    mstId: 1778,
    upstream: '軽母ヌ級改 elite 艦載機鳥白',
    correct: '軽母ヌ級改 elite 艦載機黒',
    why: '与 1765（真·鳥白，制空 106）撞了同一条标注；1778 干净格制空 132，日站同格写「(C)(艦載機黒)」也是 132',
    checkedAt: '2026-08-24',
  },
  {
    mstId: 1779,
    upstream: '軽母ヌ級改 flagship 艦載機鳥赤',
    correct: '軽母ヌ級改 flagship 艦載機赤',
    why: '与 1766（真·鳥赤，制空 132）撞了同一条标注；1779 干净格制空 107，日站同格写「(C)(艦載機赤)」也是 107',
    checkedAt: '2026-08-24',
  },
])

/** 比对用的归一：只抹空白差（舰娘百科同一条标注时有时无那个空格），不动字。 */
const labelFingerprint = (label) => `${label ?? ''}`.replace(/\s+/g, '')

/**
 * 台账落地：**只在上游仍旧写着那个错值时**改写那一格的标注，其余情形一概不动、只报状态。
 *
 * 键是 `mstId`，不是标注文本——1765 与 1778 的错标注只差一个空格，
 * 按文本改必然误伤那个本来就对的号。
 *
 * @returns { applied: Map<mstId, 次数>, retire: [mstId], mismatched: [{ mstId, found }] }
 */
export const applyAbyssalLabelFixes = (nodes) => {
  const applied = new Map()
  const retire = new Set()
  const mismatched = new Map()
  for (const node of Object.values(nodes ?? {})) {
    for (const comp of node?.enemyComps ?? []) {
      const labels = comp?.labels
      if (!Array.isArray(labels)) continue
      for (const [index, id] of (comp.ships ?? []).entries()) {
        const fix = KNOWN_ABYSSAL_LABEL_FIXES.find((one) => one.mstId === id)
        if (!fix) continue
        const here = labelFingerprint(labels[index])
        if (here === labelFingerprint(fix.upstream)) {
          labels[index] = fix.correct
          applied.set(fix.mstId, (applied.get(fix.mstId) ?? 0) + 1)
        } else if (here === labelFingerprint(fix.correct)) {
          retire.add(fix.mstId)
        } else {
          mismatched.set(fix.mstId, labels[index])
        }
      }
    }
  }
  return {
    applied,
    retire: [...retire],
    mismatched: [...mismatched].map(([mstId, found]) => ({ mstId, found })),
  }
}

const ABYSSAL_RANKS = ['flagship', 'elite']

/**
 * 一条深海标注 → 配对键 `基名|等级`。
 *
 * 两家的写法都要吃得下：
 *   wikiwiki `(後衛)軽母ヌ級elite(E)(艦載機白弱)` → `軽母ヌ級|elite`
 *   kcwiki   `軽母ヌ級 elite 艦載機鳥白`          → `軽母ヌ級|elite`
 * 站位说明 `(後衛)`、括号注解、空格分隔的注解词一律剥掉；等级两家都写英文，直接认。
 */
export const abyssalJoinKey = (label) => {
  let text = `${label ?? ''}`
    .normalize('NFKC')
    .replace(/\[\[/g, '')
    .replace(/\]\]?/g, '')
    .trim()
  // 开头的 (後衛)/(前衛) 是站位说明，不是名字的一部分
  text = text.replace(/^[（(][^（）()]*[）)]\s*/, '')
  text = text.replace(/[（(][^（）()]*[）)]/g, ' ')
  let rank = ''
  for (const one of ABYSSAL_RANKS) {
    const pattern = new RegExp(`\\s*${one}\\s*`)
    if (pattern.test(text)) {
      rank = one
      text = text.replace(pattern, ' ')
      break
    }
  }
  // 剥完括号与等级之后，第一段是基名，后面是形态注解（`艦載機鳥赤` 这类）
  const base = text.trim().split(/\s+/).filter(Boolean)[0] ?? ''
  return `${base}|${rank}`
}

/** 一套编成的**展示序**键：逐位 `基名|等级`，保持顺序。同一套配置换个排法就是另一个键。 */
export const compJoinKey = (labels) => (labels ?? []).map(abyssalJoinKey).join(',')

/**
 * 一套编成的**配置键**：逐位 `基名|等级` 排序后拼接——**不认排列顺序**。
 *
 * 跨源对齐只能用这一个。2026-08-24 逐难度实测 62-5 的 X 点：日站把「同一支舰队
 * 的两种阵形」拆成两条 パターン 行，而**两行的舰船排列顺序不一样**——
 *
 *   甲 パターン1  ヌ級改elite、ツ級elite、タ級flagship、タ級flagship、ニ級後期型×2  輪形
 *   甲 パターン2  タ級flagship、タ級flagship、ヌ級改elite、ツ級elite、ニ級後期型×2  単縦
 *
 * 舰娘百科则把这两行并成一条、阵形格写「単縦 輪形」。拿保持顺序的键去配，
 * パターン1 永远配不上任何一条，于是它以**没有号的重复行**落进包里：
 * 同一个点同一套舰队、同一个阵形，玩家看到「确认编成 3/3」里有一条既没有号、
 * 又和上一条说的是同一件事。这不是「日站独有的编成」，是配对失败的残渣。
 *
 * 排列顺序本身两家都不可靠（日站两行自相矛盾），所以它不进配对键。
 * 包里**照旧按舰娘百科那一条的顺序**存——那一条带号，号与顺序是对齐的。
 */
export const compConfigKey = (labels) =>
  (labels ?? [])
    .map(abyssalJoinKey)
    .sort()
    .join(',')

/**
 * 一「模式」= 配置 + 阵形。同一个点同一套配置出现两种阵形，那是**两个模式**，
 * 不是两家在打架——62-5 的 X 点两家各记到其中一半，硬按点位配对就会编出假冲突。
 * 所以同源内先把一套配置的阵形收成并集，跨源比的是这两个并集。
 */
const formationSetOf = (comps) => {
  const out = new Set()
  for (const comp of comps ?? []) {
    for (const id of formationIdsOf(comp.formation)) out.add(id)
  }
  return out
}

/** 按配置键把一侧的编成分组，顺带算出这套配置在本源记到的全部阵形。 */
const groupByConfig = (comps, shipsOf) => {
  const groups = new Map()
  for (const comp of comps ?? []) {
    const key = compConfigKey(shipsOf(comp))
    let group = groups.get(key)
    if (!group) {
      group = { comps: [], formations: new Set() }
      groups.set(key, group)
    }
    group.comps.push(comp)
    for (const id of formationIdsOf(comp.formation)) group.formations.add(id)
  }
  return groups
}

/** 报告里的阵形栏：只有一个取值就写标量，多个才写成表——读的人是维护者。 */
const soleOrList = (values) => {
  const distinct = []
  for (const value of values) {
    if (!distinct.some((one) => JSON.stringify(one) === JSON.stringify(value))) distinct.push(value)
  }
  return distinct.length === 1 ? distinct[0] : distinct
}

/** 一手实测那一根：本机遭遇志与 KCNav 人肉见证，都独立于 wiki 那条转录链。 */
export const FIRST_HAND_VOTES = Object.freeze(['ledger', 'kcnav'])

/** wiki 那一根：两家同祖，几张都只算一根。 */
const WIKI_VOTES = Object.freeze(['kcwiki', 'wikiwiki'])

/** 印证状态（只给维护者侧工具与报告用；运行时一行不读，UI 不逐条挂标）。 */
export const eventCompCorroborationOf = (comp) => {
  if (comp?.conflict) return '冲突待裁'
  const votes = comp?.votes ?? []
  // 「多源一致」要的是**两根独立的根**都在场，不是「票够两张」。
  // 只有实测票没有 wiki 票也不升——那是一手观察，不是两源一致。
  const firstHand = votes.some((one) => FIRST_HAND_VOTES.includes(one))
  const wiki = votes.some((one) => WIKI_VOTES.includes(one))
  if (firstHand && wiki) return '多源一致'
  return votes.length >= 2 ? '同源转录' : '单源待印证'
}

/**
 * 掉落域的印证状态。两 wiki 在这一域根本不并列（kcwiki 的活动掉落表不分难度，
 * 见文件头），所以只有「有没有账本票」两档 + 单源。
 */
export const eventDropCorroborationOf = (entry) =>
  (entry?.votes ?? []).includes('ledger') ? '多源一致' : '单源待印证'

/**
 * 两站各自的毛病（与文件头那一段同一份，导出是为了让它进对账报告——
 * 报告的读者不会去翻源码头注）。每条都要写得出是哪一格实证出来的。
 */
export const EVENT_SOURCE_QUALITY = Object.freeze({
  读法: '「同源转录」说的是两家祖宗是一个，不是说两家抄得一样好。下面每条都有实证的那一格。',
  kcwiki: Object.freeze([
    '整档漏收：62-5 丙 G 点只记两档，漏了「潜水夏姫II(B)/ソ級/ヌ級/ハ級後期×2/ロ級」那一档' +
      '（日站有；KCNav 人肉见证 2026-08-24 实测 ×3，3/114 ≈ 2.6%，低频档）。' +
      '⇒「kcwiki 没写」不能读成「不存在」，日站独有配置照收不丢那条规矩是这个毛病的兜底',
    '涂装标注写错：同名同数值、只有搭载机不同的变体被填成同一条标注——1778 落 62-3 甲 Y 与' +
      ' 62-5 甲 X/P，1779 落 62-1 甲 A2/F/H/I（台账 KNOWN_ABYSSAL_LABEL_FIXES）。' +
      '号是对的，错的是号旁边那行字',
  ]),
  wikiwiki: Object.freeze([
    '某一层的阵形栏整列填同一个值：62-5 丙层 G 点三条 パターン 清一色「単縦」、' +
      'X 点三条清一色「輪形」，而它自己甲乙丁三层都是有变化的；两格都被 KCNav 实测否掉' +
      '（裁决 RESOLVED_EVENT_COMP_CONFLICTS）。⇒ 丙层阵形栏单独看不足信，要跨四层摊开看',
  ]),
})

/**
 * 一条冲突的稳定指纹。台账靠它**自失效**：任意一边改了那一格指纹就变，
 * 旧裁决认领不上，对账脚本会把它重新报成未裁项。
 */
export const eventCompConflictFingerprint = (conflict) =>
  `${conflict.map}/${conflict.difficulty}/${conflict.node}` +
  `[${(conflict.ships ?? []).join('.')}]` +
  `f:${JSON.stringify(conflict.kcwikiFormation)}|${JSON.stringify(conflict.wikiwikiFormation)}`

/**
 * 已裁的冲突（形态照 map-drops / fit-bonus 两处台账：指纹 + verdict + decidedAt + why；
 * 本域多一栏 `evidence`，把证据链逐条列开——揉成一段散文，下一个人就分不清
 * 「哪一条是一手实测、哪一条只是旁证」，而这一域的裁决全靠这个分界站得住）。
 *
 * 空表不是「没冲突」，是「还没有人裁过」——脚本自己一条都不许往里写。
 *
 * ---- 裁决在这一域做什么、不做什么 ----
 *
 *   · 做：把包里那一条的 `conflict` 标撤掉——它不再是待裁项了。
 *   · **不改取值**：取值本来就按基座源（kcwiki）取，裁给 kcwiki 只是确认「基座源那一格是对的」，
 *     一个字段都不动；也**不把被否掉的那一侧补成第二个模式**（见下方 `if (conflict) continue`
 *     那一段的注释）——补上去等于把已经判废的票写进包里。
 *   · **不删条目**：冲突每轮重算，条目照旧进对账报告，只是多带裁语。删掉的话下一轮它又
 *     冒出来当新的待裁项，人再裁一遍，而这次裁过的痕迹一点不剩。
 *
 * 指纹自失效：上游任意一边改了那一格，指纹就变 → 裁决认领不上 → 条目重新以未裁形态出现，
 * 同时 `staleEventCompVerdicts` 把这条无主裁决报出来要求重核。
 */
export const RESOLVED_EVENT_COMP_CONFLICTS = Object.freeze([
  {
    fingerprint: '62-5/丙/G[1755.1776.1509.1591.1577.1577]f:3|1',
    verdict: 'kcwiki',
    decidedAt: '2026-08-24',
    why:
      '用户 2026-08-24 人肉浏览 KCNav 拿到 G 点的实测终审票（kuma 对该站零请求，' +
      '这是他一手见证的转述）：丙难度过滤后一共三行——' +
      '欧州棲姫档 **輪形 ×28、単縦 ×0**；潜水夏姫II(B)/ソ級/ヌ級/ハ級後期×2/ロ級 档 単縦 ×3；' +
      '潜水夏姫II 全潜档（制空 0）単縦 ×83。' +
      '\n争议的是第一档（第 1 Boss 的最终形态，旗舰欧州棲姫）。**身份是锁死的**：' +
      '除编成构成吻合外，KCNav 那一行的制空阈值 63/125/281/561 反解出制空 187' +
      '（÷3 = 187），与两站记录的该档制空値逐字一致——不是「拿另一档硬认」。' +
      '\n实测 輪形 ×28、単縦 **零观测** ⇒ 日站（wikiwiki）丙层写的 単縦 被否定；' +
      '这已是它在 62-5 丙层被实测否掉的第二格（X 点同批），加上「四难度里唯独丙写単縦」' +
      '的孤例形状与丙层整列同值的填写质量旁证，三重实锤。' +
      '\n⇒ 裁给 kcwiki：撤销这一条的 conflict 标，**取值一个字段都不动**' +
      '（基座源本来就是輪形），也不把日站那个 単縦 补成第二个模式。',
    evidence: [
      '一手实测：用户 KCNav 人肉见证 2026-08-24——G 点按丙难度过滤后三行，' +
        '欧州棲姫档 輪形 ×28 / 単縦 ×0，另两档 単縦 ×3 与 単縦 ×83（人工浏览记录，kuma 没有对该站的抓取脚本）',
      '身份锁定（制空指纹）：争议行的制空阈值 63/125/281/561 ⇒ 制空 187，' +
        '与两站记录的欧州棲姫最终形态档制空 187 一致；同点另两档一个是削血阶段的潜水夏姫II 队、' +
        '一个是全潜档（制空 0），三档互不混淆',
      '跨层一致旁证：这一条最终形态行日站自己写 甲=輪形 / 乙=輪形 / 丁=輪形，只有丙层写 単縦；' +
        '且丙层 G 点三条 パターン 的阵形格清一色「単縦」，而甲乙丁三层都是「単縦/単縦/輪形」——' +
        '整列同值，像是填下来的',
      '编成成员经逐格数值指纹核对过（2026-08-24，随包 abyssal-stats 反查，' +
        '台账见 KCNAV_WITNESSED_COMPS）：六格里五格唯一命中 kcwiki 写的号，' +
        '轻母那一格数值三解、由制空 187 钉定 1776，**一格错都没有**——' +
        '中途「实测与 kcwiki 有出入」的怀疑是悬浮卡列序读反（那四个数是 火力·対空 / 雷装·装甲）造成的',
    ],
  },
  {
    fingerprint: '62-5/丙/X[1542.1777.1592.1578.1578.1503]f:1|3',
    verdict: 'kcwiki',
    decidedAt: '2026-08-24',
    why:
      '用户 2026-08-24 人肉浏览 KCNav 拿到 X 点的实测终审票（kuma 对该站零请求，' +
      '这是他一手见证的转述）：丙难度过滤后一共三行——単縦 ×64、単縦 ×302、輪形 ×201。' +
      '\n日站（wikiwiki）丙层主张这一点三条 パターン **全是輪形**——实测里有两行単縦，' +
      '**形状不容，直接否定**，不需要先信谁（其丙层三条阵形格整列同值、而甲乙丁三层都是' +
      '「輪形/単縦/単縦」的填写质量旁证早已在案）。' +
      '\nkcwiki 的模型则逐行命中：非 elite 档那一条写「単縦 輪形」＝同一支队的两个阵形' +
      '（对应 ×302 与 ×201），elite 档这一条只写 単縦（对应 ×64）——三行的形状唯一吻合。' +
      '样本 64/302/201，置信充分。' +
      '\n⇒ 裁给 kcwiki：撤销这一条的 conflict 标，**取值一个字段都不动**' +
      '（本来就按基座源取的 単縦），也不把日站那个 輪形 补成第二个模式。',
    evidence: [
      '一手实测：用户 KCNav 人肉见证 2026-08-24——X 点按丙难度过滤后三行，' +
        '単縦 ×64 / 単縦 ×302 / 輪形 ×201（人工浏览记录；艦ログ与 KCNav 一样只许人肉看，kuma 没有抓取脚本）',
      '形状论证：三行 = 非 elite 档的两个阵形（単縦 + 輪形）+ elite 档的単縦。' +
        '日站「三条全輪形」凑不出那两行単縦，两个形状不相容 ⇒ 日站丙层被否定，' +
        'kcwiki 的两档模型是唯一能生成这三行的解',
      '跨层一致旁证：X 点这一档日站自己写 甲=単縦 / 乙=単縦 / 丁=単縦，只有丙层写 輪形；' +
        '且丙层 X 点三条 パターン 的阵形格清一色「輪形」，而甲乙丁三层都是「輪形/単縦/単縦」——' +
        '整列同值，像是填下来的',
      '⚠ 编成成员**未经**逐格指纹核对：这一轮 X 点的悬浮卡没展开，只有行数与阵形。' +
        '阵形裁决靠的是「三行的形状唯一吻合」，不依赖逐格身份，所以这一条照裁；' +
        '但 X 的三行**一票 kcnav 都不发**（发票门槛是身份钉得住，见 KCNAV_WITNESSED_COMPS）。' +
        '同批 G 点展开过卡、逐格核到 kcwiki 全对，X 这边等他回 KCNav 展开再补证',
    ],
  },
])

export const eventCompConflictVerdict = (conflict) => {
  const fingerprint = eventCompConflictFingerprint(conflict)
  return RESOLVED_EVENT_COMP_CONFLICTS.find((one) => one.fingerprint === fingerprint) ?? null
}

/** 一条编成在见证台账里的键。形状与冲突指纹同族，同样是**上游一改就认领不上**。 */
export const eventCompWitnessKey = ({ map, difficulty, node, ships }) =>
  `${map}/${difficulty}/${node}[${(ships ?? []).join('.')}]`

/**
 * **KCNav 人肉见证台账**：用户人肉浏览 KCNav（kuma 对该站零请求）逐条记下来的实测样本。
 * 认领上的编成加一票 `kcnav`——它与本机遭遇志同属「一手实测」那一根，
 * 于是那一条从「同源转录」升到「多源一致」（wiki 一根 + 实测一根，两根独立）。
 *
 * ---- 发票的门槛：身份要被**逐格数值指纹**钉住 ----
 *
 * 见证是人眼读悬浮卡再转述，比机器记的账本多两道手。所以「我在这一点看到过 N 次」
 * 本身不够——得先证明看到的**就是这一条**。判据是把卡上每一格的
 * `HP / 火力 / 対空 / 雷装 / 装甲` 拿随包 abyssal-stats 反查，钉到确切 mstId。
 *
 * ⚠ 两个真会咬人的坑，写在这里免得下一个人重踩：
 *
 *   1. **列序**。悬浮卡那四个数是「火力·対空 / 雷装·装甲」，不是「火力·雷装 / 対空·装甲」。
 *      2026-08-24 按后者读，882 条里一条都配不上，差点得出「kcwiki 写错了」的结论；
 *      按前者读，六格里五格当场唯一命中。**一格都配不上 ≠ 上游错了，先怀疑自己的列序**。
 *   2. **轻母那一格数值指纹不唯一**。1762/1776/1777 三个变体的
 *      HP70/火15/対空15/雷0/装甲35 **完全相同**，差别只在搭载的机上——正是
 *      `KNOWN_ABYSSAL_LABEL_FIXES` 记的那个族。数值钉不动它，得靠**制空値**再钉一次：
 *      KCNav 卡上的四档制空阈值 63/125/281/561 反解出敌方制空 187（阈值就是
 *      1/3・2/3・3/2・3 倍），与 kcwiki 给这一行记的制空 187 逐字一致，
 *      而三个变体的制空必不同（搭载机不同）⇒ 认 kcwiki 写的那个 1776。
 *      反算还能自己闭合：同旗舰的丁层没有轻母、制空 61 ⇒ 欧州棲姫自身 61
 *      （60 机 × 対空8：⌊√60×8⌋=61）；187−61=126 正是 1776 那三格
 *      ⌊√26×10⌋+⌊√23×8⌋×2 = 50+38+38。整条对得上，一个数都不用凑。
 *
 * 只有 62-5 丙 G 这三行展开过悬浮卡，所以**只有这三行发票**。同一轮 X 点也有见证
 *（行数与阵形），但卡没展开、身份钉不住，**一票不发**——阵形裁决用得上它，
 * 印证升档用不上，两件事分开判。
 */
export const KCNAV_WITNESSED_COMPS = Object.freeze([
  {
    key: '62-5/丙/G[1755.1776.1509.1591.1577.1577]',
    samples: 28,
    formation: '輪形',
    witnessedAt: '2026-08-24',
    pinned:
      '1755 欧州棲姫（HP880 火300 対空130 雷0 装甲205，唯一解）／' +
      '1776 軽母ヌ級 elite 艦載機鳥白（HP70 火15 対空15 雷0 装甲35——数值三解 1762/1776/1777，' +
      '由制空 187 钉定：61 欧州棲姫 + 126 这一格，逐项闭合）／' +
      '1509 重巡リ級（HP58 火32 対空16 雷32 装甲28，唯一解，非 elite）／' +
      '1591 軽巡ツ級（HP48 火58 対空88 雷84 装甲55，唯一解，非 elite）／' +
      '1577 駆逐ハ級後期型 ×2（HP38 火44 対空36 雷72 装甲29，唯一解）',
    note: 'kcwiki 这一行的六格逐格无误——「实测与档案有出入」是悬浮卡列序读反造成的，不是上游错',
  },
  {
    key: '62-5/丙/G[1977.1570.1570.1591.1577.1577]',
    samples: 83,
    formation: '単縦',
    witnessedAt: '2026-08-24',
    pinned:
      '1977 潜水夏姫II（HP108 火44 対空0 雷139 装甲19，唯一解）／' +
      '1570 潜水ソ級 ×2（HP33 火24 対空0 雷70 装甲15，唯一解）／' +
      '1591 軽巡ツ級（唯一解）／1577 駆逐ハ級後期型 ×2（唯一解）。制空 0，与该档无搭载机自洽',
    note: '六格全部唯一命中，两站与实测三方一致',
  },
  {
    key:
      '62-5/丙/G[潜水夏姫II(A)(HP108).潜水ソ級.軽母ヌ級elite(C)(艦載機鳥白)' +
      '.駆逐ハ級後期型.駆逐ハ級後期型.駆逐ロ級]',
    samples: 3,
    formation: '単縦',
    witnessedAt: '2026-08-24',
    pinned:
      '1977 潜水夏姫II（唯一解）／1570 潜水ソ級（唯一解）／' +
      '軽母ヌ級 elite（HP70 火15 対空15 雷0 装甲35——数值三解 1762/1776/1777，' +
      '这一行 KCNav 没给制空阈值，**变体钉不死，不补号**）／' +
      '1577 駆逐ハ級後期型 ×2（唯一解）／1502 駆逐ロ級（HP22 火7 対空7 雷16 装甲6，唯一解）',
    note:
      '**这一档 kcwiki 整档漏收**（丙层它只记两档），靠日站独有配置照收不丢那条规矩才留在包里；' +
      'KCNav 实测 ×3（3/114 ≈ 2.6%）证实它真实存在，不是日站编的。' +
      '这一行照旧没有号——号只从 kcwiki 那一行来，而 kcwiki 根本没写这一档；' +
      '数值指纹能钉住其中五格，但轻母那一格钉不死，硬补就是猜号，那条路已经退役',
  },
])

/** 这一条编成有没有人肉见证票。认键不认位置——上游改了舰列，票就认领不上了。 */
export const eventCompWitness = (key) =>
  KCNAV_WITNESSED_COMPS.find((one) => one.key === key) ?? null

/**
 * 无主的见证票：台账里写着、这一轮却一条都认领不上的。
 * 与 `staleEventCompVerdicts` 同一个道理——少了这一半，上游改了舰列，
 * 票会安安静静地不再生效，只表现成「印证计数少了一格」，谁也不知道是票作废了。
 */
export const staleKcnavWitnesses = (claimedKeys) => {
  const seen = new Set(claimedKeys ?? [])
  return KCNAV_WITNESSED_COMPS.filter((one) => !seen.has(one.key))
}

/**
 * **未裁**冲突的旁证注记。跟裁决表是两张表，别混：
 * 这里写的是「核这一条时手头有哪些别的证据」，**不改任何取值**，
 * 也不把 `conflict` 标撤掉——包里那一条照旧是冲突待裁。注记只进对账报告。
 *
 * 与裁决表同用一枚指纹，所以上游一改那一格，注记也会自动认领不上
 *（`staleEventCompNotes` 会把它报出来），不会留着一条过期旁证骗下一个人。
 *
 * ⚠ **一枚指纹只许出现在一张表里**。2026-08-24 62-5 丙 G/X 两条结案时，
 * 注记连同它的 `watch` 一起搬进了 `RESOLVED_EVENT_COMP_CONFLICTS` 的 `evidence`——
 * 留一份副本在这里的话，报告会既说「已结案」又挂着「打到这格留意什么」，
 * 而观察指引的意思是「这一格还没定」。护栏在 test/map-intel-event-comps.test.mjs。
 *
 * 现在是空表：两条都裁完了，不是体例作废了。下一条未裁冲突照这个形状写。
 */
export const EVENT_COMP_CONFLICT_NOTES = Object.freeze([])

export const eventCompConflictNote = (conflict) => {
  const fingerprint = eventCompConflictFingerprint(conflict)
  return EVENT_COMP_CONFLICT_NOTES.find((one) => one.fingerprint === fingerprint) ?? null
}

/**
 * 一个点位的**跨难度全模式对齐表**：两站 × 甲乙丙丁 × 每条模式，逐行摊平。
 *
 * 这张表是「这一格到底谁错」唯一能看清的形状——单看一个难度层，两站各说一句
 * 就成了各执一词；四层摊开，填写异常的那一层会自己跳出来（2026-08-24 实测：
 * 62-5 X 点日站丙层三条 パターン 阵形格清一色「輪形」，而它自己甲乙丁三层
 * 都是「輪形/単縦/単縦」）。
 *
 * 键名用中文：这张表是给人读的，不进运行时。
 */
export const buildNodeAlignment = ({ code, node, byDifficulty }) => {
  const rows = []
  for (const [difficulty, sides] of Object.entries(byDifficulty ?? {})) {
    for (const [index, comp] of (sides?.kcwiki ?? []).entries()) {
      rows.push({
        难度: difficulty,
        源: 'kcwiki',
        模式: `K${index + 1}`,
        阵形: comp.formation,
        制空: comp.air ?? null,
        编成: (comp.labels ?? []).join('／'),
        号: (comp.ships ?? []).join(','),
      })
    }
    for (const [index, comp] of (sides?.wikiwiki ?? []).entries()) {
      rows.push({
        难度: difficulty,
        源: 'wikiwiki',
        // 日站表内顺序即 パターン 顺序（解析器按行读，不重排）
        模式: `パターン${index + 1}`,
        阵形: comp.formation,
        制空: null,
        编成: (comp.ships ?? []).join('／'),
        号: '（日站从不给号）',
        ...(comp.phase ? { 阶段: comp.phase } : {}),
      })
    }
  }
  return { map: code, node, 读法: '同一难度里，看两站的「阵形」列对不对得上；再横向看四个难度层，哪一层的填法与其余三层不同', rows }
}

/** 认领不上任何现存冲突的旁证注记：上游改了那一格，注记要重核。 */
export const staleEventCompNotes = (conflicts) => {
  const seen = new Set((conflicts ?? []).map((one) => eventCompConflictFingerprint(one)))
  return EVENT_COMP_CONFLICT_NOTES.filter((one) => !seen.has(one.fingerprint))
}

/** 认领不上任何现存冲突的旧裁决：多半是上游改了那一格，要人重核。 */
export const staleEventCompVerdicts = (conflicts) => {
  const seen = new Set((conflicts ?? []).map((one) => eventCompConflictFingerprint(one)))
  return RESOLVED_EVENT_COMP_CONFLICTS.filter((one) => !seen.has(one.fingerprint))
}

/**
 * 汇编一张活动图**一个难度层**的敌编成。
 *
 * @param code          海域代号（`62-1`）
 * @param difficulty    难度字（甲/乙/丙/丁）
 * @param kcwikiNodes   parseKcwikiMapPage(该难度 tab).nodes —— 基座源，自带 mstId
 * @param wikiwikiNodes 现行活动层的 `nodes`（`enemyComps[].ships` 是标注文本）
 * @param ledger        loadLedgerEventVotes().comps
 * @returns { nodes, conflicts, stats, witnessKeys }
 */
export const mergeEventDifficultyComps = ({
  code,
  difficulty,
  kcwikiNodes = {},
  wikiwikiNodes = {},
  ledger = new Map(),
}) => {
  const nodes = {}
  const conflicts = []
  const witnessKeys = []
  const stats = {
    comps: 0,
    withIds: 0,
    multi: 0,
    transcribed: 0,
    single: 0,
    conflict: 0,
    kcwikiOnly: 0,
    wikiwikiOnly: 0,
    ledgerBacked: 0,
    kcnavWitnessed: 0,
  }

  const letters = new Set([
    ...Object.keys(kcwikiNodes).filter((node) => kcwikiNodes[node]?.enemyComps?.length),
    ...Object.keys(wikiwikiNodes).filter((node) => wikiwikiNodes[node]?.enemyComps?.length),
  ])

  for (const node of [...letters].sort()) {
    // 跨源对齐的单位是**一套配置**（含 elite/flagship 变体档），不是一行。
    // 一套配置在一个源里记到几种阵形，那是几个**模式**——两家各记到其中一半
    // 是常态（62-5 的 X 点实测：日站拆成两行、舰娘百科并成一行写「単縦 輪形」）。
    // 所以：同源内先按配置把阵形收成并集，跨源比的是两个并集，
    // **两个并集完全不相交**才是两家在互相否定。
    const kcGroups = groupByConfig(kcwikiNodes[node]?.enemyComps, (comp) => comp.labels ?? [])
    const wwGroups = groupByConfig(wikiwikiNodes[node]?.enemyComps, (comp) => comp.ships ?? [])
    const pairedWw = new Set()

    const out = []
    for (const [key, kcGroup] of kcGroups) {
      const wwGroup = wwGroups.get(key)
      if (wwGroup) pairedWw.add(key)
      let conflict = null
      // 裁过的冲突：标撤掉，取值一个字段都不动（见 RESOLVED_EVENT_COMP_CONFLICTS 头注）。
      // 分成两个变量而不是把 conflict 置空，是因为下面「补日站那一个模式」那一段
      // 仍然要按**检出过冲突**来跳过——已结案 = 被否掉的那一侧判废，更不该补进包里。
      let settled = false
      if (wwGroup && ![...kcGroup.formations].some((id) => wwGroup.formations.has(id))) {
        conflict = 'formation'
        const one = {
          map: code,
          difficulty,
          node,
          ships: kcGroup.comps[0].ships,
          labels: kcGroup.comps[0].labels ?? [],
          kind: conflict,
          kcwikiFormation: soleOrList(kcGroup.comps.map((comp) => comp.formation)),
          wikiwikiFormation: soleOrList(wwGroup.comps.map((comp) => comp.formation)),
        }
        const decided = eventCompConflictVerdict(one)
        settled = Boolean(decided)
        const noted = eventCompConflictNote(one)
        conflicts.push({
          ...one,
          ...(decided ?? {}),
          ...(noted?.note ? { note: noted.note } : {}),
          ...(noted?.watch ? { watch: noted.watch } : {}),
        })
      }

      for (const comp of kcGroup.comps) {
        if (!wwGroup) stats.kcwikiOnly += 1
        // 削甲/最終形態 这类阶段标注只有日站给。同一套配置在日站有好几行时，
        // 先认阵形对得上的那一行——阶段跟着模式走，不跟着配置走。
        const mine = new Set(formationIdsOf(comp.formation))
        const twin =
          wwGroup?.comps.find((one) => formationIdsOf(one.formation).some((id) => mine.has(id))) ??
          wwGroup?.comps.find((one) => one.phase)
        const votes = wwGroup ? ['kcwiki', 'wikiwiki'] : ['kcwiki']
        if (ledger.get(`${code}|${difficulty}|${compKey(comp.ships)}`)) votes.push('ledger')
        out.push({
          formation: comp.formation,
          ships: comp.ships,
          labels: comp.labels ?? [],
          ...(twin?.phase ? { phase: twin.phase } : {}),
          votes,
          // 结案的不再挂标，其余字段照原样——「销标不改值」。
          // **裁决本身不发票**：`votes` 由 KCNAV_WITNESSED_COMPS 单独认领，门槛是
          //「逐格数值指纹钉得住身份」，与「阵形裁给谁」是两件事。所以会出现
          // 「裁决用了 KCNav 那一手观察、这一条却没有 kcnav 票」——X 点正是这样
          //（行数与阵形有，悬浮卡没展开，身份钉不住），那不是漏了，是判据不同。
          ...(conflict && !settled ? { conflict } : {}),
        })
      }

      // 同一套配置上，日站**另外记到的一个模式**：补一行照收。
      //
      // 判据必须是「这一行的阵形与基座源记到的**一个都不沾**」，不能是「不被完全盖住」。
      // 后者会把最常见的覆盖差当成新模式：舰娘百科写「警戒 単縦」、日站写
      //「単縦 複縦 警戒」（62-4 丙 J 实测），两边说的是同一个模式、日站只是多写了一档，
      // 按「没被盖住」去补就会补出一条几乎一模一样的重复行。
      // 一个都不沾才是另一个模式——判据与上面的冲突判据同一把尺，只是尺度从
      //「整组」缩到「单行」：整组不沾 = 两家互相否定（上面已打冲突标，这里不再补行，
      // 取值照旧按基座源等人裁）；整组有交集、单行不沾 = 日站多记到的另一个模式。
      // 号仍然只从舰娘百科那一行来，这里不跨行借号——
      //「同一个多重集就是同一支舰队」也是推断，猜号那条路已经退役。
      //
      // 已结案的也照旧跳过（判据是 `conflict` 而不是 `conflict && !settled`）：
      // 裁决把日站那一侧判废了，补上去等于把废票摆成「另一个并存的模式」。
      if (conflict) continue
      const emitted = new Set()
      for (const comp of wwGroup?.comps ?? []) {
        const ids = formationIdsOf(comp.formation)
        if (ids.some((id) => kcGroup.formations.has(id))) continue
        const signature = JSON.stringify([ids, comp.phase ?? null])
        if (emitted.has(signature)) continue
        emitted.add(signature)
        out.push({
          formation: comp.formation,
          ships: comp.ships,
          ...(comp.phase ? { phase: comp.phase } : {}),
          votes: ['wikiwiki'],
        })
        stats.wikiwikiOnly += 1
      }
    }

    // 日站独有的那些配置**照收不丢**——它们没有号（日站从不给号），
    // 运行时按既有的模糊命中降级显示，不在这里靠名字猜形态。
    for (const [key, group] of wwGroups) {
      if (pairedWw.has(key)) continue
      for (const comp of group.comps) {
        out.push({
          formation: comp.formation,
          ships: comp.ships,
          ...(comp.phase ? { phase: comp.phase } : {}),
          votes: ['wikiwiki'],
        })
        stats.wikiwikiOnly += 1
      }
    }

    if (!out.length) continue
    // KCNav 人肉见证票：按 (图/难度/点[舰列]) 认领。发票的门槛与「日站独有配置照收」
    // 那一段无关——认领上就加票，认领不上就一个字都不动（台账见 KCNAV_WITNESSED_COMPS）。
    for (const comp of out) {
      const key = eventCompWitnessKey({ map: code, difficulty, node, ships: comp.ships })
      if (!eventCompWitness(key)) continue
      comp.votes = [...comp.votes, 'kcnav']
      witnessKeys.push(key)
    }
    nodes[node] = out
    for (const comp of out) {
      stats.comps += 1
      if (comp.ships.every((ship) => typeof ship === 'number')) stats.withIds += 1
      if (comp.votes.includes('ledger')) stats.ledgerBacked += 1
      if (comp.votes.includes('kcnav')) stats.kcnavWitnessed += 1
      const status = eventCompCorroborationOf(comp)
      if (status === '冲突待裁') stats.conflict += 1
      else if (status === '多源一致') stats.multi += 1
      else if (status === '同源转录') stats.transcribed += 1
      else stats.single += 1
    }
  }

  return { nodes, conflicts, stats, witnessKeys }
}

/**
 * 本机遭遇志（第一方一手）。**有 IO**，与上面的纯逻辑分开。
 *
 * 活动图这一域比常规图多一件好事：`encounters.difficulty` 就是当时选的难度
 *（1 丁 / 2 丙 / 3 乙 / 4 甲，与主数据 `selectedRank` 同一套编号），
 * 所以这张票能**钉到难度层**，不像常规图那样只能钉到图。
 *
 * ⚠ 但**钉不到点**：`encounters.cell` 是罗盘 `api_no`（边号），
 * 要变成 wiki 的点位字母得再过一层推导，那一层的错法是「把编成挂到错的点上」，
 * 比少一张票坏得多。所以编成票按 (图, 难度, 舰列) 归，掉落票按 (图, 难度, 舰) 归。
 *
 * 早于难度列存在的旧记录 `difficulty IS NULL` **一票都不投**——
 * 「多半也是丙」是推测，不是证据。它们只在报告里报个数。
 */
export const LEDGER_DIFFICULTY_NAMES = Object.freeze({ 1: '丁', 2: '丙', 3: '乙', 4: '甲' })

export const loadLedgerEventVotes = ({ dbPath = null, mapAreaId = 0 } = {}) => {
  const file = dbPath ?? userDataPathIfAny('mg.sqlite')
  const comps = new Map()
  const drops = new Map()
  const stats = { rows: 0, undifferentiated: 0, comps: 0, drops: 0 }
  if (!file || !existsSync(file)) return { comps, drops, stats }
  try {
    const { DatabaseSync } = require('node:sqlite')
    const db = new DatabaseSync(file, { readOnly: true })
    try {
      const rows = db
        .prepare(
          'SELECT map, difficulty, comp, drop_mst FROM encounters WHERE map >= ? AND map < ?',
        )
        .all(mapAreaId * 10, (mapAreaId + 1) * 10)
      for (const row of rows) {
        stats.rows += 1
        const difficulty = LEDGER_DIFFICULTY_NAMES[Number(row.difficulty)]
        if (!difficulty) {
          stats.undifferentiated += 1
          continue
        }
        const code = `${Math.floor(row.map / 10)}-${row.map % 10}`
        let ids = []
        try {
          ids = JSON.parse(row.comp).filter((id) => Number.isInteger(id) && id > 0)
        } catch (_error) {
          ids = []
        }
        if (ids.length) {
          const key = `${code}|${difficulty}|${compKey(ids)}`
          const entry = comps.get(key) ?? { samples: 0 }
          entry.samples += 1
          comps.set(key, entry)
        }
        const drop = Number(row.drop_mst)
        if (Number.isInteger(drop) && drop > 0) {
          const key = `${code}|${difficulty}|${drop}`
          const entry = drops.get(key) ?? { samples: 0 }
          entry.samples += 1
          drops.set(key, entry)
        }
      }
    } finally {
      db.close()
    }
  } catch (error) {
    console.warn(`[lodes]   本机遭遇志读不到（第一方那张票缺席）：${error.message}`)
  }
  stats.comps = comps.size
  stats.drops = drops.size
  return { comps, drops, stats }
}

/**
 * 舰娘百科活动海域页的取数口。900 ms 间隔实测零 429（2026-08-22 常规图 37 连抓
 * 定的礼貌频率，这里只有 5 页）。
 */
export const kcwikiEventPageQuery = (page) =>
  'https://zh.kcwiki.cn/api.php?action=parse&prop=text&format=json&formatversion=2' +
  `&disablelimitreport=1&redirects=1&page=${encodeURIComponent(page)}`
