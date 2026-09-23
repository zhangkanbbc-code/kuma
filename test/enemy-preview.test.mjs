import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

import target from '../dist/shared/enemy-preview.js'

const { previewRevealsWholeFleet, compFitsPreview, previewSampleClause } = target

test('揭示一艘或两艘即整队，零艘与三艘不判整队', () => {
  assert.equal(previewRevealsWholeFleet(0), false)
  assert.equal(previewRevealsWholeFleet(1), true)
  assert.equal(previewRevealsWholeFleet(2), true)
  assert.equal(previewRevealsWholeFleet(3), false)
})

test('不足三艘只认同长度编成，三艘与零艘不限制长度', () => {
  assert.equal(compFitsPreview([1532], 1), true)
  assert.equal(compFitsPreview([1532], 6), false)
  assert.equal(compFitsPreview([1532, 1530], 2), true)
  assert.equal(compFitsPreview([1532, 1530], 3), false)
  assert.equal(compFitsPreview([1533, 1530, 1530], 6), true)
  assert.equal(compFitsPreview([1533, 1530, 1530], 3), true)
  assert.equal(compFitsPreview([], 6), true)
})

test('样本查询不足三艘按整队匹配，三艘仍按前缀匹配', (t) => {
  const db = new DatabaseSync(':memory:')
  t.after(() => db.close())
  db.exec('CREATE TABLE t (comp TEXT)')
  const insert = db.prepare('INSERT INTO t (comp) VALUES (?)')
  for (const comp of [
    '[1532]',
    '[1532,1530]',
    '[1532,1530,1530,1530,1530,1530]',
    '[1533,1530,1530]',
    '[1533,1530,1530,1530]',
  ]) insert.run(comp)
  const count = (previewIds) => {
    const { sql, params } = previewSampleClause(previewIds)
    return db.prepare(`SELECT COUNT(*) AS n FROM t WHERE ${sql}`).get(...params).n
  }
  assert.equal(count([1532]), 1)
  assert.equal(count([1532, 1530]), 1)
  assert.equal(count([1533, 1530, 1530]), 2)
})
