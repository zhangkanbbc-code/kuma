import assert from 'node:assert/strict'
import test from 'node:test'

import {
  filterEquipNames,
  renderEquipCategories,
} from './fixtures/render-equip-stock.mjs'

test('装备仓库精确筛选格子显示本地化类别名', () => {
  const html = renderEquipCategories()
  assert.match(html, /舰上战斗机/)
  assert.doesNotMatch(html, /艦上戦闘機/)
})

test('装备仓库搜索与图鉴同折：输 modele 能命中 Modèle', () => {
  assert.deepEqual(
    filterEquipNames('modele', ['13.8cm単装砲 Modèle 1927', '零式艦戦21型']),
    ['13.8cm単装砲 Modèle 1927'],
  )
})
