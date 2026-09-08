import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { openLedger } from './fixtures/phantom-consumable-ledger.mjs'

const seed = (t, ids = [4, 10]) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-phantom-consumable-'))
  const file = path.join(dir, 'mg.sqlite')
  const db = new DatabaseSync(file)
  db.exec(`
    CREATE TABLE useitem_log (
      ts INTEGER NOT NULL, item_id INTEGER NOT NULL, delta INTEGER NOT NULL,
      total INTEGER NOT NULL, cause TEXT
    );
    PRAGMA user_version = 13;
  `)
  const insert = db.prepare('INSERT INTO useitem_log VALUES (?, ?, ?, ?, ?)')
  for (const id of ids) insert.run(1000, id, 1, 1, '/kcsapi/api_req_mission/result')
  db.close()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return { dir, file }
}
const read = (file) => {
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    return {
      version: db.prepare('PRAGMA user_version').get().user_version,
      rows: db.prepare('SELECT * FROM useitem_log ORDER BY item_id').all().map((row) => ({ ...row })),
    }
  } finally {
    db.close()
  }
}

test('V14：临时 V13 账本打开后只删除 item 4，保留 item 10 全行并升到 15', (t) => {
  const { dir, file } = seed(t)
  const expected = read(file).rows.filter((row) => row.item_id === 10)
  const logs = []
  t.mock.method(console, 'log', (message) => logs.push(message))
  openLedger(dir).close()
  assert.deepEqual(read(file), { version: 15, rows: expected })
  assert.ok(logs.includes('[kuma] mg: ledger 迁移 — V14 删除资材道具幽灵流水 1 行'))
})

test('V14：再次打开幂等；强制重跑删除无害，V13 失败仍留在 12 并可重试', (t) => {
  const { dir, file } = seed(t, [1, 2, 3, 4, 5, 10])
  const expected = { version: 15, rows: read(file).rows.filter((row) => row.item_id > 4) }
  const logs = []
  t.mock.method(console, 'log', (message) => logs.push(message))
  openLedger(dir).close()
  assert.deepEqual(read(file), expected)
  openLedger(dir).close()
  assert.deepEqual(read(file), expected)
  assert.equal(logs.filter((message) => message.includes('V14 删除')).length, 1)

  const db = new DatabaseSync(file)
  db.exec('PRAGMA user_version = 12')
  db.close()
  openLedger(dir, null).close()
  assert.deepEqual(read(file), { ...expected, version: 12 })
  openLedger(dir).close()
  assert.deepEqual(read(file), expected)
  assert.equal(logs.filter((message) => message.endsWith('V14 删除资材道具幽灵流水 0 行')).length, 2)
})
