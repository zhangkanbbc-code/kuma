// 「听过即存」的档案层护栏。
//
// 这里盯的每一条都是「写反了也不报错、只是某天默默把玩家攒了半年的东西弄没了」
// 那一类：淘汰规则、保住名单、以及「零网络请求」是不是**结构上**做得到。
// 所以判据尽量做成真调用与数据级比对，不去正则匹配源码文本
//（见共享记忆 source-pattern-guards-miss-logic-bugs：判断写反了正则照样绿）。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import plan from '../dist/shared/voice-archive-plan.js'

const {
  VOICE_ARCHIVE_MAX_BYTES,
  VOICE_ARCHIVE_SUGGESTED_MAX_BYTES,
  archiveLimitBytes,
  planVoiceArchiveEviction,
  voiceArchiveUnobtainable,
  voiceArchiveBlobPath,
  voiceArchiveKey,
  voiceArchiveState,
  voiceArchiveUsage,
} = plan

const entry = (over = {}) => ({
  pathname: '/kcs/sound/kc123/100234.mp3',
  mstId: 43,
  voiceId: 2,
  sha1: '0123456789abcdef',
  bytes: 40_000,
  firstHeard: 1_000,
  lastHeard: 2_000,
  heard: 1,
  ...over,
})

test('三态：没听过 / 听过但没留下实物 / 有实物', () => {
  assert.equal(voiceArchiveState([]), 'none')
  assert.equal(voiceArchiveState([entry({ sha1: '', bytes: 0 })]), 'heard')
  assert.equal(voiceArchiveState([entry()]), 'kept')
  // 同一路径既有占位又有实物时，实物说了算
  assert.equal(voiceArchiveState([entry({ sha1: '', bytes: 0 }), entry()]), 'kept')
})

test('档案键与实物路径把内容指纹带上：同一槽位的多个版本不会互相覆盖', () => {
  const a = entry({ sha1: 'aaaaaaaaaaaaaaaa' })
  const b = entry({ sha1: 'bbbbbbbbbbbbbbbb' })
  assert.notEqual(voiceArchiveKey(a.pathname, a.sha1), voiceArchiveKey(b.pathname, b.sha1))
  assert.equal(voiceArchiveBlobPath(a.pathname, a.sha1), 'sound/kc123/100234.aaaaaaaaaaaaaaaa.mp3')
  assert.notEqual(
    voiceArchiveBlobPath(a.pathname, a.sha1),
    voiceArchiveBlobPath(b.pathname, b.sha1),
  )
  // 没有指纹就没有实物文件——「只听过」那一档不该在盘上占位置
  assert.equal(voiceArchiveBlobPath(a.pathname, ''), null)
})

// ---- 上限：默认不限量（2026-08-23 拍板）----
//
// 原来默认 500 MB、写满自动淘汰。用户把这个决断收回去了——「留不留、是不是太占位置」
// 归每个玩家自己定。所以**默认一条都不淘汰**，档案只在他自己清空时变小。
// 下面这条是刻意反向的：原来钉「上限是 500 MB」，现在钉「默认不限量」。

test('默认不设上限，淘汰整条路根本不跑', () => {
  const entries = Array.from({ length: 50 }, (_, index) =>
    entry({
      pathname: `/kcs/sound/kc123/10${`${index}`.padStart(4, '0')}.mp3`,
      sha1: `${index}`.padStart(16, '0'),
      bytes: 9_000_000,
    }),
  )
  assert.deepEqual(planVoiceArchiveEviction(entries), [])
  assert.deepEqual(planVoiceArchiveEviction(entries, VOICE_ARCHIVE_MAX_BYTES), [])
  assert.equal(VOICE_ARCHIVE_MAX_BYTES, 0, '默认上限必须是「不限量」')
  // 500 MB 那个数留着当**建议值**给钥里的提示用，不再是默认行为
  assert.equal(VOICE_ARCHIVE_SUGGESTED_MAX_BYTES, 500 * 1024 * 1024)
})

test('上限取值归一：0/负数/空/乱填一律回不限量，别因为写法差异变成会淘汰', () => {
  for (const raw of [0, -1, null, undefined, '', 'abc', Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(archiveLimitBytes(raw), null, `${String(raw)} 该当不限量`)
  }
  assert.equal(archiveLimitBytes(1_024), 1_024)
  assert.equal(archiveLimitBytes('2048'), 2_048)
})

test('没到上限就一条都不淘汰', () => {
  const entries = [entry({ bytes: 1_000 }), entry({ sha1: 'ffffffffffffffff', bytes: 2_000 })]
  assert.deepEqual(planVoiceArchiveEviction(entries, 10_000), [])
})

test('设了上限才淘汰，先动最久没再听到的，且只动有实物的', () => {
  // ⚠️ 三条**分属不同路径**：同一路径下的旧版本会被判成「不可再得」而豁免
  //（那正是下面几条要钉的事），拿它们测 LRU 会把两件事混在一起。
  const old = entry({
    pathname: '/kcs/sound/kc123/100001.mp3',
    sha1: 'a'.repeat(16),
    bytes: 6_000,
    lastHeard: 100,
  })
  const fresh = entry({
    pathname: '/kcs/sound/kc123/100002.mp3',
    sha1: 'b'.repeat(16),
    bytes: 6_000,
    lastHeard: 9_000,
  })
  const heardOnly = entry({
    pathname: '/kcs/sound/kc123/100003.mp3',
    sha1: '',
    bytes: 0,
    lastHeard: 1,
  })
  const evicted = planVoiceArchiveEviction([fresh, heardOnly, old], 8_000)
  assert.deepEqual(
    evicted.map((row) => row.sha1),
    ['a'.repeat(16)],
  )
  // 「听过」那条记录几十字节，删它省不下空间，却会把玩家的半亮格子打回未点亮
  assert.equal(
    evicted.some((row) => !row.sha1),
    false,
  )
})

test('同样久没听的，先淘汰听得少的那一条', () => {
  const rare = entry({
    pathname: '/kcs/sound/kc123/100001.mp3',
    sha1: 'a'.repeat(16),
    bytes: 6_000,
    lastHeard: 100,
    heard: 1,
  })
  const loved = entry({
    pathname: '/kcs/sound/kc123/100002.mp3',
    sha1: 'b'.repeat(16),
    bytes: 6_000,
    lastHeard: 100,
    heard: 40,
  })
  const evicted = planVoiceArchiveEviction([loved, rare], 8_000)
  assert.deepEqual(
    evicted.map((row) => row.sha1),
    ['a'.repeat(16)],
  )
})

test('淘汰到刚好落回上限就停，不多删', () => {
  const entries = Array.from({ length: 10 }, (_, index) =>
    entry({
      pathname: `/kcs/sound/kc123/10000${index}.mp3`,
      sha1: `${index}`.repeat(16),
      bytes: 1_000,
      lastHeard: index,
    }),
  )
  const evicted = planVoiceArchiveEviction(entries, 7_000)
  assert.equal(evicted.length, 3)
  const remaining = 10_000 - evicted.reduce((sum, row) => sum + row.bytes, 0)
  assert.ok(remaining <= 7_000)
})

// ---- 「来源已不可再得」的一律豁免（2026-08-23 补的那处设计缝）----
//
// 档案的定位是「过季也能回顾，除非玩家自己清」。旧淘汰规则对常规件成立（删了能再听到），
// 对过季件却直接违背它：静默淘汰一条盛夏语音 = 永久失去，而它恰恰最符合
// 「最久没再听到」——**旧规则优先删掉的正是最删不得的那一批**。

test('同一地址上被顶替过的旧版本 = 不可再得，淘汰一律不碰', () => {
  const summer = entry({ sha1: 'a'.repeat(16), version: '805', bytes: 6_000, lastHeard: 100 })
  const regular = entry({ sha1: 'b'.repeat(16), version: '12', bytes: 6_000, lastHeard: 9_000 })
  const locked = voiceArchiveUnobtainable([summer, regular])
  assert.equal(locked.has(voiceArchiveKey(summer.pathname, summer.sha1)), true, '过季那一份该豁免')
  assert.equal(
    locked.has(voiceArchiveKey(regular.pathname, regular.sha1)),
    false,
    '现行那一份不该豁免',
  )
  // 淘汰候选里必须没有豁免件——哪怕它正是「最久没再听到」的那一条
  const evicted = planVoiceArchiveEviction([summer, regular], 8_000)
  assert.equal(
    evicted.some((row) => row.sha1 === summer.sha1),
    false,
    '过季那一份被自动淘汰了——删了就是永久失去',
  )
})

test('更晚的「只听过」占位同样构成顶替：那个地址已经换了内容', () => {
  const kept = entry({ sha1: 'a'.repeat(16), version: '12', bytes: 6_000, lastHeard: 100 })
  // 后来又听到一次，但版本换了、字节没留住 → 占位条。它证明那个地址换了东西。
  const placeholder = entry({ sha1: '', version: '99', bytes: 0, lastHeard: 9_000 })
  const locked = voiceArchiveUnobtainable([kept, placeholder])
  assert.equal(locked.has(voiceArchiveKey(kept.pathname, kept.sha1)), true)
})

test('判不出来源状态的按「可再得」处理——全都豁免等于把淘汰开关拆了', () => {
  const only = entry({ sha1: 'a'.repeat(16), bytes: 6_000 })
  assert.equal(voiceArchiveUnobtainable([only]).size, 0)
  assert.deepEqual(
    planVoiceArchiveEviction([only], 1_000).map((row) => row.sha1),
    ['a'.repeat(16)],
  )
})

test('满库全是豁免件时不淘汰，改由钥如实说满了', () => {
  // 同一地址下三个版本：只有最新那一份可淘汰，另两份不可再得
  const entries = [
    entry({ sha1: 'a'.repeat(16), version: '1', bytes: 6_000, lastHeard: 100 }),
    entry({ sha1: 'b'.repeat(16), version: '2', bytes: 6_000, lastHeard: 200 }),
    entry({ sha1: 'c'.repeat(16), version: '3', bytes: 6_000, lastHeard: 300 }),
  ]
  const evicted = planVoiceArchiveEviction(entries, 1_000)
  assert.deepEqual(
    evicted.map((row) => row.sha1),
    ['c'.repeat(16)],
    '只该动现行那一份，另两份取不回来',
  )
  const usage = voiceArchiveUsage(entries, 1_000)
  assert.equal(usage.full, true, '删无可删了就该如实标满')
  assert.equal(usage.lockedKept, 2)
  assert.equal(usage.lockedBytes, 12_000)
})

test('占用统计把「留住的」与「只听过的」分开数，并单列不可再得的那部分', () => {
  const usage = voiceArchiveUsage([
    entry({ bytes: 40_000 }),
    entry({ pathname: '/kcs/sound/kc123/100999.mp3', sha1: 'c'.repeat(16), bytes: 60_000 }),
    entry({ pathname: '/kcs/sound/kc123/100888.mp3', sha1: '', bytes: 0 }),
  ])
  assert.equal(usage.bytes, 100_000)
  assert.equal(usage.kept, 2)
  assert.equal(usage.heard, 1)
  // 默认不限量：既不淘汰，也谈不上「满」
  assert.equal(usage.maxBytes, null)
  assert.equal(usage.full, false)
  assert.equal(usage.lockedKept, 0)
})

// ---- 防误清：档案不是缓存 ----

const yuSource = fs.readFileSync(new URL('../src/main/yu.ts', import.meta.url), 'utf8')

test('缓存急救的删除清单里没有语音档案目录', async () => {
  const yu = await import('../dist/main/yu.js').catch(() => null)
  // yu 在 import 时就接线 ipcMain / app，脱开 Electron 跑不起来；
  // 那就退回读它导出的两张表的源码字面量——**但比对是数据级的**：
  // 把两张清单解析成数组再逐项核，不是拿正则去证明「源码里提到了 voice-archive」。
  const cacheDirs = /export const CACHE_DIRS = (\[[^\]]*\])/.exec(yuSource)
  const preserved = /export const PRESERVED_ENTRIES = (\[[\s\S]*?\n\])/.exec(yuSource)
  assert.ok(cacheDirs && preserved, 'yu.ts 的两张清单必须是可解析的字面量数组')
  const clearList = JSON.parse(cacheDirs[1].replace(/'/g, '"'))
  const keepList = JSON.parse(
    preserved[1]
      .replace(/\/\/[^\n]*/g, '')
      .replace(/,(\s*])/g, '$1')
      .replace(/'/g, '"'),
  )
  assert.ok(Array.isArray(clearList) && clearList.length >= 5)
  assert.ok(keepList.includes('voice-archive'), '语音档案必须在保住名单里')
  for (const kept of keepList) {
    assert.equal(
      clearList.includes(kept),
      false,
      `${kept} 同时出现在删除清单与保住名单里——两张表打架了`,
    )
  }
  // 玩家资产逐条点名：漏掉任何一个的代价都是数据没了
  for (const must of ['Network', 'config.json', 'mg.sqlite', 'lodes', 'voice-archive']) {
    assert.ok(keepList.includes(must), `${must} 不在保住名单里`)
  }
  assert.ok(yu !== undefined)
})

test('档案目录与缓存目录不是同一个地方', () => {
  const archiveSource = fs.readFileSync(
    new URL('../src/main/voice-archive.ts', import.meta.url),
    'utf8',
  )
  // 档案挂在 APPDATA_PATH 下自己的目录，绝不能挂在 DEFAULT_CACHE_PATH 里面——
  // 挂进去就等于把它交给了「清理缓存」那把刀
  assert.match(archiveSource, /VOICE_ARCHIVE_DIR = path\.join\(APPDATA_PATH, 'voice-archive'\)/)
  assert.equal(archiveSource.includes('DEFAULT_CACHE_PATH'), false)
})

test('取字节那一半结构上发不出网络请求：只用 only-if-cached', () => {
  const preload = fs.readFileSync(
    new URL('../assets/preload/voice-archive.js', import.meta.url),
    'utf8',
  )
  // 先把注释剥掉再看代码：这个文件的注释里就写着「主进程的 net.fetch 已证伪」，
  // 不剥就会被自己的说明文字绊倒（这正是源码文本护栏的老毛病）。
  const code = preload
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n')
  const fetches = code.match(/fetch\([^)]*\)/g) ?? []
  assert.equal(fetches.length, 1, '这个文件只该有一处 fetch')
  assert.match(fetches[0], /cache: 'only-if-cached'/)
  assert.match(fetches[0], /mode: 'same-origin'/)
  // 缓存没命中时 only-if-cached 是抛错而不是走网络；这里绝不能有重试/换取法
  assert.equal(/XMLHttpRequest|new Audio|net\.fetch|\.retry|setInterval/i.test(code), false)
})
