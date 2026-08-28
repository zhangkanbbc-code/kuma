import { heardBgmNameOf, heardPortBgmNameOf } from './bgm-heard'

export type KcsBgmKind = 'port' | 'battle'

export interface KcsBgmCue {
  kind: KcsBgmKind
  id: number
  pathname: string
  ts: number
}

// 实际资源形状：
// /kcs2/resources/bgm/port/115_1441.mp3
// /kcs2/resources/bgm/battle/274_5423.mp3
// fanfare 是短暂结算音，不作为“正在播放的 BGM”。
export const parseKcsBgmPath = (
  pathname: string,
  ts = Date.now(),
): KcsBgmCue | null => {
  const matched =
    /^\/kcs2\/resources\/bgm\/(port|battle)\/(\d{3})_\d{4}\.mp3$/i.exec(pathname)
  if (!matched) return null
  const id = Number.parseInt(matched[2], 10)
  if (!Number.isInteger(id) || id < 0 || id > 999) return null
  return {
    kind: matched[1].toLowerCase() as KcsBgmKind,
    id,
    pathname,
    ts,
  }
}

/**
 * 主数据 `api_mst_bgm` 能给名字的资源号。
 *
 * **母港树的号与主数据号是同一套**（实测 port/115 = 主数据 115「雨とお酒と艦娘」），
 * 所以母港曲直查即可。
 *
 * **战斗树是另一套编号，主数据一个也给不了**——这不是「缺项」，是两套号互不通用，
 * 拿主数据的名字去安战斗曲的头上就是张冠李戴（bgm-preview.ts 顶部记的那次实测：
 * 1-1 昼战放的是 battle/118，而主数据 118 是母港曲「鎮守府の秋祭り」）。
 * 2026-08-24 用 zh.kcwiki 拆包表逐号核完，此前那套「战斗号 = 主数据号 − 200」的
 * 启发式**没有一个号对得上**（66 个可比号里 0 中；battle/6 会被读成「明石の工廠」，
 * 实际是「我、敵機動部隊ト交戦ス」）；「≥200 直查」同样错位（battle/229 是 2023 夏
 * 活动的「抜錨！鵜来型海防艦」，主数据 229 是「提督と艦娘の食卓」——同一首曲后来
 * 进留声机时另给了主数据号 275）。故此处对战斗树一律不给候选，曲名改走誊写层。
 */
export const bgmMasterCandidates = (
  kind: KcsBgmKind,
  resourceId: number,
): number[] => (kind === 'port' && resourceId > 0 ? [resourceId] : [])

/** 战斗曲曲名表（矿脉包 `kcwiki-bgm` 的 data，按战斗树资源号直查） */
export interface KcsBgmNames {
  battle?: Record<string, string> | null
}

/**
 * **母港曲的本地补名表**（2026-08-27 起）。
 *
 * 与耳测母港层（`bgm-heard` 的 `HEARD_PORT_BGM_NAMES`）是**两类证据，不是一层的两半**——
 * 分开放不是洁癖，是那一层的全部价值就在「收的都是官方确有其名的曲子」：
 *  · 耳测母港层：官方确有其名，由提督实听认出来是哪一首，名字用日文官方原文；
 *  · 这一张：官方**根本没给过名字**，名字由用户自己起，本仓自造。
 * 混进耳测层就等于让那张表替一个不存在的官方曲名背书，所以另立一张。
 * 也正因为它不冒充官方曲名，**不进 OST 字形总校**——拿官方曲目表去校一个
 * 非官方的名字，校出来的差异没有任何意义（两字名撞距离尤其如此，见 `北鎮` 那条裁定）。
 *
 * **132 号**：本机 api_start2 快照的 `api_mst_bgm` 共 128 条，**132 号缺席**
 *（128/129/130/131/136 都在，132–135 全无；2026-08-27 实证）。它是活动「选择奖励」
 * 界面放的那首母港曲，属耳测母港层表头讲的第①类「画面主题曲」：设不成母港曲、
 * 不上蓄音机，官方永远不发名字。用户 2026-08-27 耳测后拍板叫「获取」。
 *
 * **让位规则**：排在主数据与耳测母港层之后。官方将来若给出该号曲名，
 * 以官方为准自动顶掉本地名，这里一行都不用改（护栏盯着这件事）。
 * 另注：主数据落库时按 `name !== '-'` 滤掉了官方占位名（见 main/mg/store.ts），
 * 所以官方哪天发的若是占位的「-」，仍会落到本地名——这正是想要的。
 */
export const LOCAL_PORT_BGM_NAMES: Record<number, string> = { 132: '获取' }

/**
 * 官方曲名。查不到返回 null——**绝不编、绝不跨树借名**。
 *
 * 两棵树各管各的编号空间，不存在「谁盖谁」；每棵树内部再分层：
 *
 * **母港树**
 *  ① 游戏一手（`api_mst_bgm`，永远优先）；
 *  ② 第一方耳测母港层（`shared/bgm-heard` 的 `HEARD_PORT_BGM_NAMES`）；
 *  ③ 本地补名（上面的 `LOCAL_PORT_BGM_NAMES`）——官方连名字都没有的那几个号，
 *    用户自己起的名。排最后，前两层任一有话说都轮不到它。
 *
 * 母港树本来该①一层包干，可有一类号**结构性地不在主数据里**：画面主题曲
 *（出击选择、编成等 UI 场景曲）设不成母港曲、不上蓄音机，官方永远不给名。
 * ②就是为这一类开的口子——**只补①查不到的号**，①哪天收了就当场让位。
 *
 * **战斗树**
 *  ① 誊写层（矿脉包 `kcwiki-bgm`，按游戏原文件名键入）；
 *  ② 第一方耳测战斗层（提督亲耳确认）。
 *
 * 誊写层在耳测层之前不是不信人，是它的键是游戏自己的文件名、中间没有人的判断。
 * 两层真撞上时**不静默覆盖**——护栏盯着「零重叠」，撞上了当场红、挂出来单独裁。
 *
 * 主数据在母港耳测层之前则是另一回事：那是**同一棵树上的同一个号**，
 * 谁在前就是谁说了算，所以护栏钉的是「主数据有名时耳测层不越位」。
 */
export const bgmSongName = (
  kind: KcsBgmKind,
  resourceId: number,
  master?: Record<number, string> | null,
  names?: KcsBgmNames | null,
): string | null => {
  for (const id of bgmMasterCandidates(kind, resourceId)) {
    const name = master?.[id]
    if (name) return name
  }
  if (kind === 'port') {
    const heard = heardPortBgmNameOf(resourceId)
    if (heard) return heard
    const local = LOCAL_PORT_BGM_NAMES[resourceId]
    if (local) return local
  }
  if (kind === 'battle') {
    const transcribed = names?.battle?.[`${resourceId}`]
    if (transcribed) return transcribed
    const heard = heardBgmNameOf(resourceId)
    if (heard) return heard
  }
  return null
}
