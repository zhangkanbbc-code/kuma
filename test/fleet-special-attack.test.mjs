import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import specialAttackModule from '../dist/shared/fleet-special-attack.js'

const { detectFleetSpecialAttacks, specialAttackLabel } = specialAttackModule

const ship = (name, stype = 9, over = {}) => ({
  name,
  stype,
  lv: 99,
  luck: 20,
  hp: 80,
  hpMax: 80,
  equipment: [],
  ...over,
})
const fillers = (count) => Array.from({ length: count }, (_, index) => ship(`水上舰${index}`, 2))
const labels = (role, ships) =>
  detectFleetSpecialAttacks({ role, ships }).map((attack) => attack.label)

test('Nelson Touch requires the flagship, six surface ships and valid third/fifth slots', () => {
  assert.deepEqual(
    labels('normal', [ship('Nelson改'), ...fillers(5)]),
    ['Nelson Touch'],
  )
  assert.deepEqual(
    labels('normal', [ship('Nelson改'), ship('随伴'), ship('空母', 11), ...fillers(3)]),
    [],
  )
  assert.deepEqual(labels('normal', [ship('Nelson改'), ...fillers(4)]), [])
})

test('Nagato and Colorado attacks use their required battleship positions', () => {
  assert.deepEqual(
    labels('normal', [ship('長門改二'), ship('陸奥改二'), ...fillers(4)]),
    ['长门齐射'],
  )
  assert.deepEqual(
    labels('normal', [ship('Colorado改'), ship('战舰A'), ship('战舰B'), ...fillers(3)]),
    ['Colorado齐射'],
  )
  assert.deepEqual(
    labels('normal', [ship('Colorado改'), ship('驱逐', 2), ship('战舰B'), ...fillers(3)]),
    [],
  )
})

test('Yamato reports every composition-supported two/three-ship attack', () => {
  assert.deepEqual(
    labels('normal', [
      ship('大和改二'),
      ship('武蔵改二'),
      ship('長門改二'),
      ...fillers(3),
    ]),
    ['大和三舰齐射', '大和两舰齐射'],
  )
  assert.deepEqual(
    labels('normal', [ship('武蔵改二'), ship('大和改二重'), ...fillers(4)]),
    ['大和两舰齐射'],
  )
  assert.deepEqual(
    labels('normal', [
      ship('大和改二'),
      ship('比叡改二丙'),
      ship('榛名改二乙'),
      ...fillers(3),
    ]),
    [],
  )
})

test('combined main and escort flagships use separate special-attack paths', () => {
  assert.deepEqual(
    labels('combined-main', [ship('Warspite改'), ship('Valiant改'), ...fillers(4)]),
    ['姊妹舰协同炮击'],
  )
  assert.deepEqual(
    labels('combined-escort', [ship('Warspite改'), ship('Valiant改'), ...fillers(4)]),
    [],
  )
  assert.deepEqual(
    labels('combined-escort', [ship('金剛改二丙'), ship('比叡改二丙'), ...fillers(4)]),
    ['僚舰夜战突击'],
  )
  assert.deepEqual(
    labels('combined-main', [ship('金剛改二丙'), ship('比叡改二丙'), ...fillers(4)]),
    [],
  )
  assert.equal(
    detectFleetSpecialAttacks({
      role: 'combined-escort',
      ships: [ship('金剛改二丙'), ship('比叡改二丙'), ...fillers(4)],
    })[0]?.formation,
    '第二或第四警戒航行序列',
  )
})

test('strike-force and submarine-tender composition rules are detected', () => {
  assert.deepEqual(
    labels('strike', [ship('Richelieu Deux'), ship('Jean Bart改'), ...fillers(5)]),
    ['Richelieu协同齐射'],
  )
  assert.deepEqual(
    labels('normal', [ship('迅鯨改', 20), ship('伊13', 14), ship('伊14', 14)]),
    ['潜水舰队攻击'],
  )
  assert.deepEqual(
    labels('normal', [
      ship('迅鯨改', 20, { lv: 29 }),
      ship('伊13', 14),
      ship('伊14', 14),
    ]),
    [],
    '潜水母舰旗舰未到 Lv30 时不能发动',
  )
  assert.deepEqual(
    labels('normal', [
      ship('迅鯨改', 20, { lv: 30 }),
      ship('伊13', 14),
      ship('伊14', 14),
    ]),
    ['潜水舰队攻击'],
    'Lv30 是可发动边界',
  )
  for (const flagship of ['平安丸', '平安丸改']) {
    assert.deepEqual(
      labels('normal', [ship(flagship, 20), ship('伊13', 14), ship('伊14', 14)]),
      ['潜水舰队攻击'],
    )
  }
  assert.deepEqual(
    labels('normal', [ship('平安丸改', 20), ship('水上舰', 2), ship('伊13', 14), ship('伊14', 14)]),
    [],
    '三、四号位为潜水舰不能替代二、三号位这一发动条件',
  )
})

test('battle CI labels share the fleet display terminology', () => {
  assert.equal(specialAttackLabel(106, 'day'), '姊妹舰协同炮击')
  assert.equal(specialAttackLabel(104, 'night'), '僚舰夜战突击')
  assert.equal(specialAttackLabel(200, 'day'), '瑞云立体攻击')
  assert.equal(specialAttackLabel(200, 'night'), '瑞云夜袭')
})

test('fleet UI renders composition support only beside a flagship', () => {
  const source = fs.readFileSync(new URL('../src/renderer/modules/ru.ts', import.meta.url), 'utf8')
  const html = fs.readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8')
  assert.match(source, /isFlag \? specialAttackChipsHtml\(deck\) : ''/)
  assert.match(source, /role: specialAttackRole\(deck\)/)
  assert.match(source, /ships: fleetShips\(deck\)\.map\(fleetSpecialAttackShipOf\)/)
  for (const field of ['lv', 'luck', 'hp', 'hpMax', 'houm', 'saku', 'largeSearchlight', 'surfaceRadar']) {
    assert.match(source, new RegExp(`\\b${field}:`), `舰队特殊攻击视图缺 ${field}`)
  }
  assert.match(source, /deck\.id === 1 \? 'combined-main' : 'combined-escort'/)
  assert.match(source, /触发阵型：\$\{attack\.formation\}/)
  assert.match(html, /\.fleet-skin \.special-attack-chip/)
  assert.match(html, /\.fleet-skin \.special-attack-chip\.night/)
})
