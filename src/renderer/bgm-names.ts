// BGM 曲名的**唯一收口**：顶栏「正在播放」与海域/家具的 ♪ 试听词条共用这一份。
// 判据全在 shared/kcs-bgm.ts 的纯函数里（母港曲走游戏一手、战斗曲走誊写层、
// 两套编号互不通用），这里只负责把矿脉包拉进来并缓存。
//
// 从前两处各写各的：顶栏拿主数据号硬套战斗号（张冠李戴），试听词条则干脆不给
// 战斗曲名字。2026-08-24 合并成一处，两边同时拿到真曲名。
// **兜底文案仍由各自决定**（顶栏要「战斗 BGM #274」，♪ 词条只写「#274」），
// 所以这里只回答「查到了没有」，不替调用方拼兜底。
import { mg, queryLode } from './kernel'
import { bgmSongName, type KcsBgmKind, type KcsBgmNames } from '../shared/kcs-bgm'

let names: KcsBgmNames | null = null
let asked = false
let settled = false
// 拉取在途时各处传进来的回调都要叫到：顶栏先问了，海域卷的 BGM 总表也得在曲名到货后重画
const waiters: (() => void)[] = []

/** 按需拉一次曲名表。拉到之前一律显示编号，拉失败也只是继续显示编号。 */
export const ensureBgmNames = (onReady?: () => void) => {
  if (onReady && !settled && !waiters.includes(onReady)) waiters.push(onReady)
  if (asked) return
  asked = true
  void queryLode('kcwiki-bgm').then((lode) => {
    settled = true
    const pending = waiters.splice(0)
    const battle = (lode?.data as KcsBgmNames | undefined)?.battle
    if (!battle || !Object.keys(battle).length) return
    names = { battle }
    for (const cb of pending) cb()
  })
}

/** 曲名表里收了名字的战斗树号（誊写层），给 BGM 总表搜「没有图在用」的曲子 */
export const namedBattleBgmIds = (): number[] =>
  Object.keys(names?.battle ?? {})
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0)

/** 官方曲名，查不到给 null。同步取当前已加载的那份，不触发拉取。 */
export const bgmNameOf = (kind: KcsBgmKind, resourceId: number): string | null =>
  bgmSongName(kind, resourceId, mg.master.bgms, names)
