// 从 qn.ts 原样切出海域反查函数真编译；只给模块状态桩，文本判据用仓里的实现。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const source = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'modules', 'qn.ts'), 'utf8')

const sliceBetween = (from, to, label) => {
  const start = source.indexOf(from)
  const end = source.indexOf(to, start + from.length)
  assert.ok(start >= 0 && end > start, `qn.ts 里找不到「${label}」，这条守卫的锚点要跟着改`)
  return source.slice(start, end)
}

const MAP_IDS = sliceBetween('const mapIdsInText = ', '\nconst nationalityRangesInPackedText = ', 'mapIdsInText')
const FLEET_LABELS = sliceBetween(
  'const qpFleetGoalLabelText = ',
  '\nconst shipEntityHtml = ',
  'qpFleetGoalLabelText',
)
const MAP_REFS = sliceBetween('const questMapRefs = ', '\nexport const questsInvolvingMap = ', 'questMapRefs')
const INVOLVING = sliceBetween('export const questsInvolvingMap = ', '\nconst entityChipsHtml = ', 'questsInvolvingMap')

const HARNESS = `
import {
  taskEntityTextDomainAllowed,
  taskEntityMemoText,
  matchTaskEntityHits,
  simplifyTaskEntityText as simplifyJp,
} from './src/renderer/task-entity-match'

let lib = new Map()
let qp = null
let mapIds = new Set()
let mapNameIndex = []

export const setQuestMapState = (state) => {
  lib = new Map((state.quests ?? []).map((quest) => [quest.id, quest]))
  qp = state.qp ?? null
  mapIds = new Set(state.mapIds)
  mapNameIndex = state.mapNameIndex ?? []
}

${MAP_IDS}
${FLEET_LABELS}
${MAP_REFS}
${INVOLVING}

export { questMapRefs }
`

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-quest-map-refs-'))
const outfile = path.join(dir, 'quest-map-refs.cjs')
buildSync({
  stdin: {
    contents: HARNESS,
    loader: 'ts',
    resolveDir: ROOT,
    sourcefile: path.join(dir, 'quest-map-refs.ts'),
  },
  outfile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  logLevel: 'silent',
})

export const { questMapRefs, questsInvolvingMap, setQuestMapState } = createRequire(import.meta.url)(outfile)
