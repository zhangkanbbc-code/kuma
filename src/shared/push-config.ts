// 手机推送的配置口径与地址/频道校验。**纯逻辑，不碰任何 node 内建**——
// 渲染层（钥的配置卡）也要 import 它，而渲染层打包目标是 browser，
// 出现 crypto/fs 之类会让 esbuild 当场解析失败。
// 载荷构造在 ntfy-payload.ts / push-payload.ts，出网在 main/push.ts，
// 那三处只跑在主进程。
//
// 两种目标（provider）：
// - **ntfy**（默认）：安卓上能收即时推送，服务器可自架。没有端到端加密，
//   它的隐私依托是「频道名即口令」+「只推标题」。
// - **bark**：iOS 专用（走苹果 APNs），有端到端加密。安卓装不了 Bark，
//   所以它不是默认项——用 iPhone 的人手动切过去。
//
// 纪律：默认全关；地址、频道名、密钥都只存在本机 config.json 里。
// 另有一道**在场门槛**（presence*）：人还在电脑前时不推，离开后由铃补发。
// 判据是全系统键鼠空闲时间，读取只在主进程，比较口径只有 shouldHoldForPresence 一处。

export const PUSH_PROVIDERS = ['ntfy', 'bark'] as const
export type PushProvider = (typeof PUSH_PROVIDERS)[number]

/**
 * 全部叶子路径。**读写一律走叶子**，不许 `config.get('kanso.push')` 或
 * `config.get('kanso.push.ntfy')` 整对象读：config 的 setByPath 写叶子时会把
 * 父对象就地变成「只有这一个键」的半份对象，整对象读到那份半份就不再回落
 * 默认值（代理面板栽过一次：改完主机后端口框空了，而主进程按叶子读到的仍是
 * 旧值，显示与生效值从此对不上）。
 */
export const PUSH_CONFIG_PATHS = {
  enabled: 'kanso.push.enabled',
  provider: 'kanso.push.provider',
  titleOnly: 'kanso.push.titleOnly',
  ntfyServer: 'kanso.push.ntfy.server',
  ntfyTopic: 'kanso.push.ntfy.topic',
  ntfyToken: 'kanso.push.ntfy.token',
  barkEndpoint: 'kanso.push.bark.endpoint',
  barkEncrypt: 'kanso.push.bark.encrypt',
  barkKey: 'kanso.push.bark.key',
  presenceHold: 'kanso.push.presence.hold',
  presenceIdleMinutes: 'kanso.push.presence.idleMinutes',
} as const

export type PushConfigField = keyof typeof PUSH_CONFIG_PATHS

/**
 * ntfy 服务器**没有默认值**——空串。
 *
 * 2026-08-23 撤掉原来的 `https://ntfy.sh` 预置。艦素不替玩家挑第三方主机：
 * 推送是全程唯一一条会打到非游戏服务器的出网路径，预置一个地址等于替他决定了
 * 「东西发给谁」。留空的后果是明确的——`checkNtfyServer('')` 判「还没填」，
 * 一个请求都不会发（main/push 的 `prepareNtfy` 拿不到 value 就直接不推）。
 *
 * 输入框里那句示例（`NTFY_SERVER_PLACEHOLDER`）是 placeholder，不是值：
 * 它进不了配置，也进不了任何一次请求，玩家不亲手填就永远没有目标。
 */
export const NTFY_DEFAULT_SERVER = ''

/**
 * 服务器输入框的示例文本。
 *
 * 只写到**服务器**——`checkNtfyServer` 会把 `https://ntfy.sh/我的频道` 判成错
 *（频道名是另一格），示例要是把那个错法演示一遍就成了帮倒忙。
 */
export const NTFY_SERVER_PLACEHOLDER = '例：https://ntfy.sh；自建服务请填写对应地址'

/**
 * 在场门槛的空闲分钟数区间。下限 1 分：再短就会在打字的换行间隙里判成「离开」；
 * 上限 30 分：超过这个数，等门槛跨过来时那条「几点该回来」早已经过期，
 * 补发只剩考古价值。界面上的 min/max 与这里同源，别再各写一个数。
 */
export const PUSH_IDLE_MINUTES_MIN = 1
export const PUSH_IDLE_MINUTES_MAX = 30

/**
 * 默认值只写在这里一处（config.ts 的 DEFAULTS 里没有 kanso.push.*，
 * 各处 config.get 都得自带 fallback——两处各写一份就会分家）。
 *
 * enabled 默认关：推送是唯一的主动出网动作，必须由用户亲手打开且亲手填地址。
 * provider 默认 ntfy：安卓收得到；Bark 只有 iOS 装得了。
 * titleOnly / barkEncrypt 默认开：开着的那一档才是更少泄露的那一档。
 * presenceHold 默认开：整列推送本来就要用户亲手打开，开的人要的是「人不在时提醒」；
 *   坐在电脑前时同一件事已经有 Toast/横幅说过一遍，手机再响一声是纯噪音。
 */
export const PUSH_DEFAULTS = {
  enabled: false,
  provider: 'ntfy' as PushProvider,
  titleOnly: true,
  ntfyServer: NTFY_DEFAULT_SERVER,
  ntfyTopic: '',
  ntfyToken: '',
  barkEndpoint: '',
  barkEncrypt: true,
  barkKey: '',
  presenceHold: true,
  presenceIdleMinutes: 3,
} as const

export interface PushSettings {
  enabled: boolean
  provider: PushProvider
  titleOnly: boolean
  ntfyServer: string
  ntfyTopic: string
  ntfyToken: string
  barkEndpoint: string
  barkEncrypt: boolean
  barkKey: string
  /** 「人在电脑前就先不推」的总开关 */
  presenceHold: boolean
  /** 键鼠空闲多少**分钟**算离开（1–30） */
  presenceIdleMinutes: number
}

/**
 * 分钟数落进 1–30。读不出数（空框、null、文字）一律回默认值，
 * **不许 clamp 成 0**：0 分钟意味着门槛永远不成立，等于把功能悄悄关掉。
 */
export const clampPushIdleMinutes = (value: unknown): number => {
  const raw = typeof value === 'string' ? value.trim() : value
  // 空框要和「没填」同义：Number('') 是 0，直接 clamp 会把它变成 1 分钟——
  // 用户清空输入框的意思是「回默认」，不是「改成最短」。
  const minutes = Math.round(Number(raw === '' || raw == null ? Number.NaN : raw))
  if (!Number.isFinite(minutes)) return PUSH_DEFAULTS.presenceIdleMinutes
  return Math.max(PUSH_IDLE_MINUTES_MIN, Math.min(PUSH_IDLE_MINUTES_MAX, minutes))
}

/**
 * 在场判定。**唯一一处**把空闲时间与阈值放在一起比的地方（主进程发送前调它，
 * 铃那边只用它决定要不要试一次补发）。
 *
 * `idleSeconds` 是全系统键鼠空闲**秒数**（powerMonitor.getSystemIdleTime()），
 * 而阈值配置的单位是**分钟**——两边差 60 倍，换算只在这一行里做。
 *
 * 两个方向都定死：
 * - 门槛关着 → 永远返回 false，行为与没有这个功能时逐字一致；
 * - 空闲时间读不出来（NaN / 负数）→ 也返回 false，即照常推送。门槛失灵的方向
 *   必须是「照发」，压着不发等于把用户唯一要的那条提醒静默丢掉。
 */
export const shouldHoldForPresence = (
  settings: Pick<PushSettings, 'presenceHold' | 'presenceIdleMinutes'>,
  idleSeconds: unknown,
): boolean => {
  if (!settings.presenceHold) return false
  // 只认真正的数字：`Number(null)` 是 0，一路走下去会把「读不出来」当成
  // 「空闲 0 秒 = 人就在跟前」，于是永远暂缓——恰是最坏的那个方向。
  const seconds = typeof idleSeconds === 'number' ? idleSeconds : Number.NaN
  if (!Number.isFinite(seconds) || seconds < 0) return false
  return seconds < clampPushIdleMinutes(settings.presenceIdleMinutes) * 60
}

/** config.get 的形状（主进程直接给 config，渲染层给 remote 拿到的那份） */
export type PushConfigReader = (path: string, fallback: unknown) => unknown

const text = (value: unknown, fallback: string): string => {
  const out = `${value ?? ''}`.trim()
  return out || fallback
}

/** 只用上面那些叶子路径读，别处不要再手写这些字符串 */
export const readPushSettings = (get: PushConfigReader): PushSettings => {
  const provider = `${get(PUSH_CONFIG_PATHS.provider, PUSH_DEFAULTS.provider) ?? ''}`
  return {
    enabled: get(PUSH_CONFIG_PATHS.enabled, PUSH_DEFAULTS.enabled) === true,
    // 认不出的值一律退回默认，不要拿一个不存在的目标去分发
    provider: (PUSH_PROVIDERS as readonly string[]).includes(provider)
      ? (provider as PushProvider)
      : PUSH_DEFAULTS.provider,
    titleOnly: get(PUSH_CONFIG_PATHS.titleOnly, PUSH_DEFAULTS.titleOnly) !== false,
    // 服务器留空就是**没配**（没有默认目标了，见 NTFY_DEFAULT_SERVER）。
    // 早先存过 `https://ntfy.sh` 的配置照旧读出那一份——撤的是预置，不是别人填过的值。
    ntfyServer: text(get(PUSH_CONFIG_PATHS.ntfyServer, PUSH_DEFAULTS.ntfyServer), NTFY_DEFAULT_SERVER),
    ntfyTopic: `${get(PUSH_CONFIG_PATHS.ntfyTopic, PUSH_DEFAULTS.ntfyTopic) ?? ''}`.trim(),
    ntfyToken: `${get(PUSH_CONFIG_PATHS.ntfyToken, PUSH_DEFAULTS.ntfyToken) ?? ''}`.trim(),
    barkEndpoint: `${get(PUSH_CONFIG_PATHS.barkEndpoint, PUSH_DEFAULTS.barkEndpoint) ?? ''}`.trim(),
    barkEncrypt: get(PUSH_CONFIG_PATHS.barkEncrypt, PUSH_DEFAULTS.barkEncrypt) !== false,
    barkKey: `${get(PUSH_CONFIG_PATHS.barkKey, PUSH_DEFAULTS.barkKey) ?? ''}`.trim(),
    // 默认开的项一律用 `!== false` 读：缺键、读不出来都保持开着
    presenceHold: get(PUSH_CONFIG_PATHS.presenceHold, PUSH_DEFAULTS.presenceHold) !== false,
    presenceIdleMinutes: clampPushIdleMinutes(
      get(PUSH_CONFIG_PATHS.presenceIdleMinutes, PUSH_DEFAULTS.presenceIdleMinutes),
    ),
  }
}

/** 两种目标构造出来的请求最终长一个样，main/push.ts 只认这一种形状去发 */
export interface PushRequest {
  url: string
  headers: Record<string, string>
  body: string
}

// ---- 密钥、IV 与频道名 ----

/** AES-128：官方文档写「Must be 16 bit long」，实际是 16 **字节** */
export const PUSH_KEY_LENGTH = 16
/** CBC 的 IV 与分组等长；Bark 把 iv 参数当原文收，所以也是 16 个 ASCII 字符 */
export const PUSH_IV_LENGTH = 16
/**
 * 生成的 ntfy 频道名长度。ntfy 没有注册、没有鉴权（默认公共服务器上），
 * **频道名本身就是口令**，谁猜到谁就能收到、也能往里发。官方文档原话是
 * "the topic is essentially a password, so pick something that's not easily
 * guessable"。24 位 × 56 字母表 ≈ 139 bit，猜不动。
 */
export const NTFY_TOPIC_LENGTH = 24
/** 低于这个长度只给提示不拦——用户可能要接管一个已有频道 */
export const NTFY_TOPIC_WEAK_LENGTH = 16
/** ntfy 官方限制：频道名只能是 [-_A-Za-z0-9]，最长 64 */
export const NTFY_TOPIC_MAX = 64

/**
 * 生成密钥/频道名用的字母表。去掉了 0/O、1/l/I 这几组抄错率高的字符——
 * 这两样都要用户肉眼抄进手机，抄错的代价是「明明发出去了却收不到」。
 * 56 个字符，且整体是 ntfy 允许的 [-_A-Za-z0-9] 的子集。
 */
export const PUSH_TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'

/** UTF-8 字节数。16 个汉字是 48 字节，长度看着对、AES 一样不收 */
export const utf8ByteLength = (value: string): number => new TextEncoder().encode(value).length

export const PUSH_KEY_ERROR = `加密密钥必须正好 ${PUSH_KEY_LENGTH} 个 ASCII 字符`

export const isValidPushKey = (key: unknown): key is string =>
  typeof key === 'string' && utf8ByteLength(key) === PUSH_KEY_LENGTH

export const isValidPushIv = (iv: unknown): iv is string =>
  typeof iv === 'string' && utf8ByteLength(iv) === PUSH_IV_LENGTH

// ---- 地址与频道校验 ----

export interface PushTargetCheck {
  /** 归一化后的值；不合格时为 null */
  value: string | null
  /** 不合格的原因（合格时为 null） */
  error: string | null
  /** 「压根没填」——这不是配错，是还没配，调用方据此区分「未启用」与「失败」 */
  empty: boolean
}

const parseHttpUrl = (raw: unknown): URL | null => {
  try {
    const url = new URL(`${raw ?? ''}`.trim())
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null
  } catch (_e) {
    return null
  }
}

/**
 * Bark 的推送地址形如 `https://api.day.app/<设备码>`（自建服务端换主机名，
 * 路径里那一段设备码不变）。这里只做能当场判死的三件事：
 * 协议、主机、设备码那一段在不在。剩下的对错只有真发一次才知道，不猜。
 */
export const checkBarkEndpoint = (raw: unknown): PushTargetCheck => {
  const input = `${raw ?? ''}`.trim()
  if (!input) return { value: null, error: '尚未填写 Bark 推送地址', empty: true }
  const parsed = parseHttpUrl(input)
  if (!parsed) {
    return { value: null, error: 'Bark 地址必须是 https:// 或 http:// 开头的完整 URL', empty: false }
  }
  const segments = parsed.pathname.split('/').filter(Boolean)
  if (!segments.length) {
    return {
      value: null,
      error: '地址缺少设备码：请粘贴 Bark App 首页提供的完整地址，例如 https://api.day.app/xxxxxxxx',
      empty: false,
    }
  }
  // 末尾斜杠去掉：Bark 的路由按路径段匹配，多一个空段会落到别的路由上
  return { value: `${parsed.origin}/${segments.join('/')}${parsed.search}`, error: null, empty: false }
}

/**
 * ntfy 服务器地址。只填到服务器（默认公共的 ntfy.sh），频道名是另一格——
 * 把整条 `https://ntfy.sh/我的频道` 贴进来是最容易犯的错，单独认出来说清楚。
 * 允许带子路径（有人把自架的 ntfy 挂在 /ntfy 下）。
 */
export const checkNtfyServer = (raw: unknown, topic?: unknown): PushTargetCheck => {
  const input = `${raw ?? ''}`.trim()
  if (!input) return { value: null, error: '尚未填写 ntfy 服务器地址', empty: true }
  const parsed = parseHttpUrl(input)
  if (!parsed) {
    return { value: null, error: 'ntfy 服务器地址必须是 https:// 或 http:// 开头', empty: false }
  }
  if (parsed.search || parsed.hash) {
    return { value: null, error: 'ntfy 服务器地址不得包含 ? 或 # 参数', empty: false }
  }
  const segments = parsed.pathname.split('/').filter(Boolean)
  const wanted = `${topic ?? ''}`.trim()
  if (wanted && segments.at(-1) === wanted) {
    return {
      value: null,
      error: '服务器地址已包含频道名；本字段仅填写服务器地址（如 https://ntfy.sh），频道名请填写下一字段',
      empty: false,
    }
  }
  return {
    value: segments.length ? `${parsed.origin}/${segments.join('/')}` : parsed.origin,
    error: null,
    empty: false,
  }
}

/** ntfy 频道名。官方限制 [-_A-Za-z0-9]、最长 64 */
export const checkNtfyTopic = (raw: unknown): PushTargetCheck => {
  const input = `${raw ?? ''}`.trim()
  if (!input) return { value: null, error: '尚未填写频道名 · 点击「生成频道名」生成', empty: true }
  if (input.length > NTFY_TOPIC_MAX) {
    return { value: null, error: `频道名最长 ${NTFY_TOPIC_MAX} 个字符`, empty: false }
  }
  if (!/^[-_A-Za-z0-9]+$/.test(input)) {
    return { value: null, error: '频道名只能用字母、数字、下划线和短横线（ntfy 的限制）', empty: false }
  }
  return { value: input, error: null, empty: false }
}

/** 短频道名不拦，只提示：它等同于口令，短了就等于口令短 */
export const isWeakNtfyTopic = (topic: unknown): boolean => {
  const input = `${topic ?? ''}`.trim()
  return input.length > 0 && input.length < NTFY_TOPIC_WEAK_LENGTH
}

/** 日志里只写主机名——完整地址带着设备码/频道名，等同于密码，不进 crash.log */
export const pushEndpointHost = (raw: unknown): string => {
  try {
    return new URL(`${raw ?? ''}`).host || '(空)'
  } catch (_e) {
    return '(地址无效)'
  }
}

// ---- 正文占位 ----

/**
 * 「只推标题」时和正文本来就空时用的占位。**两个目标都不能真给空串**，
 * 而且各有各的理由，实读源码确认过：
 * - Bark：bark-server 的 push()（route_push.go）在 title/subtitle/body 全空时
 *   会把 Body 顶成 "Empty Message"；加密推送在服务端看来正是「三项全空」，
 *   而手机上解密后若 map 里没有 body 就不覆盖（CiphertextProcessor），
 *   留在通知里的就是那句英文。
 * - ntfy：官方文档的 JSON 字段表写着 message「set to `triggered` if empty or
 *   not passed」——空正文会被服务端顶成 "triggered"。
 * 给一句自己的占位，两个目标、明文加密两条路观感一致，也不泄露任何正文。
 */
export const PUSH_PLACEHOLDER_BODY = '详情见 kuma'
