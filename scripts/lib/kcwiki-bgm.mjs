// 战斗曲曲名表解析（zh.kcwiki「拆包BGM列表」，2026-08-24）。
//
// ---- 为什么这个源、不是别的 ----
// 玩家看到的「战斗 BGM #NNN」缺的是**战斗树资源号 → 官方曲名**。
// 游戏主数据 `api_mst_bgm` 给不了它：那张表是**母港树**的号（101 起的港/家具/
// 季节曲 + 205 起的留声机曲），与 `/kcs2/resources/bgm/battle/NNN_XXXX.mp3`
// 的 NNN 是两套编号。三处实证：
//   · 母港树 115 = 「雨とお酒と艦娘」（主数据 115），战斗树 118 = 「梅雨明けの白露」，
//     而主数据 118 = 「鎮守府の秋祭り」——本仓 bgm-preview.ts 顶部记的那次实测撞名；
//   · 战斗树 229 = 「抜錨！鵜来型海防艦」（2023 夏活动曲），主数据 229 = 「提督と艦娘の食卓」；
//     同一首曲后来进留声机时另给了主数据号 275；
//   · 2026 夏活动（api_mst_mapbgm 62-x）取 275/276/277，按战斗树读是
//     「戦隊を統べる月の花／第三十一戦隊駆逐艦の出撃／反撃開始、艦隊全艦突入！」
//     ——正是本期活动曲；按主数据读则会读成 2023 年那批。
//
// wikiwiki 的 BGM 页**不列资源号**（2026-08-24 全页核过：无「資源番号/ファイル名/
// mp3」任何一列），只能靠 api_mst_mapbgm 反推，而它页内两张表自己就对不上
// （「BGM一覧」的使用箇所列与「BGM逆引き」在 101 个重合槽位里有 49 个互相矛盾）。
// 所以曲名表不从那里来；它只在维护者侧当第二票用。
// ——这第二票 2026-08-24 当场兑现过一次：124 号站方把「北大西洋」写成了「北太平洋」，
//   由 wikiwiki + 官方曲目表 + Fandom 三票逮住，见下方 KNOWN_TRANSCRIPTION_FIXES。
//
// ---- 页面结构（2026-08-24 实测） ----
// 四个 h2：「镇守府BGM」「通常海域BGM」「迷你活动BGM」「期间限定海域BGM」，
// 末尾另有「事件BGM」（结算/掉落/改修那几声，属 fanfare 树，本解析器不收）。
// 每条形如：
//   N.<big><b> {{lang|ja|「曲名」}}</b></big> <small>（中文名） 时长：1:22</small>
//   <div style="display:flex"><flashmp3>文件名</flashmp3>...</div>
// **资源号只在文件名里**，而文件名有两种：站方自己排的上传名（CommonBGM7.mp3 /
// BattleBGM09.mp3 / BattleBGM03Summer2015.mp3）和游戏原文件名（275_1741.mp3）。
// 上传名的数字是**序号不是资源号**——BattleBGM09 是「飛龍の反撃」，而按
// api_mst_mapbgm × wikiwiki 反推该曲的资源号是 12。所以只认游戏原文件名那几种形状，
// 上传名一律丢弃（宁可少收，不许把序号当资源号写进包）。
const GAME_FILE_PATTERNS = [
  // 游戏原文件名：`275_1741.mp3`（少数条目下划线被写成空格）
  /^(\d{1,3})[ _]\d{3,5}\.mp3$/,
  // 站方保留了资源路径的两种：`BGM_Battle_282.mp3`、`1_res.sounds.battle.BGM_110.mp3`
  /^BGM_Battle_(\d{1,3})\.mp3$/,
  /^\d+_res\.sounds\.battle\.BGM_(\d{1,3})\.mp3$/,
]

/** 战斗树所在的 h2。「镇守府BGM」是母港树（且站方全用上传名，给不出号），事件BGM 是 fanfare 树 */
const BATTLE_SECTIONS = new Set(['通常海域BGM', '迷你活动BGM', '期间限定海域BGM'])

const resourceIdOf = (file) => {
  for (const pattern of GAME_FILE_PATTERNS) {
    const matched = pattern.exec(file)
    if (matched) return Number.parseInt(matched[1], 10)
  }
  return null
}

// 曲名取 {{lang|ja|…}} 里的内容。注意曲名自己会带「」（新編「海上護衛隊」抜錨！），
// 所以只剥最外面那一对，不能按「非」」贪心切。
const songTitle = (bold) => {
  const matched = /\{\{lang\|ja\|([\s\S]*?)\}\}/.exec(`${bold ?? ''}`)
  if (!matched) return ''
  return matched[1]
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim()
    .replace(/^「/, '')
    .replace(/」$/, '')
    .trim()
}

/** 站方给「官方还没公布曲名」的占位写法，不是曲名 */
const isPlaceholder = (title) => !title || /^[（(]?曲名不明/.test(title)

// ---- 上游转写错误台账（形态照 scripts/lib/event-bonus.mjs 的 KNOWN_SOURCE_CONFLICTS）----
//
// **这一层的键没有人的判断，曲名有。** 号是从游戏原文件名读出来的（`124_8714.mp3`），
// 这部分中间确实没人插手；但曲名那一格是站方编辑**照官方公布的曲目表手打的日文**，
// 会打错。所以这个包不是「机器抄机器」，只有「号 → 文件名」那一半是。
//
// 台账钉的是「上游现在写的东西」（`upstream`）：对得上才打补丁；上游哪天改了、
// 或者改成了第三种写法，一律**不打**，只告警——源变了就该重新核，不该继续照旧改写。
// （这条纪律与 src/main/mg/quest-source-conflicts.ts 的指纹核对同源。）
export const KNOWN_TRANSCRIPTION_FIXES = Object.freeze([
  {
    id: 124,
    file: '124_8714.mp3',
    upstream: '決戦！北太平洋',
    official: '決戦！北大西洋',
    // 「太」与「大」差一笔，日文里差一整个大洋。三票独立指同一处：
    //  ① 官方曲目表：KanColle Original Sound Track vol.VI【雪】(KA2C-0010, 2021-04-07) Tr.23
    //     「決戦！北大西洋」——C2 运营推特公布的曲目表，电撃ホビーウェブ的实物评测逐曲抄录同值；
    //  ② EN Fandom「Music」页 `Sound_b_bgm_124.ogg` 的三列：
    //     ja=決戦! 北大西洋 / ro=Kessen! Kita-taiseiyou / en=Decisive Battle! North Atlantic
    //     ——罗马音 taiseiyou 只可能从「大西洋」来，「太平洋」是 taiheiyou；
    //  ③ wikiwiki.jp/kancolle「BGM」页全页 7 处「北大西洋」、0 处「北太平洋」。
    // 战场也对得上：这首的初出是 2018 初秋活动「抜錨！連合艦隊、西へ！」的 E-5 最终 Boss，
    // 而该图 kcwiki 抄下来的敌方点名逐字是「深海北大西洋艦隊 機動部隊III群」「深海北海潜水艦隊集団」，
    // 编成条件挂的是「Force H」「莱茵演习」——大西洋，不是太平洋。
    // 所以这不是「日英两个官方名互相打架」，是 zh.kcwiki 拆包页把「大」写成了「太」。
    why: '上游把「北大西洋」写成「北太平洋」（太/大 一笔之差）；官方曲目表、Fandom 三列、wikiwiki 全页三票一致',
    checkedAt: '2026-08-24',
  },
  // ---- 下面这条来自 2026-08-24 的**字形总校**（scripts/bgm-name-audit.mjs）----
  //
  // 拿官方 OST 九卷曲目表（scripts/ost-tracklists.json）把我们收的 158 个曲名铺开逐字比，
  // 揪出两笔「上游把日文新字体「撃」写成繁体「擊」」的转写错。一笔就是这条 136；
  // 另一笔在 109 头上——那格同日又查出改题问题，整条升格挪进了下面「悬案终审」块。
  //
  // **判据不是「参考表这么写」**——那份参考表自己就有一处「擊」（vol.VII Tr.10，
  // 恰好就是 136 这同一首曲），两个中文平台犯同一类错，不构成两票。真正的判据是：
  //  ① wikiwiki.jp/kancolle「BGM」页这两首都写「撃」（日文站，日文读者在维护）；
  //  ② 日文官方曲名一律用新字体：本包另外 11 个带「撃」的曲名（突撃/迎撃/反撃/攻撃…）
  //     没有一个写「擊」，上游自己在同一页上就是这么写的；
  //  ③ 「擊」是繁体/旧字体，日本官方碟面不用它——这不是两种正当写法之争，是转写漏字形。
  //
  // **约物不在射程里**（半角「!」vs 全角「！」）：上游自己两种混用，
  // 参考表也混用，wikiwiki 又是第三种口径——这一档没有判决力，一律不动。
  {
    id: 136,
    upstream: '母艦攻擊隊、発艦始め!',
    official: '母艦攻撃隊、発艦始め!',
    why: '「攻擊隊」应为「攻撃隊」（繁体转写错）；wikiwiki 写「母艦攻撃隊、発艦始め！」。约物（半角!）不动——那一档上游与各家都不统一，没有判决力',
    checkedAt: '2026-08-24',
  },
  // ---- 下面三条来自 2026-08-24 的**悬案终审**（铭·按号试听，提督逐号实听）----
  //
  // 109/122/123/152/153 五个号，本包与 EN Fandom 各说各话，且都不在现役图上，
  // 正式界面没有能挂 ♪ 的行。提督用调试门后的按号试听逐号听完，五桩全部闭案：
  //  · 122/123 **本包对**（Fandom 把那对写反了）——零改动，卷宗在 耳测清单-BGM.md 第五节；
  //  · 109 是同曲改题、152/153 是本包整对错位——落成下面三条。
  // 字形总校当时留过一条旁证，两头都应验了：152/153 在官方碟上的轨号相对本包编号
  // 是**倒的**（Tr.26/Tr.25），122/123 是顺的（Tr.21/Tr.22）——碟序与终审逐格同向。
  {
    id: 109,
    upstream: '出擊前夜',
    official: '決戦前夜',
    // 两层问题叠在同一格上：
    //  ① 字形：上游写繁体「擊」（08-24 字形总校首先逮住的就是这半截，当时台账只改到
    //     「出撃前夜」为止，因为这个号当时还在悬案里）；
    //  ② 改题：「出撃前夜」是旧题。官方 OST vol.VI【雪】(2021-04) Tr.7 收的正是这首，
    //     碟面曲名「決戦前夜」；wikiwiki BGM 页该行備考逐字自注「元のタイトルは「出撃前夜」」；
    //     EN Fandom 的英文名 Eve of the Final Battle 也从「決戦」来（出撃对应 sortie，对不上）。
    // 提督 2026-08-24 按号试听后报回的正是英文名 Eve of the Final Battle，并授权在新旧两题里
    // 取更合适的——采现行 OST 名（官方一手曲目表是曲名的最终出处，bgm-heard.ts 头注立的口径），
    // 旧题只在此注记里留档。用处：2018 冬活动前段海图画面曲（wikiwiki 用处列）。
    why: '上游停在旧题（且带繁体「擊」）；官方 OST vol.VI【雪】Tr.7 已改题「決戦前夜」，wikiwiki 備考自注元题，提督 08-24 实听坐实',
    checkedAt: '2026-08-24',
  },
  {
    id: 152,
    upstream: '沖に立つ波',
    official: '令和桃の節句',
    // 与 153 是**整对错位**（两个名字都真，上游把号安反了）。三票同向：
    //  ① 官推 @KanColle_STAFF 2020-03-03 公布这两首时的分工是
    //     「通常交戦曲【令和桃の節句】、艦隊決戦曲【沖に立つ波】」；
    //  ② wikiwiki 用处列同序：令和桃の節句＝2020 春活动道中戦闘、沖に立つ波＝同ボス戦闘；
    //  ③ 提督 2026-08-24 按号试听（认角色不认名）：152 是道中曲、153 是 Boss 决战曲
    //     ——与 EN Fandom 的排序一致，与本包相反。
    // 两名在官方 OST vol.VII【夕】上正相邻（Tr.25/26），上游相邻两行抄串与此不冲突。
    why: '与 153 整对错位：官推分工、wikiwiki 用处、提督实听（152=道中曲）三票同指「令和桃の節句」',
    checkedAt: '2026-08-24',
  },
  {
    id: 153,
    upstream: '令和桃の節句',
    official: '沖に立つ波',
    why: '与 152 成对互补：提督实听 153 是 Boss 决战曲，即官推的「艦隊決戦曲【沖に立つ波】」',
    checkedAt: '2026-08-24',
  },
])

/** 台账落地：只在上游仍旧写着那个错值时改写，其余情形一律不动、只告警。 */
const applyTranscriptionFixes = (battle, warnings) => {
  for (const fix of KNOWN_TRANSCRIPTION_FIXES) {
    const current = battle[fix.id]
    if (current === fix.upstream) {
      battle[fix.id] = fix.official
      continue
    }
    if (current === fix.official) {
      warnings.push(`资源 ${fix.id} 的转写台账可以退役了：上游已自行改成「${fix.official}」`)
      continue
    }
    warnings.push(
      `资源 ${fix.id} 的转写台账指纹对不上（上游现在是「${current ?? '没有这个号'}」，` +
        `台账记的是「${fix.upstream}」）——不打补丁，请重新核对`,
    )
  }
  return battle
}

const ENTRY = /(\d+)\.\s*<big><b>([\s\S]*?)<\/b><\/big>[\s\S]{0,240}?<flashmp3>([^<]+)<\/flashmp3>/g
const HEADING = /^(={2,4})\s*(.+?)\s*\1\s*$/gm

/**
 * @param {string} wikitext 「拆包BGM列表」页的 action=raw 原文
 * @returns {{
 *   battle: Record<number, string>,
 *   reused: Record<number, string[]>,
 *   unnamed: number[],
 *   warnings: string[],
 * }}
 */
export const parseKcwikiBgmList = (wikitext) => {
  const source = `${wikitext ?? ''}`
  const headings = [...source.matchAll(HEADING)].map((match) => ({
    level: match[1].length,
    title: match[2],
    start: match.index,
  }))
  const sectionAt = (index) => {
    let title = ''
    for (const heading of headings) {
      if (heading.start > index) break
      if (heading.level === 2) title = heading.title
    }
    return title
  }
  // 一个资源号一条记录：号 → { 出现过的文件名 → 曲名 }。
  // 分号收着是为了识别「同一个号被后来的活动改挂了别的曲」——那种号一律不发名。
  const byId = new Map()
  const warnings = []
  let skipped = 0
  for (const match of source.matchAll(ENTRY)) {
    if (!BATTLE_SECTIONS.has(sectionAt(match.index))) continue
    const file = match[3].trim()
    const id = resourceIdOf(file)
    if (id == null) {
      skipped += 1
      continue
    }
    if (!byId.has(id)) byId.set(id, new Map())
    const files = byId.get(id)
    const title = songTitle(match[2])
    const existing = files.get(file)
    if (existing !== undefined && existing !== title) {
      warnings.push(`资源 ${id} 的 ${file} 在页内出现两次且曲名不同：${existing} / ${title}`)
    }
    files.set(file, isPlaceholder(title) ? '' : title)
  }
  const battle = {}
  const reused = {}
  const unnamed = []
  for (const [id, files] of [...byId.entries()].sort((a, b) => a[0] - b[0])) {
    const titles = [...new Set([...files.values()].filter(Boolean))]
    // 号被复用（同一个号挂过两个不同的文件）：官方确实会把旧号腾给新活动的曲，
    // 页内 145 与 240 都是这样。资源路径里的版本键能分开它们，但站方对多数条目
    // 只留了上传名、拿不到版本键——分不开就不发名，别赌。
    if (files.size > 1) {
      reused[id] = titles
      continue
    }
    if (!titles.length) {
      unnamed.push(id)
      continue
    }
    battle[id] = titles[0]
  }
  if (skipped) {
    warnings.push(`${skipped} 条只有站方上传名（数字是序号不是资源号），按纪律丢弃`)
  }
  applyTranscriptionFixes(battle, warnings)
  return { battle, reused, unnamed, warnings }
}
