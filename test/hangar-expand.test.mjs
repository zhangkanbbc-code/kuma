// 格納庫増設（useitem 105，2026-06-26 实装）：逐槽抬高舰载机搭载上限。
//
// 用户实弹撞出来的缺口：这个端点艦素全仓零处理，道具走通用报酬路径记了 +1、
// 消耗没人扣，于是道具页的持有数一直停在消耗前。报文里**既没有 api_material
// 也没有 useitem 字段**，消耗只能按端点自扣——与开增设槽 / 结婚 / 泊地修理同族。
//
// 真样本来自账本 events 22606（token 已脱敏），逐字形状见 fixtures 里的 REAL_POST /
// REAL_BODY：post 的 `api_ship_id` 是**在籍 id**（游戏这个参数名起得有歧义），
// `api_slot_pos` **1-based**，响应的 `api_onslot_max` 是**整舰各格的新上限数组**。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  REAL_BODY,
  REAL_POST,
  capsBefore,
  feedHangarExpand,
  feedReducerOnly,
  fleetCapacities,
  lifeLog,
  reset,
  ships,
  toShip,
  useitemLog,
  useitems,
} from './fixtures/store-hangar-expand.mjs'
import * as kernelHangar from './fixtures/kernel-hangar.mjs'
import * as hoverRender from './fixtures/render-hangar-hover.mjs'

// 瑞鳳改二乙（mst 560）：主数据 maxEq = [18,15,15,2,0]，第 4 格扩到 3。
const ZUIHO = { 939: { mstId: 560, name: '瑞鳳改二乙', onslot: [18, 15, 15, 2, 0], maxEq: [18, 15, 15, 2, 0] } }

test('格納庫増設到达：useitem 105 −1，且这一笔进账本', () => {
  reset(ZUIHO)
  const sections = feedReducerOnly(REAL_POST, REAL_BODY)
  assert.equal(useitems()[105], 2, '道具没扣——回顾/史的持有数又会停在消耗前')
  assert.deepEqual(sections.sort(), ['ships', 'useitems'])
  // 道具变动要进账本，否则道具页的历史里这一笔凭空消失
  assert.equal(useitemLog().length, 1)
  assert.deepEqual(useitemLog()[0].changes, [{ id: 105, delta: -1, total: 2 }])
})

test('认不出是哪一艘也照扣：道具确实少了一个', () => {
  reset({}) // 账上没有 939（中途启动艦素）
  const sections = feedReducerOnly(REAL_POST, REAL_BODY)
  assert.equal(useitems()[105], 2)
  assert.deepEqual(sections, ['useitems'], '认不出舰就不该报 ships')
})

test('新上限落在舰上，且是整舰各格的数组、不是增量', () => {
  reset(ZUIHO)
  feedReducerOnly(REAL_POST, REAL_BODY)
  assert.deepEqual(ships()[939].onslotMax, [18, 15, 15, 3, 0])
  // 只抬上限、不补机：实测 expand 之后 api_onslot 仍是 2，要等补给才到 3
  assert.deepEqual(ships()[939].onslot, [18, 15, 15, 2, 0], '归约不该顺手改实载')
})

test('舰历记一条：哪一格、道具正名、上限几→几', () => {
  reset(ZUIHO)
  feedHangarExpand(REAL_POST, REAL_BODY)
  assert.equal(lifeLog().length, 1)
  const event = lifeLog()[0]
  assert.equal(event.kind, 'hangar_expand')
  assert.equal(event.rosterId, 939)
  assert.equal(event.mstId, 560)
  // api_slot_pos "4" 是 1-based：记的格位照写 4，取值要用下标 3
  assert.equal(event.detail.slot, 4)
  assert.equal(event.detail.before, 2, '旧上限该回落主数据 maxEq[3]')
  assert.equal(event.detail.after, 3)
})

// 同一格能扩不止一次。第二次若还拿主数据的原量作差，就会写出「2→4」这种
// 没发生过的事——所以上限必须落在舰上，第二次读实例值。
test('同一格扩第二次：旧上限读实例已存的上限，不是主数据原量', () => {
  reset(ZUIHO)
  feedHangarExpand(REAL_POST, REAL_BODY) // 2 → 3，实例上留下 onslotMax
  feedHangarExpand(REAL_POST, { api_onslot_max: [18, 15, 15, 4, 0] })
  assert.equal(lifeLog().length, 2)
  assert.deepEqual(
    lifeLog().map((one) => [one.detail.before, one.detail.after]),
    [[2, 3], [3, 4]],
    '第二次的旧上限写成 2 就是把没发生的「2→4」端给了用户',
  )
  assert.equal(useitems()[105], 1, '扩两次就该扣两个')
})

test('旧上限实在取不到就留 null，不拿原量冒充', () => {
  // 主数据还没到（maxEq 空）、实例也没扩过：before 无从谈起
  reset({ 939: { mstId: 560, onslot: [], maxEq: [] } })
  assert.deepEqual(capsBefore(939), [])
  feedHangarExpand(REAL_POST, REAL_BODY)
  assert.equal(lifeLog()[0].detail.before, null)
  assert.equal(lifeLog()[0].detail.after, 3, '新上限是一手的，任何时候都说得出')
})

test('报文残缺不落舰历：没有 api_onslot_max 就不编一条上限变化', () => {
  reset(ZUIHO)
  feedHangarExpand(REAL_POST, { api_result: 1 })
  assert.equal(lifeLog().length, 0)
})

// onslotMax 是**稀疏字段**：实测一份母港快照 433 艘舰里只有扩过的那 1 艘带
// api_onslot_max，其余舰连键都没有。而且只有整份舰娘数据（port / ship3）才带它,
// ship_deck / hokyu 这些局部报文一律不带——所以「这次没有」≠「这艘舰没扩过」。
test('没扩过的舰不长出上限域：缺项留 undefined，不写成空数组', () => {
  reset({})
  const plain = toShip({ api_id: 1, api_ship_id: 100, api_onslot: [0, 0, 0, 0, 0] })
  assert.equal(plain.onslotMax, undefined, '写成 [] 等于谎称每格都装不了飞机')
})

test('局部报文不带这个键时沿用账上已有的上限，不被抹掉', () => {
  reset(ZUIHO)
  feedReducerOnly(REAL_POST, REAL_BODY)
  assert.deepEqual(ships()[939].onslotMax, [18, 15, 15, 3, 0])
  // ship_deck 那类局部报文重建这艘舰时不带 api_onslot_max
  const rebuilt = toShip({ api_id: 939, api_ship_id: 560, api_onslot: [18, 15, 15, 3, 0] })
  assert.deepEqual(
    rebuilt.onslotMax,
    [18, 15, 15, 3, 0],
    '开一次编成画面就把上限抹掉，下次扩的「原来是几」就错了',
  )
})

test('整份舰娘数据带这个键时以报文为准', () => {
  reset(ZUIHO)
  const fresh = toShip({
    api_id: 939,
    api_ship_id: 560,
    api_onslot: [18, 15, 15, 3, 0],
    api_onslot_max: [18, 15, 15, 4, 0],
  })
  assert.deepEqual(fresh.onslotMax, [18, 15, 15, 4, 0])
})

// ---- 消费端：一手值取代观测推断层（2026-08-27 退役 shared/hangar-expansion）----
//
// 从前的判据是 `onslot > maxEq` 反推「这一格至少扩了多少」，还要一份棘轮记忆
// 对抗战损把实载压低。一手字段到账后整层删掉，消费端一律改读 onslotMax。
// 下面钉的就是这次替换的三件事：有一手值读一手值、没有的回落 maxEq、旧记忆不再进出。

// 瑞鳳（扩过第 4 格）与一艘没扩过的空母摆一起：两条路要在同一局里都走对
const EXPANDED = { 939: { mstId: 560, name: '瑞鳳改二乙', onslot: [18, 15, 15, 3, 0], onslotMax: [18, 15, 15, 3, 0], maxEq: [18, 15, 15, 2, 0] } }
const PLAIN = { 940: { mstId: 561, name: '没扩过的空母', onslot: [18, 15, 15, 2, 0], maxEq: [18, 15, 15, 2, 0] } }

test('编成桥的搭载容量读实例一手上限，没扩过的舰回落主数据 maxEq', () => {
  reset({ ...EXPANDED, ...PLAIN })
  const [zuiho, plain] = fleetCapacities([939, 940])
  // 扩过的那一格是 3（一手值），不是主数据的 2
  assert.deepEqual(zuiho.capacities, [18, 15, 15, 3, null], '第 5 格 maxEq=0，不搭飞机→null')
  assert.equal(zuiho.rosterId, 939)
  // 没扩过的舰连 onslotMax 键都没有，逐格回落主数据
  assert.deepEqual(plain.capacities, [18, 15, 15, 2, null])
})

test('战损把实载压到上限以下，一手值照样说得出真上限（旧证据在这里就哑了）', () => {
  // 出击一轮回来：第 4 格被打光，onslot 掉到 0。旧判据靠 onslot > maxEq 取证，
  // 这时 onslot(0) 不超过 maxEq(2)，只能给出 2——上限凭空缩水一机。
  reset({
    939: { mstId: 560, onslot: [18, 15, 15, 0, 0], onslotMax: [18, 15, 15, 3, 0], maxEq: [18, 15, 15, 2, 0] },
  })
  const [zuiho] = fleetCapacities([939])
  assert.equal(zuiho.capacities[3], 3, '一手上限与战损无关')
  assert.equal(zuiho.counts[3], 0, '搭载数仍照实写，不被容量顶替')
})

test('内核三件套：有一手值读一手值，没有的回落主数据原量', () => {
  kernelHangar.reset(
    { 939: { mstId: 560, onslotMax: [18, 15, 15, 3, 0] }, 940: { mstId: 560 } },
    { 560: [18, 15, 15, 2, 0] },
  )
  // 上限：扩过的格给一手值，其余给原量
  assert.equal(kernelHangar.hangarSlotCapacity(939, 3, 2), 3)
  assert.equal(kernelHangar.hangarSlotCapacity(939, 0, 18), 18)
  // 没扩过的舰：整艘回落调用方给的原量
  assert.equal(kernelHangar.hangarSlotCapacity(940, 3, 2), 2)
  // 在册表里没有这艘：也回落，不抛
  assert.equal(kernelHangar.hangarSlotCapacity(12345, 3, 2), 2)

  // 增量 = 一手值 − 主数据原量，方向不能反
  assert.equal(kernelHangar.hangarExpansionOf(939, 3), 1)
  assert.equal(kernelHangar.hangarExpansionOf(939, 0), 0, '没扩的格不出小字')
  assert.equal(kernelHangar.hangarExpansionOf(940, 3), 0, '没有一手值就是 0')
})

test('一手值比主数据低时不给负增量（主数据改版也不该显示 −1 机）', () => {
  kernelHangar.reset({ 939: { mstId: 560, onslotMax: [18, 15, 15, 1, 0] } }, { 560: [18, 15, 15, 2, 0] })
  assert.equal(kernelHangar.hangarExpansionOf(939, 3), 0)
  // 上限本身仍以一手值为准——那是游戏说的，不替它纠正
  assert.equal(kernelHangar.hangarSlotCapacity(939, 3, 2), 1)
})

test('onslotMax 稀疏：数组比槽位短的那些格照样回落，不当成 0', () => {
  kernelHangar.reset({ 939: { mstId: 560, onslotMax: [18, 15] } }, { 560: [18, 15, 15, 2, 0] })
  assert.equal(kernelHangar.hangarSlotCapacity(939, 2, 15), 15, '越界项是 undefined，不是 0')
  assert.equal(kernelHangar.hangarExpansionOf(939, 2), 0)
})

test('按形态回查只认在册实例，取增量最大的那艘并交回是谁', () => {
  kernelHangar.reset(
    {
      101: { mstId: 560, onslotMax: [18, 15, 15, 3, 0] }, // +1
      202: { mstId: 560, onslotMax: [18, 15, 15, 5, 0] }, // +3
      303: { mstId: 560 }, // 没扩过
      404: { mstId: 999, onslotMax: [9, 9, 9, 9, 9] }, // 别的形态
    },
    { 560: [18, 15, 15, 2, 0], 999: [1, 1, 1, 1, 1] },
  )
  // base 一并交回：图鉴页显示的原量来自 wiki 表，拿它去凑加法可能凑出不存在的上限
  assert.deepEqual(kernelHangar.ownedHangarExpansionOf(560, 3), { rosterId: 202, base: 2, extra: 3 })
  // 别的格没人扩过 → 不出小字（不外推到同形态的其他格）
  assert.equal(kernelHangar.ownedHangarExpansionOf(560, 0), null)
  // 一艘都没扩过的形态
  kernelHangar.reset({ 303: { mstId: 560 } }, { 560: [18, 15, 15, 2, 0] })
  assert.equal(kernelHangar.ownedHangarExpansionOf(560, 3), null)
})

// ---- 接线（渲染层打成 bundle，import 不进来的那部分只能查源码）----

test('观测推断层的旧记忆退场：除了那一次清空，谁也不再读写它', () => {
  const kernel = fs.readFileSync(new URL('../src/renderer/kernel.ts', import.meta.url), 'utf8')
  // 旧键的字面量只剩退场清理那一处（散文里追述这段历史不算）
  const literals = kernel.match(/'kernel\.hangarExpansion\.v1'/g) ?? []
  assert.equal(literals.length, 1, '旧存档键的字面量只该出现在退场清理那一行')
  assert.match(kernel, /uiSet\(RETIRED_HANGAR_MEMO_KEY, \{\}\)/)
  // 已经空了就别每次启动都写一遍盘
  assert.match(kernel, /if \(Object\.keys\(uiGet<Record<string, number>>\(RETIRED_HANGAR_MEMO_KEY, \{\}\) \?\? \{\}\)\.length\)/)
  // 观测层整个没了：不再有折叠、棘轮记忆与那一拍延时落盘
  assert.doesNotMatch(kernel, /observeHangarExpansion|foldHangarObservations|hangarSaveTimer/)
  // 补丁链上也不该再挂观测
  assert.doesNotMatch(kernel, /keys\.includes\('ships'\) \|\| keys\.includes\('master'\)/)
})

test('推断层文件已删，全仓无残留 import', () => {
  const root = new URL('../', import.meta.url)
  assert.equal(
    fs.existsSync(new URL('src/shared/hangar-expansion.ts', root)),
    false,
    '文件头的遗嘱：一手字段现身就整个删掉',
  )
  const walk = (dir) => {
    const out = []
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir)
      if (entry.isDirectory()) out.push(...walk(full))
      else if (/\.(ts|mjs)$/.test(entry.name)) out.push(full)
    }
    return out
  }
  // 针本身写着这个模式，扫到自己会永远红——把这一份排掉（这就是自指的代价）
  const self = fileURLToPath(import.meta.url)
  // 拼出来而不是写成字面量：否则下面的正则又会在本文件里撞上自己
  const needle = new RegExp(`from '[^']*hangar-${'expansion'}'`)
  const offenders = []
  for (const file of [...walk(new URL('src/', root)), ...walk(new URL('test/', root))]) {
    const full = fileURLToPath(file)
    if (full === self) continue
    // 注释里追述这段历史是可以的，真 import 不行
    if (needle.test(fs.readFileSync(full, 'utf8'))) offenders.push(full)
  }
  assert.deepEqual(offenders, [])
})

test('消费端读一手值：实验室判定输入、编队空格悬停、图鉴按形态指名', () => {
  const lab = fs.readFileSync(new URL('../src/renderer/modules/ji-lab.ts', import.meta.url), 'utf8')
  const fleet = fs.readFileSync(new URL('../src/renderer/modules/ru.ts', import.meta.url), 'utf8')
  const ji = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  const html = fs.readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8')

  // 弹着观测的搭载数前提吃这一格的实际上限
  assert.match(
    lab,
    /planeCount: index < \(shipMaster\?\.slotNum \?\? 0\)[\s\S]*?\? hangarSlotCapacity\(ship\.id, index, shipMaster\?\.maxEq\[index\] \?\? 0\)/,
  )
  // 显示两截分开：原量一个 <i>，增量另一个带悬停说明的 <i class="hx">
  assert.match(lab, /const extra = planeCap > 0 \? hangarExpansionOf\(ship\.id, index\) : 0/)
  assert.match(html, /\.mod-ji \.lab-slot \.k i\.hx \{/)
  // 原量那一截也挂 title，就得跟着给问号光标（增量小字才 9px，只有它可悬停等于摸不着）
  assert.match(html, /\.mod-ji \.lab-slot \.k i\[title\] \{ cursor: help; \}/)

  // 编队空格悬停：原量来自主数据 maxEq，增量另算，不合成一个数
  assert.match(fleet, /const cap = master\?\.maxEq\?\.\[i\] \?\? 0/)
  assert.match(fleet, /const extra = hangarExpansionOf\(ship\.id, i\)/)

  // 图鉴按形态展示：小字只在你自己那一艘上出现，且指名到 ID（不外推成形态属性）
  assert.match(ji, /const owned = ownedHangarExpansionOf\(shipState\.selectedForm, i\)/)
  assert.match(ji, /你的 ID \$\{owned\.rosterId\} 这一艘/)
  // 加法的两截都取 owned：页面上那个原量是 wiki 的初期搭载表，混着加会凑出假上限
  assert.match(ji, /搭载上限 \$\{owned\.base\}\+\$\{owned\.extra\}（格納庫増設）/)
  assert.doesNotMatch(ji, /搭载上限 \$\{load\[i\]\}/, '别拿 wiki 那个原量去凑加法')
  assert.match(ji, /含格納庫増設/)
  // 没有原量就不给孤零零的 +N
  assert.match(ji, /if \(load\[i\] == null\) return ''/)
  assert.match(html, /\.mod-ji \.slots \.slot \.hx \{/)

  // 「按实测推断」那个限定随推断层一起撤销：现在是游戏下发的一手值，再说「推断」
  // 就是自相矛盾。三处文案都不许留。
  for (const [name, text] of [['ji-lab', lab], ['ru', fleet], ['ji', ji]]) {
    assert.doesNotMatch(text, /按实测推断/, `${name} 里还留着推断层的限定语`)
    assert.doesNotMatch(text, /实测格納庫増設/, `${name} 里还留着推断层的限定语`)
  }
})

// ---- 悬停把容量拆成「原量+增量」（2026-08-27 用户点的）----
//
// 用户原话：「格纳库增设提供的额外搭载可以用如果有的话鼠标移上去用 n+n 表示吗」。
// 屏幕上本来就有个航空色的 +N 小字，缺的是**鼠标移上去说得出这是谁加的**：
// 悬停一句「搭载上限 2+1（格納庫増設）」，基础值 + 增设量 + 道具正名三样都在。
//
// 下面是行为级的：切真码渲染，对着产物 HTML 里的 title 下断言。上面那一组正则
// 匹配的是源码文本，分不出「${cap}+${extra}」和「${extra}+${cap}」，也拦不住
// 「extra > 0」写成「extra >= 0」——那会让没扩过的格冒出「18+0」。
//
// 原型取真事：瑞鳳改二乙（mst 560）主数据 maxEq [18,15,15,2,0]，第 4 格扩到 3。
const ZUIHO_MAX_EQ = [18, 15, 15, 2, 0]

test('悬停把扩过的那一格拆成 n+n，并报出道具正名（编成空格 / 实验室装备格）', () => {
  hoverRender.reset({ rosterId: 939, mstId: 560, onslotMax: [18, 15, 15, 3, 0] }, ZUIHO_MAX_EQ)

  // 锐的编成行：空装备格芯片的原生 title
  const chipTitles = hoverRender.titlesOf(hoverRender.renderEquipChips(939))
  assert.equal(chipTitles.length, 4, '主数据 slotNum=4，第 5 格不出芯片')
  const expanded = chipTitles[3]
  assert.match(expanded, /2\+1/, '拆分要写成 n+n，不是合成的 3、也不是反过来的 1+2')
  assert.match(expanded, /格納庫増設/, '悬停全文要带道具正名')
  assert.match(expanded, /第 4 格/, '原有的「第几格 · 空」要素不许被挤掉')

  // 鉴的组合实验室：原量 <i> 与增量 <i class="hx"> 各挂一份同样的 title
  const picker = hoverRender.renderSlotPicker()
  assert.match(picker, /<i title="搭载上限 2\+1（格納庫増設）">2<\/i>/)
  assert.match(picker, /<i class="hx" title="搭载上限 2\+1（格納庫増設）">\+1<\/i>/)
})

test('没扩过的格一切不变：不出 n+n、不提道具、也不冒出「+0」', () => {
  // 同一艘舰的其余三格（有一手值，但那几格没被抬高）
  hoverRender.reset({ rosterId: 939, mstId: 560, onslotMax: [18, 15, 15, 3, 0] }, ZUIHO_MAX_EQ)
  for (const title of hoverRender.titlesOf(hoverRender.renderEquipChips(939)).slice(0, 3)) {
    assert.doesNotMatch(title, /\+/, '没扩过的格不该出现加号')
    assert.doesNotMatch(title, /格納庫増設/)
  }

  // 整艘没扩过的舰：连 onslotMax 这个键都没有
  hoverRender.reset({ rosterId: 940, mstId: 560 }, ZUIHO_MAX_EQ)
  const plain = hoverRender.titlesOf(hoverRender.renderEquipChips(940))
  assert.deepEqual(plain, [
    '第 1 格 · 空 · 搭载 18',
    '第 2 格 · 空 · 搭载 15',
    '第 3 格 · 空 · 搭载 15',
    '第 4 格 · 空 · 搭载 2',
  ], '这一族的悬停与加这个功能之前逐字一致')
  const picker = hoverRender.renderSlotPicker()
  assert.match(picker, /<i>2<\/i>/, '原量照旧是个裸 <i>，不挂 title')
  assert.doesNotMatch(picker, /hx/, '没扩过就没有增量小字')
  assert.doesNotMatch(picker, /格納庫増設/)
})

test('增量可以大于 1（将来多次扩容），加法照样是「原量+增量」', () => {
  hoverRender.reset({ rosterId: 939, mstId: 560, onslotMax: [18, 15, 15, 5, 0] }, ZUIHO_MAX_EQ)
  const title = hoverRender.titlesOf(hoverRender.renderEquipChips(939))[3]
  assert.match(title, /搭载上限 2\+3（格納庫増設）/, '2+3=5：不是把 5 直接写出来，也不是 +1 写死')
})

test('战损把实载压光，悬停照样说得出真上限（拆分不看 onslot）', () => {
  hoverRender.reset(
    { rosterId: 939, mstId: 560, onslotMax: [18, 15, 15, 3, 0], slot: [0, 0, 0, 0, 0] },
    ZUIHO_MAX_EQ,
  )
  const title = hoverRender.titlesOf(hoverRender.renderEquipChips(939))[3]
  assert.match(title, /搭载上限 2\+1（格納庫増設）/)
})
