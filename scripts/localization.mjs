// 全域实体译名的装配层。
//
// 2026-08-21 换源：整包原本骑在 kcwikizh/kcdata 上（ship/slotitem/useitem/map/
// maparea/shiptype/equiptype 七张表），而那个仓根目录既无 LICENSE 也无 README，
// GitHub 判 license: null——一个无许可成分就够把整包钉在「不能随发行版分发」上。
// 拆开看，kcdata 在这里其实只干两件事：
//
//   ① 给出**日文原名与 id 空间**——那是 api_start2 的原样转录，游戏一手就有，可自产；
//   ② 给出其中一部分**中文译名**（舰娘 849 / 深海舰 298 / 道具 37 / 舰种 22）。
//
// 于是 ① 全部改读主数据快照（scripts/lib/start2.mjs），② 换成同域的有许可源：
// 舰娘与深海舰走 zh.kcwiki 的原模块（CC BY-NC-SA 3.0，且比 kcdata 更全），
// 道具走 KC3Kai/kc3-translations（MIT，活跃，107 条 > kcdata 的 37 条），
// 舰种走既有的术语降级 + 一张按 id 钉死的小台账（与装备类别同一套办法）。
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { loadStart2MasterArray } from './lib/start2.mjs'
import { parseLuaTable } from './lib/kcwiki-lua.mjs'

const KCWIKI_RAW = (title) =>
  `https://zh.kcwiki.cn/index.php?title=${encodeURIComponent(title)}&action=raw`

const URLS = {
  quests: 'https://kcwikizh.github.io/kcwiki-quest-data/data.min.json',
  friendlyShips: KCWIKI_RAW('模块:舰娘数据'),
  abyssShipsZh: KCWIKI_RAW('模块:深海栖舰数据改二'),
  friendlyEquip: KCWIKI_RAW('模块:舰娘装备数据改'),
  abyssEquip: KCWIKI_RAW('模块:深海装备数据'),
  normalMaps: KCWIKI_RAW('模块:入手方式地图数据'),
  useItemsZh: 'https://raw.githubusercontent.com/KC3Kai/kc3-translations/master/data/scn/useitems.json',
}

const fetchChecked = async (url, format = 'json') => {
  const response = await fetch(url, { headers: { 'User-Agent': 'kanso-lodes' } })
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return format === 'text' ? response.text() : response.json()
}

const luaString = (block, key) => {
  const escaped = `${key}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = block.match(new RegExp(`\\["${escaped}"\\]\\s*=\\s*"((?:\\\\.|[^"\\\\])*)"`))
  if (!match) return ''
  return match[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim()
}

// KCWiki 的模块是一张顶层 Lua 表。顶层条目固定用一个 tab 缩进；
// 以同级下一项切块，可避开「属性」等内层数字键。
export const parseLuaNameTable = (text) => {
  const starts = [...text.matchAll(/^\t\["(\d+)"\]\s*=\s*\{/gm)]
  const out = []
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i]
    const block = text.slice(start.index, starts[i + 1]?.index ?? text.length)
    const id = Number.parseInt(start[1], 10)
    const ja = luaString(block, '日文名') || luaString(block, '日文名称')
    const zh = luaString(block, '中文名') || luaString(block, '中文名称')
    if (Number.isInteger(id) && id > 0 && ja) out.push({ id, ja, zh })
  }
  return out
}

// 装备类别名的人工校正台账（2026-08-16 用户实锤图鉴分类里日文混杂）。
// kcdata 的 chinese_name 对类别名要么原样留日文（ソナー/オートジャイロ），
// 要么半吊子简化（对空机銃/上陸用舟艇/战斗糧食）。字级简繁降级救不了词级问题
// （機銃→机枪、施設→设施是用词与语序，不是字形），所以按 id 钉死。
// 只钉有病的条目，上游哪条改对了就删哪条；91 号连日文原文都带着断括号，一并补全。
export const EQUIPTYPE_ZH_FIXES = {
  // 6-8：上游自己两套口径混用（舰载战斗机 vs 舰上侦察机、轰炸机 vs 爆击机）。
  // 2026-08-16 用户拍板统一 kcwiki 直译系「舰上/爆击机」——别把爆击机当错字改回轰炸机。
  6: '舰上战斗机',
  7: '舰上爆击机',
  8: '舰上攻击机',
  14: '声呐',
  21: '对空机枪',
  24: '登陆用舟艇',
  25: '旋翼机',
  30: '简易输送部材',
  31: '舰艇修理设施',
  34: '司令部设施',
  40: '大型声呐',
  41: '大型飞行艇',
  43: '战斗粮食',
  49: '陆上侦察机',
  52: '陆战部队',
  53: '大型陆上机',
  91: '喷式战斗爆击机（II）',
}

// 舰种名的人工校正台账（与上面的装备类别台账同一套办法）。
// 术语降级本来就能把 22 条舰种里的 21 条译对（駆逐艦→驱逐舰…），
// 唯一一条对不上的是 13 号：降级出「潜水舰」，而 kcdata 时代界面上一直写「潜水艇」。
// 换源不该顺手改界面用词——按 id 钉住原样，要改另说。
export const SHIPTYPE_ZH_FIXES = {
  13: '潜水艇',
}

// 舰娘中文名的第一方增补：zh.kcwiki「模块:舰娘数据」尚未收录的形态。
// 上游补上之后这里就该删（补缺层的老规矩：只补缺、不覆盖、上游赶上就退役）。
// 现存这 5 条是 Phoenix / Glorious 两条链，用的是换源前界面上一直显示的写法。
export const FIRST_PARTY_SHIP_ZH = {
  734: '凤凰城改',
  740: '光荣(Glorious)改',
  741: '光荣(Glorious)改',
  952: '凤凰城',
  1027: '光荣(Glorious)',
}

const CHAR_ZH = {
  亜: '亚', 亞: '亚', 悪: '恶', 圧: '压', 囲: '围', 為: '为', 壱: '壹', 栄: '荣',
  衛: '卫', 駅: '驿', 円: '圆', 縁: '缘', 鉛: '铅', 塩: '盐', 艶: '艳', 応: '应',
  欧: '欧', 殴: '殴', 奥: '奥', 穏: '稳', 仮: '假', 価: '价', 絵: '绘', 会: '会',
  壊: '坏', 懐: '怀', 拡: '扩', 覚: '觉', 学: '学', 楽: '乐', 関: '关', 艦: '舰',
  観: '观', 岩: '岩', 帰: '归', 気: '气', 亀: '龟', 旧: '旧', 拠: '据', 挙: '举',
  峡: '峡', 強: '强', 教: '教', 鏡: '镜', 区: '区', 駆: '驱', 勲: '勋', 軽: '轻',
  鶏: '鸡', 撃: '击', 県: '县', 剣: '剑', 圏: '圈', 検: '检', 権: '权', 顕: '显',
  験: '验', 厳: '严', 語: '语', 護: '护', 号: '号', 広: '广', 鋼: '钢', 鉱: '矿',
  砲: '炮', 国: '国', 済: '济', 斎: '斋', 剤: '剂', 殺: '杀', 雑: '杂', 参: '参',
  桟: '栈', 残: '残', 姉: '姐', 歯: '齿', 児: '儿', 時: '时', 実: '实', 写: '写',
  舎: '舍', 釈: '释', 寿: '寿', 収: '收', 従: '从', 渋: '涩', 獣: '兽', 縦: '纵',
  粛: '肃', 処: '处', 緒: '绪', 勝: '胜', 将: '将', 焼: '烧', 照: '照', 証: '证',
  乗: '乘', 剰: '剩', 場: '场', 譲: '让', 醸: '酿', 触: '触', 寝: '寝', 慎: '慎',
  晋: '晋', 図: '图', 粋: '粹', 数: '数', 瀬: '濑', 声: '声', 斉: '齐', 静: '静',
  積: '积', 節: '节', 専: '专', 戦: '战', 戰: '战', 浅: '浅', 潜: '潜', 線: '线',
  船: '船', 選: '选', 銭: '钱', 装: '装', 総: '总', 騒: '骚', 増: '增', 続: '续',
  続: '续', 対: '对', 對: '对', 帯: '带', 隊: '队', 台: '台', 滝: '泷', 択: '择',
  単: '单', 団: '团', 弾: '弹', 断: '断', 遅: '迟', 築: '筑', 虫: '虫', 昼: '昼',
  鋳: '铸', 駐: '驻', 著: '著', 庁: '厅', 徴: '征', 鎮: '镇', 陳: '陈', 鉄: '铁',
  転: '转', 点: '点', 伝: '传', 電: '电', 灯: '灯', 島: '岛', 盗: '盗', 稲: '稻',
  闘: '斗', 働: '动', 導: '导', 道: '道', 読: '读', 届: '届', 難: '难', 弐: '贰',
  認: '认', 燃: '燃', 廃: '废', 売: '卖', 麦: '麦', 発: '发', 髪: '发', 抜: '拔',
  浜: '滨', 敏: '敏', 不: '不', 払: '拂', 仏: '法', 並: '并', 変: '变', 辺: '边',
  編: '编', 補: '补', 宝: '宝', 豊: '丰', 砲: '炮', 冒: '冒', 満: '满', 夢: '梦',
  無: '无', 霧: '雾', 訳: '译', 薬: '药', 与: '与', 予: '预', 余: '余', 預: '预',
  揚: '扬', 様: '样', 謡: '谣', 来: '来', 頼: '赖', 覧: '览', 竜: '龙', 龍: '龙',
  両: '两', 猟: '猎', 練: '练', 連: '连', 炉: '炉', 労: '劳', 湾: '湾', 腕: '腕',
  週: '周', 遠: '远', 復: '复', 讐: '仇', 設: '设', 資: '资', 試: '试', 製: '制',
  開: '开', 備: '备', 員: '员', 噴: '喷', 進: '进', 機: '机', 魚: '鱼', 偵: '侦',
  爆: '爆', 雲: '云', 風: '风', 鳳: '凤', 鶴: '鹤', 曉: '晓', 響: '响', 沖: '冲',
  長: '长', 澤: '泽', 霽: '霁', 規: '规', 級: '级', 門: '门', 給: '给', 離: '离',
  猫: '猫', 鳥: '鸟', 費: '费', 輸: '输', 頭: '头', 後: '后', 号: '号', 射: '射',
}

const TOKEN_ZH = [
  ['最終形態', '最终形态'],
  ['航空母艦', '航空母舰'],
  ['水上機母艦', '水上机母舰'],
  ['航空戦艦', '航空战舰'],
  ['重雷装巡洋艦', '重雷装巡洋舰'],
  ['練習巡洋艦', '练习巡洋舰'],
  ['潜水母艦', '潜水母舰'],
  ['潜水空母', '潜水空母'],
  ['工作艦', '工作舰'],
  ['海防艦', '海防舰'],
  ['揚陸艦', '扬陆舰'],
  ['補給艦', '补给舰'],
  ['装甲空母', '装甲空母'],
  ['軽空母', '轻空母'],
  ['正規空母', '正规空母'],
  ['駆逐艦', '驱逐舰'],
  ['軽巡洋艦', '轻巡洋舰'],
  ['重巡洋艦', '重巡洋舰'],
  ['戦艦', '战舰'],
  ['棲水姫', '栖水姬'],
  ['棲装姫', '栖装姬'],
  ['棲姫', '栖姬'],
  ['水姫', '水姬'],
  ['棲鬼', '栖鬼'],
  ['泊地', '泊地'],
  ['飛行場', '飞行场'],
  ['集積地', '集积地'],
  ['港湾', '港湾'],
  ['護衛', '护卫'],
  ['要塞', '要塞'],
  ['姫', '姬'],
  ['鬼', '鬼'],
  ['級', '级'],
  ['単装', '单装'],
  ['連装', '连装'],
  ['三連装', '三联装'],
  ['四連装', '四联装'],
  ['五連装', '五联装'],
  ['魚雷発射管', '鱼雷发射管'],
  ['高角砲', '高角炮'],
  ['副砲', '副炮'],
  ['主砲', '主炮'],
  ['水上偵察機', '水上侦察机'],
  ['艦上戦闘機', '舰载战斗机'],
  ['艦上爆撃機', '舰载轰炸机'],
  ['艦上攻撃機', '舰载攻击机'],
  ['陸上攻撃機', '陆上攻击机'],
  ['局地戦闘機', '局地战斗机'],
  ['爆雷投射機', '爆雷投射机'],
  ['電探', '电探'],
  ['熟練', '熟练'],
  ['後期型', '后期型'],
  ['初期型', '初期型'],
  ['新型', '新型'],
  ['カモメ', '海鸥'],
  ['オルモック', '奥尔莫克'],
  ['サンベルナルジノ', '圣贝纳迪诺'],
  ['パラオ', '帕劳'],
  ['ウルシ―', '乌利西'],
  ['アルジェリア', '阿尔及利亚'],
  ['イタリア', '意大利'],
  ['ブレスト', '布雷斯特'],
  ['イギリス', '英国'],
  ['バルト', '波罗的'],
]

const IROHA = {
  イ: 'I', ロ: 'RO', ハ: 'HA', ニ: 'NI', ホ: 'HO', ヘ: 'HE',
  ト: 'TO', チ: 'CHI', リ: 'RI', ヌ: 'NU', ル: 'RU', ヲ: 'WO',
  ナ: 'NA', ネ: 'NE', ツ: 'TSU', レ: 'RE',
}

export const simplifyJapanese = (value) => {
  let text = `${value ?? ''}`.trim()
  for (const [from, to] of TOKEN_ZH) text = text.split(from).join(to)
  text = text.replace(/([イロハニホヘトチリヌルヲナネツレ])级/g, (_, kana) => `${IROHA[kana]}级`)
  text = text.replace(/./gu, (ch) => CHAR_ZH[ch] ?? ch)
  return text
    .replaceAll('(', '（')
    .replaceAll(')', '）')
    .replace(/\s+/g, ' ')
    .trim()
}

const entry = (ja, zh, source, fallback = true) => {
  const jaText = `${ja ?? ''}`.trim()
  const zhText = `${zh ?? ''}`.trim() || (fallback ? simplifyJapanese(jaText) : jaText)
  if (!jaText || !zhText) return null
  return { ja: jaText, zh: zhText, source }
}

const put = (table, id, ja, zh, source, fallback = true) => {
  const value = entry(ja, zh, source, fallback)
  if (value) table[`${id}`] = value
}

const parseNormalMaps = (text) => {
  const out = new Map()
  const starts = [...text.matchAll(/^\s{4}\["(\d+-\d+)"\]\s*=\s*\{/gm)]
  for (let i = 0; i < starts.length; i++) {
    const block = text.slice(starts[i].index, starts[i + 1]?.index ?? text.length)
    const zh = luaString(block, '中文名称')
    if (zh) out.set(starts[i][1], zh)
  }
  return out
}

const eventOverrides = (root) => {
  try {
    const data = JSON.parse(readFileSync(path.join(root, 'scripts', 'map-intel-events.json'), 'utf8'))
    return data?.active ?? null
  } catch (_e) {
    return null
  }
}

/** 上一份包（用于把已退役的活动海域名字续下去，见下方 preserveRetiredMaps）。 */
const previousEntities = (root) => {
  const file = path.join(root, 'assets', 'lodes', 'kcwiki-localization.json')
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8'))?.data?.entities ?? null
  } catch (_e) {
    return null
  }
}

/**
 * 活动海域会从主数据里整批下线（现在只剩 7 个常规区 + 当期活动），
 * 而账本里的旧出击记录还指着那些 id。主数据本身没有历史，所以这一层靠**累积**：
 * 上一份包里有、这次主数据没有的条目原样续下来，标 `retired-master`。
 * 与 map-intel 的 preserveEventMaps 是同一个套路。
 */
const preserveRetiredMaps = (entities, previous) => {
  let kept = 0
  for (const domain of ['map', 'mapArea']) {
    for (const [id, value] of Object.entries(previous?.[domain] ?? {})) {
      if (entities[domain][id]) continue
      entities[domain][id] = { ...value, source: 'retired-master' }
      kept++
    }
  }
  return kept
}

export const fetchLocalization = async (root) => {
  // ---- 日文原名与 id 空间：游戏一手（api_start2 快照）----
  const master = {
    ships: loadStart2MasterArray('api_mst_ship', root),
    slots: loadStart2MasterArray('api_mst_slotitem', root),
    useitems: loadStart2MasterArray('api_mst_useitem', root),
    maps: loadStart2MasterArray('api_mst_mapinfo', root),
    mapAreas: loadStart2MasterArray('api_mst_maparea', root),
    shipTypes: loadStart2MasterArray('api_mst_stype', root),
    equipTypes: loadStart2MasterArray('api_mst_slotitem_equiptype', root),
  }
  const emptyTables = Object.entries(master).filter(([, rows]) => !rows.length).map(([key]) => key)
  if (emptyTables.length) {
    throw new Error(
      `译名装配需要 api_start2 主数据快照（缺 ${emptyTables.join('/')}）——` +
        '本机跑过一次 kuma 并登录游戏后就会有；读不到宁可失败，不拿残缺表顶替',
    )
  }

  const [
    quests,
    friendlyShipText,
    abyssShipText,
    friendlyEquipText,
    abyssEquipText,
    normalMapText,
    useItemZh,
  ] = await Promise.all([
    fetchChecked(URLS.quests),
    fetchChecked(URLS.friendlyShips, 'text'),
    fetchChecked(URLS.abyssShipsZh, 'text'),
    fetchChecked(URLS.friendlyEquip, 'text'),
    fetchChecked(URLS.abyssEquip, 'text'),
    fetchChecked(URLS.normalMaps, 'text'),
    fetchChecked(URLS.useItemsZh),
  ])

  const entities = {
    ship: {},
    abyssShip: {},
    equip: {},
    abyssEquip: {},
    item: {},
    map: {},
    mapArea: {},
    shipType: {},
    equipType: {},
    quest: {},
  }

  // 舰娘中文名：zh.kcwiki「模块:舰娘数据」（与 kcwiki-ships 同一张表）
  const shipZh = new Map()
  for (const row of Object.values(parseLuaTable(friendlyShipText, 'd.shipDataTb'))) {
    if (Number(row?.['ID']) > 0 && row?.['中文名']) shipZh.set(Number(row['ID']), `${row['中文名']}`)
  }
  if (shipZh.size < 700) throw new Error(`模块:舰娘数据 只给出 ${shipZh.size} 条中文名（基线 700）`)
  for (const ship of master.ships) {
    const id = Number(ship?.api_id)
    if (!(id > 0) || id >= 1500 || !(Number(ship?.api_sortno) > 0)) continue
    const zh = shipZh.get(id) ?? FIRST_PARTY_SHIP_ZH[id] ?? ''
    put(
      entities.ship,
      id,
      ship.api_name,
      zh,
      shipZh.has(id) ? 'kcwiki-ship-module' : zh ? 'kanso-supplement' : 'derived',
    )
  }

  // 深海舰中文名：zh.kcwiki「模块:深海栖舰数据改二」
  const abyssZh = new Map()
  for (const [key, row] of Object.entries(parseLuaTable(abyssShipText, 'd.shipDataTable'))) {
    const id = Number.parseInt(key, 10)
    if (id > 0 && row?.['中文名']) abyssZh.set(id, `${row['中文名']}`)
  }
  for (const ship of master.ships) {
    const id = Number(ship?.api_id)
    if (!(id >= 1500)) continue
    const zh = abyssZh.get(id) ?? ''
    put(entities.abyssShip, id, ship.api_name, zh, zh ? 'kcwiki-abyss-ship-module' : 'derived')
  }

  const friendlyEquip = parseLuaNameTable(friendlyEquipText)
  for (const equip of friendlyEquip) {
    put(entities.equip, equip.id, equip.ja, equip.zh, 'kcwiki-equip-module')
  }
  // 模块更新通常比 start2 慢几件，反过来也有：主数据里刚实装、模块还没收的，
  // 先按日文原名 + 可审计的术语/简繁降级顶上，等模块跟上再自然换成正式译名。
  for (const slot of master.slots) {
    const id = Number(slot?.api_id)
    if (id > 0 && id < 1500 && !entities.equip[id]) {
      put(entities.equip, id, slot.api_name, '', 'derived')
    }
  }
  for (const equip of parseLuaNameTable(abyssEquipText)) {
    // 旧深海装备 511..633 在现行 start2 中迁移为 1511..1633。
    const id = equip.id < 1000 ? equip.id + 1000 : equip.id
    put(entities.abyssEquip, id, equip.ja, equip.zh, equip.zh ? 'kcwiki-abyss-equip-module' : 'derived')
  }

  // 道具中文名：KC3Kai/kc3-translations（MIT）。原表里个别条目仍留着日文
  //（1 高速修復材 / 63 司令部要員），再过一道术语降级——降级只动字形与固定词，
  // 不会把已经是中文的条目改坏。
  for (const item of master.useitems) {
    const id = Number(item?.api_id)
    if (!(id > 0)) continue
    const raw = `${useItemZh?.[id] ?? ''}`.trim()
    const zh = raw ? simplifyJapanese(raw) : ''
    put(entities.item, id, item.api_name, zh, zh ? 'kc3-translations' : 'derived')
  }

  const normalNames = parseNormalMaps(normalMapText)
  for (const map of master.maps) {
    const id = Number(map?.api_id)
    if (!(id > 0)) continue
    const code = `${Number(map.api_maparea_id)}-${Number(map.api_no)}`
    const zh = normalNames.get(code) ?? ''
    put(entities.map, id, map.api_name, zh, zh ? 'kcwiki-map-module' : 'derived')
  }
  for (const area of master.mapAreas) {
    if (Number(area?.api_id) > 0) put(entities.mapArea, area.api_id, area.api_name, '', 'derived')
  }
  const retired = preserveRetiredMaps(entities, previousEntities(root))

  for (const type of master.shipTypes) {
    const fix = SHIPTYPE_ZH_FIXES[type.api_id]
    put(entities.shipType, type.api_id, type.api_name, fix ?? '', fix ? 'kanso-fix' : 'derived')
  }
  for (const type of master.equipTypes) {
    const fix = EQUIPTYPE_ZH_FIXES[type.api_id]
    put(entities.equipType, type.api_id, type.api_name, fix ?? '', fix ? 'kanso-fix' : 'derived')
  }
  for (const quest of quests) {
    if (quest?.game_id > 0 && quest?.name) {
      put(entities.quest, quest.game_id, quest.name, '', 'original-only', false)
    }
  }

  const event = eventOverrides(root)
  if (event?.mapAreaId) {
    const areaId = event.mapAreaId
    const area = entities.mapArea[areaId]
    if (area && event.nameZh) {
      area.zh = event.nameZh
      area.source = 'kcwiki-event-guide'
    }
    for (const [mapNo, zh] of Object.entries(event.mapNamesZh ?? {})) {
      const id = areaId * 10 + Number.parseInt(mapNo, 10)
      const map = entities.map[id]
      if (map && zh) {
        map.zh = zh
        map.source = 'manual-reviewed'
      }
    }
  }

  const coverage = Object.fromEntries(
    Object.entries(entities).map(([domain, values]) => {
      const all = Object.values(values)
      return [
        domain,
        {
          total: all.length,
          translated: all.filter((value) => value.zh && value.zh !== value.ja).length,
          canonical: all.filter((value) => value.source !== 'derived' && value.source !== 'original-only').length,
        },
      ]
    }),
  )
  console.log(
    `[lodes]   译名装配：` +
      Object.entries(coverage)
        .map(([domain, c]) => `${domain} ${c.translated}/${c.total}`)
        .join(' · ') +
      (retired ? ` / 已退役海域续用 ${retired} 条` : ''),
  )

  return { schemaVersion: 1, entities, coverage }
}
