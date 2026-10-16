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

const parseShipgraphCoordinates = (bytes, warn = console.warn) => {
  const bom = bytes[0] === 0xff && bytes[1] === 0xfe
  const text = bom || bytes[1] === 0
    ? bytes.subarray(bom ? 2 : 0).toString('utf16le') : bytes.toString('utf8').replace(/^\uFEFF/, '')
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

const readShipgraphCoordinates = (cacheDir, filenames, { period = null, warn = console.warn } = {}) => {
  const table = Object.create(null)
  // api_filename 是文件名主体，不接受分隔符、..、盘符、UNC 或编码路径。
  const requested = [...new Set(filenames)].filter((filename) =>
    typeof filename === 'string' && /^[a-zA-Z0-9_-]+$/.test(filename))
  const keys = new Set(requested.map((filename) => filename.toLowerCase()))
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
        if (lower.endsWith('.config.ini') && keys.has(lower.slice(0, -11))) files.set(lower.slice(0, -11), entry)
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
        const entry = files.get(filename.toLowerCase())
        if (!entry) continue
        const candidate = path.join(directory, entry)
        if (!isPathWithinRoot(root, candidate)) continue
        let realFile
        try {
          realFile = fs.realpathSync(candidate)
        } catch (error) {
          if (error.code === 'ENOENT' || error.code === 'ENOTDIR') continue
          throw error
        }
        if (!isPathWithinRoot(realRoot, realFile)) continue
        const fd = fs.openSync(realFile, 'r')
        try {
          const stat = fs.fstatSync(fd)
          if (!stat.isFile() || stat.size > MAX_COORDINATE_BYTES) throw new Error('shipgraph coordinate file exceeds size limit')
          // 固定上限读取，文件在 stat 后增长也不会无限分配或读取。
          const bytes = Buffer.alloc(MAX_COORDINATE_BYTES + 1)
          let length = 0, count
          while (length < bytes.length && (count = fs.readSync(fd, bytes, length, bytes.length - length, null)) > 0) length += count
          if (length > MAX_COORDINATE_BYTES) throw new Error('shipgraph coordinate file exceeds size limit')
          table[filename] = parseShipgraphCoordinates(bytes.subarray(0, length), warn)
        } finally {
          fs.closeSync(fd)
        }
        found = true
        break
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
