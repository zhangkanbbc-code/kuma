// 离线工具共用的引擎装配：把 src/main/mg/quest-counter.ts 原样跑起来，不做复刻。
//
// 「拿另写一份解析器去对账」是自欺——对上的是那份复刻，不是线上跑的东西。
// 引擎重构（2026-08-21）之后它已经不认识 Electron，esbuild 打一下就能在纯 Node 里 require。
// 归约器（store.ts）要的只是账本那几个记账方法，全部换成空实现即可。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

import { userDataDir } from './data-dir.mjs'
import { applyQuestTextCorrectionsToPack } from '../../src/shared/quest-text-corrections.ts'

export const ROOT = path.join(fileURLToPath(import.meta.url), '..', '..', '..')
export const APPDATA = userDataDir()

const require = createRequire(import.meta.url)
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-quest-offline-'))

process.on('exit', () => {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true })
  } catch (e) {
    // 临时目录清不掉不影响结论，但别静默：留一行说明它还在哪
    console.warn(`[quest-offline] 临时目录未清理：${tempDir}`, e?.message ?? e)
  }
})

const bundle = async (entry, name, stubs = {}) => {
  const outfile = path.join(tempDir, `${name}.cjs`)
  await build({
    entryPoints: [path.join(ROOT, entry)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
    plugins: Object.keys(stubs).length
      ? [{
          name: 'offline-stubs',
          setup(b) {
            for (const spec of Object.keys(stubs)) {
              b.onResolve(
                { filter: new RegExp(`^${spec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) },
                () => ({ path: spec, namespace: 'offline-stubs' }),
              )
            }
            b.onLoad(
              { filter: /.*/, namespace: 'offline-stubs' },
              ({ path: spec }) => ({ contents: stubs[spec], loader: 'js' }),
            )
          },
        }]
      : [],
  })
  return require(outfile)
}

/** 线上那台引擎的工厂，一个字没改。 */
export const loadQuestEngine = () =>
  bundle('src/main/mg/quest-counter.ts', 'quest-counter')

/** v13 迁移与维护者脚本共用的敌空母击沉任务回放核。 */
export const loadQuestSinkReplay = () =>
  bundle('src/main/mg/quest-sink-replay.ts', 'quest-sink-replay')

/** 线上那套归约器：回放要靠它把 sortie/编成/库存还原成事件发生当时的样子。 */
export const loadStore = () =>
  bundle('src/main/mg/store.ts', 'store', {
    // 账本在归约里只做记账（useitem 流水、活动图目录、氪金流水），回放不写盘
    './ledger': `
      const noop = () => {}
      export default new Proxy({}, { get: () => noop })
    `,
    // 深海开幕语音台账：归约在战斗结算里顺手记一笔，而它**真的会写盘**
    //（%APPDATA%/kanso/abyss-voice-sightings.json，2 秒防抖）。回放要跑几万条
    // 战斗报文，不掐掉就会把用户的亲历台账按「回放当时」重写一遍，还会跟正在
    // 运行的应用抢同一个文件——「只读账本」这条纪律不是只管 sqlite。
    // 顺带：它 import 的 ./env 会 `import { app } from 'electron'`，纯 Node 里
    // 一 require 就去下载 Electron 二进制然后炸（2026-08-27 实测），
    // 掐掉这一个 spec 同时解决落盘与 electron 两件事。
    '../abyss-voice-sightings': `
      export const recordAbyssVoiceSightings = () => {}
      export const recordAbyssVoiceArchaeology = () => null
      export const queryAbyssVoiceSightings = () => []
      export const flushAbyssVoiceSightings = () => {}
    `,
  })

/** 点位校准表 + poi-fcd 边号推导。 */
export const loadMapNodes = () =>
  bundle('src/main/mg/quest-map-nodes.ts', 'quest-map-nodes')

/**
 * 矿脉包读取，与 src/main/lode.ts 同一层优先级：
 * 用户包（%APPDATA%/kanso/lodes）覆盖内置包（assets/lodes）。
 */
export const loadLode = (id) => {
  for (const dir of [path.join(APPDATA, 'lodes'), path.join(ROOT, 'assets', 'lodes')]) {
    const file = path.join(dir, `${id}.json`)
    if (!fs.existsSync(file)) continue
    // 与 src/main/lode.ts 同款：第一方校正台账在装载口叠一层。
    // 不叠的话自推导对账会拿「线上显示的文本」去比「未校正的解析输入」，diff 全是假的。
    return applyQuestTextCorrectionsToPack(JSON.parse(fs.readFileSync(file, 'utf8')))
  }
  return null
}

export const loadLodes = (ids) => {
  const packs = {}
  for (const id of ids) packs[id] = loadLode(id)
  return packs
}

export const QUEST_LODE_IDS = [
  'quests-scn',
  'kcwiki-localization',
  'kcwiki-quest-req',
  'poi-quest-goal',
  'kcwiki-expedition',
  'poi-fcd-map',
]

/** 游戏一手主数据。快照是 SNAPSHOT_ONLY_PATHS 那批，account 的 body 只留最新一份。 */
export const loadMasterSnapshot = () => {
  const file = path.join(APPDATA, 'snapshots', 'kcsapi_api_start2_getData.json')
  if (!fs.existsSync(file)) return null
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

export const masterRawOf = (snapshot) =>
  snapshot ? snapshot.body?.api_data ?? snapshot.body ?? null : null

/**
 * 离线宿主：矿脉与主数据由调用方给定，账本只读进度用内存代替，广播丢弃。
 * 调用方在 `lodes` 里显式写 null 的 id 会被当成「这个包不存在」——
 * 降级对账靠它临时抽掉某个上游包，看剩下的链路单独跑出什么。
 */
export const offlineHost = ({ lodes, snapshot, state, onSend, progress }) => ({
  getLode: (id) => lodes[id] ?? null,
  ledger: {
    loadSnapshot: () => snapshot ?? undefined,
    loadQuestProgress: () => progress ?? {},
    saveQuestProgress: () => {},
    deleteQuestProgress: () => {},
  },
  store: { getState: () => state() },
  send: (channel, payload) => onSend?.(channel, payload),
})

/** 引擎装载时会打一串就绪日志；对账脚本自己有报表，压掉噪音。 */
export const quiet = (fn) => {
  const log = console.log
  const warn = console.warn
  console.log = () => {}
  console.warn = () => {}
  try {
    return fn()
  } finally {
    console.log = log
    console.warn = warn
  }
}

export const openLedgerDb = () => {
  const { DatabaseSync } = require('node:sqlite')
  const file = path.join(APPDATA, 'mg.sqlite')
  if (!fs.existsSync(file)) return null
  // 只读打开：回放绝不写用户的账本（WAL 模式下应用开着也能读，实测通过）
  return new DatabaseSync(file, { readOnly: true })
}
