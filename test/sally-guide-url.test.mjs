// 札提示里的攻略页地址不许写死在代码里（2026-08-25）。
//
// 病灶：ru.ts 的 `const WIKI = 'https://zh.kcwiki.cn/wiki/2026年夏季活动'`，
// 拼进札挂牌的 title，两处在用。下一期活动开幕，这个提示会把玩家送去**上期**
// 的页面——而且不报错、界面上看不出来，只有点进去的人知道被骗了。
//
// 现在从矿脉包现取。选格顺序有一条实测理由钉在下面：包里那条
// `event.lifecycleSourceUrl` **不是攻略表**，是官方 X 账号（起止日期的出处），
// 拿它当攻略链接是把玩家送去一个查不到答案的地方。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import lodeValidation from '../dist/main/lode-validation.js'
import eventGuide from '../dist/shared/event-guide.js'

const { validateLodePack } = lodeValidation
const { EVENT_GUIDE_URLS, eventGuideUrlOf } = eventGuide
const ru = fs.readFileSync(new URL('../src/renderer/modules/ru.ts', import.meta.url), 'utf8')
const hasIn = (source, re, message) => assert.ok(re.test(source), message)

/** 去掉注释行——注释里可以提那条旧地址（它是这次修改的来龙去脉），代码里不行。 */
const codeOnly = (source) =>
  source
    .split('\n')
    .filter((line) => {
      const t = line.trim()
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'))
    })
    .join('\n')

test('ru.ts 里不许再出现写死的 URL', () => {
  const code = codeOnly(ru)
  const stray = code.match(/https?:\/\/[^\s'"`]*/g)
  assert.deepEqual(
    stray ?? [],
    [],
    `代码里又写死了地址：${(stray ?? []).join(' , ')}——活动一换就是死链，得从矿脉包现取`,
  )
})

test('攻略地址从第一方台账 + 矿脉包取，取不到就整句不出', () => {
  hasIn(ru, /const eventGuideUrl = \(\): string \| null =>/, 'eventGuideUrl 不见了')
  hasIn(ru, /mapIntelEntries\(\)/, '没有去矿脉包里取')
  // 第一方台账排第一：map-intel 永不随包，只靠包的话玩家那边这句话整段消失
  hasIn(ru, /const firstParty = eventGuideUrlOf\(areaId\)/, '没有先查第一方台账')
  // 选格顺序：中文页优先，wikiwiki 日文页兜底
  hasIn(
    ru,
    /const url = entry\.kcwikiUrl \?\? entry\.sourceUrl/,
    '取地址的优先级不对——中文界面应当优先舰娘百科的中文页',
  )
  // lifecycleSourceUrl 是官方 X 账号，不是攻略表，绝不许当外链用
  assert.ok(
    !codeOnly(ru).includes('lifecycleSourceUrl'),
    'lifecycleSourceUrl 被当攻略链接用了——那一格实测写的是官方 X 账号，玩家点过去查不到札',
  )
  // 取不到 → judge 是空串 → title 里一个 URL 都不会出现
  hasIn(
    ru,
    /const judge = guide\s*\?\s*`[^`]*\$\{guide\}`\s*:\s*''/,
    '取不到地址时那句话还在拼——要么留下半截空链接，要么直接是死链',
  )
})

test('札挂牌的两处 title 都只经 judge 拿地址', () => {
  // 两处 title 里出现的地址来源只能是 judge；谁再直接插一条字面量，
  // 上面那条「不许写死 URL」会先红，这里守的是「没绕过 judge 另开一路」
  const uses = ru.match(/\$\{judge\}/g) ?? []
  assert.ok(uses.length >= 2, `judge 的使用点只剩 ${uses.length} 处，札提示里的攻略指路被删了？`)
})

// ---- 校验器：kcwikiUrl 这一格从前没人管，现在补上（真跑）----

const mapIntelPack = (mapExtra) => ({
  meta: {
    id: 'map-intel',
    name: 'map-intel',
    version: '1',
    source: 'test',
    fetchedAt: '2026-08-25T00:00:00.000Z',
  },
  data: {
    schemaVersion: 1,
    maps: {
      '62-1': {
        source: '测试',
        sourceUrl: 'https://wikiwiki.jp/kancolle/E1',
        checkedAt: '2026-08-25',
        revision: '2026-08-25',
        difficulties: {
          甲: { nodes: { A: { emptyDrop: 'unknown', ships: [], enemyComps: [] } } },
        },
        ...mapExtra,
      },
    },
  },
})

test('第一方台账按活动区 id 记，不会把上期地址泄漏给下期', () => {
  // 这是原先那个写死常量的病根：它不认区号，换一期照样输出上期的页面。
  // 按区 id 记之后，没录的那期就是没有链接——宁可不说，也不指错地方。
  assert.equal(typeof eventGuideUrlOf(62), 'string', '当期那条不见了')
  assert.equal(eventGuideUrlOf(63), null, '没录的区不许凭空给地址')
  assert.equal(eventGuideUrlOf(0), null)
  for (const [areaId, url] of Object.entries(EVENT_GUIDE_URLS)) {
    assert.match(String(areaId), /^\d+$/, '台账的键必须是活动区 id')
    assert.match(url, /^https:\/\//, `${areaId} 的地址不是 https`)
  }
})

test('kcwikiUrl 缺省合法、是字符串合法、不是字符串要被挡下', () => {
  assert.equal(validateLodePack(mapIntelPack({})).ok, true, '不带 kcwikiUrl 应当照过')
  assert.equal(
    validateLodePack(mapIntelPack({ kcwikiUrl: 'https://zh.kcwiki.cn/wiki/x/E-1' })).ok,
    true,
    '带一条正常的 kcwikiUrl 应当照过',
  )
  const bad = validateLodePack(mapIntelPack({ kcwikiUrl: 12345 }))
  assert.equal(bad.ok, false, 'kcwikiUrl 不是字符串也放行——那会一路渲成 href="12345"')
})
