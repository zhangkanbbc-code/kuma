// 钥 · 「游戏音频链路自检」那张卡。**维护者工具**，只在 `KANSO_DEBUG_UI=1` 下装配。
//
// 它是 2026-08-26 那个 bug 留下的常备工具：语音滑条不起作用时，坏的地方可能在
// 三环里的任意一环——钩子没装进那个帧、资源地址没被记下、记下了但分类认错。
// 光听「响不响」这三种分不开，所以把三环各自的计数摊开。
//
// 这里对着**渲染产物**下断言：把钥连桩编出来跑 mount，桩一个游戏页进去，
// 点「读一次」，看它把读回来的数字摆成了什么。只断言源码文本抓不到模板写错。
import assert from 'node:assert/strict'
import test from 'node:test'

import { cardHtml, mountYu } from './fixtures/render-yu.mjs'

const CARD = 'game-audio-selftest'

/** 桩一个游戏页：`#game-wrapper webview` 上的 executeJavaScript 回给定的快照 */
const withGamePage = async (answer, body) => {
  const previousDocument = globalThis.document
  const calls = []
  globalThis.document = {
    querySelector: (selector) => {
      if (selector !== '#game-wrapper webview') return null
      if (answer === 'absent') return null
      return {
        executeJavaScript: (code) => {
          calls.push(code)
          return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer)
        },
      }
    },
  }
  try {
    return await body(calls)
  } finally {
    if (previousDocument === undefined) delete globalThis.document
    else globalThis.document = previousDocument
  }
}

const mountDebug = () => mountYu({ ui: { 'yu.section': 'ui' }, lodes: [], debugUi: true })

/** 点一下「读一次」，等异步链落地 */
const readOnce = async (yu) => {
  yu.click({ act: 'audio-selftest-refresh' })
  await new Promise((resolve) => setTimeout(resolve, 0))
  return cardHtml(yu.pane.innerHTML, CARD)
}

const FRAME = {
  frame: '/kcs2/index.php',
  captures: { xhr: 42, fetch: 0, blob: 0, fileReader: 0, objectUrl: 0 },
  sources: { voice: 2, bgm: 0, other: 5 },
  media: { voice: 0, bgm: 1, other: 0 },
  decodes: [
    { path: '/kcs2/resources/se/241.mp3', category: 'other' },
    { path: '/kcs/sound/kcikwmknqjpvkg/167370.mp3', category: 'voice' },
  ],
  // 快照里还有一份语音时长（字幕层用，这张卡不展示）——摆上是为了让这份桩
  // 和真快照同形，别让下一个人以为卡上没显示就等于快照里没有
  voiceDurations: [{ path: '/kcs/sound/kcikwmknqjpvkg/167370.mp3', ms: 18_400 }],
}

test('自检卡：没读过时不装作已经读过', () => {
  const html = cardHtml(mountDebug().pane.innerHTML, CARD)
  assert.match(html, /暂无读取记录/)
  assert.match(html, /读一次/)
  // 一个数字都不许有：没读过就是没读过，摆 0 会被当成「读到了，全是 0」
  assert.doesNotMatch(html, /XHR \d/)
})

test('自检卡：读回来之后按帧摆出捕获计数、活源数与最近解码', async () => {
  await withGamePage([FRAME], async (calls) => {
    const yu = mountDebug()
    const html = await readOnce(yu)
    // 走的是和截图同一条路：webview.executeJavaScript，只取一个统计对象
    assert.equal(calls.length, 1)
    assert.match(calls[0], /kansoGameAudioStats/)

    assert.match(html, /\/kcs2\/index\.php/, '没写清是哪个帧')
    assert.match(html, /XHR 42/, 'XHR 那条捕获路的计数没摆出来')
    assert.match(html, /FileReader 0/, '捕获路要五条都在，缺哪条一眼看得见')
    assert.match(html, /objectURL 0/)
    assert.match(html, /语音 2 · BGM 0 · 其他 5/, '活着的 WebAudio 源没按分类摆')
    assert.match(html, /语音 0 · BGM 1 · 其他 0/, '活着的音频元素没按分类摆')
    // 最近解码逐条可见，新的在前
    assert.match(html, /kcikwmknqjpvkg\/167370\.mp3/)
    assert.ok(
      html.indexOf('167370') < html.indexOf('241.mp3'),
      '最近解的应该排在前面',
    )
    // 认出语音就报「通」——这正是那三条滑条要的结论
    assert.match(html, /语音识别正常/)
  })
})

test('自检卡：解过音频却一条语音都没认出来时，明说这一路不通', async () => {
  const mute = { ...FRAME, decodes: [{ path: '/kcs2/resources/se/241.mp3', category: 'other' }] }
  await withGamePage([mute], async () => {
    const html = await readOnce(mountDebug())
    assert.match(html, /语音识别失败 · 播放一句台词后重读/)
    assert.doesNotMatch(html, /语音识别正常/)
  })
})

test('自检卡：一条都没解过时不下结论，只说该去做什么', async () => {
  await withGamePage([{ ...FRAME, decodes: [] }], async () => {
    const html = await readOnce(mountDebug())
    assert.match(html, /暂无音频解码记录/)
    // 既不报通也不报坏——没有证据就不下判断
    assert.doesNotMatch(html, /语音认得出来/)
    assert.doesNotMatch(html, /语音识别失败/)
  })
})

test('自检卡：一个帧都没装上钩子是真坏了，要当场说破', async () => {
  await withGamePage([], async () => {
    const html = await readOnce(mountDebug())
    assert.match(html, /音频钩子未安装到任何帧/)
    assert.match(html, /三条滑条暂不可用/)
  })
})

test('自检卡：游戏页还没挂上时说清是这个原因，不报成读取失败', async () => {
  await withGamePage('absent', async () => {
    const html = await readOnce(mountDebug())
    assert.match(html, /游戏页面尚未加载 · 加载后重试/)
  })
})

test('自检卡：读取抛错就把原话摆出来，不吞掉', async () => {
  await withGamePage(new Error('Script failed to execute'), async () => {
    const html = await readOnce(mountDebug())
    assert.match(html, /读取失败 · 请重试/)
    assert.match(html, /Script failed to execute/)
  })
})

test('自检卡：多个帧各报各的，不合并成一份', async () => {
  const child = {
    ...FRAME,
    frame: '/kcs2/gadget.php',
    captures: { xhr: 7, fetch: 1, blob: 0, fileReader: 0, objectUrl: 0 },
    decodes: [],
  }
  await withGamePage([FRAME, child], async () => {
    const html = await readOnce(mountDebug())
    assert.match(html, /已安装钩子的帧：2 个/)
    assert.match(html, /\/kcs2\/gadget\.php/)
    assert.match(html, /XHR 42/)
    assert.match(html, /XHR 7/)
  })
})
