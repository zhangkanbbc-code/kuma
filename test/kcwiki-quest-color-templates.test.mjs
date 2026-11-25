// 舰娘百科任务页的颜色模板（维护者裁决 2026-11-25）。
// 2026-11-21 批量排版后，战果奖励写成 `{{战果}}{{blue|+350}}`，装备保有位写成 `{{Orange|+4}}`。
// 解析器只剥掉了 Green / Red / color 三种模板名，blue、Orange 的名字被原样留进 memo
// （「战果blue|+350」「装备保有位Orange|+4」），固定战果读取 questFixedSenka 因此读不到数，
// 随包任务库里 7 条固定战果任务全部漏算。颜色模板只是上色，正文是参数本身。
import assert from 'node:assert/strict'
import test from 'node:test'

import { parseKcwikiQuestPages } from '../scripts/lib/kcwiki-quests-scn.mjs'
import senka from '../dist/shared/senka.js'

const { questFixedSenka } = senka

const memoOf = (reward) =>
  parseKcwikiQuestPages([`{{任务表|编号=Bq2|<!--854-->|奖励=${reward}}}`], new Map()).quests[854].memo

test('战果奖励的蓝色模板只留参数：「战果+350」，固定战果读得出 350', () => {
  const memo = memoOf("'''{{战果}}{{blue|+350}}<br />{{改修资材}}×4<br />{{伊良湖}}×3'''")
  assert.match(memo, /^奖励:战果\+350 /)
  assert.doesNotMatch(memo, /blue\|/i)
  assert.equal(questFixedSenka(memo), 350)
})

test('装备保有位的橙色模板只留参数：「装备保有位+4」', () => {
  const memo = memoOf("'''以下奖励三选一：<br />{{补强增设}}×1<br />装备保有位{{Orange|+4}}<br />{{工厂资源}}×4'''")
  assert.match(memo, /装备保有位\+4/)
  assert.doesNotMatch(memo, /Orange\|/i)
})

test('五种颜色模板大小写都按参数取：Green、Red、blue、Orange 与 color', () => {
  for (const name of ['Green', 'green', 'Red', 'red', 'Blue', 'blue', 'Orange', 'orange']) {
    assert.equal(memoOf(`{{${name}|★max}}`), '奖励:★max', name)
  }
})
