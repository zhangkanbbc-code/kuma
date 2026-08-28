// NPC 台词卷的分组判据（判据本身与理由写在 src/shared/npc-voice-book.ts 头注）。
//
// 这一族的错法是**归错组**：界面上归对与归错长得一模一样，只有认得出明石、
// 满潮这几位的人才看得出来，所以判据得在这儿钉死，别指望肉眼验收。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

// 走 dist：这个模块 import 了 voice-sound-path（音轨目录常量在那儿），
// Node 直接跑 .ts 时解析不了无扩展名的同级 import——与别的多依赖 shared 模块同一条路。
import npcVoiceBook from '../dist/shared/npc-voice-book.js'

const { buildNpcVoiceBook, npcVoiceGroupOf, npcVoicePathname } = npcVoiceBook

const lode = JSON.parse(
  fs.readFileSync(new URL('../assets/lodes/subtitle-npc.json', import.meta.url), 'utf8'),
)

test('一键多条归成一块，不按行拆开', () => {
  const groups = buildNpcVoiceBook({
    1: { name: '明石', jp: 'よろしく', zh: '请多关照' },
    1187: [
      { name: '满潮', jp: '何てこんな艦隊に', zh: '我为什么会来这样的舰队啊' },
      { name: '时雨', jp: 'お疲れ様', zh: '辛苦了' },
      { name: '满潮', jp: 'まさか同じ部隊に', zh: '难道是在同一个部队' },
    ],
  })
  const mishio = npcVoiceGroupOf(groups, '满潮')
  // 一个音轨编号 = 一个 mp3。三行是同一条音轨里的三句，块不许散成三块
  assert.equal(mishio.tracks.length, 1)
  assert.equal(mishio.tracks[0].lines.length, 3)
  assert.deepEqual(
    mishio.tracks[0].lines.map((line) => line.name),
    ['满潮', '时雨', '满潮'],
  )
})

test('块归到第一行 name 名下：块内后面那几位不各自开一组', () => {
  const groups = buildNpcVoiceBook({
    1187: [
      { name: '满潮', jp: 'あ', zh: '甲' },
      { name: '时雨', jp: 'い', zh: '乙' },
      { name: '荒潮', jp: 'う', zh: '丙' },
    ],
  })
  // 按块内每个 name 各算一组的话，同一个 mp3 会挂在三位名下，点谁都播整段对白
  assert.deepEqual(groups.map((group) => group.name), ['满潮'])
  assert.equal(npcVoiceGroupOf(groups, '时雨'), null)
})

test('组序按组内最小音轨编号升序，与插入顺序无关', () => {
  const groups = buildNpcVoiceBook({
    1187: [{ name: '满潮', jp: 'あ', zh: '甲' }],
    13: { name: '伊良湖', jp: 'い', zh: '乙' },
    430: [{ name: '武蔵', jp: 'う', zh: '丙' }],
    1: { name: '明石', jp: 'え', zh: '丁' },
    // 明石名下还有一条大号音轨：组序看的是**最小**号，不是随便哪一条
    29: { name: '明石', jp: 'お', zh: '戊' },
  })
  assert.deepEqual(groups.map((group) => group.name), ['明石', '伊良湖', '武蔵', '满潮'])
  assert.deepEqual(groups.map((group) => group.firstNo), [1, 13, 430, 1187])
  // 组内也按编号升序
  assert.deepEqual(npcVoiceGroupOf(groups, '明石').tracks.map((track) => track.no), [1, 29])
})

test('随包数据：设施 NPC 四位排在活动演出之前', () => {
  const groups = buildNpcVoiceBook(lode.data)
  assert.deepEqual(groups.slice(0, 4).map((group) => group.name), ['明石', '大淀', '间宫', '伊良湖'])
  // 活动演出那一族全在后面（低号段是设施 NPC 自己的）
  for (const group of groups.slice(4)) assert.ok(group.firstNo >= 430, `${group.name} 排到设施 NPC 里去了`)
  // 74 个音轨键、117 行，一条都不许在整理过程中丢
  assert.equal(
    groups.reduce((sum, group) => sum + group.tracks.length, 0),
    Object.keys(lode.data).length,
  )
  assert.equal(groups.reduce((sum, group) => sum + group.lineCount, 0), 117)
})

test('整首插入曲的块用曲名当组名，不叫「BGM」', () => {
  // 434《月夜海》的真实形状：前三行是曲目元信息，name 是字段标签而不是说话人
  const groups = buildNpcVoiceBook({
    434: [
      { name: 'BGM', jp: '月夜海', zh: '月夜海' },
      { name: '作曲', jp: 'Kaori Ohkoshi', zh: '大越香里' },
      { name: '作词', jp: 'minatoku', zh: '田中谦介' },
      { name: '秋月级', jp: 'もし今 明かりが消え', zh: '倘若现在，失去光明' },
      { name: '秋月级', jp: '見上げた 月の空', zh: '仰望天空，那轮明月' },
    ],
  })
  // 取 name 会得到一张叫「BGM」的卡，与明石、大淀并排摆着像个坏条目
  assert.deepEqual(groups.map((group) => group.name), ['月夜海'])
  assert.equal(npcVoiceGroupOf(groups, 'BGM'), null)
  // 元信息那三行照旧逐行显示，一行都不许删——它们是这块内容的一部分
  assert.deepEqual(
    groups[0].tracks[0].lines.map((line) => line.name),
    ['BGM', '作曲', '作词', '秋月级', '秋月级'],
  )
  assert.equal(groups[0].lineCount, 5)
})

test('判据挂在形状上，不写死 434：另一个编号的插入曲一样命中', () => {
  const groups = buildNpcVoiceBook({
    777: [
      { name: 'BGM', jp: '海色', zh: '海色' },
      { name: '作曲', jp: '某', zh: '某' },
      { name: '吹雪', jp: 'あ', zh: '甲' },
    ],
  })
  assert.deepEqual(groups.map((group) => group.name), ['海色'])
})

test('随包数据：434 那张卡叫《月夜海》', () => {
  const groups = buildNpcVoiceBook(lode.data)
  const song = groups.find((group) => group.tracks.some((track) => track.key === '434'))
  assert.equal(song.name, '月夜海')
  assert.equal(groups.some((group) => group.name === 'BGM'), false)
})

test('中文缺失回退日文，一行台词不会摆成空的', () => {
  const groups = buildNpcVoiceBook({
    5: { name: '大淀', jp: '提督、こちらです', zh: '' },
    6: { name: '大淀', jp: '報告書です' },
  })
  const lines = npcVoiceGroupOf(groups, '大淀').tracks.flatMap((track) => track.lines)
  assert.deepEqual(lines.map((line) => line.zh), ['提督、こちらです', '報告書です'])
  // 日文那一列原样留着——回退不是把原文搬走，对照两列还是两列
  assert.deepEqual(lines.map((line) => line.ja), ['提督、こちらです', '報告書です'])
})

test('播放路径就是 kc9999 下的档名，编号原样不补零', () => {
  assert.equal(npcVoicePathname('1'), '/kcs/sound/kc9999/1.mp3')
  assert.equal(npcVoicePathname('1187'), '/kcs/sound/kc9999/1187.mp3')
  const groups = buildNpcVoiceBook({ 434: [{ name: 'BGM', jp: '月夜海', zh: '月夜海' }] })
  assert.equal(groups[0].tracks[0].path, '/kcs/sound/kc9999/434.mp3')
  // 随包数据里每一条都拼得出路径（拼不出的块摆出来就是点了没反应的钮）
  for (const group of buildNpcVoiceBook(lode.data)) {
    for (const track of group.tracks) {
      assert.match(track.path, /^\/kcs\/sound\/kc9999\/\d+\.mp3$/)
    }
  }
})

test('拼不出路径或没有说话人的块整块丢掉，不摆成哑格', () => {
  const groups = buildNpcVoiceBook({
    'npc-01': { name: '明石', jp: 'あ', zh: '甲' }, // 非裸数字键拼不出音轨路径
    7: { name: '', jp: 'い', zh: '乙' }, // 没有说话人就没有归属判据
    8: [],
    9: { name: '间宫', jp: 'う', zh: '丙' },
  })
  assert.deepEqual(groups.map((group) => group.name), ['间宫'])
})
