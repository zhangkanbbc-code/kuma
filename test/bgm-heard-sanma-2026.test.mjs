// 秋刀鱼祭 2026 海域战斗曲三个号定名（维护者裁决 2026-11-25）。
// 11-24 维护后 api_mst_mapbgm 把镇守府海域等配曲换成战斗树 76 / 44 / 77，三层曲名表都没有这三个号，
// 顶栏只能显示「战斗 BGM #76」。定名依据（两票以上）：
//   76 = 鎮守府秋刀魚祭り改：音轨实测 129.34s，拆包BGM列表 2:09；同时长候选里「鎮守府秋刀魚祭り改二」
//        已归 102；秋刀鱼祭历代曲号按年份递增（102＝2017 改二、125＝2018 改三），76/77 相邻对应 2016 那一对；
//        wikiwiki BGM 一覧记 2016 秋刀鱼祭用于 1-1、1-5 等道中。维护者试听 2:09。
//   77 = 艦娘音頭※試製先行版：音轨实测 75.49s，拆包BGM列表 1:16，列在 2016 年秋刀鱼祭典一节；
//        维护者试听为带人声版本，同时长候选里只有这一首是歌。
//   44 = 加賀岬 (実装ver.)：音轨实测 144.20s，拆包BGM列表「加賀岬」2:24，时长对齐双向唯一命中；
//        维护者试听为带人声版本；曲名照官方 OST vol.III【雲】Tr.24 碟面原文。
//   1 = 砲雷撃戦、始め！（同日补登，秋刀鱼期间 1-1 海图曲）：维护者试听确认旋律即此曲；音轨实测 58.54s、
//        2241 帧、末帧对齐无截断——游戏资源本身就是这段长度，与拆包BGM列表 2:11 不同长，
//        时长对齐因此撞到 冬の二水戦 / 警戒線 判不了；战斗树 2 号起是 2013 年最早那批
//        （2＝我、夜戦に突入す！），1 号按编号序是最初的昼战曲。名字照 2 号的先例用全名，不用 OST 的「昼戦 (…)」标签。
//   161 = 秋雲の描くスケッチ（同日补登，秋刀鱼期间 1-3 海图曲）：维护者试听为非常轻快的曲子，两个等长候选
//        （整備員の休息 / 捷号決戦前夜）都不是；战斗树 160＝決戦！南太平洋海戦、162＝雪風の奇跡、163＝発動！MG1作戦，
//        恰是官方 OST vol.VIII【夜】Tr.8、10、11，夹在中间的 Tr.9 就是这首；游戏主数据母港树 252/253 也是
//        「秋雲の描くスケッチ」「雪風の奇跡」相邻一对。拆包BGM列表没收（点唱机曲，不是活动曲），所以时长对齐够不着。
//        写法取游戏主数据 252 的「秋雲の描くスケッチ」（の），OST 碟面作「が」，裁定见 bgm-name-audit 的台账。
import assert from 'node:assert/strict'
import test from 'node:test'

import bgmModule from '../dist/shared/kcs-bgm.js'
import heardModule from '../dist/shared/bgm-heard.js'

const { bgmSongName } = bgmModule
const { HEARD_BGM_NAMES } = heardModule

test('秋刀鱼祭 2026 的三个战斗曲号有名字了', () => {
  assert.equal(bgmSongName('battle', 76, null, null), '鎮守府秋刀魚祭り改')
  assert.equal(bgmSongName('battle', 77, null, null), '艦娘音頭※試製先行版')
  assert.equal(bgmSongName('battle', 44, null, null), '加賀岬 (実装ver.)')
})

test('三条都记 2026-11-25 的确认日期，依据里写明实测时长', () => {
  for (const [id, seconds] of [[76, '129.34'], [77, '75.49'], [44, '144.20']]) {
    const entry = HEARD_BGM_NAMES.find((one) => one.id === id)
    assert.ok(entry, `${id} 不在耳测战斗层`)
    assert.equal(entry.heardAt, '2026-11-25')
    assert.ok(entry.note?.includes(seconds), `${id} 的依据里没有实测时长 ${seconds}s`)
  }
})

test('1 号是砲雷撃戦、始め！：依据写明试听与实测时长、无截断', () => {
  assert.equal(bgmSongName('battle', 1, null, null), '砲雷撃戦、始め！')
  const entry = HEARD_BGM_NAMES.find((one) => one.id === 1)
  assert.ok(entry, '1 不在耳测战斗层')
  assert.equal(entry.heardAt, '2026-11-25')
  assert.ok(entry.note?.includes('58.54'), '1 的依据里没有实测时长 58.54s')
})

test('161 号是秋雲の描くスケッチ：写法跟游戏主数据母港树 252 一致', () => {
  assert.equal(bgmSongName('battle', 161, null, null), '秋雲の描くスケッチ')
  assert.equal(bgmSongName('battle', 161, null, null), bgmSongName('port', 252, { 252: '秋雲の描くスケッチ' }, null))
  const entry = HEARD_BGM_NAMES.find((one) => one.id === 161)
  assert.ok(entry, '161 不在耳测战斗层')
  assert.equal(entry.heardAt, '2026-11-25')
  assert.ok(entry.note?.includes('48.89'), '161 的依据里没有实测时长 48.89s')
})
