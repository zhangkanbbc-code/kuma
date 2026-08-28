// 「见过即存」的立绘档案护栏。语音侧 test/voice-archive.test.mjs 的同族。
//
// 这里盯的每一条都是「写反了也不报错、只是某天默默把玩家攒了半年的东西弄没了」
// 那一类：淘汰规则、保住名单、以及「零网络请求」是不是**结构上**做得到。
// 所以判据尽量做成真调用与数据级比对，不去正则匹配源码文本
//（见共享记忆 source-pattern-guards-miss-logic-bugs：判断写反了正则照样绿）。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import plan from '../dist/shared/art-archive-plan.js'
import voicePlan from '../dist/shared/voice-archive-plan.js'

const {
  ART_ARCHIVE_MAX_BYTES,
  ART_ARCHIVE_MAX_ENTRY_BYTES,
  ART_ARCHIVE_REQUIRED_FIELDS,
  artArchiveBlobPath,
  artArchiveHasBlobFor,
  artArchiveKey,
  artArchiveState,
  ART_ARCHIVE_SUGGESTED_MAX_BYTES,
  artArchiveUnobtainable,
  artArchiveUsage,
  legacyArchivedArt,
  planArtArchiveEviction,
  sanitizeArtArchiveEntry,
  shouldArchiveArtType,
} = plan

/**
 * 剥掉注释再看代码。
 *
 * 源码文本护栏最容易被**自己的说明文字**咬：记录「这句话已经删了」的那段注释里
 * 必然还写着那句话，不剥就会拿正确的代码报错（art-archive.js 那条 fetch 护栏
 * 早就踩过一次，这里照抄它的做法）。
 */
const stripComments = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n')

const PATH_FULL = '/kcs2/resources/ship/full/0961_6849_xgkywfhkphjf.png'

const entry = (over = {}) => ({
  pathname: PATH_FULL,
  mstId: 961,
  type: 'full',
  version: '109',
  sha1: '0123456789abcdef',
  bytes: 600_000,
  firstSeen: 1_000,
  lastSeen: 2_000,
  seen: 1,
  ...over,
})

test('三态：没见过 / 见过但没留下实物 / 有实物', () => {
  assert.equal(artArchiveState([]), 'none')
  assert.equal(artArchiveState([entry({ sha1: '', bytes: 0 })]), 'seen')
  assert.equal(artArchiveState([entry()]), 'kept')
  // 同一路径既有占位又有实物时，实物说了算
  assert.equal(artArchiveState([entry({ sha1: '', bytes: 0 }), entry()]), 'kept')
})

test('档案键与实物路径把内容指纹带上：同一槽位的季节版与常服不会互相覆盖', () => {
  const a = entry({ sha1: 'a'.repeat(16) })
  const b = entry({ sha1: 'b'.repeat(16) })
  assert.notEqual(artArchiveKey(a.pathname, a.sha1), artArchiveKey(b.pathname, b.sha1))
  assert.equal(
    artArchiveBlobPath(a.pathname, a.sha1),
    `art/full/0961_6849_xgkywfhkphjf.${'a'.repeat(16)}.png`,
  )
  assert.notEqual(artArchiveBlobPath(a.pathname, a.sha1), artArchiveBlobPath(b.pathname, b.sha1))
  // 没有指纹就没有实物文件——「只见过」那一档不该在盘上占位置
  assert.equal(artArchiveBlobPath(a.pathname, ''), null)
})

test('「已经留住了」的判据连版本一起看：换季那一张必须还去取', () => {
  const kept = entry({ version: '109' })
  assert.equal(artArchiveHasBlobFor([kept], kept.pathname, '109'), true)
  assert.equal(
    artArchiveHasBlobFor([kept], kept.pathname, '110'),
    false,
    '官方换季推高了版本号，这是一张没见过的图——过季就再也取不回来了',
  )
})

test('只收立绘级图种；深海舰额外收横幅（那是它们唯一的图）', () => {
  assert.equal(shouldArchiveArtType(961, 'full'), true)
  assert.equal(shouldArchiveArtType(961, 'full_dmg'), true)
  assert.equal(shouldArchiveArtType(961, 'album_status'), true)
  // 界面零件不是收集品：全收会让档案被小图塞满，真正的立绘反被淘汰
  assert.equal(shouldArchiveArtType(961, 'banner'), false)
  assert.equal(shouldArchiveArtType(961, 'card'), false)
  assert.equal(shouldArchiveArtType(961, 'supply_character'), false)
  // 深海（>=1500）：官方极少给它们做全身立绘，横幅就是唯一的图
  assert.equal(shouldArchiveArtType(1587, 'banner'), true)
  assert.equal(shouldArchiveArtType(1587, 'banner_dmg'), true)
  assert.equal(shouldArchiveArtType(1587, 'card'), false)
})

test('没到上限就一张都不淘汰', () => {
  const entries = [entry({ bytes: 1_000 }), entry({ sha1: 'f'.repeat(16), bytes: 2_000 })]
  assert.deepEqual(planArtArchiveEviction(entries, 10_000), [])
})

test('设了上限才淘汰，先动最久没再见到的，且只动有实物的', () => {
  // ⚠️ 三条**分属不同槽位**：同一 (形态, 图种) 下的旧版本会被判成「不可再得」而豁免
  //（那正是下面几条要钉的事），拿它们测 LRU 会把两件事混在一起。
  const old = entry({ type: 'full', sha1: 'a'.repeat(16), bytes: 6_000, lastSeen: 100 })
  const fresh = entry({ type: 'full_dmg', sha1: 'b'.repeat(16), bytes: 6_000, lastSeen: 9_000 })
  const seenOnly = entry({ type: 'album_status', sha1: '', bytes: 0, lastSeen: 1 })
  const evicted = planArtArchiveEviction([fresh, seenOnly, old], 8_000)
  assert.deepEqual(evicted.map((row) => row.sha1), ['a'.repeat(16)])
  // 「见过」那条记录几十字节，删它省不下空间，却会把玩家的半亮格子打回未点亮
  assert.equal(evicted.some((row) => !row.sha1), false)
})

test('同样久没见的，先淘汰见得少的那一张', () => {
  const rare = entry({ type: 'full', sha1: 'a'.repeat(16), bytes: 6_000, lastSeen: 100, seen: 1 })
  const loved = entry({
    type: 'full_dmg',
    sha1: 'b'.repeat(16),
    bytes: 6_000,
    lastSeen: 100,
    seen: 40,
  })
  assert.deepEqual(
    planArtArchiveEviction([loved, rare], 8_000).map((row) => row.sha1),
    ['a'.repeat(16)],
  )
})

// ---- 「来源已不可再得」的一律豁免（2026-08-23，与语音侧同一批）----
//
// 立绘侧的分组键与语音侧不同：kcs2 把版本键**编进文件名**，官方换季连路径一起换，
// 所以「同一个地址换了内容」在这里表现为「同一 (形态, 图种) 下多了一条新路径」。
// 按路径分组就永远看不到顶替关系——那正是这条测试要挡住的写法。

test('同槽位下被顶替过的旧版本 = 不可再得，淘汰一律不碰（换季连路径一起换）', () => {
  const summer = entry({
    pathname: '/kcs2/resources/ship/full/0961_7777_aaaaaaaaaaaa.png',
    sha1: 'a'.repeat(16),
    version: '108',
    bytes: 6_000,
    lastSeen: 100,
  })
  const regular = entry({ sha1: 'b'.repeat(16), version: '109', bytes: 6_000, lastSeen: 9_000 })
  const locked = artArchiveUnobtainable([summer, regular])
  assert.equal(locked.has(artArchiveKey(summer.pathname, summer.sha1)), true, '过季那一张该豁免')
  assert.equal(locked.has(artArchiveKey(regular.pathname, regular.sha1)), false)
  assert.equal(
    planArtArchiveEviction([summer, regular], 8_000).some((row) => row.sha1 === summer.sha1),
    false,
    '过季那一张被自动淘汰了——活动撤场后再也取不回来',
  )
})

test('判不出来源状态的按「可再得」处理——全都豁免等于把淘汰开关拆了', () => {
  const only = entry({ sha1: 'a'.repeat(16), bytes: 6_000 })
  assert.equal(artArchiveUnobtainable([only]).size, 0)
  assert.deepEqual(
    planArtArchiveEviction([only], 1_000).map((row) => row.sha1),
    ['a'.repeat(16)],
  )
})

test('满库全是豁免件时不淘汰，改由钥如实说满了', () => {
  const entries = ['1', '2', '3'].map((n, index) =>
    entry({
      pathname: `/kcs2/resources/ship/full/0961_000${n}_aaaaaaaaaaaa.png`,
      sha1: `${n}`.repeat(16),
      version: n,
      bytes: 6_000,
      lastSeen: 100 * (index + 1),
    }),
  )
  assert.deepEqual(
    planArtArchiveEviction(entries, 1_000).map((row) => row.sha1),
    ['3'.repeat(16)],
    '只该动现行那一张，另两张取不回来',
  )
  const usage = artArchiveUsage(entries, 1_000)
  assert.equal(usage.full, true)
  assert.equal(usage.lockedKept, 2)
  assert.equal(usage.lockedBytes, 12_000)
})

test('占用统计把「留住的」「只见过的」「覆盖多少形态」分开数', () => {
  const usage = artArchiveUsage([
    entry({ bytes: 400_000 }),
    entry({ sha1: 'c'.repeat(16), type: 'full_dmg', bytes: 600_000 }),
    entry({ sha1: 'd'.repeat(16), mstId: 145, pathname: '/kcs2/resources/ship/full/0145_1234.png' }),
    entry({ sha1: '', bytes: 0, type: 'album_status' }),
  ])
  assert.equal(usage.bytes, 1_600_000)
  assert.equal(usage.kept, 3)
  assert.equal(usage.seen, 1)
  assert.equal(usage.forms, 2, '两个形态：961 与 145')
  // 默认不限量：既不淘汰，也谈不上「满」
  assert.equal(usage.maxBytes, null)
  assert.equal(usage.full, false)
  assert.equal(usage.lockedKept, 0)
})

// ⚠️ 这一条 2026-08-23 **刻意反转过**：原来钉的是「上限 2 GB」，
// 现在钉「默认不限量」。用户把「留不留」的决断收回给玩家自己了。
test('默认不设上限；2 GB / 8 MB 那两个数各自的角色不许混', () => {
  const entries = Array.from({ length: 20 }, (_, index) =>
    entry({
      pathname: `/kcs2/resources/ship/full/09${`${index}`.padStart(2, '0')}_1234.png`,
      mstId: 900 + index,
      sha1: `${index}`.padStart(16, '0'),
      bytes: 500_000_000,
    }),
  )
  assert.deepEqual(planArtArchiveEviction(entries), [], '默认必须一条都不淘汰')
  assert.equal(ART_ARCHIVE_MAX_BYTES, 0, '默认上限必须是「不限量」')

  // 依据（2026-08-22 本机 Chromium 缓存实测）：2938 张游戏 PNG，
  // 200 KB 以上那批（立绘级）均值 609 KB，最大 6.73 MB。
  // 「1200 形态 × 常服/中破」≈ 2400 张 × 609 KB ≈ 1.4 GB，2 GB 装得下再留余量。
  // 这个数现在是**建议值**（钥里的提示），不是默认行为。
  assert.equal(ART_ARCHIVE_SUGGESTED_MAX_BYTES, 2 * 1024 * 1024 * 1024)
  // 单条上限**不受这次改动影响**：它拦的是「这多半不是立绘，是别的东西走岔了路」
  assert.equal(ART_ARCHIVE_MAX_ENTRY_BYTES, 8 * 1024 * 1024)
  // 立绘单张比语音大得多，两个数**不该**是同一个——合成一份的话，
  // 改语音的规则就会顺手把立绘也改了
  assert.ok(ART_ARCHIVE_SUGGESTED_MAX_BYTES > voicePlan.VOICE_ARCHIVE_SUGGESTED_MAX_BYTES)
  assert.ok(ART_ARCHIVE_MAX_ENTRY_BYTES > voicePlan.VOICE_ARCHIVE_MAX_ENTRY_BYTES)
})

// ---- 「先收后认」：字段不许丢 ----

test('档案条目必带的回溯归因字段一个都不能少', () => {
  const parsed = sanitizeArtArchiveEntry({
    pathname: PATH_FULL,
    version: '109',
    sha1: 'b'.repeat(16),
    bytes: 600_000,
    firstSeen: 1_700_000_000_000,
    lastSeen: 1_700_000_000_000,
    seen: 1,
  })
  assert.ok(parsed)
  for (const field of ART_ARCHIVE_REQUIRED_FIELDS) {
    assert.ok(field in parsed, `${field} 丢了——当季见到、清单还没誊写的那些就失去归因依据了`)
  }
  // 归属不靠额外字段：路径里的四位号就是形态，图种就是目录名
  assert.equal(parsed.mstId, 961)
  assert.equal(parsed.type, 'full')
  assert.equal(parsed.version, '109')
})

test('版本参数形状不对时只丢版本，不丢整张实物', () => {
  const parsed = sanitizeArtArchiveEntry({
    pathname: PATH_FULL,
    version: 'https://evil/',
    sha1: 'c'.repeat(16),
    bytes: 600_000,
  })
  assert.ok(parsed, '版本记不下来只是少一层线索，实物本身仍然值得留住')
  assert.equal(parsed.version, '')
})

test('路径形状不对的一律拒（这个桥对游戏页任何脚本都可达）', () => {
  assert.equal(sanitizeArtArchiveEntry({ pathname: '/etc/passwd' }), null)
  assert.equal(sanitizeArtArchiveEntry({ pathname: '/kcs2/resources/ship/full/../../x.png' }), null)
  assert.equal(sanitizeArtArchiveEntry({ pathname: '/kcs2/resources/map/045/01.png' }), null)
  assert.equal(sanitizeArtArchiveEntry(null), null)
  // 文件名必须以四位号起头（游戏的 padId 固定补到 4 位）
  assert.equal(sanitizeArtArchiveEntry({ pathname: '/kcs2/resources/ship/full/12_ab.png' }), null)
})

// ---- 防误清：档案不是缓存 ----

const yuSource = fs.readFileSync(new URL('../src/main/yu.ts', import.meta.url), 'utf8')

test('缓存急救的删除清单里没有立绘档案目录', () => {
  // 比对是**数据级**的：把两张清单解析成数组再逐项核，
  // 不是拿正则去证明「源码里提到了 art-archive」。
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
  assert.ok(keepList.includes('art-archive'), '立绘档案必须在保住名单里')
  for (const kept of keepList) {
    assert.equal(clearList.includes(kept), false, `${kept} 同时出现在删除清单与保住名单里`)
  }
  // 两份玩家资产逐条点名：漏掉任何一个的代价都是数据没了
  for (const must of ['voice-archive', 'art-archive']) {
    assert.ok(keepList.includes(must), `${must} 不在保住名单里`)
  }
})

test('档案目录与缓存目录不是同一个地方', () => {
  const source = fs.readFileSync(new URL('../src/main/art-archive.ts', import.meta.url), 'utf8')
  // 档案挂在 APPDATA_PATH 下自己的目录，绝不能挂在 DEFAULT_CACHE_PATH 里面——
  // 挂进去就等于把它交给了「清理缓存」那把刀
  assert.match(source, /ART_ARCHIVE_DIR = path\.join\(APPDATA_PATH, 'art-archive'\)/)
  assert.equal(source.includes('DEFAULT_CACHE_PATH'), false)
})

test('取字节那一半结构上发不出网络请求：只用 only-if-cached', () => {
  const preload = fs.readFileSync(
    new URL('../assets/preload/art-archive.js', import.meta.url),
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
  assert.equal(/XMLHttpRequest|new Image|net\.fetch|\.retry|setInterval/i.test(code), false)
  // 也绝不从任何第三方站取图
  assert.equal(/wikia|fandom|kcwiki|tsunkit|http:\/\/|https:\/\//i.test(code), false)
})

// ---- 「显示即入档」：消灭「图在眼前却说没见到」（2026-08-23）----
//
// 用户实机报的那处脱节：整张立绘好端端显示着，收集格却写「0/6 图种」。
// 两本账各说各的——**显示**走缓存命中 + 游戏资源服务器回退，**点亮**认档案层，
// 而档案层此前只收「游戏页面自己请求资源」那条钩子，艦素自己摆出来的图不经过它。
// 补法不是把点亮判据放宽去认缓存（缓存会被整盘丢弃，收集进度会随时蒸发），
// 而是把显示这件事本身变成一次入档。

test('显示成功的那一格会入档，且带的是与点亮判据同一个身份', () => {
  const image = fs.readFileSync(new URL('../src/renderer/kcs-image.ts', import.meta.url), 'utf8')
  const ji = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  // 路径推导只有一份，取图与入档共用——各写一份必然漂移，
  // 而漂移的表现正是「图显示出来了、格子却不亮」，不报错
  assert.match(image, /export const shipImagePath = /)
  assert.match(image, /export const noteShipArtDisplayed = /)
  assert.match(image, /ipcRenderer\.send\('kanso:archive-capture-art'/)
  // 格子上带着那条身份，load 之后拿它入档
  assert.match(ji, /data-cg-path="\$\{esc\(im\.pathname\)\}"/)
  assert.match(ji, /data-cg-path="\$\{esc\(image\.pathname\)\}"/)
  assert.match(ji, /const captureCell = /)
  // 第三个参数是**主数据里的现行版号**，2026-08-23 随季节点收清单加的：
  // 本机缓存命中时地址是 file://，`?version=` 提不出来，而版本是版本对账的判据
  //（没有它，点收格会永远显示成「还没收到现行版」，点多少次都不变）。
  assert.match(ji, /if \(pathname && url\) noteShipArtDisplayed\(pathname, url, cell\?\.dataset\.cgVersion\)/)
  assert.match(image, /export const noteShipArtDisplayed = \(pathname: string, url: string, version\?: string\)/)
  assert.match(image, /version: version \?\? ''/)
  // **不在热路径上**：单向 send，显示不等转存
  assert.equal(/invoke\('kanso:archive-capture-art'/.test(image), false, '入档不该用会等结果的 invoke')
})

test('入档取字节：本机缓存文件优先，回退受开关管，且不重试不换取法', () => {
  const capture = fs.readFileSync(
    new URL('../src/main/archive-capture.ts', import.meta.url),
    'utf8',
  )
  const code = capture
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n')
  // 顺序是判据本身：先读本机缓存文件（零网络），读不到才走游戏自己的服务器
  const cached = code.indexOf('cachedBytes(pathname)')
  const remote = code.indexOf('await remoteBytes(')
  assert.ok(cached > 0 && remote > cached, '本机缓存文件必须排在回退之前')
  // 回退受钥里那个开关管（立绘与语音同一个）
  assert.match(code, /if \(!config\.get\('kanso\.remoteArt', true\)\) return null/)
  // 只指向游戏自己的服务器，且不重试、不换取法、不碰第三方站
  assert.match(code, /url\.protocol !== 'https:'/)
  assert.equal(/wikia|fandom|kcwiki|tsunkit|XMLHttpRequest|\.retry|setInterval/i.test(code), false)
  // 并发有上限：切页那一下不该并发几十个读盘
  assert.match(code, /inFlight\.size >= MAX_IN_FLIGHT/)
})

test('入档只收立绘级图种：一屏立绘页摆着十几张界面零件，全收会把档案塞满小图', () => {
  const capture = fs.readFileSync(
    new URL('../src/main/archive-capture.ts', import.meta.url),
    'utf8',
  )
  // 与游戏页那条路同一道闸门（kcs-resource 也在要字节之前判它）
  assert.match(capture, /shouldArchiveArtType\(Number\(matched\[2\]\), matched\[1\]\.toLowerCase\(\)\)/)
  // 判据本身：横幅/卡面/补给小图是界面零件，不是收集品
  assert.equal(shouldArchiveArtType(961, 'banner'), false)
  assert.equal(shouldArchiveArtType(961, 'card'), false)
  assert.equal(shouldArchiveArtType(961, 'supply_character'), false)
  // 立绘级那几种必须都在「值得收」的名单里，否则画廊尾巴永远等不到它们
  for (const type of [
    'full',
    'full_dmg',
    'character_full',
    'character_full_dmg',
    'album_status',
    'remodel',
  ]) {
    assert.equal(shouldArchiveArtType(961, type), true, `${type} 收不进档案，旧版就永远留不下`)
  }
})

// ---- 收藏格 UI 整层拔掉，存储机制全留（2026-08-23 晚 用户拍板）----
//
// 原话：「这个部分，包括深海那边也完全拔掉，要不然总会出一些奇奇怪怪的bug，
// 就只做立绘侧的保留自扩展缓存的权利就好」。立绘于是从「收藏玩法」退回「静默权利」：
// 三态格、图种分区、留存计数、插入式扩展格全部消失（深海那个 `[object Object]`
// 的 bug 也随代码一起消失了——它是 `cgSlotCell` 返回对象却被直接 join 出来的）。
// 留下来的展示面只有一处：**图鉴立绘画廊的尾巴**，续排档案里的非现行版本
//（原话「都显示在图鉴里面，接着放到这个角色『原版所有皮肤图』的下面接着展示」）。

test('收藏格 UI 一件都不许回潮：三态格、图种分区、扩展格、留存计数全没了', () => {
  const raw = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  // 先剥注释：记录「这些已经拆了」的那段说明里必然还写着它们的名字
  const ji = stripComments(raw)
  for (const gone of [
    'const cgSlotCell',
    'const cgCollectHtml',
    'const cgExpansionHtml',
    'const abyssCgCollectHtml',
    'CG_COLLECT_SLOTS',
    'CG_COLLECT_TYPES',
    'class="cg-slots"',
    'class="cg-collect',
    'cg-expansion',
  ]) {
    assert.equal(ji.includes(gone), false, `收藏格 UI 回潮了：${gone}`)
  }
  // 计数头是这一改被点名拔掉的措辞，别换个写法长回来
  for (const gone of ['图种 · 档案留存', '个形态有留存']) {
    assert.equal(ji.includes(gone), false, `留存计数回潮了：${gone}`)
  }
  // 昨天那个 bug 的具体形状：返回对象的格子函数被直接 join 进 HTML。
  // 代码拆掉之后它在结构上就不可能了——这里钉住「别把同款写法搬回来」。
  assert.equal(/\[object Object\]/.test(ji), false)
  // 存储机制**一格没动**：查询口、独立目录、急救保住名单都还在（另有专测）
  const art = fs.readFileSync(new URL('../src/renderer/art-archive.ts', import.meta.url), 'utf8')
  for (const kept of [
    'export const artLitState',
    'export const archivedArtEntries',
    'export const archivedArtEntriesOfShip',
    'export const archivedArtUrl',
    'export const artKeptTypeCount',
    'export const artArchiveReady',
  ]) {
    assert.ok(art.includes(kept), `存储层的查询口被顺手删了：${kept}`)
  }
})

test('完成度框架不许回潮：没有 x/y 进度，也没有跨舰收集度', () => {
  const ji = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  const art = fs.readFileSync(new URL('../src/renderer/art-archive.ts', import.meta.url), 'utf8')
  for (const gone of [
    '本舰 ${keptForms}/${family.length} 形态',
    '本形态 ${keptTypes}/${CG_COLLECT_SLOTS.length} 图种',
    '全部 ${keptAllForms}/${totalForms} 形态',
    "已收藏 ${litTotal}/${lines.length} 句",
  ]) {
    assert.equal(ji.includes(gone), false, `完成度框架回潮了：${gone}`)
  }
  // 跨舰收集度那个分子整个退役了，别再加回来
  assert.equal(/export const artKeptFormCount/.test(art), false, 'artKeptFormCount 又回来了')
  assert.equal(ji.includes('artKeptFormCount'), false, 'ji 又在数跨舰收集度')
  // 语音侧的中性库存陈述照旧（那一卷这次没动）
  assert.match(ji, /官方 \$\{lines\.length\} 句 \/ \$\{ordered\.length\} 季 · 档案留存 \$\{litTotal\}/)
})

test('空状态是陈述不是催促，「已收藏」那个词也退出档案语境', () => {
  const raw = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  // 先把注释剥掉再看代码——不剥就会被**记录这次改动的那段说明**绊倒
  //（同 art-archive.js 那条护栏的老教训：源码文本护栏最容易被自己的注释咬）
  const ji = stripComments(raw)
  for (const gone of [
    '还没见过——在游戏里打开她的图鉴页/编成页看一眼就会收进档案',
    '本机遭遇志里还没见过它',
    '在游戏里听到时会自动收进档案',
    '你听过这一句，但当时没能留下音频',
  ]) {
    assert.equal(ji.includes(gone), false, `催促式空状态回潮了：${gone}`)
  }
  // 中性版本要在（语音侧）
  assert.match(ji, /title="档案里没有这一句"/)
  // 「已收藏」只许留给**用户自己的收藏**（★ 那个功能），不许再出现在档案语境里
  for (const line of ji.split('\n')) {
    if (!line.includes('已收藏')) continue
    assert.ok(
      /fav|收藏/.test(line) && /fav-mini|isFavorite|★/.test(line),
      `档案语境里还写着「已收藏」：${line.trim().slice(0, 80)}`,
    )
  }
})

test('那句与回退现实相悖的说明已经删掉——它写在可能刚联网取来的图上方', () => {
  const ji = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  // 立绘展示会回退到游戏自己的资源服务器（kcs-image 的 remoteUrl），
  // 所以「只搬已经在缓存里的，不会为此联网」在立绘卷里是**假话**。
  // 注意：语音/立绘的**取字节入档**那一步仍旧是缓存优先，那条说明在
  // main/archive-capture 的文件头，不在玩家界面上。
  for (const gone of ['只搬已经在缓存里的，不会为此联网', '也不从任何百科取图']) {
    assert.equal(ji.includes(gone), false, `失实说明回潮了：${gone}`)
  }
  // 画廊尾巴那句说明只说得实的事：那几张来自本机档案、只读本机文件
  assert.match(ji, /来自立绘档案，官方现在放的不是它们/)
})

test('深海侧的遭遇事实行：拔收藏格时没跟着走，措辞也不越界', () => {
  const ji = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  assert.match(ji, /const abyssEncounterFactHtml = /)
  assert.match(ji, /遭遇志：尚无交手记录/)
  assert.match(ji, /遭遇志：交手 \$\{met\} 次/)
  // ⚠️ 日期是「账本里最早的一条」，不是「你的第一次」——记账之前的不可知。
  // 首见志那个模块当初正是被这件事纠正的，别在这里把它写回「首次」。
  assert.match(ji, /最早一条 \$\{esc\(fmtDate\(since\)\)\}/)
  assert.equal(/遭遇志：.*首次/.test(ji), false, '遭遇事实行写成了「首次」，那是账本给不出的断言')
  // 它与活动限定标、百科外链一起挪进了深海立绘页的抬头事实行（三样都是事实陈述，
  // 不是收藏格），并且真的被深海立绘页用着——不用就等于删了
  assert.match(ji, /const abyssArtFactsHtml = /)
  assert.match(ji, /abyssEncounterFactHtml\(ship\.api_id\)/)
  assert.match(ji, /\$\{abyssLimitedNote\(ship\)\}/)
  assert.match(ji, /资料页：\$\{abyssWikiLink\(ship\)\}/)
  assert.match(ji, /const facts = self \? abyssArtFactsHtml\(self\) : ''/)
})

// ---- 「画在屏幕上却没点亮」不许再存在（2026-08-23 屋代那一例）----
//
// 用户报的实况：屋代的「立绘 · 中破」整张图渲染在页面正下方，它上面的格子却灰着，
// 表头写「档案留存 4」。逐项排掉之后根因**不在入档管道**：
//  · 图种闸门没误拒——`character_full_dmg` 在白名单里；
//  · 挂钩没漏——每一格都带 `data-cg-path`；
//  · 键也对齐——档案条目的 type 与格子查询的 key 是同一套；
//  · 真包为证：他机器上屋代六个图种**同一秒全部落盘**，界面却停在四格。
// 根因是**入档之后没人让界面跟上**：`noteArtArchived` 那条「不主动重渲」成文时
// 入档只发生在游戏页那一侧（玩家不在图鉴上），而「显示/播放即入档」把前提改了。

test('结构自检：能显示的图种必须都是能入档的图种——闸门误拒会先红在这里', () => {
  const image = fs.readFileSync(new URL('../src/renderer/kcs-image.ts', import.meta.url), 'utf8')

  // 展示清单里的每一种（含 _dmg 变体）都要能过入档闸门，否则就会出现
  // 「渲染成功却永远留不下」——那正是这条测试要挡的那一类
  const wanted = [...image.matchAll(/\['(\w+)', (true|false), '([^']+)'/g)].map((m) => ({
    type: m[1],
    damaged: m[2] === 'true',
  }))
  assert.ok(wanted.length >= 10, `展示清单只解析出 ${wanted.length} 条，正则跟源码脱节了`)

  // 舰娘侧那 6 种立绘级与深海侧那 4 种**必须**全部落在可入档集合里
  for (const type of [
    'full',
    'full_dmg',
    'character_full',
    'character_full_dmg',
    'album_status',
    'remodel',
  ]) {
    assert.equal(shouldArchiveArtType(612, type), true, `舰娘侧的 ${type} 过不了入档闸门`)
  }
  for (const type of ['banner', 'banner_dmg', 'full', 'full_dmg']) {
    assert.equal(shouldArchiveArtType(1597, type), true, `深海侧的 ${type} 过不了入档闸门`)
  }
  // 反过来：界面零件仍旧不许进档案（那会让档案被小图塞满）
  for (const type of ['card', 'banner', 'supply_character', 'character_up']) {
    assert.equal(shouldArchiveArtType(612, type), false, `${type} 是界面零件，不该进档案`)
  }
})

// ============================================================================
// 画廊尾接「档案旧版卡」——拔掉收藏格之后，立绘档案唯一的展示面
// ============================================================================
//
// 用户 2026-08-23 的原话：「都显示在图鉴里面，接着放到这个角色『原版所有皮肤图』的
// 下面接着展示」。判据全在 `legacyArchivedArt` 这个纯函数里，所以下面这几条是真调用
// 与数据级比对——「摆多了」「摆重了」「空档案却凭空多一格」这三类写反了都不报错。

const artEntry = (over = {}) => entry({ ...over })

test('画廊尾巴只摆非现行版本：官方现在放着的那一份不重复摆', () => {
  const current = artEntry({ pathname: PATH_FULL, sha1: 'c'.repeat(16), version: '109' })
  const old = artEntry({
    pathname: '/kcs2/resources/ship/full/0961_7777_aaaaaaaaaaaa.png',
    sha1: 'a'.repeat(16),
    version: '108',
  })
  const tail = legacyArchivedArt([current, old], [PATH_FULL])
  assert.deepEqual(tail.map((row) => row.sha1), ['a'.repeat(16)])
  // 画廊里那一条路径没摆出来时（本机缓存与远端都取不到），档案那一份就该顶上
  assert.deepEqual(
    legacyArchivedArt([current, old], []).map((row) => row.sha1),
    ['a'.repeat(16), 'c'.repeat(16)],
  )
})

test('同一份字节绝不摆两次：换了路径也认得出，档案里的重复条目也只长一格', () => {
  const shown = artEntry({ pathname: PATH_FULL, sha1: 'd'.repeat(16) })
  // 同样的字节早年在另一条路径下也存过一次——只按路径判就会在一页上出现两次
  const twin = artEntry({
    pathname: '/kcs2/resources/ship/full/0961_5555_bbbbbbbbbbbb.png',
    sha1: 'd'.repeat(16),
  })
  assert.deepEqual(legacyArchivedArt([shown, twin], [PATH_FULL]), [])
  // 档案里同一指纹重复出现（不同图种目录下的同一张）也只摆一格
  const dup = artEntry({ type: 'full_dmg', sha1: 'e'.repeat(16) })
  assert.deepEqual(
    legacyArchivedArt([dup, { ...dup }], []).map((row) => row.sha1),
    ['e'.repeat(16)],
  )
})

test('没有旧版就一格都不多：空档案与只有现行那份，画廊都原样不变', () => {
  assert.deepEqual(legacyArchivedArt([], [PATH_FULL]), [])
  assert.deepEqual(legacyArchivedArt([artEntry()], [PATH_FULL]), [])
  // 「见过但没留下实物」的占位长不出卡片（它没有字节，摆出来就是破图）
  assert.deepEqual(legacyArchivedArt([artEntry({ sha1: '', bytes: 0 })], []), [])
  assert.deepEqual(legacyArchivedArt([artEntry({ sha1: 'f'.repeat(16), bytes: 0 })], []), [])
})

test('同一图种的多份旧版按留存时间从早到晚排，图种之间归堆', () => {
  const make = (type, sha1, firstSeen) =>
    artEntry({
      type,
      sha1: `${sha1}`.repeat(16),
      firstSeen,
      pathname: `/kcs2/resources/ship/${type}/0961_${firstSeen}_aaaaaaaaaaaa.png`,
    })
  const rows = legacyArchivedArt(
    [make('full', 3, 3_000), make('album_status', 9, 500), make('full', 1, 1_000)],
    [],
  )
  assert.deepEqual(
    rows.map((row) => [row.type, row.firstSeen]),
    [
      ['album_status', 500],
      ['full', 1_000],
      ['full', 3_000],
    ],
  )
})

test('深海同款：远古活动怪留过档就永远看得到（横幅也长卡片）', () => {
  const banner = artEntry({
    mstId: 1597,
    type: 'banner',
    pathname: '/kcs2/resources/ship/banner/1597_1111_cccccccccccc.png',
    sha1: 'b'.repeat(16),
  })
  assert.deepEqual(legacyArchivedArt([banner], []).map((row) => row.type), ['banner'])
  // 深海那几种也确实收得进档案，否则这条展示面永远等不到东西
  for (const type of ['banner', 'banner_dmg']) {
    assert.equal(shouldArchiveArtType(1597, type), true)
  }
})

test('画廊尾巴零网络：卡片只用档案那一份的 file:// 地址，也不带入档身份', () => {
  const raw = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  const ji = stripComments(raw)
  const at = ji.indexOf('const archivedArtCellsHtml')
  assert.ok(at > 0, '找不到画廊尾巴那段')
  const section = ji.slice(at, ji.indexOf('const cgPanelHtml = '))
  assert.match(section, /legacyArchivedArt\(archivedArtEntriesOfShip\(mstId\), displayed\)/)
  assert.match(section, /archivedArtUrl\(entry\)/)
  // 一处远端地址都不许算：`archivedArtUrl` 给的是 file://，这一段不该碰游戏服务器
  assert.equal(/shipImageUrl\(|remoteUrl\(|https?:\/\//.test(section), false, '档案卡走了网络地址')
  // 也不带 `data-cg-path`：那是「显示即入档」的身份，档案里这一份已经在档案里了
  assert.equal(/data-cg-path/.test(section), false, '档案卡带了入档身份，会拿 file:// 再入一次档')
  // 说明只陈述事实：图种 + 留存月份 +（有就写）版本号，不主张任何季节归属
  assert.match(section, /档案 \$\{kept\} 留存/)
  assert.equal(/季节版|当季|圣诞|盛夏/.test(section), false, '档案卡主张了推不出来的季节归属')
  // 两侧都真的接上了（接不上就等于这个函数白写）
  assert.match(ji, /archivedArtCellsHtml\(mstId, imgs\.map\(\(im\) => im\.pathname\)\)/)
  assert.match(ji, /archivedArtCellsHtml\(mstId, images\.map\(\(image\) => image\.pathname\)\)/)
  assert.match(ji, /<div class="cg-grid" data-cg-grid>\$\{cells\}\$\{archived\}<\/div>/)
  assert.match(ji, /<div class="cg-grid abyss-cg-grid" data-cg-grid>\$\{cells\}\$\{archived\}<\/div>/)
})

test('入档之后界面要跟上：新并进来的那一条会广播，正看着的那一页当场重画', () => {
  const art = fs.readFileSync(new URL('../src/renderer/art-archive.ts', import.meta.url), 'utf8')
  const voice = fs.readFileSync(new URL('../src/renderer/voice-archive.ts', import.meta.url), 'utf8')
  const index = fs.readFileSync(new URL('../src/renderer/index.ts', import.meta.url), 'utf8')
  const ji = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')

  // ① 并进索引的那两个函数要**如实说一声**（重复广播返回 false，别拿它触发重渲）
  assert.match(art, /export const noteArtArchived = \(entry: ArtArchiveEntry\): boolean =>/)
  assert.match(voice, /export const noteVoiceArchived = \(entry: VoiceArchiveEntry\): boolean =>/)
  // ② 装配层据此广播（用 DOM 事件，它不该知道哪个模块开着哪一页）
  assert.match(index, /if \(noteArtArchived\(entry\)\) notifyArchiveLit\('art', entry\.mstId\)/)
  assert.match(index, /if \(noteVoiceArchived\(entry\)\) notifyArchiveLit\('voice', entry\.mstId\)/)
  assert.match(index, /new CustomEvent\('kanso:archive-lit'/)
  // ③ 图鉴听它，并且**只在看着那一页时**重画（两道性能闸门由 scheduleRender 自己管）
  assert.match(ji, /document\.addEventListener\('kanso:archive-lit', onArchiveLit\)/)
  assert.match(ji, /if \(mstId && mstId !== showing\) return/)
  assert.match(ji, /scheduleRender\(\)/)
  // 订阅要退订：图鉴会被重复装配，漏退就是双重订阅
  assert.match(ji, /trackMountCleanup\(\(\) => document\.removeEventListener\('kanso:archive-lit', onArchiveLit\)\)/)
  // ④ 那条已经作废的注释不许原样留着骗下一个人
  const stripped = stripComments(art)
  assert.equal(stripped.includes('这里不主动重渲'), false)
  assert.ok(
    art.includes('显示即入档') || art.includes('显示/播放即入档'),
    'art-archive 没说明「不主动重渲」那条为什么作废了一半',
  )
})
