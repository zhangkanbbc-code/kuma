// 阵形显示一律走规范出口（2026-08-25）。
//
// 病灶：镝里六处直接下标 `ENEMY_FORMATION[...]`，绕过 `formationText`。
// 官方哪天加一个新阵形号（联合舰队那四个警戒序列就是后来加的），表里查不到：
//   · 写了 `?? ''` 的四处 ⇒ 空串。`.gpill` 自带边框和内边距，屏幕上多出一枚
//     **空胶囊**——不是没显示，是显示了一个什么都没有的框；
//   · 没写 `??` 的两处 ⇒ undefined ⇒ 整枚胶囊消失，玩家不知道那一战有没有阵形。
//
// 既有的 test/enemy-formation.test.mjs 守的是另一半（矿脉包里的日文字符串写法），
// **数字新值没人管**——这个文件补的就是这一块。
//
// 判据现在住在 shared（`optionalFormationText`），所以三条行为断言是真跑的；
// 只有「六处调用点确实都改了」这一条脱不开渲染层，退回结构断言。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import enemyFormation from '../dist/shared/enemy-formation.js'

const { ENEMY_FORMATION, formationText, optionalFormationText } = enemyFormation
const di = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')

test('表里没有的新阵形号如实报号，不落成空串', () => {
  assert.equal(ENEMY_FORMATION[15], undefined, '15 已经进表了？那换一个还没进表的号再测')
  assert.equal(formationText(15), '阵形15')
  assert.equal(optionalFormationText(15), '阵形15', '新阵形号渲成空＝屏幕上一枚空胶囊')
  // 表里有的照旧
  assert.equal(optionalFormationText(1), '单纵阵')
  assert.equal(optionalFormationText(14), '第四警戒')
})

test('无值一个字都不出——不许凭空多一枚胶囊', () => {
  assert.equal(optionalFormationText(undefined), '')
  assert.equal(optionalFormationText(null), '')
  // 0 是「这一战没有阵形」（基地空袭那类），不是未知阵形
  assert.equal(optionalFormationText(0), '', '0 翻成「阵形0」＝凭空造一枚胶囊')
  assert.equal(optionalFormationText(''), '')
  assert.equal(optionalFormationText('   '), '')
})

test('短形化不会把兜底文字截坏', () => {
  // 航迹条上的胶囊会削掉结尾的「阵」字。「阵形15」不以「阵」结尾，必须原样留住；
  // 削成「阵形1」的话，15 号会被显示成 1 号——比空胶囊更糟，那是错的信息。
  const short = (s) => s.replace(/阵$/, '')
  assert.equal(short(optionalFormationText(15)), '阵形15')
  assert.equal(short(optionalFormationText(1)), '单纵')
  assert.equal(short(optionalFormationText(11)), '第一警戒')
  assert.equal(short(optionalFormationText(undefined)), '')
})

test('镝里一处直接下标都不许剩', () => {
  // 六处（航迹条演习/航迹条出击/战斗抬头友方/战斗抬头敌方/预测带/遭遇志抬头）
  // 全部改走规范出口，连别名 import 也撤了——留着别名，下次又会有人顺手下标。
  const hits = di.match(/FORMATION\[/g) ?? []
  assert.deepEqual(hits, [], `镝里还有 ${hits.length} 处直接下标 ENEMY_FORMATION`)
  assert.ok(
    !/ENEMY_FORMATION as FORMATION/.test(di),
    '别名 import 又回来了——它是下次绕过规范出口的入口',
  )
  assert.ok(
    di.includes("import { formationText, optionalFormationText } from '../../shared/enemy-formation'"),
    '镝没有引规范出口',
  )
})

test('四个「可能没有阵形」的位置走 optionalFormationText，两个必有值的走 formationText', () => {
  // 可缺的四处：演习航迹条(eFormation) / 出击航迹条(fFormation) /
  // 战斗抬头友方(b.fFormation) / 战斗抬头敌方(b.eFormation)
  assert.ok(di.includes('const formationPill = optionalFormationText'), 'formationPill 不见了')
  for (const site of [
    'formationPill(s.battle.eFormation)',
    'formationPill(s.battle.fFormation)',
    'esc(formationPill(b.fFormation))',
    'esc(formationPill(b.eFormation))',
  ]) {
    assert.ok(di.includes(site), `缺调用点：${site}`)
  }
  // 必有值的两处（预测带 / 遭遇志抬头）：这两处从前就自带「阵形N」兜底，
  // 只是各写了一份，现在并回规范出口
  assert.ok(di.includes('.map((formation) => formationText(formation))'), '预测带没并回出口')
  assert.ok(di.includes('esc(formationText(e.formation))'), '遭遇志抬头没并回出口')
})
