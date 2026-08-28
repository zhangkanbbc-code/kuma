import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

// map-intel.ts 自己 import 了别的 shared 模块（无扩展名），脱 dist 直接跑不起来；
// 与 enemy-comp-catalog-seen / abyssal-id-pin 几处一样走构建产物（npm test 先 build）。
import mapIntelModule from '../dist/shared/map-intel.js'

const { applyMapIntelCatalog, mapIntelNode, nodeDropCatalog } = mapIntelModule

// 2026-08-26 用户拍板 B 案：活动图途中点（P1 这类）的掉落改用上游那张
// **不分难度**的「ドロップ艦一覧」兜底，因为分难度那张「難易度別レア艦ドロップ」
// 上游只逐点收 boss 与个别点（实测 62-4 该区只有 8 张表，P1 出现 0 次）。
//
// 铁律：合算层**绝不能混进分难度层**——丙层里只许有丙的数据。
// 所以合算层存在图级 allDiffDrops（与 difficulties 平级），读取只走 nodeDropCatalog()，
// 而 nodeDropCatalog 会把「这一格是合算来的」一并交出来，展示层据此挂「不分难度」。

const NODE = (ships, enemyComps = []) => ({
  ships: ships.map((id) => ({ id })),
  emptyDrop: 'unknown',
  enemyComps,
})

// 一张两层都有数据的假图：D 是 boss（分难度层有），P1 是途中点（只有合算层），
// Q 两层都没有。合算层故意在 D 上也放了条目，且与丙层的**不一样**——
// 渗透一旦发生，下面的断言会立刻变色。
const FIXTURE = {
  schemaVersion: 1,
  maps: {
    '62-9': {
      source: '测试夹具',
      sourceUrl: 'https://example.invalid/',
      checkedAt: '2026-08-26',
      revision: 'test',
      difficulties: {
        甲: { nodes: { D: NODE([1]), P1: NODE([], [{ formation: '単縦', ships: [1501] }]), Q: NODE([]) } },
        丙: { nodes: { D: NODE([1]), P1: NODE([], [{ formation: '単縦', ships: [1501] }]), Q: NODE([]) } },
      },
      allDiffDrops: {
        D: [{ id: 7 }, { id: 8 }],
        P1: [{ id: 9 }, { id: 10 }],
      },
    },
  },
}

test('合算层不渗进分难度层:丙层输出只有丙自己的条目', () => {
  assert.equal(applyMapIntelCatalog(FIXTURE), true)

  // 分难度层的读取口完全不受合算层影响——D 点丙层只有 1，合算层的 7/8 一条都不许进
  const layer = mapIntelNode('62-9', 'D', '2026-08-26', '丙')
  assert.deepEqual(
    layer.ships.map((ship) => ship.id),
    [1],
  )

  // 途中点 P1 分难度层本来就是空的，mapIntelNode 照旧交出空——
  // 合算层有 9/10，但它不属于丙层，这里出现任何一个都是渗透
  const pooled = mapIntelNode('62-9', 'P1', '2026-08-26', '丙')
  assert.deepEqual(pooled.ships, [])

  // 展示层那一口也要一起钉：D 点走的是分难度层，合算层的 7/8 一条都不许混进来。
  // 只钉 mapIntelNode 是不够的——真出事的写法是「回退口顺手把两层并了」，
  // 那种写法 mapIntelNode 照旧干净，漏的是这一格。
  const shown = nodeDropCatalog('62-9', 'D', '2026-08-26', '丙')
  assert.deepEqual(
    shown.ships.map((ship) => ship.id),
    [1],
  )
  for (const id of [7, 8]) {
    assert.equal(
      shown.ships.some((ship) => ship.id === id),
      false,
      `合算层的 ${id} 渗进了丙层的展示目录`,
    )
  }
})

test('boss 点用分难度层,不打「不分难度」标注', () => {
  assert.equal(applyMapIntelCatalog(FIXTURE), true)
  const catalog = nodeDropCatalog('62-9', 'D', '2026-08-26', '丙')
  assert.deepEqual(
    catalog.ships.map((ship) => ship.id),
    [1],
  )
  // 这一格是丙层的事实，绝不能被标成「不分难度」，也不能混进合算层的 7/8
  assert.equal(catalog.allDifficulty, false)
})

test('途中点回退到合算层,并交出「这是合算」的判据', () => {
  assert.equal(applyMapIntelCatalog(FIXTURE), true)
  const catalog = nodeDropCatalog('62-9', 'P1', '2026-08-26', '丙')
  assert.deepEqual(
    catalog.ships.map((ship) => ship.id),
    [9, 10],
  )
  // 展示层就是靠这一位挂 chip；写反了 P1 会冒充丙层事实
  assert.equal(catalog.allDifficulty, true)
})

test('两层都没有的点交出空目录——「尚未收录」那句仍旧有它的位置', () => {
  assert.equal(applyMapIntelCatalog(FIXTURE), true)
  const catalog = nodeDropCatalog('62-9', 'Q', '2026-08-26', '丙')
  assert.deepEqual(catalog.ships, [])
  assert.equal(catalog.allDifficulty, false)
})

// ---- 展示层那一枚 chip（di.ts 进不来，只能按源码文本钉）----
// 文案是用户逐字给的，改字要连这条护栏一起改，别只改一边。
const di = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')

test('镝的掉落卡:合算层那一枚 chip 文案与判据都在,且挂在 allDifficulty 上', () => {
  assert.match(di, /node\.allDifficulty/)
  assert.match(di, /class="dp-flag alldiff" title="这一点的确认目录不分难度，含全部难度的记录">不分难度</)
  // 确认目录段与「你的实测」段必须用同一份目录，否则会出现
  // 「目录里列着、实测那边却不打勾」——两处都得是 nodeDropCatalog
  assert.equal(di.match(/nodeDropCatalog\(mapKey, letter, undefined, difficulty\)/g).length, 2)
})
