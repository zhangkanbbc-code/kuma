// 只把候选包里的敌编成基础经验（exp）并进正式 map-intel 包，其余一律不动。
//
// 为什么不直接批准候选：整体重抓会连带三样东西一起变——
//   · shipIds 定号被清空（914 条）——常规图现在由汇编包 map-enemy-comps 供号，
//     补不回来的是活动图那批（定号流水线已于 2026-08-22 退役）；
//   · 上游把「（艦載機白）」改成「(艦載機白)」这类纯格式修订（36 条增删）；
//   · limited 里补上 status / statusChangedAt 字段（112 条）。
// 这些各有各的道理，但都不是「加一列经验」这件事要求的。要只让经验变化，
// 就在正式包上做加法，而不是拿整份新包去换。
//
// 用法：node scripts/merge-map-intel-exp.mjs [--dry]

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(fileURLToPath(import.meta.url), '..', '..')
const officialFile = path.join(root, 'assets', 'lodes', 'map-intel.json')
const candidateFile = path.join(root, 'assets', 'review', 'map-intel.candidate.json')
const dry = process.argv.includes('--dry')

if (!existsSync(candidateFile)) {
  throw new Error(`没有候选包：${candidateFile}\n先跑 npm run lodes:fetch -- --only=map-intel`)
}

const official = JSON.parse(readFileSync(officialFile, 'utf8'))
const candidate = JSON.parse(readFileSync(candidateFile, 'utf8'))

// 上游会在全角/半角括号之间反复横跳，那不是编成变化。归一化后再配对，
// 免得因为一个括号就漏掉这条的经验。
const normalizeName = (name) =>
  `${name ?? ''}`
    .replace(/[（）]/g, (char) => (char === '（' ? '(' : ')'))
    .replace(/\s+/g, '')
    .trim()

const compKey = (ships) => (ships ?? []).map(normalizeName).join('|')

const layersOf = (map) =>
  map?.nodes
    ? [['常规', map.nodes]]
    : Object.entries(map?.difficulties ?? {}).map(([difficulty, layer]) => [difficulty, layer.nodes])

// 候选包：(图, 难度, 点, 编成) → exp
const expIndex = new Map()
for (const [code, map] of Object.entries(candidate?.data?.maps ?? {})) {
  for (const [difficulty, nodes] of layersOf(map)) {
    for (const [node, value] of Object.entries(nodes ?? {})) {
      for (const comp of value?.enemyComps ?? []) {
        if (!Number.isInteger(comp?.exp) || comp.exp <= 0) continue
        expIndex.set(`${code}##${difficulty}##${node}##${compKey(comp.ships)}`, comp.exp)
      }
    }
  }
}

let matched = 0
let missed = 0
let overwritten = 0
const missedSamples = []
for (const [code, map] of Object.entries(official?.data?.maps ?? {})) {
  for (const [difficulty, nodes] of layersOf(map)) {
    for (const [node, value] of Object.entries(nodes ?? {})) {
      for (const comp of value?.enemyComps ?? []) {
        const key = `${code}##${difficulty}##${node}##${compKey(comp.ships)}`
        const exp = expIndex.get(key)
        if (exp === undefined) {
          missed += 1
          if (missedSamples.length < 5) missedSamples.push(`${code} ${difficulty} ${node}`)
          continue
        }
        if (comp.exp === exp) continue
        if (comp.exp !== undefined) overwritten += 1
        comp.exp = exp
        matched += 1
      }
    }
  }
}

console.log(`候选包提供经验的编成：${expIndex.size} 条`)
console.log(`正式包写入经验：${matched} 条（其中覆盖旧值 ${overwritten} 条）`)
console.log(`正式包里配不到经验的编成：${missed} 条`)
if (missedSamples.length) console.log(`  未配到样本：${missedSamples.join('、')} …`)

if (dry) {
  console.log('（--dry：没有写入）')
} else {
  // meta 只动 fetchedAt 与一条说明，version/source/upstreamUpdatedAt 保持不变——
  // 这不是一次重新抓取，正式包的事实基准还是原来那份。
  official.meta = {
    ...official.meta,
    expMergedAt: new Date().toISOString(),
    expSource: candidate?.meta?.sourceUrl ?? candidate?.meta?.source ?? null,
  }
  writeFileSync(officialFile, JSON.stringify(official))
  console.log(`已写入 ${officialFile}`)
}
