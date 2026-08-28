import assert from 'node:assert/strict'
import test from 'node:test'

import outlook from '../dist/shared/route-outlook.js'

const { routeOutlook } = outlook

const path = (nodes, probability, uncertain = false) => ({ nodes, probability, uncertain })

test('the headline route is the most likely one, and ties go to the shorter path', () => {
  const view = routeOutlook(
    [
      path(['1', 'A', 'B', 'C'], 0.4),
      path(['1', 'A', 'D'], 0.4),
      path(['1', 'E'], 0.2),
    ],
    new Set(['C']),
  )
  assert.deepEqual(view.best.nodes, ['1', 'A', 'D'])
  assert.equal(view.routes, 3)
})

test('boss reach adds up the routes that pass through it', () => {
  const view = routeOutlook(
    [path(['1', 'A', 'K'], 0.3), path(['1', 'B', 'K'], 0.25), path(['1', 'J'], 0.45)],
    new Set(['K']),
  )
  assert.equal(view.boss.routes, 2)
  assert.equal(view.boss.total, 3)
  assert.ok(Math.abs(view.boss.probability - 0.55) < 1e-9)
})

test('one unknown branch makes the whole boss probability unknown, not a smaller number', () => {
  // 把未知当 0 会给出「进 Boss 30%」这种看着精确、实际偏低的数——比不给还糟
  const view = routeOutlook(
    [path(['1', 'A', 'K'], 0.3), path(['1', 'B', 'K'], null, true), path(['1', 'J'], null, true)],
    new Set(['K']),
  )
  assert.equal(view.boss.routes, 2)
  assert.equal(view.boss.probability, null)
  assert.equal(view.uncertain, 2)
  // 概率未知的路线当不了「最可能」，但有概率的那条仍然可以
  assert.deepEqual(view.best.nodes, ['1', 'A', 'K'])
})

test('routes that all miss the boss report zero, which is a fact, not an unknown', () => {
  const view = routeOutlook([path(['1', 'J'], null, true)], new Set(['K']))
  assert.equal(view.boss.routes, 0)
  assert.equal(view.boss.probability, 0)
  assert.equal(view.best, null)
})

test('an unknown boss location stays unknown instead of being guessed', () => {
  // 这张图还没打到过 Boss：不知道就不说，别把终点当 Boss
  const view = routeOutlook([path(['1', 'A'], 1)], new Set())
  assert.equal(view.boss, null)
  assert.equal(routeOutlook([], new Set(['K'])).boss, null)
  assert.equal(routeOutlook(null, new Set(['K'])).routes, 0)
})
