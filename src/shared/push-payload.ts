// Bark（**iOS 专用**推送 App，走苹果 APNs）的载荷构造。纯函数 + node crypto，
// 只在主进程被 require。安卓那一侧的目标是 ntfy，见 ntfy-payload.ts。
//
// ── 协议核实（2026-08-20 实读官方文档与服务端源码，不凭记忆写）──
//
// ① 明文推送 —— https://bark.day.app/tutorial.md（官方文档的 docsify 原始 markdown）
//    POST 到 `https://api.day.app/<设备码>`，
//    `Content-Type: application/json; charset=utf-8`，JSON 体的字段示例为
//    body / title / badge / sound / icon / group / url；另有 subtitle、level、
//    markdown、id、delete、device_keys 等。也可 POST /push 并把设备码写成
//    JSON 里的 `device_key`。表单形式（-d 'body=…&group=…'）同样受理。
//    艦素只用 title / body / group 三个字段：通知只送「时刻」，别的不塞。
//
// ② 加密推送 —— https://bark.day.app/encryption.md
//    原文给的步骤是「把 Bark 请求参数转成 json 字符串 → 用秘钥和相应算法加密
//    → 把密文作为 ciphertext 参数发给服务器」。它给的示例是
//      openssl enc -aes-128-cbc -K <hex(key)> -iv <hex(iv)> | base64
//    并注明：key「Must be 16 bit long」（实为 16 字节 = AES-128）；
//    IV 也是 16 位，「can be randomly generated, but if it is random,
//    it needs to be passed in the iv parameter」；hex 只是 openssl 的输入要求
//    （"openssl requires Hex encoding of manual keys and IVs, not ASCII encoding"），
//    协议里的 key/iv 就是那 16 个 ASCII 字符本身——示例最后一行
//    `--data-urlencode "iv=1234567890123456"` 发的正是原文而非 hex。
//    密文 base64 后作为 `ciphertext` 表单字段（连同 `iv`）URL 编码提交。
//    padding：`openssl enc` 默认 PKCS#7，node 的 createCipheriv 默认
//    autoPadding 也是 PKCS#7 —— 两边一致，下面 test 里钉了官方文档那条
//    实测向量（key/iv 均为 '1234567890123456'）。
//
// ③ 服务端不解密 —— Finb/bark-server `route_push.go` 的 push()：
//    只有 id/device_key/subtitle/title/body/sound 会被识别，其余键（含
//    ciphertext、iv）原样进 ExtParams 透传给 APNs；解密发生在手机上的
//    Bark App（NotificationServiceExtension 的 CiphertextProcessor）。
//    所以「加密开着」时 Bark 服务器与苹果通道确实只看得到密文。
import { createCipheriv, randomBytes } from 'crypto'

import {
  isValidPushIv,
  isValidPushKey,
  PUSH_IV_LENGTH,
  PUSH_KEY_ERROR,
  PUSH_KEY_LENGTH,
  PUSH_PLACEHOLDER_BODY,
  PUSH_TOKEN_ALPHABET,
} from './push-config'

export interface PushNotification {
  title: string
  body: string
  /** 通知中心里的分组（Bark 的 group）；艦素统一用一个值，免得刷屏各占一格 */
  group?: string
}

export interface PushPayloadOptions {
  /** 只推标题：正文不出本机 */
  titleOnly: boolean
  /** 16 字节密钥；空/未给 = 明文推送 */
  encryptKey?: string | null
  /** 只给测试注入固定 IV 用。生产路径永远不传，每条现随机一换 */
  iv?: string
}

export interface PushRequestBody {
  mode: 'plain' | 'encrypted'
  contentType: string
  body: string
  /** 这一条实际用的 IV（明文模式为 null） */
  iv: string | null
}

/**
 * 送进 Bark 的那组参数。**只推标题时正文根本不进这个对象**——
 * 不是发出去再由谁去截，是压根没构造出来。
 */
export const barkParams = (
  notification: PushNotification,
  titleOnly: boolean,
): Record<string, string> => {
  const title = notification.title
  const body = titleOnly || !notification.body ? PUSH_PLACEHOLDER_BODY : notification.body
  const params: Record<string, string> = { title, body }
  if (notification.group) params.group = notification.group
  return params
}

/**
 * 定长随机串。用拒绝采样而不是 `byte % alphabet.length`：
 * 256 不是 56 的整数倍，直接取模会让字母表前 32 个字符略微更常出现。
 *
 * 密钥（Bark）和频道名（ntfy）共用这一个发生器：两样都要用户肉眼抄进手机，
 * 「哪些字符不许出现」的判断只该有一处。
 */
export const randomPushToken = (length: number): string => {
  const size = PUSH_TOKEN_ALPHABET.length
  const limit = Math.floor(256 / size) * size
  let out = ''
  while (out.length < length) {
    for (const byte of randomBytes((length - out.length) * 2)) {
      if (byte >= limit) continue
      out += PUSH_TOKEN_ALPHABET[byte % size]
      if (out.length === length) break
    }
  }
  return out
}

/** 给用户抄进 Bark App 的密钥 */
export const generatePushKey = (): string => randomPushToken(PUSH_KEY_LENGTH)

/** 每条推送现生成一个，随 iv 参数一起发；不复用、不落盘 */
export const randomPushIv = (): string => randomPushToken(PUSH_IV_LENGTH)

/** AES-128-CBC + PKCS#7 → base64。与官方文档的 openssl 示例逐字节一致 */
export const encryptPushPayload = (json: string, key: string, iv: string): string => {
  if (!isValidPushKey(key)) throw new Error(PUSH_KEY_ERROR)
  if (!isValidPushIv(iv)) throw new Error(`IV 必须正好 ${PUSH_IV_LENGTH} 字节`)
  const cipher = createCipheriv('aes-128-cbc', Buffer.from(key, 'utf8'), Buffer.from(iv, 'utf8'))
  return Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]).toString('base64')
}

/**
 * 待 POST 的请求体。密钥不合格时**抛异常而不是悄悄退回明文**：
 * 用户开着「加密推送」，我们却把舰名明文发出去，是最不该有的那种降级。
 */
export const buildPushRequestBody = (
  notification: PushNotification,
  options: PushPayloadOptions,
): PushRequestBody => {
  const params = barkParams(notification, options.titleOnly)
  const json = JSON.stringify(params)
  const key = options.encryptKey ?? ''
  if (!key) {
    return {
      mode: 'plain',
      contentType: 'application/json; charset=utf-8',
      body: json,
      iv: null,
    }
  }
  const iv = options.iv ?? randomPushIv()
  const ciphertext = encryptPushPayload(json, key, iv)
  return {
    mode: 'encrypted',
    contentType: 'application/x-www-form-urlencoded; charset=utf-8',
    body: new URLSearchParams({ ciphertext, iv }).toString(),
    iv,
  }
}
