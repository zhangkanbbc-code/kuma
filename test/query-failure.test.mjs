import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const read = (rel) => fs.readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8')

// 「拿不到就显示占位，绝不硬造」这条纪律原先只覆盖了外部矿脉包，没覆盖自家账本：
// ledger 的每个查询方法各自 catch，失败一律返回空值，于是 UI 把故障说成
// 「你还没在任何海域捞到过这一舰」「尚无这项远征的记录」。
// 而渲染层已经写好的 .catch() 因为异常被下层吞掉，全成了死代码。

const UI_QUERIES = [
  'queryActionEvents', 'queryFactoryStats', 'queryUseitemSummary', 'queryUseitemHistory',
  'queryRecentUseitemChanges', 'queryDeltaSummary', 'queryMaterials', 'queryMaterialWindow',
  'queryExpeditionHistory',
  'queryBattleSnapshots', 'queryBattleRun', 'queryBattleSnapshot', 'queryShipLife', 'queryBossKills',
  'queryShipMemorial',
  'queryEventArchives', 'abyssSeenMaps', 'queryShipDropSites', 'abyssKillStats',
  'queryEncountersAt', 'queryNodeHistoryIndex', 'queryNodeDropIndex', 'queryNodeHistory',
  'queryNodeDrops', 'queryRouteStats',
  'queryEventSortieCosts', 'querySortieForecast', 'queryMapChronicle',
  'queryFitObservations',
]

const methodBody = (source, name) => {
  const at = source.indexOf(`  ${name} = (`)
  if (at < 0) return null
  const rest = source.slice(at + 3)
  const next = rest.search(/\n  [a-zA-Z][a-zA-Z0-9]* = \(/)
  return next < 0 ? rest : rest.slice(0, next)
}

test('every UI-facing ledger query surfaces its failure instead of returning an empty result', () => {
  const ledger = read('main/mg/ledger.ts')
  for (const name of UI_QUERIES) {
    const body = methodBody(ledger, name)
    assert.ok(body, `${name} 不在 ledger 里了，请更新这张清单`)
    if (!/\} catch/.test(body)) continue
    assert.match(body, /\} catch \((\w+)\) \{[\s\S]*?throw \1/, `${name} 失败时必须抛出，不能返回空值冒充「没有数据」`)
  }
})

test('startup rehydration still swallows its failures so the app can boot', () => {
  // 与上面相反：load* 是启动回灌，读不出来要降级为空状态继续启动，
  // 抛出去会让应用直接起不来。这条边界不能被上一条顺手改掉。
  const ledger = read('main/mg/ledger.ts')
  for (const name of ['loadDomainState', 'loadQuestProgress', 'loadShipLifeState']) {
    const body = methodBody(ledger, name)
    assert.ok(body, `${name} 不在 ledger 里了`)
    assert.doesNotMatch(body, /throw /, `${name} 是启动回灌，失败必须降级而不是抛出`)
  }
})

test('panels say the read failed rather than showing an empty result as fact', () => {
  // 每处都要能区分「确实没有」和「读不出来」，且给得出重试
  assert.match(read('renderer/modules/shi.ts'), /本地账本读取失败[\s\S]*?data-shi-retry/)
  assert.match(read('renderer/modules/zi.ts'), /本地资源账本读取失败[\s\S]*?data-act="zi-retry"/)
  assert.match(read('renderer/modules/ji.ts'), /遭遇志读取失败[\s\S]*?data-ship-drops-retry/)
  // 2026-08-26 文案清扫按族 5（「读取失败，不是『没有记录』」一律只留「X 读取失败」）
  // 把后半句删了。这里跟着钉更硬的一处：失败态与「还没开始记」「正在读」三支不许混同。
  assert.match(read('renderer/modules/qa.ts'), /lifeFailed\.has\(row\.ship\.id\)[\s\S]{0,40}'本地记录读取失败'/)
})

test('a failed ship-life read is not disguised as a ship that never fought', () => {
  const roster = read('renderer/modules/qa.ts')
  const load = roster.slice(roster.indexOf('const loadLife'), roster.indexOf('const loadLife') + 1400)
  // 曾经的写法：catch 里塞一份全 0 的报告，等于告诉玩家这艘舰没打过任何仗
  assert.doesNotMatch(load, /sorties: 0,\s*\n\s*battles: 0,/)
  assert.match(load, /lifeFailed\.add\(rosterId\)/)
})

test('renderer callers can actually observe a failed query', () => {
  // 下层不再吞异常之后，这些 .catch()/try 才真正生效——它们原本是死代码
  const cases = [
    ['renderer/modules/shi.ts', /rows = await Promise\.all\(\[[\s\S]*?\}\ catch \(error\)/],
    ['renderer/modules/zi.ts', /rows = await Promise\.all\(\[[\s\S]*?\} catch \(error\)/],
    ['renderer/modules/du.ts', /try \{\s*\n\s*const ends = await queryMaterialWindow/],
    ['renderer/resource-trend-window.ts', /\} catch \(error\) \{[\s\S]*?资源曲线读取失败/],
  ]
  for (const [file, pattern] of cases) {
    assert.match(read(file), pattern, `${file} 必须接得住查询失败`)
  }
})
