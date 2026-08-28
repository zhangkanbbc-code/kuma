// 游戏页音频总控。安装在页面主世界，覆盖 WebAudio 与 HTMLMedia 两条播放链：
// - 总音量是艦素额外乘数，不改游戏自身保存的分项音量；
// - 「仅语音 / 仅 BGM」按资源 URL 精确分类，其他音效一并静音；
// - 设置由隔离世界 bridge 提供，页面只读到经过钳制的音频配置。
// 游戏真下发的两族语音地址（对着本机缓存里的真实 URL 核过）：
//   voice_root 型  /kcs/sound/kc<键>/<号>.mp3?version=N   舰娘台词，含 9997~9999 的 /kcs/sound/kc9999/414.mp3
//   path_root 型   /kcs2/resources/voice/<名>/<号>.mp3     titlecall_1、titlecall_2、tutorial
// BGM 只有 port 与 battle 两类，文件名形如 102_2564.mp3；这里不钉死位数，免得改版就漏。
const GAME_AUDIO_POLICY = Object.freeze({
  voicePattern: String.raw`(?:/kcs/sound/kc[^/]+|/resources/voice/[^/]+)/[^/]+\.mp3$`,
  bgmPattern: String.raw`/resources/bgm/(?:port|battle)/[^/]+\.mp3$`,
})

const normalizeGameAudioSettings = (raw) => {
  const parsed = Number(raw?.volume)
  const volume = Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 1
  const parsedVoice = Number(raw?.voiceVolume)
  const voiceVolume = Number.isFinite(parsedVoice)
    ? Math.max(0, Math.min(2, parsedVoice))
    : 1
  const parsedBgm = Number(raw?.bgmVolume)
  const bgmVolume = Number.isFinite(parsedBgm)
    ? Math.max(0, Math.min(2, parsedBgm))
    : 1
  const mode = raw?.mode === 'voice' || raw?.mode === 'bgm' ? raw.mode : 'all'
  return { volume, voiceVolume, bgmVolume, mode }
}

const classifyGameAudioUrl = (input, baseUrl = 'https://example.invalid/', policy = GAME_AUDIO_POLICY) => {
  try {
    const pathname = decodeURIComponent(new URL(`${input ?? ''}`, baseUrl).pathname)
    if (new RegExp(policy.voicePattern, 'i').test(pathname)) return 'voice'
    if (new RegExp(policy.bgmPattern, 'i').test(pathname)) return 'bgm'
  } catch (_error) {
    // blob / 空字符串等无法分类的地址按普通音效处理。
  }
  return 'other'
}

const gameAudioGainFor = (settings, category) => {
  const normalized = normalizeGameAudioSettings(settings)
  if (!(normalized.mode === 'all' || normalized.mode === category)) return 0
  const categoryVolume =
    category === 'voice' ? normalized.voiceVolume :
    category === 'bgm' ? normalized.bgmVolume :
    1
  return normalized.volume * categoryVolume
}

// 注意：该函数会被 contextBridge.executeInMainWorld 序列化执行，不能闭包引用模块变量。
const installGameAudioControl = (policy) => {
  const hostWindow = window
  if (hostWindow.kansoAudioControlInstalled) return

  const setup = (target, settingsBridge) => {
    if (!target || target.kansoAudioControlInstalled) return
    Object.defineProperty(target, 'kansoAudioControlInstalled', {
      value: true,
      configurable: true,
    })

    const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
    const normalize = (raw) => {
      const parsed = Number(raw?.volume)
      const parsedVoice = Number(raw?.voiceVolume)
      const parsedBgm = Number(raw?.bgmVolume)
      return {
        volume: Number.isFinite(parsed) ? clamp(parsed, 0, 1) : 1,
        voiceVolume: Number.isFinite(parsedVoice) ? clamp(parsedVoice, 0, 2) : 1,
        bgmVolume: Number.isFinite(parsedBgm) ? clamp(parsedBgm, 0, 2) : 1,
        mode: raw?.mode === 'voice' || raw?.mode === 'bgm' ? raw.mode : 'all',
      }
    }
    const voicePattern = new RegExp(policy.voicePattern, 'i')
    const bgmPattern = new RegExp(policy.bgmPattern, 'i')
    const requestUrlByBuffer = new target.WeakMap()
    const requestUrlByBlob = new target.WeakMap()
    const requestUrlByObjectUrl = new target.Map()
    // 自检用的只读计数：哪条捕获路记下了地址、最近解了哪些音频。不参与播放。
    const stats = {
      frame: '',
      captures: { xhr: 0, fetch: 0, blob: 0, fileReader: 0, objectUrl: 0 },
      decodes: [],
    }
    // 解出来的**语音**有多长（`{ path, ms }`）。字幕层拿它决定这一句挂到什么时候：
    // 音轨播多久字幕挂多久，没有哪个判据比这个更准（见 shared/voice-caption-hold）。
    //
    // 不复用上面那个 stats.decodes：那个环只有 10 条、而且什么音频都收，
    // 一进战斗满屏 SE 几秒就能把语音全冲出去，字幕到期时正好一条都查不着。
    // 这个环只收语音，24 条足够盖住「最短展示到期再来问」那几秒里的并发。
    const voiceDurations = []
    try {
      stats.frame = new target.URL(target.location.href).pathname
    } catch (_error) {
      stats.frame = ''
    }
    const countCapture = (path) => {
      stats.captures[path] += 1
    }
    const rememberBuffer = (buffer, requestUrl, path) => {
      if (!buffer || !requestUrl) return
      if (!(buffer instanceof target.ArrayBuffer)) return
      if (requestUrlByBuffer.has(buffer)) return
      requestUrlByBuffer.set(buffer, requestUrl)
      countCapture(path)
    }
    const rememberBlob = (blob, requestUrl, path) => {
      if (!blob || !requestUrl || !target.Blob) return
      if (!(blob instanceof target.Blob)) return
      if (requestUrlByBlob.has(blob)) return
      requestUrlByBlob.set(blob, requestUrl)
      countCapture(path)
    }
    const classify = (input) => {
      try {
        const source = requestUrlByObjectUrl.get(`${input ?? ''}`) ?? `${input ?? ''}`
        const pathname = decodeURIComponent(new target.URL(source, target.location.href).pathname)
        if (voicePattern.test(pathname)) return 'voice'
        if (bgmPattern.test(pathname)) return 'bgm'
      } catch (_error) {
        // blob / 空字符串等无法分类的地址按普通音效处理。
      }
      return 'other'
    }

    let settings = normalize(settingsBridge?.getGameAudioSettings?.())
    const factor = (category) => {
      if (!(settings.mode === 'all' || settings.mode === category)) return 0
      const categoryVolume =
        category === 'voice' ? settings.voiceVolume :
        category === 'bgm' ? settings.bgmVolume :
        1
      return settings.volume * categoryVolume
    }

    // ---- WebAudio：请求 URL → ArrayBuffer → AudioBuffer → BufferSource ----
    const categoryByAudioBuffer = new target.WeakMap()
    const sourceState = new target.WeakMap()
    const liveSources = new target.Set()

    // 游戏用 howler 装语音：open → responseType='arraybuffer' → 装 onload → send。
    // 监听器按注册顺序触发，所以登记必须早于游戏自己的 onload——否则 decodeAudioData
    // 拿到 ArrayBuffer 时地址还没记上，语音就被当成普通音效，只吃总音量。
    const xhrProto = target.XMLHttpRequest?.prototype
    if (xhrProto?.open) {
      const requestUrlByXhr = new target.WeakMap()
      const originalOpen = xhrProto.open
      const rememberResponse = (xhr, value) => {
        const requestUrl = requestUrlByXhr.get(xhr) || xhr.responseURL || ''
        if (!requestUrl) return
        rememberBuffer(value, requestUrl, 'xhr')
        rememberBlob(value, requestUrl, 'xhr')
      }
      xhrProto.open = function (method, url, ...rest) {
        requestUrlByXhr.set(this, `${url ?? ''}`)
        this.addEventListener('load', () => rememberResponse(this, this.response), { once: true })
        return originalOpen.call(this, method, url, ...rest)
      }
      // 兜底：读 response 的那一刻就登记，与事件注册顺序无关。
      const responseDescriptor = Object.getOwnPropertyDescriptor(xhrProto, 'response')
      if (responseDescriptor?.get && responseDescriptor.configurable) {
        Object.defineProperty(xhrProto, 'response', {
          ...responseDescriptor,
          get() {
            const value = responseDescriptor.get.call(this)
            rememberResponse(this, value)
            return value
          },
        })
      }
    }

    // fetch 的登记挂在 Response.prototype 上，不再逐个实例 defineProperty：
    // 实例覆写在某些实现上会静默失败，而且 clone() 出来的那份继承不到。
    const requestUrlByResponse = new target.WeakMap()
    if (typeof target.fetch === 'function') {
      const originalFetch = target.fetch
      target.fetch = function (...args) {
        const requested = typeof args[0] === 'string' ? args[0] : args[0]?.url ?? ''
        return originalFetch.apply(this, args).then((response) => {
          const requestUrl = response?.url || `${requested}`
          if (response && requestUrl) requestUrlByResponse.set(response, requestUrl)
          return response
        })
      }
    }
    const responseProto = target.Response?.prototype
    if (responseProto) {
      const urlOf = (response) => requestUrlByResponse.get(response) || response.url || ''
      const wrapReader = (name, remember) => {
        const original = responseProto[name]
        if (typeof original !== 'function') return
        responseProto[name] = function (...args) {
          const requestUrl = urlOf(this)
          return original.apply(this, args).then((value) => {
            remember(value, requestUrl, 'fetch')
            return value
          })
        }
      }
      wrapReader('arrayBuffer', rememberBuffer)
      wrapReader('blob', rememberBlob)
      const originalClone = responseProto.clone
      if (typeof originalClone === 'function') {
        responseProto.clone = function (...args) {
          const copy = originalClone.apply(this, args)
          const requestUrl = urlOf(this)
          if (copy && requestUrl) requestUrlByResponse.set(copy, requestUrl)
          return copy
        }
      }
    }

    const blobProto = target.Blob?.prototype
    if (blobProto?.arrayBuffer) {
      const originalBlobArrayBuffer = blobProto.arrayBuffer
      blobProto.arrayBuffer = function (...args) {
        const requestUrl = requestUrlByBlob.get(this)
        return originalBlobArrayBuffer.apply(this, args).then((buffer) => {
          rememberBuffer(buffer, requestUrl, 'blob')
          return buffer
        })
      }
    }
    if (blobProto?.slice) {
      // 切片仍是同一份资源的字节，分类跟着走，免得 slice 之后就认不出了。
      const originalSlice = blobProto.slice
      blobProto.slice = function (...args) {
        const sliced = originalSlice.apply(this, args)
        rememberBlob(sliced, requestUrlByBlob.get(this), 'blob')
        return sliced
      }
    }

    // FileReader 与 XHR 同一个毛病：调用方多半先装 onload 再调 readAsArrayBuffer，
    // 所以登记也要挂在读 result 的那一刻，别指望事件顺序。
    const fileReaderProto = target.FileReader?.prototype
    if (fileReaderProto?.readAsArrayBuffer) {
      const requestUrlByReader = new target.WeakMap()
      const originalReadAsArrayBuffer = fileReaderProto.readAsArrayBuffer
      fileReaderProto.readAsArrayBuffer = function (blob, ...rest) {
        const requestUrl = requestUrlByBlob.get(blob)
        if (requestUrl) requestUrlByReader.set(this, requestUrl)
        return originalReadAsArrayBuffer.call(this, blob, ...rest)
      }
      const resultDescriptor = Object.getOwnPropertyDescriptor(fileReaderProto, 'result')
      if (resultDescriptor?.get && resultDescriptor.configurable) {
        Object.defineProperty(fileReaderProto, 'result', {
          ...resultDescriptor,
          get() {
            const value = resultDescriptor.get.call(this)
            rememberBuffer(value, requestUrlByReader.get(this), 'fileReader')
            return value
          },
        })
      }
    }

    if (target.URL?.createObjectURL) {
      const originalCreateObjectUrl = target.URL.createObjectURL
      const originalRevokeObjectUrl = target.URL.revokeObjectURL
      target.URL.createObjectURL = function (object) {
        const objectUrl = originalCreateObjectUrl.call(this, object)
        const requestUrl = requestUrlByBlob.get(object)
        if (requestUrl) {
          requestUrlByObjectUrl.set(objectUrl, requestUrl)
          countCapture('objectUrl')
        }
        return objectUrl
      }
      if (originalRevokeObjectUrl) {
        target.URL.revokeObjectURL = function (objectUrl) {
          requestUrlByObjectUrl.delete(`${objectUrl}`)
          return originalRevokeObjectUrl.call(this, objectUrl)
        }
      }
    }

    const AudioContextCtor = target.AudioContext || target.webkitAudioContext
    const audioContextProto = AudioContextCtor?.prototype
    if (audioContextProto?.decodeAudioData && audioContextProto?.createBufferSource) {
      const originalDecode = audioContextProto.decodeAudioData
      const decodeAudioData = function (buffer, success, failure) {
        const requestUrl = requestUrlByBuffer.get(buffer) ?? ''
        const category = classify(requestUrl)
        let pathname = ''
        try {
          pathname = new target.URL(requestUrl, target.location.href).pathname
        } catch (_error) {
          pathname = requestUrl ? '(认不出的地址)' : '(没记到地址)'
        }
        stats.decodes.push({ path: pathname, category })
        if (stats.decodes.length > 10) stats.decodes.shift()
        const mark = (decoded) => {
          if (decoded) categoryByAudioBuffer.set(decoded, category)
          // AudioBuffer.duration 是秒。这是链路里唯一一处**拿得到真实音轨长度**的地方：
          // 上游 webRequest 只看得见地址，字节要到这里解完才知道有多长。
          if (category === 'voice' && pathname && decoded?.duration > 0) {
            voiceDurations.push({ path: pathname, ms: Math.round(decoded.duration * 1000) })
            if (voiceDurations.length > 24) voiceDurations.shift()
          }
          return decoded
        }
        if (typeof success === 'function') {
          return originalDecode.call(
            this,
            buffer,
            (decoded) => success(mark(decoded)),
            failure,
          )
        }
        const result = originalDecode.call(this, buffer)
        return result?.then ? result.then(mark) : result
      }
      // howler 按 decodeAudioData.length 决定走 Promise 还是回调分支。原生是 1，
      // 包装函数天然是 3，会把它推到回调分支去——报回 1，保持游戏原本的走法。
      try {
        Object.defineProperty(decodeAudioData, 'length', { value: originalDecode.length })
      } catch (_error) {
        // length 不可配置就算了，两条分支我们都接得住。
      }
      audioContextProto.decodeAudioData = decodeAudioData

      const sourceProto = target.AudioBufferSourceNode?.prototype
      const bufferDescriptor = sourceProto
        ? Object.getOwnPropertyDescriptor(sourceProto, 'buffer')
        : null
      if (sourceProto && bufferDescriptor?.get && bufferDescriptor?.set && bufferDescriptor.configurable) {
        Object.defineProperty(sourceProto, 'buffer', {
          ...bufferDescriptor,
          get() {
            return bufferDescriptor.get.call(this)
          },
          set(value) {
            bufferDescriptor.set.call(this, value)
            const state = sourceState.get(this)
            if (state) {
              state.category = categoryByAudioBuffer.get(value) ?? 'other'
              state.gain.gain.value = factor(state.category)
            }
          },
        })
      }

      const originalCreateBufferSource = audioContextProto.createBufferSource
      audioContextProto.createBufferSource = function () {
        const source = originalCreateBufferSource.call(this)
        const gain = this.createGain()
        const state = { source, gain, category: 'other', connected: false }
        sourceState.set(source, state)
        liveSources.add(state)
        gain.gain.value = factor(state.category)

        const originalSourceConnect = source.connect.bind(source)
        const originalSourceDisconnect = source.disconnect.bind(source)
        const originalGainConnect = gain.connect.bind(gain)
        const originalGainDisconnect = gain.disconnect.bind(gain)
        Object.defineProperty(source, 'connect', {
          configurable: true,
          value(destination, output = 0, input = 0) {
            if (!state.connected) {
              originalSourceConnect(gain, output, 0)
              state.connected = true
            }
            if (target.AudioParam && destination instanceof target.AudioParam) {
              originalGainConnect(destination, 0)
            } else {
              originalGainConnect(destination, 0, input)
            }
            return destination
          },
        })
        Object.defineProperty(source, 'disconnect', {
          configurable: true,
          value(...args) {
            try {
              if (args.length) originalGainDisconnect(...args)
              else originalGainDisconnect()
            } catch (_error) {
              // 与原生 disconnect 一样允许调用方重复清理。
            }
            if (!args.length) {
              try {
                originalSourceDisconnect()
              } catch (_error) {
                // 已断开。
              }
              state.connected = false
            }
          },
        })
        source.addEventListener('ended', () => liveSources.delete(state), { once: true })
        return source
      }
    }

    // ---- HTMLAudio / HTMLVideo：保留游戏原音量，再乘艦素总控 ----
    const liveMedia = new target.Set()
    const gameVolumeByMedia = new target.WeakMap()
    const mediaProto = target.HTMLMediaElement?.prototype
    const volumeDescriptor = mediaProto
      ? Object.getOwnPropertyDescriptor(mediaProto, 'volume')
      : null
    const applyMedia = (media) => {
      if (!volumeDescriptor?.set) return
      const gameVolume = gameVolumeByMedia.get(media) ?? volumeDescriptor.get.call(media)
      volumeDescriptor.set.call(media, clamp(gameVolume * factor(classify(media.currentSrc || media.src)), 0, 1))
    }
    if (mediaProto && volumeDescriptor?.get && volumeDescriptor?.set && volumeDescriptor.configurable) {
      Object.defineProperty(mediaProto, 'volume', {
        ...volumeDescriptor,
        get() {
          return gameVolumeByMedia.get(this) ?? volumeDescriptor.get.call(this)
        },
        set(value) {
          gameVolumeByMedia.set(this, clamp(Number(value) || 0, 0, 1))
          liveMedia.add(this)
          applyMedia(this)
        },
      })
      target.document.addEventListener(
        'play',
        (event) => {
          const media = event.target
          if (!(media instanceof target.HTMLMediaElement)) return
          if (!gameVolumeByMedia.has(media)) {
            gameVolumeByMedia.set(media, volumeDescriptor.get.call(media))
          }
          liveMedia.add(media)
          applyMedia(media)
        },
        true,
      )
    }

    const refresh = () => {
      const next = normalize(settingsBridge?.getGameAudioSettings?.())
      if (
        next.volume === settings.volume &&
        next.voiceVolume === settings.voiceVolume &&
        next.bgmVolume === settings.bgmVolume &&
        next.mode === settings.mode
      ) return
      settings = next
      for (const state of liveSources) state.gain.gain.value = factor(state.category)
      for (const media of liveMedia) applyMedia(media)
    }
    target.setInterval(refresh, 250)

    // 只读快照，给「游戏音频链路自检」那张卡看。纯统计，不发请求、不碰播放。
    return () => {
      const tally = () => ({ voice: 0, bgm: 0, other: 0 })
      const sources = tally()
      for (const state of liveSources) sources[state.category] += 1
      const media = tally()
      for (const element of liveMedia) media[classify(element.currentSrc || element.src)] += 1
      return {
        frame: stats.frame,
        captures: { ...stats.captures },
        sources,
        media,
        decodes: stats.decodes.map((entry) => ({ ...entry })),
        voiceDurations: voiceDurations.map((entry) => ({ ...entry })),
      }
    }
  }

  const settingsBridge = hostWindow.kansoPreloadBridge
  // 每个装上钩子的帧留一份快照器：顶层帧读回时把各帧汇总起来，
  // 少了哪个帧在卡上一眼看得见。
  const snapshots = []
  const register = (target) => {
    const snapshot = setup(target, settingsBridge)
    if (snapshot) snapshots.push(snapshot)
  }
  register(hostWindow)
  Object.defineProperty(hostWindow, 'installKansoAudioControl', {
    configurable: true,
    value: (target) => register(target),
  })
  Object.defineProperty(hostWindow, 'kansoGameAudioStats', {
    configurable: true,
    value: () => snapshots.map((snapshot) => snapshot()),
  })
}

module.exports = {
  GAME_AUDIO_POLICY,
  classifyGameAudioUrl,
  gameAudioGainFor,
  installGameAudioControl,
  normalizeGameAudioSettings,
}
