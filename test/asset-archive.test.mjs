// 策略、页面桥、存储与显示均用真函数配离线桩；不访问玩家档案或网络。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { transformSync } from 'esbuild'
import test from 'node:test'
import plan from '../dist/shared/asset-archive-plan.js'
import artPlan from '../dist/shared/art-archive-plan.js'
import voicePlan from '../dist/shared/voice-archive-plan.js'

const source = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').split(/\r?\n/).filter((line) => !/^\s*\/\//.test(line)).join('\n')
const fixtures = [
  ['slot', '/kcs2/resources/slot/card/0001_1234.png', '/kcs2/resources/slot/card/001.png'],
  ['useitem', '/kcs2/resources/useitem/card/001.png', '/kcs2/resources/useitem/card/001_x.png'],
  ['furniture', '/kcs2/resources/furniture/normal/001_1234.png', '/kcs2/resources/furniture/normal/01.png'],
  ['map', '/kcs2/resources/map/001/01_image.png', '/kcs2/resources/map/01/01_image.png'],
  ['common', '/kcs2/img/common/common_icon_weapon.json', '/kcs2/img/common/common_icon_ship.json'],
  ['ship-misc', '/kcs2/resources/ship/banner/0001_1234.png', '/kcs2/resources/ship/full/0001_1234.png'],
]
const entry = (over = {}) => ({
  pathname: fixtures[0][1], family: 'slot', version: 'v1', sha1: '0123456789abcdef',
  bytes: 100, firstSeen: 1, lastSeen: 2, seen: 1, ...over,
})
for (const [family, accepted, rejected] of fixtures) {
  test(`六族路径：${family} 收与拒`, () => {
    assert.equal(plan.assetFamilyOf(accepted), family)
    assert.equal(plan.assetFamilyOf(rejected), null)
    assert.equal(plan.assetFamilyOf(`${accepted}?version=1`), null)
    assert.equal(plan.assetFamilyOf(accepted.replace(/[^/]+$/, '../escape.png')), null)
  })
}
test('海域 JSON 只收 info 与 image；common 两种扩展都收', () => {
  for (const name of ['info', 'image']) assert.equal(plan.assetFamilyOf(`/kcs2/resources/map/001/01_${name}.json`), 'map')
  assert.equal(plan.assetFamilyOf('/kcs2/resources/map/001/01_route.json'), null)
  assert.equal(plan.assetFamilyOf('/kcs2/img/common/common_icon_weapon.png'), 'common')
})
test('ship-misc 与立绘档案互斥，包括深海横幅与所有立绘图种', () => {
  for (const id of [1, 961, 1499, 1500, 2297]) {
    for (const type of [...artPlan.ART_ARCHIVE_TYPES, 'banner', 'banner_dmg', 'banner_g', 'card', 'supply_character', 'power_up']) {
      const pathname = `/kcs2/resources/ship/${type}/${String(id).padStart(4, '0')}_1234.png`
      assert.equal(plan.assetFamilyOf(pathname) === 'ship-misc', !artPlan.shouldArchiveArtType(id, type), pathname)
    }
  }
})
test('键与实物路径带指纹，PNG 与 JSON 保留各自扩展', () => {
  const a = entry()
  assert.equal(plan.assetArchiveKey(a.pathname, a.sha1), `${a.pathname}|${a.sha1}`)
  assert.equal(plan.assetArchiveBlobPath(a.pathname, a.sha1), `asset/slot/0001_1234.${a.sha1}.png`)
  assert.equal(plan.assetArchiveBlobPath(fixtures[4][1], a.sha1), `asset/common/common_icon_weapon.${a.sha1}.json`)
  assert.notEqual(plan.assetArchiveBlobPath(a.pathname, a.sha1), plan.assetArchiveBlobPath(a.pathname, 'b'.repeat(16)))
  assert.equal(plan.assetArchiveBlobPath(a.pathname, ''), null)
})
test('has-blob 连版本一起看，占位不能算实物', () => {
  assert.equal(plan.assetArchiveHasBlobFor([entry()], entry().pathname, 'v1'), true)
  assert.equal(plan.assetArchiveHasBlobFor([entry()], entry().pathname, 'v2'), false)
  assert.equal(plan.assetArchiveHasBlobFor([entry({ bytes: 0 })], entry().pathname, 'v1'), false)
})
test('不设上限一件不淘汰；单件 8 MiB，上限归一共用语音那份', () => {
  assert.equal(plan.ASSET_ARCHIVE_MAX_ENTRY_BYTES, 8 * 1024 * 1024)
  assert.equal(plan.ASSET_ARCHIVE_MAX_BYTES, 0)
  assert.equal(plan.archiveLimitBytes, voicePlan.archiveLimitBytes)
  for (const limit of [undefined, null, 0]) assert.deepEqual(plan.planAssetArchiveEviction([entry({ bytes: 2 ** 40 })], limit), [])
})
test('设上限先动最久没见，再动见得少；被顶替旧版豁免按路径分组', () => {
  const old = entry({ lastSeen: 1 })
  const rare = entry({ pathname: fixtures[1][1], family: 'useitem', lastSeen: 2, seen: 1 })
  const frequent = entry({ pathname: fixtures[2][1], family: 'furniture', lastSeen: 2, seen: 5 })
  assert.deepEqual(plan.planAssetArchiveEviction([frequent, rare, old], 100), [old, rare])
  const newer = entry({ lastSeen: 3, version: 'v2', sha1: 'b'.repeat(16) })
  assert.deepEqual(plan.planAssetArchiveEviction([old, newer], 50), [newer])
  assert.equal(plan.assetArchiveUsage([old, newer], 50).full, true)
  assert.equal(plan.assetArchiveUsage([old, newer], 50).lockedBytes, 100)
  // 换路径并不构成同路径被顶替，不能照立绘的槽位键分组。
  assert.deepEqual(plan.planAssetArchiveEviction([old, { ...newer, pathname: fixtures[1][1] }], 100), [old])
})
test('占用按六族分开数，读取记录不计已归档件数', () => {
  const all = fixtures.map(([family, pathname]) => entry({ family, pathname }))
  const usage = plan.assetArchiveUsage([...all, entry({ bytes: 0, sha1: '' })])
  assert.deepEqual(usage.families, { slot: 1, useitem: 1, furniture: 1, map: 1, common: 1, 'ship-misc': 1 })
  assert.equal(usage.bytes, 600)
  assert.equal(usage.kept, 6)
  assert.equal(usage.seen, 1)
  assert.equal(usage.maxBytes, null)
})
test('条目字段齐全；族从路径重解，版本形状不对只丢版本', () => {
  const clean = plan.sanitizeAssetArchiveEntry(entry({ family: 'map', version: 'invalid version' }))
  assert.deepEqual(Object.keys(clean).sort(), [...plan.ASSET_ARCHIVE_REQUIRED_FIELDS].sort())
  assert.equal(clean.family, 'slot')
  assert.equal(clean.version, '')
  assert.equal(plan.sanitizeAssetArchiveEntry(entry({ sha1: 'invalid' })), null)
  assert.equal(plan.sanitizeAssetArchiveEntry(null), null)
})
test('缓存急救不删资源档案，档案目录独立于缓存', () => {
  const yu = source('src/main/yu.ts')
  const clear = vm.runInNewContext(/export const CACHE_DIRS = (\[[^\]]*\])/.exec(yu)[1])
  const kept = vm.runInNewContext(/export const PRESERVED_ENTRIES = (\[[\s\S]*?\n\])/.exec(yu)[1])
  assert.ok(kept.includes('asset-archive'))
  assert.equal(clear.includes('asset-archive'), false)
  const main = source('src/main/asset-archive.ts')
  assert.match(main, /path\.join\(APPDATA_PATH, 'asset-archive'\)/)
  assert.doesNotMatch(main, /DEFAULT_CACHE_PATH|kuma\.cache\.path/)
  assert.match(main, /MAX_ENTRIES = 50_000/)
})

const runCjs = (code, require, globals = {}) => {
  const module = { exports: {} }
  vm.runInNewContext(code, { module, exports: module.exports, require, console, URL, Uint8Array, Buffer, setTimeout, clearTimeout, ...globals })
  return module.exports
}
test('页面桥只读同源整文件缓存，无 Range、无重试且进行中去重', async () => {
  const code = source('assets/preload/asset-archive.js')
  const plain = stripComments(code)
  assert.doesNotMatch(plain, /Range|setInterval|\.retry|XMLHttpRequest|net\.fetch/)
  const calls = [], sends = []
  let finish
  const bridge = runCjs(code, (id) => id === 'electron' ? { ipcRenderer: { send: (...args) => sends.push(args) } } : plan, {
    window: { location: { href: 'https://game.example/kcs2/index.html', origin: 'https://game.example' } },
    fetch: (...args) => { calls.push(args); return new Promise((resolve) => { finish = resolve }) },
  })
  const url = `https://game.example${fixtures[0][1]}?version=v1`
  const pending = bridge.readFromCache(url)
  await bridge.readFromCache(url)
  await bridge.readFromCache(url.replace('game.example', 'other.example'))
  await bridge.readFromCache('https://game.example/kcs2/resources/ship/full/0001.png')
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], url)
  assert.deepEqual({ ...calls[0][1] }, { cache: 'only-if-cached', mode: 'same-origin' })
  finish({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2]).buffer })
  await pending
  assert.equal(sends[0][0], 'kuma:asset-archive-blob')
  assert.equal(sends[0][1].url, url)
  let misses = 0
  const miss = runCjs(code, (id) => id === 'electron' ? { ipcRenderer: { send: () => assert.fail('缓存 miss 不该交货') } } : plan, {
    window: { location: { href: url, origin: 'https://game.example' } },
    fetch: async () => { misses++; throw new Error('cache miss') },
  })
  await miss.readFromCache(url)
  assert.equal(misses, 1)
})

const mainArchive = (dir) => {
  const real = createRequire(new URL('../dist/main/asset-archive.js', import.meta.url))
  return runCjs(source('dist/main/asset-archive.js'), (id) => {
    if (id === './env') return { APPDATA_PATH: dir }
    if (id === './config') return { get: () => 0 }
    if (id === './crash-log') return { safeConsole: () => {} }
    return real(id)
  }, { process })
}
test('存储真落临时目录：PNG/JSON 验收、占位让位、同版去重、索引重载与清空', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-asset-test-'))
  try {
    const archive = mainArchive(dir)
    const pathname = fixtures[0][1]
    assert.equal(archive.rememberAssetSeen({ pathname, version: 'v1', ts: 1 }), true)
    assert.equal(archive.keepAssetBlob({ pathname, bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) }), null)
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0])
    const kept = archive.keepAssetBlob({ pathname, version: 'v1', bytes, ts: 2 })
    assert.ok(kept)
    assert.equal(kept.firstSeen, 1)
    assert.equal(archive.assetArchiveEntries().length, 1)
    assert.equal(archive.rememberAssetSeen({ pathname, version: 'v1' }), false)
    assert.equal(archive.rememberAssetSeen({ pathname, version: 'v2' }), true)
    const jsonPath = fixtures[4][1]
    assert.equal(archive.keepAssetBlob({ pathname: jsonPath, bytes: Buffer.from('{bad') }), null)
    assert.ok(archive.keepAssetBlob({ pathname: jsonPath, bytes: Buffer.from('{"frames":{}}') }))
    assert.equal(archive.keepAssetBlob({ pathname: fixtures[5][2], bytes }), null)
    archive.flushAssetArchive()
    const index = JSON.parse(fs.readFileSync(path.join(dir, 'asset-archive', 'index.json'), 'utf8'))
    assert.equal(index.schemaVersion, 1)
    assert.ok(index.updatedAt)
    assert.equal(index.entries.length, 3)
    const blob = path.join(dir, 'asset-archive', plan.assetArchiveBlobPath(pathname, kept.sha1))
    assert.deepEqual(fs.readFileSync(blob), Buffer.from(bytes))
    const reloaded = mainArchive(dir)
    assert.equal(reloaded.assetArchiveStats().kept, 2)
    assert.equal(reloaded.clearAssetArchive(), true)
    assert.equal(fs.existsSync(blob), false)
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'asset-archive', 'index.json'))).entries.length, 0)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

const imageHarness = () => {
  const archived = new Map(), files = new Map(), listeners = new Map(), ipcListeners = new Map(), sent = [], invoked = [], images = []
  let ready = true
  class Img { currentSrc = ''; src = ''; remove() {} }
  const code = transformSync(source('src/renderer/kcs-image.ts'), { loader: 'ts', format: 'cjs' }).code
  const real = createRequire(import.meta.url)
  const exports = runCjs(code, (id) => {
    if (id === './asset-archive') return {
      archivedAssetUrlForPath: (pathname) => archived.get(pathname) ?? null,
      assetArchiveReady: () => ready,
      loadAssetArchive: async () => {},
    }
    if (id === './art-archive') return { archivedArtUrlForPath: () => null, archivedArtTypes: () => new Set() }
    if (id === './equip-icon') return { setEquipIconSpriteProvider: () => {} }
    if (id === 'electron') return { ipcRenderer: {
      send: (...args) => sent.push(args), on: (name, cb) => ipcListeners.set(name, cb), invoke: async (...args) => { invoked.push(args); return null },
    } }
    if (id === '@electron/remote') return { getGlobal: () => os.tmpdir(), require: () => ({ get: () => true }) }
    if (id.endsWith('kcs-resource-path')) return { getCacheCandidatePaths: (_dir, pathname) => [pathname] }
    if (id === 'fs') return {
      constants: { R_OK: 4 }, existsSync: () => false,
      accessSync: (file) => { if (!files.has(file)) throw new Error('miss') },
      readFileSync: (file) => files.get(file),
    }
    if (id.startsWith('../shared/')) return real(`../dist/shared/${id.slice('../shared/'.length)}.js`)
    return real(id)
  }, {
    HTMLImageElement: Img,
    document: {
      addEventListener: (name, cb, capture) => listeners.set(name, { cb, capture }), dispatchEvent: () => {},
      body: { appendChild: (img) => images.push(img) }, createElement: () => new Img(),
    },
    CustomEvent: class {},
  })
  exports.setGameHost('game.example')
  return { exports, archived, files, listeners, ipcListeners, sent, invoked, images, Img, setReady: (v) => { ready = v } }
}
test('显示钩子只对游戏主机 img 发，捕获阶段安装一次，同路径等回执去重', () => {
  const h = imageHarness()
  h.exports.installAssetDisplayCapture()
  const listener = h.listeners.get('load')
  h.exports.installAssetDisplayCapture()
  assert.equal(h.listeners.get('load'), listener)
  assert.equal(listener.capture, true)
  const fire = (url, img = new h.Img()) => { img.src = url; listener.cb({ target: img }) }
  const url = `https://game.example${fixtures[0][1]}?version=v2`
  for (const bad of [url.replace('game.example', 'evil.example'), `file://${fixtures[0][1]}`, `kuma-cache://resource${fixtures[0][1]}`, 'https://game.example/kcs2/resources/ship/full/0001.png']) fire(bad)
  fire(url, {})
  assert.equal(h.sent.length, 0)
  fire(url)
  fire(url)
  assert.equal(h.sent.length, 1)
  assert.equal(h.sent[0][0], 'kuma:archive-capture-asset')
  assert.equal(h.sent[0][1].version, 'v2')
  h.ipcListeners.get('kuma:archive-capture-asset-done')({}, fixtures[0][1])
  // 同路径已经留着旧版，远端新版真的显示成功时仍应交主进程按版本对账。
  h.archived.set(fixtures[0][1], 'file:///old-version.png')
  fire(url)
  assert.equal(h.sent.length, 2)
})
test('图片取图顺序：档案 → 文件缓存 → 远端；索引未就绪不先出网', () => {
  for (const get of [(api) => api.slotItemImageUrl(1), (api) => api.furnitureImageUrl(1), (api) => api.useItemImageUrl(1), (api) => api.shipImageUrl(1, 'banner')]) {
    const h = imageHarness()
    const remote = get(h.exports)
    assert.ok(remote.startsWith('https://game.example/'))
    const pathname = new URL(remote).pathname
    h.archived.set(pathname, 'file:///archive.png')
    h.files.set(pathname, 'cached')
    assert.equal(get(h.exports), 'file:///archive.png')
    h.archived.clear()
    // 之前远端测试留下了负缓存，用新实例验证缓存层。
    const cached = imageHarness()
    cached.files.set(pathname, 'cached')
    assert.equal(get(cached.exports), pathToFileURL(pathname).href)
    const pending = imageHarness()
    pending.setReady(false)
    assert.equal(get(pending.exports), null)
  }
})
test('海域 JSON 取到即入档，并保持既有网络判据；游戏与显示两路的门不同', async () => {
  const code = transformSync(source('src/main/map-art-json.ts'), { loader: 'ts', format: 'cjs' }).code
  const kept = [], emitted = []
  let handler
  const api = runCjs(code, (id) => {
    if (id === 'electron') return { ipcMain: { handle: (_channel, fn) => { handler = fn } }, net: { fetch: async () => ({ ok: true, text: async () => '{"bg":[]}' }) } }
    if (id === './config') return { get: () => true }
    if (id === './asset-archive') return { keepAssetBlob: (entry) => { kept.push(entry); return entry } }
    if (id === './game-api-broadcaster') return { emit: (...args) => emitted.push(args) }
    throw new Error(id)
  }, { AbortController })
  api.registerMapArtJson()
  assert.equal((await handler({}, 'https://game.example/kcs2/resources/map/001/01_info.json')).bg.length, 0)
  assert.equal(kept.length, 1)
  assert.equal(Buffer.from(kept[0].bytes).toString('utf8'), '{"bg":[]}')
  assert.equal(emitted[0][0], 'kancolle.asset.archived')
  assert.equal(await handler({}, 'https://game.example/kcs2/resources/map/001/01_info.json?v=1'), null)
  assert.equal(await handler({}, 'http://game.example/kcs2/resources/map/001/01_info.json'), null)
  assert.equal(kept.length, 1)
  const mg = source('src/main/mg/index.ts')
  assert.match(mg.slice(mg.indexOf("ipcMain.on('kuma:asset-archive-blob'")), /isGameWebContents\(event.sender.id\)/)
  const capture = mg.slice(mg.indexOf("ipcMain.on('kuma:archive-capture-asset'"), mg.indexOf("ipcMain.handle('mg:asset-archive-stats'"))
  assert.doesNotMatch(capture, /isGameWebContents/)
  assert.match(source('src/main/kcs-resource.ts'), /assetGate = createVoiceRequestGate\(\)/)
})

test('海域元数据与图集优先读资源档案，离线打开不调用远端 JSON', async () => {
  const h = imageHarness()
  const base = '/kcs2/resources/map/001/01'
  for (const [suffix, json] of [['info', { bg: ['sea'] }], ['image', { frames: { map_sea: { frame: { x: 2, y: 3 } } } }]]) {
    const url = pathToFileURL(path.join(os.tmpdir(), `asset-${suffix}.json`)).href
    h.archived.set(`${base}_${suffix}.json`, url)
    h.files.set(fileURLToPath(url), JSON.stringify(json))
  }
  h.archived.set(`${base}_image.png`, 'file:///atlas.png')
  h.exports.setAllowRemoteArt(false)
  const map = await h.exports.mapArtManifest(1, 1)
  assert.equal(map.layers[0].imageUrl, 'file:///atlas.png')
  assert.equal(map.layers[0].x, -2)
  assert.deepEqual(h.invoked, [])
  assert.equal(h.images.length, 0)
})

test('CSS 海域图集用同一个 img 成功钩子入档，构造普通资源 URL 不触发入档', async () => {
  const h = imageHarness()
  h.exports.installAssetDisplayCapture()
  h.exports.slotItemImageUrl(1)
  assert.equal(h.images.length, 0)
  assert.equal(h.sent.length, 0)
  const base = '/kcs2/resources/map/001/01'
  h.files.set(`${base}_info.json`, JSON.stringify({ bg: ['sea'] }))
  h.files.set(`${base}_image.json`, JSON.stringify({ frames: { map_sea: { frame: { x: 0, y: 0 } } } }))
  await h.exports.mapArtManifest(1, 1)
  assert.equal(h.images.length, 1)
  assert.equal(h.sent.length, 0)
  const img = h.images[0]
  h.listeners.get('load').cb({ target: img })
  img.onload()
  assert.equal(h.sent[0][0], 'kuma:archive-capture-asset')
  assert.equal(h.sent[0][1].pathname, `${base}_image.png`)
})

test('资源显示侧：缓存优先、开关关闭零联网、已留同版不重复取、超过六张排队', async () => {
  const code = transformSync(source('src/main/archive-capture.ts'), { loader: 'ts', format: 'cjs' }).code
  const real = createRequire(import.meta.url)
  const mount = ({ enabled = true, cached = null, wait = false, existing = [] } = {}) => {
    const requests = [], kept = [], pending = []
    let active = 0, peak = 0
    const api = runCjs(code, (id) => {
      if (id === 'fs') return { readFileSync: () => { if (!cached) throw new Error('miss'); return cached } }
      if (id === 'electron') return { net: { fetch: async (...args) => {
        requests.push(args); active++; peak = Math.max(peak, active)
        if (wait) await new Promise((resolve) => pending.push(resolve))
        active--
        return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }
      } } }
      if (id === './config') return { get: (key, fallback) => key === 'kuma.remoteArt' ? enabled : fallback }
      if (id === './env') return { ROOT: os.tmpdir(), DEFAULT_CACHE_PATH: os.tmpdir() }
      if (id === './crash-log') return { safeConsole: () => {} }
      if (id === './asset-archive') return { assetArchiveEntries: () => existing, keepAssetBlob: (entry) => { kept.push(entry); return entry } }
      if (['./art-archive', './voice-archive', './bgm-archive'].includes(id)) return {}
      if (id.endsWith('kcs-resource-path')) return { getCacheCandidatePaths: () => ['fixture'] }
      if (id.startsWith('../shared/')) return real(`../dist/shared/${id.slice('../shared/'.length)}.js`)
      return real(id)
    }, { AbortController })
    return { api, requests, kept, pending, peak: () => peak }
  }
  const pathname = fixtures[0][1], url = `https://game.example${pathname}?version=v1`
  const local = mount({ enabled: false, cached: new Uint8Array([3, 2, 1]) })
  assert.ok(await local.api.captureDisplayedAsset(pathname, url))
  assert.equal(local.requests.length, 0)
  assert.equal(local.kept[0].version, 'v1')
  const off = mount({ enabled: false })
  assert.equal(await off.api.captureDisplayedAsset(pathname, url), null)
  assert.equal(off.requests.length, 0)
  const known = mount({ existing: [entry()] })
  assert.equal(await known.api.captureDisplayedAsset(pathname, url), null)
  assert.equal(known.requests.length, 0)
  assert.ok(await known.api.captureDisplayedAsset(pathname, url, 'v2'))
  assert.equal(known.requests.length, 1)
  const batch = mount({ wait: true })
  const promises = Array.from({ length: 8 }, (_, i) => {
    const pathname = `/kcs2/resources/useitem/card/${String(i + 1).padStart(3, '0')}.png`
    return batch.api.captureDisplayedAsset(pathname, `https://game.example${pathname}`)
  })
  assert.equal(batch.requests.length, 6)
  batch.pending.splice(0).forEach((resolve) => resolve())
  // 等当前六份收货释放空位，再放行排队的两份；无需计时器或网络。
  for (let i = 0; i < 12; i++) await Promise.resolve()
  assert.equal(batch.requests.length, 8)
  batch.pending.splice(0).forEach((resolve) => resolve())
  const results = await Promise.all(promises)
  assert.ok(results.every(Boolean))
  assert.equal(batch.kept.length, 8)
  assert.equal(batch.peak(), 6)
})

test('渲染索引只异步拉一次，广播更新后用共享指纹路径生成 file 地址', async () => {
  const code = transformSync(source('src/renderer/asset-archive.ts'), { loader: 'ts', format: 'cjs' }).code
  const listeners = new Map(), real = createRequire(import.meta.url)
  let invokes = 0
  const api = runCjs(code, (id) => {
    if (id === '../shared/asset-archive-plan') return plan
    if (id === 'electron') return { ipcRenderer: { invoke: async (channel) => { assert.equal(channel, 'mg:asset-archive-entries'); invokes++; return [entry()] } } }
    if (id === '@electron/remote') return { getGlobal: () => os.tmpdir(), require: () => ({ addListener: (name, fn) => listeners.set(name, fn) }) }
    return real(id)
  }, { document: { dispatchEvent: () => {} }, CustomEvent: class {} })
  await Promise.all([api.loadAssetArchive(), api.loadAssetArchive()])
  assert.equal(invokes, 1)
  const pathname = entry().pathname
  assert.equal(api.archivedAssetUrlForPath(pathname), pathToFileURL(path.join(os.tmpdir(), 'asset-archive', plan.assetArchiveBlobPath(pathname, entry().sha1))).href)
  const newer = entry({ lastSeen: 3, sha1: 'b'.repeat(16) })
  listeners.get('kancolle.asset.archived')(newer)
  assert.ok(api.archivedAssetUrlForPath(pathname).includes(newer.sha1))
  listeners.get('kancolle.asset.cleared')()
  assert.equal(api.archivedAssetUrlForPath(pathname), null)
  assert.equal(invokes, 1)
})
