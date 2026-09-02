// 手机推送 · 主进程侧。**全仓唯一发出推送请求的地方**：
// 渲染层拿得到地址（要显示在钥的输入框里），但绝不自己发网络请求。
//
// 两种目标（provider），构造分开、出网合一：
// - **ntfy**（默认）：安卓收得到，服务器可自架。见 shared/ntfy-payload.ts。
// - **bark**：iOS 专用（苹果 APNs），带端到端加密。见 shared/push-payload.ts。
// 两边各自构造出同一种 PushRequest 形状，下面只有一处 net.fetch 把它发出去——
// 加目标不该增加出网点。
//
// 五条纪律写在代码形状里：
// ① 默认全关：enabled 默认 false，频道名/地址默认空——任一不成立就直接返回
//    「未启用」，连 DNS 都不解析。铃那一列即使开着，也只是在这里被挡回去。
// ② 一次一发，**绝不重试**：推送的价值是「几点该回来」，晚到的重试只会
//    在错误的时刻响一声；失败就如实回报，由铃在通知记录上挂一行标注。
// ③ 失败显式：超时、HTTP 非 2xx、服务端回的业务码，都原样带回文案，不吞。
//
// ④ **在场门槛**：人还在电脑前（全系统键鼠空闲不到阈值）就不出网，回一个
//    deferred 让铃收进补发队列。判定必须在这里——出网的唯一入口前一步，
//    任何调用方都绕不过去；渲染层若自己判，两处迟早分家成两道门。
//
// ⑤ **走应用自己的网络栈**（`net.fetch`，2026-08-23 全出口合规审计的裁定）：
//    Node 的全局 `fetch` 用的是 Node 自己那套栈——**绕开玩家在系统/应用里配的代理**，
//    于是「艦素其余所有出网都走代理、只有推送这一条裸奔」。地址是玩家亲手填的
//    第三方主机，恰恰是最不该悄悄绕过代理的那一条。`net.fetch` 走 Chromium 网络栈：
//    代理设置、系统证书、`webRequest` 观察都与其余出口同一套。行为其余一个字不改
//    （默认关、地址空不发、绝不重试、失败显式、在场门槛照旧排在出网之前）。
//
// 与游戏服务器零关系：这条路由只消费铃已经决定要通知的事件，不产生任何 kcsapi 请求。
import { ipcMain, net, powerMonitor } from 'electron'

import config = require('./config')
import {
  checkBarkEndpoint,
  checkNtfyServer,
  checkNtfyTopic,
  isValidPushKey,
  PUSH_KEY_ERROR,
  pushEndpointHost,
  readPushSettings,
  shouldHoldForPresence,
  type PushRequest,
  type PushSettings,
} from '../shared/push-config'
import { buildNtfyRequest, generateNtfyTopic } from '../shared/ntfy-payload'
import { buildPushRequestBody, generatePushKey } from '../shared/push-payload'

/** 10s。推送是「时刻类」提醒，等更久已经失去意义，不如早点把失败说出来 */
const PUSH_TIMEOUT_MS = 10000

/** 标题/正文的上限。通知只送时刻，超出的部分对手机通知栏也没意义 */
const MAX_TITLE = 120
const MAX_BODY = 400
/** Bark 的通知中心分组。ntfy 没有对应字段，那边不发 */
const DEFAULT_GROUP = 'kuma'

export interface PushSendResult {
  ok: boolean
  /**
   * 「没发」而不是「发失败」：未启用、频道名/地址还没填。
   * 铃据此不在通知记录上挂「推送失败」——那不是失败，是没开。
   */
  skipped?: boolean
  /**
   * 「先不发」：人还在电脑前，这条**没有出网**。与 ok/skipped 并列的第三种结局——
   * 铃据此把它收进补发队列，等人离开再按序推，也不在记录上挂红字（没失败）。
   */
  deferred?: boolean
  message: string
}

/**
 * 全系统键鼠空闲秒数。读不出来时按「不在电脑前」算（返回一整天）：
 * 门槛失灵的方向必须是照常推送，压着不发等于把提醒静默丢掉。
 * 不静默吞——读失败要在日志里留一行。
 */
const IDLE_UNKNOWN_SECONDS = 86400
const systemIdleSeconds = (): number => {
  try {
    const seconds = powerMonitor.getSystemIdleTime()
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : IDLE_UNKNOWN_SECONDS
  } catch (error) {
    console.warn(
      `[kanso] push: 读不出系统空闲时间，按「不在电脑前」处理 · ${(error as { message?: string })?.message ?? error}`,
    )
    return IDLE_UNKNOWN_SECONDS
  }
}

/** 构造阶段就能判死的结果：要么给出待发请求，要么给出不发的理由 */
type Prepared = { request: PushRequest } | { failure: PushSendResult }

const clamp = (value: unknown, max: number): string => {
  const value_ = typeof value === 'string' ? value : ''
  return value_.length > max ? `${value_.slice(0, max - 1)}…` : value_
}

const notSent = (message: string, skipped = false): Prepared => ({
  failure: { ok: false, skipped, message: `未推送：${message}` },
})

const prepareNtfy = (
  settings: PushSettings,
  notification: { title: string; body: string },
): Prepared => {
  const topic = checkNtfyTopic(settings.ntfyTopic)
  if (!topic.value) return notSent(topic.error!, topic.empty)
  const server = checkNtfyServer(settings.ntfyServer, settings.ntfyTopic)
  if (!server.value) return notSent(server.error!, server.empty)
  try {
    return {
      request: buildNtfyRequest(notification, {
        server: server.value,
        topic: topic.value,
        token: settings.ntfyToken,
        titleOnly: settings.titleOnly,
      }),
    }
  } catch (error) {
    return notSent(error instanceof Error ? error.message : `${error}`)
  }
}

const prepareBark = (
  settings: PushSettings,
  notification: { title: string; body: string },
): Prepared => {
  const endpoint = checkBarkEndpoint(settings.barkEndpoint)
  if (!endpoint.value) return notSent(endpoint.error!, endpoint.empty)
  // 开着加密却给不出合法密钥时**不许退回明文**：那等于把用户明确要求保护的
  // 内容原文发出去，还不告诉他。宁可这条推送失败。
  if (settings.barkEncrypt && !isValidPushKey(settings.barkKey)) return notSent(PUSH_KEY_ERROR)
  try {
    const payload = buildPushRequestBody(
      { ...notification, group: DEFAULT_GROUP },
      { titleOnly: settings.titleOnly, encryptKey: settings.barkEncrypt ? settings.barkKey : null },
    )
    return {
      request: {
        url: endpoint.value,
        headers: { 'content-type': payload.contentType },
        body: payload.body,
      },
    }
  } catch (error) {
    return notSent(error instanceof Error ? error.message : `${error}`)
  }
}

const sendPush = async (input: unknown): Promise<PushSendResult> => {
  const raw = (input ?? {}) as { title?: unknown; body?: unknown; immediate?: unknown }
  const notification = {
    title: clamp(raw.title, MAX_TITLE),
    body: clamp(raw.body, MAX_BODY),
  }
  if (!notification.title && !notification.body) {
    return { ok: false, message: '推送内容为空 · 未发送' }
  }

  // 逐叶子读。整对象读会拿到 config 写叶子时留下的半份对象，
  // 于是「只推标题」这类默认开的项会静默变成关——那正是最不能出错的方向。
  const settings = readPushSettings((path, fallback) => config.get(path, fallback))
  if (!settings.enabled) {
    return { ok: false, skipped: true, message: '手机推送未启用 · 请在设置中开启' }
  }
  const prepared =
    settings.provider === 'bark'
      ? prepareBark(settings, notification)
      : prepareNtfy(settings, notification)
  if ('failure' in prepared) return prepared.failure
  const { request } = prepared

  // 在场门槛。位置有讲究：
  // ① 在**构造之后**——地址没填、密钥不合法这类当场判死的问题要立刻回报，
  //    那时用户正坐在屏幕前，正好能改；攒进补发队列只会等他离开后再一条条失败。
  // ② 在**出网之前**——deferred 的这条一个字节都不发出去。
  // `immediate` 只有钥里「发送测试推送」那个按钮会带：用户亲手点的、正盯着手机
  // 等它响，暂缓等于按钮坏了。铃走的是普通路径，从不带这个标。
  if (raw.immediate !== true) {
    const idleSeconds = systemIdleSeconds()
    if (shouldHoldForPresence(settings, idleSeconds)) {
      return {
        ok: false,
        deferred: true,
        message: `检测到键鼠操作 · 暂缓推送（空闲 ${Math.floor(idleSeconds)} 秒 · 门槛 ${settings.presenceIdleMinutes} 分）· 达到空闲门槛后补发`,
      }
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PUSH_TIMEOUT_MS)
  try {
    // 出网就这一处，且走应用网络栈（见文件头 ⑤）：玩家配的代理管得住它
    const response = await net.fetch(request.url, {
      method: 'POST',
      headers: request.headers,
      body: request.body,
      signal: controller.signal,
    })
    // 回包很小（Bark 的 {"code":200,…} / ntfy 的那条消息 JSON）；
    // 截断只防自架服务端返回一整页 HTML
    const text = (await response.text()).slice(0, 300).trim()
    if (!response.ok) {
      return { ok: false, message: `服务器返回 HTTP ${response.status}${text ? ` · ${text}` : ''}` }
    }
    // 自架服务端有把失败包在 200 里的，业务码也要看。
    // ntfy 成功时回的是那条消息本身（没有 code 字段）→ 视为 200。
    let code: unknown = 200
    let serverMessage = ''
    try {
      const parsed = JSON.parse(text) as { code?: unknown; error?: unknown }
      code = parsed?.code ?? 200
      serverMessage = typeof parsed?.error === 'string' ? parsed.error : ''
    } catch (_e) {
      // 不是 JSON（自架服务端/中间层可能回别的）：以 HTTP 状态为准，不当作失败
    }
    if (typeof code === 'number' && code !== 200) {
      return { ok: false, message: `服务器返回 ${code}${serverMessage ? ` · ${serverMessage}` : ''}` }
    }
    const how =
      settings.provider === 'bark'
        ? request.headers['content-type']?.startsWith('application/x-www-form-urlencoded')
          ? '已推送（Bark · 密文）'
          : '已推送（Bark · 明文）'
        : settings.titleOnly
          ? '已推送（ntfy · 只有标题）'
          : '已推送（ntfy）'
    return { ok: true, message: how }
  } catch (error) {
    const reason =
      (error as { name?: string })?.name === 'AbortError'
        ? `超时（${PUSH_TIMEOUT_MS / 1000}s）`
        : `${(error as { message?: string })?.message ?? error}`
    // 只写主机名：完整地址里那串设备码/频道名等同于密码，不该落进 crash.log
    console.warn(`[kanso] push: 发送失败 → ${pushEndpointHost(request.url)} · ${reason}`)
    return { ok: false, message: `推送失败：${reason}` }
  } finally {
    clearTimeout(timer)
  }
}

ipcMain.handle('push:send', (_event, input: unknown) => sendPush(input))

// 只读：铃拿它给补发队列掐节拍（约 30 秒问一次）。**它不是第二道门**——
// 真正判定还是上面那一处，铃试早了只会再收到一个 deferred，队列原样留着。
ipcMain.handle('push:idle-seconds', () => systemIdleSeconds())

// 频道名与密钥都在主进程生成：随机源和字母表口径与发送那一侧同源，
// 渲染层不再自备一套。
ipcMain.handle('push:generate-topic', () => generateNtfyTopic())
ipcMain.handle('push:generate-key', () => generatePushKey())
