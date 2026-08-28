// 语音档案 → 「(形态, 槽位, 所称文本, 盘上实物)」的归拢层。**只读，不碰网络。**
//
// 档案索引里 `mstId` / `voiceId` 一律是 0：入档走的是 voice-probe 的
// `keepVoiceBlob({ pathname, version, bytes })`，那条路径根本没有归属参数
//（2026-08-23 查实：22 条全是 0）。所以归属**从 pathname 反解**，
// 判据与 shared/voice-sound-path 的文件头同源：
//   目录 = 'kc' + api_mst_shipgraph.api_filename
//   编号 = lineNum ≤53 时 `(mstId+7)*17*VOICE_KEYS[lineNum-1] % 99173 + 100000`，54 起裸编号
// 反解是**枚举**：拿该目录对应的 mstId 去正推 1..53，撞上哪个就是哪个槽。
// 目录名可能对应多个 mstId（同一张立绘的几个改装阶段共用 api_filename），
// 所以先按目录取候选集，再逐个正推——正推撞得上的那个才是真的。
//
// 所称文本取 subtitle-ja：它是**按槽位号直接索引**的（`data[mstId][slot]`），
// 不必先过 kcwiki 的场景 token 表，也就没有 token 认不出那一类漏。
// kcwiki-voice 作为补充源，用来给报告带上「场合」中文名。
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { userDataPath } from './data-dir.mjs'
import { loadStart2MasterArray } from './start2.mjs'

/** poi-plugin-subtitle 的 VOICE_KEYS（53 项，MIT）。与 renderer/kcs-voice.ts 同一份。 */
const VOICE_KEYS = [
  2475, 6547, 1471, 8691, 7847, 3595, 1767, 3311, 2507, 9651, 5321, 4473, 7117, 5947, 9489, 2669,
  8741, 6149, 1301, 7297, 2975, 6413, 8391, 9705, 2243, 2091, 4231, 3107, 9499, 4205, 6013, 3393,
  6401, 6985, 3683, 9447, 3287, 5181, 7587, 9353, 2135, 4947, 5405, 5223, 9457, 5767, 9265, 8191,
  3927, 3061, 2805, 3273, 7331,
]

const OBFUSCATED_FROM = 100_000

/** 槽位 → 场景中文名。与 shared/voice-scene-slots.ts 的表同源（那边是 token→槽位）。 */
export const SLOT_SCENES = {
  1: '入手/登入时', 2: '秘书舰1', 3: '秘书舰2', 4: '秘书舰3', 5: '建造完成',
  6: '修复完成', 7: '归来', 8: '战绩', 9: '装备/改修/改造1', 10: '装备/改修/改造2',
  11: '小破入渠', 12: '中破入渠', 13: '编成', 14: '出征', 15: '战斗开始',
  16: '攻击1', 17: '攻击2', 18: '夜战', 19: '小破1', 20: '小破2',
  21: '中破', 22: '击沉', 23: 'MVP', 24: '结婚', 25: '图鉴介绍',
  26: '装备', 27: '补给', 28: '秘书舰（婚后）', 29: '放置',
}

/** 无 mstId 归属的三个音轨目录（与 shared/voice-sound-path 的 EXTRA_VOICE_DIRS 同源）。 */
export const EXTRA_VOICE_DIRS = { 9997: 'skit', 9998: 'enemy', 9999: 'npc' }

export const voiceArchiveDir = () =>
  process.env.KANSO_VOICE_ARCHIVE || userDataPath('voice-archive')

/** `/kcs/sound/kcXXXX/123456.mp3` → { dir, encoded }。 */
export const parseVoicePathname = (pathname) => {
  const matched = /\/kcs\/sound\/kc([^/]+)\/([^/]+)\.mp3$/i.exec(`${pathname ?? ''}`)
  return matched ? { dir: matched[1], encoded: matched[2] } : null
}

/** api_filename → [mstId…]（同一张立绘可能对应多个改装阶段）。 */
const buildGraphIndex = (root) => {
  const graph = loadStart2MasterArray('api_mst_shipgraph', root)
  const byFilename = new Map()
  for (const row of graph) {
    const id = Number(row?.api_id)
    const filename = `${row?.api_filename ?? ''}`
    if (!(id > 0) || !filename) continue
    byFilename.set(filename, [...(byFilename.get(filename) ?? []), id])
  }
  return byFilename
}

/**
 * 反解归属：目录 + 编号 → { mstId, slot }。解不出返回 null。
 *
 * 裸编号（<100000）不必枚举，它本身就是槽位号；但**候选 mstId 仍可能不止一个**，
 * 这种情况下取第一个并标 `ambiguous`——调用方据此决定要不要用。
 */
export const attributeVoice = (dir, encoded, byFilename) => {
  const ids = byFilename.get(dir) ?? []
  const num = Number(encoded)
  if (!Number.isInteger(num)) return null
  if (EXTRA_VOICE_DIRS[dir]) return { mstId: 0, slot: num, kind: EXTRA_VOICE_DIRS[dir] }
  if (!ids.length) return null
  if (num < OBFUSCATED_FROM) {
    return { mstId: ids[0], slot: num, kind: 'ship', ambiguous: ids.length > 1 }
  }
  for (const mstId of ids) {
    for (let slot = 1; slot <= VOICE_KEYS.length; slot++) {
      if (((mstId + 7) * 17 * VOICE_KEYS[slot - 1]) % 99173 + OBFUSCATED_FROM === num) {
        return { mstId, slot, kind: 'ship' }
      }
    }
  }
  return null
}

/** 读不到就当没有：矿脉包与档案索引都可能**合法地不存在**（没抓过 / 没入过档），
 *  调用方自己判 null 决定是降级还是报错。这里不该把「文件还没生成」变成异常。 */
const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/**
 * 盘上实物的真实路径。索引里存的是**游戏侧 pathname**，落盘时文件名带了 sha1 尾巴
 *（`175857.90f608ce58e667ac.mp3`），所以按 `目录/编号.*.mp3` 去找。
 */
const localFileOf = (rootDir, dir, encoded, sha1) => {
  if (!rootDir) return null
  const candidate = path.join(rootDir, 'sound', `kc${dir}`, `${encoded}.${sha1}.mp3`)
  return existsSync(candidate) ? candidate : null
}

/**
 * 把档案索引摊成对账行。
 *
 * @returns 每行 { pathname, mstId, shipName, slot, scene, claimedJa, claimedZh, file, bytes, heard }
 *          `file` 为 null 表示索引有记录但盘上没实物（不该发生，发生了就是档案被外部动过）。
 *          `claimedJa` 为 null 表示这一格**没有所称文本**——那是 ② 草稿转写的料，不是 ① 对账的料。
 */
export const loadArchiveRows = ({ root = null, archiveDir = voiceArchiveDir() } = {}) => {
  const index = readJson(path.join(archiveDir, 'index.json'))
  const entries = Array.isArray(index?.entries) ? index.entries : []
  const byFilename = buildGraphIndex(root)
  const ships = loadStart2MasterArray('api_mst_ship', root)
  const nameOf = new Map(ships.map((s) => [Number(s?.api_id), `${s?.api_name ?? ''}`]))

  const lodeDir = root ? path.join(root, 'assets', 'lodes') : null
  const subtitleJa = lodeDir ? readJson(path.join(lodeDir, 'subtitle-ja.json'))?.data ?? {} : {}
  const subtitleZh = lodeDir ? readJson(path.join(lodeDir, 'subtitle-zh.json'))?.data ?? {} : {}

  const rows = []
  for (const entry of entries) {
    const parsed = parseVoicePathname(entry?.pathname)
    if (!parsed) continue
    const attributed = attributeVoice(parsed.dir, parsed.encoded, byFilename)
    const file = localFileOf(archiveDir, parsed.dir, parsed.encoded, `${entry?.sha1 ?? ''}`)
    const bytes = Number(entry?.bytes) || 0
    const mstId = attributed?.mstId ?? 0
    const slot = attributed?.slot ?? null
    const claimedJa = mstId && slot ? (subtitleJa[String(mstId)] ?? {})[String(slot)] ?? null : null
    const claimedZh = mstId && slot ? (subtitleZh[String(mstId)] ?? {})[String(slot)] ?? null : null
    rows.push({
      pathname: `${entry?.pathname ?? ''}`,
      mstId,
      shipName: mstId ? nameOf.get(mstId) ?? '' : '',
      slot,
      scene: slot ? SLOT_SCENES[slot] ?? `槽位 ${slot}` : '',
      kind: attributed?.kind ?? 'unknown',
      ambiguous: Boolean(attributed?.ambiguous),
      claimedJa: claimedJa ? `${claimedJa}`.trim() : null,
      claimedZh: claimedZh ? `${claimedZh}`.trim() : null,
      file,
      // 盘上实物的真实字节数优先：索引里的 bytes 是入档当时记的，
      // 档案被外部动过时两者会不一致，而计费按实物走
      bytes: file ? statSync(file).size : bytes,
      heard: Number(entry?.heard) || 0,
    })
  }
  return rows
}

/**
 * 该形态的**专名表**（喂给 ASR 做 context 偏置，也当纠偏的词表）。
 *
 * 只收**这一艘自己的身份词**：舰名各形态 + 舰种名。两条边界都是实测踩出来的。
 *
 * ---- ① 不放通用词（提督/艦娘/司令官…）----
 * 2026-08-23 秋津洲 1 号槽实测：偏置里带上「提督」之后，模型把原本转对的
 * 「この大艇ちゃん」写成「この大提督ちゃん」——通用词本来就是 ASR 最不会错的一类，
 * 放进偏置毫无收益，却给了模型一个把邻近音节往它身上拉的理由。**净负作用**。
 *
 * ---- ② 不放所称文本（对账场景下那是作弊）----
 * 拿「所称日文」去偏置，再回头拿转写跟它算相似度，是让模型照着答案抄一遍：
 * 分数必然虚高，而对账的全部意义就是让分歧显形。所以 ① 对账只用身份词——
 * 「这一条是谁在说」是从 pathname 反解出来的**独立事实**，不是从待验文本来的。
 * ②③ 草稿转写没有所称文本可抄，届时可以放宽（装备名/术语），另行标定。
 */
export const biasTermsOf = (mstId, { root = null } = {}) => {
  const terms = []
  if (!mstId) return terms
  const ships = loadStart2MasterArray('api_mst_ship', root)
  const stypes = loadStart2MasterArray('api_mst_stype', root)
  const stypeName = new Map(stypes.map((s) => [Number(s?.api_id), `${s?.api_name ?? ''}`]))
  const self = ships.find((s) => Number(s?.api_id) === Number(mstId))
  if (!self) return terms
  const base = `${self.api_name ?? ''}`
  if (base) terms.push(base)
  // 读み（api_yomi）：主数据自带的假名读音。ASR 的假名骨架本来就准，
  // 给上读音等于把「这串音对应哪个专名」直接告诉它。选型试验的 C1 档用的就是这一组
  if (self.api_yomi) terms.push(`${self.api_yomi}`)
  // 改装前后同族的名字一并给：台词里自称常用未改装名（「那珂ちゃん」而不是「那珂改二」）
  const stripped = base.replace(/改.*$/u, '')
  if (stripped && stripped !== base) terms.push(stripped)
  const type = stypeName.get(Number(self.api_stype))
  if (type) terms.push(type)
  return [...new Set(terms.filter(Boolean))]
}
