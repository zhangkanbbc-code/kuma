// 试听播放器三件套的护栏：断点续播、两个播放器互斥、试听时压住游戏声音。
//
// 判断写反了源码文本照样匹配得上，所以这里除了纯函数那一节，其余都对着
// **真跑一遍的 bgm-preview + preview-audio** 下断言（见 fixtures/preview-bgm-dom.mjs）。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import previewAudioModule from '../dist/shared/preview-audio.js'
import duckModule from '../assets/preload/preview-duck.js'
import { mountBgmPreview, tick } from './fixtures/preview-bgm-dom.mjs'

const { previewClickAction } = previewAudioModule
const { PREVIEW_DUCK_CHANNEL, duckedVolume, installPreviewDuck } = duckModule

const SONG = 'https://example.invalid/bgm/port/101.mp3'
const OTHER = 'https://example.invalid/bgm/port/102.mp3'

// ---------------------------------------------------------------- 判据（纯函数）

test('点击循环：播放 → 暂停 → 从暂停处接着放', () => {
  // 还没有 Audio、或换了一条：都得重设 src 从头播
  assert.equal(previewClickAction(null, SONG), 'restart')
  assert.equal(previewClickAction({ src: OTHER, paused: false, ended: false }, SONG), 'restart')
  assert.equal(previewClickAction({ src: OTHER, paused: true, ended: false }, SONG), 'restart')
  // 同一条正在响：按停
  assert.equal(previewClickAction({ src: SONG, paused: false, ended: false }, SONG), 'pause')
  // 同一条停在半路：接着放。**这一档不许重设 src**，重设就归零了
  assert.equal(previewClickAction({ src: SONG, paused: true, ended: false }, SONG), 'resume')
})

test('播完之后 src 还挂着同一首，但那不是「暂停中」——再点从头播', () => {
  // ended 的 Audio 同样是 paused=true。只看 paused 会把它误当续播，
  // 表现就是「听完再点，一声不出」（play() 在末尾原地兑现）。
  assert.equal(previewClickAction({ src: SONG, paused: true, ended: true }, SONG), 'restart')
})

// ---------------------------------------------------------------- A. 断点续播

test('同一枚词条点三下：播放、暂停、续播（第三下不重设 src）', async () => {
  const ui = mountBgmPreview()
  const el = ui.entry(SONG)

  ui.click(el)
  await tick()
  assert.equal(ui.audio().playCalls, 1)
  assert.deepEqual(ui.audio().srcWrites, [SONG])
  assert.deepEqual(ui.marks(el), ['playing'])

  ui.click(el)
  await tick()
  assert.equal(ui.audio().paused, true)
  assert.deepEqual(ui.marks(el), ['paused'], '停在半路的词条要看得出来')

  ui.click(el)
  await tick()
  assert.equal(ui.audio().playCalls, 2)
  assert.deepEqual(
    ui.audio().srcWrites,
    [SONG],
    '续播重设了 src——进度归零，等于没续上',
  )
  assert.deepEqual(ui.marks(el), ['playing'])
})

test('播完之后再点是从头播，词条上的记号先清干净', async () => {
  const ui = mountBgmPreview()
  const el = ui.entry(SONG)

  ui.click(el)
  await tick()
  ui.audio().finish()
  assert.deepEqual(ui.marks(el), [], '播完了就不该还挂着「在响」')

  ui.click(el)
  await tick()
  assert.deepEqual(ui.audio().srcWrites, [SONG, SONG], '播完再点没有重设 src')
  assert.deepEqual(ui.marks(el), ['playing'])
})

test('换一条曲：重设 src，旧词条的记号跟着摘掉', async () => {
  const ui = mountBgmPreview()
  const first = ui.entry(SONG)
  const second = ui.entry(OTHER)

  ui.click(first)
  await tick()
  ui.click(second)
  await tick()

  assert.deepEqual(ui.audio().srcWrites, [SONG, OTHER])
  assert.deepEqual(ui.marks(first), [], '同时只有一枚词条带记号')
  assert.deepEqual(ui.marks(second), ['playing'])
})

test('暂停之后换别的曲，再回来是从头播（那一条的进度已经作废）', async () => {
  const ui = mountBgmPreview()
  const first = ui.entry(SONG)
  const second = ui.entry(OTHER)

  ui.click(first)
  await tick()
  ui.click(first) // 暂停
  await tick()
  ui.click(second)
  await tick()
  ui.click(first)
  await tick()

  assert.deepEqual(ui.audio().srcWrites, [SONG, OTHER, SONG])
})

// ---------------------------------------------------------------- B. 两个播放器互斥

test('语音试听开口时把 BGM 按停：只暂停，不归零', async () => {
  const ui = mountBgmPreview()
  const el = ui.entry(SONG)
  const voicePauses = []
  ui.api.registerPreviewPlayer('voice', {
    pause: () => voicePauses.push('paused'),
    resume: () => voicePauses.push('resumed'),
    audio: () => null,
  })

  ui.click(el)
  await tick()
  assert.deepEqual(voicePauses, ['paused'], 'BGM 开口时该把语音那边按停')

  // 换语音那边开口
  ui.api.claimPreviewPlayback('voice')
  assert.equal(ui.audio().paused, true, 'BGM 没被按停，两边就叠音了')
  assert.deepEqual(ui.marks(el), ['paused'])

  // 语音停了，回头点 BGM——接着放，不是从头
  ui.api.notePreviewStopped('voice')
  ui.click(el)
  await tick()
  assert.deepEqual(ui.audio().srcWrites, [SONG], '被按停的那一条回来要能续上')
  assert.deepEqual(ui.marks(el), ['playing'])
})

// ---------------------------------------------------------------- C. 上报合并

test('「有没有在响」合并后只在变化时发，一个值不发两遍', async () => {
  const ui = mountBgmPreview()
  const first = ui.entry(SONG)
  const second = ui.entry(OTHER)

  assert.deepEqual(ui.activeSends(), [], '什么都没播之前不该发')

  ui.click(first)
  await tick()
  ui.click(second) // 换曲：一直在响，不该再发一次 true
  await tick()
  assert.deepEqual(ui.activeSends(), [true])

  ui.click(second) // 暂停：不响了
  await tick()
  assert.deepEqual(ui.activeSends(), [true, false])

  ui.click(second) // 续播
  await tick()
  assert.deepEqual(ui.activeSends(), [true, false, true])
})

test('接力时不抖动：BGM 被语音顶掉的那一下不该冒出一声 false', async () => {
  const ui = mountBgmPreview()
  const el = ui.entry(SONG)

  ui.click(el)
  await tick()
  ui.api.claimPreviewPlayback('voice')
  // BGM 被按停 → 语音接上，中间一刻也没静下来。若照发就是 false→true 两声抖动，
  // 游戏那边跟着一压一放。
  assert.deepEqual(ui.activeSends(), [true])

  ui.api.notePreviewStopped('voice')
  assert.deepEqual(ui.activeSends(), [true, false])
})

test('播不出来时要把游戏声音放回去', async () => {
  const ui = mountBgmPreview()
  const el = ui.entry(SONG)

  ui.click(el)
  await tick()
  ui.click(el) // 暂停
  await tick()

  ui.audio().failNext = true
  // 播放失败本来就该 console.warn 一声（真机上那是唯一线索），这里只是别把它印进测试输出
  const warn = console.warn
  console.warn = () => {}
  try {
    ui.click(el)
    await tick()
  } finally {
    console.warn = warn
  }
  assert.deepEqual(
    ui.activeSends(),
    [true, false, true, false],
    '播放失败没上报回来，游戏就一直哑着',
  )
  assert.deepEqual(ui.marks(el), [], '没播成的词条不该留着记号')
})

test('播完之后也要把游戏声音放回去', async () => {
  const ui = mountBgmPreview()
  const el = ui.entry(SONG)

  ui.click(el)
  await tick()
  ui.audio().finish()
  assert.deepEqual(ui.activeSends(), [true, false])
})

// ---------------------------------------------------------------- D. 悬浮迷你播放条
//
// 条子只认总机，不认识任何一个播放器。所以这一节全都从**它自己写进节点的东西**上读
// （`.show`、钮上的字、滑条的 value/max/disabled、时间格），不去问模块内部状态。

test('条子的显隐时机：没试听时不出，占用了才现身，名字是曲名', async () => {
  const ui = mountBgmPreview()
  assert.equal(ui.bar().shown, false, '什么都没播就摆一条空条子')

  ui.click(ui.entry(SONG, '曲101'))
  await tick()
  const bar = ui.bar()
  assert.equal(bar.shown, true)
  assert.equal(bar.name, '曲101', '条子该说清此刻在听什么')
  assert.equal(bar.toggle, '⏸', '在响的时候钮上该是「按停」')
  assert.equal(bar.toggleLabel, '暂停')
  assert.equal(bar.bodyLifted, true, '右下角还站着 Toast 堆，得让开')
})

test('播完 / 半路出错：条子消失，进度清零', async () => {
  const ui = mountBgmPreview()
  ui.click(ui.entry(SONG, '曲101'))
  await tick()
  ui.audio().loadMetadata(180)
  ui.audio().advance(90)
  assert.equal(ui.bar().seekValue, '90')

  ui.audio().finish()
  assert.equal(ui.bar().shown, false, '播完了条子还挂着')
  assert.equal(ui.bar().seekValue, '0', '进度没清零，下一条会先闪一下上一条的位置')
  assert.equal(ui.bar().bodyLifted, false)

  // 半路断流（play() 早兑现过，只来一枚 error）也是「试听没了」
  ui.click(ui.entry(OTHER, '曲102'))
  await tick()
  assert.equal(ui.bar().shown, true)
  ui.audio().fail()
  assert.equal(ui.bar().shown, false, '断流之后条子还挂着一条放不动的曲子')
  assert.deepEqual(
    ui.activeSends(),
    [true, false, true, false],
    '断流没上报回来，游戏就一直哑着',
  )
})

test('从条子上暂停：试听还在（条子留着），但游戏声音要放回去', async () => {
  const ui = mountBgmPreview()
  const el = ui.entry(SONG, '曲101')
  ui.click(el)
  await tick()

  ui.clickToggle()
  await tick()
  assert.equal(ui.bar().shown, true, '暂停不是停止：进度还在，条子该继续摆着')
  assert.equal(ui.bar().toggle, '▶')
  assert.equal(ui.bar().toggleLabel, '继续播放')
  assert.deepEqual(ui.marks(el), ['paused'], '词条上的记号也要跟着翻面')
  assert.deepEqual(ui.activeSends(), [true, false], '从条子上暂停，游戏声音没放回来')

  ui.clickToggle()
  await tick()
  assert.deepEqual(ui.audio().srcWrites, [SONG], '从条子上续播重设了 src——进度归零，等于没续上')
  assert.deepEqual(ui.activeSends(), [true, false, true])
  assert.deepEqual(ui.marks(el), ['playing'])
})

test('拖动期间 timeupdate 顶不跑滑块，松手那一下才真跳', async () => {
  const ui = mountBgmPreview()
  ui.click(ui.entry(SONG, '曲101'))
  await tick()
  ui.audio().loadMetadata(200)
  ui.audio().advance(10)

  ui.dragTo(150)
  ui.audio().advance(11) // 手还按着，声音仍在往前走
  ui.audio().advance(12)
  assert.equal(ui.bar().seekValue, '150', '拖动被 timeupdate 顶回去了——滑块拖不动')
  assert.equal(ui.bar().time, '2:30 / 3:20', '拖动期间时间要跟着手走，不是跟着声音走')
  assert.equal(ui.audio().currentTime, 12, '还没松手就跳了')

  ui.drop()
  assert.equal(ui.audio().currentTime, 150, '松手了却没跳')
  // 松手之后重新听声音的
  ui.audio().advance(151)
  assert.equal(ui.bar().seekValue, '151')
  assert.equal(ui.bar().time, '2:31 / 3:20')
})

test('拖到出界不许写出界的值', async () => {
  const ui = mountBgmPreview()
  ui.click(ui.entry(SONG, '曲101'))
  await tick()
  ui.audio().loadMetadata(60)

  ui.dragTo(999)
  ui.drop()
  assert.equal(ui.audio().currentTime, 60)
  ui.dragTo(-5)
  ui.drop()
  assert.equal(ui.audio().currentTime, 0)
})

test('时长不可用时滑条禁用、只显时间；元数据到手才放行', async () => {
  const ui = mountBgmPreview()
  ui.click(ui.entry(SONG, '曲101'))
  await tick()
  // 远端 mp3 拿到元数据之前 duration 就是 NaN
  assert.equal(ui.bar().seekDisabled, true, '拖了没反应的滑条比没有滑条更糟')
  assert.equal(ui.bar().time, '0:00 / --:--', '时长不知道就别编一个出来')

  ui.audio().loadMetadata(215)
  assert.equal(ui.bar().seekDisabled, false)
  assert.equal(ui.bar().seekMax, '215')
  assert.equal(ui.bar().time, '0:00 / 3:35')

  // 没有终点的流（Infinity）同样拖不动
  ui.audio().loadMetadata(Number.POSITIVE_INFINITY)
  assert.equal(ui.bar().seekDisabled, true)
  assert.equal(ui.bar().time, '0:00 / --:--')
})

test('禁用期间拖不动：没有时长就不许写 currentTime', async () => {
  const ui = mountBgmPreview()
  ui.click(ui.entry(SONG, '曲101'))
  await tick()
  ui.dragTo(30)
  ui.drop()
  assert.equal(ui.audio().currentTime, 0, '时长都不知道，跳到 30 秒是凭空编的')
})

test('换一条曲：条子换名字，不重建节点', async () => {
  const ui = mountBgmPreview()
  ui.click(ui.entry(SONG, '曲101'))
  await tick()
  const host = ui.barHost()

  ui.click(ui.entry(OTHER, '曲102'))
  await tick()
  assert.equal(ui.bar().name, '曲102')
  assert.equal(ui.barHost(), host, '条子被重建了')
  assert.equal(ui.barNodeCount(), 1)
})

test('条子是常驻节点：模块整块重渲把词条冲掉，声音照样续得上', async () => {
  const ui = mountBgmPreview()
  const el = ui.entry(SONG, '曲101')
  ui.click(el)
  await tick()
  ui.audio().loadMetadata(120)
  ui.audio().advance(40)
  const host = ui.barHost()

  ui.clickToggle() // 暂停
  await tick()
  // 面板被动重渲：整块重画，那枚 ♪ 词条连同「停在半路」的记号一起没了
  ui.wipeEntries()

  ui.clickToggle() // 从条子上续播
  await tick()
  assert.equal(ui.barHost(), host, '条子跟着模块一起被重建了')
  assert.equal(ui.barNodeCount(), 1)
  assert.deepEqual(ui.audio().srcWrites, [SONG], '词条没了就重设 src——翻一页进度就没了')
  assert.equal(ui.audio().currentTime, 40, '续播把进度归零了')
  assert.deepEqual(ui.activeSends(), [true, false, true])
  assert.equal(ui.bar().toggle, '⏸')
})

test('语音那边开口时条子跟着换人：它只认总机，不认识任何一个播放器', async () => {
  const ui = mountBgmPreview()
  ui.click(ui.entry(SONG, '曲101'))
  await tick()
  ui.api.registerPreviewPlayer('voice', {
    pause: () => {},
    resume: () => {},
    audio: () => null,
  })

  ui.api.claimPreviewPlayback('voice', '雪風 · 母港')
  const bar = ui.bar()
  assert.equal(bar.shown, true)
  assert.equal(bar.name, '雪風 · 母港')
  assert.equal(bar.toggle, '⏸')
  // 语音那边还没造出 Audio 实例（真机上「取到了才 new」），条子不许因此炸掉
  assert.equal(bar.seekDisabled, true)
  assert.equal(bar.time, '0:00 / --:--')

  ui.api.notePreviewStopped('voice', 'ended')
  assert.equal(ui.bar().shown, false)
})

// ------------------------------------------------------- B'. 迷你条挪窝（可拖拽）
//
// 判断同样全是分支：「按的是控件还是空白」「夹不夹得回视口」「藏起来这段时间视口变了没」。
// 写反了源码文本照样匹配得上，所以这一节也对着真跑起来的 preview-bar 下断言——
// 读的是它自己写进行内样式的那四个键。
//
// 视口 1280×800（假 window 的默认值），条子摆成 180×30、留边 8：
// 落点因此夹在 x∈[8, 1092]、y∈[8, 762]。

/** 播上一首、把条子的量测尺寸摆好。落点是行内样式，与这里摆的 rect 互不相干。 */
const mountBarPlaced = async () => {
  const ui = mountBgmPreview()
  ui.click(ui.entry(SONG, '曲101'))
  await tick()
  ui.layoutBar({ left: 1090, top: 758, width: 180, height: 30 })
  return ui
}

test('按住空白处把条子拖走：写 left/top，右下角那两个锚点让开', async () => {
  const ui = await mountBarPlaced()
  assert.deepEqual(ui.barStyle(), {}, '没拖过就不该有行内落点，默认位归样式表管')

  // 按在条子内 (10, 2) 处
  ui.pressBar(1100, 760)
  assert.deepEqual(ui.barCaptured(), [7], '没捏住指针：手一快滑出条子，拖拽就断在半路')
  assert.equal(ui.barDragging(), false, '按下不动就铺挡板，纯点击会被它吃掉')

  ui.moveBar(400, 300)
  assert.deepEqual(
    ui.barStyle(),
    { left: '390px', top: '298px', right: 'auto', bottom: 'auto' },
    'right/bottom 不撤成 auto，行内 left/top 与样式表的锚点会打架',
  )
  assert.equal(ui.barDragging(), true, '真动了才铺挡板——不铺就会被游戏区吃掉 pointermove')

  ui.dropBar()
  assert.deepEqual(ui.barCaptured(), [], '松手了还攥着指针，条子就粘在手上')
  assert.equal(ui.barDragging(), false, '挡板没撤，整块屏幕从此点不动')
  assert.deepEqual(ui.barStyle(), { left: '390px', top: '298px', right: 'auto', bottom: 'auto' })
})

test('拖拽期间声音一声不断：条子只写自己的坐标，碰都不碰 Audio', async () => {
  const ui = await mountBarPlaced()
  ui.audio().loadMetadata(200)
  ui.audio().advance(30)

  ui.pressBar(1100, 760)
  ui.moveBar(700, 500)
  ui.audio().advance(31) // 手还按着，声音照走
  ui.moveBar(400, 300)
  ui.audio().advance(32)
  ui.dropBar()

  assert.equal(ui.audio().paused, false, '拖一下把曲子拖停了')
  assert.equal(ui.audio().playCalls, 1, '拖拽期间重放了一次——那是从头开始')
  assert.deepEqual(ui.audio().srcWrites, [SONG], '拖拽期间重设了 src，进度会归零')
  assert.equal(ui.audio().currentTime, 32, '进度断了')
  assert.equal(ui.bar().time, '0:32 / 3:20', '拖完之后时间格没跟上')
  assert.deepEqual(ui.activeSends(), [true], '拖拽期间往主进程多报了一次「不响了」')
})

test('拖出视口一律夹回来：四个方向都留得住', async () => {
  const ui = await mountBarPlaced()
  ui.pressBar(1100, 760) // 按在条子内 (10, 2)

  ui.moveBar(-5000, -5000)
  assert.deepEqual(
    ui.barStyle(),
    { left: '8px', top: '8px', right: 'auto', bottom: 'auto' },
    '往左上拖过头，条子跑出屏外就再也捏不回来了',
  )

  ui.moveBar(9999, 9999)
  assert.deepEqual(
    ui.barStyle(),
    { left: '1092px', top: '762px', right: 'auto', bottom: 'auto' },
    '往右下拖过头没夹住',
  )
  ui.dropBar()
})

test('按在播放/暂停钮与滑条上不算拖：控件照常管自己的事', async () => {
  const ui = await mountBarPlaced()

  ui.pressBar(1100, 760, 'toggle')
  ui.moveBar(400, 300)
  assert.deepEqual(ui.barStyle(), {}, '按在播放钮上却把整条拖走了——那一下点不成暂停')
  assert.deepEqual(ui.barCaptured(), [], '钮上的按下不该捏走指针')
  assert.equal(ui.barDragging(), false)

  ui.pressBar(1100, 760, 'seek')
  ui.moveBar(400, 300)
  assert.deepEqual(ui.barStyle(), {}, '按在滑条上却把整条拖走了——刻度就拖不动了')
  assert.deepEqual(ui.barCaptured(), [])

  // 钮本身仍旧管用
  ui.clickToggle()
  await tick()
  assert.equal(ui.bar().toggle, '▶')
  assert.equal(ui.audio().paused, true, '让开拖拽之后钮反而点不动了')
})

test('指针被系统收走（切窗口、手势接管）：与松手同样收摊', async () => {
  const ui = await mountBarPlaced()
  ui.pressBar(1100, 760)
  ui.moveBar(400, 300)
  ui.cancelBar()
  assert.deepEqual(ui.barCaptured(), [], '指针被收走了还攥着不放')
  assert.equal(ui.barDragging(), false, '挡板留在那儿，整块屏幕点不动')
})

test('拖走之后 Toast 不再让位；条子退场再回来还在拖走的地方', async () => {
  const ui = await mountBarPlaced()
  assert.equal(ui.bar().bodyLifted, true, '默认位就在右下角，Toast 该让')

  ui.pressBar(1100, 760)
  ui.moveBar(400, 300)
  ui.dropBar()
  assert.equal(ui.bar().bodyLifted, false, '条子已经不在右下角了，Toast 还空着那一块')

  // 这一首播完：条子退场，但落点**不清**——同一次运行里下一首还该在那儿
  ui.audio().finish()
  assert.equal(ui.bar().shown, false)
  ui.click(ui.entry(OTHER, '曲102'))
  await tick()
  assert.equal(ui.bar().shown, true)
  assert.deepEqual(
    ui.barStyle(),
    { left: '390px', top: '298px', right: 'auto', bottom: 'auto' },
    '换一首就弹回右下角，等于每首都要重拖一次',
  )
  assert.equal(ui.bar().bodyLifted, false)
})

test('窗口变小 / 换一块屏：落点重新夹回视口内', async () => {
  const ui = await mountBarPlaced()
  ui.pressBar(1100, 760)
  ui.moveBar(9999, 9999) // 贴到右下角能到的极限
  ui.dropBar()
  assert.deepEqual(ui.barStyle(), { left: '1092px', top: '762px', right: 'auto', bottom: 'auto' })

  ui.resizeViewport(900, 500)
  assert.deepEqual(
    ui.barStyle(),
    { left: '712px', top: '462px', right: 'auto', bottom: 'auto' },
    '窗口缩小之后落点没重夹，条子半截在屏外',
  )
})

test('视口小到装不下条子：整个撤回默认位，别留一枚拖不回来的', async () => {
  const ui = await mountBarPlaced()
  ui.pressBar(1100, 760)
  ui.moveBar(400, 300)
  ui.dropBar()

  ui.resizeViewport(120, 60) // 比 180×30 的条子还窄
  assert.deepEqual(
    ui.barStyle(),
    { left: '', top: '', right: '', bottom: '' },
    '夹不下去就该把四个键一起清掉，把位置交还给样式表',
  )
  assert.equal(ui.bar().bodyLifted, true, '回到默认位了，Toast 该重新让位')
})

// ---------------------------------------------------------------- C. 游戏页那一端

test('游戏页的试听系数：只有明确说「在试听」才压，其余一律恢复', () => {
  const listeners = new Map()
  const ipc = {
    on: (channel, handler) => listeners.set(channel, handler),
  }
  const factor = installPreviewDuck(ipc)
  assert.equal(factor(), 1, '没人说话的时候不该压')

  const fire = (value) => listeners.get(PREVIEW_DUCK_CHANNEL)({}, value)
  fire(true)
  assert.equal(factor(), 0)
  fire(false)
  assert.equal(factor(), 1)
  // 收到看不懂的东西按「不压」算：卡住不恢复比慢半拍恢复难受得多
  fire(true)
  fire('true')
  assert.equal(factor(), 1)
  fire(true)
  fire(undefined)
  assert.equal(factor(), 1)
})

test('总音量乘上试听系数，仍旧钳在 [0, 1]', () => {
  assert.equal(duckedVolume(0.8, 1), 0.8)
  assert.equal(duckedVolume(0.8, 0), 0)
  assert.equal(duckedVolume(0, 1), 0)
  // 非数一律当 1：这条路上任何 NaN 都会变成一台哑游戏
  assert.equal(duckedVolume(Number.NaN, 1), 1)
  assert.equal(duckedVolume(0.5, Number.NaN), 0.5)
  assert.equal(duckedVolume(5, 1), 1)
})

test('三段链路上的 channel 名字对得上（渲染层 → 主进程 → 游戏页）', () => {
  const renderer = fs.readFileSync(new URL('../dist/renderer/index.js', import.meta.url), 'utf8')
  const main = fs.readFileSync(new URL('../dist/main/index.js', import.meta.url), 'utf8')
  const preload = fs.readFileSync(
    new URL('../assets/preload/webview-preload.js', import.meta.url),
    'utf8',
  )

  assert.ok(renderer.includes('kanso:preview-audio-active'), '渲染层没在发这条 IPC')
  assert.ok(main.includes('kanso:preview-audio-active'), '主进程没在收这条 IPC')
  assert.ok(main.includes(PREVIEW_DUCK_CHANNEL), '主进程没往游戏页转这条 IPC')
  assert.ok(preload.includes('installPreviewDuck'), '游戏页 preload 没装上收货口')
  // 压游戏声音是**瞬态内存态**：这条路上任何一处落盘，崩溃之后都会留下一台哑游戏
  assert.ok(
    !/preview-audio-active[\s\S]{0,600}config\.set/.test(main),
    '试听压音量不许落盘',
  )
})
