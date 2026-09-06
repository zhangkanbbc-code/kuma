import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { parseWikiwikiImprove, compareWikiwikiImprove } from '../scripts/lib/wikiwiki-improve-compare.mjs'

const table = `<h3>索敵値の上昇</h3><table><tr><th>種別</th><th>補正値</th>${Array.from({ length: 10 }, (_, i) => `<th>${i === 9 ? 'max' : `★+${i + 1}`}</th>`).join('')}</tr>
<tr><td rowspan="2">小型電探</td><td>×1</td>${Array.from({ length: 10 }, (_, i) => `<td>${(i + 1).toFixed(2)}</td>`).join('')}</tr>
<tr><td>注</td><td colspan="10">旧値ではない説明</td></tr></table>`

test('第三票解析表头星级与 rowspan；没有逐星数字结构就不给票', () => {
  const parsed = parseWikiwikiImprove(table)
  assert.equal(parsed.numericTables, 1)
  assert.equal(parsed.rows.length, 1)
  assert.equal(parsed.rows[0].values[9], '+10.00')
  assert.equal(parsed.rows[0].scope, 'smallRadar')
  assert.equal(parseWikiwikiImprove('<h3>索敵値の上昇</h3><p>1.25√★</p>').numericTables, 0)
  assert.equal(parseWikiwikiImprove(table.replace('★+2', '★+3')).numericTables, 0)
})

test('第三票只报告：三方同、本机wiki同而模块缺/不同、wiki分歧均分开，输入不写入', () => {
  const module = { 1: { item_remodel: { 索敵値: { 0: '+1.00', 2: '+8.00' } } } }
  const local = { 1: { item_remodel: { 索敵値: { 0: '+1.00', 1: '+2.00', 2: '+3.00', 3: '+8.00' } } } }
  const before = JSON.stringify({ module, local })
  const report = compareWikiwikiImprove(table, module, local, { 1: { api_type: [0, 0, 12] }, 2: { api_type: [0, 0, 13] } })
  assert.deepEqual(report.summary, { threeSame: 1, wikiLocalModuleMissing: 1, wikiLocalModuleDifferent: 1, different: 1, missingLocal: 6 })
  assert.equal(JSON.stringify({ module, local }), before)
})

test('--compare 命令只写报告，正式包与两票均逐字不动', () => {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-third-vote-'))
  const input = path.join(dir, 'module.json'), local = path.join(dir, 'local.json'), html = path.join(dir, 'wiki.html'), report = path.join(dir, 'report.json')
  const items = { 1: { item_remodel: { 火力: ['+1.00'] } } }
  fs.writeFileSync(input, JSON.stringify({ items, moduleUpdatedAt: '2026-02-24T00:00:00Z' }))
  fs.writeFileSync(local, JSON.stringify({ data: { items } }))
  fs.writeFileSync(html, table)
  const files = [path.join(root, 'assets/lodes/kcwiki-akashi-improve.json'), input, local, html]
  const before = files.map(file => fs.readFileSync(file))
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/build-akashi-improve.mjs'), '--from-file', input, '--akashi', local, '--compare', html, '--report', report], { cwd: root, encoding: 'utf8', windowsHide: true })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.parse(fs.readFileSync(report, 'utf8')).wikiwiki.numericTables, 1)
  for (const [i, file] of files.entries()) assert.deepEqual(fs.readFileSync(file), before[i])
})
