// 改修事实表 **vs** 上游抓取包的对照报告（维护者侧，零网络，只读不写）。
//
// 抓取器降级之后的去处：`equip-upgrades` 不再是随包数据的产地，只是一张**对照票**。
// 这个脚本回答一句话——「上游那边有没有哪一格与我们的事实表不一样」。
//
// **它不会自动改事实表。** 差异是给人看的：每一格都要人工判断是上游更新了、
// 上游抄错了、还是我们当初裁错了。转写进事实表时 `basis` 照实写
//（对照票说的话仍然是「整理参照」那一档，别因为多看了一眼就升级成实测）。
//
// 用法：
//   npm run lodes:fetch          # 先把上游包抓到开发树（维护者机器上才有）
//   node scripts/diff-equip-improve.mjs
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(here, '..')
const TABLE = path.join(ROOT, 'assets', 'lodes', 'equip-improve.json')
const UPSTREAM = path.join(ROOT, 'assets', 'lodes', 'equip-upgrades.json')

if (!existsSync(TABLE)) {
  console.error('[diff] 找不到事实表 assets/lodes/equip-improve.json')
  process.exit(1)
}
if (!existsSync(UPSTREAM)) {
  console.error(
    '[diff] 找不到上游对照包——先跑 npm run lodes:fetch。\n' +
      '（那个包不随发行版，只在维护者机器上存在；它现在的唯一用途就是这张对照报告。）',
  )
  process.exit(1)
}

const table = JSON.parse(readFileSync(TABLE, 'utf8')).data
const upstreamRaw = JSON.parse(readFileSync(UPSTREAM, 'utf8')).data
const upstream = Array.isArray(upstreamRaw) ? upstreamRaw : Object.values(upstreamRaw ?? {})

/** 一段消耗的可比形态。只比会影响玩家决策的那几个数 */
const stage = (one) =>
  one
    ? [
        one.devmats ?? '',
        one.devmats_sli ?? '',
        one.screws ?? '',
        one.screws_sli ?? '',
        (one.equips ?? []).map((e) => `${e.id}x${e.eq_count}`).join(','),
        (one.consumable ?? []).map((e) => `${e.id}x${e.eq_count}`).join(','),
      ].join('/')
    : '—'

/** 一行的可比形态：更新目标 + 二号舰 + 星期 + 三段消耗 */
const shape = (row) => ({
  key: [
    Number(row?.convert?.id_after) || 0,
    (row?.helpers ?? [])
      .flatMap((one) => (one?.ship_ids ?? []).map(Number))
      .sort((a, b) => a - b)
      .join('.'),
  ].join('#'),
  days: (row?.helpers ?? []).map((one) => (one?.days ?? []).join('')).sort().join('|'),
  p1: stage(row?.costs?.p1),
  p2: stage(row?.costs?.p2),
  conv: stage(row?.costs?.conv),
})

const byId = (list) => new Map(list.map((one) => [Number(one.eq_id), one]))
const ours = byId(table)
const theirs = byId(upstream)

const onlyOurs = [...ours.keys()].filter((id) => !theirs.has(id)).sort((a, b) => a - b)
const onlyTheirs = [...theirs.keys()].filter((id) => !ours.has(id)).sort((a, b) => a - b)

const diffs = []
for (const [id, mine] of ours) {
  const other = theirs.get(id)
  if (!other) continue
  const mineRows = new Map((mine.improvement ?? []).map((row) => [shape(row).key, row]))
  const otherRows = new Map((other.improvement ?? []).map((row) => [shape(row).key, row]))
  for (const [key, row] of mineRows) {
    const match = otherRows.get(key)
    if (!match) {
      diffs.push({ id, key, kind: '上游没有这一行', basis: row.basis })
      continue
    }
    const a = shape(row)
    const b = shape(match)
    for (const field of ['days', 'p1', 'p2', 'conv']) {
      if (a[field] !== b[field]) {
        diffs.push({ id, key, kind: field, ours: a[field], theirs: b[field], basis: row.basis })
      }
    }
  }
  for (const key of otherRows.keys()) {
    if (!mineRows.has(key)) diffs.push({ id, key, kind: '事实表没有这一行' })
  }
}

console.log(`[diff] 事实表 ${ours.size} 件 · 对照票 ${theirs.size} 件`)
if (onlyOurs.length) console.log(`[diff] 只有事实表有：${onlyOurs.join(', ')}`)
if (onlyTheirs.length) console.log(`[diff] 只有对照票有（可能是上游新增）：${onlyTheirs.join(', ')}`)

if (!diffs.length) {
  console.log('[diff] 逐行逐段一致，没有需要人工判断的格子')
} else {
  console.log(`\n[diff] ${diffs.length} 处不一致——**逐条人工判**，这个脚本不会替你改事实表：\n`)
  for (const one of diffs) {
    const where = `eq_id=${one.id} 行[${one.key}]`
    if (one.ours === undefined) {
      console.log(`  ${where}  ${one.kind}${one.basis ? `（我们这一行：${one.basis}）` : ''}`)
      continue
    }
    console.log(`  ${where}  ${one.kind}：我们 ${one.ours} ／ 对照票 ${one.theirs}`)
    if (one.basis) console.log(`      我们这一行的判据：${one.basis}`)
  }
  console.log(
    '\n[diff] 判的时候记着：**逐件裁过的那几格本来就该与对照票不同**' +
      '（那是实测或官方公告改过的），看到差异先查 basis 再动手。',
  )
}
