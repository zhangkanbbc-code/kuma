import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createResourceLookup, findModFilePathAsync, getCacheCandidatePaths } = require('../assets/preload/kcs-resource-path.js')

for (const period of [null, 'day', 'night']) {
  test(`资源后缀与根顺序，两条查找路径解析到同一文件：${period ?? '关闭'}`, async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-mod-suffix-'))
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
    const pathname = '/kcs2/resources/ship/full/ship.png'
    const put = (root, suffix) => {
      const file = path.join(dir, root, pathname.replace('.png', `${suffix}.png`))
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, file)
      return file
    }
    const baseOrigin = put('KanColle', '')
    const baseHack = put('KanColle', '.hack')
    const day = put('KanColle', '.day.hack')
    const night = put('KanColle', '.night.hack')
    const typo = put('KanColle', '.nigth.hack')
    const dayRoot = put('KanColle-白天', '.hack')
    const nightRoot = put('KanColle-夜间', '.hack')
    const check = async (expected, includeOrigin = false) => {
      // 页面查找返回协议地址：记录它实际命中的磁盘路径，再按协议中的时段解析。
      const accessed = [], original = fs.accessSync
      fs.accessSync = (...args) => { accessed.push(args[0]); return original(...args) }
      let url
      try {
        url = createResourceLookup(dir, { period: () => period })(`https://fixture${pathname}`, includeOrigin)
      } finally { fs.accessSync = original }
      assert.equal(url, expected ? `kuma-cache://resource${period ? `-${period}` : ''}${pathname}${includeOrigin ? '' : '?override-only=1'}` : undefined)
      if (expected) assert.equal(accessed.at(-1), expected)
      const parsed = url ? new URL(url) : null
      const protocolPeriod = parsed ? parsed.hostname.replace('resource', '').replace(/^-/, '') || null : period
      assert.equal(await findModFilePathAsync(dir, pathname, {
        period: protocolPeriod, overrideOnly: parsed ? parsed.searchParams.get('override-only') === '1' : !includeOrigin,
      }), expected)
    }
    await check(period === 'day' ? dayRoot : period === 'night' ? nightRoot : baseHack)
    if (period) {
      const root = period === 'day' ? 'KanColle-白天' : 'KanColle-夜间'
      const timedRoot = put(root, `.${period}.hack`)
      await check(timedRoot)
      fs.unlinkSync(timedRoot)
      fs.unlinkSync(period === 'day' ? dayRoot : nightRoot)
      await check(period === 'day' ? day : night)
      fs.unlinkSync(period === 'day' ? day : night)
    }
    await check(baseHack)
    fs.unlinkSync(baseHack)
    // 另一个时段、关闭时所有时段后缀及 nigth 均不能成为候选。
    await check(undefined)
    await check(baseOrigin, true)
    assert.ok(fs.existsSync(typo))
    assert.deepEqual(getCacheCandidatePaths(dir, pathname), [baseHack, baseOrigin], '图鉴、语音、存档候选不随时段扩展')
    if (period) {
      const root = period === 'day' ? 'KanColle-白天' : 'KanColle-夜间'
      const origin = put(root, '')
      put('KanColle', `.${period}.hack`)
      await check(path.join(dir, 'KanColle', pathname.replace('.png', `.${period}.hack.png`)))
      await check(origin, true)
    }
  })
}

test('资源后缀候选同样钳制在根内，拒绝路径时不做 access', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-mod-suffix-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  for (const root of ['KanColle', 'KanColle-白天', 'KanColle-夜间']) {
    fs.mkdirSync(path.join(dir, root))
    fs.writeFileSync(path.join(dir, root, 'nonempty'), 'x')
  }
  const sync = fs.accessSync, asyncAccess = fs.promises.access
  let probes = 0
  fs.accessSync = (...args) => { probes++; return sync(...args) }
  fs.promises.access = (...args) => { probes++; return asyncAccess(...args) }
  try {
    for (const period of ['day', 'night']) {
      for (const pathname of ['/kcs2/../../outside.png', '/kcs2/C:\\outside.png', '/kcs2/\\\\host\\share.png']) {
        assert.equal(await findModFilePathAsync(dir, pathname, { period }), undefined)
        const url = `https://fixture/kcs2/${encodeURIComponent(pathname.slice(6))}`
        assert.equal(createResourceLookup(dir, { period: () => period })(url), undefined)
      }
    }
    assert.equal(probes, 0)
  } finally { fs.accessSync = sync; fs.promises.access = asyncAccess }
})
