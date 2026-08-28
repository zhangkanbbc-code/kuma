// 「点了没反应」护栏（2026-08-25）。
//
// 仓库自己的口径写在 di.ts 的 replayOpenError 头上：**打不开要在面板上说，
// 不能只写 console——正式包没有 DevTools，用户看到的只是「点了没反应」。**
// 图鉴的两条实体路由当初漏了这一条：openMap 与深海舰 open 查无 id 时都是裸
// `return`——从战斗回顾点一张归档还没并回来的活动图，或者点一个主数据尚未就绪
// 时的深海舰，屏幕上什么都不会发生。
//
// 两侧的文案都必须是**中性**的，理由各不相同，各自有一条测试钉着：
//   · 海域：退役活动图有 event_map_catalog 墓碑，归档到位就能开，写「查不到」是造谣；
//   · 深海舰：**深海舰根本不退役**（2026-08-25 拿真 start2 实测，见下面那条测试），
//     写「已随活动撤下」是编事实。
//
// 判据尽量落在结构上而不是单点正则（共享记忆 source-pattern-guards-miss-logic-bugs：
// 正则挡不住判断写反）：下面每一条钉的都是「这条早退分支里必须有什么、
// 以及它必须在 return 之前」，另加一条「回执真的能被看见」的样式对账
// ——只把字符串塞进 DOM 而没有样式，和静默 return 在玩家眼里一样。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const ji = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
const html = fs.readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8')

/** assert.match 失败会把整份 ji.ts（470KB）打进报告，这里只留判据本身。 */
const hasIn = (source, re, message) => assert.ok(re.test(source), message)

/** 取 `marker` 那个 `{` 起、到同缩进 `}` 为止的分支体。 */
const branchAt = (source, marker, closer) => {
  const start = source.indexOf(marker)
  assert.notEqual(start, -1, `找不到早退分支：${marker}`)
  const end = source.indexOf(closer, start)
  assert.notEqual(end, -1, `${marker} 没有可识别的结尾`)
  return source.slice(start, end)
}

test('海域实体查无 id 时必须给可见回执，不许静默 return', () => {
  const branch = branchAt(ji, 'if (!mapInfos.some((m) => m.api_id === id)) {', '\n  }')
  const notice = branch.indexOf('showMissNotice(')
  assert.notEqual(notice, -1, 'openMap 的查无分支又变回静默 return 了')
  assert.ok(
    notice < branch.indexOf('return'),
    'showMissNotice 排在 return 后面＝根本不会执行',
  )
  hasIn(branch, /showMissNotice\('map'/, '回执要落在海域卷上，玩家点的就是那一卷')
})

test('深海舰主数据未就绪时查无 id，必须给可见回执，不许静默 return', () => {
  const branch = branchAt(ji, 'if (!abyssalShips.has(id)) {', '\n    }')
  const notice = branch.indexOf('showMissNotice(')
  assert.notEqual(notice, -1, '深海舰 open 的查无分支又变回静默 return 了')
  assert.ok(notice < branch.indexOf('return'), 'showMissNotice 排在 return 后面＝根本不会执行')
  hasIn(branch, /showMissNotice\('abyss'/, '回执要落在深海卷上')
})

test('深海舰侧的措辞不许说「退役」——官方对深海段只增不删', () => {
  // 2026-08-25 拿工作区根的真 start2 实测：历年活动限定的深海 boss
  // （戦艦仏棲姫 ×12 / 欧州棲姫 ×6 / 深海鶴棲姫 ×6 / 防空埋護姫 ×3 /
  //  深海雨雲姫 ×6 / 深海日棲姫 ×6，另有 56 条バカンスmode）在活动结束多年后
  // 原样躺在 api_mst_ship 里。会随活动缩水的只有 api_mst_mapinfo。
  // 所以深海舰这条分支只可能是「主数据还没到」或「id 不对」，
  // 写成「已随活动退役」就是拿一个假事实糊弄玩家。
  const branch = branchAt(ji, 'if (!abyssalShips.has(id)) {', '\n    }')
  const text = branch.match(/showMissNotice\('abyss', '([^']*)'\)/)
  assert.ok(text, '深海舰回执的文案取不到')
  for (const banned of ['退役', '撤下', '撤掉', '不存在', '没有了', '活动结束']) {
    assert.ok(
      !text[1].includes(banned),
      `深海舰回执写了「${banned}」：深海舰不退役，官方对 api_mst_ship 深海段只增不删`,
    )
  }
  hasIn(text[1], /就绪|读取|稍后/, '深海舰回执要指向「资料还没到」这个方向')
})

test('回执得真的能被看见：进 DOM + 有样式 + 有关闭口', () => {
  // 渲染模板里出条
  hasIn(
    ji,
    /missNotice && missNotice\.book === activeBook[\s\S]{0,200}class="ji-miss-note"/,
    '回执没有渲进 ji 的面板模板（或不再按卷过滤）',
  )
  // 样式存在——只塞字符串不给样式，等于没显示
  hasIn(html, /\.mod-ji \.ji-miss-note \{/, 'index.html 里缺 .ji-miss-note 的样式')
  // 玩家关得掉，且关掉的是同一条状态
  hasIn(ji, /data-act="miss-close"/, '回执没有关闭口')
  hasIn(
    ji,
    /\[data-act="miss-close"\]'\)\?\.addEventListener\('click', \(\) => \{\s*missNotice = null/,
    '关闭钮没有接上 missNotice',
  )
  // 换一卷自然收起，回执不会跨卷挂着
  hasIn(
    ji,
    /activeBook = tab\.dataset\.book as Book[\s\S]{0,240}missNotice = null/,
    '换卷时没有清掉回执',
  )
})

test('海图侧的措辞不许说「没有了」——退役活动图按设计是永远可查的', () => {
  // 账本的 event_map_catalog 在关服时把活动图固化下来（retention 白名单里也钉着），
  // 归档 IPC 一回来 mergeArchivedEventMaps 就把它并回 mapInfos。所以 openMap
  // 落空的主因是启动后那段窗口期，不是「这张图退役了查不到」。
  // 写成「已退役/已撤下/查不到」就是跟自家设计唱反调，把可查的东西说成没有。
  const branch = branchAt(ji, 'if (!mapInfos.some((m) => m.api_id === id)) {', '\n  }')
  const text = branch.match(/showMissNotice\('map', '([^']*)'\)/)
  assert.ok(text, '海域回执的文案取不到')
  for (const banned of ['退役', '撤下', '撤掉', '查不到', '没有了', '不存在']) {
    assert.ok(
      !text[1].includes(banned),
      `海域回执写了「${banned}」：退役活动图有墓碑、归档到位就能开，别断言它没了`,
    )
  }
  hasIn(text[1], /读取|读不到|稍后/, '海域回执要指向「还在读」这个方向')
})

test('归档到位后替玩家补开那张图，且回执被撤掉才不补', () => {
  const loader = branchAt(ji, 'const loadEventArchives = () => {', '\n}\n')
  hasIn(loader, /pendingMapOpen/, '归档回来后没有处理窗口期里点过的那张图')
  hasIn(
    loader,
    /if \(pending != null && missNotice\?\.book === 'map'\)/,
    '补开没有看回执还在不在——换卷/按 ✕ 就是「这事我不要了」，别把人硬拽回来',
  )
  hasIn(loader, /openMap\(pending\)/, '并回来了却不补开')
  // 失败分支也得如实说，不能让「还在读取」一直挂着
  hasIn(
    loader,
    /catch[\s\S]*pendingMapOpen = null[\s\S]*missNotice = \{ book: 'map'/,
    '归档读失败时回执还挂着「还在读取」，那就是骗人',
  )
})
