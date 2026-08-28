// 装备类别名查不到时报号，不许落成空串（2026-08-25）。
//
// `equipTypes` 是从主数据现建的「类别号 → 名」表。新装备带来新类别号、或者
// 主数据还没同步时，`get()` 拿不到东西。图鉴里同一件事有两种写法：
//   · 多数处 `?? \`分类${cat}\`` —— 如实报号，格子还在，玩家看得出「有个类别，
//     只是这版资料还没有它的名字」；
//   · 另外五处 `?? ''` —— 落成空串。后果不是「少一行」，是**长得像正常界面的残缺**：
//     面包屑从「大口径主炮 › 装备名」变成「› 装备名」凭空少一截；
//     `.badge` / 深海那枚粉框徽章渲成一个什么字都没有的空框；
//     深海装备速览卡第一行变成「ID 501 · 」，后面挂着一个没下文的分隔点。
//
// 这个文件把「报号」钉成全仓唯一写法：逐个扫 `equipTypes.get(...)`，
// 谁的兜底是空串就红。用扫描而不是列举行号——行号会漂，而且新写的第六处
// 也该被管住。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const ji = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')

/** 从 `equipTypes.get(` 起按括号配平取出实参，再取紧随其后的 `?? 兜底`。 */
const collectCallSites = (source) => {
  const sites = []
  const needle = 'equipTypes.get('
  let at = source.indexOf(needle)
  while (at !== -1) {
    let depth = 0
    let i = at + needle.length - 1
    for (; i < source.length; i += 1) {
      if (source[i] === '(') depth += 1
      else if (source[i] === ')') {
        depth -= 1
        if (depth === 0) break
      }
    }
    const arg = source.slice(at + needle.length, i)
    const after = source.slice(i + 1, i + 1 + 200)
    const line = source.slice(0, at).split('\n').length
    const fallback = after.match(/^\s*\?\?\s*(`[^`]*`|'[^']*'|"[^"]*")/)
    sites.push({ line, arg, fallback: fallback ? fallback[1] : null, after })
    at = source.indexOf(needle, i)
  }
  return sites
}

const sites = collectCallSites(ji)

test('扫描器确实找得到那一族调用点', () => {
  // 扫描器自己坏掉的话，下面几条会全绿而什么都没查——先钉住它有产出
  assert.ok(sites.length >= 12, `只扫到 ${sites.length} 处 equipTypes.get，扫描器多半坏了`)
})

test('没有一处的兜底是空串', () => {
  const empty = sites.filter((s) => s.fallback === "''" || s.fallback === '""' || s.fallback === '``')
  assert.deepEqual(
    empty.map((s) => `ji.ts:${s.line}`),
    [],
    '这些位置的类别名查不到时会落成空串：面包屑少一截、徽章渲成空框、速览卡留一个没下文的分隔点',
  )
})

test('每一处都带兜底，且报号的那些报的是自己那个 key', () => {
  for (const site of sites) {
    assert.ok(
      site.fallback !== null,
      `ji.ts:${site.line} 的 equipTypes.get 没有兜底——拿不到就是 undefined 上屏`,
    )
    if (site.fallback.startsWith('`分类')) {
      // 报号必须报**自己查的那个号**。复制粘贴时最容易出的错是兜底里还写着
      // 上一处的变量名，那样界面会指着 A 类别说 B 的号——比空串更糟
      assert.equal(
        site.fallback,
        `\`分类\${${site.arg}}\``,
        `ji.ts:${site.line} 的兜底报的不是自己查的那个类别号`,
      )
    }
  }
})

test('审计点名的三个显示位都报号了', () => {
  // 面包屑（少一截）/ 徽章（空框）/ 深海抽屉标题（空粉框）
  assert.ok(
    ji.includes(
      '<span class="crumb">${entityNameHtml(\'equipType\', cat, equipTypes.get(cat) ?? `分类${cat}`, { compact: true })} ›',
    ),
    '装备抽屉的面包屑还会凭空少一截',
  )
  assert.ok(
    ji.includes(
      '<span class="badge type">${entityNameHtml(\'equipType\', cat, equipTypes.get(cat) ?? `分类${cat}`, { compact: true })}</span>',
    ),
    '装备抽屉的类别徽章还会渲成空框',
  )
  assert.ok(
    ji.includes(
      "const typeName = entityNamePlain('equipType', abyssCat, equipTypes.get(abyssCat) ?? `分类${abyssCat}`)",
    ),
    '深海装备抽屉的类别徽章还会渲成空粉框',
  )
})
