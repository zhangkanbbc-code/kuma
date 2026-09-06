import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { gunzipSync } from 'node:zlib'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parseEventMapPage, parseGimmicks, parseRewards, parseNodeDistances, compareEventMapIntel, correctEventMapGimmicks, MAINTAINER_GIMMICK_CORRECTIONS, correctEventMapRewards, MAINTAINER_REWARD_CORRECTIONS, EVENT_DROP_NOTE } from '../scripts/lib/event-map-intel.mjs'
import { archiveEventMapIntelPack } from '../scripts/lib/event-map-intel-history.mjs'
import { archiveMapIntelEvent } from '../scripts/archive-map-intel-event.mjs'
import { approveMapIntelCandidate, candidatePaths } from '../scripts/map-intel-review.mjs'
import { preserveFriendlyFleetHistory } from '../scripts/lib/event-friendly-fleets-history.mjs'
import intel from '../dist/shared/map-intel.js'
import validation from '../dist/main/lode-validation.js'
import { renderEventDropPool, renderEventRewards } from './fixtures/render-event-map-intel.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
const config = read(new URL('../scripts/map-intel-events.json', import.meta.url)).active
const shipsPack = read(new URL('../assets/lodes/kcwiki-ships.json', import.meta.url))
const bundled = read(new URL('../assets/lodes/event-map-intel.json', import.meta.url))
const htmlOf = (no) => gunzipSync(fs.readFileSync(new URL(`./fixtures/kcwiki-event-map-E${no}-20260906.html.gz`, import.meta.url))).toString()
const parsed = Object.fromEntries([1, 2, 3, 4, 5].map((no) => [`62-${no}`, parseEventMapPage({
  // 2026-09-06 主数据同名宗谷的最低 ID；与生成器 shipMatcher 的既有选择一致。
  html: htmlOf(no), no, config, shipsPack, masterNames: [...Object.entries(config.masterShips), ['宗谷', 645]],
  checkedAt: '2026-09-06', revision: '2026.09.06',
})]))
const sumComps = (layer) => Object.values(layer.nodes).reduce((sum, n) => sum + n.enemyComps.length, 0)

test('五页真实缓存：四难度敌编成 1625 条、全部原生号，图级域不复制', () => {
  const expected = [[70, 74, 74, 65], [82, 85, 86, 79], [109, 99, 99, 90], [64, 51, 49, 55], [125, 96, 81, 92]]
  const steps = [[12, 9, 9, 4], [11, 9, 8, 3], [10, 10, 9, 7], [0, 0, 0, 0], [20, 9, 9, 9]]
  const specialCounts = [42, 108, 148, 40, 76]
  for (const [i, result] of Object.values(parsed).entries()) {
    const map = result.map
    assert.deepEqual(Object.values(map.difficulties).map(sumComps), expected[i])
    assert.deepEqual(Object.values(map.difficulties).map((l) => l.operations?.gimmicks?.reduce((n, g) => n + g.steps.length, 0) ?? 0), steps[i])
    assert.equal(map.operations.specialShips.length, specialCounts[i])
    assert.deepEqual(map.rewards.map((r) => r.scope), ['共通', '甲', '乙', '丙', '丁'])
    assert.equal(Object.keys(map.drops.nodes).length, [4, 7, 8, 13, 15][i])
    assert.equal(map.drops.difficultyAgnostic, true)
    assert.equal(map.drops.sourceNote, EVENT_DROP_NOTE)
    assert.equal(map.allDiffDrops, undefined)
    for (const layer of Object.values(map.difficulties)) {
      assert.equal(layer.operations?.specialShips, undefined)
      assert.equal(layer.drops, undefined)
      for (const node of Object.values(layer.nodes)) {
        assert.deepEqual(node.ships, [])
        for (const c of node.enemyComps) assert.ok(c.ships.every(Number.isInteger))
      }
    }
  }
  assert.equal(Object.values(parsed).reduce((n, p) => n + p.rawComps, 0), 1625)
  assert.deepEqual(parsed['62-1'].map.difficulties.甲.nodes.A.enemyComps[0].ships, [1534, 1534, 1534])
  assert.equal(parsed['62-3'].map.operations.nodeDistances, undefined)
  assert.deepEqual(parsed['62-2'].map.operations.nodeDistances, { H: 5, P: 6, V: 5, Y: 7 })
  assert.deepEqual(parsed['62-4'].map.operations.nodeDistances, { S: 6, X: 8, Z: 9 })
  assert.deepEqual(parsed['62-5'].map.operations.nodeDistances, { V: 11, ZZ: 11 })
  const comp = (formation) => `<td class="formation_mobile">${formation}</td><td class="enemy_mobile"><div><span class="hfText">(1501)<span lang="ja">駆逐イ級</span></span></div></td>`
  const duplicateHtml = ['甲', '乙', '丙', '丁'].map((d) => `<div class="tabbertab" title="${d}作战"><table><td style="background-color: #3baef5"><b>A</b></td>${comp('単縦陣')}${comp('輪形陣')}</table></div>`).join('')
  const deduped = parseEventMapPage({ html: duplicateHtml, no: 1, config, shipsPack, checkedAt: '2026-09-06', revision: 'test' })
  assert.equal(deduped.rawComps, 8)
  assert.equal(sumComps(deduped.map.difficulties.甲), 1)
  assert.equal(deduped.map.difficulties.甲.nodes.A.enemyComps[0].formation, '単縦 輪形')
})

test('奖励保留选择、数量与改修，缺分隔符只剔除歧义选择组', () => {
  assert.match(parsed['62-1'].map.rewards[1].text, /装备保有位\+5 \/ 开发资材×45/)
  assert.match(parsed['62-1'].map.rewards[1].text, /★\+2/)
  assert.doesNotMatch(parsed['62-5'].map.rewards[1].text, /Bofors 12cm/)
  assert.ok(parsed['62-5'].issues.some((i) => i.kind === 'ambiguous-choice'))
  assert.deepEqual(parseRewards(''), [])
})

test('机关空白、斜线、问号、缺列不补；E4 整域不收；E3 航程不取最小值', () => {
  const html = '<h3>E5P4削甲</h3><table><tr><th>战斗点＼难度</th><th>甲</th><th>乙</th><th>丙</th><th>丁</th></tr>' +
    '<tr><td>L2点</td><td>S胜利 ×1</td><td></td><td>A胜利 ×1？</td></tr></table>'
  const issues = []
  const out = parseGimmicks(html, 5, issues)
  assert.equal(out.甲[0].steps.length, 1)
  assert.deepEqual(out.乙, [])
  assert.deepEqual(out.丙, [])
  assert.deepEqual(out.丁, [])
  assert.ok(issues.some((i) => i.difficulty === '丁' && i.kind === 'missing-cell'))
  assert.ok(Object.values(parseGimmicks(html, 4)).every((g) => !g.length))
  assert.deepEqual(parseNodeDistances(htmlOf(3), 3, config.kcwikiPage), {})
  assert.deepEqual(parseNodeDistances('<h3>E2P1运输</h3><img alt="该点航程为6">', 2, config.kcwikiPage), {})
})

test('图级名单保留分组/国籍/舰种与改造形态例外', () => {
  const list = parsed['62-3'].map.operations.specialShips
  assert.ok(list.some((s) => s.id === 79 && s.effect.startsWith('乌利西攻击部队 · A组；')))
  assert.ok(list.some((s) => s.label === '全部美国籍舰娘' && s.effect.includes('乌利西攻击部队 · C组')))
  assert.ok(list.some((s) => s.label === '日潜水系 SS系' && s.effect.includes('U-511、UIT-25') && s.effect.includes('伊26、まるゆ')))
  assert.ok(list.some((s) => s.label === '潜母 AS' && s.effect.includes('不包括 日枝丸')))
  assert.ok(list.some((s) => s.label === '正空系 CV系' && s.effect.includes('美籍 CV 系除外')))
})

test('随包优先、缺域兜底、异步到达次序独立，图级掉落不冒充所选难度', () => {
  const map = structuredClone(bundled.data.maps['62-1'])
  const base = { schemaVersion: 1, maps: { '62-1': { ...map, drops: undefined, operations: undefined,
    rewards: [{ scope: '甲', text: '旧奖励' }], difficulties: { 甲: { nodes: { A: { ships: [{ id: 99 }], emptyDrop: 'confirmed', enemyComps: [{ formation: 1, ships: [1501] }] } },
      operations: { gimmicks: [], specialShips: [{ label: '旧名单', effect: '1.1' }], friendlyFleets: [{ ships: [{ id: 1, name: '友军' }] }], nodeDistances: { Q: 8 } } } } } } }
  const overlay = { schemaVersion: 1, maps: { '62-1': map } }
  const verify = () => {
    assert.deepEqual(intel.mapIntelMap('62-1', '甲').nodes.A.enemyComps, map.difficulties.甲.nodes.A.enemyComps)
    assert.deepEqual(intel.eventOperationsOf('62-1', '甲').nodeDistances, { Q: 8 })
    assert.equal(intel.eventOperationsOf('62-1', '甲').friendlyFleets[0].ships[0].id, 1)
    assert.deepEqual(intel.eventOperationsOf('62-1', '乙').specialShips, map.operations.specialShips)
    assert.deepEqual(intel.eventOperationsOf('62-1').specialShips, map.operations.specialShips)
    assert.deepEqual(intel.mapIntelEntry('62-1').rewards, map.rewards)
    assert.equal(intel.mapDropPool('62-1', '乙').sourceNote, EVENT_DROP_NOTE)
    assert.deepEqual(intel.mapDropPool('62-1', '甲'), intel.mapDropPool('62-1', '丁'))
    assert.equal(intel.nodeDropCatalog('62-1', 'I', undefined, '丁').allDifficulty, false)
    assert.equal(intel.nodeDropCatalog('62-1', 'I', undefined, '丁').sourceNote, EVENT_DROP_NOTE)
    assert.deepEqual(intel.mapIntelMap('62-1', '丁').nodes.I.ships, [])
    assert.equal(intel.mapIntelEntry('62-1').allDiffDrops, undefined)
  }
  intel.applyEventMapIntel(overlay); intel.applyMapIntelCatalog(base); verify()
  intel.applyEventMapIntel({ schemaVersion: 1, maps: {} }); intel.applyMapIntelCatalog(base); intel.applyEventMapIntel(overlay); verify()
  intel.applyEventMapIntel({ schemaVersion: 1, maps: {} })
  assert.equal(intel.mapDropPool('62-1', '甲').nodes.A.ships[0].id, 99)
  assert.equal(intel.eventOperationsOf('62-1', '甲').specialShips[0].label, '旧名单')
})

test('对照将明确机关/阵形/倍率冲突剔除，参考独有与未分难度掉落不进入包', () => {
  const data = { schemaVersion: 1, maps: { '62-1': structuredClone(parsed['62-1'].map) } }
  const ref = structuredClone(data)
  ref.maps['62-1'].difficulties.甲.nodes.A.enemyComps = [{ ...data.maps['62-1'].difficulties.甲.nodes.A.enemyComps[0], formation: 1 }]
  ref.maps['62-1'].difficulties.甲.operations.gimmicks[0].steps[0] = 'C2点：S胜 x9'
  ref.maps['62-1'].difficulties.乙.nodes.I.ships = [{ id: 999 }]
  const bonus = { data: { events: { E1: { entries: [{ by: 'stype', key: '驱逐', scope: '全图', value: 1.9, max: 1.9 }] } } } }
  const before = JSON.stringify(data)
  const { data: out, report } = compareEventMapIntel(data, ref, bonus)
  assert.equal(JSON.stringify(data), before)
  assert.ok(report.conflicts.some((c) => c.domain === 'enemyComps'))
  assert.ok(report.conflicts.some((c) => c.domain === 'gimmicks'))
  assert.ok(report.conflicts.some((c) => c.domain === 'specialShips'))
  assert.ok(out.maps['62-1'].difficulties.甲.nodes.A.enemyComps.every((c) => c.ships.join(',') !== '1534,1534,1534'))
  assert.ok(out.maps['62-1'].difficulties.甲.operations.gimmicks[0].steps.every((s) => !s.startsWith('C2')))
  assert.deepEqual(out.maps['62-1'].drops, data.maps['62-1'].drops)
  assert.deepEqual(out.maps['62-1'].difficulties.乙.nodes.I.ships, [])
})

test('维护者订正仅命中本活动 E1 丙 P1 C2/C3，对照后恢复步骤且不污染输入', () => {
  const input = { schemaVersion: 1, maps: Object.fromEntries(Object.entries(parsed).map(([code, result]) => [code, result.map])) }
  const before = structuredClone(input)
  const reference = structuredClone(input)
  reference.maps['62-1'].difficulties.丙.operations.gimmicks[0].steps = ['C2点：A胜 x1', 'C3点：A胜 x1', 'H点：到达 x1']
  const compared = compareEventMapIntel(input, reference)
  assert.equal(compared.report.conflicts.filter((c) => c.domain === 'gimmicks').length, 2)
  const { data, corrections } = correctEventMapGimmicks(compared.data)
  assert.deepEqual(input, before)
  assert.deepEqual(corrections.map((c) => c.point), ['C2', 'C3'])
  const group = data.maps['62-1'].difficulties.丙.operations.gimmicks[0]
  assert.deepEqual(group.steps, ['C2点：A胜利 ×1', 'C3点：A胜利 ×1', 'H点：到达 ×1'])
  for (const c of MAINTAINER_GIMMICK_CORRECTIONS) {
    assert.deepEqual(group.stepSources[c.step], { basis: 'maintainer', evidence: c.evidence, date: '2026-09-06' })
    assert.match(c.evidence, /https:\/\/zekamashi\.net\/202607-event\/dai31sentai-syutugeki-1\//)
    assert.match(c.evidence, /wikiwiki 同值/)
    assert.match(c.evidence, /wikiwiki 同值：E1 丙 P1 C2\/C3 A胜×1；维护者核 2026-09-06/)
  }
  assert.equal(group.stepSources['H点：到达 ×1'], undefined)
  assert.deepEqual(correctEventMapGimmicks(data).data, data)
  for (const difficulty of ['甲', '乙', '丁']) assert.deepEqual(data.maps['62-1'].difficulties[difficulty], input.maps['62-1'].difficulties[difficulty])
  assert.deepEqual(data.maps['62-1'].difficulties.丙.operations.gimmicks.slice(1), input.maps['62-1'].difficulties.丙.operations.gimmicks.slice(1))
  for (const code of ['62-2', '62-3', '62-4', '62-5']) assert.deepEqual(data.maps[code], input.maps[code])
  for (const changeScope of [
    (d) => { d.maps['62-1'].event.name = '下一期活动' },
    (d) => { d.maps['63-1'] = d.maps['62-1']; delete d.maps['62-1'] },
    (d) => { d.maps['62-1'].difficulties.丙.operations.gimmicks[0].title = 'E1P2解谜' },
  ]) {
    const copy = structuredClone(input)
    changeScope(copy)
    assert.deepEqual(correctEventMapGimmicks(copy), { data: copy, corrections: [] })
  }
})

test('随包 E1 四难度 P1 条件逐字锁定，丙两步独立标注维护者出处', () => {
  const expected = {
    甲: ['C2点：S胜利 ×2', 'C3点：S胜利 ×2', 'F点：空中优势及以上 ×2', 'H点：到达 ×1'],
    乙: ['C2点：S胜利 ×1', 'C3点：S胜利 ×1', 'H点：到达 ×1'],
    丙: ['C2点：A胜利 ×1', 'C3点：A胜利 ×1', 'H点：到达 ×1'],
    丁: ['C2点：A胜利及以上 ×1', 'C3点：A胜利及以上 ×1', 'H点：到达 ×1'],
  }
  for (const [difficulty, steps] of Object.entries(expected)) {
    const group = bundled.data.maps['62-1'].difficulties[difficulty].operations.gimmicks[0]
    assert.equal(group.title, 'E1P1解谜')
    assert.deepEqual(group.steps, steps)
    assert.deepEqual(Object.keys(group.stepSources ?? {}), difficulty === '丙' ? steps.slice(0, 2) : [])
    for (const mark of Object.values(group.stepSources ?? {})) {
      assert.equal(mark.basis, 'maintainer')
      assert.equal(mark.date, '2026-09-06')
      assert.equal(mark.evidence, MAINTAINER_GIMMICK_CORRECTIONS[0].evidence)
    }
  }
})

test('奖励维护者订正只影响本活动 E5 甲奖励域，输入不变且重复应用幂等', () => {
  const input = { schemaVersion: 1, maps: Object.fromEntries(Object.entries(parsed).map(([code, result]) => [code, result.map])) }
  const before = structuredClone(input)
  const { data, corrections } = correctEventMapRewards(input)
  const c = MAINTAINER_REWARD_CORRECTIONS[0]
  assert.equal(corrections.length, 1)
  assert.deepEqual(corrections[0], { ...c, previous: input.maps['62-5'].rewards[1].text })
  assert.equal(c.domain, 'rewards')
  assert.match(c.evidence, /https:\/\/zekamashi\.net\/202607-event\/hangeki31sentai-nannido\//)
  assert.match(c.evidence, /乙\/丙同型选择组/)
  assert.match(c.evidence, /舰娘百科.*缺选择分隔符/)
  assert.deepEqual(input, before)
  const expected = structuredClone(input)
  expected.maps['62-5'].rewards[1].text = input.maps['62-5'].rewards[1].text.replace(c.after, `${c.after}、${c.reward}`)
  expected.maps['62-5'].rewards[1].rewardSources = {
    [c.reward]: { basis: 'maintainer', evidence: c.evidence, date: '2026-09-06' },
  }
  assert.deepEqual(data, expected)
  assert.deepEqual(correctEventMapRewards(data).data, data)
  for (const changeScope of [
    (d) => { d.maps['62-5'].event.name = '下一期活动' },
    (d) => { d.maps['63-5'] = d.maps['62-5']; delete d.maps['62-5'] },
    (d) => { d.maps['62-5'].rewards = d.maps['62-5'].rewards.filter((r) => r.scope !== '甲') },
    (d) => { d.maps['62-5'].operations.rewards = d.maps['62-5'].rewards; delete d.maps['62-5'].rewards },
    (d) => { d.maps['62-5'].rewards[1].text = '【甲种勋章】' },
  ]) {
    const copy = structuredClone(input)
    changeScope(copy)
    assert.deepEqual(correctEventMapRewards(copy), { data: copy, corrections: [] })
  }
})

test('随包 E5 四难度奖励逐字锁定，甲选择组格式与乙丙一致且独立标注出处', () => {
  const expected = {
    甲: '【G-36A(F4F输出型)★+5 / 海外舰最新技术×5】、【V-156F(SB2U输出型)★+4 / 格纳库增设×4】、【Bofors 12cm单装两用炮★+4 / 格纳库增设×3】、【F4U-7★+1】、【改修资材×10】、【勋章×3】、【夜间熟练搭乘员×1】、【甲种勋章】',
    乙: '【G-36A(F4F输出型)★+3 / 海外舰最新技术×4】、【Bofors 12cm单装两用炮★+2 / 格纳库增设×3】、【改修资材×8】、【勋章×2】、【夜间熟练搭乘员×1】',
    丙: '【G-36A(F4F输出型) / 海外舰最新技术×2】、【Bofors 12cm单装两用炮★+1 / 格纳库增设×1】、【改修资材×5】、【勋章×1】',
    丁: '无',
  }
  const c = MAINTAINER_REWARD_CORRECTIONS[0]
  for (const [difficulty, text] of Object.entries(expected)) {
    const row = bundled.data.maps['62-5'].rewards.find((r) => r.scope === difficulty)
    assert.equal(row.text, text)
    assert.deepEqual(row.rewardSources ?? {}, difficulty === '甲' ? {
      [c.reward]: { basis: 'maintainer', evidence: c.evidence, date: '2026-09-06' },
    } : {})
    if (difficulty !== '丁') assert.match(row.text, /【Bofors 12cm单装两用炮★\+\d \/ 格纳库增设×\d】/)
  }
})

test('真实渲染函数：奖励随包优先，掉落说明恰好一次且不标所选丁难度', () => {
  intel.applyEventMapIntel(bundled.data)
  const html = renderEventDropPool('62-1', 621, '丁')
  assert.equal(html.split(EVENT_DROP_NOTE).length - 1, 1)
  assert.doesNotMatch(html, /丁难度|本地目录待更新/)
  assert.match(html, /确认掉落/)
  const reward = renderEventRewards({ api_id: 621, api_maparea_id: 62, api_no: 1 })
  assert.match(reward, /突破奖励/)
  assert.match(reward, /12.7cm单装高角炮改三/)
  assert.doesNotMatch(reward, /旧奖励/)
  const e5Reward = renderEventRewards({ api_id: 625, api_maparea_id: 62, api_no: 5 })
  assert.match(e5Reward, /Bofors 12cm单装两用炮/)
  intel.applyEventMapIntel({ schemaVersion: 1, maps: {} })
})

test('真包形状与上限：拒绝混入四档掉落、缺来源、无号编成、超限操作与历史', () => {
  assert.equal(validation.validateLodePack(bundled).ok, true)
  for (const mutate of [
    (m) => { m.drops.difficultyAgnostic = false },
    (m) => { delete m.drops.sourceNote },
    (m) => { m.drops.nodes.I = [{ id: 0 }] },
    (m) => { m.difficulties.甲.nodes.A.ships = [{ id: 1 }] },
    (m) => { m.difficulties.甲.nodes.A.enemyComps[0].ships[0] = '不猜号' },
    (m) => { m.operations.specialShips = Array(501).fill({ label: '舰', effect: '1.1' }) },
    (m) => { m.operations.nodeDistances = { A: 100 } },
    (m) => { m.allDiffDrops = {} },
    (m) => { m.difficulties.丙.operations.gimmicks[0].stepSources['C2点：A胜利 ×1'].basis = 'kcwiki' },
    (m) => { m.difficulties.丙.operations.gimmicks[0].stepSources['C2点：A胜利 ×1'].evidence = '' },
    (m) => { m.difficulties.丙.operations.gimmicks[0].stepSources['不在步骤中'] = { basis: 'maintainer', evidence: '测试', date: '2026-09-06' } },
  ]) {
    const copy = structuredClone(bundled)
    mutate(copy.data.maps['62-1'])
    assert.equal(validation.validateLodePack(copy).ok, false)
  }
  const copy = structuredClone(bundled)
  for (const mutate of [
    (r) => { r.rewardSources = [] },
    (r) => { Object.values(r.rewardSources)[0].basis = 'kcwiki' },
    (r) => { Object.values(r.rewardSources)[0].evidence = '' },
    (r) => { Object.values(r.rewardSources)[0].date = '20260906' },
    (r) => { r.rewardSources['不在奖励中'] = { basis: 'maintainer', evidence: '测试', date: '2026-09-06' } },
    (r) => { r.rewardSources['Bofors 12cm单装两用炮'] = { basis: 'maintainer', evidence: '测试', date: '2026-09-06' } },
  ]) {
    const invalid = structuredClone(bundled)
    mutate(invalid.data.maps['62-5'].rewards[1])
    assert.equal(validation.validateLodePack(invalid).ok, false)
  }
  copy.data.history = Array(101).fill({})
  assert.equal(validation.validateLodePack(copy).ok, false)
})

test('离线生成器实际运行五页与 compare，不改参考包，报告含差异与最终计数', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-event-map-cli-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  for (let n = 1; n <= 5; n++) fs.writeFileSync(path.join(dir, `E${n}.html`), htmlOf(n))
  const reference = path.join(dir, 'reference.json')
  fs.writeFileSync(reference, JSON.stringify({ data: { maps: {} } }))
  const before = fs.readFileSync(reference)
  const output = path.join(dir, 'out.json'), report = path.join(dir, 'report.json')
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/build-event-map-intel.mjs'), '--from-file', dir, '--compare', '--compare-from', reference, '--output', output, '--report', report], { cwd: ROOT, windowsHide: true, stdio: 'pipe' })
  assert.deepEqual(fs.readFileSync(reference), before)
  assert.equal(validation.validateLodePack(read(output)).ok, true)
  assert.equal(read(report).counts['62-1'].difficulties.甲.enemyComps, 70)
  assert.ok(read(report).comparison.enemyComps.length)
  assert.equal(read(report).corrections.length, 3)
  assert.deepEqual(read(report).corrections[2], { ...MAINTAINER_REWARD_CORRECTIONS[0], previous: parsed['62-5'].map.rewards[1].text })
  assert.deepEqual(read(output).data.maps['62-5'].rewards, bundled.data.maps['62-5'].rewards)
  assert.ok(read(report).parsing.E5.issues.some((i) => i.kind === 'ambiguous-choice'))
  assert.deepEqual(read(output).data.maps['62-1'].difficulties.丙.operations.gimmicks[0], bundled.data.maps['62-1'].difficulties.丙.operations.gimmicks[0])
})

test('结束候选三包同审：防过期、防篡改、幂等与下一期历史保留', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-event-map-archive-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  fs.mkdirSync(path.join(dir, 'scripts')); fs.mkdirSync(path.join(dir, 'assets/lodes'), { recursive: true })
  const write = (f, value) => fs.writeFileSync(f, JSON.stringify(value))
  const ended = { ...config, status: 'ended' }
  write(path.join(dir, 'scripts/map-intel-events.json'), { active: ended })
  const output = path.join(dir, 'assets/lodes/map-intel.json')
  write(output, { meta: bundled.meta, data: { maps: structuredClone(bundled.data.maps) } })
  write(path.join(dir, 'assets/lodes/event-friendly-fleets.json'), read(new URL('../assets/lodes/event-friendly-fleets.json', import.meta.url)))
  const eventOutput = path.join(dir, 'assets/lodes/event-map-intel.json')
  write(eventOutput, bundled)
  archiveMapIntelEvent(dir)
  assert.deepEqual(read(eventOutput), bundled)
  const files = candidatePaths(output)
  const eventCandidate = path.join(path.dirname(files.candidate), 'event-map-intel.candidate.json')
  const snapshot = fs.readFileSync(eventCandidate)
  archiveMapIntelEvent(dir)
  assert.deepEqual(fs.readFileSync(eventCandidate), snapshot)
  const candidate = read(eventCandidate)
  const corrupt = structuredClone(candidate)
  corrupt.data.maps['62-1'].rewards[0].text = 'changed'
  write(eventCandidate, corrupt)
  assert.throws(() => approveMapIntelCandidate(output), /活动海域候选/)
  assert.deepEqual(read(eventOutput), bundled)
  fs.writeFileSync(eventCandidate, snapshot)
  const changed = structuredClone(bundled); changed.meta.version = 'changed'; write(eventOutput, changed)
  assert.throws(() => approveMapIntelCandidate(output), /活动海域正式包/)
  write(eventOutput, bundled)
  approveMapIntelCandidate(output)
  assert.deepEqual(read(eventOutput), candidate)
  const finalBytes = fs.readFileSync(eventOutput)
  archiveMapIntelEvent(dir)
  assert.deepEqual(fs.readFileSync(eventOutput), finalBytes)
  assert.equal(candidate.data.history[0].status, 'ended')
  assert.equal(validation.validateLodePack(candidate).ok, true)
  const next = preserveFriendlyFleetHistory({ schemaVersion: 1, maps: {} }, candidate)
  assert.deepEqual(next.history, candidate.data.history)
  assert.deepEqual(archiveEventMapIntelPack(candidate, ended).data, candidate.data)
})
