import { splitAbyssalDisplayLabel } from '../shared/abyssal-label'
import { esc, queryLode } from './kernel'
import { simplifyLocalizationEntities } from './kcwiki-zh'
import { installTaskEntityFold } from './task-entity-match'
import { installZhSimplifier, simplifyZh } from './zh-simplify'

export type LocalizedDomain =
  | 'ship'
  | 'abyssShip'
  | 'equip'
  | 'abyssEquip'
  | 'item'
  | 'map'
  | 'mapArea'
  | 'shipType'
  | 'equipType'
  | 'expedition'
  | 'quest'

const ENTITY_COLOR_CLASS_BY_DOMAIN: Record<LocalizedDomain, string> = {
  ship: 'e-ship',
  abyssShip: 'e-abys',
  equip: 'e-equip',
  abyssEquip: 'e-abys',
  item: 'e-item',
  map: 'e-map',
  mapArea: 'e-map',
  shipType: 'e-ship',
  equipType: 'e-equip',
  expedition: 'e-exp',
  quest: 'e-quest',
}

const ENTITY_COLOR_CLASS_BY_LINK_TYPE: Record<string, string> = {
  ship: 'e-ship',
  mstShip: 'e-ship',
  fleetShip: 'e-ship',
  shipCapacity: 'e-ship',
  shipClass: 'e-ship',
  shipTypeCatalog: 'e-ship',
  shipTypeGroup: 'e-ship',
  shipNationality: 'e-nationality',
  histFleet: 'e-histfleet',
  abyssShip: 'e-abys',
  abyssEquip: 'e-abys',
  mstEquip: 'e-equip',
  equipCapacity: 'e-equip',
  equipTypeCatalog: 'e-equip',
  equipTypeGroup: 'e-equip',
  map: 'e-map',
  battle: 'e-map',
  battleCurrent: 'e-map',
  useitem: 'e-item',
  furniture: 'e-item', // 装饰品（家具）：与道具同族——都是「持有物」，不新开色
  quest: 'e-quest',
  questBatch: 'e-quest',
  expedition: 'e-exp',
  fleet: 'e-fleet',
  material: 'e-material',
  practice: 'e-practice',
  timer: 'e-timer',
  kdock: 'e-timer', // 建造坞：抬头那格的本体是倒计时，与其他计时同色
}

export const entityColorClass = (domain: LocalizedDomain): string =>
  ENTITY_COLOR_CLASS_BY_DOMAIN[domain]

export const entityLinkColorClass = (
  type: string,
  id?: number | string,
): string => {
  const base = ENTITY_COLOR_CLASS_BY_LINK_TYPE[type] ?? ''
  if (type !== 'material') return base
  const materialIndex = Number(id)
  return Number.isInteger(materialIndex) && materialIndex >= 0 && materialIndex <= 7
    ? `${base} e-material-${materialIndex}`
    : base
}

// ⚠️ **这个函数一个字都不翻译。** 它住在 localization.ts 里、名字带 entity，
// 很容易被当成「顺手就本地化了」——实际它只做一件事：给已经定好类型的字段套一个
// 颜色 class。翻译责任在**调用方**：要中文就先过 `entityNamePlain(域, id, 原文)`
// 再把结果喂进来（鉴的每个 typeName 都是这么写的）。
// 2026-08-25 汉化清点抓出九处直接把主数据日文原文喂进来的调用点，上屏就是日文；
// 全部已改成先查译名再上色。新写调用点时照这个顺序，别只包一层颜色就以为完事。
//
// 结构化实体字段没有跳转目标时仍保留类型色，但不附带链接事件与交互外观。
// 只在调用方已经确认字段类型时使用；普通说明文字不做关键词扫描或自动染色。
export const entityTermHtml = (
  type: string,
  id: number | string | undefined,
  text: unknown,
): string => {
  return entityTermTrustedHtml(type, id, esc(text))
}

// 仅供已经逐字段转义的内部双语组件使用。
export const entityTermTrustedHtml = (
  type: string,
  id: number | string | undefined,
  body: string,
): string => {
  const colorClass = entityLinkColorClass(type, id)
  return colorClass ? `<span class="entity-term ${colorClass}">${body}</span>` : body
}

interface LocalizedEntry {
  ja: string
  zh: string
  source?: string
}

type LocalizedTables = Record<LocalizedDomain, Record<string, LocalizedEntry>>

const emptyTables = (): LocalizedTables => ({
  ship: {},
  abyssShip: {},
  equip: {},
  abyssEquip: {},
  item: {},
  map: {},
  mapArea: {},
  shipType: {},
  equipType: {},
  expedition: {},
  quest: {},
})

let tables = emptyTables()
let installed = false
// 译名表是启动后异步落地的。索引类消费者（活动奖励连链）拿它当缓存键的一部分，
// 否则在译名落地前建好的索引会把「没有译名」缓存住，之后一直连不上译名词条。
let version = 0
export const localizationVersion = () => version

const clean = (value: unknown) => `${value ?? ''}`.trim()
const comparable = (value: unknown) =>
  clean(value)
    .normalize('NFKC')
    .replace(/[（）]/g, (char) => (char === '（' ? '(' : ')'))
    .replace(/\s+/g, '')
    .toLowerCase()

export const registerLocalizedName = (
  domain: LocalizedDomain,
  id: number | string,
  ja: unknown,
  zh: unknown,
  source = 'runtime',
) => {
  const jaText = clean(ja)
  // 运行期补登也是译名表的装配入口：只归一中文列，日文原名保持原样。
  const zhText = simplifyZh(clean(zh))
  if (!jaText || !zhText) return
  // 值没变就不推进版本号。这个函数在渲染路径上被反复调用（钦每重建一次任务行
  // 就把全部任务名重登一遍），无条件 bump 会把下游按版本号缓存的索引
  // （铎的奖励实体索引，两千多条）每帧打掉一次重建。
  const current = tables[domain][`${id}`]
  if (current && current.ja === jaText && current.zh === zhText && current.source === source) return
  tables[domain][`${id}`] = { ja: jaText, zh: zhText, source }
  version += 1
}

export const localizedEntry = (
  domain: LocalizedDomain,
  id: number | string,
  fallbackJa = '',
): LocalizedEntry => {
  const hit = tables[domain]?.[`${id}`]
  if (hit) return hit
  const ja = clean(fallbackJa)
  return { ja, zh: ja, source: 'master' }
}

export const localizedEntityId = (
  domain: LocalizedDomain,
  label: unknown,
): string | null => {
  const target = comparable(label)
  if (!target) return null
  for (const [id, entry] of Object.entries(tables[domain] ?? {})) {
    if (comparable(entry.ja) === target || comparable(entry.zh) === target) return id
  }
  return null
}

export const bilingualNameHtml = (
  zh: unknown,
  ja: unknown,
  options: { compact?: boolean; showOriginal?: boolean } = {},
): string => {
  const zhText = clean(zh)
  const jaText = clean(ja)
  const primary = zhText || jaText
  if (!primary) return ''
  if (!jaText || comparable(primary) === comparable(jaText)) return esc(primary)
  // 操作界面默认只保留中文主名；“原”仅由图鉴/资料介绍类视图显式开启。
  if (!options.showOriginal) return esc(primary)
  return `<span class="l10n-name${options.compact ? ' compact' : ''}">
    <span class="l10n-primary" lang="zh-CN">${esc(primary)}</span>
    <button class="l10n-toggle" type="button" data-l10n-toggle aria-expanded="false" title="展开日文原文">原</button>
    <span class="l10n-original" lang="ja">${esc(jaText)}</span>
  </span>`
}

export const entityNameHtml = (
  domain: LocalizedDomain,
  id: number | string,
  fallbackJa = '',
  options: { compact?: boolean; showOriginal?: boolean } = {},
): string => {
  const value = localizedEntry(domain, id, fallbackJa)
  const body = bilingualNameHtml(value.zh, value.ja || fallbackJa, options)
  return body ? `<span class="entity-term ${entityColorClass(domain)}">${body}</span>` : ''
}

export const entityNamePlain = (
  domain: LocalizedDomain,
  id: number | string,
  fallbackJa = '',
): string => {
  const value = localizedEntry(domain, id, fallbackJa)
  return value.zh || value.ja || clean(fallbackJa)
}

const domainOfLink = (
  type: string,
  id: number | string,
): LocalizedDomain | null => {
  if (type === 'ship' || type === 'mstShip') return 'ship'
  if (type === 'abyssShip') return 'abyssShip'
  // 深海装备的链接类型就叫 abyssEquip（di.ts:295/1486 按 mstId 判的）。此前这里只认
  // mstEquip，于是深海装备名整条走不到译名表——同一个函数上一行已经算出中文喂给了
  // 图标 title，链接文字却还是日文原名。
  if (type === 'abyssEquip') return 'abyssEquip'
  if (type === 'mstEquip') return Number(id) >= 1500 ? 'abyssEquip' : 'equip'
  if (type === 'map') return 'map'
  if (type === 'useitem') return 'item'
  if (type === 'quest') return 'quest'
  return null
}

/**
 * 深海舰的标注名常常在基名后面拖着形态标注（`flagship`、`艦載機赤`、`(陸爆中)`、
 * 开头还可能有 `(後衛)`）。全名等值比对会被这段尾巴整条挡掉——实测两个矿脉包
 * 21350 个敌舰位里 9440 位（44%）栽在这上面，而**译名一条都不缺**。
 *
 * 切成「基名 + 标注」：基名去查译名，标注**原样接回去**。标注是形态信息不是句子，
 * 既不能丢（丢了就分不清 elite 和 flagship 是两拨敌人），也不该翻（`艦載機赤` 是
 * 攻略站的记号，翻成中文玩家反而对不上）。
 *
 * 只对 abyssShip 域开。词表是从那两个包的真实标注里归纳的（见 shared/abyssal-label），
 * 认不出的尾巴一律返回 null 退回全名比对——宁可继续露日文提醒补词表，也不冒
 * 「把玩家眼前的敌人换成另一艘舰」的险。
 */
interface MatchedLabel {
  entry: LocalizedEntry
  /** 基名之前原样保留的部分，如 `(後衛)` */
  head: string
  /** 基名之后原样保留的形态标注，如 ` flagship 艦載機赤` */
  tail: string
}

/**
 * 等级说两遍的那一处。
 *
 * kcwiki 的深海舰中文名把等级写进名字里（1528 的 zh 是 `空母WO级flagship`），
 * 而日文名取自主数据、只有基名 `空母ヲ級`——译名包里 74 条是这个形状。
 * 敌编成目录喂进来的标注本来就自带 `flagship` 这一截，基名命中的是**日文那半**，
 * 于是「中文名 + 标注」拼出「空母WO级flagshipflagship」
 * （2026-08-26 用户截图报出；真包 21350 个敌舰位里 8783 位、61 种标注中招）。
 *
 * 等级归标注那半：标注已经写出来的等级，名字这半不再说第二遍。
 * 反过来，标注**没写**等级时（「你的实测」那条腿喂的是主数据裸名 `空母ヲ級`）
 * 名字照旧带着——那是玩家能看到的唯一形态信息，一个字都不能省。
 * 等级对不上时（标注 elite、词条 flagship）也不动：那是定号定错了，
 * 硬凑只会把矛盾藏起来。
 */
const RANK_LED_TAIL = /^\s*(flagship|elite)\b/i
const dropRankSaidTwice = (entry: LocalizedEntry, tail: string): LocalizedEntry => {
  const rank = RANK_LED_TAIL.exec(tail)?.[1]
  if (!rank) return entry
  const shed = (name: string) => {
    const trimmed = clean(name).replace(new RegExp(`\\s*${rank}$`, 'i'), '').trim()
    // 整条名字就是等级两个字时不动——那种词条本身有问题，砍成空串比重复更糟
    return trimmed || name
  }
  const zh = shed(entry.zh)
  const ja = shed(entry.ja)
  return zh === entry.zh && ja === entry.ja ? entry : { ...entry, zh, ja }
}

/**
 * 「这段文字是不是这个实体的名字」的**唯一判据**。HTML 版与纯文本版都从这里出——
 * 判定各写一份必然漂移，漂移的样子是「链接里出中文、同一格的悬停里出日文」。
 */
const matchLabel = (
  domain: LocalizedDomain,
  id: number | string,
  text: string,
): MatchedLabel | null => {
  const entry = tables[domain]?.[`${id}`]
  if (!entry) return null
  const label = comparable(text)
  if (label === comparable(entry.ja) || label === comparable(entry.zh)) {
    return { entry, head: '', tail: '' }
  }
  if (domain !== 'abyssShip') return null
  const target = [comparable(entry.ja), comparable(entry.zh)].filter(Boolean)
  const parts = splitAbyssalDisplayLabel(text, (base) => target.includes(comparable(base)))
  return parts
    ? { entry: dropRankSaidTwice(entry, parts.tail), head: parts.head, tail: parts.tail }
    : null
}

// EntityLink 有时显示的是「图鉴 →」「1-1」等动作文字，不能看见 id 就强行改名；
// 仅当传入文字本身就是日/中文实体名（或实体名 + 形态标注）时接管。
export const localizedLinkLabel = (
  type: string,
  id: number | string,
  text: string,
): string | null => {
  const domain = domainOfLink(type, id)
  if (!domain) return null
  const value = tables[domain]?.[`${id}`]
  if (!value) return null
  if (domain === 'quest' && !value.ja && comparable(text) !== comparable(value.zh)) {
    value.ja = clean(text)
    return bilingualNameHtml(value.zh, value.ja, { compact: true })
  }
  const matched = matchLabel(domain, id, text)
  if (!matched) return null
  const name = bilingualNameHtml(matched.entry.zh, matched.entry.ja, { compact: true })
  if (!name) return null
  return `${esc(matched.head)}${name}${esc(matched.tail)}`
}

/**
 * `localizedLinkLabel` 的纯文本版：给 `title` / `aria-label` / 占位首字这类
 * 不吃 HTML 的位置用。判定同上，认不出就**原样返回**，绝不硬翻。
 *
 * 存在的理由：缩略图那一族（entity-art.ts）过去把调用方给的原始 `api_name`
 * 直接塞进 title/aria，缺图时格子里显示的更是日文首字——同一行的可见文字
 * 早就是中文了，只有悬停和读屏还在说日文。
 */
export const localizedLabelText = (
  domain: LocalizedDomain,
  id: number | string,
  text: string,
): string => {
  const matched = matchLabel(domain, id, text)
  if (!matched) return clean(text)
  const name = matched.entry.zh || matched.entry.ja
  return name ? `${matched.head}${name}${matched.tail}` : clean(text)
}

const installFoldToggle = () => {
  if (installed) return
  installed = true
  document.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-l10n-toggle]')
    if (!button) return
    event.preventDefault()
    event.stopPropagation()
    const name = button.closest<HTMLElement>('.l10n-name')
    if (!name) return
    const open = name.classList.toggle('open')
    button.setAttribute('aria-expanded', `${open}`)
    button.title = open ? '收起日文原文' : '展开日文原文'
  })
}

export const initLocalization = async () => {
  installFoldToggle()
  const [pack, questPack, expeditionPack, opencc] = await Promise.all([
    queryLode('kcwiki-localization'),
    queryLode('quests-scn'),
    queryLode('kcwiki-expedition'),
    queryLode('opencc-t2s'),
  ])
  installZhSimplifier(opencc)
  // index.ts 会等 initLocalization 与快照一起完成后才装配模块：这里先装字符表，
  // qn 首次 buildEntityIndexes 及以后 master 触发的重建都会与正文共用同一折叠。
  // initLocalization 失败则模块不装配；字表缺席时两侧的 OpenCC 层都为恒等。
  installTaskEntityFold(opencc?.data?.chars ?? null)
  const raw = simplifyLocalizationEntities(pack?.data?.entities)
  if (raw && typeof raw === 'object') {
    tables = { ...emptyTables(), ...raw }
  }
  // 中文任务库比日文原文包覆盖更新；按同一 game id 合并，旧原文缺失时不伪造。
  if (questPack?.data) {
    for (const [id, quest] of Object.entries<any>(questPack.data)) {
      const original = tables.quest[id]
      if (quest?.name) {
        tables.quest[id] = {
          ja: original?.ja ?? '',
          zh: simplifyZh(quest.name),
          source: original?.ja ? 'kcwiki-quest-data+quests-scn' : 'quests-scn',
        }
      }
    }
  }
  if (expeditionPack?.data) {
    for (const [dispNo, expedition] of Object.entries<any>(expeditionPack.data)) {
      if (expedition?.nameJp && expedition?.nameZh) {
        registerLocalizedName(
          'expedition',
          dispNo,
          expedition.nameJp,
          expedition.nameZh,
          'kcwiki-expedition',
        )
      }
    }
  }
  version += 1
}
