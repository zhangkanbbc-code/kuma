// 把实时字幕的 `shipCaption` **原样切出来**真编译一遍，好让护栏对着返回值下断言。
//
// 做法照搬 test/fixtures/render-di-battle.mjs：整段从 voice-subtitle.ts 切走，
// 源码一个字不改，它引用到的外部名字在这里补桩。**不断言源码文本**——
// 查表顺序写反、闸门排错位置、补空写成覆盖，正则一条也拦不住。
//
// 四个真判据（标点体例归一 / 缺译 / 台词归一 / 占位句识别）**引真的那一份**，不补桩：
// 桩一写歪，护栏就会对着一个假的判据绿。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import assert from 'node:assert/strict'
import { build, buildSync } from 'esbuild'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const source = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'voice-subtitle.ts'), 'utf8')

const sliceBetween = (from, to, label) => {
  const start = source.indexOf(from)
  const end = source.indexOf(to, start)
  assert.ok(start >= 0 && end > start, `voice-subtitle.ts 里找不到「${label}」，这条守卫的锚点要跟着改`)
  return source.slice(start, end)
}

const BODY = sliceBetween(
  'const captionText = (value: unknown): string => {',
  'const enemySpeaker = (fallback: string): string => {',
  'captionText + mountedSeasonalText + shipCaption',
)

const abs = (...parts) => path.join(ROOT, ...parts).replace(/\\/g, '/')

const HARNESS = `
import { isUntranslatedVoiceText, normalizeVoiceText } from '${abs('src', 'shared', 'voice-text.ts')}'
import { normalizeVoiceLine } from '${abs('src', 'shared', 'voice-lineage.ts')}'
import {
  foldVoiceLineForCompare,
  isSubtitlePlaceholder,
  regularSubtitleSlots,
  isSpecialAttackVoiceSlot,
  seasonalTextIndex,
} from '${abs('src', 'shared', 'voice-scene-slots.ts')}'
import { installZhSimplifier, simplifyZh } from '${abs('src', 'renderer', 'zh-simplify.ts')}'

type VoiceRequestCue = any
type CaptionLine = any

// ---- 可注入的模块级状态（每个用例自己摆）----
export const stub: any = {
  subtitleZh: {},
  subtitleJa: {},
  wikiwikiVoice: {},
  voiceZhByJa: new Map(),
  voiceOverlayZhByJa: new Map(),
  voiceFallbackOf: new Map(),
  seasonOccupied: new Map(),
  kcwikiBySlot: new Map(),
  kumaVoiceBySlot: new Map(),
  observations: new Map(),
  seasonalShips: {},
  seasonalFoldedByForm: new Map(),
}

const subtitleZh: any = new Proxy({}, { get: (_t, k) => stub.subtitleZh[k as string] })
const subtitleJa: any = new Proxy({}, { get: (_t, k) => stub.subtitleJa[k as string] })
const wikiwikiVoice: any = new Proxy({}, { get: (_t, k) => stub.wikiwikiVoice[k as string] })
const voiceZhByJa = { get: (k: string) => stub.voiceZhByJa.get(k) }
const voiceOverlayZhByJa = { get: (k: string) => stub.voiceOverlayZhByJa.get(k) }
const voiceFallbackOf = { get: (k: number) => stub.voiceFallbackOf.get(k) }
const seasonOccupied = { get: (k: number) => stub.seasonOccupied.get(k) }
const kcwikiBySlot = { get: (k: number) => stub.kcwikiBySlot.get(k) }
const kumaVoiceBySlot = { get: (k: number) => stub.kumaVoiceBySlot.get(k) }
const voicePlaybackObservationAt = (mstId: number, slot: number) =>
  stub.observations.get(\`\${mstId}:\${slot}\`) ?? null
const seasonalShips: any = new Proxy({}, { get: (_t, k) => stub.seasonalShips[k as string] })
const seasonalFoldedByForm = { get: (k: number) => stub.seasonalFoldedByForm.get(k) }

const SUNK_VOICE_SLOT = 22
const WEDDING_VOICE_SLOT = 24
const friendlyDamageTone = (_voiceId: number, _mstId: number) => null
const masterShipName = (mstId: number) => \`舰\${mstId}\`
const entityNamePlain = (_domain: string, _id: number, fallback: string) => fallback

${BODY}

export { shipCaption, captionText, seasonalTextIndex, installZhSimplifier }
`

const bundle = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-ship-caption-'))
  const entry = path.join(dir, 'caption.ts')
  fs.writeFileSync(entry, HARNESS)
  const outfile = path.join(dir, 'caption.cjs')
  buildSync({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
  })
  return outfile
})()

const loaded = createRequire(import.meta.url)(bundle)

/** 摆好这一轮的资料，然后取一格字幕。 */
export const captionOf = (setup, mstId, voiceId) => {
  const stub = loaded.stub
  loaded.installZhSimplifier(setup.simplifierPack ?? null)
  stub.subtitleZh = setup.subtitleZh ?? {}
  stub.subtitleJa = setup.subtitleJa ?? {}
  stub.wikiwikiVoice = setup.wikiwikiVoice ?? {}
  stub.voiceZhByJa = setup.voiceZhByJa ?? new Map()
  stub.voiceOverlayZhByJa = setup.voiceOverlayZhByJa ?? new Map()
  stub.voiceFallbackOf = setup.voiceFallbackOf ?? new Map()
  stub.seasonOccupied = setup.seasonOccupied ?? new Map()
  stub.kcwikiBySlot = setup.kcwikiBySlot ?? new Map()
  stub.kumaVoiceBySlot = setup.kumaVoiceBySlot ?? new Map()
  stub.observations = setup.observations ?? new Map()
  stub.seasonalShips = setup.seasonalShips ?? {}
  // 季节文本指纹**照 loadData 那样现搭**（同一个 `seasonalTextIndex`，不是另写一份）——
  // 用例只管摆 seasonalShips，指纹怎么折叠由被测的那份判据自己说了算。
  stub.seasonalFoldedByForm =
    setup.seasonalFoldedByForm ?? loaded.seasonalTextIndex(stub.seasonalShips)
  return loaded.shipCaption({ kind: 'ship', mstId, voiceId })
}

/** 只要那一句文本；没有字幕就是空串。 */
export const textOf = (setup, mstId, voiceId) => captionOf(setup, mstId, voiceId)[0]?.text ?? ''

export const captionText = loaded.captionText

// 需要验证 loadData 的跨源合并与深海分支时，编译整个生产模块；矿脉、主数据与
// Electron 只在系统边界换成可注入桩。测试仍然只看 captionsFor 的最终返回值。
const RUNTIME_STATE_KEY = '__kumaVoiceSubtitleTestState'
const runtimeSource = (() => {
  const sizeInit =
    'setVoiceCaptionSize(config.get(VOICE_CAPTION_SIZE_PATH, VOICE_CAPTION_SIZE_DEFAULT))'
  assert.ok(source.includes(sizeInit), 'voice-subtitle.ts 的字号初始化锚点变了')
  return `${source.replace(sizeInit, '')}
export { loadData as testLoadData, captionsFor as testCaptionsFor, displayAtPlaybackTime as testDisplayAtPlaybackTime, showSubtitle as testShowSubtitle }
`
})()

const runtimeBundle = await (async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-voice-subtitle-runtime-'))
  const outfile = path.join(dir, 'voice-subtitle.cjs')
  await build({
    stdin: {
      contents: runtimeSource,
      loader: 'ts',
      resolveDir: path.join(ROOT, 'src', 'renderer'),
      sourcefile: 'voice-subtitle.ts',
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
    plugins: [{
      name: 'voice-subtitle-runtime-boundaries',
      setup(build) {
        build.onResolve({ filter: /^\.\/(?:kernel|abyssal-name|kcs-voice|localization)$/ }, (args) => ({
          path: args.path.slice(2),
          namespace: 'voice-runtime-stub',
        }))
        build.onResolve({ filter: /^(?:@electron\/remote|electron)$/ }, (args) => ({
          path: args.path,
          namespace: 'voice-runtime-stub',
        }))
        build.onLoad({ filter: /.*/, namespace: 'voice-runtime-stub' }, (args) => {
          if (args.path === 'kernel') {
            return {
              contents: `
const state = globalThis.${RUNTIME_STATE_KEY}
export const mg = state.mg
export const masterShipName = (id) => \`舰\${id}\`
export const onMgChange = () => {}
export const queryLode = async (id) => state.lodes[id] ?? null
export const queryMasterRaw = async () => state.raw
`,
              loader: 'ts',
            }
          }
          if (args.path === 'abyssal-name') {
            return { contents: 'export const canonicalAbyssalSpeakerLabel = (value) => value' }
          }
          if (args.path === 'kcs-voice') {
            return {
              contents:
                'export const resolveVoiceRequest = () => null; export const setShipGraph = () => {}',
            }
          }
          if (args.path === 'localization') {
            return {
              contents:
                "export const entityNamePlain = (_domain, _id, fallback) => fallback; export const localizedEntityId = () => ''",
            }
          }
          if (args.path === '@electron/remote') {
            return {
              contents:
                'module.exports = { require: () => ({ get: (_key, fallback) => fallback }) }',
            }
          }
          return {
            contents: `module.exports = { ipcRenderer: {
              invoke: async () => null,
              send: (...args) => globalThis.${RUNTIME_STATE_KEY}.sent.push(args),
            } }`,
          }
        })
      },
    }],
  })
  return outfile
})()

const runtimeState = {
  sent: [],
  lodes: {},
  raw: null,
  mg: {
    decks: [],
    ships: {},
    master: { ships: {} },
    sortie: null,
  },
}
globalThis[RUNTIME_STATE_KEY] = runtimeState
const runtimeLoaded = createRequire(import.meta.url)(runtimeBundle)
export const captionRuntime = runtimeLoaded
export const captionMessages = () => runtimeState.sent

const emptyRuntimeLodes = () => ({
  'subtitle-zh': { data: {} },
  'subtitle-ja': { data: {} },
  'subtitle-npc': { data: {} },
  'subtitle-enemies': { data: {} },
  'wikiwiki-voice': { data: {} },
  'wikiwiki-abyss-voice': { data: {} },
  'kuma-abyss-voice': { data: { ships: {} } },
  'kcwiki-seasonal-voice': { data: { ships: {}, skits: {} } },
  'kcwiki-voice': { data: {} },
  'kcwiki-ships': null,
  'kuma-voice': { data: { ships: {} } },
  'kuma-voice-zh': null,
  'opencc-t2s': null,
})

/** 真跑 loadData 后，按 cue 取最终字幕；只在查询边界摆测试资料。 */
export const captionsFromLodes = async ({ lodes = {}, ships = [], mg = {} }, cue) => {
  runtimeState.lodes = { ...emptyRuntimeLodes(), ...lodes }
  runtimeState.raw = {
    data: {
      api_mst_shipgraph: [],
      api_mst_ship: ships,
      api_mst_shipupgrade: [],
    },
  }
  for (const key of Object.keys(runtimeState.mg)) delete runtimeState.mg[key]
  Object.assign(runtimeState.mg, {
    decks: [],
    ships: {},
    master: { ships: {} },
    sortie: null,
    ...mg,
  })
  await runtimeLoaded.testLoadData()
  return runtimeLoaded.testCaptionsFor(cue)
}
