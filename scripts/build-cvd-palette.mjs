import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { NEUTRAL_TOKENS } from '../src/shared/theme.ts'
import { fitContrast, toLab } from './lib/cvd-color.mjs'

const renderer = fileURLToPath(new URL('../src/renderer/', import.meta.url))
const neutral = new Set(NEUTRAL_TOKENS)
const hex = /^#[0-9a-f]{6}$/i
const begin = '    /* 色觉配色开始 · 维护者裁决 2026-11-25 · 生成器产物，勿手改 */'
const end = '    /* 色觉配色结束 */'

// 评级通过 var 引用核心色。血条端点和损伤弹幕也使用对应档位。
const targets = {
  redgreen: {
    dark: { ok: '#57dcf2', bad: '#ed7952', warn: '#e6ba6a', gold: '#fff19b', accent: '#9bb8ff', dock: '#6984c9' },
    light: { ok: '#006487', bad: '#892d10', warn: '#866b00', gold: '#322300', accent: '#00396f', dock: '#342558' },
  },
  mono: {
    dark: { ok: '#858585', bad: '#a2a2a2', warn: '#bcbcbc', gold: '#f6f6f6', accent: '#d9d9d9', dock: '#d9d9d9' },
    light: { ok: '#636363', bad: '#202020', warn: '#353535', gold: '#080808', accent: '#4b4b4b', dock: '#4b4b4b' },
  },
}
const damageTones = {
  'voice-dmg-light': 'gold', 'voice-dmg-mid': 'warn', 'voice-dmg-heavy': 'bad', 'voice-dmg-sunk': 'dock',
  'expedition-soft': 'dock',
}

// 用完整的连字符分段归族，覆盖 ok-soft、tint-ok-*、meter-ok-start、glow-gold 等。
// danger 横幅属于 bad；沉没血条的 meter-teal-start 以 dock 为终点。
function familyOf(key) {
  if (key === 'meter-teal-start') return 'dock'
  const words = key.split('-')
  if (words.includes('danger')) return 'bad'
  return words.find(word => Object.hasOwn(targets.redgreen.dark, word))
}

function colorFor(key, tokens, mode, ground) {
  const source = tokens[key]
  const [L, a, b] = toLab(source)
  const palette = targets[mode][ground]
  const family = damageTones[key] ?? familyOf(key)
  let lab
  if (key === family || damageTones[key]) {
    lab = toLab(palette[family])
  } else if (family && tokens[family]) {
    const [targetL, targetA, targetB] = toLab(palette[family])
    const hue = Math.atan2(targetB, targetA)
    const chroma = Math.hypot(a, b)
    lab = mode === 'mono'
      ? [L + targetL - toLab(tokens[family])[0], 0, 0]
      : [L, chroma * Math.cos(hue), chroma * Math.sin(hue)]
  } else {
    // 把难以分辨的红绿轴差异投到黄蓝轴；其余明度信息保留。
    lab = mode === 'mono' ? [L, 0, 0] : [L, 0.4 * a, b + 0.85 * a]
  }
  return fitContrast(lab, source, tokens.bg0, ground)
}

function declarations(block) {
  const css = block.replace(/\/\*[\s\S]*?\*\//g, '')
  return Object.fromEntries([...css.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]))
}

for (const file of fs.readdirSync(renderer, { recursive: true }).filter(name => name.endsWith('.html')).sort()) {
  const location = path.join(renderer, file)
  const original = fs.readFileSync(location, 'utf8')
  const html = original.replace(/\r\n/g, '\n')
  const root = /:root\s*\{([^}]*)\}/.exec(html)
  if (!root) continue
  const dark = declarations(root[1])
  if (!dark.gold) continue
  const lightRoot = /:root\[data-theme="light"\]\s*\{([^}]*)\}/.exec(html)
  const light = { ...dark, ...declarations(lightRoot[1]) }
  const keys = Object.keys({ ...dark, ...light }).filter(key =>
    !neutral.has(key) && [dark, light].some(tokens => {
      if (!hex.test(tokens[key])) return false
      const [, a, b] = toLab(tokens[key])
      return Math.hypot(a, b) > 0.02
    }),
  )
  const blocks = [begin]
  for (const mode of ['redgreen', 'mono']) {
    for (const [ground, tokens] of Object.entries({ dark, light })) {
      const selector = ground === 'dark' ? ':root' : ':root[data-theme="light"]'
      blocks.push(`    ${selector}[data-cvd="${mode}"] {`)
      for (const key of keys) {
        if (!hex.test(tokens[key])) throw Error(`${file} ${ground} --${key}: ${tokens[key]}`)
        blocks.push(`      --${key}: ${colorFor(key, tokens, mode, ground)};`)
      }
      blocks.push('    }')
    }
  }
  blocks.push(end)
  const insert = lightRoot.index + lightRoot[0].length
  const start = html.indexOf(begin), stop = html.indexOf(end)
  if ((start < 0) !== (stop < 0) || (start >= 0 && stop < start)) throw Error(`${file} 色觉配色标记不成对`)
  const base = start < 0 ? html : html.slice(0, start - 1) + html.slice(stop + end.length)
  const result = base.slice(0, insert) + '\n' + blocks.join('\n') + base.slice(insert)
  console.log(`${file}: ${keys.length}`)
  if (result === html) continue
  if (process.argv.includes('--check')) {
    console.error(`${file} 色觉配色需要重新生成`)
    process.exitCode = 1
  } else fs.writeFileSync(location, original.includes('\r\n') ? result.replaceAll('\n', '\r\n') : result)
}
