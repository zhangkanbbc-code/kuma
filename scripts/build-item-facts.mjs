// 2026-09-06 逐项阅读 CC 道具列表与对照资料对照后自写的用途短句。
// 图标编号不是 api_mst_useitem ID；按日文名称解号。历史兑换不收。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('..', import.meta.url))
export const REVIEWED_PURPOSES = {
  '書類一式＆指輪': '在改装界面用于舰娘结婚',
  '勲章': '可兑换改装设计图、资源或改修资材',
  '改修資材': '用于改修工厂的装备改修',
  '給糧艦「伊良湖」': '在编成界面使用，提升舰娘士气',
  'プレゼント箱': '开启时可选择一组物品',
  '艦娘からのチョコ': '可保留，也可使用后换成资源',
  '甲種勲章': '高难度作战的纪念物，也可兑换物资',
  '新型航空機設計図': '用于新型飞机相关任务及装备改修',
  '給糧艦「間宮」': '在编成界面使用，缓解舰队疲劳',
  '改装設計図': '用于部分舰娘的特殊改造',
  '特注家具職人': '在家具店购买部分特殊家具时使用',
  '司令部要員': '使用后增加一个可同时接受任务的名额',
  '補強増設': '为等级达到30的舰娘开启一个补强增设装备格',
  '高速修復材': '用于缩短舰娘修理等待时间',
  '高速建造材': '用于缩短舰娘建造等待时间',
  '開発資材': '用于舰娘建造和装备开发',
  'ドック開放キー': '用于开放修理槽、建造槽或扩充编成及装备记录槽',
  '応急修理要員': '装备后可在触发时避免舰娘被击沉一次',
  '応急修理女神': '装备后可在避免击沉时恢复舰娘的出击能力',
  '熟練搭乗員': '编成部分精锐航空部队时消耗',
  '試製甲板カタパルト': '用于部分航空母舰的改装',
  'ネ式エンジン': '用于喷气式飞机相关任务及装备改修',
  '秋刀魚の缶詰': '可装备的补给食品，发动后消耗',
  '戦闘糧食': '可装备的战前补给食品，发动后消耗',
  '洋上補給': '在海上为舰队补充燃料和弹药，发动后消耗',
  '設営隊': '用于基地航空队的扩张与整备',
  '潜水艦補給物資': '潜水母舰指挥潜水舰队攻击时消耗',
  '戦闘詳報': '用于部分战术相关任务与装备改修',
  '夜間熟練搭乗員': '编成夜间航空部队时消耗',
  '新型砲熕兵装資材': '用于新型火炮相关任务及装备改修',
  '新型航空兵装資材': '用于新型航空装备相关任务及改修',
  '新型噴進装備開発資材': '用于新型喷进装备相关任务及改修',
  '海外艦最新技術': '用于海外舰改装及相关装备的改修更新',
  '戦闘糧食(特別なおにぎり)': '可装备的补给食品，发动后消耗',
  '緊急修理資材': '实施紧急泊地修理时消耗',
  '新型兵装資材': '用于新型装备相关开发与改修',
  '格納庫増設': '配合其他资材扩张航空母舰等舰船的格纳库',
  '海色リボン': '为旗舰佩戴后小幅提升能力，同类佩饰会被替换',
  '白たすき': '为旗舰佩戴后小幅提升能力，同类佩饰会被替换',
  '航空特別増加食': '缓解一支基地航空队的疲劳并提升士气',
}

export function collectItems(raw, master, local) {
  const rows = [...raw.matchAll(/\{\{道具列表\s*\n([\s\S]*?)\n\}\}/g)].map(m =>
    Object.fromEntries([...m[1].matchAll(/^\s*\|\s*([^=\n]+?)\s*=\s*(.*)$/gm)].map(x => [x[1].trim(), x[2].trim()])))
  if (!rows.length) throw Error('道具列表模板缺失')
  const data = {}, omitted = [], accepted = new Set()
  for (const row of rows) {
    const name = row.日文名称
    const item = master.find(m => m.api_name === name)
    const purpose = REVIEWED_PURPOSES[name]
    const reason = row.类型 !== '常驻' ? '非常驻条目' : !purpose ? '未收：用途无完整双源核对'
      : !item ? '游戏道具表无精确同名条目' : local[item.api_id]?.name !== name ? '对照资料对照缺同名条目' : null
    if (reason) { omitted.push({ name, reason }); continue }
    data[item.api_id] = { overview: purpose }
    accepted.add(name)
  }
  for (const name of Object.keys(REVIEWED_PURPOSES)) if (!accepted.has(name) && !omitted.some(r => r.name === name)) omitted.push({ name, reason: 'CC 模板未找到同名条目' })
  // 只有巧克力的固定数量在两路现有输入均明确列出；礼物箱与甲章的数字缺对照票。
  const chocolate = rows.find(r => r.日文名称 === '艦娘からのチョコ')
  const chocoId = master.find(m => m.api_name === chocolate?.日文名称)?.api_id
  if (chocoId && data[chocoId]) {
    const cn = chocolate.中文说明, jp = local[chocoId].overview
    const same = [['燃料', '燃料', 700], ['弹药', '弾薬', 700], ['钢材', '鋼材', 700], ['铝土', 'ボーキサイト', 1500]]
      .every(([a,b,n]) => cn.includes(`${a}×${n}`) && jp.includes(`${b}×${n}`))
    if (same) data[chocoId].fixed = [{ offer: '消耗1个', gets: '燃料x700 + 弾薬x700 + 鋼材x700 + ボーキサイトx1500' }]
    else omitted.push({ name: chocolate.日文名称, reason: '固定兑换数量缺失或冲突' })
  }
  return { data, omitted }
}

export function main(argv = process.argv.slice(2)) {
  const opts = Object.fromEntries(argv.map(a => a.replace(/^--/, '').split(/=(.*)/s).slice(0, 2)))
  if (!opts.input || !opts.local || !opts.master) throw Error('必须提供 --input、--local 与 --master 的只读输入路径')
  const input = JSON.parse(fs.readFileSync(path.resolve(opts.input), 'utf8'))
  const page = Object.values(input.query.pages)[0], rev = page.revisions[0]
  if (rev.revid !== 184113) throw Error('道具页面已更新，先重新核对自写用途短句')
  const snapshot = JSON.parse(fs.readFileSync(path.resolve(opts.master), 'utf8'))
  const raw = snapshot.body?.api_data ?? snapshot.data ?? snapshot.api_data
  const result = collectItems(rev['*'], raw.api_mst_useitem, JSON.parse(fs.readFileSync(path.resolve(opts.local), 'utf8')).data)
  const pack = { meta: { id: 'item-facts', name: '道具用途与固定兑换', version: '2026.09.06',
    source: 'kuma 汇编 · 参考舰娘百科', sourceUrl: 'https://zh.kcwiki.cn/wiki/道具', license: 'CC-BY-NC-SA-3.0',
    fetchedAt: new Date().toISOString(), upstreamUpdatedAt: rev.timestamp, note: '部分常驻道具的用途与固定兑换' }, data: result.data }
  fs.writeFileSync(path.join(root, 'assets/lodes/item-facts.json'), JSON.stringify(pack, null, 2) + '\n')
  fs.writeFileSync(path.join(root, 'assets/review/item-facts.json'), JSON.stringify({ revision: rev.revid, omitted: result.omitted,
    excluded: ['礼物箱、甲种勋章的兑换数字缺对照资料对照票', '历年及历史活动兑换', '勋章三项固定兑换继续使用既有第一方手录表'] }, null, 2) + '\n')
  console.log(`道具用途：${Object.keys(result.data).length} 项；固定兑换 ${Object.values(result.data).reduce((n,r)=>n+(r.fixed?.length??0),0)} 项；未收 ${result.omitted.length} 项`)
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
