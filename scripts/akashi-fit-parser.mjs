// ⚠ akashi-list.me 未声明数据许可 → **维护者侧专用**：只在
//    `node scripts/fit-bonus-votes.mjs` 里给吵起来的装备取一票，
//    结果落 assets/review（已 gitignore），**绝不写进 assets/lodes、不随包分发**。
//    本文件只是清洗层，不含任何抓来的数据。
//
// 2026-08-22：运行时那一份（src/main/akashi-fit.ts，含 IPC 与本地缓存）**整层退役**——
// 「不随包、玩家显式拉取」的中间路已被废弃，应用里不再有指向这个站点的出网点。
// 上游没收录的新装备改由面板反推的实测层兜（src/shared/fit-bonus.ts）。
// 所以「改动要两边同步」那条注意事项也随之作废：现在只剩这一份。
//
// akashi-list.me 装備ボーナス 清洗层（维护者侧取票用）
//
// 数据来源：站点自己的 XHR 端点 detail/w{id}.html——在其内联 app.js 里读出来的
//   （r.open("GET","detail/"+e+".html")）。不是抓渲染后的 DOM，是抓它本来就下发的片段。
//
// 结构（w555 这类复杂例子才看得全）：
//   <div class="detail-row bonus-contents">          ← 注意目标类名在 class 的第二个
//     <td class=fit>
//       <span>
//         <div>                                      ← 基础加成
//           <sunit>火力+2<sn class=rbonus><r>…</r>×10</sn></sunit>   ← 基础值 + ★1..★10 逐星追加
//           <sunit>対潜+1</sunit>
//         </div>
//         <div class=sm1>＋<a>10cm/56…</a>：<sunit>火力+1</sunit>…</div>  ← 併用シナジー
//       </span>
//       <span><sunit>Киров</sunit></span>            ← 适用对象
//     </td>
//
// 三者必须分开存：把逐星追加和基础值拼成一串会变成「火力+2+1+1+1+1+1+1+2+4」这种
// 既不是基础值也不是任何一档★的假数字。

const ENT = { '&gt;': '>', '&lt;': '<', '&amp;': '&', '&nbsp;': ' ', '&#8203;': '' }
const txt = (s) =>
  s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(gt|lt|amp|nbsp|#8203);/g, (m) => ENT[m] ?? m)
    .replace(/[ \t]+/g, ' ')
    .trim()

// 深度感知地取某个 class 的元素内容（嵌套同名标签不会提前截断）
const blockByClass = (html, tag, cls, from = 0) => {
  const start = html.slice(from).search(new RegExp(`<${tag}[^>]*\\bclass=["']?[^">]*\\b${cls}\\b`))
  if (start < 0) return null
  const abs = from + start
  const re = new RegExp(`<${tag}\\b[^>]*>|</${tag}\\s*>`, 'gi')
  re.lastIndex = abs
  let depth = 0
  let m
  while ((m = re.exec(html))) {
    if (m[0][1] !== '/') depth++
    else if (--depth === 0) return { inner: html.slice(abs, m.index), end: re.lastIndex }
  }
  return null
}

// 顶层 <sunit>（不含嵌在 <sn> 里的那些）
const topSunits = (html) => {
  const out = []
  const re = /<sunit\b[^>]*>/gi
  let m
  while ((m = re.exec(html))) {
    // 找配对的 </sunit>（sunit 可嵌套：<sunit><sn>…<r><sunit>…</sunit></r></sn></sunit>）
    let depth = 1
    const inner = /<sunit\b[^>]*>|<\/sunit\s*>/gi
    inner.lastIndex = re.lastIndex
    let k
    let endAt = -1
    while ((k = inner.exec(html))) {
      if (k[0][1] !== '/') depth++
      else if (--depth === 0) {
        endAt = k.index
        break
      }
    }
    if (endAt < 0) break
    out.push(html.slice(re.lastIndex, endAt))
    re.lastIndex = inner.lastIndex
  }
  return out
}

// 逐个取出 <sn>…</sn> 块（深度感知），返回 [{inner, at, len}]
const snBlocks = (html) => {
  const out = []
  const re = /<sn\b[^>]*>|<\/sn\s*>/gi
  let depth = 0
  let start = -1
  let m
  while ((m = re.exec(html))) {
    if (m[0][1] !== '/') {
      if (depth === 0) start = m.index
      depth++
    } else if (--depth === 0 && start >= 0) {
      out.push({ inner: html.slice(start, re.lastIndex), at: start, len: re.lastIndex - start })
      start = -1
    }
  }
  return out
}

// 把所有 <sn> 块从片段里摘掉——它们装的是「改修逐星追加」，不是基础值。
// 不摘掉的话：<r> 里嵌的 <sunit> 会被当成顶层基础值（w555「Киров以外」那格
// 本来一个基础值都没有，会被读成「火力+1 火力+1 火力+1…」十几个）。
const stripSn = (html) => {
  let out = html
  for (const b of snBlocks(html).reverse()) out = out.slice(0, b.at) + out.slice(b.at + b.len)
  return out
}

// 一个 <sn class=rbonus> → ★1..★10 各档追加（空串 = 该档无追加）。
// 只认它自己那一层的 <r>；一格里可能有好几个 <sn> 组（w564 有 4 组），
// 各归各的，混成一串会变成 40 档的假数据。
const starOf = (snHtml) => {
  const rs = [...snHtml.matchAll(/<r\b[^>]*>([\s\S]*?)<\/r\s*>/gi)].map((r) => txt(r[1]))
  return rs.some(Boolean) ? rs : null
}

export const parseAkashiFit = (html) => {
  const box = blockByClass(html, 'div', 'bonus-contents')
  if (!box) return null
  const rules = []
  for (const td of box.inner.matchAll(/<td[^>]*\bclass=["']?[^">]*\bfit\b[^>]*>([\s\S]*?)<\/td\s*>/gi)) {
    const cell = td[1]
    // 顶层 <span>：[0] 加成内容，最后一个 = 适用对象
    const spans = []
    let cursor = 0
    while (true) {
      const b = blockByClass(cell, 'span', '[^"]*', cursor)
      if (!b) break
      spans.push(b.inner)
      cursor = b.end
    }
    // class 匹配用不上时退回朴素切分
    const parts = spans.length >= 2 ? spans : [...cell.matchAll(/<span\b[^>]*>([\s\S]*?)<\/span\s*>/gi)].map((x) => x[1])
    if (parts.length < 2) continue
    const targetHtml = parts[parts.length - 1]
    const gainHtml = parts.slice(0, -1).join('')

    const targets = topSunits(targetHtml)
      .flatMap((u) => txt(u).split('\n'))
      .map((x) => x.trim())
      .filter(Boolean)
    if (!targets.length) continue

    // 併用シナジー：<div class=sm1>＋装备名：<sunit>…</sunit></div>
    const synergy = []
    let rest = gainHtml
    while (true) {
      const sm = blockByClass(rest, 'div', 'sm1')
      if (!sm) break
      const withName = txt(sm.inner.replace(/<sunit[\s\S]*$/i, '')).replace(/^＋/, '').replace(/[：:]\s*$/, '')
      const gains = topSunits(stripSn(sm.inner)).map(txt).filter(Boolean)
      if (gains.length) synergy.push({ with: withName, gains })
      rest = rest.slice(0, rest.indexOf(sm.inner)) + rest.slice(rest.indexOf(sm.inner) + sm.inner.length)
    }

    // 基础值：摘掉 <sn> 后剩下的顶层 sunit
    const gains = topSunits(stripSn(rest)).map(txt).filter(Boolean)
    // 逐星追加：每个 <sn class=rbonus> 一组，标注它挂在哪个基础值上
    const star = []
    for (const b of snBlocks(rest)) {
      if (!/rbonus/.test(b.inner)) continue
      const per = starOf(b.inner)
      if (!per) continue
      // 挂载对象 = 紧挨它前面那个基础值（sunit 内的文本），没有则是「仅改修后才有」
      const before = stripSn(rest.slice(0, b.at))
      const prev = topSunits(before).map(txt).filter(Boolean).pop()
      star.push({ of: prev ?? '(仅改修后)', per })
    }
    if (!gains.length && !star.length && !synergy.length) continue
    // 忠实度自评：只有「対象 → 一组固定加成」这种干净格才敢当结构化数据用。
    // 一旦掺进逐星追加、併用、或按装备数分档的逗号串（火力+2,+6,+8,+10），
    // 三者的组合关系本工具还没建模对——照实标 partial，让 UI 挂牌并指向原页，
    // 不把半懂的结构拼成一个看起来像真值的数字。
    const byCount = gains.some((g) => /,/.test(g))
    const partial = star.length > 0 || synergy.length > 0 || byCount
    rules.push({
      targets,
      gains,
      ...(star.length ? { star } : {}),
      ...(synergy.length ? { synergy } : {}),
      ...(partial ? { partial: true } : {}),
    })
  }
  return rules.length ? rules : null
}
