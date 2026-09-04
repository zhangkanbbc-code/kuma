import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import { buildSimplifier, simplifyChinese } from '../src/shared/zh-simplify.ts'

const tableFile = new URL('../assets/lodes/opencc-t2s.json', import.meta.url)
const tableRaw = fs.readFileSync(tableFile, 'utf8')
const table = JSON.parse(tableRaw).data

test('Reno 的繁体译文按随包 OpenCC 字词表归一为简体', () => {
  const simplify = buildSimplifier(table)
  assert.equal(
    simplify('喲～你好啊！我叫里諾。照大家說的，你就是這支艦隊的老大了？不錯嘛，有點意思。那就像我姐一樣，跟你混啦！'),
    '哟～你好啊！我叫里诺。照大家说的，你就是这支舰队的老大了？不错嘛，有点意思。那就像我姐一样，跟你混啦！',
  )
  assert.equal(
    simplify('就等你發號施令啦！開工吧，老大！'),
    '就等你发号施令啦！开工吧，老大！',
  )
})

test('简体串是不动点，不含中文的串原样返回', () => {
  const simplify = buildSimplifier(table)
  const simplified = '就等你发号施令啦！开工吧，老大！'
  assert.equal(simplify(simplified), simplified)
  assert.equal(simplify('Reno Mk.II — Open fire!'), 'Reno Mk.II — Open fire!')
})

test('词表最长匹配优先于逐字映射', () => {
  assert.equal(table.phrases['乾隆'], '乾隆')
  assert.equal(table.chars['乾'], '干')
  assert.equal(simplifyChinese('乾隆與乾燥', table), '乾隆与干燥')
})

test('第一方覆盖层处理台湾用字、著的助词用法与凭借义的藉', () => {
  const simplify = buildSimplifier(table)
  assert.equal(simplify('妳剛才幹嘛'), '你刚才干嘛')
  assert.equal(simplify('大家，跟著我！'), '大家，跟着我！')
  assert.equal(simplify('著名'), '著名')
  assert.equal(simplify('显著'), '显著')
  assert.equal(simplify('顯著'), '显著')
  assert.equal(simplify('藉此機會'), '借此机会')
  assert.equal(simplify('慰藉'), '慰藉')
  assert.equal(simplify('狼藉'), '狼藉')
})

test('表缺失时恒等', () => {
  assert.equal(simplifyChinese('艦隊已經準備好了', null), '艦隊已經準備好了')
  assert.equal(buildSimplifier(undefined)('沒有字表'), '沒有字表')
})

test('随包字表键序稳定，文件是 UTF-8/LF', () => {
  assert.equal(tableRaw.includes('\r'), false)
  for (const dictionary of [table.chars, table.phrases]) {
    const keys = Object.keys(dictionary)
    const sorted = [...keys].sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
    assert.deepEqual(keys, sorted)
  }
})
