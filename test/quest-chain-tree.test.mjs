import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { buildSync } from 'esbuild'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-quest-chain-tree-'))
const output = path.join(tempDir, 'quest-chain-tree.cjs')
buildSync({
  entryPoints: [fileURLToPath(new URL('../src/renderer/quest-chain-tree.ts', import.meta.url))],
  outfile: output,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  logLevel: 'silent',
})
const require = createRequire(import.meta.url)
const {
  buildCompleteQuestForest,
  buildQuestChainTree,
  countQuestChainDescendants,
  inferCompletedQuestCodes,
  pathCodesToQuest,
} = require(output)

test.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

const quest = (id, code, pre = []) => ({ id, code, name: code, pre })
const graph = [
  quest(1, 'A'),
  quest(2, 'B', ['A']),
  quest(3, 'C', ['A']),
  quest(4, 'D', ['B', 'C']),
  quest(5, 'E', ['D']),
]

test('quest chain tree preserves branching and converging paths on both sides', () => {
  const tree = buildQuestChainTree(graph[3], graph)
  assert.deepEqual(tree.before.branches.map((branch) => branch.entry.code), ['B', 'C'])
  assert.deepEqual(
    tree.before.branches.map((branch) => branch.children.map((child) => child.entry.code)),
    [['A'], ['A']],
  )
  assert.deepEqual(tree.after.branches.map((branch) => branch.entry.code), ['E'])
})

test('quest chain tree marks cycles instead of recursing forever', () => {
  const cycle = [quest(1, 'X', ['Y']), quest(2, 'Y', ['X'])]
  const tree = buildQuestChainTree(cycle[0], cycle)
  const repeatedCurrent = tree.before.branches[0].children[0]
  assert.equal(repeatedCurrent.entry.code, 'X')
  assert.equal(repeatedCurrent.cycle, true)
  assert.deepEqual(repeatedCurrent.children, [])
})

test('quest chain tree reports depth and node-budget truncation honestly', () => {
  const shallow = buildQuestChainTree(graph[3], graph, { maxDepth: 1 })
  assert.deepEqual(shallow.before.branches.map((branch) => branch.cutCount), [1, 1])

  const wide = [
    quest(1, 'R'),
    quest(2, 'A', ['R']),
    quest(3, 'B', ['R']),
    quest(4, 'C', ['R']),
  ]
  const bounded = buildQuestChainTree(wide[0], wide, { maxNodesPerDirection: 2 })
  assert.deepEqual(bounded.after.branches.map((branch) => branch.entry.code), ['A', 'B'])
  assert.equal(bounded.after.cutCount, 1)
})

test('quest chain tree keeps an unresolved prerequisite visible as inert data', () => {
  const current = quest(9, 'NOW', ['MISSING'])
  const tree = buildQuestChainTree(current, [current])
  assert.equal(tree.before.branches[0].entry.id, 0)
  assert.equal(tree.before.branches[0].entry.code, 'MISSING')
  assert.equal(tree.before.branches[0].entry.name, '资料未收录')
})

test('complete quest forest stores every task once and keeps extra parents as cross-links', () => {
  const complete = buildCompleteQuestForest(graph)
  const flatten = (nodes) => nodes.flatMap((node) => [node, ...flatten(node.children)])
  const nodes = flatten(complete)
  assert.deepEqual(nodes.map((node) => node.entry.code), ['A', 'B', 'D', 'E', 'C'])
  assert.equal(new Set(nodes.map((node) => node.entry.id)).size, graph.length)
  const merged = nodes.find((node) => node.entry.code === 'D')
  assert.deepEqual(merged.extraParents.map((parent) => parent.code), ['C'])
})

test('complete quest forest breaks a canonical-parent cycle without dropping tasks', () => {
  const cycle = [quest(2, 'Y', ['X']), quest(1, 'X', ['Y'])]
  const complete = buildCompleteQuestForest(cycle)
  assert.deepEqual(complete.map((node) => node.entry.code), ['X'])
  assert.deepEqual(complete[0].children.map((node) => node.entry.code), ['Y'])
  assert.deepEqual(complete[0].extraParents.map((parent) => parent.code), ['Y'])
})

test('complete quest inference follows only observed downstream prerequisites', () => {
  assert.deepEqual(
    inferCompletedQuestCodes(graph, [4]),
    new Set(['A', 'B', 'C']),
  )
  assert.deepEqual(inferCompletedQuestCodes(graph, [1]), new Set())
})

test('descendant count excludes the branch itself and includes truncated slots', () => {
  const tree = buildQuestChainTree(graph[3], graph)
  assert.equal(countQuestChainDescendants(tree.before.branches[0]), 1)
  const shallow = buildQuestChainTree(graph[3], graph, { maxDepth: 1 })
  assert.equal(countQuestChainDescendants(shallow.before.branches[0]), 1)
})

test('complete forest path to a quest follows the canonical parent spine', () => {
  const complete = buildCompleteQuestForest(graph)
  assert.deepEqual(pathCodesToQuest(complete, 5), ['A', 'B', 'D', 'E'])
  assert.deepEqual(pathCodesToQuest(complete, 3), ['A', 'C'])
  assert.deepEqual(pathCodesToQuest(complete, 99), [])
})

const questPackUrl = new URL('../assets/lodes/quests-scn.json', import.meta.url)
const hasFullQuestPack = process.env.KANSO_TEST_FORCE_SYNTHETIC !== '1'
  && fs.existsSync(questPackUrl)

test('the shipped complete quest forest contains every library task exactly once', {
  skip: !hasFullQuestPack,
}, () => {
  const pack = JSON.parse(
    fs.readFileSync(questPackUrl, 'utf8'),
  )
  const entries = Object.entries(pack.data).map(([id, raw]) => ({
    id: Number(id),
    code: raw.code,
    name: raw.name,
    pre: raw.pre ?? [],
  }))
  const flatten = (nodes) => nodes.flatMap((node) => [node, ...flatten(node.children)])
  const nodes = flatten(buildCompleteQuestForest(entries))
  assert.equal(nodes.length, entries.length)
  assert.equal(new Set(nodes.map((node) => node.entry.id)).size, entries.length)
})
