import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import mapId from '../dist/shared/map-id.js'
import domain from '../dist/shared/kcs-domain.js'

const { mapIdOf, mapAreaOf, mapNoOf, mapCodeOf, isEventMapArea } = mapId
const { isAbyssMstId, SUBMARINE_STYPES, CARRIER_STYPES, BATTLESHIP_STYPES } = domain

const srcFiles = (() => {
  const out = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.ts')) out.push(full.split(path.sep).join('/'))
    }
  }
  walk(fileURLToPath(new URL('../src', import.meta.url)))
  return out
})()
const read = (f) => fs.readFileSync(f, 'utf8')

test('map ids round-trip, including event areas whose区号 exceeds one digit', () => {
  assert.equal(mapIdOf(2, 5), 25)
  assert.equal(mapCodeOf(25), '2-5')
  // 活动区号会一路往上加，解码不能假设 mapId 是两位数
  assert.equal(mapIdOf(46, 1), 461)
  assert.equal(mapAreaOf(461), 46)
  assert.equal(mapNoOf(461), 1)
  assert.equal(mapCodeOf(461), '46-1')
  assert.equal(isEventMapArea(7), false)
  assert.equal(isEventMapArea(46), true)
})

test('the map id convention lives in one place instead of being retyped per file', () => {
  // 原先编码 22 处、解码 14 处散落 6 个文件，新写的模块也会照着再实现一遍。
  const offenders = srcFiles.filter(
    (f) => !f.endsWith('shared/map-id.ts') && /\$\{Math\.floor\(\w[\w.]* \/ 10\)\}-\$\{/.test(read(f)),
  )
  assert.deepEqual(offenders, [], '这些文件还在手写海域编号解码')
})

test('abyss ids and ship-type groups have a single definition', () => {
  assert.equal(isAbyssMstId(1500), true)
  assert.equal(isAbyssMstId(1499), false)
  assert.deepEqual([...SUBMARINE_STYPES].sort((a, b) => a - b), [13, 14])
  assert.deepEqual([...CARRIER_STYPES].sort((a, b) => a - b), [7, 11, 18])
  assert.deepEqual([...BATTLESHIP_STYPES].sort((a, b) => a - b), [8, 9, 10, 12])
  // 两处各定义一份时，给分组加新舰种只改一边 → 同一支舰队在两个面板结论不同
  const dupes = srcFiles.filter(
    (f) => !f.endsWith('shared/kcs-domain.ts') && /const (SUBMARINE|CARRIER|BATTLESHIP)_STYPES\s*=/.test(read(f)),
  )
  assert.deepEqual(dupes, [], '这些文件重复定义了舰种分组')
})

test('entity routes receive a resolved numeric id instead of converting it themselves', () => {
  const link = read(srcFiles.find((f) => f.endsWith('renderer/link.ts')))
  assert.match(link, /export interface ResolvedEntityRef extends EntityRef \{\s*\n\s*num: number/)
  assert.match(link, /open\(ref: ResolvedEntityRef\)/)
  // 原先每个 route 的 open/peek/targets 各写一遍这个三元，全仓 35 次
  const offenders = srcFiles.filter((f) =>
    /typeof ref\.id === 'string' \? parseInt\(ref\.id, 10\) : ref\.id/.test(read(f)),
  )
  assert.deepEqual(offenders, [], '这些文件还在自行转换 ref.id')
})
