// 语音音轨 URL 的纯层：目录名、编号、「这个编号是不是裸编号」，以及**编号 → 文件名**。
//
// 拆出来是为了**护栏能真跑一遍**：renderer/kcs-voice.ts 顶上就 require 了
// `@electron/remote`，脱开 Electron 连 import 都做不到，而下面这些判据
// 写宽了会把混淆编号误当裸编号（于是给一艘舰安上一句根本不属于她的台词）、
// 或者把裸编号槽位算成 null（于是玩家真听过的那一句在图鉴里永远不存在）。
//
// 文件名混淆算法与 VOICE_KEYS 取自 poi-plugin-subtitle
// (https://github.com/kcwikizh/poi-plugin-subtitle, MIT License)
//   lib/util.es:   encodeSoundFilename = (shipId, voiceId) =>
//                    (shipId + 7) * 17 * VOICE_KEYS[voiceId - 1] % 99173 + 100000
//   lib/constant.es: VOICE_KEYS（53 项）
import { isSpecialVoiceSlot } from './voice-scene-slots'

/** 无 mstId 归属的三个音轨目录。 */
export const EXTRA_VOICE_DIRS: Record<'skit' | 'enemy' | 'npc', string> = {
  skit: '9997', // 短剧/群像（多位舰娘同台的一段演出，如西村舰队出击前的对白）
  enemy: '9998', // 深海战斗音轨
  npc: '9999', // 大淀、明石等 NPC
}

/**
 * 混淆编号的下界。
 *
 * `encodeVoiceFile` 的值域是 `100000 + x % 99173`，所以混淆编号一定落在
 * [100000, 199172]；**小于它的整数都是裸编号**。
 *
 * 一手依据是 KC3Kai `src/library/modules/Meta.js` 的 `getFilenameByVoiceLine`：
 *   `lineNum <= 53 ? 100000 + 17*(ship_id+7)*diffs[lineNum-1] % 99173 : lineNum`
 * ——**编号 ≤53 才混淆，54 起一律裸编号直出**。
 * 此前 kanso 只认 `0 / 141 / 241` 三个裸编号，那是 poi-plugin-subtitle 的局限
 *（它 `getVoiceMap()` 里只写了 141/241，注释还标着 HACK），不是游戏的局限；
 * 于是本机台账里 Richelieu改 与 大和改二重 的 `900.mp3` 被记成「认不出」16+7 次。
 *
 * 已知裸编号族（KC3Kai `Translation.js` 的 `_descToId` 与 GotoBrowser 的
 * `quotes_label.json` 双源一致）：
 *   129 放置②（好感/士气 ≥50）；141~161 / 241~261 / 342~350 友军舰队（末两位是海域）；
 *   900 特殊攻击（SpCutin），901~903 按二番舰分支，990~993 金刚型夜战僚舰分支；
 *   917 / 918 Graf Zeppelin 系专用夜战。
 * 这里**不写名单**——名单会随游戏更新过期，而值域判据不会。
 * ⚠️ 但**展示侧**（主动摆行/主动探测）反过来：那边只认写死的名单，
 * 见 shared/voice-scene-slots 的 SPECIAL_VOICE_SLOTS 与 `encodeVoiceFile` 的头注。
 */
export const OBFUSCATED_VOICE_FROM = 100_000

/** 该编号是不是裸编号（直接就是 voiceId）。不是就返回 null。 */
export const directVoiceIdOf = (encoded: string): number | null => {
  if (!/^\d{1,6}$/.test(`${encoded ?? ''}`)) return null
  const value = Number(encoded)
  return value < OBFUSCATED_VOICE_FROM ? value : null
}

export interface VoiceSoundPath {
  /** `kc` 之后那一段：舰娘是 api_filename，额外音轨是 9997/9998/9999 */
  dir: string
  /** 文件名主体（混淆编号或裸编号） */
  encoded: string
}

/** poi-plugin-subtitle 的 VOICE_KEYS（53 项，MIT）。混淆段的槽位空间由它的长度定义。 */
export const VOICE_KEYS = [
  2475, 6547, 1471, 8691, 7847, 3595, 1767, 3311, 2507, 9651, 5321, 4473, 7117, 5947, 9489, 2669,
  8741, 6149, 1301, 7297, 2975, 6413, 8391, 9705, 2243, 2091, 4231, 3107, 9499, 4205, 6013, 3393,
  6401, 6985, 3683, 9447, 3287, 5181, 7587, 9353, 2135, 4947, 5405, 5223, 9457, 5767, 9265, 8191,
  3927, 3061, 2805, 3273, 7331,
]

/**
 * 语音编号 → 文件名主体。**两段值域，两套算法**：
 *  · 1..53 走混淆（上面那条 MIT 算法）；
 *  · 54 起**裸编号直出**——文件名就是编号本身。
 *
 * 一手依据是 KC3Kai `src/library/modules/Meta.js` 的 `getFilenameByVoiceLine`：
 *   `lineNum <= 53 ? 100000 + 17*(ship_id+7)*diffs[lineNum-1] % 99173 : lineNum`
 *
 * 裸编号这一段**只认 shared/voice-scene-slots 的 SPECIAL_VOICE_SLOTS 那张显式表**，不按值域放行：
 * 这是「主动摆一行、主动去探一格」的路径，判宽了就是拿着 54..899 里几百个
 * 根本不存在的编号去骚扰游戏服务器。上面 `directVoiceIdOf` 的值域判据是**拦截侧**
 * 的（只是认出游戏自己请求了什么），两者不是一回事，别合并。
 */
export const encodeVoiceFile = (mstId: number, voiceId: number): string | null => {
  if (!(mstId > 0)) return null
  if (isSpecialVoiceSlot(voiceId)) return `${voiceId}`
  const key = VOICE_KEYS[voiceId - 1]
  if (key === undefined) return null
  return `${(((mstId + 7) * 17 * key) % 99173) + 100000}`
}

/** 这个编号能不能算出地址：混淆段 1..53，或**表里**的裸编号槽位。 */
export const isPlayableVoiceId = (voiceId: number): boolean =>
  (Number.isInteger(voiceId) && voiceId >= 1 && voiceId <= VOICE_KEYS.length) ||
  isSpecialVoiceSlot(voiceId)

/**
 * （音轨目录名, 形态, 槽位）→ 音轨路径。**它是档案里的身份**——
 * 取音轨、判点亮、入档三处必须用同一份推导，各写一份必然漂移，
 * 而漂移的表现是「播得出来却不点亮」，不报错。
 *
 * @param filename `api_mst_shipgraph[].api_filename`（不含 `kc` 前缀）
 */
export const voiceSoundPathname = (
  filename: string | null,
  mstId: number,
  voiceId: number,
): string | null => {
  if (!filename || !isPlayableVoiceId(voiceId)) return null
  const code = encodeVoiceFile(mstId, voiceId)
  return code ? `/kcs/sound/kc${filename}/${code}.mp3` : null
}

/** `/kcs/sound/kcXXXX/123456.mp3` → { dir, encoded }。不是这个形状就 null。 */
export const parseVoiceSoundPath = (rawUrl: string): VoiceSoundPath | null => {
  let pathname = `${rawUrl ?? ''}`
  try {
    pathname = new URL(pathname).pathname
  } catch (_error) {
    pathname = pathname.split(/[?#]/, 1)[0] ?? pathname
  }
  const matched = /\/kcs\/sound\/kc([^/]+)\/([^/]+)\.mp3$/i.exec(pathname)
  return matched ? { dir: matched[1], encoded: matched[2] } : null
}
