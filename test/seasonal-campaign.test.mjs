import assert from 'node:assert/strict'
import test from 'node:test'

import campaign from '../dist/shared/seasonal-campaign.js'

const { SEASONAL_ITEMS, campaignQuestPeriod, detectSeasonalCampaigns } = campaign

// 与真实 api_mst_useitem 同形的最小主数据（id 取真值，防止将来有人硬编码 id 时测试还绿）
const USEITEM_MST = [
  { id: 57, name: '勲章' },
  { id: 68, name: '秋刀魚' },
  { id: 90, name: '節分の豆' },
  { id: 96, name: '南瓜' },
]

test('a campaign turns active only when a live quest names its item', () => {
  // 南瓜任务上线（游戏原文点名），此刻持有还是 0——看板必须已经亮起来
  const detected = detectSeasonalCampaigns({
    useitemMst: USEITEM_MST,
    useitems: {},
    quests: [{ no: 5001, title: '【菓子祭】南瓜収穫作戦', detail: '「南瓜」を集めよう！' }],
  })
  assert.equal(detected.length, 1)
  assert.equal(detected[0].key, 'pumpkin')
  assert.equal(detected[0].itemId, 96)
  assert.equal(detected[0].stock, 0)
  // 没有目录条目时周期如实说不知道，不猜
  assert.deepEqual(detected[0].quests, [{ no: 5001, period: 'unknown' }])
})

test('stock alone keeps the campaign in progress because closure zeroes the item', () => {
  // 用户实测口径（2026-08-10）：收集道具不跨企划保留，活动结束服务器全量清零。
  // 所以持有>0 本身就是进行中的证据——比如当期任务全部做完领完、列表里已经
  // 没有点名任务；真正落幕由清零驱动，下一次同步两个信号一起熄灭。
  const detected = detectSeasonalCampaigns({
    useitemMst: USEITEM_MST,
    useitems: { 96: 7 },
    quests: [{ no: 201, title: '敵艦隊を撃破せよ！', detail: '' }],
  })
  assert.equal(detected.length, 1)
  assert.equal(detected[0].stock, 7)
  assert.deepEqual(detected[0].quests, [])
  // 清零同步到本地后不再发出
  const cleared = detectSeasonalCampaigns({
    useitemMst: USEITEM_MST,
    useitems: { 96: 0 },
    quests: [{ no: 201, title: '敵艦隊を撃破せよ！', detail: '' }],
  })
  assert.deepEqual(cleared, [])
})

test('no signal at all means the item is simply absent from the report', () => {
  const detected = detectSeasonalCampaigns({
    useitemMst: USEITEM_MST,
    useitems: { 57: 12 }, // 勲章不在企划注册表里
    quests: [],
  })
  assert.deepEqual(detected, [])
})

test('compound item names never light up the base-item campaign', () => {
  // 真实目录样本（B158）：常设任务奖秋刀鱼**罐头**——那是另一个道具（api 69），
  // 不剔除复合词的话秋刀鱼企划会被一条常设任务常年点亮
  const detected = detectSeasonalCampaigns({
    useitemMst: USEITEM_MST,
    useitems: {},
    quests: [{ no: 931, title: '精鋭「二七駆」、回避運動は入念に！' }],
    catalogOf: () => ({
      code: 'B158',
      text: '奖励:家具焼き芋と読书の时间 以下奖励三选一： 洋上补给×2 应急修理女神 「秋刀鱼罐头」×2',
    }),
  })
  assert.deepEqual(detected, [])
  // 同一段文本真点名生鱼时照常触发（剔除只针对复合词本身）
  const live = detectSeasonalCampaigns({
    useitemMst: USEITEM_MST,
    useitems: {},
    quests: [{ no: 932, title: '', detail: '' }],
    catalogOf: () => ({ code: '2610B1', text: '捕获「秋刀鱼」×3并提交，奖励「秋刀鱼罐头」×1' }),
  })
  assert.equal(live.length, 1)
  assert.equal(live[0].key, 'sanma')
  assert.deepEqual(live[0].quests, [{ no: 932, period: 'limited' }])
})

test('zh catalog aliases match when the live text is not enough', () => {
  const detected = detectSeasonalCampaigns({
    useitemMst: USEITEM_MST,
    useitems: {},
    quests: [{ no: 6001, title: '【节分任务】鬼は外！' }],
    catalogOf: () => ({ code: '2602B1', text: '收集「节分豆」完成投掷' }),
  })
  assert.equal(detected.length, 1)
  assert.equal(detected[0].key, 'setsubun')
})

test('items missing from the master are skipped instead of guessed', () => {
  // 注册表条目解析不到主数据名字就整条跳过（同 kanso-quest-rules 的实体纪律）
  const detected = detectSeasonalCampaigns({
    useitemMst: [{ id: 96, name: '南瓜' }],
    useitems: { 68: 3 }, // 有秋刀鱼存量，但主数据里没有秋刀鱼条目
    quests: [],
  })
  assert.deepEqual(detected, [])
})

test('campaign quest periods reuse the quest-period coding verbatim', () => {
  assert.equal(campaignQuestPeriod('Bd4'), 'daily')
  assert.equal(campaignQuestPeriod('Bw1'), 'weekly')
  assert.equal(campaignQuestPeriod('Bm2'), 'monthly')
  assert.equal(campaignQuestPeriod('Bq3'), 'quarterly')
  assert.equal(campaignQuestPeriod('By1', '10月年常'), 'annual')
  // kcwiki 给期间限定的两种编码形态
  assert.equal(campaignQuestPeriod('2610B2'), 'limited')
  assert.equal(campaignQuestPeriod('SB05'), 'limited')
  // 常设单发 / 无目录条目
  assert.equal(campaignQuestPeriod('B158'), 'once')
  assert.equal(campaignQuestPeriod(''), 'unknown')
  assert.equal(campaignQuestPeriod(null), 'unknown')
})

test('the registry resolves items by exact Japanese name only', () => {
  // 注册表不许携带硬编码 id；名字才是与主数据对齐的键
  for (const spec of SEASONAL_ITEMS) {
    assert.ok(spec.jpName.length > 0, `${spec.key} 缺日文名`)
    assert.equal('itemId' in spec, false, `${spec.key} 不该内置 id`)
  }
  // 已知的单字/超短别名会大面积误报，禁止入表（「米」「茶」曾被评估后排除）
  for (const spec of SEASONAL_ITEMS) {
    for (const alias of spec.textAliases) {
      assert.ok(alias.length >= 2, `${spec.key} 的别名「${alias}」太短，误报风险`)
    }
  }
})
