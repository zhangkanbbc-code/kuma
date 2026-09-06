// 照 render-abyss-groups 的真编译夹具：入口、页签回落和正文原样取自 ji.ts。
// 同名族查表与 suffix 场合名用真实实现；音频/档案只放内存桩，不读写玩家数据。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const source = fs.readFileSync(path.join(ROOT, 'src/renderer/modules/ji.ts'), 'utf8')
const sliceBetween = (from, to) => {
  const start = source.indexOf(from)
  const end = source.indexOf(to, start + from.length)
  assert.ok(start >= 0 && end > start, `ji.ts 夹具锚点失效：${from}`)
  return source.slice(start, end)
}
const voices = sliceBetween(
  'const abyssVoiceSourcesFor =',
  '\n// ---- 装备加成：',
)
const tabs = sliceBetween('const abyssDetailTabs =', '\nconst abyssDetailPanelHtml =')

const harness = `
import {
  abyssVoiceRowsForMst, buildAbyssVoiceSameNameForms, abyssWikiVoiceScene,
} from './src/shared/abyss-voice-file'
import { voiceSlotOfKey } from './src/shared/voice-scene-slots'
import { normalizeVoiceLine } from './src/shared/voice-lineage'

export const renderAbyssVoice = (mstId: number, setup: any = {}) => {
  const abyssState = { dtab: 'a-voice' }
  const abyssSameNameForms = buildAbyssVoiceSameNameForms(setup.forms ?? [])
  const kumaAbyssVoiceLode = setup.kuma ?? null
  const wikiwikiAbyssVoiceLode = setup.wikiwiki ?? null
  const voiceLode = setup.kcwiki ?? null
  const correctedVoiceRows = new Map(setup.corrected ?? [])
  const abyssSubtitleByMst = new Map()
  const subtitleEnemiesLode = null
  const kumaVoiceLode = null
  const seasonalVoiceLode = null
  const wikiwikiVoiceLode = null
  const subtitleZh = null
  const subtitleJa = null
  const abyssZhByJa = new Map()
  const abyssArchiveIndex = () => new Map()
  const abyssArchiveRows = () => []
  const ensureAbyssVoiceSightings = () => {}
  const abyssHeardVoiceId = () => null
  const abyssGuessBlock = () => ''
  const lodeCreditMark = () => ''
  // 行的装饰与播放器不是被测对象；保留场合和两列文字，核对正文确实拿到了那一桶。
  const voiceRow = (_id: number, _mstId: number, key: string, scene: string, ja: string, zh: string) =>
    '<div class="vo-row" data-key="' + key + '">' + scene + '|' + ja + '|' + zh + '</div>'

  ${voices}
  ${tabs}

  const ship = { api_id: mstId }
  return {
    tabs: abyssDetailTabs(ship),
    selected: settleAbyssTab(ship),
    regular: regularVoiceHtml(mstId),
    panel: voicePanelHtml(mstId),
  }
}
`

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-abyss-voice-'))
const outfile = path.join(dir, 'abyss-voice.cjs')
buildSync({
  stdin: { contents: harness, loader: 'ts', resolveDir: ROOT },
  outfile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  logLevel: 'silent',
})
export const { renderAbyssVoice } = createRequire(import.meta.url)(outfile)
