// 陆航中队名：分辨「玩家自己起的名字」与「游戏的默认名」。
//
// 玩家起的名字**不翻译、不改**（那是 UGC）。但游戏默认发的是日文「第N基地航空隊」，
// 而两个模块的抬头左边刚写完中文——锐是「第N航空队」、铎是「第N中队」——右边紧跟
// 这串日文，一行里两种语言说同一件事（2026-08-25 汉化清点）。舰队名那侧
// `fleetLabel()` 早有 `^第N艦隊$` 的默认名过滤，陆航这侧一直没有。
//
// 判定放在 shared 而不是各模块自己写一份：两处一旦漂移，症状是同一支中队在锐里
// 干净、在铎里带着日文尾巴，而两边都「看起来对」。各模块的 canonical 措辞不同，
// 所以这里只出「这名字是不是玩家起的」这一个判断，抬头文字仍归各模块。

/** 中队的自定义名；没起过名（或就是游戏默认的日文名）时返回 null。 */
export const airBaseCustomName = (squad: {
  name?: string | null
  rid: number
}): string | null => {
  const name = `${squad.name ?? ''}`.trim()
  if (!name) return null
  return new RegExp(`^第${squad.rid}基地航空隊$`).test(name) ? null : name
}
