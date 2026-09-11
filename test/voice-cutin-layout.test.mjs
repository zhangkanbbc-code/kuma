import assert from 'node:assert/strict'
import test from 'node:test'
import { cutinVerticalLayout } from '../src/shared/voice-cutin-layout.ts'

const lineHeight = 6.5 * 1.2
const edge = 3, reserve = 16, gap = 2

test('单行旗舰与单行僚舰按实际底边留出间隔', () => {
  const anchorY = 36, leadHeight = lineHeight, wingHeight = lineHeight
  assert.deepEqual(cutinVerticalLayout({ anchorY, leadHeight, wingHeight }), {
    leadCenter: anchorY,
    wingCenter: anchorY + leadHeight / 2 + gap + wingHeight / 2,
  })
})

test('三行旗舰下的僚舰顶边不侵入两句间隔', () => {
  const anchorY = 36, leadHeight = 3 * lineHeight, wingHeight = lineHeight
  const result = cutinVerticalLayout({ anchorY, leadHeight, wingHeight })
  assert.equal(result.leadCenter, anchorY)
  assert.equal(result.wingCenter, anchorY + leadHeight / 2 + gap + wingHeight / 2)
  assert.ok(result.wingCenter - wingHeight / 2 >= result.leadCenter + leadHeight / 2 + gap)
})

test('旗舰底边进入预留带时上移，顶边仍在画面内', () => {
  const anchorY = 60, leadHeight = 60
  const bottomLimit = 100 - edge - reserve - gap
  assert.ok(anchorY + leadHeight / 2 > bottomLimit)
  const result = cutinVerticalLayout({ anchorY, leadHeight })
  assert.equal(result.leadCenter, bottomLimit - leadHeight / 2)
  assert.ok(result.leadCenter < anchorY)
  assert.ok(result.leadCenter - leadHeight / 2 >= edge)
})

test('旗舰受顶边限制且僚舰两行总高溢出时，僚舰底边夹到 97%', () => {
  const anchorY = 60, leadHeight = 78, wingHeight = 2 * lineHeight
  const result = cutinVerticalLayout({ anchorY, leadHeight, wingHeight })
  assert.equal(result.leadCenter, edge + leadHeight / 2)
  assert.equal(result.leadCenter - leadHeight / 2, edge)
  assert.ok(result.leadCenter + leadHeight / 2 + gap + wingHeight > 100 - edge)
  assert.equal(result.wingCenter, 100 - edge - wingHeight / 2)
  assert.equal(result.wingCenter + wingHeight / 2, 100 - edge)
})

test('僚舰高度缺席时只排旗舰，仍预留两行', () => {
  const anchorY = 80, leadHeight = lineHeight
  assert.deepEqual(cutinVerticalLayout({ anchorY, leadHeight }), {
    leadCenter: 100 - edge - reserve - gap - leadHeight / 2,
    wingCenter: null,
  })
})

test('非默认纵向锚点照入参接排', () => {
  const anchorY = 42, leadHeight = lineHeight, wingHeight = 2 * lineHeight
  assert.deepEqual(cutinVerticalLayout({ anchorY, leadHeight, wingHeight }), {
    leadCenter: anchorY,
    wingCenter: anchorY + leadHeight / 2 + gap + wingHeight / 2,
  })
})

test('边距、预留高度与间隔均按自定义入参计算', () => {
  const input = { anchorY: 85, leadHeight: 40, wingHeight: 10, edge: 5, reserve: 20, gap: 4 }
  const leadBottom = 100 - input.edge - input.reserve - input.gap
  assert.deepEqual(cutinVerticalLayout(input), {
    leadCenter: leadBottom - input.leadHeight / 2,
    wingCenter: leadBottom + input.gap + input.wingHeight / 2,
  })
})
