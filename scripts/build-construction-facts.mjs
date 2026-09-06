// 舰娘百科建造页的数字与名单；对照资料日文包只读对照，不复制备注或概率。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { tableGrid } from './map-intel.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
export function collectConstruction(html, wiki, ships, local) {
  const grids = [...html.matchAll(/<table\b[\s\S]*?<\/table>/g)].map(m => tableGrid(m[0]))
  const names = new Map(Object.values(ships).flatMap(s => [[s.中文名, s], [s.日文名, s]]))
  // 页面使用的既有中文别名；只解名称，不从名字推定形态或时间。
  for (const [alias, name] of [['比睿', '比叡'], ['丸优', 'まるゆ']]) {
    if (names.has(name)) names.set(alias, names.get(name))
  }
  const times = grids.filter(g => g.some(r => /^(建造时间|时间)$/.test(r[0]?.text)))
  if (times.length !== 3) throw Error(`建造名单结构变化：应为三张时间表，实际 ${times.length}`)
  const data = { schemaVersion: 1, ships: {} }, omitted = []
  for (const [index, grid] of times.entries()) for (const row of grid) {
    if (!/^\d\d:\d\d:\d\d$/.test(row[0]?.text)) continue
    const mode = index === 0 ? 'normal' : 'large'
    for (const m of row[2].html.matchAll(/<a\b[^>]*title="([^"]+)"[^>]*>/g)) {
      const ship = names.get(m[1])
      const votes = (local.times ?? []).filter(t => t.time === row[0].text &&
        (mode === 'normal' ? t.ships : t.largeOnly).includes(ship?.日文名))
      if (!ship || !votes.length) { omitted.push({ name: m[1], mode, time: row[0].text, reason: ship ? '对照资料同归属同时间票缺失' : '主层名称未解号' }); continue }
      const entry = data.ships[ship.ID] ??= { time: row[0].text, modes: [], recipes: [] }
      if (entry.time !== row[0].text) throw Error(`同舰时间冲突：${ship.ID}`)
      if (!entry.modes.includes(mode)) entry.modes.push(mode)
    }
  }
  const section = wiki.split('==普通建造公式==')[1]?.split('==大型舰建造==')[0]
  if (!section) throw Error('普通建造公式章节缺失')
  const targetByType = { 2: '駆逐艦', 3: '軽巡洋艦', 4: '軽巡洋艦', 5: '重巡洋艦', 7: '空母', 8: '戦艦', 9: '戦艦', 11: '空母', 13: '潜水艦', 21: '軽巡洋艦' }
  let recipe = null
  for (const line of section.split('\n')) {
    const match = line.match(/^\*(\d+)\/(\d+)\/(\d+)\/(\d+)\s*$/)
    if (match) { recipe = match.slice(1).map(Number); continue }
    if (!recipe || !line.startsWith('**') || /理论|也可使用/.test(line)) continue
    // 只收正文逐名列出的产出；「金刚级四艘」不展开、Z1/Z3 的条件不省略。
    for (const [name, ship] of names) {
      if (['Z1', 'Z3'].includes(name) || !line.includes(name) || line.includes(`${name}级`)) continue
      const entry = data.ships[ship.ID]
      if (!entry?.modes.includes('normal')) continue
      if (!(local.recipes ?? []).some(r => r.target === targetByType[ship.舰种] && JSON.stringify(r.recipe) === JSON.stringify(recipe))) continue
      if (!entry.recipes.some(r => JSON.stringify(r) === JSON.stringify(recipe))) entry.recipes.push([...recipe])
    }
  }
  return { data, omitted }
}

export async function main(argv = process.argv.slice(2)) {
  const opts = Object.fromEntries(argv.map(a => a.replace(/^--/, '').split(/=(.*)/s).slice(0, 2)))
  if (!opts.input || !opts.local) throw Error('必须提供 --input=页面快照 与 --local=只读对照包')
  const input = JSON.parse(fs.readFileSync(path.resolve(opts.input), 'utf8'))
  const result = collectConstruction(input.html, input.wiki,
    JSON.parse(fs.readFileSync(path.join(root, 'assets/lodes/kcwiki-ships.json'), 'utf8')).data,
    JSON.parse(fs.readFileSync(path.resolve(opts.local), 'utf8')).data)
  const pack = { meta: { id: 'construction-facts', name: '建造参考', version: '2026.09.06',
    source: 'kuma 汇编 · 参考舰娘百科', sourceUrl: 'https://zh.kcwiki.cn/wiki/建造',
    license: 'CC-BY-NC-SA-3.0', fetchedAt: input.fetchedAt, upstreamUpdatedAt: input.updatedAt,
    note: '已核对的建造时间、普通或大型建造归属与部分普通建造配方' }, data: result.data }
  fs.writeFileSync(path.join(root, 'assets/lodes/construction-facts.json'), JSON.stringify(pack, null, 2) + '\n')
  fs.writeFileSync(path.join(root, 'assets/review/construction-facts.json'), JSON.stringify({ revision: input.revision, omitted: result.omitted,
    excluded: ['普通配方中的概率、评价与未逐名列出的产出', 'Z1、Z3 配方（秘书舰条件另列，未纳入本表）', '大型配方（对照资料对照无对应配方票）', '理论配方'] }, null, 2) + '\n')
  console.log(`建造参考：${Object.keys(result.data.ships).length} 艘，${Object.values(result.data.ships).reduce((n,s)=>n+s.recipes.length,0)} 条逐舰配方；未收 ${result.omitted.length} 项`)
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
