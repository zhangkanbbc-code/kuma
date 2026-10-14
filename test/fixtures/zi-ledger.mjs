import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import { DatabaseSync } from 'node:sqlite'
import { runtimeHost } from '../../scripts/lib/player-view-runtime.mjs'
import { cut, evaluate } from './zi-refresh-runtime.mjs'

const source = fs.readFileSync(new URL('../../src/main/mg/ledger.ts', import.meta.url), 'utf8')
const ast = ts.createSourceFile('ledger.ts', source, ts.ScriptTarget.Latest, true)
const ledgerClass = ast.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'Ledger')
const methods = ['queryFastbuildFlow', 'rankingRewardStamp', 'rankingEventStamp']
const production = methods.map(name => {
  const node = ledgerClass.members.find(node => node.name?.getText(ast) === name)
  assert.ok(node, `生产方法已移动：${name}`)
  return node.getText(ast)
}).join('\n')
const ranking = runtimeHost().load('src/shared/senka-ranking.ts')
export const makeLedger = db => evaluate(`class TestLedger {
  constructor(public db: any) {}
  ${production}
}`, { db, ...ranking }, 'return new TestLedger(db)')

export const openMaterialDb = () => {
  const db = new DatabaseSync(':memory:')
  db.exec(cut(source, 'CREATE TABLE IF NOT EXISTS material_log (', '-- 战果账：'))
  return db
}

export const fastbuildFlow = (rows, from, to) => {
  const db = openMaterialDb()
  try {
    const insert = db.prepare('INSERT INTO material_log VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    for (const row of rows) insert.run(row.ts, ...row.values)
    return makeLedger(db).queryFastbuildFlow(from, to)
  } finally { db.close() }
}
