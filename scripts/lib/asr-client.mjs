// 阿里云百炼（DashScope）ASR 调用封装。**维护者侧专用，永不进发行产物。**
//
// ---- 铁律（这几条是红线，改之前先看 scripts/README.md 的「ASR 转写管线」一节）----
//  ① 密钥只从环境变量 `DASHSCOPE_API_KEY` 读，**绝不写进仓库、绝不落盘、绝不打日志**。
//  ② 这一层只被 `scripts/` 下的脚本 import。发行产物的「零第三方请求」红线只管
//     玩家侧，但那条线的守法方式是**产物里根本没有这段代码**，不是运行时判断。
//  ③ 产出一律是**草稿层**（asr-draft），权威低于人肉转写。这里不做任何「直接写进
//     随包数据」的事，写盘的口子都在调用方。
//
// ---- 为什么是 base64 直传，而不是录音文件识别 ----
// 2026-08-23 实测：fun-asr 的**录音文件识别**（`/api/v1/services/audio/asr/transcription`）
// 只收公网 HTTP(S) URL，本地文件与 base64 都不认——走它就得引入 OSS 上传依赖，
// 为了转几十条几秒钟的 mp3 去挂一个对象存储，代价和风险都不成比例。
// 而**多模态生成口**（`/api/v1/services/aigc/multimodal-generation/generation`）
// 认 `data:audio/mpeg;base64,…`，同一条音频直传成功、耗时 0.5s。
// 所以本机不需要 ffmpeg 转码，mp3 原样上传即可（ffmpeg 只用来量时长算预算）。
//
// ---- 两个变体，都实测过 ----
//  · `fun-asr-flash-2026-06-15`：用户点名的 fun-asr 族，¥0.00022/秒，
//    走原生多模态口，**额外给逐字时间戳**（words[]），断句信息比 qwen3 丰富。
//  · `qwen3-asr-flash`：走 OpenAI 兼容口，**支持 system 消息做专名偏置**，
//    实测偏置后三个专名全中（详见 asr-normalize 文件头）。默认用它。
import { readFileSync } from 'node:fs'

/** 计价：fun-asr 北京地域 ¥0.00022/秒（2026-08-23 查阿里云文档）。按秒计，不足一秒进位。 */
export const PRICE_PER_SECOND = 0.00022

const COMPATIBLE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'
const NATIVE_URL =
  'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation'

export const DEFAULT_MODEL = 'qwen3-asr-flash'
export const FUN_ASR_MODEL = 'fun-asr-flash-2026-06-15'

/**
 * 取密钥。**没有就抛**——静默降级会让批量任务跑完一半才发现全是空结果。
 * 错误信息里只说变量名，不带任何密钥内容。
 */
export const requireApiKey = () => {
  const key = process.env.DASHSCOPE_API_KEY
  if (!key) {
    throw new Error(
      '缺少 DASHSCOPE_API_KEY 环境变量。这是维护者侧凭据，只从环境读，不入仓库。',
    )
  }
  return key
}

const audioDataUri = (file) => `data:audio/mpeg;base64,${readFileSync(file).toString('base64')}`

/** 网络失败（可重试） vs 转写失败（不重试）——两者在台账里分开记。 */
export class AsrNetworkError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'AsrNetworkError'
    this.status = status
    this.retryable = true
  }
}

export class AsrRejectedError extends Error {
  constructor(message, code) {
    super(message)
    this.name = 'AsrRejectedError'
    this.code = code
    this.retryable = false
  }
}

/** 5xx / 429 / 网络层异常算可重试；4xx（除 429）是请求本身有问题，重试只是白花钱。 */
const classifyStatus = (status, body) => {
  if (status === 429 || status >= 500) return new AsrNetworkError(`HTTP ${status}`, status)
  return new AsrRejectedError(`HTTP ${status}: ${`${body}`.slice(0, 300)}`, status)
}

const postJson = async (url, key, payload, timeoutMs) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
  } catch (error) {
    // 超时/断流/DNS——全算网络失败，可重试
    throw new AsrNetworkError(`请求未完成: ${error?.message ?? error}`, 0)
  } finally {
    clearTimeout(timer)
  }
  const text = await response.text()
  if (!response.ok) throw classifyStatus(response.status, text)
  try {
    return JSON.parse(text)
  } catch {
    throw new AsrRejectedError(`响应不是 JSON: ${text.slice(0, 200)}`, 'BAD_JSON')
  }
}

/**
 * 转写一条。
 *
 * @param file      本地 mp3 绝对路径
 * @param biasTerms 专名偏置词（qwen3 走 system 消息；fun-asr 不支持，忽略）
 * @returns { text, seconds, model, raw }  seconds 是**计费秒数**（服务端回的口径）
 */
export const transcribeOnce = async (
  file,
  { model = DEFAULT_MODEL, biasTerms = [], language = 'ja', timeoutMs = 90_000, apiKey = null } = {},
) => {
  const key = apiKey ?? requireApiKey()
  const uri = audioDataUri(file)

  if (model.startsWith('fun-asr')) {
    const json = await postJson(
      NATIVE_URL,
      key,
      {
        model,
        input: { messages: [{ role: 'user', content: [{ audio: uri }] }] },
        parameters: { format: 'mp3', language },
      },
      timeoutMs,
    )
    const sentence = json?.output?.output?.sentence
    const text = Array.isArray(sentence)
      ? sentence.map((s) => `${s?.text ?? ''}`).join('')
      : `${sentence?.text ?? ''}`
    // 原生口不回计费秒数，用句末时间戳兜底（毫秒）
    const endMs = Array.isArray(sentence)
      ? Math.max(0, ...sentence.map((s) => Number(s?.end_time) || 0))
      : Number(sentence?.end_time) || 0
    return { text, seconds: endMs ? Math.ceil(endMs / 1000) : 0, model, raw: json }
  }

  const messages = []
  if (biasTerms.length) {
    // qwen3-asr 的专名偏置：system 里给一串**该形态自己的**专名，模型据此收敛同音候选。
    // 实测这是纠正舰名/术语最有效的一步，远胜后处理（见 asr-normalize 文件头）。
    messages.push({ role: 'system', content: [{ type: 'text', text: biasTerms.join(' ') }] })
  }
  messages.push({ role: 'user', content: [{ type: 'input_audio', input_audio: { data: uri } }] })
  const json = await postJson(
    COMPATIBLE_URL,
    key,
    { model, messages, asr_options: { language, enable_itn: false } },
    timeoutMs,
  )
  if (json?.error) throw new AsrRejectedError(`${json.error.message ?? ''}`, json.error.code)
  return {
    text: `${json?.choices?.[0]?.message?.content ?? ''}`,
    seconds: Number(json?.usage?.seconds) || 0,
    model,
    raw: json,
  }
}

/** 指数退避重试。**只重试网络失败**；转写被拒绝就是被拒绝，重试只是重复花钱。 */
export const transcribeWithRetry = async (file, options = {}, { retries = 2, baseDelayMs = 800 } = {}) => {
  let lastError
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await transcribeOnce(file, options)
    } catch (error) {
      lastError = error
      if (!error?.retryable || attempt === retries) throw error
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** attempt))
    }
  }
  throw lastError
}

/**
 * 并发跑一批，带上限。
 *
 * fun-asr 的限流是 600 RPM，默认并发 3 离它很远——批量的瓶颈从来不是吞吐，
 * 是「跑飞了会重复花钱」。宁可慢。
 */
export const runPool = async (items, worker, { concurrency = 3 } = {}) => {
  const results = new Array(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return results
}
