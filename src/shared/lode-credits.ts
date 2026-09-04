// 「随包资料来自谁、按什么条件用」的**单一出处**。
//
// 这张表是署名义务的集中落点之一：`NOTICE.md` 管「随分发物提供」，
// 钥的「资料来源与许可」卡管「应用内可查」，两处共用这一份分组。
// 模块里一个署名都不散布（发布纪律七之三/七之四）。
//
// **文案是静态的，不从 `meta.license` 动态生成。** 署名文本是法律义务，
// 而 `meta.license` 是抓取时写进包里的字符串，下一次抓取就可能被覆盖——
// 让它去驱动署名等于让署名跟着上游漂。
//
// 但「有没有漏掉某个包」必须是机器保证：`lodeIds` 把每一组和随包名单对上，
// `test/lode-credits.test.mjs` 拿真名单 + 真 NOTICE.md 逐个核对，
// 加了包忘了署名当场红。这条护栏做成数据级比对，不去正则匹配源码文本。
//
// 这一页**不出现日期**：新鲜度归「矿脉健康度」卡（纪律七之四：新鲜度是维护者的区域）。

export interface LodeCreditSource {
  /** 分组的稳定键。只给护栏与去重用，不进 UI */
  key: string
  /** 来源名。UI 上是外链锚文本 */
  name: string
  /** 站点/仓库地址。点击才联网——属纪律七之三的豁免项（网络去向告知） */
  url?: string
  /** 许可名。写玩家读得懂的说法，不写 SPDX 代号 */
  license: string
  /** 「提供了什么」：功能词，不写文件名 */
  provides: string
  /** 折叠层〈逐项对照〉的那一段：域级，不写 id、不写日期 */
  detail: string
  /**
   * 这一组覆盖的随包矿脉 id。
   * 与 `scripts/lib/bundled-lodes.mjs` 的名单双向核对（多一个少一个都红）。
   * 一个包被两组共同覆盖是允许的——中文名那一份就同时来自舰娘百科与 KC3Kai。
   */
  lodeIds: readonly string[]
}

/**
 * 分组顺序按**玩家能感知的分量**排，不按许可类型排。
 * 分组维度是「谁」而不是「哪个文件」：署名义务的对象是人与社区，
 * 而玩家也认不出 `kcwiki-voice.json` 是什么。文件名留给 NOTICE.md。
 */
export const LODE_CREDIT_SOURCES: readonly LodeCreditSource[] = [
  {
    key: 'kcwiki',
    name: '舰娘百科（zh.kcwiki.cn）',
    url: 'https://zh.kcwiki.cn/',
    license: '知识共享 署名-非商业性使用-相同方式共享 3.0',
    provides:
      '舰娘与装备的中文名、任务的中文说明、远征资料、舰娘与深海舰的台词翻译（图鉴与语音字幕都用，含季节限定台词）、季节限定立绘的清单、海域带路说明、海域敌编成、海域确认掉落、活动加成、装备加成、战斗曲的官方曲名',
    detail:
      '舰娘与装备的中文名 · 任务的中文说明 · 远征名称与条件 · 舰娘与深海舰台词翻译 · ' +
      '各年季节限定台词的中文翻译 · ' +
      '各年季节限定立绘的清单（只是「谁在哪一季有过一张限定立绘」这件事，不含任何图） · ' +
      '各海域带路说明 · 各海域出现的敌方编成 · 各海域的确认掉落 · 活动特效加成 · ' +
      '装备装在特定舰娘身上时的额外加成 · 战斗曲的官方曲名。' +
      '这些文件是对页面内容的抽取与重排。' +
      '海域带路说明中，部分表格由舰娘百科转自 NGA 论坛的整理帖。' +
      '海域敌编成与确认掉落是多方资料的汇编，舰娘百科是其中最主要的一份；' +
      '其掉落表按页面自述主要转自日文 Wiki。',
    lodeIds: [
      'kcwiki-ships',
      'kcwiki-localization',
      'quests-scn',
      'kcwiki-voice',
      'kcwiki-seasonal-voice',
      'kcwiki-expedition',
      'kcwiki-bgm',
      'kcwiki-routing',
      'event-bonus',
      'kcwiki-fit-bonus',
      'map-enemy-comps',
      'map-drops',
      'ship-stats',
    ],
  },
  {
    key: 'kc3kai',
    name: 'KC3Kai',
    url: 'https://github.com/KC3Kai/KC3Kai',
    license: 'MIT',
    provides: '深海舰的数值推定、等级经验对照，以及道具的中文名',
    detail: '深海舰的火力/装甲等数值推定 · 舰娘等级经验对照表 · 道具的中文名。',
    lodeIds: ['abyssal-stats', 'ship-exp', 'kcwiki-localization'],
  },
  {
    key: 'poi',
    name: 'poi',
    url: 'https://github.com/poooi/poi',
    license: 'MIT',
    provides: '海图节点资料、任务目标对照；kuma 的网络与兼容处理也移植自 poi',
    detail:
      '海图节点资料 · 任务目标对照表 · 镇守府服务器表；另有网络钩子与 DMM 兼容处理的实现移植。',
    lodeIds: ['poi-fcd-map', 'poi-quest-goal'],
  },
  {
    key: 'poi-plugin-subtitle',
    name: 'poi-plugin-subtitle',
    url: 'https://github.com/kcwikizh/poi-plugin-subtitle',
    license: 'MIT',
    // 2026-08-25：kcwiki-voice 接进实时字幕之后，这一份不再是字幕的唯一来源，
    // 措辞跟着改成如实的分工（它仍是主力，缺的那些才轮到舰娘百科）
    provides: '语音字幕的日文原文与中文翻译（缺的那些由舰娘百科的台词补上）',
    detail: '母港与战斗语音的日文原文与中文翻译。缺的那些由舰娘百科的台词补上。',
    lodeIds: ['subtitle-ja', 'subtitle-zh', 'subtitle-npc', 'subtitle-enemies'],
  },
  {
    key: 'opencc',
    name: 'OpenCC',
    url: 'https://github.com/BYVoid/OpenCC',
    license: 'Apache License 2.0',
    provides: '玩家可见中文资料繁体转简体所用的字表与词表',
    detail: '繁体中文转为简体中文所用的字表与词表；在玩家可见中文资料及台词显示时查表。',
    lodeIds: ['opencc-t2s'],
  },
  {
    key: 'kcwiki-quest-data',
    name: 'kcwiki-quest-data',
    url: 'https://github.com/kcwikizh/kcwiki-quest-data',
    license: 'MIT',
    provides: '任务的前置条件，以及任务的日文原名',
    detail: '任务的前置任务与解锁条件 · 任务的日文原名（与中文说明配对显示）。',
    // 任务日文原名住在 kcwiki-localization 里（`entities.quest`），来源就是这个仓库的
    // data.min.json——运行时与 quests-scn 的中文名配对，见 renderer/localization.ts
    // 那句 `source: 'kcwiki-quest-data+quests-scn'`。一个包被两组共同覆盖是允许的。
    lodeIds: ['kcwiki-quest-req', 'kcwiki-localization'],
  },
  {
    key: 'kanso',
    name: 'kuma 自行整理',
    license: '——',
    provides:
      '上述来源尚未收录的新内容、装备改修的消耗与二号舰、各机体遭受对空射击时的减免档位、活动里各机体的陆航特效分组、各海域限时掉落的起讫记录、尚无中文的舰娘台词翻译，以及逐首听出来的战斗曲曲名',
    detail:
      '以上来源尚未收录的条目由 kuma 补充，只补缺、不改写。' +
      '每条都标明它是照公开资料整理、有官方公告佐证、按规律推断，还是实测过',
    lodeIds: [
      'map-drop-windows',
      'kanso-voice',
      'kanso-voice-zh',
      'equip-improve',
      'equip-aa-evasion',
      'event-plane-groups',
      'event-lifecycle',
    ],
  },
]

/**
 * 引导段：随包、免费且只能免费。两句，别加第三句。
 * （「查阅时不需要联网」2026-08-26 按文案清扫族 2 删了：合规由这一页背书，
 *   界面不逐处自证不联网。）
 * `emphasis` 那半句是 NC 带来的唯一硬约束，UI 上加粗；
 * 它与 `NOTICE.md` 里的同一句话是一对，两处各出现一次。
 */
export const LODE_CREDIT_INTRO = {
  lead: 'kuma 显示的舰娘、装备、任务与海域资料，来自下面这些社区项目与百科，随 kuma 一起分发。',
  licenseNote: '其中一部分资料按「非商业性使用」授权：',
  emphasis: 'kuma 永久免费，也不得用于任何商业用途。',
} as const

/** 相同方式共享（SA）那一条义务。只对 CC 那一组成立，紧跟在分源列表后面。 */
export const LODE_CREDIT_SHARE_ALIKE =
  '舰娘百科的资料按「署名 · 非商业性使用 · 相同方式共享」授权：kuma 从中整理出的数据文件同样按该许可提供，' +
  '任何人可在遵守同一条件下再使用。'
