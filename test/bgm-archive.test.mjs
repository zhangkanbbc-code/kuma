// BGM 档案的护栏。判据全部**真调用** shared/bgm-archive-plan 里的函数，
// 不去正则匹配源码文本——上限与淘汰正是那种「写反了也不报错、
// 只是某天默默把玩家攒下的曲子清空」的逻辑（家法见
// shared/source-pattern-guards-miss-logic-bugs）。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import plan from '../dist/shared/bgm-archive-plan.js'

const {
  BGM_ARCHIVE_MAX_BYTES,
  BGM_ARCHIVE_PATH,
  bgmArchiveBlobPath,
  bgmArchiveHasBlobFor,
  bgmArchiveIdentity,
  bgmArchiveKey,
  bgmArchiveState,
  bgmArchiveUnobtainable,
  bgmArchiveUsage,
  planBgmArchiveEviction,
  sanitizeBgmArchiveEntry,
} = plan

const entry = (over = {}) => ({
  pathname: '/kcs2/resources/bgm/battle/275_1741.mp3',
  sha1: '0123456789abcdef',
  version: '',
  bytes: 1_000,
  firstHeard: 1,
  lastHeard: 1,
  heard: 1,
  ...over,
})

test('路径形状：两棵树的音轨认，别的一律拒', () => {
  assert.deepEqual(bgmArchiveIdentity('/kcs2/resources/bgm/battle/275_1741.mp3'), {
    kind: 'battle',
    id: 275,
  })
  assert.deepEqual(bgmArchiveIdentity('/kcs2/resources/bgm/port/115_1441.mp3'), {
    kind: 'port',
    id: 115,
  })
  // fanfare 是结算音，不是「正在播放的 BGM」，也不进这份档案
  assert.equal(bgmArchiveIdentity('/kcs2/resources/bgm/fanfare/001_7793.mp3'), null)
  // 目录穿越 / 别的资源 / 空 一律拒——这条路径会被拿去拼本地文件名
  assert.equal(bgmArchiveIdentity('/kcs2/resources/bgm/battle/../../evil.mp3'), null)
  assert.equal(bgmArchiveIdentity('/kcs/sound/kc123/456.mp3'), null)
  assert.equal(bgmArchiveIdentity(''), null)
})

test('收敛：树与号一律从路径重解，不采信记录里自称的那两个字段', () => {
  // 这个桥对游戏页面上任何脚本都可达。让它自己说自己是哪棵树 = 等于没有校验，
  // 而两棵树同号是两首不同的曲子（battle/118 与 port/118）。
  const forged = sanitizeBgmArchiveEntry(
    entry({ pathname: '/kcs2/resources/bgm/battle/118_1234.mp3', kind: 'port', id: 999 }),
  )
  assert.equal(forged.kind, 'battle')
  assert.equal(forged.id, 118)
  // 形状不对的整条丢
  assert.equal(sanitizeBgmArchiveEntry(entry({ pathname: '/etc/passwd' })), null)
  assert.equal(sanitizeBgmArchiveEntry(entry({ sha1: 'ZZZZ' })), null)
  assert.equal(sanitizeBgmArchiveEntry(null), null)
  // 版本认不出只当没有，**不整条丢弃**——版本记不下来只是少一层归因线索
  assert.equal(sanitizeBgmArchiveEntry(entry({ version: '不像版本 号' })).version, '')
  assert.equal(sanitizeBgmArchiveEntry(entry({ version: '1.2.3-x' })).version, '1.2.3-x')
})

test('实物文件名带指纹：同一个号换过内容不会互相覆盖，且落在自己那棵树的目录里', () => {
  const a = bgmArchiveBlobPath('/kcs2/resources/bgm/battle/275_1741.mp3', 'aaaaaaaaaaaaaaaa')
  const b = bgmArchiveBlobPath('/kcs2/resources/bgm/battle/275_1741.mp3', 'bbbbbbbbbbbbbbbb')
  assert.equal(a, 'bgm/battle/275_1741.aaaaaaaaaaaaaaaa.mp3')
  assert.notEqual(a, b)
  assert.equal(
    bgmArchiveBlobPath('/kcs2/resources/bgm/port/115_1441.mp3', 'cccccccccccccccc'),
    'bgm/port/115_1441.cccccccccccccccc.mp3',
  )
  // 没有指纹就没有实物，别拼出一个会被当成实物的名字
  assert.equal(bgmArchiveBlobPath('/kcs2/resources/bgm/battle/275_1741.mp3', ''), null)
})

test('三态与「这个版本存过没有」：判据必须连版本一起看', () => {
  assert.equal(bgmArchiveState([]), 'none')
  assert.equal(bgmArchiveState([entry({ bytes: 0, sha1: '' })]), 'heard')
  assert.equal(bgmArchiveState([entry()]), 'kept')
  const list = [entry({ version: 'v1' })]
  assert.equal(bgmArchiveHasBlobFor(list, list[0].pathname, 'v1'), true)
  // 官方推了版本 = 同一地址换了文件：旧版存过不代表新版存过，否则新版永远不去取
  assert.equal(bgmArchiveHasBlobFor(list, list[0].pathname, 'v2'), false)
})

test('不可再得：被顶替的那一份锁住，自动淘汰永远不碰它', () => {
  // 活动曲撤场后再也不会响，恰恰最符合「最久没再听到」——
  // 旧式 LRU 会优先删掉最删不得的那一批，这条豁免就是拦它的。
  const old = entry({ sha1: 'a'.repeat(16), version: 'v1', lastHeard: 10 })
  const now = entry({ sha1: 'b'.repeat(16), version: 'v2', lastHeard: 20 })
  const locked = bgmArchiveUnobtainable([old, now])
  assert.equal(locked.has(bgmArchiveKey(old.pathname, old.sha1)), true)
  assert.equal(locked.has(bgmArchiveKey(now.pathname, now.sha1)), false)
  // 一条路径下只有一份时不做保守豁免（全豁免等于把淘汰开关拆了）
  assert.equal(bgmArchiveUnobtainable([now]).size, 0)
})

test('淘汰：默认不限量就一条都不删；设了上限才删，且跳过不可再得的', () => {
  const a = entry({ pathname: '/kcs2/resources/bgm/battle/101_1111.mp3', sha1: 'a'.repeat(16), bytes: 100, lastHeard: 1 })
  const b = entry({ pathname: '/kcs2/resources/bgm/battle/102_2222.mp3', sha1: 'b'.repeat(16), bytes: 100, lastHeard: 2 })
  const list = [a, b]
  // 默认（0 = 不限量）：一条都不淘汰。这是判据本身，不是优化
  assert.equal(BGM_ARCHIVE_MAX_BYTES, 0)
  assert.deepEqual(planBgmArchiveEviction(list), [])
  assert.deepEqual(planBgmArchiveEviction(list, null), [])
  // 设了上限：先淘汰最久没再听到的
  assert.deepEqual(planBgmArchiveEviction(list, 150).map((x) => x.pathname), [a.pathname])
  // 没超就不动
  assert.deepEqual(planBgmArchiveEviction(list, 500), [])
})

test('占用统计：不可再得的算出来，且「满了但删不得」要如实报 full', () => {
  const old = entry({ sha1: 'a'.repeat(16), version: 'v1', bytes: 200, lastHeard: 10 })
  const now = entry({ sha1: 'b'.repeat(16), version: 'v2', bytes: 200, lastHeard: 20 })
  const heardOnly = entry({
    pathname: '/kcs2/resources/bgm/battle/999_9999.mp3',
    sha1: '',
    bytes: 0,
  })
  const usage = bgmArchiveUsage([old, now, heardOnly], 100)
  assert.equal(usage.bytes, 400)
  assert.equal(usage.kept, 2)
  assert.equal(usage.heard, 1)
  assert.equal(usage.lockedKept, 1)
  assert.equal(usage.lockedBytes, 200)
  // 能淘汰的都汰完仍旧超 → 不删不可再得的，交给钥如实说一声
  assert.equal(usage.full, true)
  // 不限量时永不为 full
  assert.equal(bgmArchiveUsage([old, now], null).full, false)
})

test('页面侧那条路的路径判据与策略层同源，别各写一份走岔', () => {
  const preload = fs.readFileSync(new URL('../assets/preload/bgm-archive.js', import.meta.url), 'utf8')
  // 两边都要认同一批路径：页面侧放宽了会把别的东西搬进档案，收紧了会静默漏存
  const sample = [
    '/kcs2/resources/bgm/battle/275_1741.mp3',
    '/kcs2/resources/bgm/port/115_1441.mp3',
    '/kcs2/resources/bgm/fanfare/001_7793.mp3',
    '/kcs/sound/kc123/456.mp3',
  ]
  const inPreload = /const BGM_PATH = (\/.*\/[a-z]*)/.exec(preload)
  assert.ok(inPreload, 'preload 里没找到 BGM_PATH，判据要跟着改')
  // eslint-disable-next-line no-eval
  const preloadRe = eval(inPreload[1])
  for (const path of sample) {
    assert.equal(
      preloadRe.test(path),
      BGM_ARCHIVE_PATH.test(path),
      `${path} 在两侧的判定不一致`,
    )
  }
})

test('清缓存不碰 BGM 档案：活动曲撤场后它就是唯一来源', () => {
  // 玩家卡加载时清缓存是正常操作，不能顺手把攒下的曲子一起清掉。
  // 比对是**数据级**的：把清单解析成数组再逐项核，不是拿正则证明「源码里提到了」。
  // （`dist/main/yu.js` 直接 import 会拉起 electron，所以读源码里的字面量。）
  const yuSource = fs.readFileSync(new URL('../src/main/yu.ts', import.meta.url), 'utf8')
  const preserved = /export const PRESERVED_ENTRIES = (\[[\s\S]*?\n\])/.exec(yuSource)
  assert.ok(preserved, 'yu.ts 的保住名单必须是可解析的字面量数组')
  const keepList = JSON.parse(
    preserved[1]
      .replace(/\/\/[^\n]*/g, '')
      .replace(/,(\s*])/g, '$1')
      .replace(/'/g, '"'),
  )
  assert.ok(keepList.includes('bgm-archive'), 'BGM 档案必须在保住名单里')
  // 三族同进退：漏掉任何一个，代价都是玩家的资产没了
  assert.ok(keepList.includes('voice-archive'))
  assert.ok(keepList.includes('art-archive'))
})
