// 活动攻略页地址的第一方台账，**按活动区 id 记**。
//
// ---- 为什么需要它 ----
// 札提示里那句「能不能进请对照攻略表」要一个地址。地址本来该从矿脉包现取，
// 可 `map-intel`（唯一收活动图的那个包）**永不随包**——wikiwiki 内容条款不允许
// 再分发，`scripts/lode-sources.json` 里钉着 `bundle: false`。于是玩家那份产物里
// `mapIntelEntries()` 一条活动图都没有，光靠包会让那句话整段消失。
// （维护者机器上有那个包，两边看到的东西不该不一样，所以这张表排在包前面。）
//
// ---- 为什么按区 id 记，而不是「当前活动」 ----
// 区 id 是游戏一手的，每期活动都换一个新号。所以这张表**天然不会把上期的地址
// 泄漏给下期**：没录的那期就是没有链接，而不是指着上期的页面说「照这个打」。
// 原先 ru.ts 里那个写死的常量正是栽在这上面——它不认区号，换期照样输出。
//
// 加新一期就在下面补一行。**补错了不如不补**：宁可没有链接。
//
// ---- 许可 ----
// 这是第一方自补层（定位同 `map-drop-windows` / `kanso-voice`）：内容是「哪一期
// 活动的攻略页在哪」这一条事实，不是转载 wiki 的正文，可入仓可随包。

/** 活动区 id → 攻略页地址。查不到返回 undefined，调用方整句不出。 */
export const EVENT_GUIDE_URLS: Record<number, string> = {
  // 62：2026 夏 ·「反撃！第三十一戦隊の戦い」
  62: 'https://zh.kcwiki.cn/wiki/2026年夏季活动',
}

export const eventGuideUrlOf = (areaId: number): string | null =>
  EVENT_GUIDE_URLS[areaId] ?? null
