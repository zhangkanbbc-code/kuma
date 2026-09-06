// 只抽舰娘百科七列表中无附加条件的普通类别；概率列不进入结果。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { tableGrid } from './map-intel.mjs'
import { devReferenceRecipe } from '../src/shared/factory-lookup.ts'
const root = fileURLToPath(new URL('..', import.meta.url))

export function collectDevelopment(html, names, equips, local) {
  const grids = [...html.matchAll(/<table\b[\s\S]*?<\/table>/g)].map(m => tableGrid(m[0]))
    .filter(g => g[0]?.[0]?.text === '装备名称')
  if (grids.length !== 15 || grids.some(g => g[0].map(c => c.text).join('/') !== '装备名称/秘书舰/燃料/弹药/钢铁/铝/出货率')) throw Error('开发七列表结构变化')
  const byName = new Map(Object.entries(names).flatMap(([id,n]) => [[n.zh, +id], [n.ja, +id]]))
  const master = new Map(equips.map(e => [e.api_id, e]))
  const group = { 水雷系: '水雷系', 炮战系: '砲戦系', 空母系: '空母系' }
  const data = { schemaVersion: 1, equipment: {} }, omitted = []
  for (const row of grids.flatMap(g => g.slice(1))) {
    const name = row[0].text, secretary = row[1].text
    const id = byName.get(name), recipe = row.slice(2, 6).map(c => /^\d+$/.test(c.text) ? Number(c.text) : NaN)
    const item = master.get(id)
    const votes = local.equipment?.[item?.api_name] ?? []
    const reason = !group[secretary] ? '秘书舰含特定舰、组合或额外说明，未扁平化'
      : !item ? '名称未与主数据精确解号'
      : recipe.some(n => !Number.isInteger(n)) ? '投入不是四个整数'
      : !votes.some(v => v.secretary === group[secretary] && JSON.stringify(devReferenceRecipe(item.api_broken, v.table)) === JSON.stringify(recipe)) ? '与对照资料同秘书舰投料参考不一致或缺票' : null
    if (reason) { omitted.push({ name, secretary, recipe: recipe.map(n => Number.isNaN(n) ? null : n), reason }); continue }
    const entries = data.equipment[id] ??= []
    if (!entries.some(e => e.secretary === secretary && JSON.stringify(e.recipe) === JSON.stringify(recipe))) entries.push({ secretary, recipe })
  }
  return { data, omitted }
}

export function main(argv = process.argv.slice(2)) {
  const opts = Object.fromEntries(argv.map(a => a.replace(/^--/, '').split(/=(.*)/s).slice(0, 2)))
  if (!opts.input || !opts.local || !opts.master) throw Error('必须提供 --input、--local 与 --master 的只读输入路径')
  const input = JSON.parse(fs.readFileSync(path.resolve(opts.input), 'utf8'))
  const snapshot = JSON.parse(fs.readFileSync(path.resolve(opts.master), 'utf8'))
  const raw = snapshot.body?.api_data ?? snapshot.data ?? snapshot.api_data
  const result = collectDevelopment(input.html,
    JSON.parse(fs.readFileSync(path.join(root, 'assets/lodes/kcwiki-localization.json'), 'utf8')).data.entities.equip,
    raw.api_mst_slotitem, JSON.parse(fs.readFileSync(path.resolve(opts.local), 'utf8')).data)
  const pack = { meta: { id: 'development-facts', name: '开发参考', version: '2026.09.06',
    source: 'kuma 汇编 · 参考舰娘百科', sourceUrl: 'https://zh.kcwiki.cn/wiki/开发',
    license: 'CC-BY-NC-SA-3.0', fetchedAt: input.fetchedAt, upstreamUpdatedAt: input.updatedAt,
    note: '部分装备的开发投入与秘书舰类别参考' }, data: result.data }
  fs.writeFileSync(path.join(root, 'assets/lodes/development-facts.json'), JSON.stringify(pack, null, 2) + '\n')
  fs.writeFileSync(path.join(root, 'assets/review/development-facts.json'), JSON.stringify({ revision: input.revision, omitted: result.omitted,
    excluded: ['概率列', '混合配方、理论说明、追加产出', '特定舰与多类别组合条件'] }, null, 2) + '\n')
  console.log(`开发参考：${Object.keys(result.data.equipment).length} 件；未收 ${result.omitted.length} 行`)
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
