// 仅从舰娘百科模块取值；本机 akashi-list 只作逐格比较票，绝不写回。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseLuaTable } from './lib/kcwiki-lua.mjs'
import { compareWikiwikiImprove } from './lib/wikiwiki-improve-compare.mjs'
import { loadStart2MasterArray } from './lib/start2.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
export const FORMAL_OUTPUT = path.join(ROOT, 'assets/lodes/kcwiki-akashi-improve.json')
export const MODULE_TITLE = '模块:明石工厂数据'
export const MODULE_URL = `https://zh.kcwiki.cn/wiki/${MODULE_TITLE}`
const API = 'https://zh.kcwiki.cn/api.php'
const categories = () => ({ same: 0, different: 0, missing: 0, extra: 0 })
const cells = (item, field) => field === 'item_intro'
  ? (typeof item?.item_intro === 'string' && item.item_intro !== '' ? { text: item.item_intro } : {})
  : Object.fromEntries(Object.entries(item?.item_remodel ?? {}).flatMap(([stat, row]) =>
      Object.entries(row).map(([index, value]) => [`${stat}/${index}`, value])))

export function readModule(text, date) {
  if (text.trimStart().startsWith('{')) {
    const json = JSON.parse(text)
    const page = Object.values(json.query?.pages ?? {})[0]
    const revision = page?.revisions?.[0]
    if (revision) return {
      items: parseLuaTable(revision['*'], 'k.EquipUpdateTb'),
      date: revision.timestamp, revision: revision.revid,
    }
    // 离线 JSON 候选必须保留模块日期，不能拿抓取日期冒充资料日期。
    return { items: json.items, date: json.moduleUpdatedAt ?? date, revision: json.revision ?? null }
  }
  return { items: parseLuaTable(text, 'k.EquipUpdateTb'), date, revision: null }
}

export function compareItems(moduleItems, localItems) {
  const data = { schemaVersion: 1, items: {} }
  const summary = { item_intro: categories(), item_remodel: categories() }
  const rows = []
  for (const id of [...new Set([...Object.keys(moduleItems), ...Object.keys(localItems)])].sort((a, b) => +a - +b)) {
    const row = { id, name: (moduleItems[id] ?? localItems[id]).item_name, item_intro: categories(), item_remodel: categories(), differences: [] }
    const accepted = {}
    if (Object.keys(moduleItems[id]?.item_remodel ?? {}).length) {
      // 保留 CC 模块的属性表头；整行无一致值时只留空对象，界面逐格显示待补。
      // 这里只复制表头，不收任何分歧值，也不从本机票复制属性名。
      accepted.item_remodel = Object.fromEntries(Object.keys(moduleItems[id].item_remodel).map(stat => [stat, {}]))
    }
    for (const field of ['item_intro', 'item_remodel']) {
      const upstream = cells(moduleItems[id], field)
      const local = cells(localItems[id], field)
      for (const key of new Set([...Object.keys(upstream), ...Object.keys(local)])) {
        const kind = !Object.hasOwn(upstream, key) ? 'missing'
          : !Object.hasOwn(local, key) ? 'extra'
          : upstream[key] === local[key] ? 'same' : 'different'
        summary[field][kind]++
        row[field][kind]++
        if (kind !== 'same') {
          row.differences.push({ field, cell: key, kind })
          continue
        }
        // 两边同为空字符串只表示结构一致，不能把空串当作已收录的值。
        if (upstream[key] === '') continue
        if (field === 'item_intro') accepted.item_intro = upstream[key]
        else {
          const split = key.lastIndexOf('/')
          const stat = key.slice(0, split), index = key.slice(split + 1)
          accepted.item_remodel ??= {}
          accepted.item_remodel[stat] ??= {}
          // 稀疏、零起算索引：删除分歧格时不能压紧数组，让后面的值串星。
          accepted.item_remodel[stat][index] = upstream[key]
        }
      }
    }
    if (Object.keys(accepted).length) data.items[id] = accepted
    rows.push(row)
  }
  return { data, report: { equipment: { module: Object.keys(moduleItems).length, local: Object.keys(localItems).length }, summary, rows } }
}

export function buildPack(module, localItems) {
  if (!module.items || !/^\d{4}-\d{2}-\d{2}T/.test(module.date ?? '')) throw new Error('模块内容或模块更新日期缺失')
  const filtered = localItems !== null
  // 无对照票时只生成候选，标志和输出闸门都不能伪装成正式包。
  const result = compareItems(module.items, localItems ?? module.items)
  if (filtered) {
    const s = result.report.summary.item_remodel
    const common = s.same + s.different
    const total = common + s.missing
    if (!common || s.same / common < 0.95 || s.same / total < 0.8) {
      throw new Error(`一致率偏低，拒绝正式出包：${JSON.stringify(s)}`)
    }
  }
  return {
    pack: {
      meta: {
        id: 'kcwiki-akashi-improve', name: '明石逐星加成与图鉴说明',
        version: module.date.slice(0, 10).replaceAll('-', '.'),
        source: 'kuma 汇编 · 参考舰娘百科「明石工厂数据」', sourceUrl: MODULE_URL,
        license: 'CC-BY-NC-SA-3.0', bundle: filtered,
        fetchedAt: new Date().toISOString(), upstreamUpdatedAt: module.date,
        moduleUpdatedAt: module.date, moduleRevision: module.revision,
        comparisonVerified: filtered,
        note: '装备改修的逐星加成与图鉴说明（日文原文）',
      },
      data: result.data,
    },
    report: {
      moduleUpdatedAt: module.date, filtered,
      ...(filtered ? result.report : {
        equipment: { module: Object.keys(module.items).length, local: null },
        summary: null, rows: [],
      }),
    },
  }
}

export function writePack(output, pack) {
  if (path.resolve(output).toLowerCase() === path.resolve(FORMAL_OUTPUT).toLowerCase() && !pack.meta.comparisonVerified) {
    throw new Error('缺本机 akashi-list 对照，拒绝直接写正式包；请用 --out 指定临时候选文件')
  }
  fs.writeFileSync(output, `${JSON.stringify(pack, null, 2)}\n`)
}

async function fetchModule() {
  const url = `${API}?action=query&prop=revisions&rvprop=content%7Ctimestamp%7Cids&format=json&titles=${encodeURIComponent(MODULE_TITLE)}`
  const response = await fetch(url, { headers: { 'User-Agent': 'kuma-lodes' } })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return readModule(await response.text())
}

export async function main(argv = process.argv.slice(2)) {
  const options = {}
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]
    if (!['--from-file', '--module-date', '--akashi', '--out', '--report', '--compare'].includes(key) || !argv[i + 1]) throw new Error(`未知或缺值参数 ${key}`)
    options[key] = argv[++i]
  }
  const module = options['--from-file']
    ? readModule(fs.readFileSync(path.resolve(options['--from-file']), 'utf8'), options['--module-date'])
    : await fetchModule()
  const localPath = options['--akashi'] ?? path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData/Roaming'), 'kuma/lodes/akashi-list.json')
  const localItems = fs.existsSync(localPath) ? JSON.parse(fs.readFileSync(localPath, 'utf8')).data?.items : null
  if (localItems === undefined) throw new Error('本机 akashi-list 缺 data.items')
  const { pack, report } = buildPack(module, localItems)
  if (options['--compare']) {
    if (!localItems || !options['--report']) throw new Error('--compare 需要本机比较包及 --report')
    const masters = Object.fromEntries(loadStart2MasterArray('api_mst_slotitem', ROOT).map(e => [e.api_id, e]))
    report.wikiwiki = compareWikiwikiImprove(fs.readFileSync(path.resolve(options['--compare']), 'utf8'), module.items, localItems, masters)
  }
  const output = path.resolve(options['--out'] ?? FORMAL_OUTPUT)
  // --compare 是只读第三票；不重写已包含推算来源的正式包。
  if (!options['--compare']) writePack(output, pack)
  if (options['--report']) fs.writeFileSync(path.resolve(options['--report']), `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ output: options['--compare'] ? null : output, filtered: report.filtered, equipment: report.equipment, summary: report.summary, wikiwiki: report.wikiwiki?.summary }))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
