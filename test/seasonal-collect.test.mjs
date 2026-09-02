// 「季节语音取现值」与「插入式扩展格」的护栏。
//
// 这一域里最会咬人的两类：
//  ① **合规**：一铺开就悄悄向游戏 CDN 连发几百次。它不报错，只是把玩家的
//     一次浏览变成对官方服务器的一次小型压测——发布门上明令的红线。
//  ② **对账**：扩展格与正式格同时摆出同一份实物（一份东西在一页上出现两次），
//     或者清单追上来之后扩展格赖着不走。两者写反了都不报错，只是显示得不对。
// 所以判据尽量做成**真调用**与数据级比对（纯策略层住在 shared 就是为了这个），
// 只有「渲染路径上不许出现某种调用」这类没法脱开 Electron 跑的才退回源码文本
//（见共享记忆 source-pattern-guards-miss-logic-bugs：源码正则挡不住判断写反）。
//
// ---- 2026-08-23：独立的「点收卷」整层退役 ----
// 用户原话「点收那单独那么一大堆栏就不要了吧，要不然图鉴确实『这里也有，那里也有』的」。
// 收的动作回归**舰娘自己页面的季节台词区**，所以本文件里原来那几条「清单分族/族排序/
// 清单铺开零请求」的判据，跟着 `buildSeasonalVoiceFamilies` / `orderSeasonFamilies` /
// `seasonEvidenceFromMountedKeys` 一起删了；耳测台账指得回季节包那一条早有更硬的同款
//（test/voice-playback-observations.test.mjs 逐条比 slot）。新的家在下面 ② 里守着。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

// 工作区路径里有中文，`new URL(...).pathname` 是百分号编码的，直接拿去 readdir 会 ENOENT
import { fileURLToPath } from 'node:url'

import { userDataPathIfAny } from '../scripts/lib/data-dir.mjs'
import collect from '../dist/shared/seasonal-collect.js'

const {
  VARIANT_TEXT_DASH,
  coexistingVariants,
  collectOutcomeOf,
  seasonalTakeOffered,
  unclaimedArchiveVariants,
  variantLabelOf,
} = collect

const snapshotFile = userDataPathIfAny('snapshots', 'kcsapi_api_start2_getData.json')
const hasSnapshot = Boolean(snapshotFile) && fs.existsSync(snapshotFile)

const src = (relative) =>
  fs.readFileSync(new URL(`../src/${relative}`, import.meta.url), 'utf8')

/** 剥掉注释再看代码：说明文字里必然还写着被禁的那几个词。 */
const stripComments = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n')

// ============================================================================
// ① 边界：主数据里没有「这是当季版」这个标记，界面不许冒充季节归属
// ============================================================================
//
// ⚠️ 立绘那一半 2026-08-23 晚随收藏格 UI 整层退役（用户拍板）。原来这里还有
// 「族名年份归属追得回上游」「清单落到主数据是精确的」「三档版本对账」三条，
// 判据本身随 `buildSeasonalArtFamilies` / `artCollectState` 一起删了。
// 立绘现在的展示面是图鉴画廊尾接的档案卡，护栏在 test/art-archive.test.mjs。

test('主数据里没有「这是当季版」这个标记——界面不冒充季节归属', {
  skip: !hasSnapshot && '本机没有 api_start2 快照',
}, () => {
  const master = JSON.parse(fs.readFileSync(snapshotFile, 'utf8')).body.api_data
  const fields = new Set()
  for (const row of master.api_mst_shipgraph) for (const key of Object.keys(row)) fields.add(key)
  // 2026-08-23 逐字段穷举的结论钉在这里：官方哪天真给了季节标记，这条会当场红，
  // 那时该把立绘侧从「版本对账」升级成「精确的季节归属」——而不是继续凭推断。
  for (const key of fields) {
    assert.doesNotMatch(key, /season|limited|kikan|event/i, `shipgraph 出现了疑似季节字段 ${key}`)
  }
  // 于是界面上不许出现「这一份是季节版」这种主张（措辞纪律：数据要诚实）。
  // 立绘侧 2026-08-23 晚拔掉收藏格与点收格之后，唯一还摆档案实物的地方是
  // 图鉴画廊尾巴那几张卡——纪律照旧钉在它身上。
  const ji = stripComments(src('renderer/modules/ji.ts'))
  const at = ji.indexOf('const archivedArtCellsHtml')
  assert.ok(at > 0, '找不到画廊尾巴那段')
  const cell = ji.slice(at, ji.indexOf('interface SeasonalArtEntry'))
  assert.equal(/这是季节版|当季版本|一定是季节/.test(cell), false, '档案卡主张了推不出来的季节归属')
  // 能精确拿到的只有版本号，所以卡上写的是版本号，不是季节名
  assert.match(cell, /版本 \$\{entry\.version\}/)
  // 采集钮同一条纪律：它取回的是「此刻挂在这个槽位上的那一段」，
  // **不主张**那就是这一行这一句——由字节对账说话。
  const take = ji.slice(ji.indexOf('const seasonalTakeHtml'), ji.indexOf('const seasonalVoiceHtml'))
  assert.match(take, /获取当前槽位音频/)
  // 「它对不对得上这一行，这里不做承诺」是防守性免责，按 2026-08-26 文案清扫裁定
  //（族 2）删。要防的事完全由下面这条反向断言守住，而且它才是真判据：
  // 措辞只要一主张归属就红，比钉一句免责话更硬。
  assert.equal(/就是这一句|一定是这一句|保证/.test(take), false, '采集钮承诺了推不出来的归属')
  assert.equal(/取这一句|取回这一行/.test(take), false, '采集钮把「取一次」写成了「取这一句」')
})

// ============================================================================
// ② 取现值：长在舰娘页的季节台词行上，一切请求点击驱动，没有任何批量入口
// ============================================================================

test('给不给采集钮：槽位推不出来不摆，已经有实物也不摆', () => {
  // 没听过 / 听过但没留下音频 → 给
  assert.equal(seasonalTakeOffered({ slot: 2 }, 'none'), true)
  assert.equal(seasonalTakeOffered({ slot: 2 }, 'heard'), true)
  // 档案里已经有实物 → 那一份在手上了，再取一次没有意义
  assert.equal(seasonalTakeOffered({ slot: 2 }, 'kept'), false)
  // 槽位推不出来 → 没有地址可点，**不硬造**
  assert.equal(seasonalTakeOffered({}, 'none'), false)
  assert.equal(seasonalTakeOffered({ slot: null }, 'none'), false)
  assert.equal(seasonalTakeOffered({ slot: undefined }, 'heard'), false)
  assert.equal(seasonalTakeOffered(null, 'none'), false)
  // 0 是个合法的数：这一处只管「包里有没有槽位」，不许被 falsy 判据顺手吃掉。
  // 「这个槽位号算不算得出地址」是渲染层再判的一道（`isPlayableVoiceId`）。
  assert.equal(seasonalTakeOffered({ slot: 0 }, 'none'), true)
  // 渲染层照这一处判，不另写一份（两处判据迟早分家）
  const ji = stripComments(src('renderer/modules/ji.ts'))
  assert.match(ji, /seasonalTakeOffered\(line, state\) \? seasonalTakeHtml\(mstId, line\.slot!\) : ''/)
  // 第二道：算不出地址的槽位号一枚钮都不摆（不是「官方没有」，是没有可点的东西）；
  // 只有「主数据还没同步」那一种才摆一句点不动的说明——它会随着进一次游戏自己消失。
  const take = ji.slice(ji.indexOf('const seasonalTakeHtml'), ji.indexOf('const seasonalVoiceHtml'))
  assert.match(take, /if \(!isPlayableVoiceId\(slot\)\) return ''/)
  assert.match(take, /if \(!voicePathname\(mstId, slot\)\) \{/)
  assert.match(take, /当前形态音轨尚未同步/)
})

test('季节台词区铺开时不发请求：采集钮上只有槽位参数，地址是点下去才算的', () => {
  const ji = stripComments(src('renderer/modules/ji.ts'))
  const begin = ji.indexOf('const seasonalTakeHtml')
  const end = ji.indexOf('const seasonalVoiceHtml')
  assert.ok(begin > 0 && end > begin, '找不到采集钮的渲染段')
  const render = ji.slice(begin, end)
  // 渲染期不算远端地址、不发探测——钮上只带 `舰/槽`，点下去那一刻才算地址
  assert.equal(/voiceUrl\(/.test(render), false, '渲染期算了远端取音地址')
  assert.equal(/shipImageUrl\(/.test(render), false, '渲染期算了远端取图地址')
  assert.equal(/probeVoiceSlot/.test(render), false, '渲染期发了探测')
  assert.equal(/<img/.test(render), false, '采集钮渲染期摆了图片')
  assert.match(render, /data-voice-take="\$\{mstId\}\/\$\{slot\}"/)
  // 季节段整体也不许发探测（三态只查本机档案索引）
  const seasons = ji.slice(end, ji.indexOf('interface KansoVoiceRow'))
  assert.equal(/probeVoiceSlot/.test(seasons), false, '季节段渲染期发了探测')
})

test('取现值只有点击这一个发起点，而且没有任何批量入口', () => {
  const ji = stripComments(src('renderer/modules/ji.ts'))
  const begin = ji.indexOf('function wireShipDetailPanel')
  const end = ji.indexOf('const ALWAYS_OPEN')
  assert.ok(begin > 0 && end > begin, '找不到舰娘详情面板的接线段')
  const wiring = ji.slice(begin, end)
  // 取音长在 click 回调里，且是 `data-voice-take` 那一枚钮触发的
  assert.match(wiring, /addEventListener\('click'/)
  assert.match(wiring, /closest<HTMLElement>\('\[data-voice-take\]'\)/)
  assert.match(wiring, /probeVoiceSlotDetailed\(mstId, slot, url\)/)
  // 一次点击一次请求：接线段里没有任何**遍历式**结构
  assert.equal(/\bfor \(|\bwhile \(|\.forEach\(/.test(wiring), false, '接线段里出现了逐格循环')
  assert.equal(
    (wiring.match(/probeVoiceSlotDetailed\(/g) ?? []).length,
    1,
    '取现值的探测不止一个发起点',
  )
  // 这个面板上另有一条更老的路：骨架行的探测钮（`probeVoiceSlot`）。
  // 两条各一个发起点，各自只在自己那一枚钮的 click 分支里算地址。
  assert.equal((wiring.match(/probeVoiceSlot\(/g) ?? []).length, 1, '骨架探测不止一个发起点')
  assert.equal((wiring.match(/voiceUrl\(/g) ?? []).length, 2, '算取音地址的地方不是那两枚钮各一处')
  // 全仓不许有批量入口。这条是发布门上的红线，写反了不报错——只是某天一次浏览
  // 变成对游戏服务器的几百连发。
  const files = []
  const walk = (dir) => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, item.name)
      if (item.isDirectory()) walk(full)
      else if (/\.(ts|js|mjs)$/.test(item.name)) files.push(full)
    }
  }
  walk(fileURLToPath(new URL('../src', import.meta.url)))
  assert.ok(files.length > 50, `只扫到 ${files.length} 个源文件，护栏没扫到东西`)
  for (const file of files) {
    const code = stripComments(fs.readFileSync(file, 'utf8'))
    assert.equal(
      /\b(probeAll|collectAll|fetchAll|prefetchAll|collectSeasonAll|probeSeason)\b/.test(code),
      false,
      `${file} 里出现了批量入口`,
    )
  }
})

test('采集与回放分工写在注释里：播放钮永不回退 CDN，采集钮不主张自己取到了哪一句', () => {
  const ji = src('renderer/modules/ji.ts')
  // 那条老纪律还在（过季按地址拼出来的音轨播的是平时那句，拿它当播放钮是骗人）
  assert.match(ji, /播放钮为什么只认档案、不认网络/)
  // 新钮不许把它推翻，得写清两者是两件事
  assert.match(ji, /「取现值」是另一件事/)
  assert.match(ji, /上面那条管的是\*\*回放\*\*/)
  // 回放那一支的地址仍旧只有两个来源：档案实物，或耳测台账确证「此刻挂的就是这一条」
  const seasons = stripComments(ji).slice(
    stripComments(ji).indexOf('const seasonalVoiceHtml'),
    stripComments(ji).indexOf('interface KansoVoiceRow'),
  )
  assert.match(seasons, /const liveUrl = mountedHere \? voiceUrl\(mstId, line\.slot!\) : null/)
  assert.equal(
    (seasons.match(/voiceUrl\(/g) ?? []).length,
    1,
    '季节段里算取音地址的地方不止「耳测确证」那一处',
  )
})

test('取回来之后的四种结论都是事实陈述，「和已有的一样」不当成失败', () => {
  assert.equal(collectOutcomeOf(['aaaa'], { verdict: 'kept', sha1: 'bbbb' }), 'new')
  assert.equal(collectOutcomeOf(['aaaa'], { verdict: 'kept', sha1: 'aaaa' }), 'same')
  assert.equal(collectOutcomeOf([], { verdict: 'absent' }), 'absent')
  assert.equal(collectOutcomeOf([], { verdict: 'blocked' }), 'blocked')
  assert.equal(collectOutcomeOf([], { verdict: 'error' }), 'error')
  // 指纹拿不到时**不许**推成「一样」：那会把写盘失败说成「本季没换季节版」
  assert.equal(collectOutcomeOf(['aaaa'], { verdict: 'kept' }), 'error')
  // 措辞：四句都只陈述发生了什么，不写「失败」这类词。
  // ⚠️ 必须先剥注释——记录「这一档不算失败」的那段说明里必然还写着「失败」，
  //   不剥就会拿正确的代码报错（同一个坑 art-archive 的护栏早踩过一次）。
  const ji = stripComments(src('renderer/modules/ji.ts'))
  // 2026-08-23 全组按「短句 + 解释挪进悬停」重写过一遍（用户：大量解释语句不该
  // 摆在玩家一眼扫过的位置）。钉的是**语义**：「一样」仍旧是一句陈述，不是失败。
  assert.match(ji, /same: '与现有档案一致'/)
  assert.match(ji, /new: '已获取并归档新音频'/)
  const texts = ji.slice(ji.indexOf('COLLECT_OUTCOME_TEXT'), ji.indexOf('const collectOutcomeHtml'))
  assert.equal(/出错了|没能收到/.test(texts), false, '取现值的结论写成了抱怨文案')
  assert.match(texts, /error: '获取失败 · 可重试'/)
  // 一眼扫过的那一行只留结论；说不清的成因挂悬停（COLLECT_OUTCOME_TITLE），不在行里铺开
  const body = texts.slice(texts.indexOf('{') + 1, texts.indexOf('}'))
  const lines = [...body.matchAll(/^\s*\w+: '([^']*)',$/gm)].map((match) => match[1])
  assert.equal(lines.length, 5, '五档结论没都取到，这条护栏在空转')
  for (const line of lines) assert.ok(line.length <= 16, `结论「${line}」太长，解释该挪进悬停`)
  assert.match(ji, /const COLLECT_OUTCOME_TITLE/)
  // 结论落在渲染的字符串里（不是取完直接改 DOM）：重渲染不会把刚才那句话吃掉
  assert.match(ji, /const collectOutcomes = new Map<string, CollectOutcome>\(\)/)
  assert.match(ji, /vo-take-out vo-take-\$\{outcome\}/)
  // 指纹由主进程连着结论一起交回来（不是拿「有没有新增条目」去推）
  assert.match(stripComments(src('main/voice-probe.ts')), /sha1 = createHash\('sha1'\)/)
  assert.match(stripComments(src('main/mg/index.ts')), /sha1: result\.sha1/)
})

test('独立的「点收卷」整层退役：图鉴回七卷，残件一个不留', () => {
  const ji = src('renderer/modules/ji.ts')
  for (const gone of [
    'data-collect-voice',
    'data-collect-family',
    'collectVoiceCellHtml',
    'collectCatalogHtml',
    'wireCollectBook',
    'buildCollectIndex',
    'collectState',
    'ji.collectFamily',
    'ji-collect-wrap',
    'collect-cell',
    'collect-fam',
    'collect-book',
  ]) {
    assert.equal(ji.includes(gone), false, `点收卷的残件还在：${gone}`)
  }
  // 卷序：实体各卷在前，列表/仓库紧跟其后，一共七卷
  const at = ji.indexOf('const BOOKS: [Book, string][] = [')
  assert.ok(at > 0, '找不到卷目录')
  const table = ji.slice(at, ji.indexOf('\n]', at))
  assert.deepEqual(
    [...table.matchAll(/'(\w+)'/g)].map((m) => m[1]),
    ['ship', 'equip', 'abyss', 'map', 'item', 'roster', 'stock'],
  )
  assert.match(ji, /type Book = 'ship' \| 'roster' \| 'equip' \| 'stock' \| 'abyss' \| 'map' \| 'item'\n/)
  // 导航历史的层键也不许再留一档 collect：还原时 Object.assign 会往不存在的状态上写
  assert.equal(/collect:\$\{/.test(ji), false, '导航历史里还留着点收那一层')
  // 专属 CSS 也一并拔掉（留着就是死样式，下一个人会以为还有那一卷）
  const html = fs.readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8')
  assert.equal(/\.collect-/.test(html), false, '点收卷的 CSS 还留着')
  // 分族清单那一层没有调用方了，策略层也不许留幻影
  const plan = src('shared/seasonal-collect.ts')
  for (const gone of ['buildSeasonalVoiceFamilies', 'orderSeasonFamilies', 'seasonEvidenceFromMountedKeys']) {
    assert.equal(plan.includes(gone), false, `分族清单的残件还在：${gone}`)
  }
})

// ============================================================================
// ③ 插入式扩展行（语音侧）：只从实物长出来，清单追上就让位
// ============================================================================

const take = (sha1, extra = {}) => ({ sha1, bytes: 100, type: 'full', ...extra })

test('扩展行只从实物长出来：没有实物就一行都不摆，占位条也不算', () => {
  assert.deepEqual(unclaimedArchiveVariants([], []), [])
  // bytes 为 0 的是「听过但没留下音频」，它长不出行
  assert.deepEqual(unclaimedArchiveVariants([take('aaaa', { bytes: 0 })], []), [])
  // 没有指纹的同理
  assert.deepEqual(unclaimedArchiveVariants([take('')], []), [])
})

test('正式行认领掉的那一份不会在扩展段里再出现一次——两套结构上不可能并存', () => {
  const entries = [take('aaaa'), take('bbbb'), take('cccc')]
  const claimed = ['aaaa']
  const expansion = unclaimedArchiveVariants(entries, claimed)
  assert.deepEqual(expansion.map((entry) => entry.sha1), ['bbbb', 'cccc'])
  assert.deepEqual(coexistingVariants(claimed, expansion), [])
  // 同一份重复出现在档案里也只长一行
  assert.deepEqual(
    unclaimedArchiveVariants([take('bbbb'), take('bbbb')], []).map((entry) => entry.sha1),
    ['bbbb'],
  )
})

test('升格合并：清单追录了对应条目，扩展行自动让位', () => {
  const entries = [take('aaaa'), take('bbbb')]
  // 清单还没收 bbbb：它长成扩展行
  assert.deepEqual(
    unclaimedArchiveVariants(entries, ['aaaa']).map((entry) => entry.sha1),
    ['bbbb'],
  )
  // 清单追上来 → 正式行把它认领走 → 扩展段随即为空（不是「藏起来」，是没有了）
  const after = unclaimedArchiveVariants(entries, ['aaaa', 'bbbb'])
  assert.deepEqual(after, [])
  assert.deepEqual(coexistingVariants(['aaaa', 'bbbb'], after), [])
})

test('扩展行的名字：有耳测证据才挂名分，没有就中性，且一律不主张文本', () => {
  const evidenced = variantLabelOf({ seasonTitle: '2025年盛夏季节', observedAt: '2026-08-22' })
  assert.equal(evidenced.evidenced, true)
  assert.match(evidenced.name, /2025年盛夏季节/)
  assert.match(evidenced.name, /耳测/)
  assert.match(evidenced.note, /2026-08-22/)
  const neutral = variantLabelOf(null)
  assert.equal(neutral.evidenced, false)
  assert.equal(neutral.name, '另一份实物')
  // 中性名不许写成某一季，也不许写抱怨文案
  assert.equal(/季节|盛夏|圣诞|失败|缺/.test(neutral.name), false)
  assert.match(neutral.note, /所属季节不明/)
  // 文字位是一根短横：这一行不主张任何台词（与骨架行同族）
  assert.equal(VARIANT_TEXT_DASH, '—')
})

test('语音侧的扩展行还接在既有渲染路径上，且播放零网络', () => {
  const ji = stripComments(src('renderer/modules/ji.ts'))
  // 语音侧：扩展行从档案实物长出来，按地址认领去重，不算进「文本行」的计数
  assert.match(ji, /const archiveVariantRows = /)
  assert.match(ji, /unclaimedArchiveVariants\(/)
  assert.match(ji, /- bareArchive\.length - variants\.length/)
  assert.match(ji, /vo-row vo-variant/)
  // 只播档案里那一份（`archivedVoiceTakes` 给的是 file://）
  const at = ji.indexOf('const archiveVariantRows')
  const variantSection = ji.slice(at, ji.indexOf('const regularVoiceHtml'))
  assert.equal(/voiceUrl\(|shipImageUrl\(/.test(variantSection), false, '扩展行走了网络地址')
  // ⚠️ 立绘侧的插入式扩展格 2026-08-23 晚随收藏格 UI 整层拔掉了（用户拍板）。
  // 它的展示面改成画廊尾接的档案卡，判据在 shared/art-archive-plan 的
  // `legacyArchivedArt`，护栏在 test/art-archive.test.mjs。别把这一套搬回来。
  for (const gone of ['const cgExpansionHtml', 'unlistedArtTypes(', 'cg-variant']) {
    assert.equal(ji.includes(gone), false, `立绘侧的扩展格回潮了：${gone}`)
  }
})
