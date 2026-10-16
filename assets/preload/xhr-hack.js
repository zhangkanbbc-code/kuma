// Adapted from poi (https://github.com/poooi/poi) assets/js/xhr-hack.js
// MIT License, Copyright (c) poi contributors — 移植与改造：kuma 项目。
// MAIN WORLD
// 经 contextBridge.executeInMainWorld 序列化进页面主世界，替换 XMLHttpRequest
// 以截获游戏自身请求。必须自包含：只引用全局量与 window.kumaPreloadBridge。
function installXhrHack() {
  const bridge = window.kumaPreloadBridge

  // 白名单只含本地显示坐标。资源地址、舰船参数与其它表一律不参与改写。
  const coordinateFields = [
    'api_boko_n', 'api_boko_d', 'api_kaisyu_n', 'api_kaisyu_d', 'api_kaizo_n', 'api_kaizo_d',
    'api_map_n', 'api_map_d', 'api_ensyuf_n', 'api_ensyuf_d', 'api_ensyue_n', 'api_ensyue_d',
    'api_battle_n', 'api_battle_d', 'api_weda',
  ]

  // JSON 已由 JSON.parse 验证；这里只定位白名单值的原始片段，保留其它字节与 svdata=。
  const patchCoordinateText = (text, data, edits) => {
    const tokens = /"(?:\\.|[^"\\])*"|[{}\[\],:]|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/g
    const replacements = []
    const next = () => tokens.exec(text)
    const visit = (value, changes) => {
      const first = next()
      let end = tokens.lastIndex
      if (first[0] === '{') {
        let token = next()
        for (; token[0] !== '}'; token = next()) {
          if (token[0] === ',') token = next()
          const key = JSON.parse(token[0])
          next() // colon
          visit(value[key], changes && Object.hasOwn(changes, key) ? changes[key] : undefined)
        }
        const additions = Object.keys(changes || {}).filter((key) => !Object.hasOwn(value, key))
        if (additions.length) replacements.push([token.index, token.index,
          (Object.keys(value).length ? ',' : '') + additions.map((key) => `${JSON.stringify(key)}:${JSON.stringify(changes[key])}`).join(',')])
        end = tokens.lastIndex
      } else if (first[0] === '[') {
        let index = 0
        while (true) {
          const position = tokens.lastIndex
          const token = next()
          if (token[0] === ']') break
          if (token[0] !== ',') tokens.lastIndex = position
          visit(value[index], changes && changes[index])
          index++
        }
        end = tokens.lastIndex
      }
      if (Array.isArray(changes)) replacements.push([first.index, end, JSON.stringify(changes)])
    }
    visit(data, { api_data: { api_mst_shipgraph: edits } })
    const chunks = []
    let position = 0
    for (const [start, end, value] of replacements) {
      chunks.push(text.slice(position, start), value)
      position = end
    }
    chunks.push(text.slice(position))
    return chunks.join('')
  }

  const toPathname = (rawUrl) => {
    try {
      return new URL(rawUrl).pathname
    } catch (_e) {
      return undefined
    }
  }

  // 保留 hack 函数：子 iframe preload 失效时由父窗口补装
  window.hackXhr = (win = window) => {
    if (win.xhrHacked) {
      return false
    }

    const OriginalXMLHttpRequest = win.XMLHttpRequest

    win.XMLHttpRequest = class HackedXMLHttpRequest extends OriginalXMLHttpRequest {
      constructor() {
        super()

        this.method = 'GET'
        this.requestURL = ''
        this.request = ''
        this.responseHack = undefined
        this.responseTextHack = undefined
        this.responseXMLHack = undefined
        this.coordinatesPrepared = false

        // 构造时先注册，早于游戏自己的 DONE/readystatechange、load 处理器。
        // getter 也同步兜底，确保两个属性在游戏首次读取时已经就位。
        this.addEventListener('readystatechange', () => {
          if (this.readyState === 4) this.prepareCoordinates()
        })

        this.addEventListener('load', () => {
          const responseURL = this.responseURL || this.requestURL
          bridge.sendRequest(this.method, toPathname(responseURL), responseURL, this.request)
        })
        this.addEventListener('loadend', () => {
          if (!this.responseType || ['json', 'text'].includes(this.responseType)) {
            bridge.sendResponse(
              this.method,
              toPathname(this.responseURL),
              this.responseURL,
              this.request,
              super.response,
              this.responseType,
              this.status,
            )
          }
        })
        this.addEventListener('error', () => {
          const responseURL = this.responseURL || this.requestURL
          bridge.sendError(toPathname(responseURL), responseURL, this.status)
        })
      }

      open(method, requestURL, ...props) {
        this.coordinatesPrepared = false
        this.responseHack = undefined
        this.responseTextHack = undefined
        this.method = method
        this.requestURL = new URL(requestURL, win.location.href).href
        super.open(method, requestURL, ...props)
      }

      send(body) {
        this.request = body
        super.send(body)
      }

      prepareCoordinates() {
        if (this.coordinatesPrepared || this.readyState !== 4) return
        this.coordinatesPrepared = true
        if (toPathname(this.responseURL || this.requestURL) !== '/kcsapi/api_start2/getData' ||
            (this.responseType && !['text', 'json'].includes(this.responseType))) return
        try {
          // 父页补装的子帧只能用子帧自己的桥；preload 失效时坐标原样放行。
          const coordinateBridge = win === window ? bridge : win.kumaPreloadBridge
          if (!coordinateBridge || !coordinateBridge.getShipgraphCoordinates) return
          const raw = super.response
          const isText = typeof raw === 'string'
          const prefix = isText && raw.startsWith('svdata=') ? 'svdata=' : ''
          const text = isText ? raw.slice(prefix.length) : JSON.stringify(raw)
          const data = JSON.parse(text)
          const graphs = data.api_data && data.api_data.api_mst_shipgraph
          if (!Array.isArray(graphs)) return
          const table = coordinateBridge.getShipgraphCoordinates(graphs.map((graph) => graph.api_filename))
          const edits = {}
          for (const [index, graph] of graphs.entries()) {
            const coordinates = table && Object.hasOwn(table, graph.api_filename) ? table[graph.api_filename] : undefined
            if (!coordinates) continue
            for (const field of coordinateFields) {
              const pair = coordinates[field]
              if (!Array.isArray(pair) || pair.length !== 2 || !pair.every(Number.isFinite)) continue
              if (!edits[index]) edits[index] = {}
              edits[index][field] = pair
            }
          }
          if (!Object.keys(edits).length) return
          const patched = patchCoordinateText(text, data, edits)
          const response = isText ? prefix + patched : JSON.parse(patched)
          this.responseHack = response
          if (isText) this.responseTextHack = response
        } catch (_e) {
          console.warn('[kuma] failed to apply local shipgraph coordinates; using original response')
        }
      }

      get response() {
        this.prepareCoordinates()
        return this.responseHack || super.response
      }

      set response(response) {
        this.responseHack = response
      }

      get responseText() {
        this.prepareCoordinates()
        return this.responseTextHack || super.responseText
      }

      set responseText(responseText) {
        this.responseTextHack = responseText
      }

      get responseXML() {
        return this.responseXMLHack || super.responseXML
      }

      set responseXML(responseXML) {
        this.responseXMLHack = responseXML
      }
    }

    win.xhrHacked = true

    return true
  }

  window.hackXhr()
}

module.exports = { installXhrHack }
