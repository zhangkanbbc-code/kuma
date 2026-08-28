// 曲名字形总校的**跑法**（维护者侧，零网络）。判据全在 scripts/lib/bgm-name-audit.mjs，
// 那一份是纯函数、被测试真跑过；这里只负责把三层曲名与官方曲目表读进来，再把结果摆出来。
//
//   npm run bgm:audit          逐筐列出来
//   npm run bgm:audit -- --json  连明细一起吐 JSON
//
// 原料是 scripts/ost-tracklists.json（官方 OST 九卷曲目表，抓取器 fetch-ost-tracklists.mjs）。
// 它照的是哪一档错、为什么约物不算发现、为什么它自己也会错——都写在 lib 那一份的头上。
import { existsSync, readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

import { auditBgmNames } from './lib/bgm-name-audit.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => JSON.parse(readFileSync(path.join(root, rel), 'utf8'))

const distPath = path.join(root, 'dist', 'shared', 'bgm-heard.js')
if (!existsSync(distPath)) {
  console.error('缺 dist/shared/bgm-heard.js —— 先跑 npm run build')
  process.exit(1)
}
const heard = (await import(`file://${distPath.replaceAll('\\', '/')}`)).default

const reference = read('scripts/ost-tracklists.json')
const pack = read('assets/lodes/kcwiki-bgm.json').data.battle
const ours = [
  ...Object.entries(pack).map(([id, name]) => ({
    layer: '拆包层',
    tree: 'battle',
    id: Number(id),
    name,
  })),
  ...heard.HEARD_BGM_NAMES.map((e) => ({ layer: '耳测战斗层', tree: 'battle', id: e.id, name: e.name })),
  ...heard.HEARD_PORT_BGM_NAMES.map((e) => ({
    layer: '耳测母港层',
    tree: 'port',
    id: e.id,
    name: e.name,
  })),
]

const result = auditBgmNames(reference, ours)
const { exact, punctOnly, nearMiss, absent, pending, whereIs } = result
const settled = nearMiss.filter((row) => row.settled)
const noise = nearMiss.filter((row) => !row.settled && row.noise)

/**
 * 官方尚未公布曲名的号。
 *
 * 这里只回答「我们现有的说法在官方碟上有没有、在哪一轨」。
 * **年代与碟序是候选依据，不是判决**——定名照旧等耳测或官宣。
 *
 * 五桩悬案（109/122/123/152/153）曾在这张表里挂过：本审计器给它们留的碟序旁证
 * 两头都应验了（152/153 碟轨号是倒的→拆包层果然整对错位；122/123 是顺的→拆包层对），
 * 2026-08-24 晚提督按号实听全部终审闭案，判词进了 kcwiki-bgm.mjs 的
 * KNOWN_TRANSCRIPTION_FIXES 与 耳测清单-BGM.md 第五节，此处退场。
 */
const OPEN_CASES = [
  { id: 279, note: '2026 夏活；官方九卷最新一卷 vol.IX 出于 2024-03，早于这批曲实装，查无着落是意料之中，不构成任何证据' },
  { id: 280, note: '同 279' },
  { id: 281, note: '同 279' },
]

const say = (...args) => console.log(...args)

say(`官方参考表：${reference.albumCount} 卷 ${reference.trackCount} 曲（抓于 ${reference.fetchedAt.slice(0, 10)}）`)
say(
  `我们这侧：${ours.length} 条（拆包层 ${Object.keys(pack).length} · 耳测战斗层 ${heard.HEARD_BGM_NAMES.length} · 耳测母港层 ${heard.HEARD_PORT_BGM_NAMES.length}）`,
)
say('')
say(`① 逐字相同 ${exact.length} 条`)
say(`② 只差约物 ${punctOnly.length} 条（各家自己都不统一，不算发现、不动我们的写法）`)
for (const row of punctOnly) {
  say(`   ${row.layer} ${row.tree}/${row.id}：我们「${row.name}」／参考表「${row.reference}」${row.at}`)
}
say(
  `③ 只差一两个字 ${nearMiss.length} 条（**待看 ${pending.length}** · 已裁「我们对」${settled.length} · 判为不同曲 ${noise.length}）`,
)
for (const row of [...pending].sort((a, b) => a.d - b.d)) {
  say(`   [待看·差${row.d}字] ${row.layer} ${row.tree}/${row.id}：我们「${row.name}」／参考表「${row.reference}」${row.at}`)
}
for (const row of settled) say(`   [已裁·我们对] ${row.layer} ${row.tree}/${row.id}「${row.name}」：${row.settled}`)
for (const row of noise) say(`   [不同曲] ${row.layer} ${row.tree}/${row.id}「${row.name}」：${row.noise}`)
say(`④ 官方表里没有 ${absent.length} 条（游戏里响过的远多于上碟的，正常）`)

say('')
say('官方未公布曲名的号在官方表里的着落（候选依据，不是判决）：')
for (const openCase of OPEN_CASES) {
  const candidates = ours.filter((row) => row.tree === 'battle' && row.id === openCase.id)
  if (!candidates.length) {
    say(`  ${openCase.id}：我们这侧一个说法都没有（${openCase.note}）`)
    continue
  }
  for (const candidate of candidates) {
    const at = whereIs(candidate.name)?.join('、') ?? '官方九卷里查无此曲'
    say(`  ${openCase.id}：${candidate.layer}说「${candidate.name}」→ ${at}（${openCase.note}）`)
  }
}

if (process.argv.includes('--json')) {
  say('')
  say(JSON.stringify({ exact: exact.length, punctOnly, nearMiss, absent }, null, 2))
}
