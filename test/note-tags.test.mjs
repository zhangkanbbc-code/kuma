// 备注里的 `#标签` 解析（shared/note-tags）。
//
// 这一层是舰娘列表筛选片的唯一输入：玩家在「这一艘的备注」里写 `#水打`，
// 筛选区才有那枚片。解析写歪一格，症状是「写了没反应」——而不是报错。
import assert from 'node:assert/strict'
import test from 'node:test'

import noteTags from '../dist/shared/note-tags.js'

const { parseNoteTags, splitNoteTags, tallyNoteTags } = noteTags

test('井号后到空白/标点为止，一条备注里能认出好几个', () => {
  assert.deepEqual(parseNoteTags('#高速 #夜战'), ['高速', '夜战'])
  assert.deepEqual(parseNoteTags('#高速,#夜战。#对潜'), ['高速', '夜战', '对潜'])
  assert.deepEqual(parseNoteTags('#E1甲 打完就拆'), ['E1甲'])
  // 下划线是唯一放行的标点：标签里太常见
  assert.deepEqual(parseNoteTags('#E1_甲'), ['E1_甲'])
})

test('中文不打空格，井号左边不要求分隔——要求了这行字一个标签都认不出来', () => {
  assert.deepEqual(parseNoteTags('活动用#水打#机动'), ['水打', '机动'])
})

test('中文没有右边界：井号后面一路连着写，整串都是标签名', () => {
  // 这是「不要求左分隔」的另一面，躲不掉：中文里 `#水打` 与后文之间没有任何记号。
  // 兜底不在解析层，在界面——详情里那排「认出来的标签」就是给这件事看的回执，
  // 玩家看到片上写着 `#水打主力` 就知道该补个空格。
  assert.deepEqual(parseNoteTags('#水打主力'), ['水打主力'])
  assert.deepEqual(parseNoteTags('#水打 主力'), ['水打'])
  // 再写一个标签也能断开——活动期连着写好几枚是常态
  assert.deepEqual(parseNoteTags('#水打#主力'), ['水打', '主力'])
})

test('全角 ＃ 照认，并与半角归一成同一个标签', () => {
  // 中文标点模式下敲出来的就是它，玩家在框里看不出分别
  assert.deepEqual(parseNoteTags('＃高速'), ['高速'])
  assert.deepEqual(parseNoteTags('＃高速 #高速'), ['高速'])
  assert.equal(tallyNoteTags(['＃高速', '#高速']).length, 1)
})

test('光一个井号不是标签，连着的井号也只算后面那个', () => {
  assert.deepEqual(parseNoteTags('#'), [])
  assert.deepEqual(parseNoteTags('# 高速'), [])
  assert.deepEqual(parseNoteTags('##高速'), ['高速'])
  assert.deepEqual(parseNoteTags(''), [])
  assert.deepEqual(parseNoteTags(null), [])
})

test('大小写不归一：两枚片并排摆着，玩家自己看得出打岔了', () => {
  assert.deepEqual(parseNoteTags('#E1 #e1'), ['E1', 'e1'])
})

test('同一个标签写两遍，只算一个（按首次出现次序）', () => {
  assert.deepEqual(parseNoteTags('#高速 修完 #高速'), ['高速'])
  assert.deepEqual(parseNoteTags('#乙 #甲 #乙'), ['乙', '甲'])
  // 计数是「带这个标签的备注有几条」，不是「井号出现几次」
  assert.deepEqual(tallyNoteTags(['#高速 #高速']), [{ tag: '高速', count: 1 }])
})

test('切段能原样拼回去——正文里要描色，一个字都不能丢', () => {
  for (const note of ['#高速 修完就拆', '活动用#水打#机动', '没有标签', '＃全角 尾巴', '']) {
    assert.equal(
      splitNoteTags(note)
        .map((segment) => segment.text)
        .join(''),
      note,
    )
  }
  const segments = splitNoteTags('主力 #水打 备用')
  assert.deepEqual(
    segments.map((segment) => [segment.kind, segment.text, segment.tag]),
    [
      ['text', '主力 ', ''],
      ['tag', '#水打', '水打'],
      ['text', ' 备用', ''],
    ],
  )
  // 全角引导号原样留在 text 里（拼得回去），tag 已归一
  const wide = splitNoteTags('＃高速')
  assert.equal(wide[0].text, '＃高速')
  assert.equal(wide[0].tag, '高速')
})

test('筛选片的次序是纯函数式的：用得多的在前，一样多的按拼音序', () => {
  const tally = tallyNoteTags(['#乙 #机动', '#乙', '#甲 #乙', '#机动'])
  assert.deepEqual(tally, [
    { tag: '乙', count: 3 },
    { tag: '机动', count: 2 },
    { tag: '甲', count: 1 },
  ])
  // 次序不能随输入次序漂——列表每次数据补丁都重渲，片跟着换位置玩家的手会点空
  const shuffled = tallyNoteTags(['#机动', '#甲 #乙', '#乙', '#乙 #机动'])
  assert.deepEqual(shuffled, tally)
})

test('没有标签的备注不产片——筛选区因此不会凭空多东西', () => {
  assert.deepEqual(tallyNoteTags(['随手记点什么', '', null, undefined]), [])
})

test('emoji / 箭头这类符号是边界，不会被吞进标签里', () => {
  // 反着写成「不是空白和标点」的话，下面这条会解出一个 `高速→夜战`
  assert.deepEqual(parseNoteTags('#高速→#夜战'), ['高速', '夜战'])
  assert.deepEqual(parseNoteTags('#高速🚀'), ['高速'])
})
