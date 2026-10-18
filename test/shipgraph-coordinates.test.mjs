import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import test from 'node:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { parseShipgraphCoordinates, readShipgraphCoordinates, createShipgraphCoordinateReader, MAX_COORDINATE_BYTES } =
  require('../assets/preload/shipgraph-coordinates.js')
const { installXhrHack } = require('../assets/preload/xhr-hack.js')
const fixture = fs.readFileSync(new URL('./fixtures/erhlwuihpcnw.config.ini', import.meta.url))
const start2 = fs.readFileSync(new URL('./fixtures/shipgraph-start2.json', import.meta.url), 'utf8')
const names = ['boko_n', 'boko_d', 'kaisyu_n', 'kaisyu_d', 'kaizo_n', 'kaizo_d', 'map_n', 'map_d',
  'ensyuf_n', 'ensyuf_d', 'ensyue_n', 'ensyue_d', 'battle_n', 'battle_d', 'weda']
const expected = Object.fromEntries(names.map((name, index) => [`api_${name}`, [
  [-28, 121], [73, 198], [50, 22], [22, 3], [-79, 45], [30, 92], [-54, 37], [32, 103],
  [6, 110], [107, 150], [8, 144], [84, 169], [6, 110], [107, 150], [457, 16],
][index]]))
const plain = (value) => JSON.parse(JSON.stringify(value))
const withDir = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-coordinates-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}
const write = (dir, root = 'KanColle', filename = 'erhlwuihpcnw', bytes = fixture, tree = 'kcs', format = 'ini') => {
  const file = path.join(dir, root, tree, 'resources', 'swf', 'ships', `${filename}.config.${format}`)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, bytes)
  return file
}

test('玩家真实 ini：15 对坐标逐一正确，[info] 不进入结果', () => {
  assert.deepEqual(parseShipgraphCoordinates(fixture), expected)
  assert.equal(Object.keys(expected).length, 15)
})

for (const [label, bytes] of [
  ['UTF-8 BOM', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), fixture])],
  ['UTF-16LE BOM', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(fixture.toString(), 'utf16le')])],
  ['UTF-16LE 无 BOM', Buffer.from(fixture.toString(), 'utf16le')],
  ['CRLF', Buffer.from(fixture.toString().replace(/\r?\n/g, '\r\n'))],
]) {
  test(`ini 编码与换行：${label}`, () => assert.deepEqual(parseShipgraphCoordinates(bytes), expected))
}

for (const [label, invalid] of [
  ['缺 top', 'boko_n_left=1'], ['缺 left', 'boko_n_top=2'],
  ['非数值', 'boko_n_left=abc\nboko_n_top=2'], ['空值', 'boko_n_left=\nboko_n_top=2'],
  ['数值越界', 'boko_n_left=1e309\nboko_n_top=2'], ['非有限数', 'boko_n_left=Infinity\nboko_n_top=NaN'],
]) {
  test(`ini ${label}：只丢弃这一对、保留其它对并记录一次`, () => {
    const warnings = []
    const result = parseShipgraphCoordinates(Buffer.from(`[graph]\n${invalid}\nmap_n_left=-2.5\nmap_n_top=3e1`), message => warnings.push(message))
    assert.deepEqual(result, { api_map_n: [-2.5, 30] })
    assert.equal(warnings.length, 1)
    assert.match(warnings[0], /boko_n/)
  })
}

test('只认 graph 白名单：info 的坐标、名字台词、地址字段及未知键全部忽略', () => {
  const bytes = Buffer.from('[info]\nboko_n_left=999\nboko_n_top=999\nship_name=改名\ngetmes=台词\n' +
    '[graph]\nmap_n_left=1\nmap_n_top=2\nfilename_left=3\nfilename_top=4\napi_version=bad\n' +
    '[info] ; 其它段\nmap_n_left=999\nmap_n_top=999')
  assert.deepEqual(parseShipgraphCoordinates(bytes), { api_map_n: [1, 2] })
})

test('根优先与回落：白天、夜间、关闭定时；同名文件整份采用，不跨根合并', (t) => {
  const dir = withDir(t)
  write(dir)
  write(dir, 'KanColle', 'base-only')
  write(dir, 'KanColle-白天', 'erhlwuihpcnw', '[graph]\nboko_n_left=1\nboko_n_top=2')
  write(dir, 'KanColle-夜间', 'erhlwuihpcnw', '[graph]\nboko_d_left=3\nboko_d_top=4', 'kcs2')
  for (const [period, coordinates] of [['day', { api_boko_n: [1, 2] }], ['night', { api_boko_d: [3, 4] }], [null, expected]]) {
    const table = readShipgraphCoordinates(dir, ['erhlwuihpcnw', 'base-only'], { period })
    assert.deepEqual(table.erhlwuihpcnw, coordinates)
    assert.deepEqual(table['base-only'], expected)
  }
})

test('先找到的空坐标文件也不从常驻根补字段；无效 json 不生效、不认 hack 坐标后缀', (t) => {
  const dir = withDir(t)
  write(dir)
  const file = write(dir, 'KanColle-白天', 'erhlwuihpcnw', '[info]\nship_name=忽略')
  fs.writeFileSync(file.replace('.config.ini', '.config.json'), JSON.stringify(expected))
  fs.writeFileSync(file.replace('.config.ini', '.hack.config.ini'), fixture)
  assert.deepEqual(readShipgraphCoordinates(dir, ['erhlwuihpcnw'], { period: 'day' }).erhlwuihpcnw, {})
  fs.unlinkSync(file)
  fs.unlinkSync(path.join(dir, 'KanColle', 'kcs/resources/swf/ships/erhlwuihpcnw.config.ini'))
  const warnings = []
  assert.deepEqual(plain(readShipgraphCoordinates(dir, ['erhlwuihpcnw'], { period: 'day', warn: message => warnings.push(message) })), {})
  assert.equal(warnings.length, 1)
})

test('隔离世界读取器：现用配置、时段和磁盘；每次 start2 都重新读取', (t) => {
  const dir = withDir(t)
  const values = { 'kuma.cache.path': dir, 'kuma.mod.night.enabled': true,
    'kuma.mod.night.start': '00:00', 'kuma.mod.night.end': '00:00' }
  const config = { get: (key, fallback) => values[key] ?? fallback }
  const reader = createShipgraphCoordinateReader({ require: () => config, getGlobal: () => dir })
  write(dir)
  const day = write(dir, 'KanColle-白天', 'erhlwuihpcnw', '[graph]\nweda_left=1\nweda_top=2')
  assert.deepEqual(reader(['erhlwuihpcnw']).erhlwuihpcnw, { api_weda: [1, 2] })
  fs.writeFileSync(day, '[graph]\nweda_left=3\nweda_top=4')
  assert.deepEqual(reader(['erhlwuihpcnw']).erhlwuihpcnw, { api_weda: [3, 4] })
  // 让当前小时落在夜间区间内，独立于运行测试时的本机时刻。
  const hour = new Date().getHours()
  values['kuma.mod.night.start'] = `${String(hour).padStart(2, '0')}:00`
  values['kuma.mod.night.end'] = `${String((hour + 1) % 24).padStart(2, '0')}:00`
  write(dir, 'KanColle-夜间', 'erhlwuihpcnw', '[graph]\nweda_left=5\nweda_top=6')
  assert.deepEqual(reader(['erhlwuihpcnw']).erhlwuihpcnw, { api_weda: [5, 6] })
  values['kuma.mod.night.enabled'] = false
  assert.deepEqual(reader(['erhlwuihpcnw']).erhlwuihpcnw, expected)
})

test('路径钳制：拒绝 ..、分隔符、盘符、UNC、编码路径，且不探测这些路径', (t) => {
  const dir = withDir(t)
  const original = fs.realpathSync
  let probes = 0
  fs.realpathSync = (...args) => { probes++; return original(...args) }
  try {
    const table = readShipgraphCoordinates(dir, ['../escape', 'a/../b', '..', 'a\\b', 'C:secret', '\\\\host\\share', '%2e%2e', 'x.config.ini'])
    assert.deepEqual(plain(table), {})
    assert.equal(probes, 0)
  } finally { fs.realpathSync = original }
})

test('路径钳制：不跟随目录链接逃出根，也不读取根外目标文件', (t) => {
  const dir = withDir(t)
  const outside = path.join(dir, 'outside')
  fs.mkdirSync(outside)
  fs.writeFileSync(path.join(outside, 'erhlwuihpcnw.config.ini'), fixture)
  const ships = path.dirname(write(dir, 'KanColle', 'placeholder'))
  fs.rmSync(ships, { recursive: true })
  fs.symlinkSync(outside, ships, process.platform === 'win32' ? 'junction' : 'dir')
  const original = fs.openSync
  let opens = 0
  fs.openSync = (...args) => { opens++; return original(...args) }
  try {
    assert.deepEqual(plain(readShipgraphCoordinates(dir, ['erhlwuihpcnw'])), {})
    assert.equal(opens, 0)
  } finally { fs.openSync = original }
})

test('文件大小上限：超限文件拒绝，异常交给 XHR 原样放行', (t) => {
  const dir = withDir(t)
  write(dir, 'KanColle', 'erhlwuihpcnw', Buffer.alloc(MAX_COORDINATE_BYTES + 1))
  assert.throws(() => readShipgraphCoordinates(dir, ['erhlwuihpcnw']), /size limit/)
})

const countCoordinateFs = (read) => {
  const methods = ['readdirSync', 'realpathSync', 'statSync', 'openSync', 'fstatSync', 'readSync', 'closeSync']
  const originals = Object.fromEntries(methods.map(method => [method, fs[method]]))
  const calls = Object.fromEntries(methods.map(method => [method, []]))
  for (const method of methods) fs[method] = (...args) => {
    calls[method].push(args[0])
    return originals[method](...args)
  }
  try { return { result: read(), calls } } finally {
    for (const method of methods) fs[method] = originals[method]
  }
}

test('无坐标文件：目录缺失或只有图片/无关 JSON，1 与 1600 个文件名的文件系统调用次数相同', (t) => {
  const dir = withDir(t)
  const filenames = Array.from({ length: 1600 }, (_, index) => `ship${index}`)
  for (const populated of [false, true]) {
    if (populated) {
      for (const root of ['KanColle', 'KanColle-白天', 'KanColle-夜间']) {
        for (const tree of ['kcs', 'kcs2']) {
          const directory = path.join(dir, root, tree, 'resources', 'swf', 'ships')
          fs.mkdirSync(directory, { recursive: true })
          fs.writeFileSync(path.join(directory, 'ship0.hack.png'), 'image')
          fs.writeFileSync(path.join(directory, 'ship0.json'), '{}')
        }
      }
    }
    for (const period of [null, 'day', 'night']) {
      const counts = []
      for (const size of [1, 1600]) {
        const { result, calls } = countCoordinateFs(() => readShipgraphCoordinates(dir, filenames.slice(0, size), { period }))
        assert.deepEqual(plain(result), {})
        assert.equal(calls.readdirSync.length, period ? 4 : 2)
        assert.equal(new Set(calls.readdirSync).size, calls.readdirSync.length, '每个目录只列一次')
        for (const method of ['realpathSync', 'statSync', 'openSync', 'fstatSync', 'readSync', 'closeSync']) assert.equal(calls[method].length, 0, method)
        counts.push(Object.fromEntries(Object.entries(calls).map(([method, paths]) => [method, paths.length])))
      }
      assert.deepEqual(counts[0], counts[1])
    }
  }
})

test('目录清单命中后结果沿用原优先级与整份采用，每个根只 realpath 一次', (t) => {
  const dir = withDir(t)
  write(dir)
  write(dir, 'KanColle', 'other', '[graph]\nmap_n_left=3\nmap_n_top=4', 'kcs2')
  write(dir, 'KanColle-白天', 'erhlwuihpcnw', '[graph]\nboko_n_left=1\nboko_n_top=2')
  write(dir, 'KanColle-夜间', 'erhlwuihpcnw', '[graph]\nboko_d_left=5\nboko_d_top=6', 'kcs2')
  const filenames = ['erhlwuihpcnw', 'other', ...Array.from({ length: 1598 }, (_, index) => `missing${index}`)]
  for (const [period, expectedGraph, activeRoot] of [
    [null, expected, null], ['day', { api_boko_n: [1, 2] }, 'KanColle-白天'], ['night', { api_boko_d: [5, 6] }, 'KanColle-夜间'],
  ]) {
    const { result, calls } = countCoordinateFs(() => readShipgraphCoordinates(dir, filenames, { period }))
    assert.deepEqual(plain(result), { erhlwuihpcnw: expectedGraph, other: { api_map_n: [3, 4] } })
    const roots = [path.join(dir, 'KanColle'), ...(activeRoot ? [path.join(dir, activeRoot)] : [])]
    for (const root of roots) assert.equal(calls.realpathSync.filter(file => file === root).length, 1)
    assert.equal(calls.realpathSync.length, roots.length + 2, '只 realpath 两个实际采用的文件及其根')
    assert.equal(calls.openSync.length, 2)
    assert.equal(calls.readdirSync.length, period ? 4 : 2)
  }
})

test('文件名主体和扩展名按小写比对，读取实际大小写的文件；清单外与未请求文件不读取', (t) => {
  const dir = withDir(t)
  const file = write(dir, 'KanColle', 'UPPER')
  fs.renameSync(file, file.replace('.config.ini', '.CONFIG.INI'))
  write(dir, 'KanColle', 'not-requested', Buffer.alloc(MAX_COORDINATE_BYTES + 1))
  const { result, calls } = countCoordinateFs(() => readShipgraphCoordinates(dir, ['uPpEr', 'missing']))
  assert.deepEqual(plain(result), { uPpEr: expected })
  assert.equal(calls.realpathSync.length, 2)
  assert.equal(calls.openSync.length, 1)
  assert.match(calls.openSync[0], /UPPER\.CONFIG\.INI$/)
})

const jsonCoordinates = (graph, ship = { api_name: '不改名字', api_getmes: false, api_sinfo: false }) =>
  JSON.stringify({ api_mst_ship: ship, api_mst_shipgraph: graph })

for (const period of ['day', 'night']) {
  test(`坐标后缀 ${period}：根、目录、后缀逐层优先，关闭后只用常驻无后缀`, (t) => {
    const dir = withDir(t)
    const active = period === 'day' ? 'KanColle-白天' : 'KanColle-夜间'
    const base = write(dir)
    write(dir, 'KanColle', `erhlwuihpcnw.${period}`, '[graph]\nmap_n_left=1\nmap_n_top=2')
    write(dir, 'KanColle', 'erhlwuihpcnw.nigth', '[graph]\nweda_left=99\nweda_top=99')
    const read = () => readShipgraphCoordinates(dir, ['erhlwuihpcnw'], { period }).erhlwuihpcnw
    assert.deepEqual(read(), { api_map_n: [1, 2] })
    assert.deepEqual(readShipgraphCoordinates(dir, ['erhlwuihpcnw']).erhlwuihpcnw, expected)
    write(dir, active, 'erhlwuihpcnw', '[graph]\nboko_d_left=3\nboko_d_top=4')
    assert.deepEqual(read(), { api_boko_d: [3, 4] }, '时段根的无后缀优先于常驻后缀')
    write(dir, active, `erhlwuihpcnw.${period}`, '[graph]\nweda_left=5\nweda_top=6', 'kcs2')
    assert.deepEqual(read(), { api_boko_d: [3, 4] }, 'kcs 优先级保留，后缀只在各 ships 内优先')
    write(dir, active, `erhlwuihpcnw.${period}`, '[graph]\nboko_n_left=7\nboko_n_top=8')
    assert.deepEqual(read(), { api_boko_n: [7, 8] }, '同目录后缀整份采用')
    fs.unlinkSync(base)
    assert.deepEqual(plain(readShipgraphCoordinates(dir, ['erhlwuihpcnw'])), {}, '关闭时不认后缀和时段根')
    write(dir, 'KanColle', 'typo-only.nigth')
    assert.deepEqual(plain(readShipgraphCoordinates(dir, ['typo-only'], { period })), {}, 'nigth 不是支持的后缀')
  })
}

test('json 单独存在：只用 shipgraph 的 15 个显示坐标，文字及其它字段全部忽略', (t) => {
  const dir = withDir(t)
  const graph = { ...expected, api_name: [1, 2], api_getmes: [1, 2], api_filename: [1, 2], api_unknown: [1, 2] }
  write(dir, 'KanColle', 'json-only', jsonCoordinates(graph), 'kcs', 'json')
  const { result, calls } = countCoordinateFs(() => readShipgraphCoordinates(dir, ['json-only']))
  assert.deepEqual(result['json-only'], expected)
  assert.equal(calls.statSync.length, 0, '单文件不为修改时间 stat')
  assert.equal(calls.openSync.length, 1)
})

for (const [label, encode] of [
  ['UTF-8', text => Buffer.from(text)],
  ['UTF-8 BOM', text => Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text)])],
  ['UTF-16LE BOM', text => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')])],
  ['UTF-16LE 无 BOM', text => Buffer.from(text, 'utf16le')],
]) {
  test(`json 编码与 ini 一致：${label}`, (t) => {
    const dir = withDir(t)
    write(dir, 'KanColle', 'encoded', encode(jsonCoordinates(expected)), 'kcs', 'json')
    assert.deepEqual(readShipgraphCoordinates(dir, ['encoded']).encoded, expected)
  })
}

for (const invalid of [null, false, '1,2', [], [1], [1, 2, 3], ['1', 2], [null, 2], { 0: 1, 1: 2 }]) {
  test(`json 坐标只接受两个有限数的数组：${JSON.stringify(invalid)}`, (t) => {
    const dir = withDir(t), warnings = []
    write(dir, 'KanColle', 'invalid', jsonCoordinates({ api_boko_n: invalid, api_map_n: [-2.5, 30] }), 'kcs', 'json')
    assert.deepEqual(readShipgraphCoordinates(dir, ['invalid'], { warn: message => warnings.push(message) }).invalid, { api_map_n: [-2.5, 30] })
    assert.equal(warnings.length, 1, '与 ini 一样只丢弃坏坐标对')
  })
}

for (const [label, iniTime, jsonTime, wanted] of [
  ['ini 较新', 200, 100, { api_boko_n: [1, 2] }],
  ['json 较新', 100, 200, { api_map_n: [3, 4] }],
  ['同时间 json 优先', 200, 200, { api_map_n: [3, 4] }],
]) {
  test(`同名 ini/json：${label}，整份采用不补字段`, (t) => {
    const dir = withDir(t)
    const ini = write(dir, 'KanColle', 'paired', '[graph]\nboko_n_left=1\nboko_n_top=2')
    const json = write(dir, 'KanColle', 'paired', jsonCoordinates({ api_map_n: [3, 4] }), 'kcs', 'json')
    fs.utimesSync(ini, iniTime, iniTime)
    fs.utimesSync(json, jsonTime, jsonTime)
    const { result, calls } = countCoordinateFs(() => readShipgraphCoordinates(dir, ['paired']))
    assert.deepEqual(result.paired, wanted)
    assert.deepEqual(new Set(calls.statSync), new Set([fs.realpathSync(ini), fs.realpathSync(json)]))
    assert.equal(calls.openSync.length, 1, '选中有效文件即停止，不读另一个')
    assert.match(calls.openSync[0], iniTime > jsonTime ? /\.ini$/ : /\.json$/)
  })
}

for (const invalid of ['{', '{}', '{"api_mst_shipgraph":[]}', '{"api_mst_shipgraph":{"api_boko_n":[1e309,2]}}']) {
  test(`较新的坏 json 回落同名 ini：${invalid}`, (t) => {
    const dir = withDir(t), warnings = []
    const ini = write(dir, 'KanColle', 'fallback')
    const json = write(dir, 'KanColle', 'fallback', invalid, 'kcs', 'json')
    fs.utimesSync(ini, 100, 100)
    fs.utimesSync(json, 200, 200)
    assert.deepEqual(readShipgraphCoordinates(dir, ['fallback'], { warn: message => warnings.push(message) }).fallback, expected)
    assert.equal(warnings.length, 0, '有效回落无需报整名无效')
  })
}

test('较新的坏 ini 回落 json；两份都坏时这一名不生效且只记一行日志', (t) => {
  const dir = withDir(t), warnings = []
  const ini = write(dir, 'KanColle', 'fallback', '[graph]\nboko_n_left=bad\nboko_n_top=2')
  const json = write(dir, 'KanColle', 'fallback', jsonCoordinates(expected), 'kcs', 'json')
  fs.utimesSync(ini, 200, 200)
  fs.utimesSync(json, 100, 100)
  const read = () => readShipgraphCoordinates(dir, ['fallback'], { warn: message => warnings.push(message) })
  assert.deepEqual(read().fallback, expected)
  fs.writeFileSync(json, '{')
  assert.deepEqual(plain(read()), {})
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /fallback/)
})

test('后缀 ini 优先于无后缀 json；后缀双文件均无效则回落无后缀整份配置', (t) => {
  const dir = withDir(t), warnings = []
  write(dir, 'KanColle', 'ship', jsonCoordinates(expected), 'kcs', 'json')
  const ini = write(dir, 'KanColle', 'ship.night', '[graph]\nweda_left=1\nweda_top=2')
  const json = write(dir, 'KanColle', 'ship.night', '{', 'kcs', 'json')
  fs.utimesSync(ini, 100, 100)
  fs.utimesSync(json, 200, 200)
  const read = () => readShipgraphCoordinates(dir, ['ship'], { period: 'night', warn: message => warnings.push(message) }).ship
  assert.deepEqual(read(), { api_weda: [1, 2] })
  fs.writeFileSync(ini, '[graph]\nweda_left=bad\nweda_top=2')
  assert.deepEqual(read(), expected)
  assert.equal(warnings.length, 1)
})

test('json 大小上限与 ini 一致；双文件中较新超限文件回落另一份', (t) => {
  const dir = withDir(t)
  const json = write(dir, 'KanColle', 'large', Buffer.alloc(MAX_COORDINATE_BYTES + 1), 'kcs', 'json')
  assert.throws(() => readShipgraphCoordinates(dir, ['large']), /size limit/)
  const ini = write(dir, 'KanColle', 'large')
  fs.utimesSync(ini, 100, 100)
  fs.utimesSync(json, 200, 200)
  assert.deepEqual(readShipgraphCoordinates(dir, ['large']).large, expected)
  fs.writeFileSync(json, jsonCoordinates(expected))
  fs.writeFileSync(ini, Buffer.alloc(MAX_COORDINATE_BYTES + 1))
  fs.utimesSync(ini, 300, 300)
  fs.utimesSync(json, 200, 200)
  assert.deepEqual(readShipgraphCoordinates(dir, ['large']).large, expected)
})

test('json 与时段后缀同样钳制真实路径，根外目录不读、不 stat', (t) => {
  const dir = withDir(t)
  const outside = path.join(dir, 'outside')
  fs.mkdirSync(outside)
  for (const suffix of ['', '.night']) {
    fs.writeFileSync(path.join(outside, `escape${suffix}.config.json`), jsonCoordinates(expected))
    fs.writeFileSync(path.join(outside, `escape${suffix}.config.ini`), fixture)
  }
  const ships = path.dirname(write(dir, 'KanColle', 'placeholder'))
  fs.rmSync(ships, { recursive: true })
  fs.symlinkSync(outside, ships, process.platform === 'win32' ? 'junction' : 'dir')
  const { result, calls } = countCoordinateFs(() => readShipgraphCoordinates(dir, ['escape'], { period: 'night' }))
  assert.deepEqual(plain(result), {})
  assert.equal(calls.openSync.length, 0)
  assert.equal(calls.statSync.length, 0)
})

test('双格式与时段后缀不增加目录枚举，只 stat 实际请求且并存的同名一对', (t) => {
  const dir = withDir(t)
  const ini = write(dir, 'KanColle', 'pair.night')
  const json = write(dir, 'KanColle', 'pair.night', jsonCoordinates(expected), 'kcs', 'json')
  write(dir, 'KanColle', 'single', jsonCoordinates(expected), 'kcs2', 'json')
  for (const stem of ['pair', 'pair.day', 'pair.nigth', 'unrequested.night']) {
    write(dir, 'KanColle', stem)
    write(dir, 'KanColle', stem, jsonCoordinates(expected), 'kcs', 'json')
  }
  const counts = []
  for (const size of [0, 1600]) {
    const filenames = ['pair', 'single', ...Array.from({ length: size }, (_, i) => `missing${i}`)]
    const { result, calls } = countCoordinateFs(() => readShipgraphCoordinates(dir, filenames, { period: 'night' }))
    assert.deepEqual(plain(result), { pair: expected, single: expected })
    assert.equal(calls.readdirSync.length, 4)
    assert.equal(new Set(calls.readdirSync).size, 4)
    assert.deepEqual(new Set(calls.statSync), new Set([fs.realpathSync(ini), fs.realpathSync(json)]))
    assert.equal(calls.statSync.length, 2)
    assert.equal(calls.openSync.length, 2)
    counts.push(Object.fromEntries(Object.entries(calls).map(([method, files]) => [method, files.length])))
  }
  assert.deepEqual(counts[0], counts[1])
})

// 原生 XHR 的事件按注册顺序派发，on* 属性也占据赋值时的位置。
// 原生 response 与 responseText 由独立 getter 提供，避免用被测 hack 冒充服务器原文。
const mount = (read = () => ({ erhlwuihpcnw: expected })) => {
  const calls = [], requests = [], responses = [], warnings = []
  let reads = 0
  class NativeXHR {
    constructor() { this.listeners = {}; this.readyState = 0; this.responseType = ''; this.status = 200; this.raw = '' }
    addEventListener(type, callback) { (this.listeners[type] ??= []).push(callback) }
    set onreadystatechange(callback) { this.addEventListener('readystatechange', callback) }
    set onload(callback) { this.addEventListener('load', callback) }
    set onloadend(callback) { this.addEventListener('loadend', callback) }
    dispatch(type) { for (const callback of this.listeners[type] ?? []) callback.call(this) }
    open(...args) { calls.push(['open', ...args]); this.readyState = 1; this.responseURL = ''; this.dispatch('readystatechange') }
    setRequestHeader(...args) { calls.push(['setRequestHeader', ...args]) }
    send(...args) { calls.push(['send', ...args]) }
    get response() { return this.raw }
    get responseText() {
      if (this.responseType && this.responseType !== 'text') throw new Error('InvalidStateError')
      return this.raw
    }
    get responseXML() { return null }
    finish(raw, url = 'https://fixture/kcsapi/api_start2/getData', beforeEvent) {
      this.raw = raw; this.responseURL = url; this.readyState = 4
      beforeEvent?.()
      for (const type of ['readystatechange', 'load', 'loadend']) this.dispatch(type)
    }
  }
  const window = { XMLHttpRequest: NativeXHR, location: { href: 'https://fixture/kcs2/index.php' },
    kumaPreloadBridge: {
      getShipgraphCoordinates: filenames => { reads++; return read(filenames) },
      sendRequest: (...args) => requests.push(args), sendResponse: (...args) => responses.push(args), sendError() {},
    } }
  // 只把序列化的函数送进无 require 的主世界，验证没有模块闭包依赖。
  vm.runInNewContext(`(${installXhrHack.toString()})()`, { window, URL, console: { warn: message => warnings.push(message) } })
  const xhr = new window.XMLHttpRequest()
  return { window, xhr, NativeXHR, calls, requests, responses, warnings, reads: () => reads }
}

test('start2 真实形状：恰好 15 个坐标可改；匹配文件名、其它字段和其它表字节不变', () => {
  const forbidden = { api_id: [8, 9], api_sortno: [8, 9], api_filename: [8, 9], api_version: [8, 9],
    api_pa: [8, 9], api_pab: [8, 9], api_wedb: [8, 9], api_name: [8, 9], api_taik: [8, 9], api_unknown: [8, 9] }
  const f = mount(() => ({ erhlwuihpcnw: { ...expected, ...forbidden } }))
  const original = JSON.parse(start2)
  const wanted = structuredClone(original)
  Object.assign(wanted.api_data.api_mst_shipgraph[0], expected)
  f.xhr.open('POST', '/kcsapi/api_start2/getData', true)
  f.xhr.send('api_token=fixture')
  f.xhr.finish('svdata=' + start2)
  assert.deepEqual(JSON.parse(f.xhr.response.slice(7)), wanted)
  assert.equal(f.xhr.response, f.xhr.responseText)
  assert.equal(f.reads(), 1)
  assert.deepEqual(f.responses[0].slice(4), ['svdata=' + start2, '', 200])
  // 删除白名单字段后，其余结构/文本保持；不用重序列化整份 JSON 来证明字节不变。
  const stripCoordinates = text => text.replace(/"api_(?:boko_[nd]|kaisyu_[nd]|kaizo_[nd]|map_[nd]|ensyu[fe]_[nd]|battle_[nd]|weda)"\s*:\s*\[[^\]]*\]\s*,?/g, '')
  // 新增的 api_ensyue_d 位于对象尾部，移除时连同其插入的逗号一起还原。
  const withoutAdded = f.xhr.response.slice(7).replace(/,"api_ensyue_d":\[[^\]]*\]/, '')
  assert.equal(stripCoordinates(withoutAdded), stripCoordinates(start2))
  assert.equal(f.warnings.length, 0)
})

for (const event of ['readystatechange', 'load', 'loadend']) {
  for (const property of ['response', 'responseText']) {
    for (const type of ['', 'text']) {
      test(`消费者在 ${event} 读取 ${property}，responseType='${type}'：首次读取已生效，上报仍是原文`, () => {
        const f = mount()
        let observed
        f.xhr[`on${event}`] = function () { if (this.readyState === 4) observed = this[property] }
        f.xhr.open('POST', '/kcsapi/api_start2/getData')
        f.xhr.responseType = type
        f.xhr.send('original-body')
        f.xhr.finish('svdata=' + start2)
        assert.deepEqual(JSON.parse(observed.slice(7)).api_data.api_mst_shipgraph[0].api_boko_n, [-28, 121])
        assert.equal(f.responses[0][4], 'svdata=' + start2)
        assert.equal(f.reads(), 1)
      })
    }
  }
  test(`消费者用 addEventListener 注册 ${event}：两个属性均先于读取准备好`, () => {
    const f = mount()
    let observed = 0
    f.xhr.addEventListener(event, function () {
      if (this.readyState !== 4) return
      for (const property of ['response', 'responseText']) {
        assert.deepEqual(JSON.parse(this[property].slice(7)).api_data.api_mst_shipgraph[0].api_boko_n, [-28, 121])
        observed++
      }
    })
    f.xhr.open('POST', '/kcsapi/api_start2/getData')
    f.xhr.send('original-body')
    f.xhr.finish('svdata=' + start2)
    assert.equal(observed, 2)
    assert.equal(f.responses[0][4], 'svdata=' + start2)
    assert.equal(f.reads(), 1)
  })
}

test('DONE 事件派发之前直接读 getter 也生效；无 svdata 前缀仍无前缀', () => {
  const f = mount()
  f.xhr.open('POST', '/kcsapi/api_start2/getData')
  f.xhr.finish(start2, undefined, () => {
    assert.deepEqual(JSON.parse(f.xhr.responseText).api_data.api_mst_shipgraph[0].api_weda, [457, 16])
  })
  assert.equal(f.reads(), 1)
})

test('文本改写保留非坐标字段的空白、数值写法、转义和嵌套结构', () => {
  const f = mount(() => ({ erhlwuihpcnw: { api_boko_n: [-28, 121], api_weda: [457, 16] } }))
  const raw = String.raw`svdata={ "api_result":1, "api_data" : {
    "api_mst_shipgraph" : [{"api_filename":"erhlwuihpcnw","api_boko_n" : [ 98 , 179 ],"api_weda":[226,-15],"api_version":["5\u0031","1","718"]}],
    "other":{"number":1.2300e+02,"zero":-0,"string":"\"[,]{}\\","nested":[{},[],true,false,null]}
  } }`
  f.xhr.open('POST', '/kcsapi/api_start2/getData')
  f.xhr.finish(raw)
  assert.equal(f.xhr.response, raw.replace('[ 98 , 179 ]', '[-28,121]').replace('[226,-15]', '[457,16]'))
  assert.equal(f.responses[0][4], raw)
})

test('responseType=json：游戏拿到改写对象，sendResponse 仍收到原生对象且原生对象未被改动', () => {
  const f = mount()
  const raw = JSON.parse(start2)
  const copy = structuredClone(raw)
  f.xhr.open('POST', '/kcsapi/api_start2/getData')
  f.xhr.responseType = 'json'
  f.xhr.finish(raw)
  assert.deepEqual(plain(f.xhr.response.api_data.api_mst_shipgraph[0].api_weda), [457, 16])
  assert.equal(f.responses[0][4], raw)
  assert.deepEqual(raw, copy)
  assert.throws(() => f.xhr.responseText, /InvalidStateError/)
})

test('其它 responseType 原样放行，不读坐标表', () => {
  const f = mount(() => assert.fail('unsupported responseType must not read coordinates'))
  for (const type of ['arraybuffer', 'blob', 'document']) {
    f.xhr.open('POST', '/kcsapi/api_start2/getData')
    f.xhr.responseType = type
    const raw = { original: type }
    f.xhr.finish(raw)
    assert.equal(f.xhr.response, raw)
  }
  assert.equal(f.reads(), 0)
})

for (const [label, read, raw] of [
  ['没有坐标文件', () => ({}), 'svdata=' + start2],
  ['读取坐标表抛错', () => { throw new Error('disk failure') }, 'svdata=' + start2],
  ['响应非法 JSON', () => assert.fail('invalid JSON must not read disk'), 'svdata={broken'],
  ['解析结果缺表', () => assert.fail('missing table must not read disk'), 'svdata={"api_data":{}}'],
  ['改写时抛错', () => ({ erhlwuihpcnw: { get api_boko_n() { throw new Error('rewrite failure') } } }), 'svdata=' + start2],
  ['坐标不是有限数对', () => ({ erhlwuihpcnw: { api_boko_n: [Infinity, 2], api_weda: [1] } }), 'svdata=' + start2],
]) {
  test(`${label}：两个属性与上报均为原文`, () => {
    const f = mount(read)
    f.xhr.open('POST', '/kcsapi/api_start2/getData')
    f.xhr.finish(raw)
    assert.equal(f.xhr.response, raw)
    assert.equal(f.xhr.responseText, raw)
    assert.equal(f.responses[0][4], raw)
  })
}

test('父页补装子帧：缺少子帧坐标桥时原样放行，不借用父页坐标', () => {
  const f = mount(() => assert.fail('must not use parent coordinate reader'))
  const child = { XMLHttpRequest: f.NativeXHR, location: f.window.location }
  assert.equal(f.window.hackXhr(child), true)
  const xhr = new child.XMLHttpRequest()
  xhr.open('POST', '/kcsapi/api_start2/getData')
  xhr.finish('svdata=' + start2)
  assert.equal(xhr.response, 'svdata=' + start2)
  assert.equal(xhr.responseText, 'svdata=' + start2)
  assert.equal(f.responses[0][4], 'svdata=' + start2)
})

test('请求红线：open/send 参数、次数和时序不变；其它 API 不读取或改写坐标', () => {
  const f = mount()
  const body = 'api_token=fixture&api_verno=1'
  f.xhr.open('POST', '/kcsapi/api_start2/getData', true, 'original-user', 'original-password')
  f.xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded')
  f.xhr.send(body)
  assert.deepEqual(f.calls, [['open', 'POST', '/kcsapi/api_start2/getData', true, 'original-user', 'original-password'],
    ['setRequestHeader', 'Content-Type', 'application/x-www-form-urlencoded'], ['send', body]])
  assert.equal(f.reads(), 0, '发送请求时不得提前读坐标或发起其它请求')
  f.xhr.finish('svdata=' + start2)
  assert.equal(f.calls.length, 3)
  const unrelated = 'svdata=' + start2
  f.xhr.open('GET', '/kcsapi/api_port/port', false)
  f.xhr.send(undefined)
  f.xhr.finish(unrelated, 'https://fixture/kcsapi/api_port/port')
  assert.equal(f.reads(), 1)
  assert.equal(f.xhr.response, unrelated, '复用 XHR 时不得残留 start2 的 hack')
  assert.equal(f.xhr.responseText, unrelated)
  assert.deepEqual(f.calls, [['open', 'POST', '/kcsapi/api_start2/getData', true, 'original-user', 'original-password'],
    ['setRequestHeader', 'Content-Type', 'application/x-www-form-urlencoded'], ['send', body],
    ['open', 'GET', '/kcsapi/api_port/port', false], ['send', undefined]])
})

test('真实磁盘读取接到主世界钩子：下次 start2 重新读文件，读文件异常则整份响应放行', (t) => {
  const dir = withDir(t)
  const file = write(dir)
  const f = mount(filenames => readShipgraphCoordinates(dir, filenames))
  const load = () => { f.xhr.open('POST', '/kcsapi/api_start2/getData'); f.xhr.send('body'); f.xhr.finish('svdata=' + start2) }
  load()
  assert.deepEqual(JSON.parse(f.xhr.response.slice(7)).api_data.api_mst_shipgraph[0].api_weda, [457, 16])
  fs.writeFileSync(file, '[graph]\nweda_left=-1\nweda_top=-2')
  load()
  assert.deepEqual(JSON.parse(f.xhr.response.slice(7)).api_data.api_mst_shipgraph[0].api_weda, [-1, -2])
  fs.writeFileSync(file, Buffer.alloc(MAX_COORDINATE_BYTES + 1))
  load()
  assert.equal(f.xhr.response, 'svdata=' + start2)
  assert.equal(f.xhr.responseText, 'svdata=' + start2)
  assert.equal(f.responses.length, 3)
  for (const response of f.responses) assert.equal(response[4], 'svdata=' + start2)
})

test('cispmgxqaedk 玩家双文件样本端到端：磁盘到 start2 只替换 15 个显示坐标，原请求与上报不变', (t) => {
  const dir = withDir(t)
  const iniBytes = fs.readFileSync(new URL('./fixtures/cispmgxqaedk.config.ini', import.meta.url))
  const jsonBytes = fs.readFileSync(new URL('./fixtures/cispmgxqaedk.config.json', import.meta.url))
  const sampleExpected = Object.fromEntries(names.map((name, index) => [`api_${name}`, [
    [205, 227], [245, 227], [0, 0], [0, 0], [199, 119], [251, 134], [151, 161], [214, 149],
    [229, 184], [267, 188], [271, 179], [303, 173], [229, 184], [267, 188], [179, -41],
  ][index]]))
  assert.equal(iniBytes.toString().replace(/\r\n/g, '').includes('\n'), false, '原始 ini 保留 CRLF')
  assert.deepEqual(parseShipgraphCoordinates(iniBytes), sampleExpected)
  assert.deepEqual(JSON.parse(jsonBytes).api_mst_shipgraph, sampleExpected)
  const raw = start2.replace('erhlwuihpcnw', 'cispmgxqaedk')
  const wanted = JSON.parse(raw)
  Object.assign(wanted.api_data.api_mst_shipgraph[0], sampleExpected)
  for (const period of [null, 'day', 'night']) {
    const stem = `cispmgxqaedk${period ? `.${period}` : ''}`
    const ini = write(dir, 'KanColle', stem, iniBytes)
    const json = write(dir, 'KanColle', stem, jsonBytes, 'kcs', 'json')
    fs.utimesSync(ini, 100, 100)
    fs.utimesSync(json, 100, 100)
    const f = mount(filenames => readShipgraphCoordinates(dir, filenames, { period }))
    f.xhr.open('POST', '/kcsapi/api_start2/getData', true)
    f.xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded')
    f.xhr.send('api_token=fixture&api_verno=1')
    f.xhr.finish('svdata=' + raw)
    assert.deepEqual(JSON.parse(f.xhr.response.slice(7)), wanted)
    assert.equal(f.xhr.response, f.xhr.responseText)
    assert.deepEqual(f.calls, [
      ['open', 'POST', '/kcsapi/api_start2/getData', true],
      ['setRequestHeader', 'Content-Type', 'application/x-www-form-urlencoded'],
      ['send', 'api_token=fixture&api_verno=1'],
    ])
    assert.equal(f.reads(), 1)
    assert.equal(f.responses.length, 1)
    assert.equal(f.responses[0][4], 'svdata=' + raw)
    assert.equal(f.warnings.length, 0)
  }
})
