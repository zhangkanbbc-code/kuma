// 装备加成的**已知冲突台账**（形态照 src/main/mg/quest-source-conflicts.ts 的
// KNOWN_QUEST_SOURCE_CONFLICTS）。
//
// **这不是「我们觉得谁不对」，是「两份独立整理在同一格上给了不同的数」。**
// 每条都逐条列明：哪件装备、哪些形态、两边各给什么、日文一手怎么说、裁给谁。
// 留在源码里是为了挡住两件事：
//   ① 照通则「老源可信」把自家解出来的值随手改回去（EO 攒了多年，谁都会觉得它更稳）；
//   ② 哪天两边中的一边改好了却没人发现，台账继续按一个已经不存在的分歧说话——
//      这一条由 `fingerprint` 的**自失效核对**兜住：`scripts/fit-bonus-reconcile.mjs`
//      每轮重算指纹，与台账记的对不上就报「指纹已变」，要求重新核，而不是继续照旧。
//
// 裁决优先级（与 fit-bonus-spec.md 的可信度阶梯一致）：
//   面板实测 > 日文近验表（wikiwiki 等只读核对）> 两票一致 > 挂 UNRESOLVED 等人裁。
// **不许自行二选一**：查不到日文原始出处就老实标 UNRESOLVED，别替用户拍板。
//
// ---- 裁决 ≠ 改数 ----
//
// `verdict: 'eo'` 只表示「日文一手站 EO 那边，我们这份低了/高了」，**不表示把 EO 的数
// 抄进包里**——那就把 NOASSERTION 的数据混进了 CC 包，是许可事故。修正的路子是第二批的
// 面板反推（可信度最高的一档，玩家装上就能实测出真值）与自补层，这里只负责把账记下来。

/**
 * @typedef {object} FitBonusConflict
 * @property {number} equipId      装备 mstId
 * @property {string} equipName    装备日文原名（给人读的锚，不参与判定）
 * @property {number[]} shipIds    涉及的形态 mstId（升序）
 * @property {string} fingerprint  两边当轮数值的稳定指纹，见 fitBonusConflictFingerprint
 * @property {string} jp           日文一手出处逐字（没有就写空串）
 * @property {string} source       日文出处是哪一页
 * @property {string} why          分歧在哪、各站哪边
 * @property {'ours' | 'eo' | 'jp-third' | 'UNRESOLVED'} verdict
 *
 * `jp-third` 是 2026-08-22 新加的第四值：**日文一手在某一格给出了两边都没有的第三个数**。
 * 原来的三值枚举表达不了它，只能勉强记成 ours 或 eo 再把真相埋进 `why`——那等于让台账
 * 自己说一句不准的话。落在这一档的有两条：413 的 長波改二補（本方 4/5/7、EO 5/6/7、
 * 日文 6/6/8）与 364 的 三隈改二特（本方 雷装+1、EO 雷装+3 回避+5、日文 雷装+3 回避-2）。
 */

/** @type {readonly FitBonusConflict[]} */
export const KNOWN_FIT_BONUS_CONFLICTS = Object.freeze([
  {
    equipId: 317,
    equipName: '三式弾改',
    shipIds: [78, 79, 85, 86, 149, 150, 151, 152, 209, 210, 211, 212, 591, 592, 593, 954],
    fingerprint:
      '78[aa+1,fire+1|aa+1,fire+2];79[aa+1,fire+1|aa+1,fire+2];85[aa+1,fire+1|aa+1,fire+2];' +
      '86[aa+1,fire+1|aa+1,fire+2];149[aa+3,fire+3|aa+3,fire+4];150[aa+2,fire+2|aa+2,fire+3];' +
      '151[aa+2,evasion+1,fire+2|aa+2,evasion+1,fire+3];152[aa+2,fire+3|aa+2,fire+4];' +
      '209[aa+1,fire+1|aa+1,fire+2];210[aa+1,fire+1|aa+1,fire+2];211[aa+1,fire+1|aa+1,fire+2];' +
      '212[aa+1,fire+1|aa+1,fire+2];591[aa+3,fire+3|aa+3,fire+4];592[aa+3,fire+3|aa+3,fire+4];' +
      '593[aa+4,evasion+2,fire+2|aa+4,evasion+2,fire+3];954[aa+3,evasion+1,fire+3|aa+3,evasion+1,fire+4]',
    source: 'wikiwiki.jp/kancolle「三式弾改」の装備ボーナス表（2026-08-22 只读核对）',
    jp:
      '対象艦は金剛型と伊勢型、長門型戦艦改二。／金剛型(未改造/改) 火力+2 対空+1／' +
      '金剛改二・改二丙 +4 +3／比叡改二丙 +4 +3／比叡改二 +3 +2／榛名改二 +3 +2 回避+1／' +
      '榛名改二乙 +3 +4 回避+2／榛名改二丙 +4 +3 回避+1／霧島改二・改二丙 +4 +2',
    why:
      '整条金剛型（8 个未改造/改形态 + 8 个改二系形态）上，我们这份的**火力一律比 EO 低 1**，' +
      '对空/回避两栏则逐格相同。日文近验表逐行核下来 16 格全部与 EO 一致：' +
      '金剛 2/1、金剛改二 4/3、比叡改二 3/2、榛名改二 3/2/1、榛名改二乙 3/4/2、' +
      '榛名改二丙 4/3/1、霧島改二 4/2。所以不是「EO 多算」，是上游那张表这一族的火力栏整体少 1。',
    verdict: 'eo',
  },
  {
    equipId: 358,
    equipName: '5inch 単装高角砲群',
    shipIds: [598, 711, 722, 734, 896, 923, 928, 952, 957, 1005, 1010],
    fingerprint:
      '598[aa+3,evasion+3,fire+2|aa+1,evasion+1,fire+1];711[aa+3,evasion+3,fire+2|aa+1,evasion+1,fire+1];' +
      '722[aa+3,evasion+3,fire+2|aa+1,evasion+1,fire+1];734[aa+3,evasion+3,fire+2|aa+1,evasion+1,fire+1];' +
      '896[aa+3,evasion+3,fire+2|aa+1,evasion+1,fire+1];923[aa+3,evasion+3,fire+2|aa+1,evasion+1,fire+1];' +
      '928[aa+3,evasion+3,fire+2|aa+1,evasion+1,fire+1];952[aa+3,evasion+3,fire+2|aa+1,evasion+1,fire+1];' +
      '957[aa+3,evasion+3,fire+2|aa+1,evasion+1,fire+1];1005[aa+3,evasion+3,fire+2|aa+1,evasion+1,fire+1];' +
      '1010[aa+3,evasion+3,fire+2|aa+1,evasion+1,fire+1]',
    source: 'wikiwiki.jp/kancolle「5inch 単装高角砲群」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: '対象は米英戦艦・空母と米重巡など。／Northampton、Houston：火力+2 対空+3 回避+3／その他米英国艦：+1 +1 +1',
    why:
      '上游把「Northampton・Houston」那一档写成了三个舰级——北安普敦级、新奥尔良级、布鲁克林级。' +
      '日文近验表只给 Northampton 与 Houston（正好是 api_ctype 95 的四个形态）那个高档，' +
      '布鲁克林级(110)、新奥尔良级(121) 属于「その他米英国艦」的 +1/+1/+1。' +
      'EO 站日文这边（Honolulu / Brooklyn / Phoenix / Tuscaloosa / Minneapolis 全给 1/1/1）。' +
      '这是**扩大**了适用面，11 个形态各多拿 火力1/对空2/回避2。',
    verdict: 'eo',
  },
  {
    equipId: 505,
    equipName: '25mm対空機銃増備',
    shipIds: [145, 228, 235, 242, 243, 244, 245, 323, 951, 955, 960, 975, 981, 986],
    fingerprint:
      '145[aa+2,evasion+2,fire+1|aa+4,evasion+5,fire+2];228[aa+2,evasion+2,fire+1|aa+4,evasion+4,fire+1];' +
      '235[aa+2,evasion+2,fire+1|aa+3,evasion+3,fire+2];242[aa+2,evasion+2,fire+1|aa+4,evasion+4,fire+1];' +
      '243[aa+2,evasion+2,fire+1|aa+4,evasion+4,fire+1];244[aa+2,evasion+2,fire+1|aa+3,evasion+4,fire+1];' +
      '245[aa+2,evasion+2,fire+1|aa+3,evasion+4,fire+1];323[aa+2,evasion+2,fire+1|aa+3,evasion+4,fire+1];' +
      '951[aa+2,evasion+2,fire+1|aa+4,evasion+5,fire+2];955[aa+2,evasion+2,fire+1|aa+3,evasion+3,fire+2];' +
      '960[aa+2,evasion+2,fire+1|aa+3,evasion+3,fire+2];975[aa+2,evasion+2,fire+1|aa+4,evasion+5,fire+2];' +
      '981[aa+2,evasion+2,fire+1|aa+3,evasion+3,fire+1];986[aa+2,evasion+2,fire+1|aa+3,evasion+4,fire+2]',
    source: 'wikiwiki.jp/kancolle「25mm対空機銃増備」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp:
      '吹雪改三・時雨改三 +3/+5/+6／白露改二・時雨改二・春雨改二・雪風改二・天津風改二 +2/+4/+5／' +
      '白雪改二・初雪改二 +2/+3/+4／潮改二・響改・初霜改二・霞改二/乙・磯風乙改・浜風乙改・朝霜改二・' +
      '清霜改二/丁 +2/+3/+3／村雨改二・夕立改二・白露改・時雨改・雪風改 +1/+4/+4／' +
      '村雨改・夕立改・春雨改 +1/+3/+4／玉波改二・涼波改二・藤波改二・早波改二・浜波改二 +1/+3/+3',
    why:
      '上游只分了 5 档，日文近验表分了 7 档，而且好几个形态在上游那边落进了「驱逐舰通用」的最低档' +
      '（火力1/对空2/回避2）：時雨改二・春雨改二・天津風改二 应在 2/4/5 档，響改・清霜改二/丁 应在 2/3/3 档，' +
      '白露改・時雨改・雪風改 应在 1/4/4 档，村雨改・夕立改・春雨改 应在 1/3/4 档，' +
      '白雪改二 应在 2/3/4 档，藤波改二 应在 1/3/3 档。EO 逐格与日文一致。' +
      '这是**分档缺失**（少给），不是数值口径之争。',
    verdict: 'eo',
  },
  {
    equipId: 322,
    equipName: '瑞雲改二(六三四空)',
    shipIds: [501, 502, 506, 507, 553, 554, 662, 663, 668],
    fingerprint:
      '501[aa+1,evasion+2,fire+3|aa+1,evasion+3,fire+4];502[aa+1,evasion+2,fire+3|aa+1,evasion+3,fire+3];' +
      '506[aa+1,evasion+2,fire+3|aa+1,evasion+3,fire+4];507[aa+1,evasion+2,fire+3|aa+1,evasion+3,fire+3];' +
      '553[aa+2,asw+1,evasion+2,fire+5|aa+3,asw+1,evasion+4,fire+8];' +
      '554[aa+2,asw+1,evasion+2,fire+5|aa+3,asw+1,evasion+4,fire+8];' +
      '662[evasion+1,fire+3|asw+1,evasion+2,fire+4];663[aa+1,evasion+2,fire+3|aa+1,asw+1,evasion+3,fire+4];' +
      '668[aa+1,evasion+2,fire+3|aa+1,asw+1,evasion+3,fire+4]',
    source: 'wikiwiki.jp/kancolle「瑞雲改二(六三四空)」装備ボーナス表（页面 Last-modified 2026-07-31）',
    jp:
      '伊勢型改二 火力+8 対空+3 対潜+1 回避+4／能代改二 火力+4 対潜+1 回避+2／矢矧改二・乙 +4 +1 対潜+1 回避+3／' +
      '最上改二・特 +4 +1 回避+3／三隈改二・特 +3 +1 回避+3',
    why:
      '逐格核下来日文一手与 EO 一致，上游整体偏低：伊勢改二/日向改二 上游给 火力5/对空2/回避2，' +
      '日文是 火力8/对空3/回避4；最上改二 上游 3/1/2，日文 4/1/3；三隈改二 上游少 回避1；' +
      '矢矧改二系 上游漏了 対潜+1。**这一条不是孤例**：瑞雲/晴嵐系（26 / 62 / 79 / 80 / 81 / 207 / 208 / ' +
      '237 / 322 / 323 共 10 件水上爆撃機）在最上改二系上呈现同一个缺口——EO 那边有一条' +
      '「水上爆撃機类目 × 最上改二系」的类行（+火力1 +回避1），上游是逐装备写的，就把这一层漏掉了。' +
      '其余 9 件里只有 79 / 81 也取到了日文票，这里先裁指标最全的这一件，其余留在待裁清单。',
    verdict: 'eo',
  },
  {
    equipId: 19,
    equipName: '九六式艦戦',
    shipIds: [894, 899],
    fingerprint:
      '894[aa+3,asw+2,evasion+3,fire+2|aa+4,asw+3,evasion+4,fire+3];899[aa+3,asw+2,evasion+3,fire+2|aa+4,asw+3,evasion+4,fire+3]',
    source: 'wikiwiki.jp/kancolle「九六式艦戦」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: '鳳翔改二 / 戦 火力+3 対空+4 対潜+3 回避+4／鳳翔 +2 +3 +2 +3',
    why:
      '上游把整个鳳翔型写成一档（用的是 鳳翔 那档的数），日文把 鳳翔改二/戦 单列高一档，EO 一致。／修正已落 src/shared/fit-bonus-corrections.ts（2 格）' +
      '。',
    verdict: 'eo',
  },
  {
    equipId: 26,
    equipName: '瑞雲',
    shipIds: [501, 502, 506, 507, 662, 663, 668],
    fingerprint:
      '501[aa+1,evasion+1,fire+2|aa+1,evasion+2,fire+3];502[aa+1,evasion+1,fire+2|aa+1,evasion+2,fire+2];506[aa+1,evasion+1,fire+2|aa+1,evasion+2,fire+3];507[aa+1,evasion+1,fire+2|aa+1,evasion+2,fire+2];662[evasion+1,fire+2|asw+1,evasion+2,fire+3];663[aa+1,evasion+1,fire+2|aa+1,asw+1,evasion+2,fire+3];668[aa+1,evasion+1,fire+2|aa+1,asw+1,evasion+2,fire+3]',
    source:
      'wikiwiki.jp/kancolle「瑞雲(六三四空)」「瑞雲12型(六三四空)」装備ボーナス表の「水上爆撃機(その他日本)」类目行（页面 Last-modified 2026-07-27）' +
      '＋舰娘页「能代改二」(2026-08-15)「矢矧改二」(2026-08-15) 的「水上爆撃機(共通・1機目)」＋「水上爆撃機(その他日本)」两行',
    jp:
      '水上爆撃機(その他日本)：能代改二 火力+3 対潜+1 回避+2／矢矧改二・乙 +3 対空+1 対潜+1 回避+2／最上改二・特 +3 +1 回避+2／' +
      '三隈改二・特 +2 +1 回避+2',
    why:
      '本装备自己的 wikiwiki 页没有「装備ボーナスについて」小节（页在，只是这一族的数值写在类目行里）。日文一手把这四行**写成类目行**「水上爆撃機(その他日本)' +
      '」——瑞雲系无固有補正的那几件共用同一档，两处互证：① 同族的 79 / 81 页逐格给出该类目行；② 能代改二舰娘页拆成「水上爆撃機(共通・1機目) 火力+1 対潜+1 回避+1」＋「水上爆撃機(その他日本)' +
      ' 火力+2 回避+1」，相加正是 火力+3 対潜+1 回避+2。上游是逐装备写的，把「水上爆撃機类目 × 最上改二系/阿賀野型改二系」这一层整层漏掉了。' +
      '／修正已落 src/shared/fit-bonus-corrections.ts（7 格）。',
    verdict: 'eo',
  },
  {
    equipId: 39,
    equipName: '25mm連装機銃',
    shipIds: [668],
    fingerprint:
      '668[aa+2,evasion+1|aa+3,evasion+2]',
    source: 'wikiwiki.jp/kancolle「25mm連装機銃」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: '25mm単装機銃・25mm連装機銃・25mm三連装機銃・25mm三連装機銃 集中配備：能代改二・矢矧改二 対空+2 回避+1／矢矧改二乙 対空+3 回避+2',
    why:
      '上游按舰级（阿賀野型）写成一档 対空+2 回避+1，日文把 矢矧改二乙 单列成 対空+3 回避+2，EO 一致。这一行在 25mm 四件机銃（39 / 40 / 49 / 131）' +
      '的页面上是同一条并列行，四件同裁。／修正已落 src/shared/fit-bonus-corrections.ts（1 格）。',
    verdict: 'eo',
  },
  {
    equipId: 40,
    equipName: '25mm三連装機銃',
    shipIds: [668],
    fingerprint:
      '668[aa+2,evasion+1|aa+3,evasion+2]',
    source: 'wikiwiki.jp/kancolle「25mm三連装機銃」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: '25mm単装機銃・25mm連装機銃・25mm三連装機銃・25mm三連装機銃 集中配備：能代改二・矢矧改二 対空+2 回避+1／矢矧改二乙 対空+3 回避+2',
    why:
      '上游按舰级（阿賀野型）写成一档 対空+2 回避+1，日文把 矢矧改二乙 单列成 対空+3 回避+2，EO 一致。这一行在 25mm 四件机銃（39 / 40 / 49 / 131）' +
      '的页面上是同一条并列行，四件同裁。／修正已落 src/shared/fit-bonus-corrections.ts（1 格）。',
    verdict: 'eo',
  },
  {
    equipId: 49,
    equipName: '25mm単装機銃',
    shipIds: [668],
    fingerprint:
      '668[aa+2,evasion+1|aa+3,evasion+2]',
    source: 'wikiwiki.jp/kancolle「25mm単装機銃」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: '25mm単装機銃・25mm連装機銃・25mm三連装機銃・25mm三連装機銃 集中配備：能代改二・矢矧改二 対空+2 回避+1／矢矧改二乙 対空+3 回避+2',
    why:
      '上游按舰级（阿賀野型）写成一档 対空+2 回避+1，日文把 矢矧改二乙 单列成 対空+3 回避+2，EO 一致。这一行在 25mm 四件机銃（39 / 40 / 49 / 131）' +
      '的页面上是同一条并列行，四件同裁。／修正已落 src/shared/fit-bonus-corrections.ts（1 格）。',
    verdict: 'eo',
  },
  {
    equipId: 59,
    equipName: '零式水上観測機',
    shipIds: [501, 502, 506, 507],
    fingerprint:
      '501[aa+1,evasion+1|aa+1,evasion+1,fire+2];502[aa+1,evasion+1|aa+1,evasion+1,fire+2];506[aa+1,evasion+1|aa+1,evasion+1,fire+2];507[aa+1,evasion+1|aa+1,evasion+1,fire+2]',
    source: 'wikiwiki.jp/kancolle「零式水上観測機」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: '零式水上観測機：最上改二 / 特・三隈改二 / 特 火力+2 対空+1 回避+1',
    why:
      '上游只写了 対空+1 回避+1，漏掉 火力+2 这一栏；日文一手与 EO 逐格一致。／修正已落 src/shared/fit-bonus-corrections.ts（4 格）' +
      '。',
    verdict: 'eo',
  },
  {
    equipId: 61,
    equipName: '二式艦上偵察機',
    shipIds: [196, 197, 553, 554],
    fingerprint:
      '196[range+1|accuracy+5,range+1];197[range+1|accuracy+5,range+1];553[armor+1,evasion+2,fire+3,range+1|accuracy+5,armor+1,evasion+2,fire+3,range+1];554[armor+3,evasion+3,fire+3,range+1|accuracy+5,armor+3,evasion+3,fire+3,range+1]',
    source: 'wikiwiki.jp/kancolle「二式艦上偵察機」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: '二式艦偵★0～1 伊勢改二 火力+3 装甲+1 回避+2 射程1段階延長 命中+5／日向改二 +3 装甲+3 回避+3 射程1段階延長 命中+5／★0 蒼龍改二・飛龍改二 射程1段階延長 命中+5',
    why:
      '四格差的都是同一栏：**命中+5**。上游把射程延长记下来了、把同一行的 命中+5 整栏漏了，其余逐格无误。EO 与日文一致。／修正已落 src/shared/fit-bonus-corrections.ts（4 格）' +
      '。',
    verdict: 'eo',
  },
  {
    equipId: 62,
    equipName: '試製晴嵐',
    shipIds: [501, 502, 506, 507, 662, 663, 668],
    fingerprint:
      '501[aa+1,evasion+1,fire+2|aa+1,evasion+2,fire+3];502[aa+1,evasion+1,fire+2|aa+1,evasion+2,fire+2];506[aa+1,evasion+1,fire+2|aa+1,evasion+2,fire+3];507[aa+1,evasion+1,fire+2|aa+1,evasion+2,fire+2];662[evasion+1,fire+2|asw+1,evasion+2,fire+3];663[aa+1,evasion+1,fire+2|aa+1,asw+1,evasion+2,fire+3];668[aa+1,evasion+1,fire+2|aa+1,asw+1,evasion+2,fire+3]',
    source:
      'wikiwiki.jp/kancolle「瑞雲(六三四空)」「瑞雲12型(六三四空)」装備ボーナス表の「水上爆撃機(その他日本)」类目行（页面 Last-modified 2026-07-27）' +
      '＋舰娘页「能代改二」(2026-08-15)「矢矧改二」(2026-08-15) 的「水上爆撃機(共通・1機目)」＋「水上爆撃機(その他日本)」两行',
    jp:
      '水上爆撃機(その他日本)：能代改二 火力+3 対潜+1 回避+2／矢矧改二・乙 +3 対空+1 対潜+1 回避+2／最上改二・特 +3 +1 回避+2／' +
      '三隈改二・特 +2 +1 回避+2',
    why:
      '本装备自己的 wikiwiki 页没有「装備ボーナスについて」小节（页在，只是这一族的数值写在类目行里）。日文一手把这四行**写成类目行**「水上爆撃機(その他日本)' +
      '」——瑞雲系无固有補正的那几件共用同一档，两处互证：① 同族的 79 / 81 页逐格给出该类目行；② 能代改二舰娘页拆成「水上爆撃機(共通・1機目) 火力+1 対潜+1 回避+1」＋「水上爆撃機(その他日本)' +
      ' 火力+2 回避+1」，相加正是 火力+3 対潜+1 回避+2。上游是逐装备写的，把「水上爆撃機类目 × 最上改二系/阿賀野型改二系」这一层整层漏掉了。' +
      '／修正已落 src/shared/fit-bonus-corrections.ts（7 格）。',
    verdict: 'eo',
  },
  {
    equipId: 63,
    equipName: '12.7cm連装砲B型改二',
    shipIds: [903, 908],
    fingerprint:
      '903[aa+1|aa+1,fire+2];908[aa+1|aa+1,fire+2]',
    source: 'wikiwiki.jp/kancolle「12.7cm連装砲B型改二」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: '天霧改二 / 丁 火力+2 対空+1／綾波型・暁型・初春型 対空+1',
    why:
      '上游漏了「天霧改二/丁」这一档（只给了綾波型通用的 対空+1），日文单列 火力+2 対空+1，EO 一致。／修正已落 src/shared/fit-bonus-corrections.ts（2 格）' +
      '。',
    verdict: 'eo',
  },
  {
    equipId: 79,
    equipName: '瑞雲(六三四空)',
    shipIds: [501, 502, 506, 507, 662, 663, 668],
    fingerprint:
      '501[aa+1,evasion+1,fire+2|aa+1,evasion+2,fire+3];502[aa+1,evasion+1,fire+2|aa+1,evasion+2,fire+2];506[aa+1,evasion+1,fire+2|aa+1,evasion+2,fire+3];507[aa+1,evasion+1,fire+2|aa+1,evasion+2,fire+2];662[evasion+1,fire+2|asw+1,evasion+2,fire+3];663[aa+1,evasion+1,fire+2|aa+1,asw+1,evasion+2,fire+3];668[aa+1,evasion+1,fire+2|aa+1,asw+1,evasion+2,fire+3]',
    source: 'wikiwiki.jp/kancolle「瑞雲(六三四空)」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp:
      '水上爆撃機(その他日本)：能代改二 火力+3 対潜+1 回避+2／矢矧改二 / 乙 +3 対空+1 対潜+1 回避+2／最上改二 / 特 +3 +1 回避+2／' +
      '三隈改二 / 特 +2 +1 回避+2',
    why:
      '页内脚注写明这四行是「水上爆撃機(その他日本)のカテゴリ補正と水上爆撃機共通補正を加算したもので、本装備1つのみを装備する際の増分」——正是我们的共同分母（★0・1 件）' +
      '。逐格核下来日文与 EO 一致，上游整族偏低：最上改二/特 少 火力1 回避1，三隈改二/特 少 回避1，矢矧改二系与能代改二 还漏了 対潜+1。／修正已落 src/shared/fit-bonus-corrections.ts（7 格）' +
      '。',
    verdict: 'eo',
  },
  {
    equipId: 80,
    equipName: '瑞雲12型',
    shipIds: [501, 502, 506, 507, 662, 663, 668],
    fingerprint:
      '501[aa+1,evasion+1,fire+2|aa+1,evasion+2,fire+3];502[aa+1,evasion+1,fire+2|aa+1,evasion+2,fire+2];506[aa+1,evasion+1,fire+2|aa+1,evasion+2,fire+3];507[aa+1,evasion+1,fire+2|aa+1,evasion+2,fire+2];662[evasion+1,fire+2|asw+1,evasion+2,fire+3];663[aa+1,evasion+1,fire+2|aa+1,asw+1,evasion+2,fire+3];668[aa+1,evasion+1,fire+2|aa+1,asw+1,evasion+2,fire+3]',
    source:
      'wikiwiki.jp/kancolle「瑞雲(六三四空)」「瑞雲12型(六三四空)」装備ボーナス表の「水上爆撃機(その他日本)」类目行（页面 Last-modified 2026-07-27）' +
      '＋舰娘页「能代改二」(2026-08-15)「矢矧改二」(2026-08-15) 的「水上爆撃機(共通・1機目)」＋「水上爆撃機(その他日本)」两行',
    jp:
      '水上爆撃機(その他日本)：能代改二 火力+3 対潜+1 回避+2／矢矧改二・乙 +3 対空+1 対潜+1 回避+2／最上改二・特 +3 +1 回避+2／' +
      '三隈改二・特 +2 +1 回避+2',
    why:
      '本装备自己的 wikiwiki 页没有「装備ボーナスについて」小节（页在，只是这一族的数值写在类目行里）。日文一手把这四行**写成类目行**「水上爆撃機(その他日本)' +
      '」——瑞雲系无固有補正的那几件共用同一档，两处互证：① 同族的 79 / 81 页逐格给出该类目行；② 能代改二舰娘页拆成「水上爆撃機(共通・1機目) 火力+1 対潜+1 回避+1」＋「水上爆撃機(その他日本)' +
      ' 火力+2 回避+1」，相加正是 火力+3 対潜+1 回避+2。上游是逐装备写的，把「水上爆撃機类目 × 最上改二系/阿賀野型改二系」这一层整层漏掉了。' +
      '／修正已落 src/shared/fit-bonus-corrections.ts（7 格）。',
    verdict: 'eo',
  },
  {
    equipId: 81,
    equipName: '瑞雲12型(六三四空)',
    shipIds: [501, 502, 506, 507, 662, 663, 668],
    fingerprint:
      '501[aa+1,evasion+1,fire+2|aa+1,evasion+2,fire+3];502[aa+1,evasion+1,fire+2|aa+1,evasion+2,fire+2];506[aa+1,evasion+1,fire+2|aa+1,evasion+2,fire+3];507[aa+1,evasion+1,fire+2|aa+1,evasion+2,fire+2];662[evasion+1,fire+2|asw+1,evasion+2,fire+3];663[aa+1,evasion+1,fire+2|aa+1,asw+1,evasion+2,fire+3];668[aa+1,evasion+1,fire+2|aa+1,asw+1,evasion+2,fire+3]',
    source: 'wikiwiki.jp/kancolle「瑞雲12型(六三四空)」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp:
      '水上爆撃機(その他日本)：能代改二 火力+3 対潜+1 回避+2／矢矧改二 / 乙 +3 対空+1 対潜+1 回避+2／最上改二 / 特 +3 +1 回避+2／' +
      '三隈改二 / 特 +2 +1 回避+2',
    why:
      '页内脚注写明这四行是「水上爆撃機(その他日本)のカテゴリ補正と水上爆撃機共通補正を加算したもので、本装備1つのみを装備する際の増分」——正是我们的共同分母（★0・1 件）' +
      '。逐格核下来日文与 EO 一致，上游整族偏低：最上改二/特 少 火力1 回避1，三隈改二/特 少 回避1，矢矧改二系与能代改二 还漏了 対潜+1。／修正已落 src/shared/fit-bonus-corrections.ts（7 格）' +
      '。',
    verdict: 'eo',
  },
  {
    equipId: 87,
    equipName: '新型高温高圧缶',
    shipIds: [591, 592],
    fingerprint:
      '591[evasion+4,torpedo+2|evasion+2,torpedo+1];592[evasion+4,torpedo+2|evasion+2,torpedo+1]',
    source: 'wikiwiki.jp/kancolle「新型高温高圧缶」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: '★無し～+5 金剛改二丙・比叡改二丙・榛名改二乙 / 改二丙・霧島改二丙 雷装+1 回避+2',
    why:
      '上游把同一档写了两行（第 1 行只含 591/592、第 2 行含 591/592/593/954，数值相同），591/592 两格被相加成雷装2 回避4。' +
      '日文一手与 EO 都是 雷装+1 回避+2。这是**重复行相加**，不是数值口径之争。／修正已落 src/shared/fit-bonus-corrections.ts（2 格）' +
      '。',
    verdict: 'eo',
  },
  {
    equipId: 122,
    equipName: '10cm連装高角砲+高射装置',
    shipIds: [968],
    fingerprint:
      '968[aa+2,evasion+1,fire+1|aa+2,accuracy+1,evasion+2,fire+2]',
    source:
      'wikiwiki.jp/kancolle「10cm連装高角砲＋高射装置」装備ボーナス表（页面 Last-modified 2026-07-27；页名全角「＋」，' +
      '取票脚本按 api 名的半角「+」取所以 404，2026-08-22 按站内真实页名补抓）',
    jp: '★0~+5 秋月型 火力+1 対空+2 回避+1／★0~+5 秋月改二・初月改二 火力+2 対空+2 回避+2 命中+1',
    why:
      '上游只写了「秋月型」一档，初月改二(968) 该在「秋月改二・初月改二」那一档。akashi 亦单列「秋月型改二 火力+2 対空+2 回避+2 命中+1」，' +
      'EO 一致。／修正已落 src/shared/fit-bonus-corrections.ts（1 格）。',
    verdict: 'eo',
  },
  {
    equipId: 131,
    equipName: '25mm三連装機銃 集中配備',
    shipIds: [668],
    fingerprint:
      '668[aa+2,evasion+1|aa+3,evasion+2]',
    source: 'wikiwiki.jp/kancolle「25mm三連装機銃 集中配備」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: '25mm単装機銃・25mm連装機銃・25mm三連装機銃・25mm三連装機銃 集中配備：能代改二・矢矧改二 対空+2 回避+1／矢矧改二乙 対空+3 回避+2',
    why:
      '上游按舰级（阿賀野型）写成一档 対空+2 回避+1，日文把 矢矧改二乙 单列成 対空+3 回避+2，EO 一致。这一行在 25mm 四件机銃（39 / 40 / 49 / 131）' +
      '的页面上是同一条并列行，四件同裁。／修正已落 src/shared/fit-bonus-corrections.ts（1 格）。',
    verdict: 'eo',
  },
  {
    equipId: 207,
    equipName: '瑞雲(六三一空)',
    shipIds: [501, 502, 506, 507, 662, 663, 668],
    fingerprint:
      '501[aa+1,evasion+1,fire+2|aa+1,evasion+2,fire+3];502[aa+1,evasion+1,fire+2|aa+1,evasion+2,fire+2];506[aa+1,evasion+1,fire+2|aa+1,evasion+2,fire+3];507[aa+1,evasion+1,fire+2|aa+1,evasion+2,fire+2];662[evasion+1,fire+2|asw+1,evasion+2,fire+3];663[aa+1,evasion+1,fire+2|aa+1,asw+1,evasion+2,fire+3];668[aa+1,evasion+1,fire+2|aa+1,asw+1,evasion+2,fire+3]',
    source:
      'wikiwiki.jp/kancolle「瑞雲(六三四空)」「瑞雲12型(六三四空)」装備ボーナス表の「水上爆撃機(その他日本)」类目行（页面 Last-modified 2026-07-27）' +
      '＋舰娘页「能代改二」(2026-08-15)「矢矧改二」(2026-08-15) 的「水上爆撃機(共通・1機目)」＋「水上爆撃機(その他日本)」两行',
    jp:
      '水上爆撃機(その他日本)：能代改二 火力+3 対潜+1 回避+2／矢矧改二・乙 +3 対空+1 対潜+1 回避+2／最上改二・特 +3 +1 回避+2／' +
      '三隈改二・特 +2 +1 回避+2',
    why:
      '本装备自己的 wikiwiki 页没有「装備ボーナスについて」小节（页在，只是这一族的数值写在类目行里）。日文一手把这四行**写成类目行**「水上爆撃機(その他日本)' +
      '」——瑞雲系无固有補正的那几件共用同一档，两处互证：① 同族的 79 / 81 页逐格给出该类目行；② 能代改二舰娘页拆成「水上爆撃機(共通・1機目) 火力+1 対潜+1 回避+1」＋「水上爆撃機(その他日本)' +
      ' 火力+2 回避+1」，相加正是 火力+3 対潜+1 回避+2。上游是逐装备写的，把「水上爆撃機类目 × 最上改二系/阿賀野型改二系」这一层整层漏掉了。' +
      '／修正已落 src/shared/fit-bonus-corrections.ts（7 格）。',
    verdict: 'eo',
  },
  {
    equipId: 208,
    equipName: '晴嵐(六三一空)',
    shipIds: [501, 502, 506, 507, 662, 663, 668],
    fingerprint:
      '501[aa+1,evasion+1,fire+2|aa+1,evasion+2,fire+3];502[aa+1,evasion+1,fire+2|aa+1,evasion+2,fire+2];506[aa+1,evasion+1,fire+2|aa+1,evasion+2,fire+3];507[aa+1,evasion+1,fire+2|aa+1,evasion+2,fire+2];662[evasion+1,fire+2|asw+1,evasion+2,fire+3];663[aa+1,evasion+1,fire+2|aa+1,asw+1,evasion+2,fire+3];668[aa+1,evasion+1,fire+2|aa+1,asw+1,evasion+2,fire+3]',
    source:
      'wikiwiki.jp/kancolle「瑞雲(六三四空)」「瑞雲12型(六三四空)」装備ボーナス表の「水上爆撃機(その他日本)」类目行（页面 Last-modified 2026-07-27）' +
      '＋舰娘页「能代改二」(2026-08-15)「矢矧改二」(2026-08-15) 的「水上爆撃機(共通・1機目)」＋「水上爆撃機(その他日本)」两行',
    jp:
      '水上爆撃機(その他日本)：能代改二 火力+3 対潜+1 回避+2／矢矧改二・乙 +3 対空+1 対潜+1 回避+2／最上改二・特 +3 +1 回避+2／' +
      '三隈改二・特 +2 +1 回避+2',
    why:
      '本装备自己的 wikiwiki 页没有「装備ボーナスについて」小节（页在，只是这一族的数值写在类目行里）。日文一手把这四行**写成类目行**「水上爆撃機(その他日本)' +
      '」——瑞雲系无固有補正的那几件共用同一档，两处互证：① 同族的 79 / 81 页逐格给出该类目行；② 能代改二舰娘页拆成「水上爆撃機(共通・1機目) 火力+1 対潜+1 回避+1」＋「水上爆撃機(その他日本)' +
      ' 火力+2 回避+1」，相加正是 火力+3 対潜+1 回避+2。上游是逐装备写的，把「水上爆撃機类目 × 最上改二系/阿賀野型改二系」这一层整层漏掉了。' +
      '／修正已落 src/shared/fit-bonus-corrections.ts（7 格）。',
    verdict: 'eo',
  },
  {
    equipId: 228,
    equipName: '九六式艦戦改',
    shipIds: [894, 899],
    fingerprint:
      '894[aa+4,asw+6,evasion+5,fire+3|aa+5,asw+8,evasion+7,fire+4];899[aa+4,asw+6,evasion+5,fire+3|aa+5,asw+8,evasion+7,fire+4]',
    source: 'wikiwiki.jp/kancolle「九六式艦戦改」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: '鳳翔改二 / 戦 火力+4 対空+5 対潜+8 回避+7／鳳翔 +3 +4 +6 +5',
    why:
      '同 19 号：上游把整个鳳翔型写成一档（用的是 鳳翔 那档的数），日文把 鳳翔改二/戦 单列高一档，EO 一致。／修正已落 src/shared/fit-bonus-corrections.ts（2 格）' +
      '。',
    verdict: 'eo',
  },
  {
    equipId: 237,
    equipName: '瑞雲(六三四空/熟練)',
    shipIds: [501, 502, 506, 507, 553, 554, 662, 663, 668],
    fingerprint:
      '501[aa+1,evasion+2,fire+3|aa+1,evasion+3,fire+4];502[aa+1,evasion+2,fire+3|aa+1,evasion+3,fire+3];506[aa+1,evasion+2,fire+3|aa+1,evasion+3,fire+4];507[aa+1,evasion+2,fire+3|aa+1,evasion+3,fire+3];553[evasion+2,fire+4|aa+1,evasion+4,fire+7];554[evasion+2,fire+4|aa+1,evasion+4,fire+7];662[evasion+1,fire+3|asw+1,evasion+2,fire+4];663[aa+1,evasion+2,fire+3|aa+1,asw+1,evasion+3,fire+4];668[aa+1,evasion+2,fire+3|aa+1,asw+1,evasion+3,fire+4]',
    source:
      'wikiwiki.jp/kancolle「瑞雲(六三四空／熟練)」装備ボーナス表（页面 Last-modified 2026-07-27；本件的页名用全角「／' +
      '」，取票脚本按 api 名的半角「/」取所以 404 了，2026-08-22 按站内真实页名补抓）',
    jp:
      '伊勢型改二 火力+7 対空+1 回避+4／能代改二 +4 対潜+1 回避+2／矢矧改二 / 乙 +4 +1 対潜+1 回避+3／最上改二 / 特 +4 +1 回避+3／' +
      '三隈改二 / 特 +3 +1 回避+3',
    why:
      '逐格核下来日文一手与 EO 一致，上游整体偏低：伊勢改二/日向改二 上游给 火力4 回避2，日文是 火力7 対空1 回避4；最上改二/特 上游少 火力1 回避1，' +
      '三隈改二/特 少 回避1，矢矧改二系与能代改二 还漏 対潜+1。akashi 逐行一致（伊勢型改二 火力+7 対空+1 回避+4／能代改二 火力+4 対潜+1 回避+2／' +
      '…）。／修正已落 src/shared/fit-bonus-corrections.ts（9 格）。',
    verdict: 'eo',
  },
  {
    equipId: 238,
    equipName: '零式水上偵察機11型乙',
    shipIds: [501, 502, 506, 507],
    fingerprint:
      '501[evasion+1,torpedo+1|evasion+1,fire+2,torpedo+1];502[evasion+1,torpedo+1|evasion+1,fire+2,torpedo+1];506[evasion+1,torpedo+1|evasion+1,fire+2,torpedo+1];507[evasion+1,torpedo+1|evasion+1,fire+2,torpedo+1]',
    source: 'wikiwiki.jp/kancolle「零式水上偵察機11型乙」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: '零式水上偵察機11型乙・同(熟練)：最上改二 / 特・三隈改二 / 特 火力+2 雷装+1 回避+1',
    why:
      '上游只写了 雷装+1 回避+1，漏掉 火力+2；日文一手与 EO 逐格一致。该行日文原表**同时覆盖 238 与 239 两件**。／修正已落 src/shared/fit-bonus-corrections.ts（4 格）' +
      '。',
    verdict: 'eo',
  },
  {
    equipId: 239,
    equipName: '零式水上偵察機11型乙(熟練)',
    shipIds: [501, 502, 506, 507],
    fingerprint:
      '501[evasion+1,torpedo+1|evasion+1,fire+2,torpedo+1];502[evasion+1,torpedo+1|evasion+1,fire+2,torpedo+1];506[evasion+1,torpedo+1|evasion+1,fire+2,torpedo+1];507[evasion+1,torpedo+1|evasion+1,fire+2,torpedo+1]',
    source:
      'wikiwiki.jp/kancolle「零式水上偵察機11型乙」装備ボーナス表（页面 Last-modified 2026-07-27）；本件自身页较旧（Last-modified 2026-01-04）' +
      '，但 238 页（2026-07-27）那一行的「装備」栏原文就写着「零式水上偵察機11型乙／零式水上偵察機11型乙(熟練)」两件并列，用更新的那张也读到同一档',
    jp: '零式水上偵察機11型乙・同(熟練)：最上改二 / 特・三隈改二 / 特 火力+2 雷装+1 回避+1',
    why:
      '上游只写了 雷装+1 回避+1，漏掉 火力+2；日文一手与 EO 逐格一致。该行日文原表**同时覆盖 238 与 239 两件**。／修正已落 src/shared/fit-bonus-corrections.ts（4 格）' +
      '。',
    verdict: 'eo',
  },
  {
    equipId: 266,
    equipName: '12.7cm連装砲C型改二',
    shipIds: [20, 43, 167, 243, 320],
    fingerprint:
      '20[fire+1|evasion+1,fire+1];43[fire+1|evasion+1,fire+1];167[fire+1|evasion+1,fire+1];243[fire+1|evasion+1,fire+1];320[fire+1|evasion+1,fire+1]',
    source: 'wikiwiki.jp/kancolle「12.7cm連装砲C型改二」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: '時雨改三 火力+2 回避+2 命中+1／時雨改二・雪風改 / 丹陽・磯風乙改 火力+1 回避+1／他白露型・朝潮型全艦・他陽炎型(含秋雲改二) 火力+1',
    why:
      '5 格全是本方对：雪風(20)・磯風(167)・磯風改(320) 吃「他陽炎型」火力+1，時雨(43)・時雨改(243) 吃「他白露型」火力+1，日文表都没有给这几个形态回避。' +
      'EO 那边一律多 回避+1，是把「時雨改二・雪風改・磯風乙改」那档往链下扩了。akashi 同样把 雪風改 与 磯風乙改 单列在 回避+1 档，与 wikiwiki 一致。' +
      '／修正已落 src/shared/fit-bonus-corrections.ts（0 格）。／**无需修正**：日文一手逐格与本方相同，记在这里是为了防止将来照「老源可信」把 EO 的数改回来。',
    verdict: 'ours',
  },
  {
    equipId: 267,
    equipName: '12.7cm連装砲D型改二',
    shipIds: [648, 956, 961, 981],
    fingerprint:
      '648[aa+2,evasion+4,fire+5|evasion+1,fire+3];956[evasion+1,fire+2|evasion+1,fire+4];961[aa+2,evasion+3,fire+4|fire+2];981[evasion+1,fire+2|evasion+1,fire+3]',
    source: 'wikiwiki.jp/kancolle「12.7cm連装砲D型改二」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: '高波改二・早霜改二・清霜改二 / 丁 火力+4 回避+1／秋雲改二・他夕雲型改二 +3 +1／他夕雲型・島風 +2 +1／時雨改三 +2',
    why:
      '秋雲改二(648) 与 時雨改三(961) 上游把「探照灯／熟練見張員」那两条**协同**行写成了无条件行（第 7 行），在 ★0・无协同 的共同分母上凭空多出 火力2 対空2 回避3；早霜改二(956)' +
      ' 与 藤波改二(981) 则是分档缺失（上游的 +4 档漏了早霜改二、+3 档漏了藤波改二，两者都掉进了「他夕雲型」+2 档）。EO 逐格与日文一致。／' +
      '修正已落 src/shared/fit-bonus-corrections.ts（4 格）。',
    verdict: 'eo',
  },
  {
    equipId: 296,
    equipName: '12.7cm連装砲B型改四(戦時改修)+高射装置',
    shipIds: [244, 975],
    fingerprint:
      '244[evasion+1,fire+1|evasion+2,fire+1];975[evasion+1,fire+1|aa+1,evasion+2,fire+1]',
    source:
      'wikiwiki.jp/kancolle「12.7cm連装砲B型改四(戦時改修)＋高射装置」装備ボーナス表（页面 Last-modified 2026-07-27；页名全角「＋」，' +
      '取票脚本按半角取所以 404，2026-08-22 按站内真实页名补抓）',
    jp:
      '村雨改二・春雨改二 火力+1 対空+1 回避+2／白露改・海風改二・江風改二・山風改二 / 改二丁 +1 回避+2／初春型 +1 回避+1／他白露型(未改造から)' +
      ' +1 回避+1',
    why:
      '村雨改(244) 本方对——它既不在「村雨改二・春雨改二」档也不在「白露改…」档，吃「他白露型」火力+1 回避+1，EO 那边多给了 回避1。春雨改二(975)' +
      ' 则上游漏档（应在 火力+1 対空+1 回避+2），EO 与日文一致。／本件是逐格裁的：244 村雨改 这 1 格判**本方对**（EO 多给），不进修正台账；其余 1 格已进。' +
      '／修正已落 src/shared/fit-bonus-corrections.ts（1 格）。',
    verdict: 'eo',
  },
  {
    equipId: 298,
    equipName: '16inch Mk.I三連装砲',
    shipIds: [593, 954],
    fingerprint:
      '593[armor+1,evasion-3,fire+1|armor+1,evasion-1,fire+1];954[armor+1,evasion-3,fire+1|armor+1,evasion-1,fire+1]',
    source: 'wikiwiki.jp/kancolle「16inch Mk.I三連装砲」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: '榛名改二乙・榛名改二丙 火力+1 回避-1 装甲+1／金剛型改二 +1 回避-3 装甲+1',
    why:
      '上游把 榛名改二乙/丙 并进了「金剛型改二」档（回避-3），日文单列这两个形态为 回避-1，akashi 同款（「榛名改二乙・榛名改二丙 火力+1 装甲+1 回避-1」）' +
      '，EO 一致。／修正已落 src/shared/fit-bonus-corrections.ts（2 格）。',
    verdict: 'eo',
  },
  {
    equipId: 299,
    equipName: '16inch Mk.I三連装砲+AFCT改',
    shipIds: [593, 954],
    fingerprint:
      '593[armor+1,evasion-3,fire+1|armor+1,evasion-1,fire+1];954[armor+1,evasion-3,fire+1|armor+1,evasion-1,fire+1]',
    source:
      'wikiwiki.jp/kancolle「16inch Mk.I三連装砲＋AFCT改」装備ボーナス表（页面 Last-modified 2026-07-27）' +
      '（页名全角「＋」，取票脚本按半角取所以 404，2026-08-22 按站内真实页名补抓）',
    jp: '榛名改二乙・榛名改二丙 火力+1 回避-1 装甲+1／金剛型改二 +1 回避-3 装甲+1',
    why:
      '上游把 榛名改二乙/丙 并进了「金剛型改二」档（回避-3），日文单列这两个形态为 回避-1，akashi 同款（「榛名改二乙・榛名改二丙 火力+1 装甲+1 回避-1」）' +
      '，EO 一致。／修正已落 src/shared/fit-bonus-corrections.ts（2 格）。',
    verdict: 'eo',
  },
  {
    equipId: 300,
    equipName: '16inch Mk.I三連装砲改+FCR type284',
    shipIds: [593, 954],
    fingerprint:
      '593[armor+1,evasion-3,fire+1|armor+1,evasion-1,fire+1];954[armor+1,evasion-3,fire+1|armor+1,evasion-1,fire+1]',
    source:
      'wikiwiki.jp/kancolle「16inch Mk.I三連装砲改＋FCR type284」装備ボーナス表（页面 Last-modified 2026-07-27）' +
      '（页名全角「＋」，取票脚本按半角取所以 404，2026-08-22 按站内真实页名补抓）',
    jp: '榛名改二乙・榛名改二丙 火力+1 回避-1 装甲+1／金剛型改二 +1 回避-3 装甲+1',
    why:
      '上游把 榛名改二乙/丙 并进了「金剛型改二」档（回避-3），日文单列这两个形态为 回避-1，akashi 同款（「榛名改二乙・榛名改二丙 火力+1 装甲+1 回避-1」）' +
      '，EO 一致。／修正已落 src/shared/fit-bonus-corrections.ts（2 格）。',
    verdict: 'eo',
  },
  {
    equipId: 304,
    equipName: 'S9 Osprey',
    shipIds: [662, 663, 668],
    fingerprint:
      '662[asw+1,evasion+1,fire+1|asw+4,evasion+2,fire+3];663[asw+1,evasion+1,fire+1|asw+4,evasion+2,fire+3];668[asw+1,evasion+1,fire+1|asw+4,evasion+2,fire+3]',
    source: 'wikiwiki.jp/kancolle「S9 Osprey」装備ボーナス表（页面 Last-modified 2025-01-27）',
    jp: '能代改二・矢矧改二 / 乙 火力+3 対潜+4 回避+2（脚注：水上偵察機全般のボーナスと重複せず、こちらを優先する）',
    why:
      '上游只给了「阿賀野型」通用的 火力1 対潜1 回避1，漏掉 S9 专属那一档。日文页明确写这一档**优先**于水偵通用档，EO 一致。akashi 给的「能代改二・矢矧改二/乙 火力+2 対潜+3 回避+1」正是**水偵通用**那一档的数（与能代改二舰娘页的「水上偵察機 火力+2 対潜+3 回避+1」逐格相同）' +
      '，即 akashi 那张没有收录 S9 的专属覆盖档，不构成同粒度反证。本页取票日 2025-01-27，是各件里最旧的一张，复审优先。／修正已落 src/shared/fit-bonus-corrections.ts（3 格）' +
      '。',
    verdict: 'eo',
  },
  {
    equipId: 310,
    equipName: '14cm連装砲改',
    shipIds: [115, 293, 622, 623, 624],
    fingerprint:
      '115[aa+2,asw+1,evasion+3,fire+6|aa+1,evasion+1,fire+2];293[aa+2,asw+1,evasion+3,fire+6|aa+1,evasion+1,fire+2];622[aa+2,asw+1,evasion+3,fire+6|aa+1,asw+1,evasion+2,fire+4];623[aa+2,asw+1,evasion+3,fire+6|aa+1,asw+1,evasion+2,fire+4];624[aa+2,asw+1,evasion+3,fire+6|aa+1,asw+1,evasion+2,fire+4]',
    source: 'wikiwiki.jp/kancolle「14cm連装砲改」装備ボーナス表（页面 Last-modified 2026-08-13）',
    jp: '★無し 夕張 火力+2 対空+1 回避+1／★無し 夕張改二 / 特 / 丁 火力+4 対空+1 対潜+1 回避+2',
    why:
      '上游把「夕張」与「夕張改二系」两档都写成了 `classes:[34]` 的无条件行，两行相加 → 全夕張型一律 火力6 対空2 回避3 対潜1，这是**两档相加**的解析事故，' +
      '不是数值口径之争。日文一手是分档的（夕張/夕張改 2/1/1；夕張改二系 4/1/対潜1/2），EO 逐格与之一致；akashi 的「夕張 火力+2 対空+1 回避+1」也对得上。' +
      '／修正已落 src/shared/fit-bonus-corrections.ts（5 格）。',
    verdict: 'eo',
  },
  {
    equipId: 315,
    equipName: 'SG レーダー(初期型)',
    shipIds: [651, 656],
    fingerprint:
      '651[aa+2,evasion+3,fire+2,range+1|evasion+2,fire+2,los+3,range+1];656[aa+2,evasion+3,fire+2,range+1|evasion+2,fire+2,los+3,range+1]',
    source: 'wikiwiki.jp/kancolle「SG レーダー(初期型)」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: '丹陽 / 雪風改二 火力+2 索敵+3 回避+2 射程+1／アメリカ艦(駆逐艦) +3 索敵+4 回避+3 射程+1',
    why:
      '上游这一行三处不对：凭空多了 対空+2、回避多 1、且把 索敵+3 整栏漏了。akashi 逐格与 wikiwiki 一致（丹陽・雪風改二 火力+2 回避+2 索敵+3 射程:長）' +
      '，EO 也一致。／修正已落 src/shared/fit-bonus-corrections.ts（2 格）。',
    verdict: 'eo',
  },
  {
    equipId: 323,
    equipName: '瑞雲改二(六三四空/熟練)',
    shipIds: [501, 502, 506, 507, 553, 554, 662, 663, 668],
    fingerprint:
      '501[aa+1,evasion+2,fire+3|aa+1,evasion+3,fire+4];502[aa+1,evasion+2,fire+3|aa+1,evasion+3,fire+3];506[aa+1,evasion+2,fire+3|aa+1,evasion+3,fire+4];507[aa+1,evasion+2,fire+3|aa+1,evasion+3,fire+3];553[aa+3,asw+2,evasion+3,fire+6|aa+4,asw+2,evasion+5,fire+9];554[aa+3,asw+2,evasion+3,fire+6|aa+4,asw+2,evasion+5,fire+9];662[evasion+1,fire+3|asw+1,evasion+2,fire+4];663[aa+1,evasion+2,fire+3|aa+1,asw+1,evasion+3,fire+4];668[aa+1,evasion+2,fire+3|aa+1,asw+1,evasion+3,fire+4]',
    source: 'wikiwiki.jp/kancolle「瑞雲改二(六三四空／熟練)」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp:
      '伊勢型改二 火力+9 対空+4 対潜+2 回避+5／能代改二 +4 対潜+1 回避+2／矢矧改二 / 乙 +4 +1 対潜+1 回避+3／最上改二 / 特 +4 +1 回避+3／' +
      '三隈改二 / 特 +3 +1 回避+3',
    why:
      'wikiwiki 与 akashi **两张日文票逐格完全一致**（akashi：伊勢型改二 火力+9 対空+4 対潜+2 回避+5／能代改二 火力+4 対潜+1 回避+2／' +
      '矢矧改二/乙 火力+4 対空+1 対潜+1 回避+3／最上改二/特 火力+4 対空+1 回避+3），且与 EO 逐格一致。上游偏低同 322 一族。／修正已落 src/shared/fit-bonus-corrections.ts（9 格）' +
      '。',
    verdict: 'eo',
  },
  {
    equipId: 328,
    equipName: '35.6cm連装砲改',
    shipIds: [78, 79, 85, 86, 954],
    fingerprint:
      '78[fire+1|evasion+1,fire+1];79[fire+1|evasion+1,fire+1];85[fire+1|evasion+1,fire+1];86[fire+1|evasion+1,fire+1];954[evasion+1,fire+2|aa+1,evasion+1,fire+3]',
    source: 'wikiwiki.jp/kancolle「35.6cm連装砲改」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp:
      '金剛改二丙 火力+3 雷装+1 回避+1／比叡改二丙・榛名改二丙・霧島改二丙 +3 対空+1 回避+1／榛名改二乙 +2 対空+2 回避+1／金剛型改 / 改二 +2 回避+1／' +
      '金剛型(未改造)・扶桑型・伊勢型 +1',
    why:
      '金剛型未改造 4 格本方对（火力+1，日文这一档没有回避，EO 那边多给了 回避+1）。榛名改二丙(954) 一格上游落进了「金剛型改/改二」档（火力2 回避1）' +
      '，日文单列 火力+3 対空+1 回避+1，EO 一致。／本件是逐格裁的：78 金剛、79 榛名、85 霧島、86 比叡 这 4 格判**本方对**（EO 多给）' +
      '，不进修正台账；其余 1 格已进。／修正已落 src/shared/fit-bonus-corrections.ts（1 格）。',
    verdict: 'eo',
  },
  {
    equipId: 329,
    equipName: '35.6cm連装砲改二',
    shipIds: [78, 79, 85, 86, 954],
    fingerprint:
      '78[fire+1|evasion+1,fire+1];79[fire+1|evasion+1,fire+1];85[fire+1|evasion+1,fire+1];86[fire+1|evasion+1,fire+1];954[aa+1,evasion+1,fire+3|aa+1,evasion+1,fire+4,torpedo+2]',
    source: 'wikiwiki.jp/kancolle「35.6cm連装砲改二」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp:
      '金剛改二丙・比叡改二丙・榛名改二丙 火力+4 雷装+2 対空+1 回避+1／榛名改二乙 +3 +1 対空+3 回避+1／霧島改二丙 +5 +1 +1 +1／' +
      '金剛型改二 +3 対空+1 回避+1／金剛型改 +2 回避+1／金剛型(未改造)・扶桑型・伊勢型 +1',
    why:
      '金剛型未改造 4 格本方对（EO 多给 回避+1）。榛名改二丙(954) 上游落进「金剛型改二」档（火力3 対空1 回避1），日文单列在「金剛改二丙・比叡改二丙・榛名改二丙」档 火力+4 雷装+2 対空+1 回避+1，' +
      'EO 一致。／本件是逐格裁的：78 金剛、79 榛名、85 霧島、86 比叡 这 4 格判**本方对**（EO 多给），不进修正台账；其余 1 格已进。' +
      '／修正已落 src/shared/fit-bonus-corrections.ts（1 格）。',
    verdict: 'eo',
  },
  {
    equipId: 332,
    equipName: '16inch Mk.VIII連装砲改',
    shipIds: [1496],
    fingerprint:
      '1496[aa+1,fire+2|aa+1,evasion+1,fire+2]',
    source: 'wikiwiki.jp/kancolle「16inch Mk.VIII連装砲改」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: 'Colorado改・Maryland改 火力+2 対空+1 回避+1',
    why:
      '上游漏了 回避+1 这一栏，火力与对空两栏无误；EO 与日文一致。／修正已落 src/shared/fit-bonus-corrections.ts（1 格）' +
      '。',
    verdict: 'eo',
  },
  {
    equipId: 342,
    equipName: '流星改(一航戦)',
    shipIds: [594, 646, 698],
    fingerprint:
      '594[aa+2,evasion+1,fire+2|aa+1,evasion+1,fire+2];646[aa+2,evasion+1,fire+2|aa+1,evasion+1,fire+2];698[aa+2,evasion+1,fire+2|aa+1,evasion+1,fire+2]',
    source: 'wikiwiki.jp/kancolle「流星改(一航戦)」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: '赤城改二戊・加賀改二戊 火力+3 対空+2 回避+2／赤城改二・加賀改二 / 改二護 +2 +1 +1',
    why:
      '上游把 改二戊 那档的 対空+2 也给了 改二/改二護，日文这一档是 対空+1，EO 一致；火力与回避两栏无误。／修正已落 src/shared/fit-bonus-corrections.ts（3 格）' +
      '。',
    verdict: 'eo',
  },
  {
    equipId: 345,
    equipName: '九七式艦攻改(熟練) 試製三号戊型(空六号電探改装備機)',
    shipIds: [555, 560],
    fingerprint:
      '555[asw+2,evasion+3,fire+3|asw+2,evasion+2,fire+3];560[asw+2,evasion+3,fire+3|asw+2,evasion+2,fire+3]',
    source: 'wikiwiki.jp/kancolle「九七式艦攻改(熟練) 試製三号戊型(空六号電探改装備機)」装備ボーナス表（页面 Last-modified 2026-08-01）',
    jp: '瑞鳳改二・瑞鳳改二乙 火力+3 対潜+2 回避+3',
    why:
      '两格都是本方对：日文原表给 回避+3，EO 只给 回避+2。／修正已落 src/shared/fit-bonus-corrections.ts（0 格）' +
      '。／**无需修正**：日文一手逐格与本方相同，记在这里是为了防止将来照「老源可信」把 EO 的数改回来。',
    verdict: 'ours',
  },
  {
    equipId: 359,
    equipName: '6inch 連装速射砲 Mk.XXI',
    shipIds: [115, 293, 622, 623, 624],
    fingerprint:
      '115[aa+3,evasion+2,fire+3|aa+1,evasion+1,fire+1];293[aa+3,evasion+2,fire+3|aa+1,evasion+1,fire+1];622[aa+3,evasion+2,fire+3|aa+2,evasion+1,fire+2];623[aa+3,evasion+2,fire+3|aa+2,evasion+1,fire+2];624[aa+3,evasion+2,fire+3|aa+2,evasion+1,fire+2]',
    source: 'wikiwiki.jp/kancolle「6inch 連装速射砲 Mk.XXI」装備ボーナス表（页面 Last-modified 2026-03-18）',
    jp: 'Perth 火力+2 対空+2 回避+1／夕張 / 改 +1 +1 +1／夕張改二 / 改二特 / 改二丁 +2 +2 +1',
    why:
      '与 310 同一个解析事故：上游两条 `classes:[34]` 无条件行相加 → 全夕張型 火力3 対空3 回避2。日文一手分档（夕張/改 1/1/1；夕張改二系 2/2/1）' +
      '，EO 逐格一致。／修正已落 src/shared/fit-bonus-corrections.ts（5 格）。',
    verdict: 'eo',
  },
  {
    equipId: 364,
    equipName: '甲標的 丁型改(蛟龍改)',
    shipIds: [118, 119, 506, 507, 586, 623, 668],
    fingerprint:
      '118[evasion-2,torpedo+1|evasion+5,fire+1,torpedo+1];119[evasion-2,torpedo+2|evasion+5,fire+1,torpedo+2];506[evasion-2,torpedo+1|evasion+5,fire+1,torpedo+1];507[evasion-2,torpedo+1|evasion+5,fire+1,torpedo+3];586[evasion-2,torpedo+1|evasion+5,fire+1,torpedo+1];623[evasion-2,fire+1,torpedo+4|evasion+5,fire+2,torpedo+4];668[evasion-2,torpedo+1|evasion+5,fire+1,torpedo+1]',
    source: 'wikiwiki.jp/kancolle「甲標的 丁型改(蛟龍改)」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: '夕張改二特 火力+1 雷装+4 回避-2／三隈改二特 雷装+3 回避-2／北上改二 雷装+2 回避-2／球磨改二丁・大井改二・矢矧改二乙・最上改二特・日進甲 雷装+1 回避-2',
    why:
      '7 格里 6 格本方对——日文与本方都给 回避-2，EO 那边整片写成 回避+5（符号方向都不同），日文站本方。只有 **三隈改二特(507)** 一格：日文单列一档 雷装+3 回避-2，' +
      '本方把它并进了 雷装+1 那档。akashi 表里没有三隈改二特这一行（它只有四行，粒度更粗），不构成同粒度反证。／注意 507 三隈改二特 那一格日文给的是**第三种取值**（本方 torpedo+1 evasion-2、' +
      'EO fire+1 torpedo+3 evasion+5、日文 torpedo+3 evasion-2），所以整条记 **jp-third**。／修正已落 src/shared/fit-bonus-corrections.ts（1 格）' +
      '。／**无需修正**：日文一手逐格与本方相同，记在这里是为了防止将来照「老源可信」把 EO 的数改回来。',
    verdict: 'jp-third',
  },
  {
    equipId: 365,
    equipName: '一式徹甲弾改',
    shipIds: [136, 148, 593, 694],
    fingerprint:
      '136[fire+1|fire+2];148[fire+1|fire+2];593[fire+3|fire+2];694[fire+1|fire+3]',
    source: 'wikiwiki.jp/kancolle「一式徹甲弾改」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp:
      '金剛改二丙・比叡改二丙・榛名改二丙・霧島改二丙 火力+3／大和改 / 改二 / 改二重・武蔵改 / 改二・長門改二・陸奥改二・榛名改二乙 +2／金剛型(未改造)' +
      ' / 改 / 改二・扶桑型・伊勢型・長門・陸奥・大和・武蔵 +1',
    why:
      '四格都是分档错位：大和改(136)/武蔵改(148) 应在 +2 档（上游给 +1），霧島改二丙(694) 应在 +3 档（上游给 +1），榛名改二乙(593)' +
      ' 应在 +2 档（上游给 +3）。EO 逐格与日文一致。akashi 粒度更粗（只有「金剛型改二丙 +3／武蔵改・大和改・長門改二・陸奥改二 +2／その他日本戦艦 +1」三档，' +
      '未单列 榛名改二乙），不构成同粒度反证。／修正已落 src/shared/fit-bonus-corrections.ts（4 格）。',
    verdict: 'eo',
  },
  {
    equipId: 366,
    equipName: '12.7cm連装砲D型改三',
    shipIds: [648, 956, 961, 981],
    fingerprint:
      '648[aa+7,accuracy+1,evasion+4,fire+7|aa+5,accuracy+1,evasion+1,fire+5];956[evasion+1,fire+2|aa+3,accuracy+1,evasion+1,fire+5];961[aa+5,accuracy+1,evasion+3,fire+5|aa+3,accuracy+1,fire+3];981[evasion+1,fire+2|aa+3,accuracy+1,evasion+1,fire+4]',
    source: 'wikiwiki.jp/kancolle「12.7cm連装砲D型改三」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp:
      'x1 秋雲改二・沖波改二 火力+5 対空+5 回避+1 命中+1／x1 高波改二・早霜改二・清霜改二丁 +5 +3 +1 +1／x1 他夕雲型改二 +4 +3 +1 +1／' +
      'x1 時雨改三 +3 +3 命中+1',
    why:
      '同 267：秋雲改二/時雨改三 被「探照灯・熟練見張員」协同行（上游第 10 行写成无条件）顶高，早霜改二/藤波改二 分档缺失。EO 逐格与日文一致。**注意**：该页有两张加成表，' +
      '第二张的表前文字写明是「2022/07/13アップデート以前」的旧表（旧表 他夕雲型改二 是 火力+3、无命中；同页明确写了「夕雲型改二・島風改においてそれぞれ火力+1命中+1の上方修正」）' +
      '。akashi 那张给的正是旧表的 火力+3——属**过期**而非同期反证，取现行表。／修正已落 src/shared/fit-bonus-corrections.ts（4 格）' +
      '。',
    verdict: 'eo',
  },
  {
    equipId: 370,
    equipName: 'Swordfish Mk.II改(水偵型)',
    shipIds: [733, 927],
    fingerprint:
      '733[asw+3,evasion+3,fire+6,los+3|asw+3,evasion+4,fire+5,los+3];927[asw+3,evasion+3,fire+6,los+3|asw+3,evasion+4,fire+5,los+3]',
    source: 'wikiwiki.jp/kancolle「Swordfish Mk.II改(水偵型)」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: 'Warspite 火力+6 対潜+3 索敵+3 回避+3／Valiant 火力+5 対潜+3 索敵+3 回避+4',
    why:
      '上游按舰级（Warspite改型）把 Valiant 与 Warspite 写成同一档，日文把两舰**单列成两档**（Valiant 火力低 1、回避高 1）' +
      '，EO 一致。akashi 那张只有 Warspite 行、没有 Valiant 行，不构成反证。／修正已落 src/shared/fit-bonus-corrections.ts（2 格）' +
      '。',
    verdict: 'eo',
  },
  {
    equipId: 371,
    equipName: 'Fairey Seafox改',
    shipIds: [571, 572, 576, 577],
    fingerprint:
      '571[asw+1,evasion+1,fire+6,los+5|asw+1,evasion+4,fire+6,los+5];572[asw+1,evasion+1,fire+6,los+5|asw+1,evasion+4,fire+6,los+5];576[asw+1,evasion+1,fire+6,los+5|asw+1,evasion+4,fire+6,los+5];577[asw+1,evasion+1,fire+6,los+5|asw+1,evasion+4,fire+6,los+5]',
    source: 'wikiwiki.jp/kancolle「Fairey Seafox改」装備ボーナス表（页面 Last-modified 2026-07-30）',
    jp: 'Nelson・Rodney 火力+6 対潜+1 索敵+5 回避+4',
    why:
      '上游 回避只给了 +1，日文与 akashi 都是 回避+4，EO 一致。其余三栏逐格无误。／修正已落 src/shared/fit-bonus-corrections.ts（4 格）' +
      '。',
    verdict: 'eo',
  },
  {
    equipId: 372,
    equipName: '天山一二型甲',
    shipIds: [318, 555, 560],
    fingerprint:
      '318[asw+1,fire+1|asw+1,torpedo+1];555[asw+1,fire+1|asw+1,torpedo+1];560[asw+1,fire+1|asw+1,torpedo+1]',
    source: 'wikiwiki.jp/kancolle「天山一二型甲」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: '瑞鳳改二 / 乙・龍鳳改 雷装+1 対潜+1（火力栏为空）',
    why:
      '上游把 雷装+1 记成了 **火力+1**（栏搞错），日文原表这一档火力栏是空的，EO 一致。／修正已落 src/shared/fit-bonus-corrections.ts（3 格）' +
      '。',
    verdict: 'eo',
  },
  {
    equipId: 373,
    equipName: '天山一二型甲改(空六号電探改装備機)',
    shipIds: [74, 116],
    fingerprint:
      '74[asw+1,torpedo+1|asw+1];116[asw+1,torpedo+1|asw+1]',
    source: 'wikiwiki.jp/kancolle「天山一二型甲改(空六号電探改装備機)」装備ボーナス表（页面 Last-modified 2026-08-01）',
    jp: '祥鳳・瑞鳳 対潜+1（火力・雷装栏为空）／祥鳳改・瑞鳳改・龍鳳 火力+1 雷装+1 対潜+1',
    why:
      '未改造的 祥鳳(74)/瑞鳳(116) 日文只给 対潜+1，上游多给了 雷装+1（那是「改」以后那一档的），EO 一致。／修正已落 src/shared/fit-bonus-corrections.ts（2 格）' +
      '。',
    verdict: 'eo',
  },
  {
    equipId: 374,
    equipName: '天山一二型甲改(熟練/空六号電探改装備機)',
    shipIds: [282, 318, 555, 560, 883],
    fingerprint:
      '282[asw+2,evasion+1,fire+1,torpedo+2|asw+2,evasion+1,fire+1,torpedo+1];318[asw+6,evasion+4,fire+2,torpedo+2|asw+3,evasion+2,fire+1,torpedo+1];555[asw+6,evasion+4,fire+2,torpedo+2|asw+3,evasion+2,fire+1,torpedo+1];560[asw+6,evasion+4,fire+2,torpedo+2|asw+3,evasion+2,fire+1,torpedo+1];883[asw+3,evasion+3,fire+2,torpedo+3|asw+3,evasion+5,fire+2,torpedo+3]',
    source:
      'wikiwiki.jp/kancolle「天山一二型甲改(熟練／空六号電探改装備機)」装備ボーナス表（页面 Last-modified 2026-08-07；页名全角「／' +
      '」，取票脚本按半角取所以 404，2026-08-22 按站内真实页名补抓）',
    jp: '龍鳳改二戊 火力+2 雷装+3 対潜+3 回避+5／瑞鳳改二 / 乙・龍鳳改 +1 +1 対潜+3 回避+2／祥鳳改 +1 +1 対潜+2 回避+1',
    why:
      '瑞鳳改二/乙・龍鳳改 三格上游把同一档写了两遍（第 4 行 flat 与第 7 行 byCount 的第 1 档同值），被相加成 2/2/対潜6/回避4；日文与 EO 都是 1/1/対潜3/回避2。' +
      '祥鳳改 上游多给 雷装1；龍鳳改二戊 上游少 回避2。／修正已落 src/shared/fit-bonus-corrections.ts（5 格）。',
    verdict: 'eo',
  },
  {
    equipId: 380,
    equipName: '12.7cm連装高角砲改二',
    shipIds: [488],
    fingerprint:
      '488[aa+8,asw+4,fire+4|aa+4,asw+2,fire+2]',
    source: 'wikiwiki.jp/kancolle「12.7cm連装高角砲改二」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: '由良改二 火力+2 対空+4 対潜+2',
    why:
      '上游把 由良改二 这一档**写了两条一模一样的行**（第 7、8 行 who 都是 forms:[488]、数值都是 火力2 対空4 対潜2），于是被相加成 4/8/4。' +
      '日文一手与 EO 都是 2/4/2。这是重复行相加，不是数值口径之争。／修正已落 src/shared/fit-bonus-corrections.ts（1 格）' +
      '。',
    verdict: 'eo',
  },
  {
    equipId: 382,
    equipName: '12cm単装高角砲E型',
    shipIds: [979],
    fingerprint:
      '979[aa+2,asw+1,evasion+2|aa+3,accuracy+1,asw+1,evasion+3,fire+1]',
    source: 'wikiwiki.jp/kancolle「12cm単装高角砲E型」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: '稲木改二 火力+1 対空+3 対潜+1 回避+3 命中+1／海防艦(稲木改二除く) 対空+2 対潜+1 回避+2',
    why:
      '上游没有 稲木改二 这一档，它落进了「海防艦」通用档。日文单列，EO 一致。akashi 那张只有「海防艦」行、没有 稲木改二 行，不构成反证。／修正已落 src/shared/fit-bonus-corrections.ts（1 格）' +
      '。',
    verdict: 'eo',
  },
  {
    equipId: 383,
    equipName: '後期型53cm艦首魚雷(8門)',
    shipIds: [607],
    fingerprint:
      '607[torpedo+3|torpedo+4]',
    source: 'wikiwiki.jp/kancolle「後期型53cm艦首魚雷(8門)」装備ボーナス表（页面 Last-modified 2026-08-10）',
    jp: '★0～4 伊47 雷装+3／★0～4 伊47改 雷装+4',
    why:
      '上游把 伊47 与 伊47改 并成一档（雷装+3），日文把 伊47改 单列成 雷装+4，akashi 同款，EO 一致。／修正已落 src/shared/fit-bonus-corrections.ts（1 格）' +
      '。',
    verdict: 'eo',
  },
  {
    equipId: 384,
    equipName: '後期型潜水艦搭載電探&逆探',
    shipIds: [607],
    fingerprint:
      '607[evasion+3|evasion+4]',
    source:
      'wikiwiki.jp/kancolle「後期型潜水艦搭載電探＆逆探」装備ボーナス表（页面 Last-modified 2026-04-25；页名全角「＆」，' +
      '取票脚本按 api 名的半角「&」取所以 404，2026-08-22 按站内真实页名补抓）',
    jp: '伊58 回避+2／伊400・伊401・伊47 回避+3／伊47改 回避+4',
    why:
      '与 383 同一个并档问题：上游把 伊47改 并进 伊47 那档（回避+3），日文单列 回避+4，EO 一致。akashi 那张只到「伊400・伊401・伊47 回避+3」、' +
      '没有 伊47改 行，不构成反证。／修正已落 src/shared/fit-bonus-corrections.ts（1 格）。',
    verdict: 'eo',
  },
  {
    equipId: 385,
    equipName: '16inch三連装砲 Mk.6 mod.2',
    shipIds: [924, 929, 936],
    fingerprint:
      '924[fire+2|fire+1];929[fire+2|fire+1];936[fire+2|fire+1]',
    source: 'wikiwiki.jp/kancolle「16inch三連装砲 Mk.6 mod.2」装備ボーナス表（页面 Last-modified 2026-08-03）',
    jp: '★無し～5 Nevada 火力+1／★無し～5 Colorado・Maryland・Iowa 火力+2',
    why:
      '上游把 Nevada 型并进了 Colorado/Maryland/Iowa 那档（火力+2），日文单列 Nevada ★無し～5 火力+1，EO 一致。' +
      'akashi 那张压根没有 Nevada 行，不构成反证。／修正已落 src/shared/fit-bonus-corrections.ts（3 格）。',
    verdict: 'eo',
  },
  {
    equipId: 392,
    equipName: '九九式艦爆二二型(熟練)',
    shipIds: [112, 282, 288],
    fingerprint:
      '112[evasion+2,fire+2|evasion+1,fire+2];282[evasion+2,fire+2|evasion+1,fire+2];288[evasion+2,fire+2|evasion+1,fire+2]',
    source: 'wikiwiki.jp/kancolle「九九式艦爆二二型(熟練)」装備ボーナス表（页面 Last-modified 2026-07-26）',
    jp:
      '瑞鳳改二 / 乙 火力+3 回避+2／瑞鳳改・祥鳳改・龍鳳改 +2 +2／瑞鳳・龍鳳・翔鶴・瑞鶴 +2 +1／飛鷹改・隼鷹改二 +1 +1（「艦名記載は、' +
      'その値が適用される一番下の改造段階が基準」）',
    why:
      '祥鳳改(282) 本方对——日文单列「瑞鳳改・祥鳳改・龍鳳改 火力+2 回避+2」，akashi 同款，EO 那边只给 回避+1 是错的。翔鶴改(288)' +
      '/瑞鶴改(112) 则相反：按「一番下の改造段階が基準」它们继承「翔鶴・瑞鶴 火力+2 回避+1」，本方多给了 回避1，EO 与日文一致（akashi 记作「翔鶴型 火力+2 回避+1」，' +
      '同）。／本件是逐格裁的：282 祥鳳改 这 1 格判**本方对**（EO 多给），不进修正台账；其余 2 格已进。／修正已落 src/shared/fit-bonus-corrections.ts（2 格）' +
      '。',
    verdict: 'eo',
  },
  {
    equipId: 409,
    equipName: '武装大発',
    shipIds: [161, 166, 621, 626],
    fingerprint:
      '161[aa+1,asw+1,evasion+1,fire+1|aa+1,asw+1,evasion+2,fire+1];166[aa+1,asw+1,evasion+1,fire+1|aa+1,asw+1,evasion+2,fire+1];621[aa+2,evasion+3,fire+2|aa+2,evasion+3,fire+1];626[aa+2,evasion+3,fire+2|aa+2,evasion+3,fire+1]',
    source: 'wikiwiki.jp/kancolle「武装大発」装備ボーナス表（页面 Last-modified 2026-08-14）',
    jp: '神州丸 火力+1 対空+2 回避+3／あきつ丸 火力+1 対空+1 対潜+1 回避+2',
    why:
      '神州丸系上游多给 火力1，あきつ丸系上游少 回避1；EO 逐格与日文一致。akashi 那张（神州丸 火力+2 索敵+2 回避+3／あきつ丸 火力+1 索敵+1 対潜+1 回避+1）' +
      '在**栏名**上就与两方都不同（把 対空 记成了 索敵），属其自身表格的列错位，不作为同粒度反证；wikiwiki 这张 2026-08-14 更新且与 EO 独立吻合。' +
      '／修正已落 src/shared/fit-bonus-corrections.ts（4 格）。',
    verdict: 'eo',
  },
  {
    equipId: 410,
    equipName: '21号対空電探改二',
    shipIds: [968],
    fingerprint:
      '968[aa+5,armor+1,evasion+4,fire+1,los+2|aa+6,armor+1,evasion+5,fire+2,los+2]',
    source: 'wikiwiki.jp/kancolle「21号対空電探改二」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: '秋月型・最上改・最上改二 / 特・三隈改二 / 特 火力+1 対空+5 索敵+2 装甲+1 回避+4／秋月改二・初月改二 火力+2 対空+6 索敵+2 装甲+1 回避+5',
    why:
      '上游只写了「秋月型」一档，初月改二(968) 该在「秋月改二・初月改二」那一档（火力/対空/回避 各高 1）。EO 一致。akashi 那张只到「秋月型・最上改」与「最上改二/特」两行、' +
      '没有秋月改二档，不构成反证。／修正已落 src/shared/fit-bonus-corrections.ts（1 格）。',
    verdict: 'eo',
  },
  {
    equipId: 411,
    equipName: '42号対空電探改二',
    shipIds: [593],
    fingerprint:
      '593[aa+4,fire+3|aa+6,evasion+3,fire+4]',
    source: 'wikiwiki.jp/kancolle「42号対空電探改二」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: '★0~3 榛名改二乙 火力+4 対空+6 回避+3',
    why:
      '上游在 榛名改二乙 上多切了一档「★0 → 火力3 対空4」，日文原表的第一档是 **★0~3 火力+4 対空+6 回避+3**（akashi 同款），' +
      '所以 ★0 那一格上游偏低。EO 一致。／修正已落 src/shared/fit-bonus-corrections.ts（1 格）。',
    verdict: 'eo',
  },
  {
    equipId: 413,
    equipName: '精鋭水雷戦隊 司令部',
    shipIds: [135, 304, 325, 410, 484, 680, 743, 955, 960, 983],
    fingerprint:
      '135[evasion+7,fire+4,torpedo+5|evasion+7,fire+5,torpedo+6];304[evasion+7,fire+4,torpedo+5|evasion+7,fire+5,torpedo+6];325[evasion+7,fire+4,torpedo+5|aa+1,evasion+8,fire+4,torpedo+5];410[evasion+7,fire+4,torpedo+5|aa+1,evasion+8,fire+4,torpedo+5];484[evasion+7,fire+4,torpedo+5|aa+1,evasion+8,fire+4,torpedo+5];680[evasion+7,fire+4,torpedo+5|aa+1,evasion+8,fire+4,torpedo+5];743[evasion+7,fire+4,torpedo+5|evasion+7,fire+5,torpedo+6];955[evasion+7,fire+4,torpedo+5|aa+1,evasion+8,fire+4,torpedo+5];960[evasion+7,fire+4,torpedo+5|aa+1,evasion+8,fire+4,torpedo+5];983[evasion+7,fire+4,torpedo+5|aa+1,evasion+8,fire+4,torpedo+5]',
    source: 'wikiwiki.jp/kancolle「精鋭水雷戦隊 司令部」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: '長波改二 火力+6 雷装+6 回避+8／照月 +5 +6 +7／他夕雲型・秋月型 +4 +5 +7（「艦名記載は、その値が適用される一番下の改造段階が基準」）',
    why:
      '日文表只有三档：長波改二 6/6/8、照月 5/6/7、他夕雲型・秋月型 4/5/7。長波(135)/長波改(304) 在 長波改二 之下，吃「他夕雲型」4/5/7——本方对，' +
      'EO 那边给 5/6/7 是它自己多了一条「長波链 +1/+1」；清霜・浜波各形态同理，EO 多给 対空+1 回避+1，日文表里没有这一档。唯一要改的是 **長波改二補(743)' +
      '**：它在改造链上位于 長波改二 之上、日文表没有单列，按页首那句「一番下の改造段階が基準」应继承 長波改二 的 6/6/8——本方给 4/5/7、EO 给 5/6/7，' +
      '**两边都不对**，这是日文票支持第三值的一格。／注意 743 長波改二補 那一格日文给的是**第三种取值**（本方 fire+4 torpedo+5 evasion+7、' +
      'EO fire+5 torpedo+6 evasion+7、日文 fire+6 torpedo+6 evasion+8），所以整条记 **jp-third**。' +
      '／修正已落 src/shared/fit-bonus-corrections.ts（1 格）。／**无需修正**：日文一手逐格与本方相同，记在这里是为了防止将来照「老源可信」把 EO 的数改回来。',
    verdict: 'jp-third',
  },
  {
    equipId: 421,
    equipName: 'SB2C-5',
    shipIds: [713, 885],
    fingerprint:
      '713[fire+1|fire+2];885[fire+1|fire+2]',
    source: 'wikiwiki.jp/kancolle「SB2C-5」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: '★0~4 Glorious(正規空母)・Victorious 火力+2／★0~4 Ark Royal 火力+1',
    why:
      '上游把 Victorious 与 Ark Royal 并成一档（火力+1），日文把 Victorious 放在 火力+2 档、Ark Royal 单列 +1，' +
      'akashi 同款，EO 一致。／修正已落 src/shared/fit-bonus-corrections.ts（2 格）。',
    verdict: 'eo',
  },
  {
    equipId: 422,
    equipName: 'FR-1 Fireball',
    shipIds: [396, 544],
    fingerprint:
      '396[aa+2,evasion+3,fire+3|evasion+1,fire+1];544[aa+2,evasion+3,fire+3|evasion+1,fire+1]',
    source: 'wikiwiki.jp/kancolle「FR-1 Fireball」装備ボーナス表（页面 Last-modified 2026-08-21）',
    jp: '★0~5 Gambier Bay Mk.II 火力+3 対空+2 回避+3／★0~5 Gambier Bay・Langley 火力+1 回避+1',
    why:
      '上游按舰级（Gambier Bay改型 ctype 83）把 Mk.II 那一档给了全级，于是 Gambier Bay(544) 与 Gambier Bay改(396)' +
      ' 也拿到 火力3 対空2 回避3。日文把 Mk.II 单列（它在改造链上位于 Gambier Bay改 之上），其余吃「Gambier Bay・Langley」的 火力+1 回避+1；akashi 同款（Gambier Bay Mk.II 一档、' +
      'アメリカ軽空母 火力+1 回避+1 一档），EO 一致。／修正已落 src/shared/fit-bonus-corrections.ts（2 格）。',
    verdict: 'eo',
  },
  {
    equipId: 424,
    equipName: 'Barracuda Mk.II',
    shipIds: [393, 515, 713, 885],
    fingerprint:
      '393[aa+3,fire+2|fire+2,torpedo+3];515[aa+3,fire+2|fire+2,torpedo+3];713[aa+3,fire+2|fire+2,torpedo+3];885[aa+3,fire+2|fire+2,torpedo+3]',
    source: 'wikiwiki.jp/kancolle「Barracuda Mk.II」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: '★無し~+1 Ark Royal・Victorious・Glorious(正規空母) 火力+2 雷装+3',
    why:
      '上游把 雷装+3 记成了 **対空+3**（栏搞错），日文与 akashi 都写 雷装+3，EO 一致。火力+2 两边相同。／修正已落 src/shared/fit-bonus-corrections.ts（4 格）' +
      '。',
    verdict: 'eo',
  },
  {
    equipId: 428,
    equipName: '320mm/44 連装砲',
    shipIds: [511, 512, 513],
    fingerprint:
      '511[evasion+1,fire+1|evasion+1,fire+2];512[evasion+1,fire+1|evasion+1,fire+2];513[evasion+1,fire+1|evasion+1,fire+2]',
    source:
      'wikiwiki.jp/kancolle「320mm／44 連装砲」装備ボーナス表（页面 Last-modified 2026-05-30；页名全角「／' +
      '」，取票脚本按 api 名的半角「/」取所以 404，2026-08-22 按站内真实页名补抓）',
    jp: 'x1 Гангут 火力+2 回避+1／x2以降 火力+1',
    why:
      '第一门 Гангут 型日文给 火力+2 回避+1，上游写成 火力+1（把 2 门以后那档的增量当成了第一门）。akashi 的「Гангут 火力+2,+1,+1,+1 回避+1,+0,+0,+0」逐档一致，' +
      'EO 也一致。／修正已落 src/shared/fit-bonus-corrections.ts（3 格）。',
    verdict: 'eo',
  },
  {
    equipId: 438,
    equipName: '三式水中探信儀改',
    shipIds: [744],
    fingerprint:
      '744[asw+1,evasion+1|asw+4,evasion+3,fire+1]',
    source: 'wikiwiki.jp/kancolle「三式水中探信儀改」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: '1つ目 朝霜 火力+1 対潜+4 回避+3（「艦名記載は、その値が適用される一番下の改造段階が基準」）',
    why:
      '上游的「朝霜」档只列到 朝霜改二(578)，漏了改造链更上一级的 **朝霜改二補(744)**，它掉进了驱逐通用档（対潜1 回避1）。按页首那句「一番下の改造段階が基準」，' +
      '744 继承「朝霜」档 火力+1 対潜+4 回避+3，EO 一致。／修正已落 src/shared/fit-bonus-corrections.ts（1 格）' +
      '。',
    verdict: 'eo',
  },
  {
    equipId: 442,
    equipName: '潜水艦後部魚雷発射管4門(初期型)',
    shipIds: [891, 897],
    fingerprint:
      '891[torpedo+2|evasion+2,torpedo+1];897[torpedo+2|evasion+2,torpedo+1]',
    source: 'wikiwiki.jp/kancolle「潜水艦後部魚雷発射管4門(初期型)」装備ボーナス表（页面 Last-modified 2026-08-10）',
    jp: 'Gato級 雷装+2／Salmon 雷装+1 回避+2',
    why:
      '上游把 Gato 級与 Salmon 级并成一条（雷装+2），日文分两档：Salmon 是 雷装+1 回避+2，EO 一致。／修正已落 src/shared/fit-bonus-corrections.ts（2 格）' +
      '。',
    verdict: 'eo',
  },
  {
    equipId: 443,
    equipName: '潜水艦後部魚雷発射管4門(後期型)',
    shipIds: [891, 897],
    fingerprint:
      '891[torpedo+2|evasion+2,torpedo+1];897[torpedo+2|evasion+2,torpedo+1]',
    source: 'wikiwiki.jp/kancolle「潜水艦後部魚雷発射管4門(後期型)」装備ボーナス表（页面 Last-modified 2026-08-10）',
    jp: 'Gato級 雷装+2／Salmon 雷装+1 回避+2',
    why:
      '上游把 Gato 級与 Salmon 级并成一条（雷装+2），日文分两档：Salmon 是 雷装+1 回避+2，EO 一致。／修正已落 src/shared/fit-bonus-corrections.ts（2 格）' +
      '。',
    verdict: 'eo',
  },
  {
    equipId: 464,
    equipName: '10cm連装高角砲群 集中配備',
    shipIds: [593, 954],
    fingerprint:
      '593[aa-2,evasion-2|];954[aa-2,evasion-2|]',
    source: 'wikiwiki.jp/kancolle「10cm連装高角砲群 集中配備」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: '金剛型・Гангут・Conte di Cavour ※榛名改二乙 / 丙を除く 対空-2 回避-2',
    why:
      '日文那一行的对象里写着「※榛名改二乙/丙を除く」，上游把这个**排除**漏掉了，于是 593/954 也吃到 対空-2 回避-2 的罚。EO 那边这两格是空的（无加成）' +
      '，与日文一致。akashi 那张给 榛名改二乙/丙 的「対空+5 回避+4」与它上一行 大和型改二 的数完全相同，是它自己表格跨行合并的呈现事故，不作为同粒度反证。' +
      '／修正已落 src/shared/fit-bonus-corrections.ts（2 格）。',
    verdict: 'eo',
  },
  {
    equipId: 470,
    equipName: '12.7cm連装砲C型改三',
    shipIds: [167, 320],
    fingerprint:
      '167[fire+2|evasion+2,fire+2];320[fire+2|evasion+2,fire+2]',
    source: 'wikiwiki.jp/kancolle「12.7cm連装砲C型改三」装備ボーナス表（页面 Last-modified 2026-07-26）',
    jp: '雪風・磯風乙改 火力+2 回避+2／時雨 火力+1 回避+2／他陽炎型(秋雲含む) 火力+2／他白露型・朝潮型 火力+1',
    why:
      '两格都是本方对：磯風(167) 与 磯風改(320) 在 磯風乙改 之下，吃「他陽炎型」的 火力+2，日文这一档没有回避；EO 那边把 磯風乙改 的 回避+2 往链下扩了。' +
      '／修正已落 src/shared/fit-bonus-corrections.ts（0 格）。／**无需修正**：日文一手逐格与本方相同，记在这里是为了防止将来照「老源可信」把 EO 的数改回来。',
    verdict: 'ours',
  },
  {
    equipId: 483,
    equipName: '三式弾改二',
    shipIds: [150, 954],
    fingerprint:
      '150[aa+2,fire+2|aa+4,accuracy+1,fire+3];954[aa+5,evasion+2,fire+3|aa+7,accuracy+1,evasion+2,fire+4]',
    source: 'wikiwiki.jp/kancolle「三式弾改二」装備ボーナス表（页面 Last-modified 2026-08-06）',
    jp: '比叡改二 火力+2 対空+2／榛名改二丙 火力+3 対空+5 回避+2／金剛改二・霧島改二 +4 +5 命中+1',
    why:
      '两格都是本方对：日文把 比叡改二 单列成 火力+2 対空+2（比 金剛改二/霧島改二 那档低），榛名改二丙 是 3/5/回避2，本方逐格相同；EO 把 比叡改二 并进了 金剛改二档、' +
      '给 榛名改二丙 多算了 対空2 命中1。akashi 的 榛名改二丙 行（火力+3 対空+5 回避+2）与 wikiwiki、与本方一致。／修正已落 src/shared/fit-bonus-corrections.ts（0 格）' +
      '。／**无需修正**：日文一手逐格与本方相同，记在这里是为了防止将来照「老源可信」把 EO 的数改回来。',
    verdict: 'ours',
  },
  {
    equipId: 488,
    equipName: '二式爆雷改二',
    shipIds: [228, 235, 243, 411, 412, 663],
    fingerprint:
      '228[asw+1,evasion+1|accuracy+1,asw+3,evasion+2];235[asw+1,evasion+1|asw+2,evasion+1];243[asw+2,evasion+1|accuracy+1,asw+3,evasion+2];411[asw+2,evasion+1|asw+1];412[asw+2,evasion+1|asw+1];663[asw+2,evasion+1|asw+1]',
    source: 'wikiwiki.jp/kancolle「二式爆雷改二」装備ボーナス表（页面 Last-modified 2026-08-12）',
    jp: '扶桑改二・山城改二・矢矧改二 対潜+1／潮改二・初霜改二・時雨・涼月改・冬月改 対潜+2 回避+1／他日本駆逐艦・海防艦(御蔵型を除く) 対潜+1 回避+1',
    why:
      '扶桑改二 / 山城改二 / 矢矧改二 三格：日文与 akashi 都只给 **対潜+1**（没有回避），本方多给了 回避+1 与 対潜+1，EO 与日文一致。' +
      '另 3 格（雪風改・響改・時雨改）本方对——它们分别吃「他日本駆逐艦」与「時雨」档，EO 把 雪風改二/時雨改二 的高档往链下扩了。／本件是逐格裁的：228 雪風改、' +
      '235 響改、243 時雨改 这 3 格判**本方对**（EO 多给），不进修正台账；其余 3 格已进。／修正已落 src/shared/fit-bonus-corrections.ts（3 格）' +
      '。',
    verdict: 'eo',
  },
  {
    equipId: 490,
    equipName: '試製 夜間瑞雲(攻撃装備)',
    shipIds: [501, 502, 506, 507, 662, 663, 668],
    fingerprint:
      '501[aa+1,evasion+2,fire+3|aa+1,evasion+3,fire+4];502[aa+1,evasion+2,fire+3|aa+1,evasion+3,fire+3];506[aa+1,evasion+2,fire+3|aa+1,evasion+3,fire+4];507[aa+1,evasion+2,fire+3|aa+1,evasion+3,fire+3];662[evasion+1,fire+3|asw+1,evasion+2,fire+4];663[aa+1,evasion+2,fire+3|aa+1,asw+1,evasion+3,fire+4];668[aa+1,evasion+2,fire+3|aa+1,asw+1,evasion+3,fire+4]',
    source: 'wikiwiki.jp/kancolle「試製 夜間瑞雲(攻撃装備)」装備ボーナス表（页面 Last-modified 2026-08-16）',
    jp: '能代改二 火力+4 対潜+1 回避+2／矢矧改二 / 乙 +4 対空+1 対潜+1 回避+3／最上改二 / 特 +4 +1 回避+3／三隈改二 / 特 +3 +1 回避+3',
    why:
      '本件与 322 / 237 / 323 同属日文表里那一组「瑞雲(六三四空/熟練)・瑞雲改二(六三四空)・同(熟練)・本装備」并列行，四件同值。伊勢型改二 那一行上游是对的（火力3 対空1 回避2）' +
      '，差的只有最上/三隈/矢矧/能代这 7 格。akashi 一致（能代改二 火力+4 対潜+1／矢矧改二/乙 火力+4 対空+1 対潜+1／最上改二/特 火力+4 対空+1）' +
      '。／修正已落 src/shared/fit-bonus-corrections.ts（7 格）。',
    verdict: 'eo',
  },
  {
    equipId: 502,
    equipName: '35.6cm連装砲改三(ダズル迷彩仕様)',
    shipIds: [151, 593, 954],
    fingerprint:
      '151[aa+3,accuracy+1,evasion+2,fire+4|aa+2,evasion+1,fire+2];593[aa+5,accuracy+1,evasion+5,fire+8|aa+4,evasion+3,fire+5];954[aa+4,accuracy+1,evasion+5,fire+6|aa+3,evasion+3,fire+3]',
    source: 'wikiwiki.jp/kancolle「35.6cm連装砲改三(ダズル迷彩仕様)」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: '★+0 榛名改二乙 火力+5 対空+4 回避+3／★+0 榛名改二丙 +3 +3 +3／★+0～1 榛名改二 +2 +2 +1',
    why:
      '上游把「21号/42号対空電探シナジー」那几笔（第 12–17 行）写成了无条件行，在 ★0・无协同 的共同分母上给 151/593/954 各凭空多出 火力/対空/回避/命中。' +
      '日文一手（akashi 同款：榛名改二乙 火力+5 対空+4 回避+3、榛名改二丙 +3 +3 +3）与 EO 逐格一致。／修正已落 src/shared/fit-bonus-corrections.ts（3 格）' +
      '。',
    verdict: 'eo',
  },
  {
    equipId: 503,
    equipName: '35.6cm連装砲改四',
    shipIds: [149, 151, 591, 592, 593, 954],
    fingerprint:
      '149[fire+2|aa+1,fire+2];151[fire+2|aa+2,accuracy+1,fire+2];591[aa+1,accuracy+2,fire+4,torpedo+1|aa+1,accuracy+1,fire+3];592[aa+1,accuracy+2,fire+4,torpedo+1|aa+1,accuracy+1,fire+3];593[aa+4,accuracy+3,fire+5,torpedo+1|aa+4,accuracy+2,fire+4];954[aa+3,accuracy+3,fire+5,torpedo+1|aa+3,accuracy+2,fire+4]',
    source: 'wikiwiki.jp/kancolle「35.6cm連装砲改四」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: '榛名改二乙 火力+4 対空+4 命中+2／榛名改二丙 +4 +3 +2／霧島改二丙 +4 +1 +1／金剛改二丙・比叡改二丙 +3 +1 +1／金剛改二・比叡改二・榛名改二・霧島改二 +2',
    why:
      '金剛改二(149)/榛名改二(151) 本方对（火力+2，EO 那边多给了 対空/命中）。改二丙系与榛名改二乙/丙 四格上游偏高：上游把「53cm連装魚雷★max 才给的 火力+1 雷装+4 命中+1」当成了无条件行（第 9–11 行）' +
      '，所以在 ★0・无协同 的共同分母上凭空多出 火力1 雷装1 命中1。日文一手与 EO 逐格一致。／本件是逐格裁的：149 金剛改二、151 榛名改二 这 2 格判**本方对**（EO 多给）' +
      '，不进修正台账；其余 4 格已进。／修正已落 src/shared/fit-bonus-corrections.ts（4 格）。',
    verdict: 'eo',
  },
  {
    equipId: 510,
    equipName: 'Walrus',
    shipIds: [571, 572, 576, 577],
    fingerprint:
      '571[asw+3,evasion+4,fire+6,los+5|accuracy+2,asw+3,evasion+4,fire+6,los+5];572[asw+3,evasion+4,fire+6,los+5|accuracy+2,asw+3,evasion+4,fire+6,los+5];576[asw+3,evasion+4,fire+6,los+5|accuracy+2,asw+3,evasion+4,fire+6,los+5];577[asw+3,evasion+4,fire+6,los+5|accuracy+2,asw+3,evasion+4,fire+6,los+5]',
    source: 'wikiwiki.jp/kancolle「Walrus」装備ボーナス表（页面 Last-modified 2026-08-13）',
    jp: '1機目 Nelson・Rodney 火力+6 対潜+3 索敵+5 回避+4 命中+2',
    why:
      '上游把 命中+2 整栏漏了，其余四栏逐格无误；日文与 akashi 都有 命中+2，EO 一致。／修正已落 src/shared/fit-bonus-corrections.ts（4 格）' +
      '。',
    verdict: 'eo',
  },
  {
    equipId: 517,
    equipName: '逆探(E27)+22号対水上電探改四(後期調整型)',
    shipIds: [235, 470, 975, 981],
    fingerprint:
      '235[accuracy+1,evasion+1,los+1|accuracy+2,evasion+3,fire+1,los+2];470[accuracy+1,evasion+1,los+1|accuracy+2,evasion+3,fire+1,los+2];975[accuracy+1,evasion+1,los+1|accuracy+2,evasion+3,fire+1,los+2];981[accuracy+2,evasion+1,fire+1,los+1|accuracy+3,evasion+2,fire+2,los+1]',
    source:
      'wikiwiki.jp/kancolle「逆探(E27)＋22号対水上電探改四(後期調整型)」装備ボーナス表（页面 Last-modified 2026-07-27；页名全角「＋」，' +
      '取票脚本按 api 名的半角「+」取所以 404，2026-08-22 按站内真实页名补抓）',
    jp:
      '玉波改二・涼波改二・藤波改二・早波改二・浜波改二 火力+2 索敵+1 回避+2 命中+3／初霜改二・潮改二・響改・霞改二・時雨改三・春雨改二・雪風改二 火力+1 索敵+2 回避+3 命中+2／' +
      'その他の日本駆逐艦・海防艦(御蔵型を除く) 索敵+1 回避+1 命中+1（「艦名記載は、その値が適用される一番下の改造段階が基準」）',
    why:
      '四格都是分档缺失：響改(235)・霞改二乙(470，在霞改二之上按页首规则继承)・春雨改二(975) 应在「初霜改二…」那一档（火力1 索敵2 回避3 命中2）' +
      '，藤波改二(981) 应在「玉波改二…」那一档（火力2 索敵1 回避2 命中3），上游把前三个丢进了「その他の日本駆逐艦」最低档、把藤波改二丢进了「夕雲型」档。' +
      'EO 逐格与日文一致。／修正已落 src/shared/fit-bonus-corrections.ts（4 格）。',
    verdict: 'eo',
  },
  {
    equipId: 520,
    equipName: '試製20.3cm(4号)連装砲',
    shipIds: [265],
    fingerprint:
      '265[evasion+1,fire+2|accuracy+1,evasion+1,fire+3]',
    source: 'wikiwiki.jp/kancolle「試製20.3cm(4号)連装砲」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: '妙高型(妙高改二を除く)・高雄型(高雄改を除く) 火力+2 回避+1／妙高改二・高雄改・最上型・利根型 (1,4基目) 火力+3 回避+1 命中+1',
    why:
      '本方对：妙高改(265) 不是 妙高改二，吃「妙高型(妙高改二を除く)」的 火力+2 回避+1；akashi 同样把 妙高改二 与 妙高型 分开。EO 那边给 火力+3 命中+1，' +
      '是把 妙高改二 那档往链下扩了。／修正已落 src/shared/fit-bonus-corrections.ts（0 格）。／**无需修正**：日文一手逐格与本方相同，' +
      '记在这里是为了防止将来照「老源可信」把 EO 的数改回来。',
    verdict: 'ours',
  },
  {
    equipId: 529,
    equipName: '12.7cm連装砲C型改三H',
    shipIds: [43, 167, 228, 243, 320, 566, 567, 568, 670, 915, 951],
    fingerprint:
      '43[fire+1|evasion+2,fire+1];167[fire+2|evasion+2,fire+2];228[fire+2|evasion+2,fire+2];243[fire+1|evasion+2,fire+1];320[fire+2|evasion+2,fire+2];566[evasion+2,fire+3|accuracy+2,fire+3];567[evasion+2,fire+3|accuracy+2,fire+3];568[evasion+2,fire+3|accuracy+2,fire+3];670[evasion+2,fire+3|accuracy+2,fire+3];915[evasion+2,fire+3|accuracy+2,fire+3];951[evasion+2,fire+3|accuracy+2,fire+3]',
    source: 'wikiwiki.jp/kancolle「12.7cm連装砲C型改三H」装備ボーナス表（页面 Last-modified 2026-07-27）',
    jp: '雪風・磯風乙改 火力+2 回避+2／他陽炎型(秋雲含む) 火力+2／他白露型・朝潮型 火力+1（「艦名記載は、その値が適用される一番下の改造段階が基準」）',
    why:
      '这一件是**部分裁决**。日文表按「艦名記載は…一番下の改造段階が基準」读：雪風(20)→雪風改(228) 同属「雪風・磯風乙改」档 火力+2 回避+2，' +
      '所以 228 该有 回避+2（本方漏了，EO 对）；而 磯風(167)/磯風改(320) 在 磯風乙改 之下、只吃「他陽炎型」火力+2，時雨(43)/時雨改(243)' +
      ' 吃「他白露型」火力+1——这 4 格本方是对的，EO 那边多给了 回避+2。陽炎型改二那 6 格当初因日文页表格与脚注互相打架未裁，现已由用户实测定案（见文末）。／陽炎型改二 6 格：日文页**自相矛盾**。' +
      '単体ボーナス表 x1 行逐列读是「火力+3 命中+2」（回避列为空，与相邻的雪風改二丹陽行 火力+3 回避+2 命中+2 对照可确认列位没错），而同一行 累積「変動」挂的脚注 *12 却写「1基目が火力+3、' +
      '回避+2、2基目が火力+4」——把 +2 记在回避上。本方与脚注一致（fire3/evasion2），EO 与表格一致（fire3/accuracy2）' +
      '。同一页两处打架，分析段按纪律未裁。**2026-08-22 由用户游戏实测终审**：拿自己仓库里那门 ★+2 的 C型改三H 在装备更换画面看「変更後」预览卡，' +
      '绿箭头只出现在 火力+3 与 命中+2 两栏、回避一栏没有箭头 —— 表格侧成立，脚注 *12 的「回避+2」是日文页自己写错的孤票。' +
      '三票合流（游戏预览箭头 / 日文表格列位 / EO 独立编码），这 6 格改判 eo。修正已落 src/shared/fit-bonus-corrections.ts（第 69 条）。' +
      '见 arbitration/user-verdict-529.md。',
    verdict: 'eo',
  },
])

/**
 * **待裁清单**：对账逐格算出来、但还没有足够票据下结论的分歧，按装备聚成一条。
 *
 * 2026-08-22 清空：原来的 73 件里，有 10 件当初标成「没有日文票」其实是**页名半角/全角对不上**
 *（wikiwiki 的页名用全角 ＋ ／ ＆，api 名用半角 + / &），按站内真实页名补抓后 10 件全部拿到了逐格表；
 * 另有 5 件水上爆撃機（26 / 62 / 80 / 207 / 208）自身页确实没有小节，但日文一手把它们写成类目行
 *「水上爆撃機(その他日本)」，由同族装备页与舰娘页两处互证取到。逐格裁完后全部移进 KNOWN。
 *
 * 机制原样留着：下一轮对账冒出新的分歧，仍旧先落这里等取票，不许直接拍板。
 */
export const PENDING_FIT_BONUS_CONFLICTS = Object.freeze([])

/**
 * 一组冲突的稳定指纹：任一格的任一边改了数，指纹就变，台账那条随之作废。
 *
 * @param {{shipId: number, ours: Record<string, number>, eo: Record<string, number>}[]} rows
 */
export const fitBonusConflictFingerprint = (rows) => {
  const dump = (stats) =>
    Object.entries(stats ?? {})
      .filter(([, value]) => value !== 0)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, value]) => `${key}${value >= 0 ? '+' : ''}${value}`)
      .join(',')
  return [...(rows ?? [])]
    .sort((left, right) => left.shipId - right.shipId)
    .map((row) => `${row.shipId}[${dump(row.ours)}|${dump(row.eo)}]`)
    .join(';')
}

/** 待裁清单用的短摘要（FNV-1a 32 位）。只回答「变没变」，不用于人读。 */
export const fitBonusConflictDigest = (rows) => {
  const text = fitBonusConflictFingerprint(rows)
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}
