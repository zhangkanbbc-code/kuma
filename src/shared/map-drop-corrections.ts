// 常规图掉落里**指错形态**的号，逐条改钉（第一方台账）。
//
// 与 kcwiki 侧的「别名表」管的不是一回事：
//   · 别名表（scripts/lib/map-drops.mjs 的 KCWIKI_DROP_NAME_ALIASES）管
//     「kcwiki 掉落表那个**写法**指哪个号」；
//   · 这里管「现包（wikiwiki 系既有条目）那一票**记错了形态**」。
//
// 两边都得改，而且**同一张表**要被三处共用，否则就会各走各的：
//   ① 汇编时（scripts/lib/map-drops.mjs）把现包票的号改钉；
//   ② 出包的迁移护栏（scripts/fetch-lodes.mjs）比对时按改钉后的号看「有没有丢」；
//   ③ 运行时叠加（shared/map-intel.ts 的 overlayDrops）把**底座那一条的限定期窗口**
//      过继给新号——这一处最容易漏：漏了不报错，只是「宗谷只在限定期掉」这句话
//      悄悄消失，玩家会照着一张没有时限的名单去捞一条平时根本不掉的船。
//
// 这个文件**不 import 任何东西**，好让维护者脚本与运行时都能直接读它。

export interface MapDropFormCorrection {
  /** 现包记着的（错的）形态 mstId */
  from: number
  /** 应该是的那个形态 mstId */
  to: number
  /** 给人读的锚 */
  name: string
  decidedAt: string
  why: string
}

export const LEGACY_DROP_FORM_CORRECTIONS: readonly MapDropFormCorrection[] = Object.freeze([
  {
    from: 645,
    to: 699,
    name: '宗谷',
    decidedAt: '2026-08-22',
    why:
      '三个形态同名：699 宗谷(特務艦) / 645 宗谷(灯台補給) / 650 宗谷(南極観測)。' +
      '**改造后的形态不掉落**——这是本项目一贯的口径（鉴的掉点卷也按它把改造形态回退到未改造形态）。' +
      'kcwiki 舰娘页的 `获得.改造` 逐条可查：699 是 0（链首，不由改造得来），645 与 650 都是 1（改造而来）。' +
      '所以掉落表写「宗谷」只可能指 699。现包在 1-4/L 等 6 个点写的 645 是上游错值。' +
      '用户 2026-08-22 依 kcwiki 舰娘页裁定改钉 699。',
  },
])

const byFrom = new Map(LEGACY_DROP_FORM_CORRECTIONS.map((one) => [one.from, one.to]))

/** 把现包那一票里记错形态的号改钉过来。不认得的原样返回。 */
export const correctLegacyDropForm = (mstId: number): number =>
  byFrom.get(Number(mstId)) ?? Number(mstId)
