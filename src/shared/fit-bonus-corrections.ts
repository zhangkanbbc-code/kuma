// 装备加成的**第一方修正台账**（范式照 `src/main/mg/quest-source-conflicts.ts`）。
//
// 为什么需要它：随包的 `kcwiki-fit-bonus` 是 CC 底表，能分发；EO 的 `FitBonuses.json`
// 是 NOASSERTION，**一格数都不许抄进那份包**（那是许可事故）。但对账确实量出了分歧，
// 逐件拿日文一手（wikiwiki 的装備ボーナス表）核过之后，有四件裁定「上游那几行错了」。
//
// 出路就是这张台账：**不改 CC 包文件，在加载时叠加一层第一方补正**。
// 多源汇编的通行口径——事实值（「金剛型装三式弾改是火力+2 対空+1」）本身不受任何一方的
// 数据库许可约束，逐条带依据地转写进第一方台账是合法的；不合法的是把 EO 的**文件**
// 拼进我们的包。所以这里记的是**从日文一手核出来的补正量**，EO 只是「另一份独立整理
// 恰好也这么说」的旁证，不是出处。
//
// ---- 自失效 ----
//
// 每条修正都钉着它依赖的上游行的指纹（`fitRuleFingerprint`）。上游哪天改了那几行，
// 指纹对不上，`applyFitBonusCorrections` 就**跳过并告警**，而不是拿一份过期的修正
// 去改一个已经变了样的东西——那种错法既看不见又说不清。
//
// ---- 73 件待裁的不在这里 ----
//
// `scripts/lib/fit-bonus-conflicts.mjs` 的 `PENDING_FIT_BONUS_CONFLICTS` 还有 73 件
// 票据不足（或日文侧压根没有对应小节）。**不许替用户拍板**：那些一律照上游显示，
// 差异交给面板反推的实测层自己说话。用户逐件裁完一条，就往下面加一条，机制不变。

// **这个文件只准 `import type`**（类型在剥离时整句消失）。有一个值导入，
// `node --test` 就直接跑不动它了——Node 的 ESM 不给无扩展名的相对路径兜底。
// 所以规则指纹也住在这里，而不是从求值器那边拿。
import type {
  FitBonusData,
  FitEquipEntry,
  FitGain,
  FitNeed,
  FitRule,
  FitStats,
  FitWhoSet,
} from './fit-bonus'

// ---- 规则指纹 ----
//
// 只回答一个问题：「上游这一行还是台账记下它时的样子吗」。
// 键按字典序排（不依赖 `FIT_STAT_KEYS` 那份顺序表——那会变成一个值导入）。

const dumpStats = (stats: FitStats | null | undefined): string =>
  Object.entries(stats ?? {})
    .filter(([, value]) => value)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}${value! > 0 ? '+' : ''}${value}`)
    .join(',')

// 追加维度一律往**末尾**加、且缺省时输出空串：已有指纹逐条写死在下面的台账里，
// 换一个字都会让那几条修正当场作废。`nations` 只出现在第一方自补层的行上，
// 上游包的行不会有它，所以现有指纹一格不变。
const dumpSet = (set: FitWhoSet | undefined): string =>
  set
    ? [
        set.all ? 'all' : '',
        set.forms?.length ? `f${[...set.forms].sort((a, b) => a - b).join('.')}` : '',
        set.classes?.length ? `c${[...set.classes].sort((a, b) => a - b).join('.')}` : '',
        set.types?.length ? `t${[...set.types].sort((a, b) => a - b).join('.')}` : '',
        set.nations?.length ? `n${[...set.nations].sort((a, b) => a - b).join('.')}` : '',
      ]
        .filter(Boolean)
        .join('/')
    : ''

const dumpNeed = (need: FitNeed | undefined): string =>
  need
    ? [
        need.star ? `★${need.star}` : '',
        need.with?.length
          ? need.with
              .map((slot) => (slot.group ? `@${slot.group}` : `#${(slot.any ?? []).join('.')}`))
              .join('+')
          : '',
      ]
        .filter(Boolean)
        .join(' ')
    : ''

const dumpGain = (gain: FitGain): string => {
  if (gain.kind === 'flat') return `flat[${dumpStats(gain.flat)}]`
  if (gain.kind === 'byStar') {
    return `byStar[${gain.steps.map((s) => `${s.from}-${s.to ?? ''}:${dumpStats(s.stats)}`).join(';')}]`
  }
  if (gain.kind === 'byCount') {
    return `byCount[${gain.counts.map((s) => `${s.count}:${dumpStats(s.stats)}`).join(';')}]`
  }
  return `byArea[${gain.areas.map((s) => `${s.area}:${dumpStats(s.stats)}`).join(';')}]`
}

/**
 * 一条规则的稳定指纹。台账靠它自失效：上游这一行**任何一处**改了，指纹就变，
 * 那条修正随之作废并告警——而不是拿一份过期的修正去改一个已经变了样的东西。
 */
export const fitRuleFingerprint = (rule: FitRule): string =>
  [
    `who:${dumpSet(rule.who)}`,
    `not:${dumpSet(rule.not)}`,
    `need:${dumpNeed(rule.need)}`,
    `gain:${dumpGain(rule.gain)}`,
    `stack:${rule.stack}`,
    `cap:${rule.cap ?? ''}`,
    `set:${dumpStats(rule.setTotal)}`,
  ].join('|')

export interface FitBonusCorrection {
  equipId: number
  /** 装备日文原名（给人读的锚，不参与判定） */
  equipName: string
  /** 依赖的上游行：任一行的指纹对不上，整条修正作废并告警 */
  watch: readonly { row: number; fingerprint: string }[]
  /** 逐形态的补正量。同一个补正量的形态并成一组，读起来才像人话 */
  patches: readonly { forms: readonly number[]; delta: FitStats }[]
  /** 补正跟着本行的叠加方式走：上游那几行按件数倍乘的，补正也按件数 */
  stack: 'perEquip' | 'once'
  /** 日文一手出处逐字（裁决依据） */
  jp: string
  /** 日文出处是哪一页 */
  source: string
  /** 分歧在哪、为什么裁成这样 */
  why: string
  /** UI 上跟在这条补正行后面的一句话（短，玩家读得懂） */
  note: string
  decidedAt: string
}

export const FIT_BONUS_CORRECTIONS: readonly FitBonusCorrection[] = Object.freeze([
  {
    equipId: 317,
    equipName: '三式弾改',
    watch: [
      { row: 1, fingerprint: 'who:f78.79.85.86.209.210.211.212|not:|need:|gain:byCount[1:aa+1,fire+1]|stack:table|cap:|set:' },
      { row: 2, fingerprint: 'who:f149.591.592|not:|need:|gain:byCount[1:aa+3,fire+3]|stack:table|cap:|set:' },
      { row: 3, fingerprint: 'who:f150|not:|need:|gain:byCount[1:aa+2,fire+2]|stack:table|cap:|set:' },
      { row: 4, fingerprint: 'who:f151|not:|need:|gain:byCount[1:aa+2,evasion+1,fire+2]|stack:table|cap:|set:' },
      { row: 5, fingerprint: 'who:f593|not:|need:|gain:byCount[1:aa+4,evasion+2,fire+2]|stack:table|cap:|set:' },
      { row: 6, fingerprint: 'who:f954|not:|need:|gain:byCount[1:aa+3,evasion+1,fire+3]|stack:table|cap:|set:' },
      { row: 7, fingerprint: 'who:f152|not:|need:|gain:byCount[1:aa+2,fire+3]|stack:table|cap:|set:' },
    ],
    patches: [
      {
        forms: [78, 79, 85, 86, 149, 150, 151, 152, 209, 210, 211, 212, 591, 592, 593, 954],
        delta: { fire: 1 },
      },
    ],
    stack: 'once',
    source: 'wikiwiki.jp/kancolle「三式弾改」の装備ボーナス表（2026-08-22 只读核对）',
    jp:
      '対象艦は金剛型と伊勢型、長門型戦艦改二。／金剛型(未改造/改) 火力+2 対空+1／' +
      '金剛改二・改二丙 +4 +3／比叡改二丙 +4 +3／比叡改二 +3 +2／榛名改二 +3 +2 回避+1／' +
      '榛名改二乙 +3 +4 回避+2／榛名改二丙 +4 +3 回避+1／霧島改二・改二丙 +4 +2',
    why:
      '整条金剛型（8 个未改造/改形态 + 8 个改二系形态）上游的**火力栏一律少 1**，' +
      '对空/回避两栏则逐格无误。日文近验表逐行核下来 16 格全部对得上「火力再 +1」：' +
      '金剛 2/1、金剛改二 4/3、比叡改二 3/2、榛名改二 3/2/1、榛名改二乙 3/4/2、' +
      '榛名改二丙 4/3/1、霧島改二 4/2。',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 358,
    equipName: '5inch 単装高角砲群',
    watch: [
      { row: 1, fingerprint: 'who:c95.110.121|not:|need:|gain:flat[aa+3,evasion+3,fire+2]|stack:perEquip|cap:|set:' },
    ],
    patches: [
      {
        forms: [598, 711, 722, 734, 896, 923, 928, 952, 957, 1005, 1010],
        delta: { fire: -1, aa: -2, evasion: -2 },
      },
    ],
    stack: 'perEquip',
    source: 'wikiwiki.jp/kancolle「5inch 単装高角砲群」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: '対象は米英戦艦・空母と米重巡など。／Northampton、Houston：火力+2 対空+3 回避+3／その他米英国艦：+1 +1 +1',
    why:
      '上游把「Northampton・Houston」那一档写成了三个舰级——北安普敦级(95)、布鲁克林级(110)、' +
      '新奥尔良级(121)。日文近验表只给 Northampton 与 Houston（正好是 api_ctype 95 的四个形态）' +
      '那个高档，布鲁克林级与新奥尔良级属于「その他米英国艦」的 +1/+1/+1。' +
      '这是**扩大了适用面**，11 个形态各多拿 火力1/对空2/回避2。',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 505,
    equipName: '25mm対空機銃増備',
    watch: [
      {
        row: 6,
        fingerprint:
          'who:t2|not:f144.147.407.419.464.470.497.498.557.558.578.651.656.961|need:|' +
          'gain:flat[aa+2,evasion+2,fire+1]|stack:perEquip|cap:|set:',
      },
    ],
    patches: [
      { forms: [145, 951, 975], delta: { fire: 1, aa: 2, evasion: 3 } },
      { forms: [228, 242, 243], delta: { aa: 2, evasion: 2 } },
      { forms: [235, 955, 960], delta: { fire: 1, aa: 1, evasion: 1 } },
      { forms: [244, 245, 323], delta: { aa: 1, evasion: 2 } },
      { forms: [986], delta: { fire: 1, aa: 1, evasion: 2 } },
      { forms: [981], delta: { aa: 1, evasion: 1 } },
    ],
    stack: 'perEquip',
    source: 'wikiwiki.jp/kancolle「25mm対空機銃増備」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp:
      '吹雪改三・時雨改三 +3/+5/+6／白露改二・時雨改二・春雨改二・雪風改二・天津風改二 +2/+4/+5／' +
      '白雪改二・初雪改二 +2/+3/+4／潮改二・響改・初霜改二・霞改二/乙・磯風乙改・浜風乙改・朝霜改二・' +
      '清霜改二/丁 +2/+3/+3／村雨改二・夕立改二・白露改・時雨改・雪風改 +1/+4/+4／' +
      '村雨改・夕立改・春雨改 +1/+3/+4／玉波改二・涼波改二・藤波改二・早波改二・浜波改二 +1/+3/+3',
    why:
      '上游只分了 5 档，日文近验表分了 7 档，于是这 14 个形态在上游那边全落进了' +
      '「驱逐舰通用」的最低档（火力1/对空2/回避2）：時雨改二・春雨改二・天津風改二 应在 2/4/5 档，' +
      '響改・清霜改二/丁 应在 2/3/3 档，白露改・時雨改・雪風改 应在 1/4/4 档，' +
      '村雨改・夕立改・春雨改 应在 1/3/4 档，白雪改二 应在 2/3/4 档，藤波改二 应在 1/3/3 档。' +
      '这是**分档缺失**（少给），不是数值口径之争。',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 322,
    equipName: '瑞雲改二(六三四空)',
    watch: [
      { row: 1, fingerprint: 'who:f553.554|not:|need:|gain:flat[aa+2,asw+1,evasion+2,fire+5]|stack:perEquip|cap:|set:' },
      { row: 2, fingerprint: 'who:f501.502.506.507|not:|need:|gain:flat[aa+1,evasion+2,fire+3]|stack:perEquip|cap:|set:' },
      { row: 3, fingerprint: 'who:f663.668|not:|need:|gain:flat[aa+1,evasion+2,fire+3]|stack:perEquip|cap:|set:' },
      { row: 4, fingerprint: 'who:f662|not:|need:|gain:flat[evasion+1,fire+3]|stack:perEquip|cap:|set:' },
    ],
    patches: [
      { forms: [553, 554], delta: { fire: 3, aa: 1, evasion: 2 } },
      { forms: [501, 506], delta: { fire: 1, evasion: 1 } },
      { forms: [502, 507], delta: { evasion: 1 } },
      { forms: [662, 663, 668], delta: { fire: 1, asw: 1, evasion: 1 } },
    ],
    stack: 'perEquip',
    source: 'wikiwiki.jp/kancolle「瑞雲改二(六三四空)」装備ボーナス表（页面 Last-modified 2026-07-31）',
    jp:
      '伊勢型改二 火力+8 対空+3 対潜+1 回避+4／能代改二 火力+4 対潜+1 回避+2／矢矧改二・乙 +4 +1 対潜+1 回避+3／' +
      '最上改二・特 +4 +1 回避+3／三隈改二・特 +3 +1 回避+3',
    why:
      '逐格核下来日文一手与上游差一整层：伊勢改二/日向改二 上游给 火力5/对空2/回避2，' +
      '日文是 火力8/对空3/回避4；最上改二 上游 3/1/2，日文 4/1/3；三隈改二 上游少 回避1；' +
      '矢矧改二系与能代改二 上游漏了 対潜+1。**不是孤例**：瑞雲/晴嵐系 10 件水上爆撃機在' +
      '最上改二系上呈现同一个缺口（上游逐装备写，把「水上爆撃機类目 × 最上改二系」那一层漏掉了），' +
      '这里先裁指标最全的这一件，其余留在待裁清单。',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 19,
    equipName: '九六式艦戦',
    watch: [
      { row: 2, fingerprint: 'who:c27|not:|need:|gain:flat[aa+3,asw+2,evasion+3,fire+2]|stack:perEquip|cap:|set:' },
    ],
    patches: [
      { forms: [894, 899], delta: { fire: 1, aa: 1, evasion: 1, asw: 1 } },
    ],
    stack: 'perEquip',
    source: 'wikiwiki.jp/kancolle「九六式艦戦」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: '鳳翔改二 / 戦 火力+3 対空+4 対潜+3 回避+4／鳳翔 +2 +3 +2 +3',
    why: '上游把整个鳳翔型写成一档（用的是 鳳翔 那档的数），日文把 鳳翔改二/戦 单列高一档，EO 一致。',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 26,
    equipName: '瑞雲',
    watch: [
      { row: 1, fingerprint: 'who:f501.502.506.507|not:|need:|gain:flat[aa+1,evasion+1]|stack:perEquip|cap:|set:' },
      { row: 2, fingerprint: 'who:f663.668|not:|need:|gain:flat[aa+1,evasion+1]|stack:perEquip|cap:|set:' },
      { row: 3, fingerprint: 'who:f501.502.506.507|not:|need:|gain:flat[fire+2]|stack:perEquip|cap:|set:' },
      { row: 4, fingerprint: 'who:f662|not:|need:|gain:flat[evasion+1,fire+2]|stack:perEquip|cap:|set:' },
      { row: 5, fingerprint: 'who:f663.668|not:|need:|gain:flat[fire+2]|stack:perEquip|cap:|set:' },
    ],
    patches: [
      { forms: [501, 506], delta: { fire: 1, evasion: 1 } },
      { forms: [502, 507], delta: { evasion: 1 } },
      { forms: [662, 663, 668], delta: { fire: 1, evasion: 1, asw: 1 } },
    ],
    stack: 'perEquip',
    source:
      'wikiwiki.jp/kancolle「瑞雲(六三四空)」「瑞雲12型(六三四空)」装備ボーナス表の「水上爆撃機(その他日本)」类目行（页面 Last-modified 2026-07-27）' +
      '＋舰娘页「能代改二」(2026-08-15)「矢矧改二」(2026-08-15) 的「水上爆撃機(共通・1機目)」＋「水上爆撃機(その他日本)」两行',
    jp:
      '水上爆撃機(その他日本)：能代改二 火力+3 対潜+1 回避+2／矢矧改二・乙 +3 対空+1 対潜+1 回避+2／最上改二・特 +3 +1 回避+2／' +
      '三隈改二・特 +2 +1 回避+2',
    why:
      '本装备自己的 wikiwiki 页没有「装備ボーナスについて」小节（页在，只是这一族的数值写在类目行里）。日文一手把这四行**写成类目行**「水上爆撃機(その他日本)' +
      '」——瑞雲系无固有補正的那几件共用同一档，两处互证：① 同族的 79 / 81 页逐格给出该类目行；② 能代改二舰娘页拆成「水上爆撃機(共通・1機目) 火力+1 対潜+1 回避+1」＋「水上爆撃機(その他日本)' +
      ' 火力+2 回避+1」，相加正是 火力+3 対潜+1 回避+2。上游是逐装备写的，把「水上爆撃機类目 × 最上改二系/阿賀野型改二系」这一层整层漏掉了。',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 39,
    equipName: '25mm連装機銃',
    watch: [
      { row: 1, fingerprint: 'who:c41|not:|need:|gain:flat[aa+2,evasion+1]|stack:perEquip|cap:|set:' },
    ],
    patches: [
      { forms: [668], delta: { aa: 1, evasion: 1 } },
    ],
    stack: 'perEquip',
    source: 'wikiwiki.jp/kancolle「25mm連装機銃」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: '25mm単装機銃・25mm連装機銃・25mm三連装機銃・25mm三連装機銃 集中配備：能代改二・矢矧改二 対空+2 回避+1／矢矧改二乙 対空+3 回避+2',
    why:
      '上游按舰级（阿賀野型）写成一档 対空+2 回避+1，日文把 矢矧改二乙 单列成 対空+3 回避+2，EO 一致。这一行在 25mm 四件机銃（39 / 40 / 49 / 131）' +
      '的页面上是同一条并列行，四件同裁。',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 40,
    equipName: '25mm三連装機銃',
    watch: [
      { row: 1, fingerprint: 'who:c41|not:|need:|gain:flat[aa+2,evasion+1]|stack:perEquip|cap:|set:' },
    ],
    patches: [
      { forms: [668], delta: { aa: 1, evasion: 1 } },
    ],
    stack: 'perEquip',
    source: 'wikiwiki.jp/kancolle「25mm三連装機銃」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: '25mm単装機銃・25mm連装機銃・25mm三連装機銃・25mm三連装機銃 集中配備：能代改二・矢矧改二 対空+2 回避+1／矢矧改二乙 対空+3 回避+2',
    why:
      '上游按舰级（阿賀野型）写成一档 対空+2 回避+1，日文把 矢矧改二乙 单列成 対空+3 回避+2，EO 一致。这一行在 25mm 四件机銃（39 / 40 / 49 / 131）' +
      '的页面上是同一条并列行，四件同裁。',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 49,
    equipName: '25mm単装機銃',
    watch: [
      { row: 1, fingerprint: 'who:c41|not:|need:|gain:flat[aa+2,evasion+1]|stack:perEquip|cap:|set:' },
    ],
    patches: [
      { forms: [668], delta: { aa: 1, evasion: 1 } },
    ],
    stack: 'perEquip',
    source: 'wikiwiki.jp/kancolle「25mm単装機銃」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: '25mm単装機銃・25mm連装機銃・25mm三連装機銃・25mm三連装機銃 集中配備：能代改二・矢矧改二 対空+2 回避+1／矢矧改二乙 対空+3 回避+2',
    why:
      '上游按舰级（阿賀野型）写成一档 対空+2 回避+1，日文把 矢矧改二乙 单列成 対空+3 回避+2，EO 一致。这一行在 25mm 四件机銃（39 / 40 / 49 / 131）' +
      '的页面上是同一条并列行，四件同裁。',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 59,
    equipName: '零式水上観測機',
    watch: [
      { row: 1, fingerprint: 'who:f501.502.506.507|not:|need:|gain:flat[aa+1,evasion+1]|stack:perEquip|cap:|set:' },
    ],
    patches: [
      { forms: [501, 502, 506, 507], delta: { fire: 2 } },
    ],
    stack: 'perEquip',
    source: 'wikiwiki.jp/kancolle「零式水上観測機」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: '零式水上観測機：最上改二 / 特・三隈改二 / 特 火力+2 対空+1 回避+1',
    why: '上游只写了 対空+1 回避+1，漏掉 火力+2 这一栏；日文一手与 EO 逐格一致。',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 61,
    equipName: '二式艦上偵察機',
    watch: [
      {
        row: 1,
        fingerprint:
          'who:f553|not:|need:|gain:byStar[0-:armor+1,evasion+2,fire+3,range+1;2-:armor+1,evasion+2,fire+3,los+1,range+1;4-:armor+1,evasion+2,fire+4,los+1,range+1;6-:armor+1,evasion+2,fire+4,los+2,range+1;10-:armor+1,evasion+2,fire+5,los+3,range+1]|stack:perEquip|cap:|set:',
      },
      {
        row: 2,
        fingerprint:
          'who:f554|not:|need:|gain:byStar[0-:armor+3,evasion+3,fire+3,range+1;2-:armor+3,evasion+3,fire+3,los+1,range+1;4-:armor+3,evasion+3,fire+4,los+1,range+1;6-:armor+3,evasion+3,fire+4,los+2,range+1;10-:armor+3,evasion+3,fire+5,los+3,range+1]|stack:perEquip|cap:|set:',
      },
      {
        row: 5,
        fingerprint:
          'who:f197|not:|need:|gain:byStar[0-:range+1;1-:fire+3,los+3,range+1;2-:fire+3,los+4,range+1;4-:fire+4,los+4,range+1;6-:fire+4,los+5,range+1;8-:fire+5,los+6,range+1;10-:fire+6,los+7,range+1]|stack:perEquip|cap:|set:',
      },
      {
        row: 6,
        fingerprint:
          'who:f196|not:|need:|gain:byStar[0-:range+1;1-:fire+2,los+2,range+1;2-:fire+2,los+3,range+1;4-:fire+3,los+3,range+1;6-:fire+3,los+4,range+1;10-:fire+4,los+5,range+1]|stack:perEquip|cap:|set:',
      },
    ],
    patches: [
      { forms: [196, 197, 553, 554], delta: { accuracy: 5 } },
    ],
    stack: 'perEquip',
    source: 'wikiwiki.jp/kancolle「二式艦上偵察機」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: '二式艦偵★0～1 伊勢改二 火力+3 装甲+1 回避+2 射程1段階延長 命中+5／日向改二 +3 装甲+3 回避+3 射程1段階延長 命中+5／★0 蒼龍改二・飛龍改二 射程1段階延長 命中+5',
    why: '四格差的都是同一栏：**命中+5**。上游把射程延长记下来了、把同一行的 命中+5 整栏漏了，其余逐格无误。EO 与日文一致。',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 62,
    equipName: '試製晴嵐',
    watch: [
      { row: 1, fingerprint: 'who:f501.502.506.507|not:|need:|gain:flat[aa+1,evasion+1]|stack:perEquip|cap:|set:' },
      { row: 2, fingerprint: 'who:f663.668|not:|need:|gain:flat[aa+1,evasion+1]|stack:perEquip|cap:|set:' },
      { row: 3, fingerprint: 'who:f501.502.506.507|not:|need:|gain:flat[fire+2]|stack:perEquip|cap:|set:' },
      { row: 4, fingerprint: 'who:f662|not:|need:|gain:flat[evasion+1,fire+2]|stack:perEquip|cap:|set:' },
      { row: 5, fingerprint: 'who:f663.668|not:|need:|gain:flat[fire+2]|stack:perEquip|cap:|set:' },
    ],
    patches: [
      { forms: [501, 506], delta: { fire: 1, evasion: 1 } },
      { forms: [502, 507], delta: { evasion: 1 } },
      { forms: [662, 663, 668], delta: { fire: 1, evasion: 1, asw: 1 } },
    ],
    stack: 'perEquip',
    source:
      'wikiwiki.jp/kancolle「瑞雲(六三四空)」「瑞雲12型(六三四空)」装備ボーナス表の「水上爆撃機(その他日本)」类目行（页面 Last-modified 2026-07-27）' +
      '＋舰娘页「能代改二」(2026-08-15)「矢矧改二」(2026-08-15) 的「水上爆撃機(共通・1機目)」＋「水上爆撃機(その他日本)」两行',
    jp:
      '水上爆撃機(その他日本)：能代改二 火力+3 対潜+1 回避+2／矢矧改二・乙 +3 対空+1 対潜+1 回避+2／最上改二・特 +3 +1 回避+2／' +
      '三隈改二・特 +2 +1 回避+2',
    why:
      '本装备自己的 wikiwiki 页没有「装備ボーナスについて」小节（页在，只是这一族的数值写在类目行里）。日文一手把这四行**写成类目行**「水上爆撃機(その他日本)' +
      '」——瑞雲系无固有補正的那几件共用同一档，两处互证：① 同族的 79 / 81 页逐格给出该类目行；② 能代改二舰娘页拆成「水上爆撃機(共通・1機目) 火力+1 対潜+1 回避+1」＋「水上爆撃機(その他日本)' +
      ' 火力+2 回避+1」，相加正是 火力+3 対潜+1 回避+2。上游是逐装备写的，把「水上爆撃機类目 × 最上改二系/阿賀野型改二系」这一层整层漏掉了。',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 63,
    equipName: '12.7cm連装砲B型改二',
    watch: [
      { row: 1, fingerprint: 'who:c1.5.10|not:f627|need:|gain:flat[aa+1]|stack:perEquip|cap:|set:' },
    ],
    patches: [
      { forms: [903, 908], delta: { fire: 2 } },
    ],
    stack: 'perEquip',
    source: 'wikiwiki.jp/kancolle「12.7cm連装砲B型改二」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: '天霧改二 / 丁 火力+2 対空+1／綾波型・暁型・初春型 対空+1',
    why: '上游漏了「天霧改二/丁」这一档（只给了綾波型通用的 対空+1），日文单列 火力+2 対空+1，EO 一致。',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 79,
    equipName: '瑞雲(六三四空)',
    watch: [
      { row: 3, fingerprint: 'who:f501.502.506.507|not:|need:|gain:flat[aa+1,evasion+1]|stack:perEquip|cap:|set:' },
      { row: 4, fingerprint: 'who:f663.668|not:|need:|gain:flat[aa+1,evasion+1]|stack:perEquip|cap:|set:' },
      { row: 5, fingerprint: 'who:f501.502.506.507|not:|need:|gain:flat[fire+2]|stack:perEquip|cap:|set:' },
      { row: 6, fingerprint: 'who:f662|not:|need:|gain:flat[evasion+1,fire+2]|stack:perEquip|cap:|set:' },
      { row: 7, fingerprint: 'who:f663.668|not:|need:|gain:flat[fire+2]|stack:perEquip|cap:|set:' },
    ],
    patches: [
      { forms: [501, 506], delta: { fire: 1, evasion: 1 } },
      { forms: [502, 507], delta: { evasion: 1 } },
      { forms: [662, 663, 668], delta: { fire: 1, evasion: 1, asw: 1 } },
    ],
    stack: 'perEquip',
    source: 'wikiwiki.jp/kancolle「瑞雲(六三四空)」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp:
      '水上爆撃機(その他日本)：能代改二 火力+3 対潜+1 回避+2／矢矧改二 / 乙 +3 対空+1 対潜+1 回避+2／最上改二 / 特 +3 +1 回避+2／' +
      '三隈改二 / 特 +2 +1 回避+2',
    why:
      '页内脚注写明这四行是「水上爆撃機(その他日本)のカテゴリ補正と水上爆撃機共通補正を加算したもので、本装備1つのみを装備する際の増分」——正是我们的共同分母（★0・1 件）' +
      '。逐格核下来日文与 EO 一致，上游整族偏低：最上改二/特 少 火力1 回避1，三隈改二/特 少 回避1，矢矧改二系与能代改二 还漏了 対潜+1。',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 80,
    equipName: '瑞雲12型',
    watch: [
      { row: 1, fingerprint: 'who:f501.502.506.507|not:|need:|gain:flat[aa+1,evasion+1]|stack:perEquip|cap:|set:' },
      { row: 2, fingerprint: 'who:f663.668|not:|need:|gain:flat[aa+1,evasion+1]|stack:perEquip|cap:|set:' },
      { row: 3, fingerprint: 'who:f501.502.506.507|not:|need:|gain:flat[fire+2]|stack:perEquip|cap:|set:' },
      { row: 4, fingerprint: 'who:f662|not:|need:|gain:flat[evasion+1,fire+2]|stack:perEquip|cap:|set:' },
      { row: 5, fingerprint: 'who:f663.668|not:|need:|gain:flat[fire+2]|stack:perEquip|cap:|set:' },
    ],
    patches: [
      { forms: [501, 506], delta: { fire: 1, evasion: 1 } },
      { forms: [502, 507], delta: { evasion: 1 } },
      { forms: [662, 663, 668], delta: { fire: 1, evasion: 1, asw: 1 } },
    ],
    stack: 'perEquip',
    source:
      'wikiwiki.jp/kancolle「瑞雲(六三四空)」「瑞雲12型(六三四空)」装備ボーナス表の「水上爆撃機(その他日本)」类目行（页面 Last-modified 2026-07-27）' +
      '＋舰娘页「能代改二」(2026-08-15)「矢矧改二」(2026-08-15) 的「水上爆撃機(共通・1機目)」＋「水上爆撃機(その他日本)」两行',
    jp:
      '水上爆撃機(その他日本)：能代改二 火力+3 対潜+1 回避+2／矢矧改二・乙 +3 対空+1 対潜+1 回避+2／最上改二・特 +3 +1 回避+2／' +
      '三隈改二・特 +2 +1 回避+2',
    why:
      '本装备自己的 wikiwiki 页没有「装備ボーナスについて」小节（页在，只是这一族的数值写在类目行里）。日文一手把这四行**写成类目行**「水上爆撃機(その他日本)' +
      '」——瑞雲系无固有補正的那几件共用同一档，两处互证：① 同族的 79 / 81 页逐格给出该类目行；② 能代改二舰娘页拆成「水上爆撃機(共通・1機目) 火力+1 対潜+1 回避+1」＋「水上爆撃機(その他日本)' +
      ' 火力+2 回避+1」，相加正是 火力+3 対潜+1 回避+2。上游是逐装备写的，把「水上爆撃機类目 × 最上改二系/阿賀野型改二系」这一层整层漏掉了。',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 81,
    equipName: '瑞雲12型(六三四空)',
    watch: [
      { row: 3, fingerprint: 'who:f501.502.506.507|not:|need:|gain:flat[aa+1,evasion+1]|stack:perEquip|cap:|set:' },
      { row: 4, fingerprint: 'who:f663.668|not:|need:|gain:flat[aa+1,evasion+1]|stack:perEquip|cap:|set:' },
      { row: 5, fingerprint: 'who:f501.502.506.507|not:|need:|gain:flat[fire+2]|stack:perEquip|cap:|set:' },
      { row: 6, fingerprint: 'who:f662|not:|need:|gain:flat[evasion+1,fire+2]|stack:perEquip|cap:|set:' },
      { row: 7, fingerprint: 'who:f663.668|not:|need:|gain:flat[fire+2]|stack:perEquip|cap:|set:' },
    ],
    patches: [
      { forms: [501, 506], delta: { fire: 1, evasion: 1 } },
      { forms: [502, 507], delta: { evasion: 1 } },
      { forms: [662, 663, 668], delta: { fire: 1, evasion: 1, asw: 1 } },
    ],
    stack: 'perEquip',
    source: 'wikiwiki.jp/kancolle「瑞雲12型(六三四空)」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp:
      '水上爆撃機(その他日本)：能代改二 火力+3 対潜+1 回避+2／矢矧改二 / 乙 +3 対空+1 対潜+1 回避+2／最上改二 / 特 +3 +1 回避+2／' +
      '三隈改二 / 特 +2 +1 回避+2',
    why:
      '页内脚注写明这四行是「水上爆撃機(その他日本)のカテゴリ補正と水上爆撃機共通補正を加算したもので、本装備1つのみを装備する際の増分」——正是我们的共同分母（★0・1 件）' +
      '。逐格核下来日文与 EO 一致，上游整族偏低：最上改二/特 少 火力1 回避1，三隈改二/特 少 回避1，矢矧改二系与能代改二 还漏了 対潜+1。',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 87,
    equipName: '新型高温高圧缶',
    watch: [
      {
        row: 1,
        fingerprint:
          'who:f591.592|not:|need:|gain:byStar[0-:evasion+2,torpedo+1;8-:evasion+3,torpedo+2;10-:evasion+3,fire+1,torpedo+2]|stack:perEquip|cap:|set:',
      },
      {
        row: 2,
        fingerprint:
          'who:f591.592.593.954|not:|need:|gain:byStar[0-:evasion+2,torpedo+1;6-:evasion+3,torpedo+1;8-:evasion+3,torpedo+2;10-:evasion+3,fire+1,torpedo+2]|stack:once|cap:|set:',
      },
    ],
    patches: [
      { forms: [591, 592], delta: { torpedo: -1, evasion: -2 } },
    ],
    stack: 'once',
    source: 'wikiwiki.jp/kancolle「新型高温高圧缶」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: '★無し～+5 金剛改二丙・比叡改二丙・榛名改二乙 / 改二丙・霧島改二丙 雷装+1 回避+2',
    why:
      '上游把同一档写了两行（第 1 行只含 591/592、第 2 行含 591/592/593/954，数值相同），591/592 两格被相加成雷装2 回避4。' +
      '日文一手与 EO 都是 雷装+1 回避+2。这是**重复行相加**，不是数值口径之争。',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 122,
    equipName: '10cm連装高角砲+高射装置',
    watch: [
      { row: 1, fingerprint: 'who:c54|not:|need:|gain:flat[aa+2,evasion+1,fire+1]|stack:perEquip|cap:|set:' },
    ],
    patches: [
      { forms: [968], delta: { fire: 1, evasion: 1, accuracy: 1 } },
    ],
    stack: 'perEquip',
    source:
      'wikiwiki.jp/kancolle「10cm連装高角砲＋高射装置」装備ボーナス表（页面 Last-modified 2026-07-27；页名全角「＋」，' +
      '取票脚本按 api 名的半角「+」取所以 404，2026-08-22 按站内真实页名补抓）',
    jp: '★0~+5 秋月型 火力+1 対空+2 回避+1／★0~+5 秋月改二・初月改二 火力+2 対空+2 回避+2 命中+1',
    why:
      '上游只写了「秋月型」一档，初月改二(968) 该在「秋月改二・初月改二」那一档。akashi 亦单列「秋月型改二 火力+2 対空+2 回避+2 命中+1」，' +
      'EO 一致。',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 131,
    equipName: '25mm三連装機銃 集中配備',
    watch: [
      { row: 1, fingerprint: 'who:c41|not:|need:|gain:flat[aa+2,evasion+1]|stack:perEquip|cap:|set:' },
    ],
    patches: [
      { forms: [668], delta: { aa: 1, evasion: 1 } },
    ],
    stack: 'perEquip',
    source: 'wikiwiki.jp/kancolle「25mm三連装機銃 集中配備」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: '25mm単装機銃・25mm連装機銃・25mm三連装機銃・25mm三連装機銃 集中配備：能代改二・矢矧改二 対空+2 回避+1／矢矧改二乙 対空+3 回避+2',
    why:
      '上游按舰级（阿賀野型）写成一档 対空+2 回避+1，日文把 矢矧改二乙 单列成 対空+3 回避+2，EO 一致。这一行在 25mm 四件机銃（39 / 40 / 49 / 131）' +
      '的页面上是同一条并列行，四件同裁。',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 207,
    equipName: '瑞雲(六三一空)',
    watch: [
      { row: 1, fingerprint: 'who:f501.502.506.507|not:|need:|gain:flat[aa+1,evasion+1]|stack:perEquip|cap:|set:' },
      { row: 2, fingerprint: 'who:f663.668|not:|need:|gain:flat[aa+1,evasion+1]|stack:perEquip|cap:|set:' },
      { row: 3, fingerprint: 'who:f501.502.506.507|not:|need:|gain:flat[fire+2]|stack:perEquip|cap:|set:' },
      { row: 4, fingerprint: 'who:f662|not:|need:|gain:flat[evasion+1,fire+2]|stack:perEquip|cap:|set:' },
      { row: 5, fingerprint: 'who:f663.668|not:|need:|gain:flat[fire+2]|stack:perEquip|cap:|set:' },
    ],
    patches: [
      { forms: [501, 506], delta: { fire: 1, evasion: 1 } },
      { forms: [502, 507], delta: { evasion: 1 } },
      { forms: [662, 663, 668], delta: { fire: 1, evasion: 1, asw: 1 } },
    ],
    stack: 'perEquip',
    source:
      'wikiwiki.jp/kancolle「瑞雲(六三四空)」「瑞雲12型(六三四空)」装備ボーナス表の「水上爆撃機(その他日本)」类目行（页面 Last-modified 2026-07-27）' +
      '＋舰娘页「能代改二」(2026-08-15)「矢矧改二」(2026-08-15) 的「水上爆撃機(共通・1機目)」＋「水上爆撃機(その他日本)」两行',
    jp:
      '水上爆撃機(その他日本)：能代改二 火力+3 対潜+1 回避+2／矢矧改二・乙 +3 対空+1 対潜+1 回避+2／最上改二・特 +3 +1 回避+2／' +
      '三隈改二・特 +2 +1 回避+2',
    why:
      '本装备自己的 wikiwiki 页没有「装備ボーナスについて」小节（页在，只是这一族的数值写在类目行里）。日文一手把这四行**写成类目行**「水上爆撃機(その他日本)' +
      '」——瑞雲系无固有補正的那几件共用同一档，两处互证：① 同族的 79 / 81 页逐格给出该类目行；② 能代改二舰娘页拆成「水上爆撃機(共通・1機目) 火力+1 対潜+1 回避+1」＋「水上爆撃機(その他日本)' +
      ' 火力+2 回避+1」，相加正是 火力+3 対潜+1 回避+2。上游是逐装备写的，把「水上爆撃機类目 × 最上改二系/阿賀野型改二系」这一层整层漏掉了。',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 208,
    equipName: '晴嵐(六三一空)',
    watch: [
      { row: 1, fingerprint: 'who:f501.502.506.507|not:|need:|gain:flat[aa+1,evasion+1]|stack:perEquip|cap:|set:' },
      { row: 2, fingerprint: 'who:f663.668|not:|need:|gain:flat[aa+1,evasion+1]|stack:perEquip|cap:|set:' },
      { row: 3, fingerprint: 'who:f501.502.506.507|not:|need:|gain:flat[fire+2]|stack:perEquip|cap:|set:' },
      { row: 4, fingerprint: 'who:f662|not:|need:|gain:flat[evasion+1,fire+2]|stack:perEquip|cap:|set:' },
      { row: 5, fingerprint: 'who:f663.668|not:|need:|gain:flat[fire+2]|stack:perEquip|cap:|set:' },
    ],
    patches: [
      { forms: [501, 506], delta: { fire: 1, evasion: 1 } },
      { forms: [502, 507], delta: { evasion: 1 } },
      { forms: [662, 663, 668], delta: { fire: 1, evasion: 1, asw: 1 } },
    ],
    stack: 'perEquip',
    source:
      'wikiwiki.jp/kancolle「瑞雲(六三四空)」「瑞雲12型(六三四空)」装備ボーナス表の「水上爆撃機(その他日本)」类目行（页面 Last-modified 2026-07-27）' +
      '＋舰娘页「能代改二」(2026-08-15)「矢矧改二」(2026-08-15) 的「水上爆撃機(共通・1機目)」＋「水上爆撃機(その他日本)」两行',
    jp:
      '水上爆撃機(その他日本)：能代改二 火力+3 対潜+1 回避+2／矢矧改二・乙 +3 対空+1 対潜+1 回避+2／最上改二・特 +3 +1 回避+2／' +
      '三隈改二・特 +2 +1 回避+2',
    why:
      '本装备自己的 wikiwiki 页没有「装備ボーナスについて」小节（页在，只是这一族的数值写在类目行里）。日文一手把这四行**写成类目行**「水上爆撃機(その他日本)' +
      '」——瑞雲系无固有補正的那几件共用同一档，两处互证：① 同族的 79 / 81 页逐格给出该类目行；② 能代改二舰娘页拆成「水上爆撃機(共通・1機目) 火力+1 対潜+1 回避+1」＋「水上爆撃機(その他日本)' +
      ' 火力+2 回避+1」，相加正是 火力+3 対潜+1 回避+2。上游是逐装备写的，把「水上爆撃機类目 × 最上改二系/阿賀野型改二系」这一层整层漏掉了。',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 228,
    equipName: '九六式艦戦改',
    watch: [
      { row: 2, fingerprint: 'who:c27|not:|need:|gain:flat[aa+4,asw+6,evasion+5,fire+3]|stack:perEquip|cap:|set:' },
    ],
    patches: [
      { forms: [894, 899], delta: { fire: 1, aa: 1, evasion: 2, asw: 2 } },
    ],
    stack: 'perEquip',
    source: 'wikiwiki.jp/kancolle「九六式艦戦改」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: '鳳翔改二 / 戦 火力+4 対空+5 対潜+8 回避+7／鳳翔 +3 +4 +6 +5',
    why: '同 19 号：上游把整个鳳翔型写成一档（用的是 鳳翔 那档的数），日文把 鳳翔改二/戦 单列高一档，EO 一致。',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 237,
    equipName: '瑞雲(六三四空/熟練)',
    watch: [
      { row: 3, fingerprint: 'who:f553.554|not:|need:|gain:flat[evasion+2,fire+4]|stack:perEquip|cap:|set:' },
      {
        row: 4,
        fingerprint:
          'who:f501.502.506.507|not:|need:|gain:flat[aa+1,evasion+2,fire+3]|stack:perEquip|cap:|set:',
      },
      { row: 5, fingerprint: 'who:f663.668|not:|need:|gain:flat[aa+1,evasion+2,fire+3]|stack:perEquip|cap:|set:' },
      { row: 6, fingerprint: 'who:f662|not:|need:|gain:flat[evasion+1,fire+3]|stack:perEquip|cap:|set:' },
    ],
    patches: [
      { forms: [501, 506], delta: { fire: 1, evasion: 1 } },
      { forms: [502, 507], delta: { evasion: 1 } },
      { forms: [553, 554], delta: { fire: 3, aa: 1, evasion: 2 } },
      { forms: [662, 663, 668], delta: { fire: 1, evasion: 1, asw: 1 } },
    ],
    stack: 'perEquip',
    source:
      'wikiwiki.jp/kancolle「瑞雲(六三四空／熟練)」装備ボーナス表（页面 Last-modified 2026-07-27；本件的页名用全角「／' +
      '」，取票脚本按 api 名的半角「/」取所以 404 了，2026-08-22 按站内真实页名补抓）',
    jp:
      '伊勢型改二 火力+7 対空+1 回避+4／能代改二 +4 対潜+1 回避+2／矢矧改二 / 乙 +4 +1 対潜+1 回避+3／最上改二 / 特 +4 +1 回避+3／' +
      '三隈改二 / 特 +3 +1 回避+3',
    why:
      '逐格核下来日文一手与 EO 一致，上游整体偏低：伊勢改二/日向改二 上游给 火力4 回避2，日文是 火力7 対空1 回避4；最上改二/特 上游少 火力1 回避1，' +
      '三隈改二/特 少 回避1，矢矧改二系与能代改二 还漏 対潜+1。akashi 逐行一致（伊勢型改二 火力+7 対空+1 回避+4／能代改二 火力+4 対潜+1 回避+2／' +
      '…）。',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 238,
    equipName: '零式水上偵察機11型乙',
    watch: [
      {
        row: 1,
        fingerprint:
          'who:f501.502.506.507|not:|need:|gain:flat[evasion+1,torpedo+1]|stack:perEquip|cap:|set:',
      },
    ],
    patches: [
      { forms: [501, 502, 506, 507], delta: { fire: 2 } },
    ],
    stack: 'perEquip',
    source: 'wikiwiki.jp/kancolle「零式水上偵察機11型乙」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: '零式水上偵察機11型乙・同(熟練)：最上改二 / 特・三隈改二 / 特 火力+2 雷装+1 回避+1',
    why: '上游只写了 雷装+1 回避+1，漏掉 火力+2；日文一手与 EO 逐格一致。该行日文原表**同时覆盖 238 与 239 两件**。',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 239,
    equipName: '零式水上偵察機11型乙(熟練)',
    watch: [
      {
        row: 1,
        fingerprint:
          'who:f501.502.506.507|not:|need:|gain:flat[evasion+1,torpedo+1]|stack:perEquip|cap:|set:',
      },
    ],
    patches: [
      { forms: [501, 502, 506, 507], delta: { fire: 2 } },
    ],
    stack: 'perEquip',
    source:
      'wikiwiki.jp/kancolle「零式水上偵察機11型乙」装備ボーナス表（页面 Last-modified 2026-07-27）；本件自身页较旧（Last-modified 2026-01-04）' +
      '，但 238 页（2026-07-27）那一行的「装備」栏原文就写着「零式水上偵察機11型乙／零式水上偵察機11型乙(熟練)」两件并列，用更新的那张也读到同一档',
    jp: '零式水上偵察機11型乙・同(熟練)：最上改二 / 特・三隈改二 / 特 火力+2 雷装+1 回避+1',
    why: '上游只写了 雷装+1 回避+1，漏掉 火力+2；日文一手与 EO 逐格一致。该行日文原表**同时覆盖 238 与 239 两件**。',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 267,
    equipName: '12.7cm連装砲D型改二',
    watch: [
      {
        row: 2,
        fingerprint:
          'who:c22.38|not:f542.543.563.564.569.578.649.955.960|need:|gain:flat[evasion+1,fire+2]|stack:perEquip|cap:|set:',
      },
      {
        row: 4,
        fingerprint:
          'who:f542.543.563.564.569.578.648|not:|need:|gain:flat[evasion+1,fire+3]|stack:perEquip|cap:|set:',
      },
      { row: 6, fingerprint: 'who:f961|not:|need:|gain:flat[fire+2]|stack:perEquip|cap:|set:' },
      { row: 7, fingerprint: 'who:f648.961|not:|need:|gain:flat[aa+2,evasion+3,fire+2]|stack:perEquip|cap:|set:' },
    ],
    patches: [
      { forms: [648, 961], delta: { fire: -2, aa: -2, evasion: -3 } },
      { forms: [956], delta: { fire: 2 } },
      { forms: [981], delta: { fire: 1 } },
    ],
    stack: 'perEquip',
    source: 'wikiwiki.jp/kancolle「12.7cm連装砲D型改二」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: '高波改二・早霜改二・清霜改二 / 丁 火力+4 回避+1／秋雲改二・他夕雲型改二 +3 +1／他夕雲型・島風 +2 +1／時雨改三 +2',
    why:
      '秋雲改二(648) 与 時雨改三(961) 上游把「探照灯／熟練見張員」那两条**协同**行写成了无条件行（第 7 行），在 ★0・无协同 的共同分母上凭空多出 火力2 対空2 回避3；早霜改二(956)' +
      ' 与 藤波改二(981) 则是分档缺失（上游的 +4 档漏了早霜改二、+3 档漏了藤波改二，两者都掉进了「他夕雲型」+2 档）。EO 逐格与日文一致。',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 296,
    equipName: '12.7cm連装砲B型改四(戦時改修)+高射装置',
    watch: [
      {
        row: 2,
        fingerprint:
          'who:c10.23|not:f144.145.469.497.498.587.588.667.961|need:|gain:flat[evasion+1,fire+1]|stack:perEquip|cap:|set:',
      },
    ],
    patches: [
      { forms: [975], delta: { aa: 1, evasion: 1 } },
    ],
    stack: 'perEquip',
    source:
      'wikiwiki.jp/kancolle「12.7cm連装砲B型改四(戦時改修)＋高射装置」装備ボーナス表（页面 Last-modified 2026-07-27；页名全角「＋」，' +
      '取票脚本按半角取所以 404，2026-08-22 按站内真实页名补抓）',
    jp:
      '村雨改二・春雨改二 火力+1 対空+1 回避+2／白露改・海風改二・江風改二・山風改二 / 改二丁 +1 回避+2／初春型 +1 回避+1／他白露型(未改造から)' +
      ' +1 回避+1',
    why:
      '村雨改(244) 本方对——它既不在「村雨改二・春雨改二」档也不在「白露改…」档，吃「他白露型」火力+1 回避+1，EO 那边多给了 回避1。春雨改二(975)' +
      ' 则上游漏档（应在 火力+1 対空+1 回避+2），EO 与日文一致。（本件是**部分裁决**，其余格见 PENDING 台账的注记）',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 298,
    equipName: '16inch Mk.I三連装砲',
    watch: [
      {
        row: 1,
        fingerprint:
          'who:f149.150.151.152.593.954|not:|need:|gain:flat[armor+1,evasion-3,fire+1]|stack:perEquip|cap:|set:',
      },
    ],
    patches: [
      { forms: [593, 954], delta: { evasion: 2 } },
    ],
    stack: 'perEquip',
    source: 'wikiwiki.jp/kancolle「16inch Mk.I三連装砲」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: '榛名改二乙・榛名改二丙 火力+1 回避-1 装甲+1／金剛型改二 +1 回避-3 装甲+1',
    why:
      '上游把 榛名改二乙/丙 并进了「金剛型改二」档（回避-3），日文单列这两个形态为 回避-1，akashi 同款（「榛名改二乙・榛名改二丙 火力+1 装甲+1 回避-1」）' +
      '，EO 一致。',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 299,
    equipName: '16inch Mk.I三連装砲+AFCT改',
    watch: [
      {
        row: 1,
        fingerprint:
          'who:f149.150.151.152.593.954|not:|need:|gain:flat[armor+1,evasion-3,fire+1]|stack:perEquip|cap:|set:',
      },
    ],
    patches: [
      { forms: [593, 954], delta: { evasion: 2 } },
    ],
    stack: 'perEquip',
    source:
      'wikiwiki.jp/kancolle「16inch Mk.I三連装砲＋AFCT改」装備ボーナス表（页面 Last-modified 2026-07-27）' +
      '（页名全角「＋」，取票脚本按半角取所以 404，2026-08-22 按站内真实页名补抓）',
    jp: '榛名改二乙・榛名改二丙 火力+1 回避-1 装甲+1／金剛型改二 +1 回避-3 装甲+1',
    why:
      '上游把 榛名改二乙/丙 并进了「金剛型改二」档（回避-3），日文单列这两个形态为 回避-1，akashi 同款（「榛名改二乙・榛名改二丙 火力+1 装甲+1 回避-1」）' +
      '，EO 一致。',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 300,
    equipName: '16inch Mk.I三連装砲改+FCR type284',
    watch: [
      {
        row: 1,
        fingerprint:
          'who:f149.150.151.152.593.954|not:|need:|gain:flat[armor+1,evasion-3,fire+1]|stack:perEquip|cap:|set:',
      },
    ],
    patches: [
      { forms: [593, 954], delta: { evasion: 2 } },
    ],
    stack: 'perEquip',
    source:
      'wikiwiki.jp/kancolle「16inch Mk.I三連装砲改＋FCR type284」装備ボーナス表（页面 Last-modified 2026-07-27）' +
      '（页名全角「＋」，取票脚本按半角取所以 404，2026-08-22 按站内真实页名补抓）',
    jp: '榛名改二乙・榛名改二丙 火力+1 回避-1 装甲+1／金剛型改二 +1 回避-3 装甲+1',
    why:
      '上游把 榛名改二乙/丙 并进了「金剛型改二」档（回避-3），日文单列这两个形态为 回避-1，akashi 同款（「榛名改二乙・榛名改二丙 火力+1 装甲+1 回避-1」）' +
      '，EO 一致。',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 304,
    equipName: 'S9 Osprey',
    watch: [
      {
        row: 1,
        fingerprint:
          'who:c4.16.20.41|not:|need:|gain:flat[asw+1,evasion+1,fire+1]|stack:perEquip|cap:|set:',
      },
    ],
    patches: [
      { forms: [662, 663, 668], delta: { fire: 2, evasion: 1, asw: 3 } },
    ],
    stack: 'perEquip',
    source: 'wikiwiki.jp/kancolle「S9 Osprey」装備ボーナス表（页面 Last-modified 2025-01-27）',
    jp: '能代改二・矢矧改二 / 乙 火力+3 対潜+4 回避+2（脚注：水上偵察機全般のボーナスと重複せず、こちらを優先する）',
    why:
      '上游只给了「阿賀野型」通用的 火力1 対潜1 回避1，漏掉 S9 专属那一档。日文页明确写这一档**优先**于水偵通用档，EO 一致。akashi 给的「能代改二・矢矧改二/乙 火力+2 対潜+3 回避+1」正是**水偵通用**那一档的数（与能代改二舰娘页的「水上偵察機 火力+2 対潜+3 回避+1」逐格相同）' +
      '，即 akashi 那张没有收录 S9 的专属覆盖档，不构成同粒度反证。本页取票日 2025-01-27，是各件里最旧的一张，复审优先。',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 310,
    equipName: '14cm連装砲改',
    watch: [
      { row: 1, fingerprint: 'who:c34|not:|need:|gain:flat[aa+1,evasion+1,fire+2]|stack:perEquip|cap:|set:' },
      {
        row: 2,
        fingerprint:
          'who:c34|not:|need:|gain:byStar[0-:aa+1,asw+1,evasion+2,fire+4;7-:aa+1,asw+1,evasion+2,fire+5,torpedo+1;10-:aa+1,asw+1,evasion+2,fire+7,torpedo+1]|stack:perEquip|cap:|set:',
      },
    ],
    patches: [
      { forms: [115, 293], delta: { fire: -4, aa: -1, evasion: -2, asw: -1 } },
      { forms: [622, 623, 624], delta: { fire: -2, aa: -1, evasion: -1 } },
    ],
    stack: 'perEquip',
    source: 'wikiwiki.jp/kancolle「14cm連装砲改」装備ボーナス表（页面 Last-modified 2026-08-13）',
    jp: '★無し 夕張 火力+2 対空+1 回避+1／★無し 夕張改二 / 特 / 丁 火力+4 対空+1 対潜+1 回避+2',
    why:
      '上游把「夕張」与「夕張改二系」两档都写成了 `classes:[34]` 的无条件行，两行相加 → 全夕張型一律 火力6 対空2 回避3 対潜1，这是**两档相加**的解析事故，' +
      '不是数值口径之争。日文一手是分档的（夕張/夕張改 2/1/1；夕張改二系 4/1/対潜1/2），EO 逐格与之一致；akashi 的「夕張 火力+2 対空+1 回避+1」也对得上。',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 315,
    equipName: 'SG レーダー(初期型)',
    watch: [
      {
        row: 3,
        fingerprint:
          'who:f651.656|not:|need:|gain:flat[aa+2,evasion+3,fire+2,range+1]|stack:perEquip|cap:|set:',
      },
    ],
    patches: [
      { forms: [651, 656], delta: { aa: -2, evasion: -1, los: 3 } },
    ],
    stack: 'perEquip',
    source: 'wikiwiki.jp/kancolle「SG レーダー(初期型)」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: '丹陽 / 雪風改二 火力+2 索敵+3 回避+2 射程+1／アメリカ艦(駆逐艦) +3 索敵+4 回避+3 射程+1',
    why:
      '上游这一行三处不对：凭空多了 対空+2、回避多 1、且把 索敵+3 整栏漏了。akashi 逐格与 wikiwiki 一致（丹陽・雪風改二 火力+2 回避+2 索敵+3 射程:長）' +
      '，EO 也一致。',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 323,
    equipName: '瑞雲改二(六三四空/熟練)',
    watch: [
      {
        row: 1,
        fingerprint:
          'who:f553.554|not:|need:|gain:flat[aa+3,asw+2,evasion+3,fire+6]|stack:perEquip|cap:|set:',
      },
      {
        row: 2,
        fingerprint:
          'who:f501.502.506.507|not:|need:|gain:flat[aa+1,evasion+2,fire+3]|stack:perEquip|cap:|set:',
      },
      { row: 3, fingerprint: 'who:f663.668|not:|need:|gain:flat[aa+1,evasion+2,fire+3]|stack:perEquip|cap:|set:' },
      { row: 4, fingerprint: 'who:f662|not:|need:|gain:flat[evasion+1,fire+3]|stack:perEquip|cap:|set:' },
    ],
    patches: [
      { forms: [501, 506], delta: { fire: 1, evasion: 1 } },
      { forms: [502, 507], delta: { evasion: 1 } },
      { forms: [553, 554], delta: { fire: 3, aa: 1, evasion: 2 } },
      { forms: [662, 663, 668], delta: { fire: 1, evasion: 1, asw: 1 } },
    ],
    stack: 'perEquip',
    source: 'wikiwiki.jp/kancolle「瑞雲改二(六三四空／熟練)」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp:
      '伊勢型改二 火力+9 対空+4 対潜+2 回避+5／能代改二 +4 対潜+1 回避+2／矢矧改二 / 乙 +4 +1 対潜+1 回避+3／最上改二 / 特 +4 +1 回避+3／' +
      '三隈改二 / 特 +3 +1 回避+3',
    why:
      'wikiwiki 与 akashi **两张日文票逐格完全一致**（akashi：伊勢型改二 火力+9 対空+4 対潜+2 回避+5／能代改二 火力+4 対潜+1 回避+2／' +
      '矢矧改二/乙 火力+4 対空+1 対潜+1 回避+3／最上改二/特 火力+4 対空+1 回避+3），且与 EO 逐格一致。上游偏低同 322 一族。',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 328,
    equipName: '35.6cm連装砲改',
    watch: [
      {
        row: 2,
        fingerprint:
          'who:f149.150.151.152.209.210.211.212.954|not:|need:|gain:flat[evasion+1,fire+2]|stack:perEquip|cap:|set:',
      },
    ],
    patches: [
      { forms: [954], delta: { fire: 1, aa: 1 } },
    ],
    stack: 'perEquip',
    source: 'wikiwiki.jp/kancolle「35.6cm連装砲改」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp:
      '金剛改二丙 火力+3 雷装+1 回避+1／比叡改二丙・榛名改二丙・霧島改二丙 +3 対空+1 回避+1／榛名改二乙 +2 対空+2 回避+1／金剛型改 / 改二 +2 回避+1／' +
      '金剛型(未改造)・扶桑型・伊勢型 +1',
    why:
      '金剛型未改造 4 格本方对（火力+1，日文这一档没有回避，EO 那边多给了 回避+1）。榛名改二丙(954) 一格上游落进了「金剛型改/改二」档（火力2 回避1）' +
      '，日文单列 火力+3 対空+1 回避+1，EO 一致。（本件是**部分裁决**，其余格见 PENDING 台账的注记）',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 329,
    equipName: '35.6cm連装砲改二',
    watch: [
      {
        row: 3,
        fingerprint:
          'who:f149.150.151.152.954|not:|need:|gain:flat[aa+1,evasion+1,fire+3]|stack:perEquip|cap:|set:',
      },
    ],
    patches: [
      { forms: [954], delta: { fire: 1, torpedo: 2 } },
    ],
    stack: 'perEquip',
    source: 'wikiwiki.jp/kancolle「35.6cm連装砲改二」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp:
      '金剛改二丙・比叡改二丙・榛名改二丙 火力+4 雷装+2 対空+1 回避+1／榛名改二乙 +3 +1 対空+3 回避+1／霧島改二丙 +5 +1 +1 +1／' +
      '金剛型改二 +3 対空+1 回避+1／金剛型改 +2 回避+1／金剛型(未改造)・扶桑型・伊勢型 +1',
    why:
      '金剛型未改造 4 格本方对（EO 多给 回避+1）。榛名改二丙(954) 上游落进「金剛型改二」档（火力3 対空1 回避1），日文单列在「金剛改二丙・比叡改二丙・榛名改二丙」档 火力+4 雷装+2 対空+1 回避+1，' +
      'EO 一致。（本件是**部分裁决**，其余格见 PENDING 台账的注记）',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 332,
    equipName: '16inch Mk.VIII連装砲改',
    watch: [
      { row: 3, fingerprint: 'who:f1496|not:|need:|gain:flat[aa+1,fire+2]|stack:perEquip|cap:|set:' },
    ],
    patches: [
      { forms: [1496], delta: { evasion: 1 } },
    ],
    stack: 'perEquip',
    source: 'wikiwiki.jp/kancolle「16inch Mk.VIII連装砲改」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: 'Colorado改・Maryland改 火力+2 対空+1 回避+1',
    why: '上游漏了 回避+1 这一栏，火力与对空两栏无误；EO 与日文一致。',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 342,
    equipName: '流星改(一航戦)',
    watch: [
      {
        row: 2,
        fingerprint:
          'who:f594.646.698|not:|need:|gain:flat[aa+2,evasion+1,fire+2]|stack:perEquip|cap:|set:',
      },
    ],
    patches: [
      { forms: [594, 646, 698], delta: { aa: -1 } },
    ],
    stack: 'perEquip',
    source: 'wikiwiki.jp/kancolle「流星改(一航戦)」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: '赤城改二戊・加賀改二戊 火力+3 対空+2 回避+2／赤城改二・加賀改二 / 改二護 +2 +1 +1',
    why: '上游把 改二戊 那档的 対空+2 也给了 改二/改二護，日文这一档是 対空+1，EO 一致；火力与回避两栏无误。',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 359,
    equipName: '6inch 連装速射砲 Mk.XXI',
    watch: [
      { row: 1, fingerprint: 'who:c34|not:|need:|gain:flat[aa+2,evasion+1,fire+2]|stack:perEquip|cap:|set:' },
      { row: 2, fingerprint: 'who:c34|not:|need:|gain:flat[aa+1,evasion+1,fire+1]|stack:perEquip|cap:|set:' },
    ],
    patches: [
      { forms: [115, 293], delta: { fire: -2, aa: -2, evasion: -1 } },
      { forms: [622, 623, 624], delta: { fire: -1, aa: -1, evasion: -1 } },
    ],
    stack: 'perEquip',
    source: 'wikiwiki.jp/kancolle「6inch 連装速射砲 Mk.XXI」装備ボーナス表（页面 Last-modified 2026-03-18）',
    jp: 'Perth 火力+2 対空+2 回避+1／夕張 / 改 +1 +1 +1／夕張改二 / 改二特 / 改二丁 +2 +2 +1',
    why:
      '与 310 同一个解析事故：上游两条 `classes:[34]` 无条件行相加 → 全夕張型 火力3 対空3 回避2。日文一手分档（夕張/改 1/1/1；夕張改二系 2/2/1）' +
      '，EO 逐格一致。',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 364,
    equipName: '甲標的 丁型改(蛟龍改)',
    watch: [
      {
        row: 3,
        fingerprint:
          'who:f118.501.502.506.507.586.662.663.668|not:|need:|gain:flat[evasion-2,torpedo+1]|stack:perEquip|cap:|set:',
      },
    ],
    patches: [
      { forms: [507], delta: { torpedo: 2 } },
    ],
    stack: 'perEquip',
    source: 'wikiwiki.jp/kancolle「甲標的 丁型改(蛟龍改)」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: '夕張改二特 火力+1 雷装+4 回避-2／三隈改二特 雷装+3 回避-2／北上改二 雷装+2 回避-2／球磨改二丁・大井改二・矢矧改二乙・最上改二特・日進甲 雷装+1 回避-2',
    why:
      '7 格里 6 格本方对——日文与本方都给 回避-2，EO 那边整片写成 回避+5（符号方向都不同），日文站本方。只有 **三隈改二特(507)** 一格：日文单列一档 雷装+3 回避-2，' +
      '本方把它并进了 雷装+1 那档。akashi 表里没有三隈改二特这一行（它只有四行，粒度更粗），不构成同粒度反证。（本件是**部分裁决**，其余格见 PENDING 台账的注记）',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 365,
    equipName: '一式徹甲弾改',
    watch: [
      { row: 1, fingerprint: 'who:f591.592.593.954|not:|need:|gain:byCount[1:fire+3]|stack:table|cap:|set:' },
      {
        row: 3,
        fingerprint:
          'who:c2.6.19.26.37|not:f541.546.573.591.592.593.911.916.954|need:|gain:byCount[1:fire+1]|stack:table|cap:|set:',
      },
    ],
    patches: [
      { forms: [136, 148], delta: { fire: 1 } },
      { forms: [593], delta: { fire: -1 } },
      { forms: [694], delta: { fire: 2 } },
    ],
    stack: 'once',
    source: 'wikiwiki.jp/kancolle「一式徹甲弾改」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp:
      '金剛改二丙・比叡改二丙・榛名改二丙・霧島改二丙 火力+3／大和改 / 改二 / 改二重・武蔵改 / 改二・長門改二・陸奥改二・榛名改二乙 +2／金剛型(未改造)' +
      ' / 改 / 改二・扶桑型・伊勢型・長門・陸奥・大和・武蔵 +1',
    why:
      '四格都是分档错位：大和改(136)/武蔵改(148) 应在 +2 档（上游给 +1），霧島改二丙(694) 应在 +3 档（上游给 +1），榛名改二乙(593)' +
      ' 应在 +2 档（上游给 +3）。EO 逐格与日文一致。akashi 粒度更粗（只有「金剛型改二丙 +3／武蔵改・大和改・長門改二・陸奥改二 +2／その他日本戦艦 +1」三档，' +
      '未单列 榛名改二乙），不构成同粒度反证。',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 366,
    equipName: '12.7cm連装砲D型改三',
    watch: [
      {
        row: 5,
        fingerprint:
          'who:f961|not:|need:|gain:byCount[1:aa+3,accuracy+1,fire+3;2:aa+5,accuracy+1,fire+7]|stack:table|cap:|set:',
      },
      {
        row: 6,
        fingerprint:
          'who:c38|not:f542.543.563.564.569.578.649.955.960|need:|gain:flat[evasion+1,fire+2]|stack:perEquip|cap:|set:',
      },
      {
        row: 9,
        fingerprint:
          'who:f569.648|not:|need:|gain:byCount[1:aa+5,accuracy+1,evasion+1,fire+5;2:aa+7,accuracy+1,evasion+2,fire+10]|stack:table|cap:|set:',
      },
      { row: 10, fingerprint: 'who:f648.961|not:|need:|gain:flat[aa+2,evasion+3,fire+2]|stack:perEquip|cap:|set:' },
    ],
    patches: [
      { forms: [648, 961], delta: { fire: -2, aa: -2, evasion: -3 } },
      { forms: [956], delta: { fire: 3, aa: 3, accuracy: 1 } },
      { forms: [981], delta: { fire: 2, aa: 3, accuracy: 1 } },
    ],
    stack: 'once',
    source: 'wikiwiki.jp/kancolle「12.7cm連装砲D型改三」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp:
      'x1 秋雲改二・沖波改二 火力+5 対空+5 回避+1 命中+1／x1 高波改二・早霜改二・清霜改二丁 +5 +3 +1 +1／x1 他夕雲型改二 +4 +3 +1 +1／' +
      'x1 時雨改三 +3 +3 命中+1',
    why:
      '同 267：秋雲改二/時雨改三 被「探照灯・熟練見張員」协同行（上游第 10 行写成无条件）顶高，早霜改二/藤波改二 分档缺失。EO 逐格与日文一致。**注意**：该页有两张加成表，' +
      '第二张的表前文字写明是「2022/07/13アップデート以前」的旧表（旧表 他夕雲型改二 是 火力+3、无命中；同页明确写了「夕雲型改二・島風改においてそれぞれ火力+1命中+1の上方修正」）' +
      '。akashi 那张给的正是旧表的 火力+3——属**过期**而非同期反证，取现行表。',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 370,
    equipName: 'Swordfish Mk.II改(水偵型)',
    watch: [
      { row: 4, fingerprint: 'who:c67|not:|need:|gain:flat[asw+3,evasion+3,fire+6,los+3]|stack:perEquip|cap:|set:' },
    ],
    patches: [
      { forms: [733, 927], delta: { fire: -1, evasion: 1 } },
    ],
    stack: 'perEquip',
    source: 'wikiwiki.jp/kancolle「Swordfish Mk.II改(水偵型)」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: 'Warspite 火力+6 対潜+3 索敵+3 回避+3／Valiant 火力+5 対潜+3 索敵+3 回避+4',
    why:
      '上游按舰级（Warspite改型）把 Valiant 与 Warspite 写成同一档，日文把两舰**单列成两档**（Valiant 火力低 1、回避高 1）' +
      '，EO 一致。akashi 那张只有 Warspite 行、没有 Valiant 行，不构成反证。',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 371,
    equipName: 'Fairey Seafox改',
    watch: [
      { row: 5, fingerprint: 'who:c88|not:|need:|gain:flat[asw+1,evasion+1,fire+6,los+5]|stack:perEquip|cap:|set:' },
    ],
    patches: [
      { forms: [571, 572, 576, 577], delta: { evasion: 3 } },
    ],
    stack: 'perEquip',
    source: 'wikiwiki.jp/kancolle「Fairey Seafox改」装備ボーナス表（页面 Last-modified 2026-07-30）',
    jp: 'Nelson・Rodney 火力+6 対潜+1 索敵+5 回避+4',
    why: '上游 回避只给了 +1，日文与 akashi 都是 回避+4，EO 一致。其余三栏逐格无误。',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 372,
    equipName: '天山一二型甲',
    watch: [
      { row: 5, fingerprint: 'who:f318.555.560|not:|need:|gain:flat[asw+1,fire+1]|stack:perEquip|cap:|set:' },
    ],
    patches: [
      { forms: [318, 555, 560], delta: { fire: -1, torpedo: 1 } },
    ],
    stack: 'perEquip',
    source: 'wikiwiki.jp/kancolle「天山一二型甲」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: '瑞鳳改二 / 乙・龍鳳改 雷装+1 対潜+1（火力栏为空）',
    why: '上游把 雷装+1 记成了 **火力+1**（栏搞错），日文原表这一档火力栏是空的，EO 一致。',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 373,
    equipName: '天山一二型甲改(空六号電探改装備機)',
    watch: [
      { row: 4, fingerprint: 'who:f74.116|not:|need:|gain:flat[asw+1,torpedo+1]|stack:perEquip|cap:|set:' },
    ],
    patches: [
      { forms: [74, 116], delta: { torpedo: -1 } },
    ],
    stack: 'perEquip',
    source: 'wikiwiki.jp/kancolle「天山一二型甲改(空六号電探改装備機)」装備ボーナス表（页面 Last-modified 2026-08-01）',
    jp: '祥鳳・瑞鳳 対潜+1（火力・雷装栏为空）／祥鳳改・瑞鳳改・龍鳳 火力+1 雷装+1 対潜+1',
    why: '未改造的 祥鳳(74)/瑞鳳(116) 日文只给 対潜+1，上游多给了 雷装+1（那是「改」以后那一档的），EO 一致。',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 374,
    equipName: '天山一二型甲改(熟練/空六号電探改装備機)',
    watch: [
      {
        row: 4,
        fingerprint:
          'who:f318.555.560|not:|need:|gain:flat[asw+3,evasion+2,fire+1,torpedo+1]|stack:perEquip|cap:|set:',
      },
      {
        row: 6,
        fingerprint:
          'who:f883|not:|need:|gain:flat[asw+3,evasion+3,fire+2,torpedo+3]|stack:perEquip|cap:|set:',
      },
      {
        row: 7,
        fingerprint:
          'who:f318.555.560|not:|need:|gain:byCount[1:asw+3,evasion+2,fire+1,torpedo+1;2:asw+3,fire+1]|stack:table|cap:|set:',
      },
      {
        row: 11,
        fingerprint:
          'who:f282|not:|need:|gain:flat[asw+2,evasion+1,fire+1,torpedo+2]|stack:perEquip|cap:|set:',
      },
    ],
    patches: [
      { forms: [282], delta: { torpedo: -1 } },
      { forms: [318, 555, 560], delta: { fire: -1, torpedo: -1, evasion: -2, asw: -3 } },
      { forms: [883], delta: { evasion: 2 } },
    ],
    stack: 'once',
    source:
      'wikiwiki.jp/kancolle「天山一二型甲改(熟練／空六号電探改装備機)」装備ボーナス表（页面 Last-modified 2026-08-07；页名全角「／' +
      '」，取票脚本按半角取所以 404，2026-08-22 按站内真实页名补抓）',
    jp: '龍鳳改二戊 火力+2 雷装+3 対潜+3 回避+5／瑞鳳改二 / 乙・龍鳳改 +1 +1 対潜+3 回避+2／祥鳳改 +1 +1 対潜+2 回避+1',
    why:
      '瑞鳳改二/乙・龍鳳改 三格上游把同一档写了两遍（第 4 行 flat 与第 7 行 byCount 的第 1 档同值），被相加成 2/2/対潜6/回避4；日文与 EO 都是 1/1/対潜3/回避2。' +
      '祥鳳改 上游多给 雷装1；龍鳳改二戊 上游少 回避2。',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 380,
    equipName: '12.7cm連装高角砲改二',
    watch: [
      { row: 7, fingerprint: 'who:f488|not:|need:|gain:flat[aa+4,asw+2,fire+2]|stack:perEquip|cap:|set:' },
      { row: 8, fingerprint: 'who:f488|not:|need:|gain:flat[aa+4,asw+2,fire+2]|stack:perEquip|cap:|set:' },
    ],
    patches: [
      { forms: [488], delta: { fire: -2, aa: -4, asw: -2 } },
    ],
    stack: 'perEquip',
    source: 'wikiwiki.jp/kancolle「12.7cm連装高角砲改二」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: '由良改二 火力+2 対空+4 対潜+2',
    why:
      '上游把 由良改二 这一档**写了两条一模一样的行**（第 7、8 行 who 都是 forms:[488]、数值都是 火力2 対空4 対潜2），于是被相加成 4/8/4。' +
      '日文一手与 EO 都是 2/4/2。这是重复行相加，不是数值口径之争。',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 382,
    equipName: '12cm単装高角砲E型',
    watch: [
      { row: 1, fingerprint: 'who:t1|not:|need:|gain:flat[aa+2,asw+1,evasion+2]|stack:perEquip|cap:|set:' },
    ],
    patches: [
      { forms: [979], delta: { fire: 1, aa: 1, evasion: 1, accuracy: 1 } },
    ],
    stack: 'perEquip',
    source: 'wikiwiki.jp/kancolle「12cm単装高角砲E型」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: '稲木改二 火力+1 対空+3 対潜+1 回避+3 命中+1／海防艦(稲木改二除く) 対空+2 対潜+1 回避+2',
    why: '上游没有 稲木改二 这一档，它落进了「海防艦」通用档。日文单列，EO 一致。akashi 那张只有「海防艦」行、没有 稲木改二 行，不构成反证。',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 383,
    equipName: '後期型53cm艦首魚雷(8門)',
    watch: [
      { row: 3, fingerprint: 'who:f607.636|not:|need:|gain:flat[torpedo+3]|stack:perEquip|cap:|set:' },
    ],
    patches: [
      { forms: [607], delta: { torpedo: 1 } },
    ],
    stack: 'perEquip',
    source: 'wikiwiki.jp/kancolle「後期型53cm艦首魚雷(8門)」装備ボーナス表（页面 Last-modified 2026-08-10）',
    jp: '★0～4 伊47 雷装+3／★0～4 伊47改 雷装+4',
    why: '上游把 伊47 与 伊47改 并成一档（雷装+3），日文把 伊47改 单列成 雷装+4，akashi 同款，EO 一致。',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 384,
    equipName: '後期型潜水艦搭載電探&逆探',
    watch: [
      {
        row: 2,
        fingerprint:
          'who:f155.403.493.606.607.636|not:|need:|gain:flat[evasion+3]|stack:perEquip|cap:|set:',
      },
    ],
    patches: [
      { forms: [607], delta: { evasion: 1 } },
    ],
    stack: 'perEquip',
    source:
      'wikiwiki.jp/kancolle「後期型潜水艦搭載電探＆逆探」装備ボーナス表（页面 Last-modified 2026-04-25；页名全角「＆」，' +
      '取票脚本按 api 名的半角「&」取所以 404，2026-08-22 按站内真实页名补抓）',
    jp: '伊58 回避+2／伊400・伊401・伊47 回避+3／伊47改 回避+4',
    why:
      '与 383 同一个并档问题：上游把 伊47改 并进 伊47 那档（回避+3），日文单列 回避+4，EO 一致。akashi 那张只到「伊400・伊401・伊47 回避+3」、' +
      '没有 伊47改 行，不构成反证。',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 385,
    equipName: '16inch三連装砲 Mk.6 mod.2',
    watch: [
      {
        row: 2,
        fingerprint:
          'who:c65.93.125|not:|need:|gain:byStar[0-:fire+2;6-:fire+3;10-:armor+1,fire+3]|stack:perEquip|cap:|set:',
      },
    ],
    patches: [
      { forms: [924, 929, 936], delta: { fire: -1 } },
    ],
    stack: 'perEquip',
    source: 'wikiwiki.jp/kancolle「16inch三連装砲 Mk.6 mod.2」装備ボーナス表（页面 Last-modified 2026-08-03）',
    jp: '★無し～5 Nevada 火力+1／★無し～5 Colorado・Maryland・Iowa 火力+2',
    why:
      '上游把 Nevada 型并进了 Colorado/Maryland/Iowa 那档（火力+2），日文单列 Nevada ★無し～5 火力+1，EO 一致。' +
      'akashi 那张压根没有 Nevada 行，不构成反证。',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 392,
    equipName: '九九式艦爆二二型(熟練)',
    watch: [
      {
        row: 3,
        fingerprint:
          'who:f112.117.282.288.318.883.888|not:|need:|gain:flat[evasion+2,fire+2]|stack:perEquip|cap:|set:',
      },
    ],
    patches: [
      { forms: [112, 288], delta: { evasion: -1 } },
    ],
    stack: 'perEquip',
    source: 'wikiwiki.jp/kancolle「九九式艦爆二二型(熟練)」装備ボーナス表（页面 Last-modified 2026-07-26）',
    jp:
      '瑞鳳改二 / 乙 火力+3 回避+2／瑞鳳改・祥鳳改・龍鳳改 +2 +2／瑞鳳・龍鳳・翔鶴・瑞鶴 +2 +1／飛鷹改・隼鷹改二 +1 +1（「艦名記載は、' +
      'その値が適用される一番下の改造段階が基準」）',
    why:
      '祥鳳改(282) 本方对——日文单列「瑞鳳改・祥鳳改・龍鳳改 火力+2 回避+2」，akashi 同款，EO 那边只给 回避+1 是错的。翔鶴改(288)' +
      '/瑞鶴改(112) 则相反：按「一番下の改造段階が基準」它们继承「翔鶴・瑞鶴 火力+2 回避+1」，本方多给了 回避1，EO 与日文一致（akashi 记作「翔鶴型 火力+2 回避+1」，' +
      '同）。（本件是**部分裁决**，其余格见 PENDING 台账的注记）',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 409,
    equipName: '武装大発',
    watch: [
      { row: 1, fingerprint: 'who:f621.626|not:|need:|gain:flat[aa+2,evasion+3,fire+2]|stack:perEquip|cap:|set:' },
      {
        row: 2,
        fingerprint:
          'who:f161.166|not:|need:|gain:flat[aa+1,asw+1,evasion+1,fire+1]|stack:perEquip|cap:|set:',
      },
    ],
    patches: [
      { forms: [161, 166], delta: { evasion: 1 } },
      { forms: [621, 626], delta: { fire: -1 } },
    ],
    stack: 'perEquip',
    source: 'wikiwiki.jp/kancolle「武装大発」装備ボーナス表（页面 Last-modified 2026-08-14）',
    jp: '神州丸 火力+1 対空+2 回避+3／あきつ丸 火力+1 対空+1 対潜+1 回避+2',
    why:
      '神州丸系上游多给 火力1，あきつ丸系上游少 回避1；EO 逐格与日文一致。akashi 那张（神州丸 火力+2 索敵+2 回避+3／あきつ丸 火力+1 索敵+1 対潜+1 回避+1）' +
      '在**栏名**上就与两方都不同（把 対空 记成了 索敵），属其自身表格的列错位，不作为同粒度反证；wikiwiki 这张 2026-08-14 更新且与 EO 独立吻合。',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 410,
    equipName: '21号対空電探改二',
    watch: [
      {
        row: 2,
        fingerprint:
          'who:c54|not:|need:|gain:byCount[1:aa+5,armor+1,evasion+4,fire+1,los+2]|stack:table|cap:|set:',
      },
    ],
    patches: [
      { forms: [968], delta: { fire: 1, aa: 1, evasion: 1 } },
    ],
    stack: 'once',
    source: 'wikiwiki.jp/kancolle「21号対空電探改二」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: '秋月型・最上改・最上改二 / 特・三隈改二 / 特 火力+1 対空+5 索敵+2 装甲+1 回避+4／秋月改二・初月改二 火力+2 対空+6 索敵+2 装甲+1 回避+5',
    why:
      '上游只写了「秋月型」一档，初月改二(968) 该在「秋月改二・初月改二」那一档（火力/対空/回避 各高 1）。EO 一致。akashi 那张只到「秋月型・最上改」与「最上改二/特」两行、' +
      '没有秋月改二档，不构成反证。',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 411,
    equipName: '42号対空電探改二',
    watch: [
      {
        row: 1,
        fingerprint:
          'who:f593|not:|need:|gain:byStar[0-:aa+4,fire+3;1-:aa+6,evasion+3,fire+4;4-:aa+7,evasion+3,fire+5]|stack:once|cap:|set:',
      },
    ],
    patches: [
      { forms: [593], delta: { fire: 1, aa: 2, evasion: 3 } },
    ],
    stack: 'once',
    source: 'wikiwiki.jp/kancolle「42号対空電探改二」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: '★0~3 榛名改二乙 火力+4 対空+6 回避+3',
    why:
      '上游在 榛名改二乙 上多切了一档「★0 → 火力3 対空4」，日文原表的第一档是 **★0~3 火力+4 対空+6 回避+3**（akashi 同款），' +
      '所以 ★0 那一格上游偏低。EO 一致。',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 413,
    equipName: '精鋭水雷戦隊 司令部',
    watch: [
      {
        row: 10,
        fingerprint:
          'who:c38.54|not:f346.422.543|need:|gain:flat[evasion+7,fire+4,torpedo+5]|stack:perEquip|cap:|set:',
      },
    ],
    patches: [
      { forms: [743], delta: { fire: 2, torpedo: 1, evasion: 1 } },
    ],
    stack: 'perEquip',
    source: 'wikiwiki.jp/kancolle「精鋭水雷戦隊 司令部」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: '長波改二 火力+6 雷装+6 回避+8／照月 +5 +6 +7／他夕雲型・秋月型 +4 +5 +7（「艦名記載は、その値が適用される一番下の改造段階が基準」）',
    why:
      '日文表只有三档：長波改二 6/6/8、照月 5/6/7、他夕雲型・秋月型 4/5/7。長波(135)/長波改(304) 在 長波改二 之下，吃「他夕雲型」4/5/7——本方对，' +
      'EO 那边给 5/6/7 是它自己多了一条「長波链 +1/+1」；清霜・浜波各形态同理，EO 多给 対空+1 回避+1，日文表里没有这一档。唯一要改的是 **長波改二補(743)' +
      '**：它在改造链上位于 長波改二 之上、日文表没有单列，按页首那句「一番下の改造段階が基準」应继承 長波改二 的 6/6/8——本方给 4/5/7、EO 给 5/6/7，' +
      '**两边都不对**，这是日文票支持第三值的一格。（本件是**部分裁决**，其余格见 PENDING 台账的注记）',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 421,
    equipName: 'SB2C-5',
    watch: [
      { row: 3, fingerprint: 'who:c78.112|not:|need:|gain:byStar[0-:fire+1;5-:fire+2]|stack:perEquip|cap:|set:' },
    ],
    patches: [
      { forms: [713, 885], delta: { fire: 1 } },
    ],
    stack: 'perEquip',
    source: 'wikiwiki.jp/kancolle「SB2C-5」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: '★0~4 Glorious(正規空母)・Victorious 火力+2／★0~4 Ark Royal 火力+1',
    why:
      '上游把 Victorious 与 Ark Royal 并成一档（火力+1），日文把 Victorious 放在 火力+2 档、Ark Royal 单列 +1，' +
      'akashi 同款，EO 一致。',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 422,
    equipName: 'FR-1 Fireball',
    watch: [
      { row: 1, fingerprint: 'who:c83|not:|need:|gain:flat[aa+2,evasion+3,fire+3]|stack:perEquip|cap:|set:' },
    ],
    patches: [
      { forms: [396, 544], delta: { fire: -2, aa: -2, evasion: -2 } },
    ],
    stack: 'perEquip',
    source: 'wikiwiki.jp/kancolle「FR-1 Fireball」装備ボーナス表（页面 Last-modified 2026-08-21）',
    jp: '★0~5 Gambier Bay Mk.II 火力+3 対空+2 回避+3／★0~5 Gambier Bay・Langley 火力+1 回避+1',
    why:
      '上游按舰级（Gambier Bay改型 ctype 83）把 Mk.II 那一档给了全级，于是 Gambier Bay(544) 与 Gambier Bay改(396)' +
      ' 也拿到 火力3 対空2 回避3。日文把 Mk.II 单列（它在改造链上位于 Gambier Bay改 之上），其余吃「Gambier Bay・Langley」的 火力+1 回避+1；akashi 同款（Gambier Bay Mk.II 一档、' +
      'アメリカ軽空母 火力+1 回避+1 一档），EO 一致。',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 424,
    equipName: 'Barracuda Mk.II',
    watch: [
      {
        row: 1,
        fingerprint:
          'who:c78.112|not:|need:|gain:byStar[0-:aa+3,fire+2;2-:aa+3,fire+3;6-:aa+3,fire+4]|stack:perEquip|cap:|set:',
      },
    ],
    patches: [
      { forms: [393, 515, 713, 885], delta: { torpedo: 3, aa: -3 } },
    ],
    stack: 'perEquip',
    source: 'wikiwiki.jp/kancolle「Barracuda Mk.II」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: '★無し~+1 Ark Royal・Victorious・Glorious(正規空母) 火力+2 雷装+3',
    why: '上游把 雷装+3 记成了 **対空+3**（栏搞错），日文与 akashi 都写 雷装+3，EO 一致。火力+2 两边相同。',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 428,
    equipName: '320mm/44 連装砲',
    watch: [
      {
        row: 3,
        fingerprint:
          'who:c73|not:|need:|gain:byCount[1:evasion+1,fire+1;2:evasion+1,fire+3]|stack:table|cap:|set:',
      },
    ],
    patches: [
      { forms: [511, 512, 513], delta: { fire: 1 } },
    ],
    stack: 'once',
    source:
      'wikiwiki.jp/kancolle「320mm／44 連装砲」装備ボーナス表（页面 Last-modified 2026-05-30；页名全角「／' +
      '」，取票脚本按 api 名的半角「/」取所以 404，2026-08-22 按站内真实页名补抓）',
    jp: 'x1 Гангут 火力+2 回避+1／x2以降 火力+1',
    why:
      '第一门 Гангут 型日文给 火力+2 回避+1，上游写成 火力+1（把 2 门以后那档的增量当成了第一门）。akashi 的「Гангут 火力+2,+1,+1,+1 回避+1,+0,+0,+0」逐档一致，' +
      'EO 也一致。',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 438,
    equipName: '三式水中探信儀改',
    watch: [
      {
        row: 7,
        fingerprint:
          'who:c1.5.10.12.18.22.23.28.30.38.54.66.101|not:f16.36.43.47.122.145.167.170.233.236.243.247.294.312.320.328.344.350.351.363.369.407.414.425.457.458.459.469.471.473.476.527.557.558.578.587.588.667.686.961|need:|gain:byCount[1:asw+1,evasion+1]|stack:table|cap:|set:',
      },
    ],
    patches: [
      { forms: [744], delta: { fire: 1, evasion: 2, asw: 3 } },
    ],
    stack: 'once',
    source: 'wikiwiki.jp/kancolle「三式水中探信儀改」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: '1つ目 朝霜 火力+1 対潜+4 回避+3（「艦名記載は、その値が適用される一番下の改造段階が基準」）',
    why:
      '上游的「朝霜」档只列到 朝霜改二(578)，漏了改造链更上一级的 **朝霜改二補(744)**，它掉进了驱逐通用档（対潜1 回避1）。按页首那句「一番下の改造段階が基準」，' +
      '744 继承「朝霜」档 火力+1 対潜+4 回避+3，EO 一致。',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 442,
    equipName: '潜水艦後部魚雷発射管4門(初期型)',
    watch: [
      { row: 1, fingerprint: 'who:c114.122|not:|need:|gain:flat[torpedo+2]|stack:perEquip|cap:|set:' },
    ],
    patches: [
      { forms: [891, 897], delta: { torpedo: -1, evasion: 2 } },
    ],
    stack: 'perEquip',
    source: 'wikiwiki.jp/kancolle「潜水艦後部魚雷発射管4門(初期型)」装備ボーナス表（页面 Last-modified 2026-08-10）',
    jp: 'Gato級 雷装+2／Salmon 雷装+1 回避+2',
    why: '上游把 Gato 級与 Salmon 级并成一条（雷装+2），日文分两档：Salmon 是 雷装+1 回避+2，EO 一致。',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 443,
    equipName: '潜水艦後部魚雷発射管4門(後期型)',
    watch: [
      { row: 1, fingerprint: 'who:c114.122|not:|need:|gain:flat[torpedo+2]|stack:perEquip|cap:|set:' },
    ],
    patches: [
      { forms: [891, 897], delta: { torpedo: -1, evasion: 2 } },
    ],
    stack: 'perEquip',
    source: 'wikiwiki.jp/kancolle「潜水艦後部魚雷発射管4門(後期型)」装備ボーナス表（页面 Last-modified 2026-08-10）',
    jp: 'Gato級 雷装+2／Salmon 雷装+1 回避+2',
    why: '上游把 Gato 級与 Salmon 级并成一条（雷装+2），日文分两档：Salmon 是 雷装+1 回避+2，EO 一致。',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 464,
    equipName: '10cm連装高角砲群 集中配備',
    watch: [
      {
        row: 3,
        fingerprint:
          'who:f149.150.151.152.591.592.593.954|not:|need:|gain:flat[aa-2,evasion-2]|stack:perEquip|cap:|set:',
      },
    ],
    patches: [
      { forms: [593, 954], delta: { aa: 2, evasion: 2 } },
    ],
    stack: 'perEquip',
    source: 'wikiwiki.jp/kancolle「10cm連装高角砲群 集中配備」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: '金剛型・Гангут・Conte di Cavour ※榛名改二乙 / 丙を除く 対空-2 回避-2',
    why:
      '日文那一行的对象里写着「※榛名改二乙/丙を除く」，上游把这个**排除**漏掉了，于是 593/954 也吃到 対空-2 回避-2 的罚。EO 那边这两格是空的（无加成）' +
      '，与日文一致。akashi 那张给 榛名改二乙/丙 的「対空+5 回避+4」与它上一行 大和型改二 的数完全相同，是它自己表格跨行合并的呈现事故，不作为同粒度反证。',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 488,
    equipName: '二式爆雷改二',
    watch: [
      {
        row: 5,
        fingerprint:
          'who:f411.412.663|not:|need:|gain:byStar[0-:asw+2,evasion+1;5-:asw+3,evasion+1;7-:asw+3,evasion+2;9-:accuracy+1,asw+4,evasion+2]|stack:perEquip|cap:|set:',
      },
    ],
    patches: [
      { forms: [411, 412, 663], delta: { evasion: -1, asw: -1 } },
    ],
    stack: 'perEquip',
    source: 'wikiwiki.jp/kancolle「二式爆雷改二」装備ボーナス表（页面 Last-modified 2026-08-12）',
    jp: '扶桑改二・山城改二・矢矧改二 対潜+1／潮改二・初霜改二・時雨・涼月改・冬月改 対潜+2 回避+1／他日本駆逐艦・海防艦(御蔵型を除く) 対潜+1 回避+1',
    why:
      '扶桑改二 / 山城改二 / 矢矧改二 三格：日文与 akashi 都只给 **対潜+1**（没有回避），本方多给了 回避+1 与 対潜+1，EO 与日文一致。' +
      '另 3 格（雪風改・響改・時雨改）本方对——它们分别吃「他日本駆逐艦」与「時雨」档，EO 把 雪風改二/時雨改二 的高档往链下扩了。（本件是**部分裁决**，' +
      '其余格见 PENDING 台账的注记）',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 490,
    equipName: '試製 夜間瑞雲(攻撃装備)',
    watch: [
      {
        row: 2,
        fingerprint:
          'who:f501.502.506.507|not:|need:|gain:flat[aa+1,evasion+2,fire+3]|stack:perEquip|cap:|set:',
      },
      { row: 3, fingerprint: 'who:f663.668|not:|need:|gain:flat[aa+1,evasion+2,fire+3]|stack:perEquip|cap:|set:' },
      { row: 4, fingerprint: 'who:f662|not:|need:|gain:flat[evasion+1,fire+3]|stack:perEquip|cap:|set:' },
    ],
    patches: [
      { forms: [501, 506], delta: { fire: 1, evasion: 1 } },
      { forms: [502, 507], delta: { evasion: 1 } },
      { forms: [662, 663, 668], delta: { fire: 1, evasion: 1, asw: 1 } },
    ],
    stack: 'perEquip',
    source: 'wikiwiki.jp/kancolle「試製 夜間瑞雲(攻撃装備)」装備ボーナス表（页面 Last-modified 2026-08-16）',
    jp: '能代改二 火力+4 対潜+1 回避+2／矢矧改二 / 乙 +4 対空+1 対潜+1 回避+3／最上改二 / 特 +4 +1 回避+3／三隈改二 / 特 +3 +1 回避+3',
    why:
      '本件与 322 / 237 / 323 同属日文表里那一组「瑞雲(六三四空/熟練)・瑞雲改二(六三四空)・同(熟練)・本装備」并列行，四件同值。伊勢型改二 那一行上游是对的（火力3 対空1 回避2）' +
      '，差的只有最上/三隈/矢矧/能代这 7 格。akashi 一致（能代改二 火力+4 対潜+1／矢矧改二/乙 火力+4 対空+1 対潜+1／最上改二/特 火力+4 対空+1）' +
      '。',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 502,
    equipName: '35.6cm連装砲改三(ダズル迷彩仕様)',
    watch: [
      {
        row: 5,
        fingerprint:
          'who:f151|not:|need:|gain:byStar[0-:aa+2,evasion+1,fire+2;2-:aa+2,evasion+2,fire+2;4-:aa+3,evasion+2,fire+2;6-:aa+3,evasion+2,fire+3;8-:aa+3,evasion+3,fire+3;10-:aa+4,evasion+3,fire+3]|stack:perEquip|cap:|set:',
      },
      {
        row: 6,
        fingerprint:
          'who:f593|not:|need:|gain:byStar[0-:aa+4,evasion+3,fire+5;1-:aa+4,evasion+4,fire+5;3-:aa+5,evasion+4,fire+5;5-:aa+5,evasion+4,fire+6;7-:aa+5,evasion+5,fire+6;8-:aa+6,evasion+5,fire+6;9-:aa+6,evasion+5,fire+7;10-:aa+7,evasion+5,fire+7]|stack:perEquip|cap:|set:',
      },
      {
        row: 7,
        fingerprint:
          'who:f954|not:|need:|gain:byStar[0-:aa+3,evasion+3,fire+3;1-:aa+3,evasion+4,fire+3;3-:aa+4,evasion+4,fire+3;5-:aa+4,evasion+4,fire+4;7-:aa+4,evasion+5,fire+4;8-:aa+5,evasion+5,fire+4;9-:aa+5,evasion+5,fire+5;10-:aa+6,evasion+5,fire+5]|stack:perEquip|cap:|set:',
      },
      { row: 12, fingerprint: 'who:f593.954|not:|need:|gain:flat[evasion+1,fire+1]|stack:perEquip|cap:|set:' },
      { row: 14, fingerprint: 'who:f151.593.954|not:|need:|gain:flat[fire+1]|stack:perEquip|cap:|set:' },
      { row: 15, fingerprint: 'who:f151.593.954|not:|need:|gain:flat[evasion+1]|stack:perEquip|cap:|set:' },
      { row: 16, fingerprint: 'who:f151.593.954|not:|need:|gain:flat[accuracy+1]|stack:perEquip|cap:|set:' },
      { row: 17, fingerprint: 'who:f151.593.954|not:|need:|gain:flat[aa+1,fire+1]|stack:perEquip|cap:|set:' },
    ],
    patches: [
      { forms: [151], delta: { fire: -2, aa: -1, evasion: -1, accuracy: -1 } },
      { forms: [593, 954], delta: { fire: -3, aa: -1, evasion: -2, accuracy: -1 } },
    ],
    stack: 'perEquip',
    source: 'wikiwiki.jp/kancolle「35.6cm連装砲改三(ダズル迷彩仕様)」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: '★+0 榛名改二乙 火力+5 対空+4 回避+3／★+0 榛名改二丙 +3 +3 +3／★+0～1 榛名改二 +2 +2 +1',
    why:
      '上游把「21号/42号対空電探シナジー」那几笔（第 12–17 行）写成了无条件行，在 ★0・无协同 的共同分母上给 151/593/954 各凭空多出 火力/対空/回避/命中。' +
      '日文一手（akashi 同款：榛名改二乙 火力+5 対空+4 回避+3、榛名改二丙 +3 +3 +3）与 EO 逐格一致。',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 503,
    equipName: '35.6cm連装砲改四',
    watch: [
      { row: 2, fingerprint: 'who:f591.592|not:|need:|gain:flat[aa+1,accuracy+1,fire+3]|stack:perEquip|cap:|set:' },
      { row: 3, fingerprint: 'who:f593|not:|need:|gain:flat[aa+4,accuracy+2,fire+4]|stack:perEquip|cap:|set:' },
      { row: 4, fingerprint: 'who:f954|not:|need:|gain:flat[aa+3,accuracy+2,fire+4]|stack:perEquip|cap:|set:' },
      { row: 9, fingerprint: 'who:f591.592.593.954|not:|need:|gain:flat[torpedo+1]|stack:perEquip|cap:|set:' },
      { row: 10, fingerprint: 'who:f591.592.593.954|not:|need:|gain:flat[accuracy+1]|stack:perEquip|cap:|set:' },
      { row: 11, fingerprint: 'who:f591.592.593.954|not:|need:|gain:flat[fire+1]|stack:perEquip|cap:|set:' },
    ],
    patches: [
      { forms: [591, 592, 593, 954], delta: { fire: -1, torpedo: -1, accuracy: -1 } },
    ],
    stack: 'perEquip',
    source: 'wikiwiki.jp/kancolle「35.6cm連装砲改四」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: '榛名改二乙 火力+4 対空+4 命中+2／榛名改二丙 +4 +3 +2／霧島改二丙 +4 +1 +1／金剛改二丙・比叡改二丙 +3 +1 +1／金剛改二・比叡改二・榛名改二・霧島改二 +2',
    why:
      '金剛改二(149)/榛名改二(151) 本方对（火力+2，EO 那边多给了 対空/命中）。改二丙系与榛名改二乙/丙 四格上游偏高：上游把「53cm連装魚雷★max 才给的 火力+1 雷装+4 命中+1」当成了无条件行（第 9–11 行）' +
      '，所以在 ★0・无协同 的共同分母上凭空多出 火力1 雷装1 命中1。日文一手与 EO 逐格一致。（本件是**部分裁决**，其余格见 PENDING 台账的注记）',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 510,
    equipName: 'Walrus',
    watch: [
      { row: 1, fingerprint: 'who:c88|not:|need:|gain:flat[asw+3,evasion+4,fire+6,los+5]|stack:perEquip|cap:|set:' },
    ],
    patches: [
      { forms: [571, 572, 576, 577], delta: { accuracy: 2 } },
    ],
    stack: 'perEquip',
    source: 'wikiwiki.jp/kancolle「Walrus」装備ボーナス表（页面 Last-modified 2026-08-13）',
    jp: '1機目 Nelson・Rodney 火力+6 対潜+3 索敵+5 回避+4 命中+2',
    why: '上游把 命中+2 整栏漏了，其余四栏逐格无误；日文与 akashi 都有 命中+2，EO 一致。',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 517,
    equipName: '逆探(E27)+22号対水上電探改四(後期調整型)',
    watch: [
      {
        row: 4,
        fingerprint:
          'who:c38|not:f578.955.960|need:|gain:flat[accuracy+2,evasion+1,fire+1,los+1]|stack:perEquip|cap:|set:',
      },
      {
        row: 6,
        fingerprint:
          'who:c1.5.10.12.18.22.23.28.30.54.66.101|not:f147.407.419.464.656.961|need:|gain:flat[accuracy+1,evasion+1,los+1]|stack:perEquip|cap:|set:',
      },
    ],
    patches: [
      { forms: [235, 470, 975], delta: { fire: 1, evasion: 2, los: 1, accuracy: 1 } },
      { forms: [981], delta: { fire: 1, evasion: 1, accuracy: 1 } },
    ],
    stack: 'perEquip',
    source:
      'wikiwiki.jp/kancolle「逆探(E27)＋22号対水上電探改四(後期調整型)」装備ボーナス表（页面 Last-modified 2026-07-27；页名全角「＋」，' +
      '取票脚本按 api 名的半角「+」取所以 404，2026-08-22 按站内真实页名补抓）',
    jp:
      '玉波改二・涼波改二・藤波改二・早波改二・浜波改二 火力+2 索敵+1 回避+2 命中+3／初霜改二・潮改二・響改・霞改二・時雨改三・春雨改二・雪風改二 火力+1 索敵+2 回避+3 命中+2／' +
      'その他の日本駆逐艦・海防艦(御蔵型を除く) 索敵+1 回避+1 命中+1（「艦名記載は、その値が適用される一番下の改造段階が基準」）',
    why:
      '四格都是分档缺失：響改(235)・霞改二乙(470，在霞改二之上按页首规则继承)・春雨改二(975) 应在「初霜改二…」那一档（火力1 索敵2 回避3 命中2）' +
      '，藤波改二(981) 应在「玉波改二…」那一档（火力2 索敵1 回避2 命中3），上游把前三个丢进了「その他の日本駆逐艦」最低档、把藤波改二丢进了「夕雲型」档。' +
      'EO 逐格与日文一致。',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 529,
    equipName: '12.7cm連装砲C型改三H',
    watch: [
      {
        row: 15,
        fingerprint:
          'who:f17.18.19.122.132.167.168.169.170.181.186.190.225.226.227.228.294.300.301.312.313.316.317.320.322.329.354.355.362.415.454.455.456.556.558.559.648.720.886|not:|need:|gain:byCount[1:fire+2;2:fire+2;3:fire+2]|stack:table|cap:|set:',
      },
    ],
    patches: [
      { forms: [228], delta: { evasion: 2 } },
    ],
    stack: 'once',
    source: 'wikiwiki.jp/kancolle「12.7cm連装砲C型改三H」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: '雪風・磯風乙改 火力+2 回避+2／他陽炎型(秋雲含む) 火力+2／他白露型・朝潮型 火力+1（「艦名記載は、その値が適用される一番下の改造段階が基準」）',
    why:
      '这一件是**部分裁决**。日文表按「艦名記載は…一番下の改造段階が基準」读：雪風(20)→雪風改(228) 同属「雪風・磯風乙改」档 火力+2 回避+2，' +
      '所以 228 该有 回避+2（本方漏了，EO 对）；而 磯風(167)/磯風改(320) 在 磯風乙改 之下、只吃「他陽炎型」火力+2，時雨(43)/時雨改(243)' +
      ' 吃「他白露型」火力+1——这 4 格本方是对的，EO 那边多给了 回避+2。陽炎型改二那 6 格因日文页表格与脚注互相打架，留在待裁。（本件是**部分裁决**，' +
      '其余格见 PENDING 台账的注记）',
    note: '加成数值按 wikiwiki 日文原表',
    decidedAt: '2026-08-22',
  },
  {
    equipId: 529,
    equipName: '12.7cm連装砲C型改三H',
    watch: [
      {
        row: 13,
        fingerprint:
          'who:f566.567.568.648.656.670.915.951|not:f648.656|need:|' +
          'gain:byCount[1:evasion+2,fire+3;2:evasion+2,fire+7]|stack:table|cap:|set:',
      },
    ],
    patches: [
      { forms: [566, 567, 568, 670, 915, 951], delta: { evasion: -2, accuracy: 2 } },
    ],
    stack: 'once',
    source:
      'wikiwiki.jp/kancolle「12.7cm連装砲C型改三H」装備ボーナス表（页面 Last-modified 2026-07-27）' +
      '＋用户游戏内「変更後」装备预览卡实拍（2026-08-22）',
    jp: '単体ボーナス表 x1「陽炎型改二(雪風改二除く)(秋雲改二除く)」逐列读＝火力+3 命中+2（回避列为空）；同行脚注 *12 写「1基目が火力+3、回避+2、2基目が火力+4」',
    why:
      '日文页**自己跟自己打架**：表格列位给 火力+3 命中+2（用相邻「雪風改二丹陽」行三值三列可确认列位没读错），' +
      '同行脚注 *12 却把 +2 记在回避上。本方(上游)与脚注一致，EO 与表格一致，分析段按纪律未裁。' +
      '**用户拿自己仓库里那门 ★+2 的 C型改三H 在装备更换画面实测**：「変更後」预览卡上绿箭头只出现在 ' +
      '火力 +3 与 命中 +2 两栏，回避一栏没有箭头。三票合流——① 游戏装备预览箭头（准一手；' +
      '此处无协同、无档位，且不是孤证）② 日文表格列位 ③ EO 独立编码；脚注孤票出局。' +
      '★+2 未跨任何已知档位门槛，读到的即基础行。见 arbitration/user-verdict-529.md。',
    note: '6 格加成按本地游戏实测值',
    decidedAt: '2026-08-22',
  },
])

export type FitCorrectionSkipReason = 'no-equip' | 'no-row' | 'fingerprint'

/**
 * 把台账叠到刚加载的包上。**只动台账里逐条列明的那几件装备**，其余一格不碰。
 *
 * 补正以「合成规则行」的形式挂进 `entry.rules`（`row: 0`、带 `correction`）——
 * 这样它走的是与上游行**同一条**求值路径，不必在求值器里再开一个特例分支。
 * 合成行不参与「最具体一层胜出」的分层（见 `expectedFitBonus` 的 `baseFloor`），
 * 它表达的是「上游那一行的数应该再加/减多少」，不是「另一个更具体的层」。
 *
 * 返回打上补丁的**新** data（原对象不动，纯函数好测）；`onSkip` 报告作废的条目。
 */
export const applyFitBonusCorrections = (
  data: FitBonusData,
  onSkip?: (correction: FitBonusCorrection, reason: FitCorrectionSkipReason, detail: string) => void,
): { data: FitBonusData; applied: number } => {
  const equips: Record<string, FitEquipEntry> = { ...data.equips }
  let applied = 0
  for (const correction of FIT_BONUS_CORRECTIONS) {
    const entry = equips[`${correction.equipId}`]
    if (!entry) {
      onSkip?.(correction, 'no-equip', '包里没有这件装备')
      continue
    }
    let broken = ''
    for (const watched of correction.watch) {
      const rule = entry.rules.find((one) => one.row === watched.row)
      if (!rule) {
        broken = `第 ${watched.row} 行不见了`
        break
      }
      const now = fitRuleFingerprint(rule)
      if (now !== watched.fingerprint) {
        broken = `第 ${watched.row} 行已改动（现为 ${now}）`
        break
      }
    }
    if (broken) {
      onSkip?.(correction, broken.includes('不见了') ? 'no-row' : 'fingerprint', broken)
      continue
    }
    const extra: FitRule[] = correction.patches.map((patch) => ({
      row: 0,
      who: { forms: [...patch.forms] },
      gain: { kind: 'flat', flat: { ...patch.delta } },
      stack: correction.stack,
      correction: correction.note,
    }))
    equips[`${correction.equipId}`] = { ...entry, rules: [...entry.rules, ...extra] }
    applied += 1
  }
  return { data: { ...data, equips }, applied }
}
