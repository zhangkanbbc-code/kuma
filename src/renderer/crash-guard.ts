// 渲染层崩溃防线。
//
// 这个应用是「一个渲染进程装十几个模块」的结构，模块之间靠内核广播咬合。
// 广播和装配原本都是裸调用，于是有两条单点故障：
//
//   1. 内核派发 `listeners.forEach((cb) => cb(...))`——任何一个模块的回调抛异常，
//      排在它后面的模块就再也收不到这次更新。而且每次派发都从同一处断，
//      表现是「界面卡在旧状态不动」，还只有一部分模块不动，极难对上原因。
//   2. 装配 `mod.mount(pane)`——一个模块 mount 抛异常，整个循环当场结束，
//      剩下的模块全部装不上，就是黑屏。
//
// 所以这里做三件事：
//   · guard / safeEach：把「一个坏了」隔离成「只有它坏了」；
//   · 记账：哪个环节、错了几次、最后一次是什么——同一处反复出错只累加计数，
//     不弹窗轰炸，也不让日志无限膨胀；
//   · 上报：顶栏出角标，同时送主进程落盘。正式包里 DevTools 是关的，
//     没有这条线，出事就只能看着界面不动干瞪眼。
//
// 记的是**事实**：错误原文与出错位置，不做「大概是 XX 引起的」这类推断。

import { benignReason, createCrashJournal } from '../shared/crash-record'
import type { CrashRecord } from '../shared/crash-record'

const { ipcRenderer } = require('electron')

export type { CrashRecord }

// 记账本体在 shared 里（纯逻辑、可测）；这里只接上渲染层特有的两个副作用：
// 打到控制台，和送主进程落盘。
const journal = createCrashJournal({
  onRecord: (entry) => {
    if (entry.benign) return // 已知噪音不占磁盘：它会周期性复现，落盘只会把真记录冲走
    // 这条链自己不能再抛，否则错误处理反倒成了新的错误源。
    try {
      ipcRenderer.send('kanso:crash', {
        scope: entry.scope,
        message: entry.message,
        stack: entry.stack,
        ts: entry.lastTs,
      })
    } catch {
      /* IPC 不可用（例如窗口正在关闭）时放弃落盘，内存里的记录仍在 */
    }
  },
})

export const crashLog = (): CrashRecord[] => journal.list()
export const onCrash = (cb: (records: CrashRecord[]) => void) => journal.subscribe(cb)
export const clearCrashLog = () => journal.clear()

export const recordCrash = (scope: string, error: unknown) => {
  const entry = journal.record(scope, error)
  // console 也包住：recordCrash 位于错误处理链上，console.error 自己抛
  // （EPIPE 一类）就成了 error 事件 → recordCrash → console 再抛的自激环
  try {
    // 噪音不打 console.error：控制台是排查真问题的地方，别让它也被淹掉
    if (entry.benign) console.debug(`[kanso] ${scope}（已知噪音）：`, entry.message)
    else console.error(`[kanso] ${scope} 出错：`, error)
  } catch {
    /* console 不可用时放弃打印，记账本体已完成 */
  }
}

/**
 * 跑一次，抛了就记账并返回 fallback。
 * 用在「这一步失败不该拖垮调用方」的地方——注意别拿它包住真正必须成功的操作，
 * 那样只会把硬错误变成静默的空结果。
 */
export const guard = <T>(scope: string, fn: () => T, fallback: T): T => {
  try {
    return fn()
  } catch (error) {
    recordCrash(scope, error)
    return fallback
  }
}

/** 逐个跑，互不牵连。返回出错的个数。 */
export const safeEach = <T>(scope: string, items: readonly T[], fn: (item: T) => void): number => {
  let failed = 0
  for (const item of items) {
    try {
      fn(item)
    } catch (error) {
      failed += 1
      recordCrash(scope, error)
    }
  }
  return failed
}

/**
 * 全局错误网：兜住所有没被 guard 罩住的地方。
 * 这两个事件是最后一道——到这里说明异常已经逃出了所有隔离，
 * 至少要让它留下痕迹，而不是消失在一个没人看的控制台里。
 */
export const installCrashNet = () => {
  window.addEventListener('error', (e) => {
    // 资源加载失败（img/audio 等）也走 error 事件，但它们有各自的回退处理，不算崩溃
    if (e.target && e.target !== window) return
    recordCrash('window:error', e.error ?? e.message)
  })
  window.addEventListener('unhandledrejection', (e) => {
    recordCrash('window:unhandledrejection', e.reason)
  })
}

// ---- 顶栏角标 ----
// 出了事得让人看见。没有这个角标，隔离做得越好越危险：模块悄悄坏掉一个，
// 界面看着还是全的，你只会觉得「这块数据怎么不更新了」，查不到是它崩了。

const pad2 = (n: number) => String(n).padStart(2, '0')
const clockOf = (ts: number) => {
  const d = new Date(ts)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

const plainText = (list: CrashRecord[]) =>
  list
    .map(
      (r) =>
        `[${clockOf(r.lastTs)}] ${r.scope} ×${r.count}${r.benign ? '（已知噪音，非错误）' : ''}\n` +
        `${r.message}\n${r.stack ?? '（无调用栈）'}`,
    )
    .join('\n\n')

export const installCrashBadge = () => {
  const header = document.querySelector('header')
  const anchor = document.querySelector('#overlay-bar')
  if (!header || !anchor) return

  const badge = document.createElement('button')
  badge.id = 'crash-badge'
  badge.hidden = true
  badge.title = '本次运行中出错的环节（点击查看）'
  header.insertBefore(badge, anchor)

  const panel = document.createElement('div')
  panel.id = 'crash-panel'
  panel.hidden = true
  document.body.appendChild(panel)

  const itemHtml = (r: CrashRecord) =>
    `<div class="cp-item${r.benign ? ' benign' : ''}"><div class="cp-scope">${esc(r.scope)}` +
    `${r.count > 1 ? `<em>×${r.count}</em>` : ''}` +
    `<i>${clockOf(r.lastTs)}</i></div>` +
    `<div class="cp-msg">${esc(r.message)}</div>` +
    (r.benign ? `<div class="cp-why">${esc(benignReason(r.message) ?? '已知噪音')}</div>` : '') +
    (r.stack ? `<pre>${esc(r.stack)}</pre>` : '') +
    `</div>`

  const renderPanel = (list: CrashRecord[]) => {
    const real = list.filter((r) => !r.benign)
    const noise = list.filter((r) => r.benign)
    panel.innerHTML =
      `<div class="cp-head"><b>运行中出错的环节</b>` +
      `<span>${real.length} 处</span>` +
      `<button data-cp="copy">复制全文</button><button data-cp="clear">清空</button>` +
      `<button data-cp="close">关闭</button></div>` +
      `<div class="cp-body">${
        real.length ? real.map(itemHtml).join('') : '<div class="cp-empty">这次运行还没有出过错。</div>'
      }${
        // 噪音单独一栏：不当作错误，但高频出现本身有意义（比如布局在反复抖），所以不藏起来
        noise.length
          ? `<div class="cp-noise-h">已知噪音 ${noise.length} 类</div>` +
            noise.map(itemHtml).join('')
          : ''
      }</div>`
  }

  const sync = (list: CrashRecord[]) => {
    const real = list.filter((r) => !r.benign)
    const total = real.reduce((sum, r) => sum + r.count, 0)
    badge.hidden = real.length === 0
    badge.textContent = `⚠ ${real.length}`
    badge.title = `本次运行中 ${real.length} 处出错，共 ${total} 次（点击查看）`
    if (!panel.hidden) renderPanel(list)
  }

  badge.addEventListener('click', () => {
    panel.hidden = !panel.hidden
    if (!panel.hidden) renderPanel(crashLog())
  })
  panel.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-cp]')?.dataset.cp
    if (act === 'close') panel.hidden = true
    else if (act === 'clear') {
      clearCrashLog()
      panel.hidden = true
    } else if (act === 'copy') {
      void navigator.clipboard.writeText(plainText(crashLog()))
    }
  })
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) panel.hidden = true
  })

  onCrash(sync)
  sync(crashLog()) // 网张开到装配完成之间已经攒下的错误，这里补显示
}
