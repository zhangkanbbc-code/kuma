import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import expeditionComposition from '../dist/shared/expedition-composition.js'

const { parseCompositionBranches, parseSuccessVariants, compReqStatus, compShipFits } =
  expeditionComposition.default ?? expeditionComposition
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('远征编成解析:舰种/数量/旗舰/通配各就各位', () => {
  const [branch] = parseCompositionBranches('轻巡*1、驱逐/海防*2、其他*1')
  const reqs = branch.reqs
  assert.equal(branch.label, '', '单编成不该有分支标签')
  assert.equal(reqs.length, 3)
  assert.deepEqual(reqs[0].types, [3])
  assert.equal(reqs[0].count, 1)
  assert.deepEqual([...reqs[1].types].sort((a, b) => a - b), [1, 2])
  assert.equal(reqs[1].count, 2)
  assert.equal(reqs[2].wildcard, true)
  // 日文「駆逐」也认(主数据自述文本是日文)
  assert.deepEqual(parseCompositionBranches('駆逐*2')[0].reqs[0].types, [2])
  // 认不出的舰种必须落 null(界面 ◌),绝不猜
  assert.equal(parseCompositionBranches('不存在舰种*1')[0].reqs[0].types, null)
})

test('43:「或」拆成两支,禁混搭与护卫空母语义都进模型', () => {
  // kcwiki 43 原文(2026-08-13 用户点名复查:原先摊平成同时要求,
  // 走护卫空母分支的合法编成必然吃 ✗)
  const text =
    '护卫空母*1(必须旗舰) 驱逐/海防*2(1驱逐+1海防不可)\n其他*3\n或\n轻空母*1(必须旗舰) 轻巡*1 驱逐*4'
  const branches = parseCompositionBranches(text)
  assert.equal(branches.length, 2)
  assert.equal(branches[0].label, '编成一')
  assert.equal(branches[1].label, '编成二')
  const [cveReq, pairReq] = branches[0].reqs
  // 护卫空母 ≠ 任意轻母:cve 标记要求判定端用基础对潜落实
  assert.equal(cveReq.cve, true)
  assert.equal(cveReq.flagship, true)
  assert.deepEqual(cveReq.types, [7])
  // 「(1驱逐+1海防不可)」= 须同一舰种凑满,不能静默丢掉
  assert.equal(pairReq.homogeneous, true)
  assert.equal(pairReq.count, 2)
  const second = branches[1].reqs
  assert.equal(second[0].cve, false, '轻空母分支不要求护卫空母')
  assert.equal(second[2].count, 4)
  assert.deepEqual(second[2].types, [2])
})

test('A4 式连写:「或练巡旗舰+海防舰*2 其他*2」拆得开', () => {
  const branches = parseCompositionBranches(
    '护卫空母/轻巡(必须旗舰) 驱逐*2 其他*2 \n或练巡旗舰+海防舰*2 其他*2',
  )
  assert.equal(branches.length, 2)
  const [cl, de, rest] = branches[1].reqs
  assert.deepEqual(cl.types, [21])
  assert.equal(cl.flagship, true)
  assert.equal(cl.count, 1)
  assert.deepEqual(de.types, [1])
  assert.equal(de.count, 2)
  assert.equal(rest.wildcard, true)
})

test('wiki「でも成功する」变体编成逐组解析,吃不干净整组丢弃', () => {
  const raw =
    '…他3隻 (軽母(旗艦)1駆1海防3他1)(軽母(旗艦)1軽巡1海防2他2)(謎トークン1駆1)の編成でも成功する。'
  const variants = parseSuccessVariants(raw)
  // 第三组含词表外的「謎トークン」→ 整组丢弃,宁缺毋猜
  assert.equal(variants.length, 2)
  const [v1] = variants
  assert.equal(v1.label, 'wiki 变体1')
  assert.deepEqual(
    v1.reqs.map((r) => [r.types?.[0] ?? null, r.count, r.flagship, r.wildcard]),
    [[7, 1, true, false], [2, 1, false, false], [1, 3, false, false], [null, 1, false, true]],
  )
  // 護母 token 带 cve 标记
  assert.equal(parseSuccessVariants('(護母1駆2)の編成でも成功')[0].reqs[0].cve, true)
  assert.equal(parseSuccessVariants('没有变体句').length, 0)
})

test('判定语义:禁混搭取单一舰种最大数,护卫空母不许拿轻母顶包', () => {
  const req = {
    label: '驱逐/海防', types: [1, 2], count: 2,
    flagship: false, wildcard: false, cve: false, homogeneous: true,
  }
  const dd = { stype: 2, cve: false }
  const de = { stype: 1, cve: false }
  // 1驱逐+1海防 = 混搭,不算凑满
  assert.equal(compReqStatus(req, [dd, de]).ok, false)
  assert.equal(compReqStatus(req, [dd, de]).matched, 1)
  assert.equal(compReqStatus(req, [de, de]).ok, true)
  assert.equal(compReqStatus(req, [dd, dd, de]).matched, 2)

  const cveReq = {
    label: '护卫空母(旗舰)', types: [7], count: 1,
    flagship: true, wildcard: false, cve: true, homogeneous: false,
  }
  const taiyou = { stype: 7, cve: true }
  const ryujo = { stype: 7, cve: false }
  assert.equal(compReqStatus(cveReq, [taiyou]).ok, true)
  const fake = compReqStatus(cveReq, [ryujo])
  assert.equal(fake.ok, false, '普通轻母不是护卫空母')
  assert.equal(fake.flagOk, false)
})

// 2026-09-23 玩家报 A4 川内改二旗舰被判「旗舰舰种不符」：「护卫空母/轻巡」并列时，
// 护卫空母限定曾套到整组，轻巡也被要求是护卫空母。限定只管轻母位，
// 并列里另有普通轻母写法（45「护卫空母/轻空母」）时整组不限定。
test('「护卫空母/X」并列：护卫空母限定只管轻母位，不连带另一舰种', () => {
  const sendai = { stype: 3, cve: false }
  const taiyou = { stype: 7, cve: true }
  const ryujo = { stype: 7, cve: false }
  const dd = { stype: 2, cve: false }
  const de = { stype: 1, cve: false }

  // kcwiki A4 原文
  const a4 = parseCompositionBranches(
    '护卫空母/轻巡(必须旗舰) 驱逐*2 其他*2 \n或练巡旗舰+海防舰*2 其他*2',
  )[0].reqs[0]
  assert.deepEqual([...a4.types].sort((a, b) => a - b), [3, 7])
  assert.equal(a4.flagship, true)
  assert.equal(a4.cve, true, '轻母位仍须是护卫空母')
  const a4Sendai = compReqStatus(a4, [sendai, dd, dd, dd, dd, dd])
  assert.equal(a4Sendai.ok, true, '轻巡旗舰合法')
  assert.equal(a4Sendai.flagOk, true)
  assert.equal(compReqStatus(a4, [taiyou, dd, dd, dd, dd]).ok, true, '护卫空母旗舰合法')
  assert.equal(compReqStatus(a4, [ryujo, dd, dd, dd, dd]).ok, false, '普通轻母旗舰仍不合法')

  // kcwiki 42 原文
  const m42 = parseCompositionBranches('护卫空母/轻巡*1 驱逐/海防*2 （驱逐至少1只） 其他*1')[0].reqs[0]
  assert.equal(compReqStatus(m42, [sendai, dd, de, dd]).ok, true)
  assert.equal(compReqStatus(m42, [ryujo, dd, de, dd]).ok, false)

  // kcwiki 45 原文：护卫空母或轻空母皆可，普通轻母不受限
  const m45 = parseCompositionBranches('护卫空母/轻空母（旗舰固定）*1，\n驱逐/海防*4')[0].reqs[0]
  assert.equal(m45.flagship, true)
  assert.equal(m45.cve, false, '并列里有普通轻母写法，整组不限定护卫空母')
  assert.equal(compReqStatus(m45, [ryujo, dd, dd, dd, de]).ok, true)
  assert.equal(compReqStatus(m45, [taiyou, dd, dd, dd, de]).ok, true)

  // 单舰逐艘判定与合计判定同一口径
  assert.equal(compShipFits(a4, sendai), true)
  assert.equal(compShipFits(a4, taiyou), true)
  assert.equal(compShipFits(a4, ryujo), false)
  assert.equal(compShipFits(a4, dd), false)
  assert.equal(compShipFits(m45, ryujo), true)

  // 纯护卫空母要求照旧（43 编成一）
  const m43 = parseCompositionBranches('护卫空母*1(必须旗舰) 驱逐/海防*2(1驱逐+1海防不可)\n其他*3')[0].reqs[0]
  assert.equal(m43.cve, true)
  assert.equal(compShipFits(m43, ryujo), false)
  assert.equal(compShipFits(m43, taiyou), true)
})

test('规划器坑位与条件检查共用单舰判定，不再各写一套护卫空母判法', () => {
  const bi = readFileSync(path.join(root, 'src', 'renderer', 'modules', 'bi.ts'), 'utf8')
  assert.match(bi, /compShipFits\(req, /)
  assert.doesNotMatch(bi, /!needCve \|\| isCveShip/)
})

const kcPackFile = path.join(root, 'assets', 'lodes', 'kcwiki-expedition.json')
test('kcwiki-expedition 真包：A4/42/45 的合法编成判为满足', { skip: !existsSync(kcPackFile) }, () => {
  const pack = JSON.parse(readFileSync(kcPackFile, 'utf8'))
  const rows = Array.isArray(pack.data) ? pack.data : Object.values(pack.data)
  const byId = (id) => rows.find((row) => String(row?.id) === id)
  const sendai = { stype: 3, cve: false }
  const ryujo = { stype: 7, cve: false }
  const dd = { stype: 2, cve: false }
  const de = { stype: 1, cve: false }
  const passes = (id, ships) =>
    parseCompositionBranches(byId(id).composition, byId(id).escortText ?? null).some((branch) =>
      branch.reqs.every((req) => req.wildcard || !req.types || compReqStatus(req, ships).ok),
    )
  assert.equal(passes('A4', [sendai, dd, dd, dd, dd, dd]), true, 'A4 川内旗舰 + 驱逐五')
  assert.equal(passes('42', [sendai, dd, de, dd]), true, '42 轻巡 + 驱逐海防')
  assert.equal(passes('45', [ryujo, dd, dd, dd, de]), true, '45 普通轻母旗舰')
})

test('镖的判定端接的是分支口径,护卫空母用主数据 api_tais 落实', () => {
  const bi = readFileSync(path.join(root, 'src', 'renderer', 'modules', 'bi.ts'), 'utf8')
  // 条件检查与规划器都不许再用摊平的单列表解析
  assert.doesNotMatch(bi, /parseComposition\(/)
  assert.match(bi, /parseCompositionBranches\(w\.composition, w\.escortText \?\? null\)/)
  // 分支取失败最少的那支展示；多分支时明说「满足任一组」。
  // 2026-08-26 文案清扫删了「按最接近的 X 列出」这句实现叙述(族 C),
  // 「取最接近的那一支」这件事本来就该钉挑选逻辑:失败项最少、同数再比未知项。
  assert.match(bi, /满足任一组/)
  assert.match(bi, /均未满足/)
  assert.match(
    bi,
    /right\.fails < left\.fails \|\|\s*\n?\s*\(right\.fails === left\.fails && right\.unknowns < left\.unknowns\)/,
    '多分支不再取「最接近」的那一支了',
  )
  assert.match(bi, /rows\.push\(\.\.\.best\.rows\)/)
  // 护卫空母判别:api_tais 只长在护卫空母身上,不是启发式
  assert.match(bi, /baseTais \?\? 0\) > 0/)
  assert.match(bi, /不可 1\+1 混搭/)
})

const packFile = path.join(root, 'assets', 'lodes', 'wikiwiki-expedition.json')
test('wikiwiki-expedition 真包:条件与变体解析覆盖率 100%', { skip: !existsSync(packFile) }, () => {
  // 判定引擎的诚实闸是 ◌「无法自动判定」,但那是给**个别**疑难条件的;
  // 整包出现解析不动的 token 说明舰种映射表落后了,要在这里先红,
  // 不能让玩家在面板上撞一排 ◌ 才发现(2026-08-11 用户口径:
  // 检测类必须正常工作,不能给错误信息浪费玩家时间)。
  const pack = JSON.parse(readFileSync(packFile, 'utf8'))
  const entries = Object.entries(pack.data.expeditions ?? pack.data)
  assert.ok(entries.length >= 60, `远征条目至少 60,实际 ${entries.length}`)
  const bad = []
  let variantTotal = 0
  for (const [no, e] of entries) {
    const comp = e?.composition
    if (comp && !/^任意$/.test(`${comp}`.trim())) {
      for (const branch of parseCompositionBranches(`${comp}`, e?.rawComposition ?? null)) {
        if (/变体/.test(branch.label)) variantTotal++
        for (const req of branch.reqs) {
          if (!req.wildcard && req.types == null) bad.push(`${no}:「${req.label}」`)
        }
      }
    } else if (e?.rawComposition) {
      variantTotal += parseSuccessVariants(e.rawComposition).length
    }
  }
  assert.deepEqual(bad, [], '这些条件 token 解析不出舰种,扩 TYPE_RULES 或修矿脉')
  // 变体句在包里有 9 条远征(4/5/9/42/43/A3~A6),每条至少 4 组——
  // 抽出来的变体总数塌了就是记法变了或解析器坏了
  assert.ok(variantTotal >= 30, `wiki 变体编成应 ≥30 组,实际 ${variantTotal}`)
  // 锚定抽查:远征5 的经典条件与收益(轻巡1+驱逐/海防2,燃弹 200/200)
  const five = (pack.data.expeditions ?? pack.data)['5']
  assert.equal(five.flagLv, 3)
  assert.equal(five.rewards.fuel[0], 200)
  assert.equal(five.rewards.ammo[0], 200)
})
