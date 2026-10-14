// 执行生产刷新声明；只替换 IPC、时钟和 DOM 边界，不加载 Electron 或真实账本。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { transformSync } from 'esbuild'
import { runtimeHost } from '../../scripts/lib/player-view-runtime.mjs'

const source = fs.readFileSync(new URL('../../src/renderer/modules/zi.ts', import.meta.url), 'utf8')
export const cut = (text, from, to) => {
  const start = text.indexOf(from), end = text.indexOf(to, start + from.length)
  assert.ok(start >= 0 && end > start, `生产声明锚点已移动：${from}`)
  return text.slice(start, end)
}
export const evaluate = (code, bindings, tail) => new Function(...Object.keys(bindings),
  transformSync(`${code}\n${tail}`, { loader: 'ts', format: 'cjs' }).code)(...Object.values(bindings))

export const clock = (at = Date.parse('2026-10-14T04:00:00Z')) => {
  let now = at, id = 0
  const tasks = new Map()
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])) }
    static now() { return now }
  }
  return {
    Date: ClockDate,
    setTimeout: (run, delay = 0) => { tasks.set(++id, { run, at: now + delay }); return id },
    clearTimeout: id => tasks.delete(id),
    advance(ms) {
      now += ms
      for (const [id, task] of [...tasks]) if (task.at <= now) { tasks.delete(id); task.run() }
    },
    next: () => Math.min(...[...tasks.values()].map(task => task.at)),
  }
}

// 最小 DOM 边界：重建会产生新控件、丢失值/焦点/滚动；保位由真 kernel 负责。
export const dom = () => {
  const document = { activeElement: null }
  class Element {
    constructor(tagName = 'DIV', className = '', dataset = {}) {
      Object.assign(this, { tagName, className, dataset, children: [], parent: null,
        scrollTop: 0, scrollLeft: 0, isConnected: true, id: '', writes: 0, handlers: new Map(), _html: '' })
    }
    get attributes() { return Object.entries(this.dataset).map(([key, value]) => ({ name: 'data-' + key.replace(/[A-Z]/g, c => '-' + c.toLowerCase()), value })) }
    appendChild(child) { child.parent = this; this.children.push(child); return child }
    contains(node) { return node === this || this.children.some(child => child.contains(node)) }
    get firstElementChild() { return this.children[0] ?? null }
    matches(selector) {
      return selector.split(',').some(raw => {
        const s = raw.trim()
        if (s === '*') return true
        if (s.startsWith('.')) return this.className.split(' ').includes(s.slice(1))
        if (s.startsWith('[')) {
          const [, name, value] = /^\[data-([\w-]+)(?:="([^"]*)")?\]$/.exec(s) ?? []
          const key = name?.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
          return key && key in this.dataset && (value == null || this.dataset[key] === value)
        }
        return this.tagName.toLowerCase() === s
      })
    }
    closest(selector) { return this.matches(selector) ? this : this.parent?.closest(selector) ?? null }
    querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]) }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null }
    addEventListener(type, handler) { this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler]) }
    emit(type, event = {}) { for (const handler of this.handlers.get(type) ?? []) handler(event) }
    focus() { document.activeElement = this }
    remove() { this.isConnected = false; if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this) }
    set innerHTML(html) {
      this.writes++; this._html = html; this.scrollTop = 0
      for (const child of this.children) child.isConnected = false
      if (this.contains(document.activeElement)) document.activeElement = document.body
      this.children = []
      // 测试只需要这里的控件和内容容器，不模拟浏览器布局。
      if (html.includes('sd-back')) {
        this.appendChild(new Element('DIV', 'sd-back'))
        this.appendChild(new Element('SPAN', 'sd-x'))
        const title = this.appendChild(new Element('SPAN', '', { senkaMonth: '' }))
        title.textContent = /data-senka-month>([^<]*)/.exec(html)?.[1] ?? ''
        const body = this.appendChild(new Element('DIV', 'sd-body'))
        body.innerHTML = html.slice(html.indexOf('<div class="sd-body">') + 21)
      } else if (html.includes('sd-cal-input')) {
        this.appendChild(new Input('INPUT', 'sd-cal-input', { keep: 'senka-calibration' }))
        if (html.includes('sd-qadd-pick')) this.appendChild(new Select('SELECT', 'sd-qadd-pick', { keep: 'senka-quest-pick' }))
        this.appendChild(new Element('BUTTON', '', { act: 'senka-calibrate' }))
      } else if (html.includes('<')) this.appendChild(new Element())
      this.textContent = html.replace(/<[^>]*>/g, '')
    }
    get innerHTML() { return this._html }
  }
  class Input extends Element {
    constructor(...args) { super(...args); this.value = ''; this.selectionStart = 0; this.selectionEnd = 0 }
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end }
  }
  class Select extends Element {
    constructor(...args) { super(...args); this.value = '' }
  }
  document.body = new Element('BODY')
  document.activeElement = document.body
  document.createElement = tag => new Element(tag.toUpperCase())
  document.addEventListener = () => {}
  return { document, HTMLElement: Element, HTMLInputElement: Input, HTMLTextAreaElement: Input, Element, Input, Select }
}

export const makeKernel = (dom, timer, interaction = {}) => runtimeHost().extract('src/renderer/kernel.ts',
  ['deferPassive', 'commitPaneHtml', 'paneHtmlDiffers', 'withViewStateKept', 'releasePointer', 'endComposition'], {
    ...dom, ...timer, ...interaction,
    timedRun: (_tag, run) => run(), safeEach: (_tag, rows, run) => rows.forEach(run),
  }).api

export const makeZi = (bindings, { fullRefresh = false, opening = false } = {}) => {
  const sections = [
    cut(source, 'let senkaCalendarEl:', '// 周期文案：'),
    cut(source, 'const renderSenkaDetail =', "document.addEventListener('keydown'"),
  ]
  if (opening) sections.push(cut(source, 'const openSenkaDetail =', '// 校准写入后：'))
  if (fullRefresh) sections.push(cut(source, 'const runPassiveRefresh =', '// ---- 资源/材料实体'))
  else sections.push(cut(source, 'const scheduleSenkaRollover =', 'const refresh = async'))
  return evaluate(sections.join('\n'), bindings, `return {
    toggleSenkaCalendar, closeSenkaCalendar, refreshSenkaCalendar, closeSenkaDetail,
    renderSenkaDetail, renderSenkaDetailPassive, refreshSenkaDetail, refreshSenkaHistory,
    applySenkaRanking, readSenkaRanking, scheduleSenkaRollover,
    ${fullRefresh ? 'refresh, runPassiveRefresh, scheduleDayRollover,' : ''}
    ${opening ? 'openSenkaDetail,' : ''}
    setHost(host) { senkaDetailEl = host },
    state() { return { senka, senkaRanking, senkaRankingFailedAt, senkaHistoryFailedAt,
      senkaDetailFailedAt, senkaDetailPending, senkaCalendarEl, senkaCalendarMonth,
      senkaCalendarFailure, senkaHistoryAttempt ${fullRefresh ? ', loadError, itemFlow, todayHistory' : ''} } }
  }`)
}
