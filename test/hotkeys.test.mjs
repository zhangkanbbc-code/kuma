import assert from 'node:assert/strict'
import test from 'node:test'

import hotkeys from '../dist/shared/hotkeys.js'

const {
  BOSS_HOTKEY_ENABLED_CONFIG_KEY,
  formatAccelerator,
  HOTKEY_CONFIG_KEYS,
  HOTKEY_DEFAULTS,
  isAcceptableAccelerator,
  matchesInput,
  parseAccelerator,
  planBossToggle,
} = hotkeys

test('默认键与五个配置路径固定', () => {
  assert.deepEqual(HOTKEY_DEFAULTS, {
    boss: 'Ctrl+Alt+H',
    reload: 'F5',
    focus: 'F9',
    capture: 'Ctrl+Alt+S',
  })
  assert.deepEqual(HOTKEY_CONFIG_KEYS, {
    boss: 'kanso.hotkeys.boss',
    reload: 'kanso.hotkeys.reload',
    focus: 'kanso.hotkeys.focus',
    capture: 'kanso.hotkeys.capture',
  })
  assert.equal(BOSS_HOTKEY_ENABLED_CONFIG_KEY, 'kanso.hotkeys.bossEnabled')
})

const parse = (text) => {
  const accelerator = parseAccelerator(text)
  assert.ok(accelerator, `没有认出 ${text}`)
  return accelerator
}

test('parse：Ctrl/Control/CommandOrControl 都归一成 control', () => {
  for (const text of ['Ctrl+H', 'Control+h', 'CommandOrControl+H']) {
    assert.deepEqual(parse(text), {
      control: true,
      alt: false,
      shift: false,
      meta: false,
      key: 'h',
    })
  }
})

test('parse：大小写、F 键与常用特殊键统一成小写 key', () => {
  assert.equal(parse('f24').key, 'f24')
  assert.equal(parse('ALT+Esc').key, 'escape')
  assert.equal(parse('Ctrl+ArrowUp').key, 'up')
})

test('parse：多枚主键、越界 F 键与空串拒绝', () => {
  assert.equal(parseAccelerator('Ctrl+H+J'), null)
  assert.equal(parseAccelerator('F25'), null)
  assert.equal(parseAccelerator(''), null)
})

test('match：Ctrl+Alt+H 的键与修饰完全一致时命中', () => {
  assert.equal(
    matchesInput(
      {
        key: 'H',
        control: true,
        alt: true,
        shift: false,
        meta: false,
        isAutoRepeat: false,
        type: 'keyDown',
      },
      parse('Ctrl+Alt+H'),
    ),
    true,
  )
})

test('match：Ctrl+Alt+H 多按 Shift 不命中', () => {
  assert.equal(
    matchesInput(
      {
        key: 'h',
        control: true,
        alt: true,
        shift: true,
        meta: false,
        isAutoRepeat: false,
        type: 'keyDown',
      },
      parse('Ctrl+Alt+H'),
    ),
    false,
  )
})

test('match：自动重复不命中', () => {
  assert.equal(
    matchesInput(
      {
        key: 'F5',
        control: false,
        alt: false,
        shift: false,
        meta: false,
        isAutoRepeat: true,
        type: 'keyDown',
      },
      parse('F5'),
    ),
    false,
  )
})

test('match：keyUp 不命中', () => {
  assert.equal(
    matchesInput(
      {
        key: 'F9',
        control: false,
        alt: false,
        shift: false,
        meta: false,
        isAutoRepeat: false,
        type: 'keyUp',
      },
      parse('F9'),
    ),
    false,
  )
})

test('accept：F1–F24 可以不带修饰键', () => {
  assert.equal(isAcceptableAccelerator(parse('F5')), true)
  assert.equal(isAcceptableAccelerator(parse('F24')), true)
})

test('accept：单字母不能裸用', () => {
  assert.equal(isAcceptableAccelerator(parse('A')), false)
})

test('accept：单独 Shift+A 不够，Ctrl/Alt/Meta 可以', () => {
  assert.equal(isAcceptableAccelerator(parse('Shift+A')), false)
  assert.equal(isAcceptableAccelerator(parse('Ctrl+A')), true)
  assert.equal(isAcceptableAccelerator(parse('Alt+Escape')), true)
  assert.equal(isAcceptableAccelerator(parse('Meta+1')), true)
})

test('format：组合键按统一顺序显示并留空格', () => {
  assert.equal(formatAccelerator(parse('Shift+Alt+Ctrl+h')), 'Ctrl + Alt + Shift + H')
})

test('format：单枚 F 键与特殊键使用显示名', () => {
  assert.equal(formatAccelerator(parse('F5')), 'F5')
  assert.equal(formatAccelerator(parse('Ctrl+Esc')), 'Ctrl + Escape')
})

const bossSnapshot = {
  windows: [
    { id: 1, visible: true, minimized: false, focused: true },
    { id: 2, visible: true, minimized: false, focused: false },
    { id: 3, visible: false, minimized: true, focused: false },
  ],
  audio: [
    { id: 10, muted: false },
    { id: 11, muted: true },
  ],
}

test('老板键状态机：三扇窗全部隐藏，游戏 guest 与原本静音页全部压成静音', () => {
  assert.deepEqual(planBossToggle(false, bossSnapshot), [
    { type: 'hide-window', id: 1 },
    { type: 'hide-window', id: 2 },
    { type: 'hide-window', id: 3 },
    { type: 'set-audio-muted', id: 10, muted: true },
    { type: 'set-audio-muted', id: 11, muted: true },
  ])
})

test('老板键状态机：恢复可见/最小化/焦点与每页原始静音快照', () => {
  assert.deepEqual(planBossToggle(true, bossSnapshot), [
    { type: 'show-window', id: 1 },
    { type: 'show-window', id: 2 },
    { type: 'show-window', id: 3 },
    { type: 'minimize-window', id: 3 },
    { type: 'focus-window', id: 1 },
    { type: 'set-audio-muted', id: 10, muted: false },
    { type: 'set-audio-muted', id: 11, muted: true },
  ])
})
