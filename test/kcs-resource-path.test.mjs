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
  getModRootPath,
  hasModFiles,
} = require('../assets/preload/kcs-resource-path.js')

const withTempDir = (fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-resource-lookup-'))
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

// ---- 「该建到哪个路径」与「这棵树里有没有东西」----
//
// 2026-08-29 起主进程启动时会幂等建出魔改目录，所以查找器的开路判定不能再是
// 「目录存在」——那之后它恒为真，热路径上防空跑的那道闸就整个失效了。

test('魔改目录就是缓存目录下的 KanColle，跟着缓存路径走', () => {
  assert.equal(getModRootPath('C:\\x\\MyCache'), path.join('C:\\x\\MyCache', 'KanColle'))
  // 候选路径与它必须同一个根：两处各拼各的，改了缓存路径就会一边对一边错
  const [hack, origin] = getCacheCandidatePaths('C:\\x\\MyCache', '/kcs2/img/a.png')
  const root = getModRootPath('C:\\x\\MyCache')
  assert.ok(origin.startsWith(root + path.sep), `${origin} 不在 ${root} 下`)
  assert.ok(hack.startsWith(root + path.sep))
})

test('目录非空判定：不存在=false、空目录=false、有文件=true', () => {
  withTempDir((dir) => {
    const root = getModRootPath(dir)
    assert.equal(hasModFiles(root), false, '目录还没建出来就该算没人魔改')
    fs.mkdirSync(root, { recursive: true })
    assert.equal(hasModFiles(root), false, '自动建出来的空目录不许把热路径的闸打开')
    fs.writeFileSync(path.join(root, 'x.hack.png'), 'x')
    assert.equal(hasModFiles(root), true, '放了文件却还说没有')
  })
})

test('目录非空判定：readdir 抛错也当没有，不许把异常抛进热路径', () => {
  const orig = fs.readdirSync
  fs.readdirSync = () => {
    throw Object.assign(new Error('EACCES'), { code: 'EACCES' })
  }
  try {
    assert.equal(hasModFiles('C:\\anything'), false)
  } finally {
    fs.readdirSync = orig
  }
})

test('自动建出来的空目录：热路径仍然全未命中，且只 readdir 一次', () => {
  // 这是这次改动最要紧的一条：目录从「不存在」变成「存在但空」之后，
  // 玩家没魔改时的行为必须和从前一模一样——一次判定之后整段会话不再碰磁盘。
  withTempDir((dir) => {
    fs.mkdirSync(getModRootPath(dir), { recursive: true })
    const lookup = createResourceLookup(dir)
    let readdirs = 0
    const origReaddir = fs.readdirSync
    fs.readdirSync = (...args) => {
      readdirs += 1
      return origReaddir.apply(fs, args)
    }
    try {
      const accesses = countAccessSync(() => {
        for (let i = 0; i < 200; i += 1) {
          assert.equal(lookup(`https://w00g.kancolle-server.com/kcs2/img/battle/${i}.png`), undefined)
        }
      })
      assert.equal(accesses, 0, `空目录不该逐张去 accessSync，实际 ${accesses} 次`)
    } finally {
      fs.readdirSync = origReaddir
    }
    assert.equal(readdirs, 1, `空目录应对整段会话只 readdir 一次，实际 ${readdirs} 次`)
  })
})

test('MyCache 不存在时，进战斗连打上百次 Image.src 一次也不打磁盘', () => {
  const lookup = createResourceLookup(path.join(os.tmpdir(), 'kuma-no-mycache-should-not-exist'))
  const n = countAccessSync(() => {
    for (let i = 0; i < 200; i += 1) {
      assert.equal(
        lookup(`https://w00g.kancolle-server.com/kcs2/img/battle/${i}.png`),
        undefined,
      )
    }
  })
  // 从前这里是 1（判定走 accessSync）；判定改成目录非空之后，那一次落在 readdirSync 上，
  // 逐张图仍然一次 accessSync 都没有——这条守的是「逐张图空跑」，不是那一次判定用了哪个系统调用
  assert.equal(n, 0, `空缓存树不该逐张去 accessSync，实际 ${n} 次`)
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
    assert.equal(lookup(url, true), `kuma-cache://resource${pathname}`)
    fs.writeFileSync(hackPath, 'hack')
    const lookup2 = createResourceLookup(dir)
    assert.equal(lookup2(url), `kuma-cache://resource${pathname}`)
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
