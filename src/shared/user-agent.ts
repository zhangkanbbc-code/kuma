// 发给站点的 User-Agent 长什么样。
//
// Electron 拼出来的 UA 里夹着两段只有我们自己有的东西：`Electron/43.2.0`，
// 以及按 productName 来的 `kuma/1.0.0-beta.1`。DMM 会看 UA，带着这两段
// 在它那儿就是台没见过的浏览器；应用名那一段还顺带告诉了对面
// 「这台机器上装了什么工具」。poi 也是同一手法（views/kan-game-wrapper.tsx）。
//
// **判据只有这一份**：游戏 webview 与浏览窗都引它。
// 各写各的正则是这条曾经空转的原因——原先游戏页那份找的是改名前的应用名，
// 2026-08-28 改名 kuma 之后它一个字都没再匹配上，而这种失效不报错：
// UA 照发，只是多带了应用名和版本号出去，谁也不会发现。
const NOISE = /\s?(?:Electron|kuma)\/\S+/gi

/** 把上面那几段去掉。传进来的是 `navigator.userAgent`，返回真正要发出去的那条。 */
export const cleanUserAgent = (raw: string): string => raw.replace(NOISE, '')
