// 魔改文件夹卡上的定时换装开关与时刻（2026-10-14 维护者裁决：在魔改栏里接入，时间可调；目录分常驻 + 白天 + 夜间三个）。
// 配置键：kuma.mod.night.enabled / kuma.mod.night.start / kuma.mod.night.end（主进程按它们判夜间）。
// 控件约定：开关 [data-act="toggle-mod-night"]；两个时刻 input[data-mod-night="start"|"end"]；
// 「打开白天文件夹」[data-act="open-mod-day-dir"] → yu:open-mod-day-dir；「打开夜间文件夹」[data-act="open-mod-night-dir"] → yu:open-mod-night-dir（都先建出来再打开）。
import assert from 'node:assert/strict'
import test from 'node:test'

import { cardHtml, mountYu } from './fixtures/render-yu.mjs'
import sections from '../dist/shared/settings-sections.js'

// 魔改文件夹卡在「诊断」页签
const HEALTH = { [sections.SETTINGS_SECTION_UI_KEY]: 'health' }
const NIGHT_KEYS = ['kuma.mod.night.enabled', 'kuma.mod.night.start', 'kuma.mod.night.end']
const modCard = (yu) => cardHtml(yu.pane.innerHTML, 'mod-dir')
/** 卡里某个时刻输入框的当前值 */
const clockValue = (html, which) =>
  new RegExp(`<input[^>]*data-mod-night="${which}"[^>]*>`).exec(html)?.[0].match(/value="([^"]*)"/)?.[1]
/** 在 input[data-mod-night="<which>"] 上填一个值并松手（夹具的 change 只带空 dataset 值，这里要区分开始/结束） */
const setClock = (yu, which, value) => {
  const self = { dataset: { modNight: which }, value }
  for (const handler of yu.pane.handlers.get('change') ?? []) {
    handler({ target: { closest: (selector) => (selector === 'input[data-mod-night]' ? self : null) } })
  }
}

test('卡上有开关、两个时刻与打开白天/夜间文件夹；没设过时显示默认 18:00 → 06:00', () => {
  const html = modCard(mountYu({ ui: HEALTH }))
  assert.match(html, /data-act="open-mod-dir"/)
  assert.match(html, /data-act="toggle-mod-night"/)
  assert.match(html, /data-act="open-mod-day-dir"/)
  assert.match(html, /data-act="open-mod-night-dir"/)
  assert.equal(clockValue(html, 'start'), '18:00')
  assert.equal(clockValue(html, 'end'), '06:00')
})

test('开关切换写回配置，再点一次关掉', () => {
  const yu = mountYu({ ui: HEALTH })
  yu.click({ act: 'toggle-mod-night' })
  assert.equal(yu.configOf('kuma.mod.night.enabled'), true)
  yu.click({ act: 'toggle-mod-night' })
  assert.equal(yu.configOf('kuma.mod.night.enabled'), false)
})

test('改时刻写回配置并按新值重绘；写坏的值不落盘', () => {
  const yu = mountYu({ ui: HEALTH, config: { 'kuma.mod.night.enabled': true } })
  setClock(yu, 'start', '20:30')
  setClock(yu, 'end', '05:15')
  assert.equal(yu.configOf('kuma.mod.night.start'), '20:30')
  assert.equal(yu.configOf('kuma.mod.night.end'), '05:15')
  assert.equal(clockValue(modCard(yu), 'start'), '20:30')
  assert.equal(clockValue(modCard(yu), 'end'), '05:15')
  setClock(yu, 'start', '99:99')
  assert.equal(yu.configOf('kuma.mod.night.start'), '20:30')
})

test('打开白天/夜间文件夹走主进程，不动配置', () => {
  const yu = mountYu({ ui: HEALTH })
  yu.click({ act: 'open-mod-day-dir' })
  yu.click({ act: 'open-mod-night-dir' })
  assert.ok(yu.invoked.includes('yu:open-mod-day-dir'))
  assert.ok(yu.invoked.includes('yu:open-mod-night-dir'))
  for (const key of NIGHT_KEYS) assert.equal(yu.configOf(key), undefined, `只是打开文件夹，不该写 ${key}`)
})
