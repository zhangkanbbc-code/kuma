import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import ts from 'typescript'
import pop from '../dist/shared/pop-module.js'

// 路由登记大多是模块顶层副作用，import 会启动整套渲染层；用语法树隔离调用，
// 再检查源码属性，不执行模块。di 的两条在 mount 调用的登记函数内，也必须抽到。
const registrations = []
const visitDir = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) visitDir(file)
    else if (entry.name.endsWith('.ts')) {
      const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
      const visit = (node) => {
        if (ts.isCallExpression(node) && node.expression.getText(source) === 'registerEntityRoute') {
          registrations.push({ type: node.arguments[0].text, route: node.arguments[1], source })
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
    }
  }
}
visitDir(fileURLToPath(new URL('../src/renderer', import.meta.url)))
const property = (node, name) => node.properties?.find((prop) => prop.name?.getText() === name)

test('全部 28 条实体路由声明合法且正确的宿主模块', () => {
  const expected = {
    kdock: 'header', practice: 'header', timer: 'header', expedition: 'bi',
    battle: 'di', battleCurrent: 'di', furniture: 'ji',
    shipClass: 'ji', shipTypeCatalog: 'ji', shipTypeGroup: 'ji', shipNationality: 'ji',
    histFleet: 'ji', equipTypeCatalog: 'ji', equipTypeGroup: 'ji', mstShip: 'ji',
    mstEquip: 'ji', equipCapacity: 'ji', abyssShip: 'ji', map: 'ji', abyssEquip: 'ji',
    useitem: 'ji', ship: 'ji', shipCapacity: 'ji', quest: 'qn', questBatch: 'qn',
    fleet: 'ru', fleetShip: 'ru', material: 'zi',
  }
  assert.equal(registrations.length, 28)
  for (const { type, route } of registrations) {
    const mod = property(route, 'mod')?.initializer?.text
    assert.ok([...pop.POP_MODULE_IDS, 'header'].includes(mod), `${type} 缺合法 mod`)
    assert.equal(mod, expected[type], type)
  }
  assert.equal(new Set(registrations.map(({ type }) => type)).size, 28)
})

test('跨模块目标的显式 mod 清单完整，动态标签同样钉住宿主', () => {
  const actual = []
  for (const { type, route, source } of registrations) {
    const targets = property(route, 'targets')
    if (!targets) continue
    const visit = (node) => {
      if (ts.isObjectLiteralExpression(node) && property(node, 'mod')) {
        actual.push([type, property(node, 'label').initializer.getText(source), property(node, 'mod').initializer.text])
      }
      ts.forEachChild(node, visit)
    }
    visit(targets)
  }
  assert.deepEqual(actual, [
    ['kdock', "'工厂履历 · 回顾'", 'shi'],
    ['practice', "'通知规则 · 演习提醒'", 'lg'],
    ['timer', "'通知规则 · 为该倒计时设提醒'", 'lg'],
    ['mstShip', "'有关任务'", 'qn'],
    ['mstEquip', "'有关任务'", 'qn'],
    ['map', "'有关任务'", 'qn'],
    ['useitem', "'相关任务'", 'qn'],
    ['useitem', "'资源统计'", 'zi'],
    ['ship', '`编队 · 定位第${deck.id}舰队中的这艘舰娘`', 'ru'],
    ['quest', "`奖励道具 · ${entityNamePlain('item', item[0], item[1])}`", 'ji'],
    ['quest', '`涉及海域 · ${mapCodeOf(map)}`', 'ji'],
    ['fleet', '`远征规划 · ${expeditionLabel(missionId, mg.master.missions)} 执行中`', 'bi'],
    ['material', "'提供该资源的任务'", 'qn'],
    ['material', "`补充${meta?.label ?? '资源'}的远征`", 'bi'],
  ])
})
