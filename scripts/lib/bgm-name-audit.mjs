// 曲名字形总校的**纯逻辑**（零 IO、零网络）。CLI 在 scripts/bgm-name-audit.mjs。
//
// 单独成模块的理由与 package-ignore 那一份相同：**判据要能被测试真跑一遍**。
// 分筐规则（哪种差异算发现、哪种是噪音）写反了，源码文本照样匹配得上，
// 而错的后果是「该改的字没改」——那正是这把尺子存在的意义。
//
// ## 拿官方 OST 曲目表校我们收的曲名
//
// 曲名在本仓有三层来源，两层经过人手：拆包层（站方编辑照官方曲目表**手打**）、
// 耳测层（提督亲耳听）。2026-08-24 一天之内就逮到三笔字形错：
// 124「北大西洋」被打成「北太平洋」（太/大）、109 与 136 把日文新字体「撃」
// 写成繁体「擊」。一笔之差不报错、不显眼，只有拿官方曲目表铺开逐字比才照得出来。
//
// ## 四个筐，只有一个筐要人看
//
//  ① **逐字相同**：官方表里有一条一模一样的 → 过。
//  ② **只差约物**：归一后相同（！全半角、括号、空格、中点）→ **不算发现**。
//     平台自己就不统一：vol.I 写「全艦娘、突撃!」半角，vol.VI 写「決戦！北大西洋」全角。
//     所以约物这一档在这份原料里没有判决力，一律不动我们的写法。
//  ③ **只差一两个字**：归一后编辑距离 1–2 → **这筐是重点**，逐条人看。
//  ④ **官方表里没有**：正常——游戏里响过的曲子远多于上碟的，活动新曲更要等下一卷。
//
// ## 这把尺子不判决什么，以及它自己也会错
//
// 碟序不是资源号，专辑收录也不等于游戏内实装：它只回答「我们写的这几个字与
// 官方碟面一致吗」，不回答「这个号叫什么」。
// 更要紧的是——首轮总校逮住的差异里**有四处是参考表自己错**（见 `REFERENCE_TYPOS`）。
// 所以「参考表与我们不一致」永远只是**待裁**，每条都要另找一票；
// 首轮用的是 wikiwiki.jp 的日文 BGM 页，因为出错的是中文平台的转写，
// 再拿另一个中文平台核等于同源自证（参考表自己也有一处「擊」，与 zh.kcwiki 同错）。

/**
 * 比对用的归一：**只吃约物**，一个汉字/假名都不许动。
 *
 * 归一掉的就是这份原料没有判决力的那部分：全半角标点、空格、中点的两种写法、
 * 波浪号。归一之后仍不同的，才是真差别。
 */
export const foldPunctuation = (name) =>
  `${name}`
    .replace(/！/g, '!')
    .replace(/？/g, '?')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/[〜～]/g, '~')
    .replace(/[・･]/g, '·')
    .replace(/，/g, '、')
    .replace(/[\s　]/g, '')

/** 归一后的编辑距离。**只用来分筐，不参与判决** */
export const editDistance = (a, b) => {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > 3) return 99
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[b.length]
}

/**
 * **参考表自己错的那几格**（首轮总校查实，2026-08-24）。
 *
 * 键是我们的写法，值记参考表怎么写、凭什么判它错。列在这里是为了不让这几条
 * 每跑一次就重新冒出来当「待裁」——它们已经裁完了，裁下来的结论是**我们对**。
 */
export const REFERENCE_TYPOS = new Map([
  [
    '海上護衛戦',
    '参考表 vol.I【暁】Tr.7 写成「海上護衛艦」（戦/艦）。wikiwiki 逐字写「海上護衛戦」，使用箇所「道中：1-5昼 家具：ジュークボックス収録曲」；「護衛戦」是这首曲的通名，「護衛艦」在日文里是另一个词（护卫舰）',
  ],
  [
    '捷号決戦前夜',
    '参考表 vol.VI【雪】Tr.1 写成「捷号作戦前夜」（決/作）。wikiwiki 逐字写「捷号決戦前夜」，使用箇所「2017秋イベント海域マップ(前段作戦)」——而 2017 秋活动的官方名就叫「捷号決戦！邀撃、レイテ沖海戦（前篇）」，「捷号決戦」是活动名本身',
  ],
  [
    'Trick or Fleet!',
    '参考表 vol.IX【護】Tr.7 写成「Trick of Fleet!」（or/of）。wikiwiki 逐字写「Trick or Fleet!」——万圣节曲，梗是 Trick or Treat，of 讲不通',
  ],
  [
    '母艦攻撃隊、発艦始め!',
    '参考表 vol.VII【夕】Tr.10 写成「母艦攻擊隊」（繁体擊）——**与 zh.kcwiki 犯的是同一类错**，两个中文平台同错不算两票。wikiwiki 写「母艦攻撃隊、発艦始め！」，我们这一格已按转写台账改成「撃」',
  ],
])

/**
 * **编辑距离撞上了，但根本不是同一首曲**。
 *
 * 两三个字的曲名天生就贴得近（「北鎮」与「母港」差两个字，可它们毫无关系），
 * 所以这一档不是错，是尺子的噪音。列出来免得每跑一次都要重新想一遍。
 */
export const NOT_THE_SAME_SONG = new Map([
  [
    '鎮守府秋刀魚祭り改三',
    '参考表撞上的是「鎮守府秋刀魚祭り改」（vol.V Tr.5）。这一族本来就有改/改二/改三三首（改二在 vol.VI Tr.17），改三比 vol.IX 还晚，没上碟而已',
  ],
  // 「出撃前夜」那条噪音裁定（撞 vol.I Tr.2「出撃」）已随 109 终审改题「決戦前夜」退役——
  // 新名逐字在碟（vol.VI Tr.7），不再产生撞距离。
  ['竜巻作戦', '参考表撞上的是 vol.II Tr.4 的「MI作戦」，两首不同的曲'],
  ['北鎮', '参考表撞上的是 vol.I Tr.1 的「母港」，两个字的曲名撞距离而已'],
  [
    '海原越えて',
    '参考表撞上的是 vol.V Tr.11 的「渚を越えて」，两首不同的曲。**这一格反倒是佐证**：官方九卷里查无「海原越えて」，与 wikiwiki 给它记的出典「開戦これくしょんパック」（不在 OST 系列里）对得上',
  ],
])

/**
 * 逐条分筐。
 *
 * @param {{albums: {vol: string, volName: string, tracks: {no: number, name: string, duration: string}[]}[]}} reference 官方曲目表
 * @param {{layer: string, tree: string, id: number, name: string}[]} ours 我们收的曲名
 */
export const auditBgmNames = (reference, ours) => {
  const byFolded = new Map()
  const flat = []
  for (const album of reference.albums ?? []) {
    for (const track of album.tracks ?? []) {
      const entry = {
        name: track.name,
        folded: foldPunctuation(track.name),
        where: `vol.${album.vol}【${album.volName}】Tr.${track.no}`,
        duration: track.duration,
      }
      flat.push(entry)
      if (!byFolded.has(entry.folded)) byFolded.set(entry.folded, [])
      byFolded.get(entry.folded).push(entry)
    }
  }

  const exact = []
  const punctOnly = []
  const nearMiss = []
  const absent = []
  for (const row of ours) {
    const folded = foldPunctuation(row.name)
    const hits = byFolded.get(folded)
    if (hits) {
      const verbatim = hits.find((hit) => hit.name === row.name)
      if (verbatim) exact.push({ ...row, at: verbatim.where })
      else punctOnly.push({ ...row, reference: hits[0].name, at: hits[0].where })
      continue
    }
    let best = null
    for (const entry of flat) {
      const d = editDistance(folded, entry.folded)
      if (d >= 1 && d <= 2 && (!best || d < best.d)) best = { d, entry }
    }
    if (!best) {
      absent.push(row)
      continue
    }
    nearMiss.push({
      ...row,
      d: best.d,
      reference: best.entry.name,
      at: best.entry.where,
      settled: REFERENCE_TYPOS.get(row.name) ?? null,
      noise: NOT_THE_SAME_SONG.get(row.name) ?? null,
    })
  }
  return {
    exact,
    punctOnly,
    nearMiss,
    absent,
    /** 真正要人看的那一档：既没裁成「我们对」，也没判成「不是同一首」 */
    pending: nearMiss.filter((row) => !row.settled && !row.noise),
    /** 官方表里那一首在哪一卷哪一轨（查不到给 null）——悬案着落用 */
    whereIs: (name) => byFolded.get(foldPunctuation(name))?.map((hit) => hit.where) ?? null,
  }
}
