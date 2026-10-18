// ISOLATED WORLD：只读取本地魔改坐标，不把 fs 或文件路径暴露给游戏页。
const fs = require('fs')
const path = require('path')
const { getModRoots, isPathWithinRoot, modPeriodOf } = require('./kcs-resource-path')
const { modNightSettingsPayload } = require('./mod-night-settings-bridge')

const GRAPH_NAMES = [
  'boko_n', 'boko_d', 'kaisyu_n', 'kaisyu_d', 'kaizo_n', 'kaizo_d', 'map_n', 'map_d',
  'ensyuf_n', 'ensyuf_d', 'ensyue_n', 'ensyue_d', 'battle_n', 'battle_d', 'weda',
]
const MAX_COORDINATE_BYTES = 64 * 1024

const coordinateText = (bytes) => {
  const bom = bytes[0] === 0xff && bytes[1] === 0xfe
  return bom || bytes[1] === 0
    ? bytes.subarray(bom ? 2 : 0).toString('utf16le') : bytes.toString('utf8').replace(/^\uFEFF/, '')
}

const parseShipgraphCoordinates = (bytes, warn = console.warn) => {
  const text = coordinateText(bytes)
  const values = Object.create(null)
  let graph = false
  for (const line of text.split(/\r\n|\n|\r/)) {
    const section = /^\s*\[([^\]]+)\]\s*(?:[;#].*)?$/.exec(line)
    if (section) { graph = section[1].trim() === 'graph'; continue }
    if (!graph) continue
    const pair = /^\s*(\w+)\s*=\s*(.*?)\s*$/.exec(line)
    if (pair) values[pair[1]] = pair[2]
  }
  const result = {}
  const number = (value) => typeof value === 'string' &&
    /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value) && Number.isFinite(Number(value))
  for (const name of GRAPH_NAMES) {
    const left = values[`${name}_left`], top = values[`${name}_top`]
    if (left === undefined && top === undefined) continue
    if (!number(left) || !number(top)) {
      warn(`[kuma] ignored invalid shipgraph coordinate: ${name}`)
      continue
    }
    result[`api_${name}`] = [Number(left), Number(top)]
  }
  return result
}

const parseJsonCoordinates = (bytes, warn) => {
  let data
  try {
    data = JSON.parse(coordinateText(bytes))
  } catch (error) {
    if (error instanceof SyntaxError) return null
    throw error
  }
  const graph = data?.api_mst_shipgraph
  if (!graph || typeof graph !== 'object' || Array.isArray(graph)) return null
  const result = {}
  for (const name of GRAPH_NAMES) {
    const value = graph[`api_${name}`]
    if (value === undefined) continue
    if (!Array.isArray(value) || value.length !== 2 || !value.every(Number.isFinite)) {
      warn(`[kuma] ignored invalid shipgraph coordinate: ${name}`)
      continue
    }
    result[`api_${name}`] = value
  }
  return result
}

const readCoordinateFile = (file, json, warnings) => {
  const fd = fs.openSync(file, 'r')
  try {
    const stat = fs.fstatSync(fd)
    if (!stat.isFile() || stat.size > MAX_COORDINATE_BYTES) throw new RangeError('shipgraph coordinate file exceeds size limit')
    // 固定上限读取，文件在 stat 后增长也不会无限分配或读取。
    const bytes = Buffer.alloc(MAX_COORDINATE_BYTES + 1)
    let length = 0, count
    while (length < bytes.length && (count = fs.readSync(fd, bytes, length, bytes.length - length, null)) > 0) length += count
    if (length > MAX_COORDINATE_BYTES) throw new RangeError('shipgraph coordinate file exceeds size limit')
    const result = (json ? parseJsonCoordinates : parseShipgraphCoordinates)(bytes.subarray(0, length), message => warnings.push(message))
    // 沿用 ini 的逐对校验；没有有效坐标且存在坏字段时，才把整份判为无效。空配置仍整份采用。
    return result && (!warnings.length || Object.keys(result).length) ? result : null
  } finally {
    fs.closeSync(fd)
  }
}

const readShipgraphCoordinates = (cacheDir, filenames, { period = null, warn = console.warn } = {}) => {
  const table = Object.create(null)
  // api_filename 是文件名主体，不接受分隔符、..、盘符、UNC 或编码路径。
  const requested = [...new Set(filenames)].filter((filename) =>
    typeof filename === 'string' && /^[a-zA-Z0-9_-]+$/.test(filename))
  const timed = period === 'day' || period === 'night'
  const keys = new Set(requested.flatMap((filename) => {
    const key = filename.toLowerCase()
    return timed ? [`${key}.${period}`, key] : [key]
  }))
  const roots = []
  // 每次 start2 只列一次目录；无坐标时不再按上千个文件名逐一探测磁盘。
  for (const root of getModRoots(cacheDir, period)) {
    const directories = []
    for (const tree of ['kcs', 'kcs2']) {
      const directory = path.join(root, tree, 'resources', 'swf', 'ships')
      let entries
      try {
        entries = fs.readdirSync(directory)
      } catch (error) {
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR') continue
        throw error
      }
      const files = new Map()
      for (const entry of entries) {
        const lower = entry.toLowerCase()
        const match = /^(.*)\.config\.(ini|json)$/.exec(lower)
        if (!match || !keys.has(match[1])) continue
        if (!files.has(match[1])) files.set(match[1], {})
        files.get(match[1])[match[2]] = entry
      }
      directories.push({ directory, files })
    }
    if (!directories.some(({ files }) => files.size)) continue
    let realRoot
    try {
      realRoot = fs.realpathSync(root)
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') continue
      throw error
    }
    roots.push({ root, realRoot, directories })
  }
  for (const filename of requested) {
    let found = false
    for (const { root, realRoot, directories } of roots) {
      for (const { directory, files } of directories) {
        const key = filename.toLowerCase()
        for (const stem of timed ? [`${key}.${period}`, key] : [key]) {
          const pair = files.get(stem)
          if (!pair) continue
          const candidates = []
          for (const format of ['json', 'ini']) {
            if (!pair[format]) continue
            const candidate = path.join(directory, pair[format])
            if (!isPathWithinRoot(root, candidate)) continue
            let realFile
            try {
              realFile = fs.realpathSync(candidate)
            } catch (error) {
              if (error.code === 'ENOENT' || error.code === 'ENOTDIR') continue
              throw error
            }
            if (isPathWithinRoot(realRoot, realFile)) candidates.push({ file: realFile, format })
          }
          // 只为目录清单里同名并存的一对读取修改时间；单文件沿用有界读取的 fstat。
          if (candidates.length === 2) {
            for (const candidate of candidates) candidate.mtime = fs.statSync(candidate.file).mtimeMs
            candidates.sort((a, b) => b.mtime - a.mtime) // 初始 json 在前，同时间优先。
          }
          for (const { file, format } of candidates) {
            const warnings = []
            let result
            try {
              result = readCoordinateFile(file, format === 'json', warnings)
            } catch (error) {
              if (!(error instanceof RangeError) || candidates.length !== 2) throw error
              continue
            }
            if (!result) continue
            for (const message of warnings) warn(message)
            table[filename] = result
            found = true
            break
          }
          if (found) break
          if (candidates.length) warn(`[kuma] ignored invalid shipgraph coordinate file: ${stem}`)
        }
        if (found) break
      }
      if (found) break // 同名文件整份采用；不跨树、跨时段根补字段。
    }
  }
  return table
}

const createShipgraphCoordinateReader = (remote) => {
  const config = remote.require('./config')
  return (filenames) => readShipgraphCoordinates(
    config.get('kuma.cache.path', remote.getGlobal('DEFAULT_CACHE_PATH')),
    filenames,
    { period: modPeriodOf(new Date(), modNightSettingsPayload((key, fallback) => config.get(key, fallback))) },
  )
}

module.exports = { parseShipgraphCoordinates, readShipgraphCoordinates, createShipgraphCoordinateReader, MAX_COORDINATE_BYTES }
