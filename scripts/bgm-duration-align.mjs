// 维护侧工具：拿 BGM 档案里攒下的音轨实物，去认誊写源报的曲名。
//
// 判据全在 `lib/bgm-duration-join.mjs`（校准 → 双向唯一 → 撞名不判），
// 这里只负责把两边的料凑齐再把结论打出来。**它自己不改任何包**：
// 命中的号要不要收编，人看过再说。
//
// 用法：`npm run bgm:align`
//   本机侧：`%APPDATA%/kanso/bgm-archive/bgm/battle/NNN_XXXX.<sha1>.mp3`
//     ——「响过即存」攒下的实物，零网络（档案空着就如实说空着）。
//   誊写侧：zh.kcwiki 拆包BGM列表（与 kcwiki-bgm 矿脉包同源同页，一次请求）。
import fs from 'fs'
import path from 'path'

import { joinBgmByDuration } from './lib/bgm-duration-join.mjs'
import { userDataPathIfAny } from './lib/data-dir.mjs'

const ARCHIVE = userDataPathIfAny('bgm-archive', 'bgm', 'battle') ?? ''
const PAGE_URL =
  'https://zh.kcwiki.cn/index.php?title=%E6%8B%86%E5%8C%85BGM%E5%88%97%E8%A1%A8&action=raw'
const ROOT = new URL('../', import.meta.url)

// ---------------------------------------------------------------- mp3 时长
// 逐帧走帧头累加，CBR/VBR 都算得准，不引任何依赖。游戏这些曲子没有 Xing 头，
// 「按码率除文件大小」在换过码率的那几首上会偏，所以老老实实走帧。
const BITRATES_V1L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0]
const BITRATES_V2L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0]
const SAMPLE_RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] }

export const mp3DurationSeconds = (buf) => {
  let at = 0
  if (buf.length > 10 && buf.toString('latin1', 0, 3) === 'ID3') {
    const size =
      ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f)
    at = 10 + size
  }
  let seconds = 0
  let frames = 0
  while (at + 4 <= buf.length) {
    if (buf[at] !== 0xff || (buf[at + 1] & 0xe0) !== 0xe0) {
      at += 1
      continue
    }
    const version = (buf[at + 1] >> 3) & 0x3
    const layer = (buf[at + 1] >> 1) & 0x3
    const bitrateIndex = (buf[at + 2] >> 4) & 0xf
    const rateIndex = (buf[at + 2] >> 2) & 0x3
    const sampleRate = SAMPLE_RATES[version]?.[rateIndex]
    if (version === 1 || layer !== 1 || !sampleRate || bitrateIndex === 0 || bitrateIndex === 15) {
      at += 1
      continue
    }
    const bitrate = (version === 3 ? BITRATES_V1L3 : BITRATES_V2L3)[bitrateIndex] * 1000
    const samples = version === 3 ? 1152 : 576
    const frameLength = Math.floor((samples / 8) * (bitrate / sampleRate)) + ((buf[at + 2] >> 1) & 1)
    if (frameLength < 4) {
      at += 1
      continue
    }
    seconds += samples / sampleRate
    frames += 1
    at += frameLength
  }
  return frames ? seconds : null
}

// ---------------------------------------------------------------- 两边的料
const localTracks = () => {
  if (!ARCHIVE || !fs.existsSync(ARCHIVE)) return []
  const out = []
  for (const name of fs.readdirSync(ARCHIVE)) {
    // 档案实物名沿用游戏原文件名再缀指纹：`275_1741.<sha1>.mp3`
    const matched = /^(\d{1,3})_\d{3,5}\./.exec(name)
    if (!matched) continue
    const seconds = mp3DurationSeconds(fs.readFileSync(path.join(ARCHIVE, name)))
    if (seconds) out.push({ id: Number(matched[1]), seconds })
  }
  return out
}

const GAME_FILE = [
  /^(\d{1,3})[ _]\d{3,5}\.mp3$/,
  /^BGM_Battle_(\d{1,3})\.mp3$/,
  /^\d+_res\.sounds\.battle\.BGM_(\d{1,3})\.mp3$/,
]
const resourceIdOf = (file) => {
  for (const pattern of GAME_FILE) {
    const matched = pattern.exec(file)
    if (matched) return Number(matched[1])
  }
  return null
}
const songTitle = (bold) => {
  const matched = /\{\{lang\|ja\|([\s\S]*?)\}\}/.exec(`${bold ?? ''}`)
  if (!matched) return ''
  return matched[1]
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim()
    .replace(/^「/, '')
    .replace(/」$/, '')
    .trim()
}
const ENTRY =
  /(\d+)\.\s*<big><b>([\s\S]*?)<\/b><\/big>[\s\S]{0,120}?时长：(\d+):(\d+)[\s\S]{0,240}?<flashmp3>([^<]+)<\/flashmp3>/g
const HEADING = /^(={2,4})\s*(.+?)\s*\1\s*$/gm
const BATTLE_SECTIONS = new Set(['通常海域BGM', '迷你活动BGM', '期间限定海域BGM'])

const wikiEntries = (wikitext) => {
  const headings = [...wikitext.matchAll(HEADING)].map((m) => ({
    level: m[1].length,
    title: m[2],
    start: m.index,
  }))
  const sectionAt = (index) => {
    let h2 = ''
    let h3 = ''
    for (const heading of headings) {
      if (heading.start > index) break
      if (heading.level === 2) {
        h2 = heading.title
        h3 = ''
      }
      if (heading.level === 3) h3 = heading.title
    }
    return { h2, h3 }
  }
  const out = []
  for (const match of wikitext.matchAll(ENTRY)) {
    const { h2, h3 } = sectionAt(match.index)
    if (!BATTLE_SECTIONS.has(h2)) continue
    const file = match[5].trim()
    out.push({
      name: songTitle(match[2]),
      seconds: Number(match[3]) * 60 + Number(match[4]),
      id: resourceIdOf(file),
      era: h3.replace(/\{\{lang\|ja\|(.*?)\}\}/g, '$1'),
    })
  }
  return out
}

const knownNames = () => {
  const pack = JSON.parse(fs.readFileSync(new URL('assets/lodes/kcwiki-bgm.json', ROOT), 'utf8'))
  const taken = {}
  for (const [id, name] of Object.entries(pack.data.battle)) taken[name] = Number(id)
  const heard = fs.readFileSync(new URL('src/shared/bgm-heard.ts', ROOT), 'utf8')
  for (const m of heard.matchAll(/id:\s*(\d+),\s*\n?\s*name:\s*'([^']+)'/g)) taken[m[2]] = Number(m[1])
  for (const m of heard.matchAll(/\{ id: (\d+), name: '([^']+)'/g)) taken[m[2]] = Number(m[1])
  return taken
}

// ---------------------------------------------------------------- 跑一遍
const main = async () => {
  const tracks = localTracks()
  console.log(`本机档案里量得出时长的战斗曲 ${tracks.length} 首`)
  if (!tracks.length) {
    console.log(
      '档案里还没有战斗曲实物。「响过即存」要等游戏真放过才会攒下——出击几次再回来跑。',
    )
    return
  }
  const response = await fetch(PAGE_URL, { headers: { 'User-Agent': 'kanso-lodes' } })
  if (!response.ok) throw new Error(`拆包BGM列表取不下来：HTTP ${response.status}`)
  const entries = wikiEntries(await response.text())
  const taken = knownNames()
  const result = joinBgmByDuration({
    tracks,
    // 只拿「站方没给出资源号」的曲子去认——给了号的那些本来就该按文件名收
    songs: entries.filter((e) => e.id == null && e.name),
    calibration: entries
      .filter((e) => e.id != null && e.name)
      .map((e) => ({ id: e.id, name: e.name, seconds: e.seconds })),
    taken,
  })
  const { checked, failures } = result.calibration
  console.log(`校准样本 ${checked.length} 个，超差 ${failures.length} 个`)
  for (const row of failures)
    console.log(`  ✗ ${row.id} 站方 ${row.seconds}s / 实测 ${row.measured.toFixed(2)}s（${row.name}）`)
  if (result.stopped) {
    console.log(`\n整层停：${result.reason}——一条都不收。`)
    return
  }
  console.log(`\n可落账 ${result.matched.length} 条：`)
  for (const m of result.matched)
    console.log(`  ${m.id} = ${m.name}（实测 ${m.measured.toFixed(2)}s / 站方 ${m.stated}s）`)
  console.log(`\n判不了的 ${result.ambiguous.length} 条（撞时长或反向撞号）：`)
  for (const a of result.ambiguous)
    console.log(
      `  ${a.id}（${a.seconds.toFixed(2)}s）${a.candidates.join(' | ')}${
        a.alsoFits ? ` ← 这首曲同时也贴合 ${a.alsoFits.join(',')}` : ''
      }`,
    )
  console.log(`\n名字已经归了别的号的 ${result.contested.length} 条：`)
  for (const c of result.contested) console.log(`  ${c.id} 想认「${c.name}」，但它已经是 ${c.heldBy} 的`)
  console.log(`\n本机有音轨、站方时长里找不到对应的 ${result.silent.length} 个号`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
