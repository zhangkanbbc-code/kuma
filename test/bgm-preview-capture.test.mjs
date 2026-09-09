import assert from 'node:assert/strict'
import test from 'node:test'
import { mountBgmPreview, tick } from './fixtures/preview-bgm-dom.mjs'

test('BGM 试听：档案优先，远程开关关闭仍能播，IPC 现取为零', async () => {
  const ui = mountBgmPreview()
  ui.api.setRemoteArt(false)
  const url = ui.archived(153)
  const el = ui.remoteEntry(153)
  ui.click(el)
  await tick()
  assert.deepEqual(ui.audio().srcWrites, [url])
  assert.equal(ui.sends.filter(([channel]) => channel === 'kuma:archive-capture-bgm').length, 0)
})

test('BGM 试听：点一次先入档，正在取时无媒体请求，广播点亮即自动播放档案', async () => {
  const ui = mountBgmPreview()
  const el = ui.remoteEntry(153)
  assert.match(el.html, /首次试听会从游戏资源服务器取一次并留存，之后不再联网/)
  ui.click(el)
  await tick()
  assert.equal(ui.audio(), null)
  assert.match(el.html, /正在取…/)
  assert.equal(el.dataset.bgmUrl, undefined)
  assert.deepEqual(ui.sends, [['kuma:archive-capture-bgm', {
    pathname: '/kcs2/resources/bgm/battle/153_0000.mp3',
    url: 'https://example.invalid/kcs2/resources/bgm/battle/153_0000.mp3',
  }]])
  const url = ui.archived(153)
  await tick()
  assert.deepEqual(ui.audio().srcWrites, [url])
  assert.ok(ui.marks(el).includes('kept'))
  ui.click(el)
  await tick()
  ui.click(el)
  await tick()
  assert.deepEqual(ui.audio().srcWrites, [url])
  assert.equal(ui.sends.filter(([channel]) => channel === 'kuma:archive-capture-bgm').length, 1)
})

test('BGM 试听：失败结束等待并退化成说明文字，点击不再发请求', async () => {
  const ui = mountBgmPreview()
  const el = ui.remoteEntry(153)
  ui.click(el)
  await tick()
  ui.captureFailed('/kcs2/resources/bgm/battle/153_0000.mp3')
  assert.match(el.html, /本次试听未能留存/)
  assert.match(ui.api.bgmPreviewHtml(153, 'battle'), /class="bgm-pv muted"/)
  assert.equal(el.dataset.bgmUrl, undefined)
  ui.click(el)
  await tick()
  assert.equal(ui.sends.length, 1)
  assert.equal(ui.audio(), null)
})

test('BGM 试听：远程关闭且无实物保持既有说明，没有试听按钮', () => {
  const ui = mountBgmPreview()
  ui.api.setRemoteArt(false)
  const html = ui.api.bgmPreviewHtml(153, 'battle')
  assert.match(html, /本机暂无该曲 · 远程获取已关闭/)
  assert.doesNotMatch(html, /data-bgm-url/)
})

test('BGM 试听：先点的曲子与其他游戏曲入档不抢后一次点击；重渲染后仍自动播', async () => {
  const ui = mountBgmPreview()
  ui.click(ui.remoteEntry(153))
  await tick()
  ui.click(ui.remoteEntry(154))
  await tick()
  ui.archived(153)
  ui.archived(155)
  await tick()
  assert.equal(ui.audio(), null)
  ui.wipeEntries()
  const replacement = ui.remoteEntry(154)
  assert.match(replacement.html, /正在取…/)
  const url = ui.archived(154)
  await tick()
  assert.deepEqual(ui.audio().srcWrites, [url])
  assert.ok(ui.marks(replacement).includes('playing'))
})

test('BGM 试听：等待时改播已有档案或语音，迟来的入档广播不抢播放', async () => {
  for (const next of ['bgm', 'voice']) {
    const ui = mountBgmPreview()
    ui.click(ui.remoteEntry(153))
    await tick()
    if (next === 'bgm') ui.click(ui.entry('file:///kuma/bgm/port/101.mp3'))
    else ui.api.claimPreviewPlayback('voice', '语音')
    await tick()
    ui.archived(153)
    await tick()
    assert.deepEqual(ui.audio()?.srcWrites ?? [], next === 'bgm' ? ['file:///kuma/bgm/port/101.mp3'] : [])
  }
})
