// 紧凑模式的偏好账（任务/远征各记各的开关，落在 ui.compact.v1）。
//
// 规格三句话：**默认关**、各模块独立、重启后还在。这份护栏钉住前两句与落盘形状
// ——第三句（真落到 config.json 再读回来）由副本实例的实测承担，脱 DOM 测不了。
//
// 断言对着纯函数下，不比对源码文本：把默认值写成「开」、把开关做成全局一个布尔、
// 或者落盘时忘了排序，正则一条也拦不住，而这三样都是玩家当场能看见的回归。
import assert from 'node:assert/strict'
import test from 'node:test'

import compactMode from '../dist/shared/compact-mode.js'

const { parseCompactModes, serializeCompactModes, toggledCompactModes } = compactMode

test('默认关：没有存档、存档是空的、存档坏了，问谁都是常规排布', () => {
  for (const raw of [undefined, null, [], {}, 'qn', 42]) {
    const on = parseCompactModes(raw)
    assert.equal(on.has('qn'), false, `${JSON.stringify(raw)} 不该解出「开着」`)
    assert.equal(on.has('bi'), false)
  }
})

test('各模块独立：给任务开紧凑，远征不跟着变', () => {
  let on = parseCompactModes([])
  on = toggledCompactModes(on, 'qn')
  assert.equal(on.has('qn'), true)
  assert.equal(on.has('bi'), false, '一格里两个模块要能一开一关')
  on = toggledCompactModes(on, 'bi')
  assert.equal(on.has('qn'), true, '开第二个不该顶掉第一个')
  assert.equal(on.has('bi'), true)
})

test('再点一下就关，且只关自己那一个', () => {
  let on = parseCompactModes(['bi', 'qn'])
  on = toggledCompactModes(on, 'qn')
  assert.deepEqual([...on], ['bi'])
})

test('翻转不改手上那一份：上一拍的集合还是上一拍的样子', () => {
  // 铆按引用把开关传进渲染路径；就地改会让「翻转前后」在同一次渲染里对不上
  const before = parseCompactModes(['qn'])
  const after = toggledCompactModes(before, 'bi')
  assert.deepEqual([...before], ['qn'])
  assert.deepEqual([...after].sort(), ['bi', 'qn'])
})

test('落盘形状与开关次序无关：同一份名单只落一次盘', () => {
  // uiSet 走 config.set 的值比较判「变没变」，次序抖动会让同一份名单被判成新值，
  // 每翻一次开关多一次原子写盘
  const a = serializeCompactModes(toggledCompactModes(parseCompactModes(['qn']), 'bi'))
  const b = serializeCompactModes(toggledCompactModes(parseCompactModes(['bi']), 'qn'))
  assert.deepEqual(a, b)
  assert.deepEqual(a, ['bi', 'qn'])
})

test('存档里的杂物不当成模块 id', () => {
  const on = parseCompactModes(['qn', '', null, 7, { id: 'bi' }, 'bi'])
  assert.deepEqual(serializeCompactModes(on), ['bi', 'qn'])
})
