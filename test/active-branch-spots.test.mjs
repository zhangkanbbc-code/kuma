import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { buildSync } from 'esbuild'
import activeBranchSpotsModule from '../dist/shared/active-branch-spots.js'

const { ACTIVE_BRANCH_SPOTS, isBuiltInActiveBranchSpot } = activeBranchSpotsModule
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const diSource = fs.readFileSync(
  path.join(ROOT, 'src', 'renderer', 'modules', 'di.ts'),
  'utf8',
)

const branchLogic = (() => {
  const start = diSource.indexOf('let routingLode:')
  const end = diSource.indexOf('\nconst branchLabelOf', start)
  assert.ok(start >= 0 && end > start, 'di.ts 的能动分歧判据源码锚点变了')
  return diSource.slice(start, end)
})()

const sharedModule = path
  .join(ROOT, 'src', 'shared', 'active-branch-spots.ts')
  .replace(/\\/g, '/')
const harness = `
import { isBuiltInActiveBranchSpot } from '${sharedModule}'

type LodeMeta = any
let nextRoutingLode: any = null
const queryLode = async (_id: string): Promise<any> => nextRoutingLode

${branchLogic}

const classifyAcrossLoad = async (lode: any, probes: [string, string][]) => {
  nextRoutingLode = lode
  routingLode = undefined
  routingActiveBranchSpots = null
  const before = probes.map(([mapKey, letter]) => isActiveBranchSpot(mapKey, letter))
  await loadRouting()
  const after = probes.map(([mapKey, letter]) => isActiveBranchSpot(mapKey, letter))
  return { before, after }
}

export { classifyAcrossLoad }
`

const compiledHarness = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-active-branch-'))
  const entry = path.join(dir, 'active-branch.ts')
  const outfile = path.join(dir, 'active-branch.cjs')
  fs.writeFileSync(entry, harness)
  buildSync({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
  })
  return createRequire(import.meta.url)(outfile)
})()

const EXPECTED_SPOTS = [
  '4-5:A',
  '4-5:C',
  '4-5:I',
  '5-3:O',
  '5-5:F',
  '6-3:A',
  '7-4:F',
  '7-5:F',
  '7-5:H',
  '7-5:O',
]

test('能动分歧第一方事实表完整列出 10 个点位', () => {
  assert.equal(ACTIVE_BRANCH_SPOTS.size, 10)
  assert.deepEqual([...ACTIVE_BRANCH_SPOTS], EXPECTED_SPOTS)
  for (const key of EXPECTED_SPOTS) {
    const [mapKey, letter] = key.split(':')
    assert.equal(isBuiltInActiveBranchSpot(mapKey, letter), true, `${key} 没被事实表认出`)
  }
})

test('wikiwiki-routing 缺席时仍认内置点位，不把表外点当成能动分歧', async () => {
  const result = await compiledHarness.classifyAcrossLoad(null, [
    ['7-5', 'F'],
    ['1-1', 'A'],
  ])
  assert.deepEqual(result.after, [true, false])
})

test('wikiwiki-routing 在场时内置表与矿脉标记取并集，加载前不钉死缓存', async () => {
  const lode = {
    meta: { id: 'wikiwiki-routing', version: 'test' },
    data: {
      maps: {
        '9-9': {
          nodes: [
            {
              from: 'Z',
              routes: [{ conditionJp: '能動分岐' }],
            },
          ],
        },
      },
    },
  }
  const result = await compiledHarness.classifyAcrossLoad(lode, [
    ['7-5', 'F'],
    ['9-9', 'Z'],
  ])
  assert.deepEqual(result.before, [true, false])
  assert.deepEqual(result.after, [true, true])
})
