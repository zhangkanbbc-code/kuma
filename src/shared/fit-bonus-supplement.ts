// 装备加成的**第一方自补层**（覆盖缺口，不是数值分歧）。
//
// 随包的 `kcwiki-fit-bonus` 目前收到 mstId 565 为止，566–588 这 23 件**整件缺席**。
// 缺席与「查过了、它没有加成」不是一回事：`fitPackUncovered` 会把它们报成「暂无预期数据」，
// 玩家看到的是一片空白，而这几件里 22 件在日文一手上是有蓝字的。
//
// ---- 为什么不走修正台账 ----
//
// `fit-bonus-corrections.ts` 的机制是「钉着上游某一行的指纹叠一层补正」。上游根本没有这几件，
// 钉不上指纹 → 那套机制在这里用不了。所以另开这一层：**无 watch、直接给 rules**，
// 与修正台账同族（都是第一方台账、加载时叠在 CC 包上、都不改包文件），但自失效的判据反过来——
// 修正台账盯的是「上游那一行变了没」，自补层盯的是「上游开始收这件了没」。
//
// ---- 自失效：kcwiki 一收录就召回复审 ----
//
// `applyFitBonusSupplement` 发现包里已经有这个 id，就**整条跳过并告警**（`recall`），
// 既不静默叠加（那会与上游行相加，凭空翻倍），也不静默丢弃（那会让这一层无声消失）。
// 护栏在 test/fit-bonus-supplement.test.mjs：构造一份「上游已覆盖」的 fixture，断言它真的变红。
//
// ---- 许可与印证 ----
//
// 与修正台账同理：**数值本身是事实**（「Bofors 12cm単装両用砲 在 Gotland 上 火力+2」），
// 逐条带依据转写进第一方台账合法；不合法的是把 wikiwiki 的页面/文件拼进包。
// 参考来源按集中署名口径写在 NOTICE.md，逐条不署名，只带页名与该页最后编辑日期。
//
// **每条的印证状态都是「单源待印证」**：只有 wikiwiki 一张票（EO 那份是 NOASSERTION，
// 一格数都不许抄）。这一层进的是**预期值轨**——预期值轨本身就是「按资料应该加多少」的框架，
// 与面板反推的实测轨并列显示，所以 UI 不为它另挂一块牌子。页面自己标了「?」「不明」「変動」
// 的档位保真在 `provisional` 里，那是给维护者看的内部标记。
//
// ---- 转写口径（与包同一个共同分母）----
//
//   · 只转写**単体ボーナス / 改修ボーナス**两张表；相互シナジー表整表不转写——
//     协同行要钉搭档装备的 mstId 与槽位占用语义，本层不做，逐件记在 `deferred` 里。
//   · 分档写的是**该档的总值**（与 `expectedFitBonus` 的 byStar 同语义），不是增量。
//   · 「艦名記載は、その値が適用される一番下の改造段階が基準」——有这句才按改造链向上继承；
//     一个形态归给**基准最深**的那条行。链展开用 api_aftershipid，遇 api_ctype 变化即停
//     （Glorious 巡洋戦艦⇄正規空母 那种跨级改装不是「更高改造段階」）。
//   · 累積欄：◯ → perEquip，× → once，? / 不明 → once（宁可少算，并记进 `provisional`），
//     変動 → byCount（1本目/2本目以降 展开成逐件总值）。
//   · 国籍类目（「イギリス艦」「上記以外の日駆逐」…）**转写不了**：本方 `FitWhoSet` 只有
//     形态/舰级/舰种/全部四维，展开成上百个形态 id 会随游戏更新失真。逐条记进 `deferred`，
//     不猜、也不静默丢。
//
// 本文件由 arbitration/gen-supplement-ts.mjs 生成：人只填「日文表在这一格给多少」与
// 「対象艦那一格写的是谁」，形态展开、归属、`not` 补集全部机器算。

// **这个文件只准 `import type`**（同 fit-bonus-corrections.ts：有一个值导入，node --test 就跑不动它）。
import type { FitBonusData, FitEquipEntry, FitRule } from './fit-bonus'

export interface FitBonusSupplementRule {
  /** 与包同形的规则行。`row` 从 1 起，按日文表的行序 */
  rule: FitRule
  /** 这一行的「対象艦」原文与落地依据（给人读的锚，不参与判定） */
  via: string
}

export interface FitBonusSupplementEntry {
  equipId: number
  /** 装备日文原名 */
  equipName: string
  /** api_type[2] 装备种别 */
  type2: number
  /** 日文出处是哪一页 */
  source: string
  /** 来源页最后编辑日期（wikiwiki 的 Last-modified） */
  sourceUpdatedAt: string
  /** 印证状态。本层一律「单源待印证」——只有 wikiwiki 一张票 */
  corroboration: '单源待印证'
  rules: readonly FitBonusSupplementRule[]
  /** 页面自标「?」「不明」「変動」的档位，保真为内部标记；UI 不另挂牌 */
  provisional?: readonly string[]
  /** 取到票却**没转写进来**的行，逐条写明为什么。不许静默丢 */
  deferred?: readonly string[]
  /** 页在、但整页没有「装備ボーナスについて」小节 = 确认它当前没有单体加成（防重查） */
  confirmedNone?: true
  addedAt: string
}

export const FIT_BONUS_SUPPLEMENT: readonly FitBonusSupplementEntry[] = Object.freeze([
  {
    equipId: 566,
    equipName: '10.2cm三連装副砲',
    type2: 4,
    source: 'wikiwiki.jp/kancolle「10.2cm三連装副砲」装備ボーナス表',
    sourceUpdatedAt: '2026-07-27',
    corroboration: '单源待印证',
    rules: [
      {
        rule: {
          row: 1,
          who: { classes: [134] },
          gain: {
            kind: 'byStar',
            steps: [
              { from: 0, to: null, stats: { fire: 2, evasion: 2, accuracy: 2 } },
              { from: 7, to: null, stats: { fire: 3, evasion: 2, accuracy: 2 } },
              { from: 8, to: null, stats: { fire: 3, evasion: 2, accuracy: 3 } },
            ],
          },
          stack: 'perEquip',
        },
        via: 'Glorious/改(巡洋戦艦) = api_ctype 134（Glorious 1022 与 Glorious改 740）',
      },
    ],
    provisional: [
      '原表第一档写「★0~3」，下一档直接跳到「★+7」，★4~6 没列——这里按「该档起至下一档之前」连续读',
    ],
    deferred: [
      '相互シナジー：本装備＋38.1cm Mk.I連装砲／38.1cm Mk.I／N連装砲改 ×2 → Glorious 火力+3 対空+1 回避+1 命中+1（累積×）',
    ],
    addedAt: '2026-08-22',
  },
  {
    equipId: 567,
    equipName: 'Sea Gladiator',
    type2: 6,
    source: 'wikiwiki.jp/kancolle「Sea Gladiator」装備ボーナス表',
    sourceUpdatedAt: '2026-07-27',
    corroboration: '单源待印证',
    rules: [
      {
        rule: {
          row: 1,
          who: { nations: [5] },
          gain: {
            kind: 'byStar',
            steps: [
              { from: 0, to: null, stats: { aa: 1, evasion: 2 } },
              { from: 7, to: null, stats: { aa: 1, evasion: 3 } },
              { from: 8, to: null, stats: { aa: 2, evasion: 3 } },
            ],
          },
          stack: 'perEquip',
        },
        via: '「イギリス艦」——国籍类目，走 who.nations（英国 = ship-nationality id 5，判据是 api_sort_id 的 33000 段）',
      },
    ],
    provisional: [
      '原表第一档写「★0~3」，下一档直接跳到「★+7」，★4~6 没列——这里按「该档起至下一档之前」连续读（同 566 号）',
      '页面自标「改修値変動の法則性はまだ不明。詳しい調査待ち。表中の改修段は暫定のものです」',
      '「イギリス艦」按号段判。上游这一页**没有**为 Верный/丹陽 这类跨国改造形态写例外，所以照号段落；上游哪天写了明文，以明文为准',
    ],
    addedAt: '2026-08-22',
  },
  {
    equipId: 568,
    equipName: '強風改二(熟練)',
    type2: 45,
    source: 'wikiwiki.jp/kancolle「強風改二(熟練)」装備ボーナス表',
    sourceUpdatedAt: '2026-07-27',
    corroboration: '单源待印证',
    rules: [
      {
        rule: {
          row: 1,
          who: { forms: [501, 506] },
          gain: { kind: 'flat', flat: { fire: 2, aa: 5, evasion: 3, accuracy: 2 } },
          stack: 'once',
        },
        via: '最上改二 / 特',
      },
      {
        rule: {
          row: 2,
          who: { forms: [502, 507] },
          gain: { kind: 'flat', flat: { fire: 1, aa: 4, evasion: 3, accuracy: 2 } },
          stack: 'once',
        },
        via: '三隈改二 / 特',
      },
      {
        rule: {
          row: 3,
          who: { forms: [73, 121, 129, 130, 503, 504, 508, 509] },
          gain: { kind: 'flat', flat: { fire: 1, aa: 3, evasion: 2, accuracy: 1 } },
          stack: 'once',
        },
        via: '最上改・三隈改・鈴谷改/改二・熊野改/改二（改二系两行更深，按最深基准归给上面两行）',
      },
    ],
    provisional: [
      '三行的累積欄都写「不明」——页面自己没确认叠不叠，这里按不叠（once）取，宁可少算',
    ],
    deferred: [
      '改修ボーナス：本装備 ★+3 火力+1，但那张表没有 対象艦 列，判不出是全艦娘还是承接上面三档，不猜',
    ],
    addedAt: '2026-08-22',
  },
  {
    equipId: 569,
    equipName: '三式爆雷投射機改',
    type2: 15,
    source: 'wikiwiki.jp/kancolle「三式爆雷投射機改」装備ボーナス表',
    sourceUpdatedAt: '2026-07-27',
    corroboration: '单源待印证',
    rules: [
      {
        rule: {
          row: 1,
          who: { forms: [982, 1033] },
          gain: { kind: 'flat', flat: { evasion: 1, asw: 1, accuracy: 1 } },
          stack: 'once',
        },
        via: '玉波改二・早波改二',
      },
      {
        rule: {
          row: 2,
          who: { forms: [564, 648] },
          gain: { kind: 'flat', flat: { evasion: 1, accuracy: 1 } },
          stack: 'once',
        },
        via: '秋雲改二・風雲改二',
      },
      {
        rule: {
          row: 3,
          who: { classes: [101], types: [1] },
          gain: { kind: 'flat', flat: { accuracy: 1 } },
          stack: 'once',
        },
        via: '松型駆逐艦（api_ctype 101）＋海防艦（api_stype 1）',
      },
      {
        rule: {
          row: 4,
          who: { forms: [154, 343, 356, 465] },
          gain: { kind: 'flat', flat: { evasion: 2, asw: 3 } },
          stack: 'once',
        },
        via: '香取・鹿島',
      },
    ],
    provisional: [
      '四行的累積欄都写「不明」——按不叠（once）取',
      '「松型駆逐艦海防艦*2」与「香取・鹿島*3」挂着脚注 *2 / *3，正文没随表带出来，未据以改数',
    ],
    deferred: [
      '改修ボーナス：★+6 回避+1、★+8 対潜+1 回避+1，那张表没有 対象艦 列，判不出适用面，不猜',
    ],
    addedAt: '2026-08-22',
  },
  {
    equipId: 570,
    equipName: '流星改(友永隊)',
    type2: 8,
    source: 'wikiwiki.jp/kancolle「流星改(友永隊)」装備ボーナス表',
    sourceUpdatedAt: '2026-08-14',
    corroboration: '单源待印证',
    rules: [
      {
        rule: {
          row: 1,
          who: { forms: [1031] },
          gain: {
            kind: 'byStar',
            steps: [
              { from: 0, to: 5, stats: { fire: 9, aa: 2, evasion: 2, accuracy: 3 } },
              { from: 6, to: 7, stats: { fire: 9, aa: 2, evasion: 2, accuracy: 4 } },
              { from: 8, to: 9, stats: { fire: 10, aa: 2, evasion: 2, accuracy: 4 } },
              { from: 10, to: null, stats: { fire: 10, aa: 2, evasion: 2, accuracy: 5 } },
            ],
          },
          stack: 'perEquip',
        },
        via: '飛龍改三',
      },
      {
        rule: {
          row: 2,
          who: { forms: [196] },
          gain: {
            kind: 'byStar',
            steps: [
              { from: 0, to: 5, stats: { fire: 8, aa: 1, evasion: 1, accuracy: 2 } },
              { from: 6, to: 7, stats: { fire: 8, aa: 1, evasion: 1, accuracy: 3 } },
              { from: 8, to: 9, stats: { fire: 9, aa: 1, evasion: 1, accuracy: 3 } },
              { from: 10, to: null, stats: { fire: 9, aa: 1, evasion: 1, accuracy: 4 } },
            ],
          },
          stack: 'perEquip',
        },
        via: '飛龍改二（飛龍改三 有自己更深的基准行）',
      },
      {
        rule: {
          row: 3,
          who: { forms: [91, 197, 280] },
          gain: {
            kind: 'byStar',
            steps: [
              { from: 0, to: 5, stats: { fire: 4, aa: 1, accuracy: 1 } },
              { from: 6, to: 7, stats: { fire: 4, aa: 1, accuracy: 2 } },
              { from: 8, to: 9, stats: { fire: 5, aa: 1, accuracy: 2 } },
              { from: 10, to: null, stats: { fire: 5, aa: 1, accuracy: 3 } },
            ],
          },
          stack: 'perEquip',
        },
        via: '飛龍・蒼龍改二',
      },
      {
        rule: {
          row: 4,
          who: { forms: [90, 279] },
          gain: {
            kind: 'byStar',
            steps: [
              { from: 0, to: 5, stats: { fire: 3, accuracy: 1 } },
              { from: 6, to: 7, stats: { fire: 3, accuracy: 2 } },
              { from: 8, to: 9, stats: { fire: 4, accuracy: 2 } },
              { from: 10, to: null, stats: { fire: 4, accuracy: 3 } },
            ],
          },
          stack: 'perEquip',
        },
        via: '蒼龍',
      },
      {
        rule: {
          row: 5,
          who: {
            forms: [83, 84, 110, 111, 112, 153, 156, 277, 278, 288, 461, 462, 466, 467, 594, 599, 610, 646, 698],
          },
          gain: {
            kind: 'byStar',
            steps: [
              { from: 0, to: 5, stats: { fire: 2, accuracy: 1 } },
              { from: 6, to: 7, stats: { fire: 2, accuracy: 2 } },
              { from: 8, to: 9, stats: { fire: 3, accuracy: 2 } },
              { from: 10, to: null, stats: { fire: 3, accuracy: 3 } },
            ],
          },
          stack: 'perEquip',
        },
        via: '赤城・加賀・翔鶴・瑞鶴・大鳳',
      },
      {
        rule: {
          row: 6,
          who: { all: true },
          gain: {
            kind: 'byStar',
            steps: [
              { from: 6, to: 7, stats: { accuracy: 1 } },
              { from: 8, to: 9, stats: { fire: 1, accuracy: 1 } },
              { from: 10, to: null, stats: { fire: 1, accuracy: 2 } },
            ],
          },
          stack: 'perEquip',
          not: {
            forms: [
              83,
              84,
              90,
              91,
              110,
              111,
              112,
              153,
              156,
              196,
              197,
              277,
              278,
              279,
              280,
              288,
              461,
              462,
              466,
              467,
              594,
              599,
              610,
              646,
              698,
              1031,
            ],
          },
        },
        via: '他（上面各行点名之外的全部）',
      },
    ],
    addedAt: '2026-08-22',
  },
  {
    equipId: 571,
    equipName: '53cm連装魚雷改(酸素魚雷)',
    type2: 5,
    source: 'wikiwiki.jp/kancolle「53cm連装魚雷改(酸素魚雷)」装備ボーナス表',
    sourceUpdatedAt: '2026-08-14',
    corroboration: '单源待印证',
    rules: [
      {
        rule: {
          row: 1,
          who: { forms: [591, 592, 694, 954] },
          gain: {
            kind: 'byStar',
            steps: [
              { from: 6, to: 6, stats: { fire: 1, torpedo: 9, evasion: 4, accuracy: 2 } },
              { from: 7, to: null, stats: { fire: 1, torpedo: 10, evasion: 4, accuracy: 2 } },
            ],
          },
          stack: 'once',
        },
        via: '金剛改二丙・比叡改二丙・榛名改二丙・霧島改二丙',
      },
      {
        rule: {
          row: 2,
          who: { forms: [593] },
          gain: {
            kind: 'byStar',
            steps: [
              { from: 6, to: 6, stats: { torpedo: 8, evasion: 3, accuracy: 1 } },
              { from: 7, to: null, stats: { torpedo: 9, evasion: 3, accuracy: 1 } },
            ],
          },
          stack: 'once',
        },
        via: '榛名改二乙',
      },
      {
        rule: {
          row: 3,
          who: { forms: [488, 622, 623, 624] },
          gain: {
            kind: 'byStar',
            steps: [
              { from: 6, to: 6, stats: { fire: 3, torpedo: 9, evasion: 6, accuracy: 2 } },
              { from: 7, to: 7, stats: { fire: 3, torpedo: 10, evasion: 6, accuracy: 2 } },
              { from: 8, to: 9, stats: { fire: 3, torpedo: 10, evasion: 6, accuracy: 3 } },
              { from: 10, to: null, stats: { fire: 3, torpedo: 11, evasion: 12, accuracy: 3 } },
            ],
          },
          stack: 'once',
        },
        via: '夕張改二・由良改二',
      },
      {
        rule: {
          row: 4,
          who: { forms: [363, 370, 371, 387, 471, 472, 473, 474, 475, 476] },
          gain: {
            kind: 'byStar',
            steps: [
              { from: 6, to: 6, stats: { fire: 1, torpedo: 8, evasion: 3, accuracy: 2 } },
              { from: 7, to: null, stats: { fire: 1, torpedo: 9, evasion: 3, accuracy: 2 } },
            ],
          },
          stack: 'once',
        },
        via: '神風・朝風・春風・松風・旗風',
      },
      {
        rule: {
          row: 5,
          who: { all: true },
          gain: {
            kind: 'byStar',
            steps: [{ from: 6, to: 6, stats: { torpedo: 1 } }, { from: 7, to: null, stats: { torpedo: 2 } }],
          },
          stack: 'once',
          not: {
            forms: [363, 370, 371, 387, 471, 472, 473, 474, 475, 476, 488, 591, 592, 593, 622, 623, 624, 694, 954],
          },
        },
        via: '上記の艦以外',
      },
    ],
    provisional: [
      '全表累積欄写「?」——按不叠（once）取',
    ],
    deferred: [
      '相互シナジー 5 行（本装備★+6/+7 × 35.6cm連装砲改三丙／35.6cm連装砲改四／96式150cm探照灯）——协同行要钉搭档装备的 mstId 与槽位占用语义，本层只做単体轨',
    ],
    addedAt: '2026-08-22',
  },
  {
    equipId: 572,
    equipName: '12.7cm単装高角砲改三',
    type2: 1,
    source: 'wikiwiki.jp/kancolle「12.7cm単装高角砲改三」装備ボーナス表',
    sourceUpdatedAt: '2026-08-19',
    corroboration: '单源待印证',
    rules: [
      {
        rule: {
          row: 1,
          who: { all: true },
          gain: {
            kind: 'byStar',
            steps: [
              { from: 7, to: 7, stats: { aa: 1 } },
              { from: 8, to: 8, stats: { fire: 1, aa: 1 } },
              { from: 9, to: 9, stats: { fire: 1, aa: 1, evasion: 1 } },
              { from: 10, to: null, stats: { fire: 1, aa: 1, evasion: 1, accuracy: 1 } },
            ],
          },
          stack: 'perEquip',
        },
        via: '改修ボーナス · 全艦娘',
      },
      {
        rule: {
          row: 2,
          who: { forms: [1035, 1040] },
          gain: { kind: 'flat', flat: { fire: 5, aa: 5, evasion: 4, asw: 2, accuracy: 2 } },
          stack: 'perEquip',
        },
        via: '吹雪改三/改三護(六式)',
      },
      {
        rule: {
          row: 3,
          who: { forms: [961] },
          gain: { kind: 'flat', flat: { fire: 5, aa: 4, evasion: 4, asw: 2, accuracy: 2 } },
          stack: 'perEquip',
        },
        via: '時雨改三',
      },
      {
        rule: {
          row: 4,
          who: { forms: [651, 656] },
          gain: { kind: 'flat', flat: { fire: 3, aa: 3, evasion: 3, asw: 2 } },
          stack: 'perEquip',
        },
        via: '丹陽/雪風改二',
      },
      {
        rule: { row: 5, who: { classes: [21] }, gain: { kind: 'flat', flat: { fire: 1 } }, stack: 'perEquip' },
        via: '天龍型',
      },
      {
        rule: {
          row: 6,
          who: { forms: [477, 478] },
          gain: { kind: 'flat', flat: { fire: 1, aa: 2, asw: 2 } },
          stack: 'perEquip',
        },
        via: '天龍型改二',
      },
      {
        rule: {
          row: 7,
          who: { forms: [141, 487] },
          gain: { kind: 'flat', flat: { fire: 2, aa: 3, asw: 2 } },
          stack: 'perEquip',
        },
        via: '五十鈴改二・鬼怒改二',
      },
      {
        rule: {
          row: 8,
          who: { forms: [160] },
          gain: { kind: 'flat', flat: { fire: 2, aa: 3, evasion: 1, asw: 2 } },
          stack: 'perEquip',
        },
        via: '那珂改二',
      },
      {
        rule: {
          row: 9,
          who: { forms: [220] },
          gain: { kind: 'flat', flat: { fire: 2, aa: 3, asw: 1 } },
          stack: 'perEquip',
        },
        via: '由良改（由良改二 有自己更深的基准行）',
      },
      {
        rule: {
          row: 10,
          who: { forms: [22, 23, 56, 113, 219, 224, 289] },
          gain: { kind: 'flat', flat: { fire: 2, aa: 2, asw: 1 } },
          stack: 'perEquip',
        },
        via: '五十鈴・鬼怒・那珂・由良',
      },
      {
        rule: {
          row: 11,
          who: { forms: [24, 25, 57, 58] },
          gain: { kind: 'flat', flat: { fire: 2, aa: 2 } },
          stack: 'perEquip',
        },
        via: '北上・大井',
      },
      {
        rule: {
          row: 12,
          who: { forms: [624] },
          gain: { kind: 'flat', flat: { fire: 1, aa: 2, asw: 3 } },
          stack: 'perEquip',
        },
        via: '夕張改二丁',
      },
      {
        rule: {
          row: 13,
          who: { forms: [622] },
          gain: { kind: 'flat', flat: { fire: 1, aa: 2, asw: 1 } },
          stack: 'perEquip',
        },
        via: '夕張改二',
      },
      {
        rule: {
          row: 14,
          who: { forms: [115, 293, 623] },
          gain: { kind: 'flat', flat: { fire: 1, asw: 1 } },
          stack: 'perEquip',
        },
        via: '夕張/改/改二特',
      },
      {
        rule: {
          row: 15,
          who: { forms: [146, 547, 652, 657] },
          gain: { kind: 'flat', flat: { fire: 2, aa: 2 } },
          stack: 'once',
        },
        via: '球磨改二/改二丁・多摩改二・木曾改二（累積×）',
      },
      {
        rule: {
          row: 16,
          who: { forms: [981, 1033] },
          gain: { kind: 'flat', flat: { fire: 1, aa: 1, evasion: 2, asw: 1 } },
          stack: 'perEquip',
        },
        via: '玉波改二・藤波改二',
      },
      {
        rule: {
          row: 17,
          who: { forms: [1034] },
          gain: { kind: 'flat', flat: { aa: 1, evasion: 1, asw: 1 } },
          stack: 'perEquip',
        },
        via: '涼波改二',
      },
      {
        rule: {
          row: 18,
          who: { classes: [38] },
          gain: { kind: 'flat', flat: { aa: 1, evasion: 1 } },
          stack: 'perEquip',
          not: {
            forms: [
              22,
              23,
              24,
              25,
              56,
              57,
              58,
              113,
              115,
              118,
              119,
              141,
              146,
              160,
              219,
              220,
              224,
              289,
              293,
              477,
              478,
              487,
              488,
              547,
              622,
              623,
              624,
              651,
              652,
              656,
              657,
              961,
              981,
              1033,
              1034,
              1035,
              1040,
            ],
          },
        },
        via: '上記以外の夕雲型',
      },
      {
        rule: {
          row: 19,
          who: { classes: [66, 28], types: [1] },
          gain: { kind: 'flat', flat: { fire: 1, aa: 2 } },
          stack: 'perEquip',
        },
        via: '神風型・睦月型・海防艦',
      },
      {
        rule: {
          row: 20,
          who: { types: [21, 16] },
          gain: { kind: 'flat', flat: { fire: 1, aa: 1 } },
          stack: 'perEquip',
        },
        via: '練習巡洋艦・水上機母艦',
      },
      {
        rule: {
          row: 21,
          who: { classes: [101] },
          gain: {
            kind: 'byCount',
            counts: [
              { count: 1, stats: { fire: 3, aa: 4, evasion: 3 } },
              { count: 2, stats: { fire: 4, aa: 6, evasion: 4 } },
              { count: 3, stats: { fire: 5, aa: 8, evasion: 5 } },
              { count: 4, stats: { fire: 6, aa: 10, evasion: 6 } },
            ],
          },
          stack: 'table',
        },
        via: '松型 1本目 +3/+4/+3、2本目以降 +1/+2/+1（累積 変動）',
      },
      {
        rule: {
          row: 22,
          who: { forms: [118, 119] },
          gain: {
            kind: 'byCount',
            counts: [
              { count: 1, stats: { fire: 2, aa: 2, evasion: 2 } },
              { count: 2, stats: { fire: 4, aa: 4, evasion: 3 } },
              { count: 3, stats: { fire: 6, aa: 6, evasion: 4 } },
              { count: 4, stats: { fire: 8, aa: 8, evasion: 5 } },
            ],
          },
          stack: 'table',
        },
        via: '北上改二・大井改二 1本目 +2/+2/+2、2本目以降 +2/+2/+1（累積 変動）',
      },
      {
        rule: {
          row: 23,
          who: { forms: [488] },
          gain: {
            kind: 'byCount',
            counts: [
              { count: 1, stats: { fire: 2, aa: 4, evasion: 2, asw: 2 } },
              { count: 2, stats: { fire: 4, aa: 8, evasion: 3, asw: 4 } },
              { count: 3, stats: { fire: 6, aa: 12, evasion: 4, asw: 6 } },
              { count: 4, stats: { fire: 8, aa: 16, evasion: 5, asw: 8 } },
            ],
          },
          stack: 'table',
        },
        via: '由良改二 1本目 +2/+4/+2/+2、2本目以降 +2/+4/+2/+1（累積 変動）',
      },
    ],
    provisional: [
      '「1本目 / 2本目以降」三行的累積欄写「変動」：这里按「首件给首档、其后每件加一份」展开成逐件总值，上限取 4 件（驱逐/轻巡的槽位上限）——原表没写上限',
    ],
    deferred: [
      '相互シナジー 12 行（12.7cm単装高角砲改二/改三 × 水上電探*3 / 対空電探*4 / 試製 23号電探改三 各档）——协同行要钉搭档装备的 mstId 与「几件」的槽位占用语义，本层只做単体轨',
    ],
    addedAt: '2026-08-22',
  },
  {
    equipId: 573,
    equipName: '試製 23号電探改三',
    type2: 12,
    source: 'wikiwiki.jp/kancolle「試製 23号電探改三」装備ボーナス表',
    sourceUpdatedAt: '2026-07-27',
    corroboration: '单源待印证',
    rules: [
      {
        rule: {
          row: 1,
          who: { forms: [651, 656, 961, 979, 1035, 1040] },
          gain: {
            kind: 'byStar',
            steps: [
              { from: 0, to: 6, stats: { fire: 2, evasion: 3, accuracy: 3 } },
              { from: 7, to: 7, stats: { fire: 2, evasion: 3, accuracy: 4 } },
              { from: 8, to: 8, stats: { fire: 2, evasion: 4, accuracy: 4 } },
              { from: 9, to: 9, stats: { fire: 3, evasion: 4, accuracy: 4 } },
              { from: 10, to: null, stats: { fire: 3, evasion: 4, accuracy: 5 } },
            ],
          },
          stack: 'once',
        },
        via: '吹雪改三/改三護(六式)・時雨改三・丹陽/雪風改二・稲木改二（累積×）',
      },
    ],
    deferred: [
      '相互シナジー 4 行（本装備各★档 × 12.7cm単装高角砲改二/改三 → 全艦娘 回避/命中）——协同行本层只做単体轨',
    ],
    addedAt: '2026-08-22',
  },
  {
    equipId: 574,
    equipName: 'SCレーダー改(後期調整型)',
    type2: 12,
    source: 'wikiwiki.jp/kancolle「SCレーダー改(後期調整型)」装備ボーナス表',
    sourceUpdatedAt: '2026-07-27',
    corroboration: '单源待印证',
    rules: [
      {
        rule: {
          row: 1,
          who: { forms: [632, 633, 651, 656, 703, 725, 961, 1035, 1040] },
          gain: {
            kind: 'byStar',
            steps: [
              { from: 0, to: 4, stats: { fire: 2, aa: 4, evasion: 4, accuracy: 3 } },
              { from: 5, to: 5, stats: { fire: 2, aa: 4, evasion: 4, accuracy: 4 } },
              { from: 6, to: 6, stats: { fire: 3, aa: 4, evasion: 4, accuracy: 4 } },
              { from: 7, to: 7, stats: { fire: 3, aa: 5, evasion: 4, accuracy: 4 } },
              { from: 8, to: 8, stats: { fire: 4, aa: 5, evasion: 4, accuracy: 4 } },
              { from: 9, to: 9, stats: { fire: 4, aa: 5, evasion: 5, accuracy: 4 } },
              { from: 10, to: null, stats: { fire: 4, aa: 5, evasion: 5, accuracy: 5 } },
            ],
          },
          stack: 'once',
        },
        via: '吹雪改三/改三護(六式)・時雨改三・丹陽/雪風改二・有明・夕暮（累積×）',
      },
      {
        rule: {
          row: 2,
          who: { forms: [629] },
          gain: {
            kind: 'byStar',
            steps: [
              { from: 0, to: 4, stats: { fire: 1, aa: 3, evasion: 3, accuracy: 3 } },
              { from: 5, to: 5, stats: { fire: 1, aa: 3, evasion: 3, accuracy: 4 } },
              { from: 6, to: 6, stats: { fire: 2, aa: 3, evasion: 3, accuracy: 4 } },
              { from: 7, to: 7, stats: { fire: 2, aa: 4, evasion: 3, accuracy: 4 } },
              { from: 8, to: 8, stats: { fire: 3, aa: 4, evasion: 3, accuracy: 4 } },
              { from: 9, to: 9, stats: { fire: 3, aa: 4, evasion: 4, accuracy: 4 } },
              { from: 10, to: null, stats: { fire: 3, aa: 4, evasion: 4, accuracy: 5 } },
            ],
          },
          stack: 'once',
        },
        via: 'Fletcher Mk.II',
      },
      {
        rule: {
          row: 3,
          who: { forms: [628] },
          gain: {
            kind: 'byStar',
            steps: [
              { from: 0, to: 4, stats: { fire: 1, aa: 3, evasion: 4, accuracy: 2 } },
              { from: 5, to: 5, stats: { fire: 1, aa: 3, evasion: 4, accuracy: 3 } },
              { from: 6, to: 6, stats: { fire: 2, aa: 3, evasion: 4, accuracy: 3 } },
              { from: 7, to: 7, stats: { fire: 2, aa: 4, evasion: 4, accuracy: 3 } },
              { from: 8, to: 8, stats: { fire: 3, aa: 4, evasion: 4, accuracy: 3 } },
              { from: 9, to: 9, stats: { fire: 3, aa: 4, evasion: 5, accuracy: 3 } },
              { from: 10, to: null, stats: { fire: 3, aa: 4, evasion: 5, accuracy: 4 } },
            ],
          },
          stack: 'once',
        },
        via: 'Fletcher改 Mod.2',
      },
      {
        rule: {
          row: 4,
          who: { classes: [91, 87] },
          gain: {
            kind: 'byStar',
            steps: [
              { from: 0, to: 4, stats: { fire: 1, aa: 3, evasion: 3, accuracy: 2 } },
              { from: 5, to: 5, stats: { fire: 1, aa: 3, evasion: 3, accuracy: 3 } },
              { from: 6, to: 6, stats: { fire: 2, aa: 3, evasion: 3, accuracy: 3 } },
              { from: 7, to: 7, stats: { fire: 2, aa: 4, evasion: 3, accuracy: 3 } },
              { from: 8, to: 8, stats: { fire: 3, aa: 4, evasion: 3, accuracy: 3 } },
              { from: 9, to: 9, stats: { fire: 3, aa: 4, evasion: 4, accuracy: 3 } },
              { from: 10, to: null, stats: { fire: 3, aa: 4, evasion: 4, accuracy: 4 } },
            ],
          },
          stack: 'once',
          not: { forms: [628, 629, 632, 633, 651, 656, 703, 725, 961, 1035, 1040] },
        },
        via: '上記以外の Fletcher級（api_ctype 91）・Samuel B.Roberts（api_ctype 87）',
      },
    ],
    deferred: [
      '两行「装備＝対空電探」的类目行（吹雪改三系/天津風改二/秋雲改二/沖波改二 +1/+2/+3、玉波改二系 対空+2 回避+1）——那两行的主语是「対空電探」这个类目而不是本装備，本装備算不算进那个类目要先定「哪些 id 算対空電探」，包里故意没展开这一层，不猜',
      '相互シナジー：本装備 × 5inch単装砲 Mk.30改＋GFCS Mk.37★+5 → 全艦娘——协同行本层只做単体轨',
    ],
    addedAt: '2026-08-22',
  },
  {
    equipId: 575,
    equipName: '25mm連装機銃(熟練機銃員分隊)',
    type2: 21,
    source: 'wikiwiki.jp/kancolle「25mm連装機銃(熟練機銃員分隊)」装備ボーナス表',
    sourceUpdatedAt: '2026-08-19',
    corroboration: '单源待印证',
    rules: [
      {
        rule: {
          row: 1,
          who: { forms: [979] },
          gain: {
            kind: 'byStar',
            steps: [
              { from: 0, to: 6, stats: { aa: 3, evasion: 4 } },
              { from: 7, to: 7, stats: { aa: 4, evasion: 4 } },
              { from: 8, to: 8, stats: { aa: 4, evasion: 5 } },
              { from: 9, to: 9, stats: { aa: 4, evasion: 5, accuracy: 1 } },
              { from: 10, to: null, stats: { fire: 1, aa: 4, evasion: 5, accuracy: 1 } },
            ],
          },
          stack: 'perEquip',
        },
        via: '稲木改二',
      },
      {
        rule: {
          row: 2,
          who: { forms: [981, 982, 983, 1033, 1034] },
          gain: {
            kind: 'byStar',
            steps: [
              { from: 0, to: 6, stats: { fire: 2, aa: 1, evasion: 2, accuracy: 1 } },
              { from: 7, to: 7, stats: { fire: 2, aa: 2, evasion: 2, accuracy: 1 } },
              { from: 8, to: 8, stats: { fire: 2, aa: 2, evasion: 3, accuracy: 1 } },
              { from: 9, to: 9, stats: { fire: 2, aa: 2, evasion: 3, accuracy: 2 } },
              { from: 10, to: null, stats: { fire: 3, aa: 2, evasion: 3, accuracy: 2 } },
            ],
          },
          stack: 'perEquip',
        },
        via: '玉波改二・涼波改二・藤波改二・早波改二・浜波改二',
      },
      {
        rule: {
          row: 3,
          who: { classes: [38] },
          gain: {
            kind: 'byStar',
            steps: [
              { from: 0, to: 6, stats: { fire: 1, aa: 1, evasion: 2 } },
              { from: 7, to: 7, stats: { fire: 1, aa: 2, evasion: 2 } },
              { from: 8, to: 8, stats: { fire: 1, aa: 2, evasion: 3 } },
              { from: 9, to: 9, stats: { fire: 1, aa: 2, evasion: 3, accuracy: 1 } },
              { from: 10, to: null, stats: { fire: 2, aa: 2, evasion: 3, accuracy: 1 } },
            ],
          },
          stack: 'perEquip',
          not: { forms: [154, 343, 356, 465, 662, 663, 668, 979, 981, 982, 983, 1033, 1034] },
        },
        via: '上記以外の夕雲型',
      },
      {
        rule: {
          row: 4,
          who: { forms: [668] },
          gain: {
            kind: 'byStar',
            steps: [
              { from: 0, to: 7, stats: { aa: 3, evasion: 3 } },
              { from: 8, to: 8, stats: { aa: 4, evasion: 3 } },
              { from: 9, to: 9, stats: { aa: 4, evasion: 4 } },
              { from: 10, to: null, stats: { aa: 4, evasion: 4, accuracy: 1 } },
            ],
          },
          stack: 'perEquip',
        },
        via: '矢矧改二乙',
      },
      {
        rule: {
          row: 5,
          who: { forms: [662, 663] },
          gain: {
            kind: 'byStar',
            steps: [
              { from: 0, to: 7, stats: { aa: 2, evasion: 2 } },
              { from: 8, to: 8, stats: { aa: 3, evasion: 2 } },
              { from: 9, to: 9, stats: { aa: 3, evasion: 3 } },
              { from: 10, to: null, stats: { aa: 3, evasion: 3, accuracy: 1 } },
            ],
          },
          stack: 'perEquip',
        },
        via: '能代改二・矢矧改二',
      },
      {
        rule: {
          row: 6,
          who: { forms: [154, 343, 356, 465] },
          gain: { kind: 'flat', flat: { fire: 1, aa: 2, evasion: 2 } },
          stack: 'perEquip',
        },
        via: '25mm 各機銃（含本装備）→ 香取・鹿島',
      },
      {
        rule: {
          row: 7,
          who: { nations: [1], types: [2] },
          gain: {
            kind: 'byStar',
            steps: [
              { from: 0, to: 6, stats: { aa: 1, evasion: 1 } },
              { from: 7, to: 7, stats: { aa: 2, evasion: 1 } },
              { from: 8, to: 8, stats: { aa: 2, evasion: 2 } },
              { from: 9, to: 9, stats: { aa: 2, evasion: 2, accuracy: 1 } },
              { from: 10, to: null, stats: { fire: 1, aa: 2, evasion: 2, accuracy: 1 } },
            ],
          },
          stack: 'perEquip',
          not: { forms: [154, 343, 356, 465, 662, 663, 668, 979, 981, 982, 983, 1033, 1034], classes: [38] },
        },
        via: '「上記以外の日駆逐」——日本籍 × 駆逐艦（who.nations 与 who.types 是「且」）；除外＝表里点过名的那几个形态与夕雲型整级',
      },
      {
        rule: {
          row: 8,
          who: { nations: [1], types: [3] },
          gain: {
            kind: 'byStar',
            steps: [
              { from: 0, to: 7, stats: { evasion: 1 } },
              { from: 8, to: 8, stats: { aa: 1, evasion: 1 } },
              { from: 9, to: 9, stats: { aa: 1, evasion: 2 } },
              { from: 10, to: null, stats: { aa: 1, evasion: 2, accuracy: 1 } },
            ],
          },
          stack: 'perEquip',
          not: { forms: [154, 343, 356, 465, 662, 663, 668, 979, 981, 982, 983, 1033, 1034], classes: [38] },
        },
        via: '「上記以外の日軽巡」——日本籍 × 軽巡洋艦；香取・鹿島是練習巡洋艦(stype 21)，本来就不在这一档里',
      },
    ],
    provisional: [
      '「日駆逐」「日軽巡」的国籍按号段判。上游这一页**没有**为 Верный 这类跨国改造形态写例外，所以照号段落；上游哪天写了明文，以明文为准',
    ],
    deferred: [
      '相互シナジー：機銃×対空電探 → 香取・鹿島、対空機銃×12.7cm連装高角砲改二 → 曙改二・潮改二——协同行本层只做単体轨',
    ],
    addedAt: '2026-08-22',
  },
  {
    equipId: 576,
    equipName: '大発動艇(R35&フランス兵)',
    type2: 24,
    source: 'wikiwiki.jp/kancolle「大発動艇(R35＆フランス兵)」装備ボーナス表',
    sourceUpdatedAt: '2026-08-19',
    corroboration: '单源待印证',
    confirmedNone: true,
    rules: [],
    addedAt: '2026-08-22',
  },
  {
    equipId: 577,
    equipName: '61cm四連装(酸素)魚雷五型改三',
    type2: 5,
    source: 'wikiwiki.jp/kancolle「61cm四連装(酸素)魚雷五型改三」装備ボーナス表',
    sourceUpdatedAt: '2026-08-14',
    corroboration: '单源待印证',
    rules: [
      {
        rule: {
          row: 1,
          who: { forms: [961, 1035] },
          gain: {
            kind: 'byStar',
            steps: [
              { from: 4, to: 7, stats: { torpedo: 2, evasion: 1, accuracy: 1 } },
              { from: 8, to: null, stats: { torpedo: 3, evasion: 1, accuracy: 2 } },
            ],
          },
          stack: 'once',
        },
        via: '吹雪改三・時雨改三',
      },
      {
        rule: { row: 2, who: { forms: [662, 663] }, gain: { kind: 'flat', flat: { torpedo: 2 } }, stack: 'once' },
        via: '能代改二・矢矧改二',
      },
      {
        rule: {
          row: 6,
          who: { nations: [1], types: [2] },
          gain: {
            kind: 'byStar',
            steps: [
              { from: 4, to: 7, stats: { torpedo: 1 } },
              { from: 8, to: null, stats: { torpedo: 2, accuracy: 1 } },
            ],
          },
          stack: 'once',
          not: { forms: [961, 1035] },
        },
        via:
          '単体ボーナス1 ·「上記以外の日駆逐」——日本籍 × 駆逐艦；「上記」只指本小表上面那一行' +
          '（吹雪改三・時雨改三），**不含単体ボーナス2 的那几艘**：页面明写「※単体ボーナス＝単体ボーナス1＋単体ボーナス2」',
      },
      {
        rule: {
          row: 3,
          layer: '単体ボーナス2',
          who: { forms: [566, 567, 568, 648, 651, 656, 670, 915, 951, 961] },
          gain: {
            kind: 'byStar',
            steps: [
              { from: 0, to: 4, stats: { torpedo: 2, evasion: 1 } },
              { from: 5, to: 9, stats: { torpedo: 3, evasion: 1 } },
              { from: 10, to: null, stats: { fire: 1, torpedo: 3, evasion: 1 } },
            ],
          },
          stack: 'perEquip',
        },
        via: '単体ボーナス2 · 時雨改三・陽炎型改二(含丹陽)',
      },
      {
        rule: {
          row: 4,
          layer: '単体ボーナス2',
          who: { forms: [642, 706] },
          gain: {
            kind: 'byStar',
            steps: [
              { from: 0, to: 6, stats: { torpedo: 7, evasion: 2 } },
              { from: 7, to: 9, stats: { torpedo: 9, evasion: 2 } },
              { from: 10, to: null, stats: { torpedo: 11, evasion: 2 } },
            ],
          },
          stack: 'once',
        },
        via: '単体ボーナス2 · 竹（累積×）',
      },
      {
        rule: {
          row: 5,
          layer: '単体ボーナス2',
          who: {
            forms: [
              144,
              145,
              198,
              199,
              463,
              464,
              468,
              469,
              470,
              489,
              490,
              497,
              498,
              542,
              543,
              563,
              564,
              569,
              578,
              587,
              588,
              649,
              667,
              743,
              744,
              745,
              955,
              956,
              960,
              975,
              981,
              982,
              983,
              1033,
              1034,
              1040,
            ],
          },
          gain: {
            kind: 'byStar',
            steps: [
              { from: 0, to: 9, stats: { torpedo: 2, evasion: 1 } },
              { from: 10, to: null, stats: { fire: 1, torpedo: 2, evasion: 1 } },
            ],
          },
          stack: 'perEquip',
          not: { forms: [566, 567, 568, 642, 648, 651, 656, 662, 663, 670, 706, 915, 951, 961, 1035] },
        },
        via: '単体ボーナス2 · 白露型改二(時雨改三除く)・朝潮型改二・夕雲型改二・吹雪改三護(六式)',
      },
    ],
    provisional: [
      '単体ボーナス1 三行的累積欄写「?」——按不叠（once）取',
      '単体ボーナス2 的累積欄写「◯*1」「◯*2」，脚注正文没随表带出来，未据以改数',
      '「日駆逐」的国籍按号段判。上游这一页**没有**为 Верный 这类跨国改造形态写例外，所以照号段落；上游哪天写了明文，以明文为准（丹陽反倒是明写的——単体ボーナス2 第一行的対象艦原文就是「時雨改三・陽炎型改二(含丹陽)」，已按形态落在 row 3）',
    ],
    deferred: [
      '相互シナジー 3 行（本装備 × 水上電探*3 → 日駆逐 / 本装備・後期型 × 水上電探*4 → 能代改二・矢矧改二）——协同行本层只做単体轨',
    ],
    addedAt: '2026-08-22',
  },
  {
    equipId: 578,
    equipName: 'SB2U-2',
    type2: 7,
    source: 'wikiwiki.jp/kancolle「SB2U-2」装備ボーナス表',
    sourceUpdatedAt: '2026-07-27',
    corroboration: '单源待印证',
    rules: [
      {
        rule: {
          row: 1,
          who: { forms: [723, 735, 931, 966] },
          gain: {
            kind: 'byStar',
            steps: [
              { from: 4, to: 6, stats: { fire: 2, evasion: 1, los: 2, accuracy: 1 } },
              { from: 7, to: 8, stats: { fire: 2, evasion: 1, los: 2, accuracy: 2 } },
              { from: 9, to: null, stats: { fire: 2, aa: 1, evasion: 2, los: 2, accuracy: 2 } },
            ],
          },
          stack: 'once',
        },
        via: 'Lexington・Ranger',
      },
      {
        rule: {
          row: 2,
          who: { forms: [433, 438, 545, 550] },
          gain: {
            kind: 'byStar',
            steps: [
              { from: 4, to: 6, stats: { fire: 1, evasion: 1, los: 2, accuracy: 1 } },
              { from: 7, to: 8, stats: { fire: 1, evasion: 1, los: 2, accuracy: 2 } },
              { from: 9, to: null, stats: { fire: 1, aa: 1, evasion: 2, los: 2, accuracy: 2 } },
            ],
          },
          stack: 'once',
        },
        via: 'Saratoga',
      },
      {
        rule: {
          row: 3,
          who: { nations: [4], types: [7, 11, 18] },
          gain: {
            kind: 'byStar',
            steps: [
              { from: 4, to: 6, stats: { fire: 1, los: 1 } },
              { from: 7, to: 8, stats: { fire: 1, los: 1, accuracy: 1 } },
              { from: 9, to: null, stats: { fire: 1, aa: 1, evasion: 1, los: 1, accuracy: 1 } },
            ],
          },
          stack: 'once',
          not: { forms: [433, 438, 545, 550, 723, 735, 931, 966] },
        },
        via: '「上記以外のアメリカ空母」——美国籍 × 空母（軽空母/正規空母/装甲空母 = stype 7/11/18）；除外＝上面两行点名的 Lexington・Ranger・Saratoga 各形态',
      },
      {
        rule: {
          row: 4,
          who: { nations: [5], types: [7, 11, 18] },
          gain: {
            kind: 'byStar',
            steps: [
              { from: 4, to: 6, stats: { los: 1 } },
              { from: 7, to: 8, stats: { los: 1, accuracy: 1 } },
              { from: 9, to: null, stats: { aa: 1, evasion: 1, los: 1, accuracy: 1 } },
            ],
          },
          stack: 'once',
        },
        via: '「イギリス空母」——英国籍 × 空母（现有的是 Ark Royal・Victorious・Glorious 的空母形态；Glorious 的巡洋戦艦形态 stype 不在这三档里，自然落不进来）',
      },
      {
        rule: {
          row: 5,
          who: { types: [7, 11, 18], forms: [717, 900, 943, 948, 1003, 1008] },
          gain: {
            kind: 'byStar',
            steps: [
              { from: 7, to: 8, stats: { accuracy: 1 } },
              { from: 9, to: null, stats: { aa: 1, evasion: 1, accuracy: 1 } },
            ],
          },
          stack: 'once',
          not: { nations: [4, 5] },
        },
        via:
          '「その他の空母＋山汐丸・熊野丸・しまね丸」——空母里除掉美英两组即得「その他」；' +
          '那三艘按 stype 根本不是空母（山汐丸/しまね丸 = 補給艦 22、熊野丸 = 揚陸艦 17），所以逐形态点名',
      },
    ],
    provisional: [
      '全表累積欄写「?」——按不叠（once）取',
      '「その他の空母…」那一行的 ★+4 档整行是空的（一格加成都不给），所以只从 ★+7 起档；不是漏抄',
      '「アメリカ空母」「イギリス空母」的国籍按号段判。上游这一页没有为跨国改造形态写例外，照号段落；上游哪天写了明文，以明文为准',
    ],
    addedAt: '2026-08-22',
  },
  {
    equipId: 579,
    equipName: '13.8cm単装砲 Modèle 1927',
    type2: 1,
    source: 'wikiwiki.jp/kancolle「13.8cm単装砲 Modèle 1927」装備ボーナス表',
    sourceUpdatedAt: '2026-07-27',
    corroboration: '单源待印证',
    rules: [
      {
        rule: {
          row: 1,
          who: { forms: [1053, 1058] },
          gain: {
            kind: 'byStar',
            steps: [
              { from: 0, to: 5, stats: { fire: 2, evasion: 2, accuracy: 1 } },
              { from: 6, to: null, stats: { fire: 3, evasion: 2, accuracy: 1 } },
            ],
          },
          stack: 'perEquip',
        },
        via: 'Vautour',
      },
      {
        rule: {
          row: 2,
          who: { forms: [372, 491, 962, 965, 967, 970] },
          gain: {
            kind: 'byStar',
            steps: [
              { from: 0, to: 5, stats: { fire: 1, evasion: 2, accuracy: 1 } },
              { from: 6, to: null, stats: { fire: 2, evasion: 2, accuracy: 1 } },
            ],
          },
          stack: 'perEquip',
        },
        via: 'Mogador・Gloire・Commandant Teste',
      },
      {
        rule: {
          row: 3,
          who: { forms: [1061] },
          gain: {
            kind: 'byStar',
            steps: [
              { from: 0, to: 5, stats: { fire: 1, evasion: 1 } },
              { from: 6, to: null, stats: { fire: 2, evasion: 1 } },
            ],
          },
          stack: 'perEquip',
        },
        via: 'Bearn Amelioration = Béarn amélioration',
      },
      {
        rule: {
          row: 4,
          who: { all: true },
          gain: { kind: 'byStar', steps: [{ from: 6, to: null, stats: { fire: 1 } }] },
          stack: 'once',
          not: { forms: [372, 491, 962, 965, 967, 970, 1053, 1058, 1061] },
        },
        via: '上記以外の艦（累積 ?）',
      },
    ],
    provisional: [
      '「上記以外の艦」那一行累積欄写「?」——按不叠（once）取',
    ],
    deferred: [
      '相互シナジー 3 行（× 水上電探*1 / × 55cm三連装魚雷 Modèle 1924 / × 本装備二件）——协同行本层只做単体轨',
    ],
    addedAt: '2026-08-22',
  },
  {
    equipId: 580,
    equipName: '55cm三連装魚雷 Modèle 1924',
    type2: 5,
    source: 'wikiwiki.jp/kancolle「55cm三連装魚雷 Modèle 1924」装備ボーナス表',
    sourceUpdatedAt: '2026-08-10',
    corroboration: '单源待印证',
    rules: [
      {
        rule: {
          row: 1,
          who: { forms: [1053, 1058] },
          gain: { kind: 'flat', flat: { torpedo: 5, evasion: 2, accuracy: 2 } },
          stack: 'perEquip',
        },
        via: 'Vautour',
      },
      {
        rule: {
          row: 2,
          who: { forms: [965, 970, 1051, 1056] },
          gain: { kind: 'flat', flat: { torpedo: 4, evasion: 2, accuracy: 2 } },
          stack: 'perEquip',
        },
        via: 'Algérie・Gloire',
      },
      {
        rule: {
          row: 3,
          who: { forms: [962, 967] },
          gain: { kind: 'flat', flat: { torpedo: 3, evasion: 2, accuracy: 2 } },
          stack: 'perEquip',
        },
        via: 'Mogador',
      },
      {
        rule: {
          row: 4,
          who: { forms: [1061] },
          gain: { kind: 'flat', flat: { torpedo: 2, accuracy: 1 } },
          stack: 'perEquip',
        },
        via: 'Bearn Amelioration',
      },
    ],
    deferred: [
      '相互シナジー 2 行（× 水上電探*1 / × 13.8cm単装砲 Modèle 1927）——协同行本层只做単体轨',
    ],
    addedAt: '2026-08-22',
  },
  {
    equipId: 581,
    equipName: '55cm複合配置五連装魚雷 Modèle 1932',
    type2: 5,
    source: 'wikiwiki.jp/kancolle「55cm複合配置五連装魚雷 Modèle 1932」装備ボーナス表',
    sourceUpdatedAt: '2026-08-10',
    corroboration: '单源待印证',
    rules: [
      {
        rule: {
          row: 1,
          who: { forms: [962, 967] },
          gain: { kind: 'byStar', steps: [{ from: 2, to: null, stats: { torpedo: 7, evasion: 1, accuracy: 2 } }] },
          stack: 'once',
        },
        via: 'Mogador',
      },
      {
        rule: {
          row: 2,
          who: { forms: [965, 970, 1051, 1056] },
          gain: { kind: 'byStar', steps: [{ from: 2, to: null, stats: { torpedo: 6, evasion: 1, accuracy: 2 } }] },
          stack: 'once',
        },
        via: 'Algérie・Gloire',
      },
      {
        rule: {
          row: 3,
          who: { forms: [1053, 1058] },
          gain: { kind: 'byStar', steps: [{ from: 2, to: null, stats: { torpedo: 5, evasion: 1, accuracy: 2 } }] },
          stack: 'once',
        },
        via: 'Vautour',
      },
      {
        rule: {
          row: 4,
          who: { forms: [1061] },
          gain: { kind: 'byStar', steps: [{ from: 2, to: null, stats: { torpedo: 3, accuracy: 1 } }] },
          stack: 'once',
        },
        via: 'Bearn Amelioration',
      },
      {
        rule: {
          row: 5,
          who: { all: true },
          gain: { kind: 'byStar', steps: [{ from: 2, to: null, stats: { torpedo: 1 } }] },
          stack: 'once',
          not: { forms: [962, 965, 967, 970, 1051, 1053, 1056, 1058, 1061] },
        },
        via: '上記以外の艦',
      },
    ],
    provisional: [
      '全表累積欄写「?」——按不叠（once）取',
    ],
    deferred: [
      '相互シナジー：本装備 × 水上電探*1 → Vautour/Mogador/Gloire/Algérie——协同行本层只做単体轨',
    ],
    addedAt: '2026-08-22',
  },
  {
    equipId: 582,
    equipName: '20.3cm/50 連装砲 Modèle 1931',
    type2: 2,
    source: 'wikiwiki.jp/kancolle「20.3cm／50 連装砲 Modèle 1931」装備ボーナス表',
    sourceUpdatedAt: '2026-07-27',
    corroboration: '单源待印证',
    rules: [],
    deferred: [
      '2026-08-22 人工重读整页（抓取日同日，页面最后修订 2026-07-27）：**这一页没有加成表可转写**，' +
        '不是解析器漏读。「ゲームにおいて」「入手方法について」「装備の運用方法について」「装備ボーナスについて」' +
        '四个小节的正文全是新建页模板留下的编辑指引原文（加成那节写的是「ボーナス表は…ここには雛形を置きません」，' +
        '即「此处不放模板」），「アップデート履歴」同样是空的；整页只有「小ネタ」与转送来的性能比較表有内容，' +
        '而那张比較表里连这件装备自己的行都没有。' +
        '**仍然不等于「它没有加成」**——只说明这一侧的资料还没人填，所以继续挂 pending 显示「暂无预期数据」，' +
        '由实测那一轨供数。等该页填上，或另有日文一手，再转写。',
    ],
    addedAt: '2026-08-22',
  },
  {
    equipId: 583,
    equipName: '20.3cm/50 連装砲改(SHS改良弾)',
    type2: 2,
    source: 'wikiwiki.jp/kancolle「20.3cm／50 連装砲改(SHS改良弾)」装備ボーナス表',
    sourceUpdatedAt: '2026-08-19',
    corroboration: '单源待印证',
    rules: [
      {
        rule: {
          row: 1,
          who: { forms: [1056] },
          gain: {
            kind: 'byStar',
            steps: [
              { from: 0, to: 0, stats: { fire: 3, accuracy: 3 } },
              { from: 1, to: 2, stats: { fire: 4, accuracy: 4 } },
              { from: 3, to: null, stats: { fire: 6, accuracy: 4 } },
            ],
          },
          stack: 'perEquip',
        },
        via: 'Algerie改 = Algérie改',
      },
      {
        rule: {
          row: 2,
          who: { forms: [1051] },
          gain: {
            kind: 'byStar',
            steps: [
              { from: 0, to: 0, stats: { fire: 2, accuracy: 2 } },
              { from: 1, to: 2, stats: { fire: 3, accuracy: 3 } },
              { from: 3, to: null, stats: { fire: 5, accuracy: 3 } },
            ],
          },
          stack: 'perEquip',
        },
        via: 'Algerie（Algérie改 有自己更深的基准行）',
      },
      {
        rule: {
          row: 3,
          who: { forms: [358, 361, 372, 448, 449, 491, 496] },
          gain: {
            kind: 'byStar',
            steps: [
              { from: 0, to: 0, stats: { fire: 1, accuracy: 1 } },
              { from: 1, to: 2, stats: { fire: 1, accuracy: 2 } },
              { from: 3, to: null, stats: { fire: 2, accuracy: 2 } },
            ],
          },
          stack: 'perEquip',
        },
        via: 'Zara・Pola・Commandant Teste',
      },
    ],
    deferred: [
      '相互シナジー：本装備 × 水上電探*2 → Algerie改——协同行本层只做単体轨',
    ],
    addedAt: '2026-08-22',
  },
  {
    equipId: 584,
    equipName: 'Bofors 12cm単装両用砲',
    type2: 1,
    source: 'wikiwiki.jp/kancolle「Bofors 12cm単装両用砲」装備ボーナス表',
    sourceUpdatedAt: '2026-08-21',
    corroboration: '单源待印证',
    rules: [
      {
        rule: {
          row: 1,
          who: { forms: [1062, 1067] },
          gain: {
            kind: 'byStar',
            steps: [
              { from: 0, to: 1, stats: { fire: 2, evasion: 2, accuracy: 1 } },
              { from: 2, to: 3, stats: { fire: 3, evasion: 2, accuracy: 1 } },
              { from: 4, to: null, stats: { fire: 3, evasion: 2, accuracy: 2 } },
            ],
          },
          stack: 'perEquip',
        },
        via: 'Visby',
      },
      {
        rule: {
          row: 2,
          who: { forms: [574, 579, 630] },
          gain: {
            kind: 'byStar',
            steps: [
              { from: 0, to: 1, stats: { fire: 1, evasion: 1, accuracy: 1 } },
              { from: 2, to: 3, stats: { fire: 2, evasion: 1, accuracy: 1 } },
              { from: 4, to: null, stats: { fire: 2, evasion: 1, accuracy: 2 } },
            ],
          },
          stack: 'perEquip',
        },
        via: 'Gotland',
      },
      {
        rule: {
          row: 3,
          who: { all: true },
          gain: {
            kind: 'byStar',
            steps: [{ from: 2, to: 3, stats: { fire: 1 } }, { from: 4, to: null, stats: { fire: 1, accuracy: 1 } }],
          },
          stack: 'once',
          not: { forms: [574, 579, 630, 1062, 1067] },
        },
        via: '上記以外の艦（累積 ?）',
      },
    ],
    provisional: [
      '「上記以外の艦」两档的累積欄写「?」——按不叠（once）取',
    ],
    deferred: [
      '相互シナジー：本装備 × 水上電探*1 → Visby——协同行本层只做単体轨',
    ],
    addedAt: '2026-08-22',
  },
  {
    equipId: 585,
    equipName: 'PL101(偵察)',
    type2: 9,
    source: 'wikiwiki.jp/kancolle「PL101(偵察)」装備ボーナス表',
    sourceUpdatedAt: '2026-08-19',
    corroboration: '单源待印证',
    rules: [
      {
        rule: {
          row: 1,
          who: { forms: [1060, 1061] },
          gain: {
            kind: 'byStar',
            steps: [
              { from: 0, to: 5, stats: { fire: 4, aa: 1, evasion: 2, los: 3, accuracy: 5 } },
              { from: 6, to: null, stats: { fire: 5, aa: 1, evasion: 3, los: 4, accuracy: 6 } },
            ],
          },
          stack: 'perEquip',
        },
        via: 'Bearn改 = Béarn改',
      },
      {
        rule: {
          row: 2,
          who: { forms: [89, 285, 894, 899] },
          gain: {
            kind: 'byStar',
            steps: [
              { from: 0, to: 5, stats: { fire: 2, aa: 1, evasion: 1, los: 3, accuracy: 2 } },
              { from: 6, to: null, stats: { fire: 3, aa: 1, evasion: 2, los: 4, accuracy: 3 } },
            ],
          },
          stack: 'perEquip',
        },
        via: '鳳翔',
      },
      {
        rule: {
          row: 3,
          who: { forms: [553, 554], types: [7, 11, 18] },
          gain: {
            kind: 'byStar',
            steps: [
              { from: 2, to: 3, stats: { los: 1 } },
              { from: 4, to: 5, stats: { fire: 1, los: 1 } },
              { from: 6, to: 9, stats: { fire: 1, los: 2 } },
              { from: 10, to: null, stats: { fire: 2, los: 3 } },
            ],
          },
          stack: 'once',
        },
        via: '艦上偵察機（本装備 api_type[2]=9 即艦上偵察機）→ 全ての空母・伊勢型改二（累積×）',
      },
    ],
    provisional: [
      '「艦上偵察機」那一组累積欄写「×*2」，脚注正文没随表带出来，未据以改数',
    ],
    deferred: [
      '相互シナジー：本装備 × PL101(爆装) → Bearn改——协同行本层只做単体轨',
    ],
    addedAt: '2026-08-22',
  },
  {
    equipId: 586,
    equipName: 'PL101(爆装)',
    type2: 7,
    source: 'wikiwiki.jp/kancolle「PL101(爆装)」装備ボーナス表',
    sourceUpdatedAt: '2026-08-13',
    corroboration: '单源待印证',
    rules: [
      {
        rule: {
          row: 1,
          who: { forms: [1060, 1061] },
          gain: { kind: 'flat', flat: { fire: 2, aa: 1, evasion: 2, accuracy: 2 } },
          stack: 'perEquip',
        },
        via: 'Bearn改',
      },
      {
        rule: {
          row: 2,
          who: { forms: [89, 285, 894, 899] },
          gain: { kind: 'flat', flat: { fire: 1, aa: 1, evasion: 1, accuracy: 1 } },
          stack: 'perEquip',
        },
        via: '鳳翔',
      },
    ],
    deferred: [
      '相互シナジー：本装備 × PL101(偵察) → Bearn改——协同行本层只做単体轨',
    ],
    addedAt: '2026-08-22',
  },
  {
    equipId: 587,
    equipName: 'V-156F(SB2U輸出型)',
    type2: 7,
    source: 'wikiwiki.jp/kancolle「V-156F(SB2U輸出型)」装備ボーナス表',
    sourceUpdatedAt: '2026-08-19',
    corroboration: '单源待印证',
    rules: [
      {
        rule: {
          row: 1,
          who: { forms: [1060, 1061] },
          gain: {
            kind: 'byStar',
            steps: [
              { from: 0, to: 3, stats: { fire: 5, aa: 1, evasion: 2, accuracy: 4 } },
              { from: 4, to: null, stats: { fire: 8, aa: 4, evasion: 3, accuracy: 6 } },
            ],
          },
          stack: 'perEquip',
        },
        via: 'Bearn改',
      },
      {
        rule: {
          row: 2,
          who: { forms: [89, 285, 894, 899] },
          gain: {
            kind: 'byStar',
            steps: [
              { from: 0, to: 3, stats: { fire: 1, aa: 1, evasion: 1, accuracy: 1 } },
              { from: 4, to: null, stats: { fire: 4, aa: 1, evasion: 2, accuracy: 3 } },
            ],
          },
          stack: 'perEquip',
        },
        via: '鳳翔',
      },
      {
        rule: {
          row: 3,
          who: { all: true },
          gain: { kind: 'byStar', steps: [{ from: 4, to: null, stats: { fire: 3, evasion: 1, accuracy: 2 } }] },
          stack: 'once',
          not: { forms: [89, 285, 894, 899, 1060, 1061] },
        },
        via: '上記以外の全ての艦（累積 ?）',
      },
    ],
    provisional: [
      '「上記以外の全ての艦」那一行累積欄写「?」——按不叠（once）取',
    ],
    addedAt: '2026-08-22',
  },
  {
    equipId: 588,
    equipName: 'G-36A(F4F輸出型)',
    type2: 6,
    source: 'wikiwiki.jp/kancolle「G-36A(F4F輸出型)」装備ボーナス表',
    sourceUpdatedAt: '2026-08-21',
    corroboration: '单源待印证',
    rules: [
      {
        rule: {
          row: 1,
          who: { forms: [1060, 1061] },
          gain: {
            kind: 'byStar',
            steps: [
              { from: 0, to: 3, stats: { fire: 2, aa: 1, evasion: 5, accuracy: 4 } },
              { from: 5, to: null, stats: { fire: 2, aa: 4, evasion: 7, accuracy: 5 } },
            ],
          },
          stack: 'perEquip',
        },
        via: 'Bearn改',
      },
      {
        rule: {
          row: 2,
          who: { forms: [393, 515, 713, 885], classes: [135] },
          gain: {
            kind: 'byStar',
            steps: [
              { from: 0, to: 3, stats: { fire: 1, aa: 2, evasion: 1, accuracy: 1 } },
              { from: 5, to: null, stats: { fire: 1, aa: 5, evasion: 3, accuracy: 2 } },
            ],
          },
          stack: 'perEquip',
        },
        via: 'Glorious(正規空母) = api_ctype 135・Ark Royal・Victorious',
      },
      {
        rule: {
          row: 3,
          who: { forms: [89, 285, 894, 899] },
          gain: {
            kind: 'byStar',
            steps: [
              { from: 0, to: 3, stats: { fire: 1, aa: 1, evasion: 1, accuracy: 1 } },
              { from: 5, to: null, stats: { fire: 1, aa: 4, evasion: 3, accuracy: 2 } },
            ],
          },
          stack: 'perEquip',
        },
        via: '鳳翔',
      },
      {
        rule: {
          row: 4,
          who: { all: true },
          gain: { kind: 'byStar', steps: [{ from: 5, to: null, stats: { aa: 3, evasion: 2, accuracy: 1 } }] },
          stack: 'once',
          not: { forms: [89, 285, 393, 515, 713, 885, 894, 899, 1060, 1061] },
        },
        via: '上記以外の全ての艦（累積 ?）',
      },
    ],
    provisional: [
      '「上記以外の全ての艦」那一行累積欄写「?」——按不叠（once）取',
    ],
    addedAt: '2026-08-22',
  },
])

export type FitSupplementSkipReason = 'recall' | 'empty'

/**
 * 取到票、却**转写不进来**的那几件（不是「它没有加成」）。
 * 挂到 `data.supplementPending` 上，让它们继续按「暂无预期数据」显示——见 `fitPackUncovered`。
 */
export const FIT_BONUS_SUPPLEMENT_PENDING: readonly number[] = Object.freeze([582])

/**
 * 把自补层叠到刚加载的包上。**只加包里根本没有的那几件**，已有的一格不碰。
 *
 * `onSkip` 的两种理由：
 *   · `recall` —— 包里已经有这个 id 了：kcwiki 开始收录这件装备，本条**立即作废并召回复审**。
 *     不静默叠加（会与上游行相加、凭空翻倍），也不静默丢弃（这一层会无声消失）。
 *   · `empty`  —— 本条没有可转写的规则（`confirmedNone` 或整件挂牌），本来就不该往包里加。
 *
 * 返回打上补丁的**新** data（原对象不动，纯函数好测）。
 */
export const applyFitBonusSupplement = (
  data: FitBonusData,
  onSkip?: (entry: FitBonusSupplementEntry, reason: FitSupplementSkipReason, detail: string) => void,
): { data: FitBonusData; applied: number } => {
  const equips: Record<string, FitEquipEntry> = { ...data.equips }
  let applied = 0
  for (const entry of FIT_BONUS_SUPPLEMENT) {
    if (equips[`${entry.equipId}`]) {
      onSkip?.(entry, 'recall', '上游已经收录这件装备，自补条目作废，请人工比对后删除或改写')
      continue
    }
    if (!entry.rules.length) {
      onSkip?.(entry, 'empty', entry.confirmedNone ? '确认无单体加成' : '整件挂牌，没有可转写的行')
      continue
    }
    equips[`${entry.equipId}`] = {
      id: entry.equipId,
      nameJa: entry.equipName,
      nameZh: entry.equipName,
      rules: entry.rules.map((one) => ({ ...one.rule })),
    }
    applied += 1
  }
  const pending = FIT_BONUS_SUPPLEMENT_PENDING.filter((id) => !equips[`${id}`])
  return {
    data: {
      ...data,
      equips,
      ...(pending.length ? { supplementPending: pending } : {}),
    },
    applied,
  }
}
