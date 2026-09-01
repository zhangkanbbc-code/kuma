// 钥 · 设置的分类子顶栏：**每张卡归哪一类，只有这一份表**。
//
// 从前十八张卡一长条滚到底，找一个开关得从头翻到尾（2026-08-24 用户报「全混在一起」）。
// 分页之后，页签行本身就是那张目录——所以这份表要能一眼读完、一眼改动。
//
// 三条纪律写在数据结构里：
//  · **不设「全部」页签**。混在一起正是要治的病，留一个「全部」等于把病留着。
//  · **每张卡恰好属于一类**。表是唯一出处（卡的次序也从这里来），
//    渲染层只消费；护栏从渲染产物逐张数，漏一张、重一张都当场红。
//  · **维护者工具不进发行版**。这张表列全部的卡，`settingsCardsOf` 按 `debugUi`
//    过滤——所以完备性护栏要按**两种形态**各数一遍（发行版 21 张 / 调试 23 张）。
//
// 类名用玩家词汇、两三个字：页签是给人扫一眼定位的，不是分类学。

export type SettingsSectionId = 'ui' | 'archive' | 'network' | 'lode' | 'health'

/**
 * 卡的身份。渲染时落成 `data-ycard="<id>"`，是这张卡在产物里唯一的可认标记——
 * 卡的标题是玩家可见文案，会改；id 不改，护栏与将来的定位跳转都认它。
 */
export type SettingsCardId =
  | 'zoom'
  | 'game-scale'
  | 'caption-size'
  | 'ui-hints'
  | 'tray'
  | 'game-audio'
  | 'game-audio-selftest'
  | 'voice-archive'
  | 'art-archive'
  | 'bgm-archive'
  | 'retention'
  | 'backup'
  | 'proxy'
  | 'game-url'
  | 'login'
  | 'push'
  | 'report'
  | 'lode-health'
  | 'lode-packs'
  // 「资料来源与许可」那张。id 特意**不**跟 shared 那个署名表同名：
  // 署名的「不散布」护栏是按文件里出没出现那张表的名字来数消费方的，
  // 这里写成同名字符串会把这份分类表误判成第二个消费方
  | 'lode-license'
  | 'cache-repair'
  | 'mod-dir'
  | 'diagnostics'
  | 'about'

export interface SettingsSection {
  id: SettingsSectionId
  /** 页签上那两三个字 */
  label: string
  /** 这一类里的卡，**次序就是页面上的次序** */
  cards: readonly SettingsCardId[]
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    id: 'ui',
    label: '界面',
    // 看得见、听得见的那些：开了就当场变样，所以排第一，也是默认落点。
    // 自检那张紧跟着音量卡——它诊断的就是那三条滑条，隔开摆反而要来回找。
    // 游戏画面紧跟界面缩放：两张说的都是「东西多大」，而且界面缩放一动，
    // 游戏那边的锁定档也跟着重摆一次，摆一起才看得出这层联动。
    // 字幕字号排第三同理，而且更紧：它显示的实际值就是「基准 × 上面那张卡的倍率」，
    // 隔开摆的话，改完倍率要翻页才看得见字幕跟着变成了多少
    cards: [
      'zoom',
      'game-scale',
      'caption-size',
      'ui-hints',
      'tray',
      'game-audio',
      'game-audio-selftest',
    ],
  },
  {
    id: 'archive',
    label: '档案',
    // 艦素替你记着的东西：三份档案、账本的保留期，以及把它们整包带走的备份。
    // 三份档案挨着摆——它们能分别清空，数字也分开算，隔开看容易以为是一件事
    cards: ['voice-archive', 'art-archive', 'bgm-archive', 'retention', 'backup'],
  },
  {
    id: 'network',
    label: '网络',
    // 会往外发请求、或决定「发不发」的那些。代理在最前：它一改，下面几张的成败都跟着变。
    // 游戏页面网址紧随其后——「走哪条路」与「去哪一页」是同一件事的两半，
    // 而登录、推送、上报都建立在这两张之上
    cards: ['proxy', 'game-url', 'login', 'push', 'report'],
  },
  {
    id: 'lode',
    label: '资料',
    // 社区资料包：有哪些、谁给的。健康度那张是**维护者工具**，发行版里不装配
    //（见下面的 DEBUG_ONLY_CARDS），所以玩家那份这一类只有两张
    cards: ['lode-health', 'lode-packs', 'lode-license'],
  },
  {
    id: 'health',
    label: '诊断',
    // 出毛病时才来的那一类，外加「关于」——数据目录写在那里，排查时要抄路径。
    // 魔改文件夹紧跟着缓存修复：魔改文件就摆在缓存目录那棵树里（与 poi 的
    // 「缓存与魔改」同一套摆法），两张卡说的是同一个目录的两件事
    cards: ['cache-repair', 'mod-dir', 'diagnostics', 'about'],
  },
]

/** 默认落点：开设置最常是来调界面的 */
export const DEFAULT_SETTINGS_SECTION: SettingsSectionId = 'ui'

/** 上次停在哪一类。走 kernel 的 uiGet/uiSet（主进程 config.json），与其他模块页签同一条路 */
export const SETTINGS_SECTION_UI_KEY = 'yu.section'

/** 全部卡片，按页面上的次序（各类首尾相接）。表的完备性护栏拿它当基准 */
export const SETTINGS_CARD_IDS: readonly SettingsCardId[] = SETTINGS_SECTIONS.flatMap(
  (section) => [...section.cards],
)

const SECTION_BY_CARD = new Map<SettingsCardId, SettingsSectionId>(
  SETTINGS_SECTIONS.flatMap((section) => section.cards.map((card) => [card, section.id] as const)),
)

/** 这张卡归哪一类。表里没有的 id 回 null——「不知道」不该被伪装成某一类 */
export const settingsSectionOf = (card: string): SettingsSectionId | null =>
  SECTION_BY_CARD.get(card as SettingsCardId) ?? null

/**
 * 只在**调试/开发态**装配的卡：维护者工具，发行版里整张不存在。
 *
 * 「游戏音频链路自检」是第二户：它把钩子装在哪些帧、各条捕获路记下过多少地址
 * 摊开给维护者看。玩家侧的信号就是滑条本身响不响，看不懂这些计数也无从下手。
 *
 * 另一户是「矿脉健康度」。缺包、停更、新鲜度是**维护者的责任区**
 *（2026-08-21 拍板），玩家侧的信号本来就在各栏目就地的占位上。
 * 那些没获随包许可的资料在玩家那份产物里**永远不会有**，摆一张「缺 14 份」的
 * 清单只是让他为一件自己做不了任何事的事担心——2026-08-24 用户原话：
 * 「既然不随包玩家那边看不到，多此一举写这些干什么」。
 *
 * 门与铭／锚两个诊断模块同一道：`process.env.KANSO_DEBUG_UI === '1'`（判据在 mu.ts）。
 * 那个判断在渲染层求值后作为 `debugUi` 传进来，这一层保持纯函数、脱开 DOM 可测。
 */
export const DEBUG_ONLY_CARDS: readonly SettingsCardId[] = [
  'game-audio-selftest',
  'lode-health',
]

export const isDebugOnlyCard = (card: string): boolean =>
  (DEBUG_ONLY_CARDS as readonly string[]).includes(card)

/**
 * 这一类要摆哪些卡，按次序。不认识的类回空数组，由调用方兜底。
 * `debugUi` 不给就按**发行版**算——默认少一张，好过默认把维护者工具漏给玩家。
 */
export const settingsCardsOf = (section: string, debugUi = false): readonly SettingsCardId[] => {
  const cards = SETTINGS_SECTIONS.find((entry) => entry.id === section)?.cards ?? []
  return debugUi ? cards : cards.filter((card) => !isDebugOnlyCard(card))
}

/**
 * 存下来的那一格。改过分类名、或者配置被人手改花了，一律回默认——
 * 认不出就渲染成空白页那才是真坏了。
 */
export const normalizeSettingsSection = (raw: unknown): SettingsSectionId =>
  SETTINGS_SECTIONS.some((section) => section.id === raw)
    ? (raw as SettingsSectionId)
    : DEFAULT_SETTINGS_SECTION
