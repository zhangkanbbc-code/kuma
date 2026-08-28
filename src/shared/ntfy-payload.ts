// ntfy 的载荷构造。**安卓那一侧的默认目标**（Bark 是 iOS 专用的，安卓装不了）。
// 纯函数 + node crypto（只为生成频道名），只在主进程被 require。
//
// ── 协议核实（2026-08-20 实读官方文档与服务端源码，不凭记忆写）──
//
// ① 基本形态 —— https://docs.ntfy.sh/publish/
//    （原始 markdown：github.com/binwiederhier/ntfy `docs/publish.md`）
//    POST（或 PUT）到 `https://<服务器>/<频道名>`，**请求体就是正文**。
//    标题等参数走请求头，参数名**大小写不敏感**；文档「List of all parameters」
//    给的规范名与别名：`X-Title`（别名 `Title`、`t`）、`X-Priority`
//    （别名 `Priority`、`prio`、`p`）、`X-Tags`、`X-Markdown`、`Authorization`……
//    优先级取值 1=min / 2=low / 3=default / 4=high / 5=max(urgent)。
//    艦素一律用 `X-` 规范名：服务端 readParam 按 `x-title, title, t` 顺序取，
//    `X-` 那个排第一；而裸 `Priority` 还会撞上 RFC 9218 那个同名头——
//    ntfy 的 maybeIgnoreSpecialHeader 专门把 Cloudflare 加的 `Priority: u=3, i`
//    忽略掉（server/util.go），用 `X-Priority` 完全绕开这摊事。
//
// ② 非 ASCII 标题 —— **这一条是必须的，不是可选优化**。
//    文档原话：ntfy 支持 UTF-8 的 HTTP 头，但 "not every library or programming
//    language does"，并给出：可以把任意头（含标题）按 RFC 2047 编码，
//    形如 `=?UTF-8?B?8J+HqfCfh6o=?=`（base64）或 `=?UTF-8?Q?=C3=84pfel?=`。
//    实测（node v24 / undici）：`new Headers({ Title: '远征 21 返港' })` 直接抛
//    TypeError —— "Cannot convert argument to a ByteString because the character
//    at index 0 has a value of 36828 which is greater than 255"。艦素的标题**全是中文**，
//    所以不编码就等于一条也发不出去（还是在进程内就炸，连请求都没发）。
//    服务端侧也已确认收得回来：server/util.go 的 maybeDecodeHeader 对每个
//    参数头都跑一遍 Go 的 `mime.WordDecoder.DecodeHeader`，解不开才退回原文。
//
// ③ 频道名即口令 —— 文档「Picking a topic」原话：
//    "Since there is no sign-up, **the topic is essentially a password**, so pick
//    something that's not easily guessable."，且限定字符集 `[-_A-Za-z0-9]`、最长 64。
//    所以这里的「生成频道名」给的是 24 位随机串，而不是让人自己起个 kanso-alerts。
//
// ④ 访问令牌 —— 文档「Access tokens」：`Authorization: Bearer tk_xxx`
//    （自架并开了鉴权时才需要；公共服务器上的公开频道不需要）。
//
// ⑤ 空正文 —— JSON 字段表写着 message「set to `triggered` if empty or not passed」。
//    所以「只推标题」不能真给空串，占位与 Bark 侧共用 PUSH_PLACEHOLDER_BODY。
import {
  NTFY_TOPIC_LENGTH,
  PUSH_PLACEHOLDER_BODY,
  type PushRequest,
} from './push-config'
import { randomPushToken } from './push-payload'

export interface NtfyNotification {
  title: string
  body: string
}

export interface NtfyRequestOptions {
  /** 已归一化的服务器地址（checkNtfyServer 的产物），不带末尾斜杠 */
  server: string
  /** 已校验的频道名（checkNtfyTopic 的产物） */
  topic: string
  /** 自架且开了鉴权时才需要；空 = 不带 Authorization 头 */
  token?: string | null
  /** 只推标题：正文不出本机 */
  titleOnly: boolean
  /** 1–5，默认 3。艦素一律用 3：默认开的都是「时刻」，不是急事，不该震到底 */
  priority?: number
}

/** ntfy 的默认优先级（1=min … 3=default … 5=max） */
export const NTFY_DEFAULT_PRIORITY = 3

/** 生成一个「猜不动」的频道名——它就是口令 */
export const generateNtfyTopic = (): string => randomPushToken(NTFY_TOPIC_LENGTH)

/**
 * HTTP 头只装得下 ByteString。可打印 ASCII 原样发（自架服务端的访问日志里
 * 一眼能读），其余一律按 RFC 2047 的 base64 encoded-word 走。
 */
export const isAsciiHeaderSafe = (value: string): boolean =>
  // 排除控制字符与 CR/LF（头注入），也排除任何 >0x7E 的字符
  /^[\x20-\x7E]*$/.test(value)

export const encodeNtfyHeader = (value: string): string =>
  isAsciiHeaderSafe(value) ? value : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`

/** 令牌只能是 ASCII（ntfy 的 tk_ 前缀令牌本来就是）；否则连头都组装不出来 */
export const isValidNtfyToken = (token: unknown): token is string =>
  typeof token === 'string' && token.length > 0 && isAsciiHeaderSafe(token)

export const NTFY_TOKEN_ERROR = 'ntfy 访问令牌只能包含 ASCII 字符（形如 tk_xxxxxxxx）'

/**
 * 待 POST 的请求。正文进 body，标题进 X-Title（中文一律 RFC 2047 编码）。
 * ntfy 没有端到端加密：**只推标题**是这一侧唯一的内容保护，所以它必须
 * 在构造这一步就生效——不是发出去之后再由谁去截。
 */
export const buildNtfyRequest = (
  notification: NtfyNotification,
  options: NtfyRequestOptions,
): PushRequest => {
  const body =
    options.titleOnly || !notification.body ? PUSH_PLACEHOLDER_BODY : notification.body
  const headers: Record<string, string> = {
    // 正文是纯文本；给 text/markdown 才会开 Markdown 渲染，这里不要
    'content-type': 'text/plain; charset=utf-8',
    'x-title': encodeNtfyHeader(notification.title),
    'x-priority': `${options.priority ?? NTFY_DEFAULT_PRIORITY}`,
  }
  const token = `${options.token ?? ''}`.trim()
  if (token) {
    if (!isValidNtfyToken(token)) throw new Error(NTFY_TOKEN_ERROR)
    headers.authorization = `Bearer ${token}`
  }
  return { url: `${options.server}/${options.topic}`, headers, body }
}
