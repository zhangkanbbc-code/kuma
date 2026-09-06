// 游戏页面加载哪一条网址：默认值、判据与回落。
//
// 这一格玩家能在钥里改（poi 同款，地址栏摆进设置）。要害是**写坏了不能让游戏页打不开**：
// 那是个自由文本框，粘进半截主机名、连着引号一起粘、或者顺手清空都会发生，
// 而那一刻的表现只是整块游戏区白着——玩家看不出是自己刚才那一下造成的。
// 所以判据只有这一份：config 的默认值、渲染层装 webview、游戏页 preload 认宿主，
// 以及护栏，全引它。
//
// 只收 http / https。webview 的 src 连 file: / data: / javascript: 一起认，
// 而它进的是一个开了 disablewebsecurity、挂着特权 preload 的容器。

/**
 * 配置键。**沿用早就在用的那一个**，不另起 `kuma.game.url` 之类的新名字——
 * 它已经有四个消费方（config 默认值、渲染层、cookie-hack、webview-preload），
 * 换名字就要在「新键为空时读旧键」上再长一层，而这一格本来就只有一条值。
 */
export const GAME_URL_CONFIG_KEY = 'kuma.homepage'

/** DMM 的舰C页面。「恢复默认」按回来的、以及所有回落落到的都是它。 */
export const DEFAULT_GAME_URL = 'https://play.games.dmm.com/game/kancolle'

/**
 * 这一条能不能拿去加载。非字符串、空、解析不出、协议不是 http/https 一律不能。
 *
 * `new URL` 抛出来就是「解析不出」——这里的 catch 是判据本身的一半，
 * 不是把异常吞掉。
 */
export const isValidGameUrl = (raw: unknown): raw is string => {
  if (typeof raw !== 'string') return false
  const text = raw.trim()
  if (!text) return false
  try {
    const { protocol } = new URL(text)
    return protocol === 'http:' || protocol === 'https:'
  } catch (_e) {
    return false
  }
}

/** 真正要加载的那一条：配置里那份认得出就用它，认不出（含空、含没配过）回默认。 */
export const normalizeGameUrl = (raw: unknown): string =>
  isValidGameUrl(raw) ? raw.trim() : DEFAULT_GAME_URL
