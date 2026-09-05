export interface Accelerator {
  control: boolean
  alt: boolean
  shift: boolean
  meta: boolean
  key: string
}

export interface HotkeyInput {
  key: string
  control: boolean
  alt: boolean
  shift: boolean
  meta: boolean
  isAutoRepeat: boolean
  type: string
}

export const HOTKEY_DEFAULTS = {
  boss: 'Ctrl+Alt+H',
  reload: 'F5',
  focus: 'F9',
  capture: 'Ctrl+Alt+S',
} as const

export type HotkeyId = keyof typeof HOTKEY_DEFAULTS
export type ApplicationHotkeyId = Exclude<HotkeyId, 'boss'>

export const HOTKEY_CONFIG_KEYS: Record<HotkeyId, string> = {
  boss: 'kanso.hotkeys.boss',
  reload: 'kanso.hotkeys.reload',
  focus: 'kanso.hotkeys.focus',
  capture: 'kanso.hotkeys.capture',
}
export const BOSS_HOTKEY_ENABLED_CONFIG_KEY = 'kanso.hotkeys.bossEnabled'

const SPECIAL_KEY_ALIASES: Record<string, string> = {
  esc: 'escape',
  escape: 'escape',
  return: 'enter',
  enter: 'enter',
  space: 'space',
  spacebar: 'space',
  backspace: 'backspace',
  delete: 'delete',
  del: 'delete',
  insert: 'insert',
  ins: 'insert',
  arrowup: 'up',
  up: 'up',
  arrowdown: 'down',
  down: 'down',
  arrowleft: 'left',
  left: 'left',
  arrowright: 'right',
  right: 'right',
  home: 'home',
  end: 'end',
  pageup: 'pageup',
  pagedown: 'pagedown',
  tab: 'tab',
  plus: 'plus',
  '+': 'plus',
}

const normalizeKey = (raw: string): string | null => {
  const key = raw.trim().toLowerCase()
  if (/^f(?:[1-9]|1\d|2[0-4])$/.test(key)) return key
  if (key.length === 1) return key
  return SPECIAL_KEY_ALIASES[key] ?? null
}

/**
 * Electron accelerator → 一份与平台无关的按键形状。
 * CommandOrControl 在本项目的 Windows 配置里按 Ctrl 归一，避免同一键有两种比较结果。
 */
export const parseAccelerator = (text: string): Accelerator | null => {
  if (typeof text !== 'string' || !text.trim()) return null
  const result: Accelerator = {
    control: false,
    alt: false,
    shift: false,
    meta: false,
    key: '',
  }

  for (const rawPart of text.split('+')) {
    const part = rawPart.trim().toLowerCase()
    if (!part) continue
    if (part === 'ctrl' || part === 'control' || part === 'commandorcontrol' || part === 'cmdorctrl') {
      result.control = true
    } else if (part === 'alt' || part === 'option') {
      result.alt = true
    } else if (part === 'shift') {
      result.shift = true
    } else if (part === 'meta' || part === 'command' || part === 'cmd' || part === 'super') {
      result.meta = true
    } else {
      const key = normalizeKey(part)
      if (!key || result.key) return null
      result.key = key
    }
  }
  return result
}

/**
 * 修饰键必须完全一致：例如绑定 Ctrl+Alt+H 时，多按 Shift 不是同一条快捷键。
 * 这既避免宽匹配抢走别的组合键，也让录入后显示的那一串就是实际触发条件。
 */
export const matchesInput = (input: HotkeyInput, accel: Accelerator): boolean =>
  input.type === 'keyDown' &&
  !input.isAutoRepeat &&
  normalizeKey(input.key) === accel.key &&
  input.control === accel.control &&
  input.alt === accel.alt &&
  input.shift === accel.shift &&
  input.meta === accel.meta

export const isAcceptableAccelerator = (accel: Accelerator): boolean => {
  if (!accel.key) return false
  if (/^f(?:[1-9]|1\d|2[0-4])$/.test(accel.key)) return true
  return accel.control || accel.alt || accel.meta
}

const KEY_LABELS: Record<string, string> = {
  escape: 'Escape',
  enter: 'Enter',
  space: 'Space',
  backspace: 'Backspace',
  delete: 'Delete',
  insert: 'Insert',
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  tab: 'Tab',
  plus: 'Plus',
}

export const formatAccelerator = (accel: Accelerator): string => {
  const parts: string[] = []
  if (accel.control) parts.push('Ctrl')
  if (accel.alt) parts.push('Alt')
  if (accel.shift) parts.push('Shift')
  if (accel.meta) parts.push('Meta')
  if (accel.key) {
    parts.push(
      /^f\d+$/.test(accel.key)
        ? accel.key.toUpperCase()
        : (KEY_LABELS[accel.key] ?? accel.key.toUpperCase()),
    )
  }
  return parts.join(' + ')
}

/** 归一回 Electron 可直接注册、也适合落盘的 accelerator 串。 */
export const serializeAccelerator = (accel: Accelerator): string => {
  const parts: string[] = []
  if (accel.control) parts.push('Ctrl')
  if (accel.alt) parts.push('Alt')
  if (accel.shift) parts.push('Shift')
  if (accel.meta) parts.push('Super')
  if (accel.key) parts.push(KEY_LABELS[accel.key] ?? accel.key.toUpperCase())
  return parts.join('+')
}

export interface BossWindowSnapshot {
  id: number
  visible: boolean
  minimized: boolean
  focused: boolean
}

export interface BossAudioSnapshot {
  id: number
  muted: boolean
}

export interface BossSnapshot {
  windows: readonly BossWindowSnapshot[]
  audio: readonly BossAudioSnapshot[]
}

export type BossAction =
  | { type: 'hide-window'; id: number }
  | { type: 'show-window'; id: number }
  | { type: 'minimize-window'; id: number }
  | { type: 'focus-window'; id: number }
  | { type: 'set-audio-muted'; id: number; muted: boolean }

/**
 * 老板键只规划动作，Electron 对象与时序留在主进程执行。
 * 隐藏时声音也必须压住，否则窗口虽没了、游戏仍在响，等于没有真正藏住；
 * 恢复则逐项照快照还原，不能把玩家原本静音的页面擅自打开。
 */
export const planBossToggle = (hidden: boolean, snapshot: BossSnapshot): BossAction[] => {
  if (!hidden) {
    return [
      ...snapshot.windows.map(({ id }) => ({ type: 'hide-window', id }) as const),
      ...snapshot.audio.map(({ id }) => ({ type: 'set-audio-muted', id, muted: true }) as const),
    ]
  }

  return [
    ...snapshot.windows
      .filter(({ visible, minimized }) => visible || minimized)
      .map(({ id }) => ({ type: 'show-window', id }) as const),
    ...snapshot.windows
      .filter(({ minimized }) => minimized)
      .map(({ id }) => ({ type: 'minimize-window', id }) as const),
    ...snapshot.windows
      .filter(({ focused }) => focused)
      .map(({ id }) => ({ type: 'focus-window', id }) as const),
    ...snapshot.audio.map(({ id, muted }) => ({ type: 'set-audio-muted', id, muted }) as const),
  ]
}
