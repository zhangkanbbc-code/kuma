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
const write = (dir, root = 'KanColle', filename = 'erhlwuihpcnw', bytes = fixture, tree = 'kcs') => {
  const file = path.join(dir, root, tree, 'resources', 'swf', 'ships', `${filename}.config.ini`)
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

test('先找到的空坐标文件也不从常驻根补字段；只认 config.ini', (t) => {
  const dir = withDir(t)
  write(dir)
  const file = write(dir, 'KanColle-白天', 'erhlwuihpcnw', '[info]\nship_name=忽略')
  fs.writeFileSync(file.replace('.config.ini', '.config.json'), JSON.stringify(expected))
  fs.writeFileSync(file.replace('.config.ini', '.hack.config.ini'), fixture)
  assert.deepEqual(readShipgraphCoordinates(dir, ['erhlwuihpcnw'], { period: 'day' }).erhlwuihpcnw, {})
  fs.unlinkSync(file)
  fs.unlinkSync(path.join(dir, 'KanColle', 'kcs/resources/swf/ships/erhlwuihpcnw.config.ini'))
  assert.deepEqual(plain(readShipgraphCoordinates(dir, ['erhlwuihpcnw'], { period: 'day' })), {})
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
  const methods = ['readdirSync', 'realpathSync', 'openSync', 'fstatSync', 'readSync', 'closeSync']
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

test('无坐标文件：目录缺失或只有图片/JSON，1 与 1600 个文件名的文件系统调用次数相同', (t) => {
  const dir = withDir(t)
  const filenames = Array.from({ length: 1600 }, (_, index) => `ship${index}`)
  for (const populated of [false, true]) {
    if (populated) {
      for (const root of ['KanColle', 'KanColle-白天', 'KanColle-夜间']) {
        for (const tree of ['kcs', 'kcs2']) {
          const directory = path.join(dir, root, tree, 'resources', 'swf', 'ships')
          fs.mkdirSync(directory, { recursive: true })
          fs.writeFileSync(path.join(directory, 'ship0.hack.png'), 'image')
          fs.writeFileSync(path.join(directory, 'ship0.config.json'), '{}')
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
        for (const method of ['realpathSync', 'openSync', 'fstatSync', 'readSync', 'closeSync']) assert.equal(calls[method].length, 0, method)
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
