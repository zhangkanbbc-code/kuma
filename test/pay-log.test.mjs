// 本机氪金记录的报文解析（shared/pay-log）：
// 清单解析、前后相减出购买、首观测不造记录、认不出的包不动基线、消耗效果摘取。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { buildSync } from 'esbuild'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-pay-log-'))
const output = path.join(tempDir, 'pay-log.cjs')
buildSync({
  entryPoints: [fileURLToPath(new URL('../src/shared/pay-log.ts', import.meta.url))],
  outfile: output,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  logLevel: 'silent',
})
const { parsePayitemList, diffPayitemStocks, payitemUseEffect } = createRequire(import.meta.url)(output)

test('payitem list parses string ids and keeps prices; explicit null means empty holdings', () => {
  // 实测原文形状：api_payitem_id 是字符串，count 是数字
  const stocks = parsePayitemList([
    { api_payitem_id: '16', api_name: '母港拡張', api_price: 1000, api_count: 3 },
    { api_payitem_id: '2', api_name: '応急修理女神', api_price: 0, api_count: 1 },
    { api_payitem_id: '0', api_name: '坏行', api_price: 5, api_count: 9 },
    { api_payitem_id: '7', api_name: '空计数', api_price: 5, api_count: 0 },
  ])
  assert.deepEqual(stocks[16], { count: 3, name: '母港拡張', price: 1000 })
  assert.deepEqual(stocks[2], { count: 1, name: '応急修理女神', price: null })
  assert.equal(Object.keys(stocks).length, 2, 'id<=0 与 count<=0 的行不入库')

  // 一件都没有：api_data 显式 null（mg/index 的 ?? 把包装对象整个传进来）
  assert.deepEqual(parsePayitemList({ api_result: 1, api_result_msg: '成功', api_data: null }), {})
  assert.deepEqual(parsePayitemList(null), {})
  // 认不出的形状返回 null：把它当空清单会在下一份真清单时造出假购买
  assert.equal(parsePayitemList({ some: 'garbage' }), null)
  assert.equal(parsePayitemList(42), null)
})

test('stock diff records only increases and never invents history on first observation', () => {
  const prev = { 16: { count: 1, name: '母港拡張', price: 1000 }, 3: { count: 2, name: '甲', price: 700 } }
  const next = { 16: { count: 3, name: '母港拡張', price: 1000 }, 5: { count: 1, name: '乙', price: 500 } }
  const purchases = diffPayitemStocks(prev, next)
  // 数字键按升序遍历，顺序无语义
  assert.deepEqual(purchases, [
    { itemId: 5, name: '乙', count: 1, price: 500 },
    { itemId: 16, name: '母港拡張', count: 2, price: 1000 },
  ])
  // 减少（id 3 消失）不算购买——那是 payitemuse 的账
  assert.ok(!purchases.some((p) => p.itemId === 3))
  // 首次观测（prev=null）：现存持有不知何时买的，不造记录
  assert.deepEqual(diffPayitemStocks(null, next), [])
})

test('payitemuse effect keeps business fields and drops flags', () => {
  // 实测原文：母港拡張的消耗回包
  const detail = payitemUseEffect({ api_caution_flag: 0, api_flag: 1, api_max_chara: 470, api_max_slotitem: 2183 })
  assert.deepEqual(JSON.parse(detail), { api_max_chara: 470, api_max_slotitem: 2183 })
  assert.equal(payitemUseEffect({ api_caution_flag: 0, api_flag: 1 }), null)
  assert.equal(payitemUseEffect(null), null)
})
