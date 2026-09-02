// 钥 · 设置的分类子顶栏。守三件事：
//   ① **表本身**：每张卡恰好归一类、没有「全部」页签、类名短到能当页签用。
//   ② **真渲染出来的那一屏**：把 yu.ts 连同一圈桩编出来跑，逐类数产物里的
//      `data-ycard`——漏一张、重一张、跑到别的类里去，这里当场红。
//      只断言源码文本是不够的：注册表少接一张卡，源码看着照样齐整。
//   ③ **两种形态各数一遍**：矿脉健康度、游戏音频链路自检都是维护者工具，
//      只在 `KANSO_DEBUG_UI=1` 下装配（发行版 22 张 / 调试 24 张）。
//      玩家那份产物里连那两张卡的影子都不许有。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import sections from '../dist/shared/settings-sections.js'
import { cardsIn, cardHtml, mountYu, tabsIn } from './fixtures/render-yu.mjs'

const {
  DEBUG_ONLY_CARDS,
  DEFAULT_SETTINGS_SECTION,
  SETTINGS_CARD_IDS,
  SETTINGS_SECTIONS,
  SETTINGS_SECTION_UI_KEY,
  isDebugOnlyCard,
  normalizeSettingsSection,
  settingsCardsOf,
  settingsSectionOf,
} = sections

const ROOT = fileURLToPath(new URL('..', import.meta.url))

test('运行诊断在版本读取失败时警告并显示失败标签', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'modules', 'yu.ts'), 'utf8')
  assert.match(source, /console\.warn\('\[kanso\] 版本读取失败', error\)/)
  assert.match(source, /kumaVersion === '版本读取失败'\s*\? '版本读取失败'/)
})
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

/** 两种形态：发行版（默认）与调试态 */
const SHAPES = [
  { name: '发行版', debugUi: false },
  { name: '调试态', debugUi: true },
]

// ---- ① 分类表本身 ----

test('分类表：每张卡恰好归一类，全表无重复、无孤儿', () => {
  const seen = new Map()
  for (const section of SETTINGS_SECTIONS) {
    for (const card of section.cards) {
      assert.ok(!seen.has(card), `${card} 同时挂在 ${seen.get(card)} 和 ${section.id} 两类下`)
      seen.set(card, section.id)
    }
  }
  assert.deepEqual([...seen.keys()], [...SETTINGS_CARD_IDS])
  for (const [card, id] of seen) assert.equal(settingsSectionOf(card), id)
  // 表里没有的 id 回 null：「不知道」不该被伪装成某一类
  assert.equal(settingsSectionOf('nonesuch'), null)
})

test('分类表：不设「全部」页签——十八张卡混在一起正是要治的病', () => {
  for (const section of SETTINGS_SECTIONS) {
    assert.notEqual(section.id, 'all')
    assert.ok(!/全部|所有/.test(section.label), `${section.id} 的类名是「${section.label}」`)
    // 一类只装一张卡说明这一类不成立，装满一半说明分类没起作用
    assert.ok(section.cards.length >= 2, `${section.id} 只有 ${section.cards.length} 张卡`)
    assert.ok(
      section.cards.length <= SETTINGS_CARD_IDS.length / 2,
      `${section.id} 一类就占了一半以上的卡，等于没分`,
    )
  }
  assert.ok(SETTINGS_SECTIONS.length >= 4 && SETTINGS_SECTIONS.length <= 6)
})

test('分类表：类名是页签上那两三个字，长了顶栏就得换行', () => {
  const labels = SETTINGS_SECTIONS.map((section) => section.label)
  assert.equal(new Set(labels).size, labels.length, '有两类重名')
  for (const label of labels) {
    assert.ok(label.length >= 2 && label.length <= 3, `「${label}」不是两三个字`)
  }
})

test('分类表：存下来的那一格认不出就回默认，不渲染成空白页', () => {
  assert.equal(normalizeSettingsSection('lode'), 'lode')
  for (const bogus of ['', 'all', 'ALL', null, undefined, 7, {}]) {
    assert.equal(normalizeSettingsSection(bogus), DEFAULT_SETTINGS_SECTION)
  }
  assert.ok(SETTINGS_SECTIONS.some((section) => section.id === DEFAULT_SETTINGS_SECTION))
  assert.ok(settingsCardsOf(DEFAULT_SETTINGS_SECTION).length > 0)
  assert.deepEqual(settingsCardsOf('nonesuch'), [])
  assert.deepEqual(settingsCardsOf('nonesuch', true), [])
})

test('分类表：维护者工具卡默认不出——`debugUi` 不给就按发行版算', () => {
  assert.ok(DEBUG_ONLY_CARDS.length >= 1, '一张维护者工具卡都没有，这一档就落空了')
  for (const card of DEBUG_ONLY_CARDS) {
    assert.ok(SETTINGS_CARD_IDS.includes(card), `${card} 不在分类表里，却被标成了调试卡`)
    assert.equal(isDebugOnlyCard(card), true)
  }
  assert.equal(isDebugOnlyCard('zoom'), false)
  // 漏传 debugUi 的调用方拿到的必须是发行版形态：默认少一张，好过默认漏给玩家
  for (const section of SETTINGS_SECTIONS) {
    assert.deepEqual(settingsCardsOf(section.id), settingsCardsOf(section.id, false))
    assert.deepEqual(settingsCardsOf(section.id, true), [...section.cards])
  }
})

test('分类表：抽掉维护者工具卡之后，没有一类被掏空或只剩一张', () => {
  for (const section of SETTINGS_SECTIONS) {
    const release = settingsCardsOf(section.id)
    assert.ok(release.length >= 2, `发行版里「${section.label}」只剩 ${release.length} 张卡`)
  }
  const release = SETTINGS_SECTIONS.flatMap((section) => [...settingsCardsOf(section.id)])
  assert.equal(release.length, SETTINGS_CARD_IDS.length - DEBUG_ONLY_CARDS.length)
  // 22：2026-08-29 给魔改玩家铺路时添了「魔改文件夹」（诊断类，紧跟缓存修复），
  // 发行版那一列第一次从 18 变到 19；2026-08-30 又添了「游戏页面网址」
  //（网络类，紧跟代理）到 20，同日的游戏画面缩放两档添了「游戏画面」
  //（界面类，紧跟界面缩放）到 21；2026-08-31 字幕跟着游戏倍率缩放时添了
  //「字幕字号」（界面类，紧跟游戏画面）到 22。四张都是**玩家卡**，不在调试门后。
  assert.equal(release.length, 22, '发行版的卡数变了——两种形态的数字都要重新对一遍')
  // 24：2026-08-26 拔掉战斗演出族时撤走了「索敌飞机 · Δ 校准」那张维护者卡（19），
  // 同日修语音滑条时又添了「游戏音频链路自检」（20）。那两张都只在调试门后装配，
  // 所以发行版那一列在 2026-08-29 之前自始至终是 18；之后添的四张玩家卡两列同涨。
  assert.equal(SETTINGS_CARD_IDS.length, 24, '调试态的卡数变了')
})

// ---- ② 把钥编出来真渲染一遍 ----
//
// 渲染出口在 test/fixtures/render-yu.mjs（矿脉健康度那组护栏用的是同一副）：
// 把钥连同一圈桩编出来跑 mount，再从 innerHTML 上数。只断言源码文本是不够的——
// 注册表少接一张卡，源码看着照样齐整。

test('渲染产物：两种形态逐类数下来，每张卡恰好出现一次，一张不漏一张不多', () => {
  for (const shape of SHAPES) {
    const seen = []
    for (const section of SETTINGS_SECTIONS) {
      const expected = [...settingsCardsOf(section.id, shape.debugUi)]
      const yu = mountYu({ ui: { [SETTINGS_SECTION_UI_KEY]: section.id }, debugUi: shape.debugUi })
      const html = yu.pane.innerHTML
      assert.deepEqual(
        cardsIn(html),
        expected,
        `${shape.name}「${section.label}」摆出来的卡与分类表对不上`,
      )
      // `.ycard` 的个数必须等于身份标记的个数：有壳没身份的卡分不进任何一类
      assert.equal(
        (html.match(/class="ycard"/g) ?? []).length,
        expected.length,
        `${shape.name}「${section.label}」有卡没带 data-ycard`,
      )
      seen.push(...cardsIn(html))
    }
    const all = shape.debugUi
      ? [...SETTINGS_CARD_IDS]
      : SETTINGS_CARD_IDS.filter((card) => !isDebugOnlyCard(card))
    assert.deepEqual(seen.sort(), all.sort(), `${shape.name}：五类加起来不是全部的卡`)
    assert.equal(new Set(seen).size, seen.length, `${shape.name}：有卡出现在两类里`)
  }
})

test('渲染产物：每张卡都真画出了抬头，不是一个空壳', () => {
  for (const shape of SHAPES) {
    for (const section of SETTINGS_SECTIONS) {
      const html = mountYu({
        ui: { [SETTINGS_SECTION_UI_KEY]: section.id },
        debugUi: shape.debugUi,
      }).pane.innerHTML
      for (const card of settingsCardsOf(section.id, shape.debugUi)) {
        const body = cardHtml(html, card)
        assert.ok(body, `${shape.name}：${card} 没渲染出来`)
        const title = /<div class="h"><b>([^<]+)<\/b>/.exec(body)
        assert.ok(title && title[1].trim(), `${shape.name}：${card} 没有抬头标题`)
      }
    }
  }
})

// ---- ③ 维护者工具卡的那道门 ----

test('发行版：矿脉健康度整张不装配，连拉包指路的字样都带不进来', () => {
  // 2026-08-24 用户拍板：「既然不随包玩家那边看不到，多此一举写这些干什么」。
  // 缺包/停更/新鲜度是维护者的责任区，玩家侧的信号在各栏目就地的占位上。
  const html = mountYu({ ui: { [SETTINGS_SECTION_UI_KEY]: 'lode' }, lodes: [] })
  const settled = html.pane.innerHTML
  assert.ok(!cardsIn(settled).includes('lode-health'), '发行版里还摆着矿脉健康度')
  assert.ok(!settled.includes('矿脉健康度'), '卡撤了，标题却从别处漏出来了')
  // 那张卡是这些字样在钥里唯一的落点；卡不在，它们一个都不该出现
  for (const ghost of ['更新数据包', 'tsunkit', '需要手动导入', 'lodes:fetch', '没有随发行版']) {
    assert.ok(!settled.includes(ghost), `发行版的设置里出现了「${ghost}」`)
  }
})

test('发行版：游戏音频链路自检整张不装配，连一个计数字样都带不进来', () => {
  // 它报的是钩子装在哪些帧、哪条捕获路记下过地址——玩家看不懂也无从下手，
  // 那三条滑条响不响才是他那边的信号。
  const settled = mountYu({ ui: { [SETTINGS_SECTION_UI_KEY]: 'ui' }, lodes: [] }).pane.innerHTML
  assert.ok(!cardsIn(settled).includes('game-audio-selftest'), '发行版里还摆着音频自检')
  assert.ok(!settled.includes('游戏音频链路自检'), '卡撤了，标题却从别处漏出来了')
  for (const ghost of ['FileReader', 'objectURL', 'WebAudio', '读一次']) {
    assert.ok(!settled.includes(ghost), `发行版的设置里出现了「${ghost}」`)
  }
  // 同一类里那张玩家卡必须还在——撤的是自检，不是音量
  assert.ok(cardsIn(settled).includes('game-audio'), '把游戏音量那张卡一起撤掉了')
})

test('调试态：游戏音频链路自检回来了，就摆在游戏音量后面', () => {
  const cards = cardsIn(
    mountYu({ ui: { [SETTINGS_SECTION_UI_KEY]: 'ui' }, lodes: [], debugUi: true }).pane.innerHTML,
  )
  assert.ok(cards.includes('game-audio-selftest'), '调试态也没有音频自检——门关死了')
  assert.equal(settingsSectionOf('game-audio-selftest'), 'ui')
  assert.ok(
    cards.indexOf('game-audio') < cards.indexOf('game-audio-selftest'),
    '自检跑到了它诊断的那张卡前面',
  )
})

test('魔改文件夹：玩家卡，紧跟缓存修复，按钮走主进程开目录', () => {
  // 这张卡是玩家侧入口（不在调试门后），并且**不许在渲染层直接 require electron 开路径**：
  // 目录要先幂等建出来，那件事只有主进程做得了（见 main/kcs-resource 的 ensureModDir）。
  const yu = mountYu({ ui: { [SETTINGS_SECTION_UI_KEY]: 'health' } })
  const cards = cardsIn(yu.pane.innerHTML)
  assert.ok(cards.includes('mod-dir'), '发行版里没有「魔改文件夹」这张卡')
  assert.equal(settingsSectionOf('mod-dir'), 'health')
  assert.ok(
    cards.indexOf('cache-repair') < cards.indexOf('mod-dir'),
    '魔改文件夹该紧跟着缓存修复——两张卡说的是同一个目录',
  )
  const card = cardHtml(yu.pane.innerHTML, 'mod-dir')
  assert.match(card, /<b>魔改文件夹<\/b>/)
  assert.match(card, /打开文件夹/)
  yu.click({ act: 'open-mod-dir' })
  assert.ok(yu.invoked.includes('yu:open-mod-dir'), '点了「打开文件夹」却没往主进程发')
})

test('发行版：连别的分类里也没有矿脉健康度漏出来', () => {
  for (const section of SETTINGS_SECTIONS) {
    const html = mountYu({ ui: { [SETTINGS_SECTION_UI_KEY]: section.id }, lodes: [] }).pane.innerHTML
    assert.ok(!html.includes('data-ycard="lode-health"'), `${section.label} 里漏出了矿脉健康度`)
  }
})

test('调试态：矿脉健康度回来了，且归在「资料」这一类', () => {
  const yu = mountYu({ ui: { [SETTINGS_SECTION_UI_KEY]: 'lode' }, lodes: [], debugUi: true })
  const cards = cardsIn(yu.pane.innerHTML)
  assert.ok(cards.includes('lode-health'), '调试态也没有矿脉健康度——门关死了')
  assert.equal(settingsSectionOf('lode-health'), 'lode')
  // 次序也照表：健康度在矿脉数据包之前
  assert.ok(cards.indexOf('lode-health') < cards.indexOf('lode-packs'))
})

test('那道门与铭／锚的诊断模块是同一句，不是另发明的开关', () => {
  const gate = /process\.env\.KANSO_DEBUG_UI === '1'/
  assert.match(read('src/renderer/mu.ts'), gate, '铆那道门的写法变了，钥要跟着改')
  assert.match(read('src/renderer/modules/yu.ts'), gate, '钥没有沿用同一道门')
  // 判据本身在 shared，渲染层只把结果传进去（脱开 DOM 可测）
  assert.match(read('src/renderer/modules/yu.ts'), /settingsCardsOf\(\s*activeSection,\s*DEBUG_UI,?\s*\)/)
})

test('矿脉数据包那张卡不再引用「上面那张卡」——发行版里它不存在', () => {
  const yu = mountYu({ ui: { [SETTINGS_SECTION_UI_KEY]: 'lode' }, lodes: [] })
  const packs = cardHtml(yu.pane.innerHTML, 'lode-packs')
  assert.ok(packs, '矿脉数据包那张卡没渲染出来')
  assert.ok(!packs.includes('上面那张卡'), '还在指着一张发行版里不存在的卡')
})

// ---- ④ 页签本身 ----

test('页签：五个都在，选中的恰好一个，就是当前这一类', () => {
  for (const section of SETTINGS_SECTIONS) {
    const tabs = tabsIn(mountYu({ ui: { [SETTINGS_SECTION_UI_KEY]: section.id } }).pane.innerHTML)
    assert.deepEqual(
      tabs.map((tab) => tab[0]),
      SETTINGS_SECTIONS.map((s) => s.id),
      '页签次序该跟分类表一致',
    )
    assert.deepEqual(
      tabs.map((tab) => tab[2]),
      SETTINGS_SECTIONS.map((s) => s.label),
    )
    const on = tabs.filter((tab) => tab[1])
    assert.equal(on.length, 1, '选中的页签不是恰好一个')
    assert.equal(on[0][0], section.id)
  }
})

test('页签：点一下就换一类，并把这一格记进配置', () => {
  const yu = mountYu({ ui: { [SETTINGS_SECTION_UI_KEY]: 'ui' } })
  assert.deepEqual(cardsIn(yu.pane.innerHTML), [...settingsCardsOf('ui')])
  yu.click({ ysection: 'lode' })
  assert.deepEqual(cardsIn(yu.pane.innerHTML), [...settingsCardsOf('lode')])
  assert.deepEqual(
    tabsIn(yu.pane.innerHTML).filter((tab) => tab[1])[0][0],
    'lode',
    '换了内容但页签没跟着高亮',
  )
  assert.deepEqual(yu.writes(), [[SETTINGS_SECTION_UI_KEY, 'lode']])
})

test('页签：认不出的类名不会把面板打成空白', () => {
  const yu = mountYu({ ui: { [SETTINGS_SECTION_UI_KEY]: 'ui' } })
  yu.click({ ysection: '../../etc' })
  assert.deepEqual(cardsIn(yu.pane.innerHTML), [...settingsCardsOf(DEFAULT_SETTINGS_SECTION)])
  // 已经在默认那一类上时，点一个认不出的名字等于没点，不该多写一次配置
  assert.deepEqual(yu.writes(), [])
})

test('页签：记忆真的从配置里读回来，不是每次都回默认', () => {
  for (const section of SETTINGS_SECTIONS) {
    const yu = mountYu({ ui: { [SETTINGS_SECTION_UI_KEY]: section.id } })
    assert.deepEqual(cardsIn(yu.pane.innerHTML), [...settingsCardsOf(section.id)])
  }
  // 没存过就落默认那一类
  assert.deepEqual(
    cardsIn(mountYu().pane.innerHTML),
    [...settingsCardsOf(DEFAULT_SETTINGS_SECTION)],
  )
})

test('页签：换一类就回到顶部，上一类翻到哪儿不跟过来', () => {
  const yu = mountYu({ ui: { [SETTINGS_SECTION_UI_KEY]: 'ui' } })
  yu.pane.app.scrollTop = 640
  yu.click({ ysection: 'network' })
  assert.equal(yu.pane.app.scrollTop, 0)
  // 点的是已经选中的那一类：不重渲、也不该把人拽回顶部
  yu.pane.app.scrollTop = 320
  yu.click({ ysection: 'network' })
  assert.equal(yu.pane.app.scrollTop, 320)
})

test('启动点亮那个开关：翻一下浮层入场当场跟着切，不用等重启', () => {
  const key = 'kanso.launchGlow'
  const yu = mountYu({ config: { [key]: false } })
  // 装配时先按配置对一次表（重试装配＝重读一次，与旁边那几个热切开关同一条）
  assert.deepEqual(yu.overlayEntrance(), [false], '装配时没按配置把浮层入场对上')
  yu.click({ toggle: key })
  assert.deepEqual(yu.overlayEntrance(), [false, true], '开了却要等下次重启才有浮层入场')
  yu.click({ toggle: key })
  assert.deepEqual(
    yu.overlayEntrance(),
    [false, true, false],
    '关了却没把浮层入场收掉——正在演的那一次也该当场收',
  )
})

test('界面提示那张卡：抬头写的生效时机不许和卡里那条自相矛盾', () => {
  const card = cardHtml(mountYu().pane.innerHTML, 'ui-hints')
  assert.ok(card, '产物里没有「界面提示」这张卡')
  const aux = /<span class="aux">([^<]*)<\/span>/.exec(card)
  assert.ok(aux, '这张卡的抬头没有生效时机那行小字')
  // 卡里最后那条（启动点亮动画）说的是「下次启动生效」。抬头要是光秃秃一句
  // 「即时生效」，同一张卡上就摆着两句打架的话——玩家照抬头信，结果是空等。
  if (/下次启动生效/.test(card)) {
    assert.notEqual(aux[1], '即时生效', '抬头说即时生效，卡里却有一条要等下次启动')
    assert.match(aux[1], /除外|注明/, '抬头没给那条例外留口子')
  }
})

test('切分类不重播浮层入场：产物里一个进场标记都没有', () => {
  const yu = mountYu({ ui: { [SETTINGS_SECTION_UI_KEY]: 'ui' } })
  yu.click({ ysection: 'archive' })
  assert.ok(!/data-kanso-open/.test(yu.pane.innerHTML))
  // 入场只挂在「开浮层那一瞬间」（铆的 openOverlay），钥自己一次都不许放
  const source = read('src/renderer/modules/yu.ts')
  assert.ok(!/playOverlayEntrance|openOverlay/.test(source), '钥里出现了浮层入场的调用')
})

test('一个面板一个滚动条：滚动只给 .yu-app，页签行窄了换行而不是横着滚', () => {
  const skin = read('src/renderer/index.html')
  const block = skin.slice(skin.indexOf('══ 钥 · 设置'), skin.indexOf('══ 史 · 回顾'))
  const scrollers = [...block.matchAll(/^\s*\.mod-yu ([\w.-]+)[^{]*\{([^}]*)\}/gm)].filter((hit) =>
    /overflow(-[xy])?:\s*(auto|scroll)/.test(hit[2]),
  )
  assert.deepEqual(
    scrollers.map((hit) => hit[1]),
    ['.yu-app'],
    '钥里冒出了第二个滚动容器',
  )
  const tabs = /\.mod-yu \.ytabs \{([^}]*)\}/.exec(block)
  assert.ok(tabs, '样式表里没有分类子顶栏')
  assert.match(tabs[1], /flex-wrap:\s*wrap/, '页签窄了要换行，不许藏内容')
  assert.ok(!/overflow/.test(tabs[1]), '页签行不许自带滚动条')
  assert.match(tabs[1], /position:\s*sticky/, '页签要常驻在顶部，翻到哪儿都能换类')
})

test('没有任何代码跳进钥的某一张卡；真要加，得连页签一起切', () => {
  // 2026-08-24 分页时逐处查过：全仓没有 activateModule('yu') / openOverlay('yu')，
  // 指路一律是文案（「钥 · 运行诊断」这种）。将来有人加一条程序化跳转，
  // 只把浮层打开是不够的——目标卡可能压根不在当前这一类里，人看到的是另一屏；
  // 更别说目标卡可能只在调试态存在。
  const offenders = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.ts')) {
        const text = fs.readFileSync(full, 'utf8')
        if (/(activateModule|openOverlay)\(\s*['"`]yu['"`]\s*\)/.test(text)) {
          offenders.push(path.relative(ROOT, full).split(path.sep).join('/'))
        }
      }
    }
  }
  walk(path.join(ROOT, 'src'))
  assert.deepEqual(
    offenders,
    [],
    '有代码直接把人送进钥了：请改走「带分类的入口」，否则落地的可能是另一类',
  )
})
