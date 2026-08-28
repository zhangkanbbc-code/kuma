// 出击识别札的**真名**表（第一方小表）。
//
// ## 为什么要有这张表
//
// 游戏只下发 `api_sally_area` 这个编号（1、2、3…），从不下发它叫什么。
// 而攻略与玩家口语里全是名字——「三一战队札」「多号作战部队札」「联合舰队札」。
// 面板里只写「札 4」，玩家还得回头对攻略表；写上名字，一眼就知道这支队是干嘛的。
//
// **这张表只做显示，不做判断。**「这支队能不能进那张图」拿不到判据（见 shared/sally-lock）。
//
// ## 维护方式（每期活动一次，第一方手录）
//
// 开服后查 kcwiki 的活动页（CC 许可基座），把「札号 → 名字」抄进来，
// 并按下面的「实证」流程把序号对上游戏实际下发的 `api_sally_area`。
// 没对上或证据不足的条目**宁缺毋滥**——不写，UI 自动回退成编号。
//
// ## 序号↔api 值的实证（62 区，2026-08-22 于账本上做）
//
// 账本（mg.sqlite）里 `api_get_member/ship_deck` 等报文逐条记着每艘在籍舰的
// `api_sally_area`；`api_req_map/start` 逐条记着「什么时候打了哪张图」。
// 把两条流水对起来，就能反推「这个编号是哪张图打上的」：
//
//   · 62 区五张图：E-1 九州沖/南西諸島沖、E-2 南沙諸島沖/オルモック沖/サンベルナルジノ海峡沖、
//     E-3 パラオ沖/ウルシ―泊地沖/中部太平洋（以上前段）、
//     E-4 地中海南仏沖/アルジェリア沖/イタリア半島沖、E-5 ブレスト沖/大西洋/イギリス本土沖/バルト海（后段）。
//   · 在籍舰的取值全集（取运行时域状态，非事件流水）：
//     1×21 · 2×15 · 3×1 · 4×17 · 5×1 · 6×2 · 7×5 · 8×11，未打札 359 艘。
//     **1–8 全部出现，9–13 一个没有**——后者对应的阶段这本账本的主人没打。
//   · **决定性样本**：事件流水里 9 次「0 → 有札」的转变，其窗口内唯一的活动出击
//     都是 **E-4**——其中 7 次拿到 8、2 次拿到 7（最窄窗口 4 分 32 秒）。
//     即 **札 7 与札 8 都出自 E-4 这张法国/地中海图**。
//   · 名单第 7、8 位正是「仏第3艦隊」「仏地中海艦隊」——与 E-4 的图名
//     （南仏沖／アルジェリア沖）严丝合缝。
//   · 证伪检验：名单若与 api 值有 ±1 偏移，第 7 位就会落到「第六艦隊」
//     （潜水舰队，题材属前段 E-3 的ウルシー/中部太平洋），与「札 7 出自 E-4」直接矛盾。
//     偏移由此被排除，**名单序号 = api_sally_area** 成立。
//   · 旁证：观测到的前段取值恰好是 1–6 六枚、无一枚 ≥7，而 E-4 只产出 7 与 8
//     ——与「前段 6 枚、后段自 7 起」这条分界完全吻合，无一处矛盾。
//   · 前段各枚取自哪张图无法逐图定位：那几张在本账本开始记录之前就通关了
//     （2026-08-03 的 mapinfo 里 E-1/E-2/E-3 已 state=2、E-4 血条 3206/5400 进行中）。
//
// 未观测到的编号（9–13）名字仍照名单落表：轴已经被 7/8 钉死，
// 这些是同一根轴上的相邻刻度，不是另立一说。

export interface SallyTagName {
  /** 活动区 id（api_maparea_id） */
  area: number
  /** 游戏下发的 api_sally_area 值 */
  tag: number
  /** 中文名（录自 kcwiki 活动页） */
  name: string
  /**
   * 日文原名（wikiwiki 活动页主表原名 / 档名转写，2026-08-26 逐格核对）。
   *
   * **不上屏**，是给维护者对攻略表用的：日站的表全按这个名字排，
   * 而中文名与它不是字面转换关系（仏第3艦隊 ↔ 法第3舰队）。
   * 三枚法/英札的原名在游戏里本来就是图片，这里录的是 wiki 的档名转写，
   * 拼写照源保留（`2-eme Escadre Leoele` 不是笔误，别「修正」）。
   */
  ja: string
  /** 前段 / 后段 */
  phase: 'front' | 'rear'
  /** 与史实编队库互链：shared/hist-fleets 的条目 id */
  fleetId?: string
}

export const SALLY_TAG_NAMES: readonly SallyTagName[] = [
  // ── 62 区「反撃！第三十一戦隊の戦い」(2026 年夏) ──
  // ⚠ 日名与中文名按**同一支部队**配对，不按两份名单的行号配对。
  // 2026-08-26 核对 wikiwiki 主表时发现：它把「第六艦隊」排在
  // 「ウルシー攻撃部隊」前面，与本表 5/6 两号的次序相反。号的归属由上面那段
  // 账本实证钉住（7/8 出自 E-4），这里不动；而这两枚在 shared/sally-rules 的
  // 每一行里都同进同出，谁是 5 谁是 6 不影响任何一处显示。留待实证再裁。
  { area: 62, tag: 1, ja: '第三十一戦隊', name: '第三十一战队', phase: 'front', fleetId: 'sq-31-e1' },
  { area: 62, tag: 2, ja: '増強第三十一戦隊', name: '增强第三十一战队', phase: 'front', fleetId: 'sq-31-e1' },
  { area: 62, tag: 3, ja: '多号作戦部隊', name: '多号作战部队', phase: 'front' },
  { area: 62, tag: 4, ja: '連合艦隊', name: '联合舰队', phase: 'front' },
  { area: 62, tag: 5, ja: 'ウルシー攻撃部隊', name: '乌利西攻击部队', phase: 'front' },
  { area: 62, tag: 6, ja: '第六艦隊', name: '第六舰队', phase: 'front', fleetId: 'fl-06' },
  { area: 62, tag: 7, ja: '仏第3艦隊', name: '法第3舰队', phase: 'rear' },
  { area: 62, tag: 8, ja: '仏地中海艦隊', name: '法地中海舰队', phase: 'rear' },
  { area: 62, tag: 9, ja: '2-eme Escadre Leoele', name: '第二轻型分舰队', phase: 'rear' },
  { area: 62, tag: 10, ja: 'イギリス救援艦隊', name: '不列颠救援舰队', phase: 'rear' },
  { area: 62, tag: 11, ja: 'Force de Raid', name: '突击舰队', phase: 'rear' },
  { area: 62, tag: 12, ja: 'Force H', name: 'H舰队', phase: 'rear' },
  { area: 62, tag: 13, ja: '欧州連合艦隊', name: '欧洲联合舰队', phase: 'rear' },
]

const KEY = (area: number, tag: number) => `${area}:${tag}`
const BY_KEY = new Map(SALLY_TAG_NAMES.map((entry) => [KEY(entry.area, entry.tag), entry]))

/** 查不到就返回 null——调用方回退成编号，别在这里编名字 */
export const sallyTagNameOf = (
  areaId: number | null | undefined,
  tag: number,
): SallyTagName | null => {
  if (!Number.isFinite(areaId) || !Number.isFinite(tag) || Number(tag) <= 0) return null
  return BY_KEY.get(KEY(Number(areaId), Number(tag))) ?? null
}

/**
 * 显示用短标签：有真名就用真名，没有就回退成「札 N」。
 * 编号本身仍然要留着——攻略表是按编号排的。
 */
export const sallyTagLabel = (areaId: number | null | undefined, tag: number): string =>
  sallyTagNameOf(areaId, tag)?.name ?? `札 ${tag}`
