import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.join(fileURLToPath(import.meta.url), '..', '..')
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

// 开图提醒（札 + 陆航）在**出击途中**反复弹出，2026-08-27 用户在活动图打到一半抓的：
// 触发信号是「取了某张海域的美术」，可进点、过场同样在取，它认不出你是在选图
// 还是已经踩在点上；8 秒防抖跨点位再加载也挡不住。这一刻补给与札都改不了了。
//
// 守在行为上而不是源码文本上：`if (mg.sortie?.active) return` 写反（漏个 `!`）
// 照样能匹配任何合理的正则，却把提醒变成「只在出击途中弹」——正是这条要防的。
// 办法是从编译产物里把 warnOnEventMapOpen 整段切出来真跑一遍，自由标识符
// 全部当参数注入（含 lastSallyCue，这样防抖状态跟着这一份闭包走）。
const DEPS = [
  'mg',
  'activeAreasNow',
  'fleetShips',
  'deckOnSortie',
  'inCombined',
  'currentSallyVerdict',
  'scopeShips',
  'airBaseReadiness',
  'showSortieReadinessToast',
  'AIR_BASE_TAB_ID',
  'lastSallyCue',
]

const cutWarnBody = () => {
  const bundle = read('dist/renderer/index.js')
  const head = /\bvar warnOnEventMapOpen = \(areaId, ts\) => \{/.exec(bundle)
  assert.ok(head, '编译产物里找不到 warnOnEventMapOpen —— 开图提醒被改名或被内联了')
  const open = bundle.indexOf('{', head.index + head[0].length - 1)
  let depth = 0
  let close = -1
  for (let i = open; i < bundle.length; i += 1) {
    if (bundle[i] === '{') depth += 1
    else if (bundle[i] === '}') {
      depth -= 1
      if (depth === 0) {
        close = i
        break
      }
    }
  }
  assert.ok(close > open, 'warnOnEventMapOpen 的函数体没能完整切出来')
  const body = bundle.slice(open + 1, close)
  for (const dep of DEPS) {
    assert.ok(
      new RegExp(`\\b${dep}\\b`).test(body),
      `函数体里已经没有 ${dep} 了：注入的依赖清单该跟着改，否则这条测试在测一个空壳`,
    )
  }
  return body
}

const cutDeckOnSortie = () => {
  const bundle = read('dist/renderer/index.js')
  const hit = /\bvar deckOnSortie = ([^;]+);/.exec(bundle)
  assert.ok(hit, '编译产物里找不到 kernel 的 deckOnSortie')
  return new Function('mg', `return ${hit[1]}`)
}

const EVENT_AREA = 62

/**
 * 一次可控的开图场景。默认：活动区 62、驻着中队、第1舰队有 2 艘未锁定、
 * 1 队陆航未补给——札与陆航两段都成立，母港态下必弹。
 */
const makeScene = ({ sortie = null, untagged = 2, short = 1, red = 0 } = {}) => {
  const toasts = []
  const mg = {
    sortie,
    airBases: [{ areaId: EVENT_AREA }],
    decks: [{ id: 1, mission: [0], ships: Array.from({ length: 6 }, (_, i) => i + 1) }],
  }
  const body = cutWarnBody()
  const make = new Function(...DEPS, `return (areaId, ts) => {${body}}`)
  const warn = make(
    mg,
    () => new Set([EVENT_AREA]),
    (deck) => deck.ships ?? [],
    cutDeckOnSortie()(mg),
    () => false,
    () => ({ kind: 'event', untagged }),
    (deck) => deck.ships ?? [],
    () => (short || red ? { short, red } : null),
    (title, detail, deckId, critical, ref) => toasts.push({ title, detail, deckId, critical, ref }),
    900,
    0,
  )
  return { mg, warn, toasts }
}

test('母港里打开活动图：札与陆航照常各出一段', () => {
  const { warn, toasts } = makeScene()
  warn(EVENT_AREA, 1_000_000)
  assert.equal(toasts.length, 1, '母港态该弹，这是这条提醒本来的用处')
  assert.equal(toasts[0].title, '活动海域 · 出击后永久打札')
  assert.match(toasts[0].detail, /第1舰队 2 艘未锁定 · 出击后永久打札/)
  assert.match(toasts[0].detail, /基地航空 1 队未补给/)
})

test('母港里只有陆航缺补给时，仍出陆航那一段', () => {
  const { warn, toasts } = makeScene({ untagged: 0 })
  warn(EVENT_AREA, 1_000_000)
  assert.equal(toasts.length, 1)
  assert.equal(toasts[0].title, '活动海域 · 基地航空队未就绪')
  assert.equal(toasts[0].detail, '基地航空 1 队未补给')
})

test('出击途中收到开图信号：一声不响（进点、过场取的也是同一批美术）', () => {
  const { warn, toasts } = makeScene({
    sortie: { active: true, practice: false, mapArea: EVENT_AREA, mapNo: 1 },
  })
  // 一趟出击会跨好几个点位，每个点位都可能再取一次美术
  warn(EVENT_AREA, 1_000_000)
  warn(EVENT_AREA, 1_020_000)
  warn(EVENT_AREA, 1_040_000)
  assert.deepEqual(toasts, [], '出击途中补给与札都已不可改，提醒无从执行，只剩打断')
})

test('演习途中同样不弹', () => {
  const { warn, toasts } = makeScene({
    sortie: { active: true, practice: true, mapArea: 0, mapNo: 0 },
  })
  warn(EVENT_AREA, 1_000_000)
  assert.deepEqual(toasts, [], '演习也已经开打了，改不了了')
})

test('回港之后再打开海区，照常弹——而且不被出击途中那些信号的防抖吃掉', () => {
  const sortie = { active: true, practice: false, mapArea: EVENT_AREA, mapNo: 1 }
  const { mg, warn, toasts } = makeScene({ sortie })
  warn(EVENT_AREA, 1_000_000)
  assert.deepEqual(toasts, [], '出击途中先该是静的')
  // 返港：store 把 sortie.active 落下（提醒查的是触发时刻的状态，没有「忘记复位」这条路）
  mg.sortie.active = false
  // 故意落在 8 秒防抖窗口之内：被挡掉的那几声不该顺手把防抖也用掉
  warn(EVENT_AREA, 1_001_000)
  assert.equal(toasts.length, 1, '回港后重新打开海区，这条提醒该回来')
  assert.equal(toasts[0].title, '活动海域 · 出击后永久打札')
})

test('8 秒防抖仍在：一张图会取好几份资源，母港态下也只弹一次', () => {
  const { warn, toasts } = makeScene()
  warn(EVENT_AREA, 1_000_000)
  warn(EVENT_AREA, 1_000_500)
  warn(EVENT_AREA, 1_003_000)
  assert.equal(toasts.length, 1)
  warn(EVENT_AREA, 1_009_000)
  assert.equal(toasts.length, 2, '过了防抖窗口该能再弹')
})
