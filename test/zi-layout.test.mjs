import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { ziLayoutClass } from '../src/shared/zi-layout.ts'

for (const [width, expected] of [[699, 'narrow'], [700, ''], [1199, ''], [1200, 'wide']]) {
  test(`资源面板 ${width}px 判定为 ${expected || '常规态'}`, () => {
    assert.equal(ziLayoutClass(width), expected)
  })
}

const css = fs.readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8')

test('资源宽态八格排一行', () => {
  assert.match(css, /\.mod-zi\.wide \.tiles\s*\{\s*grid-template-columns:\s*repeat\(8, 1fr\);\s*\}/)
})

test('资源宽态卡片用最小 320px 的网格自动折行', () => {
  const side = css.match(/\.mod-zi\.wide \.side\s*\{([^}]+)\}/)?.[1]
  assert.ok(side)
  assert.match(side, /display:\s*grid;/)
  assert.match(side, /grid-template-columns:\s*repeat\(auto-fit, minmax\(320px, 1fr\)\);/)
  assert.match(side, /align-content:\s*start;/)
  assert.match(side, /gap:\s*0;/)
})
