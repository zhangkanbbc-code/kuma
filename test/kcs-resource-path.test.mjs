import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const {
  createResourceLookup,
  getCacheCandidatePaths,
} = require('../assets/preload/kcs-resource-path.js')

const withTempDir = (fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-resource-lookup-'))
  try {
    return fn(dir)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

const countAccessSync = (fn) => {
  const orig = fs.accessSync
  let n = 0
  fs.accessSync = (...args) => {
    n += 1
    return orig.apply(fs, args)
  }
  try {
    fn()
    return n
  } finally {
    fs.accessSync = orig
  }
}

test('MyCache 不存在时，进战斗连打上百次 Image.src 只 stat 一次目录', () => {
  const lookup = createResourceLookup(path.join(os.tmpdir(), 'kanso-no-mycache-should-not-exist'))
  const n = countAccessSync(() => {
    for (let i = 0; i < 200; i += 1) {
      assert.equal(
        lookup(`https://w00g.kancolle-server.com/kcs2/img/battle/${i}.png`),
        undefined,
      )
    }
  })
  assert.equal(n, 1, `空缓存树应对整段会话只 stat 一次 KanColle 目录，实际 ${n} 次`)
})

test('图片默认只认魔改覆盖，普通缓存文件留给脚本恢复', () => {
  withTempDir((dir) => {
    const pathname = '/kcs2/resources/ship/full/1234_abc.png'
    const [hackPath, originPath] = getCacheCandidatePaths(dir, pathname)
    fs.mkdirSync(path.dirname(originPath), { recursive: true })
    fs.writeFileSync(originPath, 'origin')
    const lookup = createResourceLookup(dir)
    const url = `https://w00g.kancolle-server.com${pathname}`
    assert.equal(lookup(url), undefined, '有普通缓存也不该改 Image.src')
    assert.equal(lookup(url, true), `kanso-cache://resource${pathname}`)
    fs.writeFileSync(hackPath, 'hack')
    const lookup2 = createResourceLookup(dir)
    assert.equal(lookup2(url), `kanso-cache://resource${pathname}`)
  })
})

test('同一张图的未命中只 stat 一次，不随 PIXI 反复设 src 再打磁盘', () => {
  withTempDir((dir) => {
    fs.mkdirSync(path.join(dir, 'KanColle', 'kcs2', 'img'), { recursive: true })
    const lookup = createResourceLookup(dir)
    const url = 'https://w00g.kancolle-server.com/kcs2/img/missing.png'
    const first = countAccessSync(() => assert.equal(lookup(url), undefined))
    const rest = countAccessSync(() => {
      for (let i = 0; i < 50; i += 1) assert.equal(lookup(url), undefined)
    })
    assert.ok(first >= 1, '首次应去磁盘确认')
    assert.equal(rest, 0, `已记住的未命中不应再 accessSync，实际 ${rest} 次`)
  })
})
