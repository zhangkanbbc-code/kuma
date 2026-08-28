// 舰娘百科（zh.kcwiki.cn）Lua 模块的表字面量解析。
//
// 为什么要有这一层：多个矿脉包的内容本体都住在 kcwiki 的 Lua 模块里，
// 而我们此前是从 GitHub 上的**镜像仓**（kcwikizh/kcwiki-luatable、kcdata）取的。
// 那些中转仓一律没有 LICENSE，站点却对全部内容声明了 CC BY-NC-SA 3.0
// （api.php?action=query&meta=siteinfo&siprop=rightsinfo 实测）——
// 也就是说，**换掉取数口，同一份数据就从「无许可」变成可随发行版分发**。
// 代价只有这一个解析器。
//
// 支持的语法只覆盖 kcwiki 模块实际用到的那一小撮（这些模块是机器生成的，
// 版式极其规整）：`["键"] = 值`、`标识符 = 值`、数组元素、字符串、数字、
// 布尔、nil、嵌套表、`--` 行注释与 `--[[ ]]` 块注释。
// 碰到没见过的语法一律抛错——宁可抓取失败，也不出一份半懂的残包。

/**
 * 解析 `<varPath> = { … }` 这张表。
 *
 * @param {string} text 模块原文（index.php?action=raw 拿到的那份）
 * @param {string} varPath 赋值左侧的字面量，如 `d.shipDataTb`
 * @returns {Record<string, unknown> | unknown[]}
 */
export const parseLuaTable = (text, varPath) => {
  const anchor = text.indexOf(`${varPath} = {`)
  if (anchor < 0) throw new Error(`Lua 模块里找不到 ${varPath}`)
  let i = text.indexOf('{', anchor)

  const skip = () => {
    for (;;) {
      while (i < text.length && /\s/.test(text[i])) i++
      if (text[i] !== '-' || text[i + 1] !== '-') return
      if (text[i + 2] === '[' && text[i + 3] === '[') {
        const end = text.indexOf(']]', i)
        i = end < 0 ? text.length : end + 2
      } else {
        const nl = text.indexOf('\n', i)
        i = nl < 0 ? text.length : nl + 1
      }
    }
  }

  const readQuoted = () => {
    const quote = text[i]
    i++
    let out = ''
    while (i < text.length) {
      const ch = text[i]
      if (ch === '\\') {
        const next = text[i + 1]
        out += next === 'n' ? '\n' : next === 't' ? '\t' : next === 'r' ? '\r' : next
        i += 2
        continue
      }
      if (ch === quote) {
        i++
        return out
      }
      out += ch
      i++
    }
    throw new Error('Lua 字符串未闭合')
  }

  const readValue = () => {
    skip()
    if (text[i] === '{') return readTable()
    if (text[i] === '"' || text[i] === "'") return readQuoted()
    if (text.startsWith('[[', i)) {
      const end = text.indexOf(']]', i + 2)
      if (end < 0) throw new Error('Lua 长字符串未闭合')
      const out = text.slice(i + 2, end)
      i = end + 2
      return out
    }
    const m = /^(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|nil)/.exec(text.slice(i, i + 40))
    if (!m) throw new Error(`Lua 值无法解析 @${i}：${JSON.stringify(text.slice(i, i + 40))}`)
    i += m[0].length
    if (m[0] === 'true') return true
    if (m[0] === 'false') return false
    if (m[0] === 'nil') return null
    return Number(m[0])
  }

  const readTable = () => {
    i++ // 吃掉 {
    const obj = {}
    const arr = []
    let keyed = false
    for (;;) {
      skip()
      if (i >= text.length) throw new Error('Lua 表未闭合')
      if (text[i] === '}') {
        i++
        break
      }
      if (text[i] === ',' || text[i] === ';') {
        i++
        continue
      }
      if (text[i] === '[') {
        i++
        skip()
        const key = text[i] === '"' || text[i] === "'" ? readQuoted() : readValue()
        skip()
        if (text[i] !== ']') throw new Error(`Lua 键未闭合 @${i}`)
        i++
        skip()
        if (text[i] !== '=') throw new Error(`Lua 键后缺 = @${i}`)
        i++
        obj[`${key}`] = readValue()
        keyed = true
        continue
      }
      const ident = /^([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(text.slice(i, i + 64))
      if (ident) {
        i += ident[0].length
        obj[ident[1]] = readValue()
        keyed = true
        continue
      }
      arr.push(readValue())
    }
    // 混合表（既有键又有数组元素）在 Lua 里数组部分从 1 开始编号；
    // kcwiki 的模块没有这种写法，但真碰上时别静默丢掉数组那半边。
    if (keyed) {
      arr.forEach((value, index) => {
        obj[`${index + 1}`] = value
      })
      return obj
    }
    return arr
  }

  return readTable()
}

/** `["001"] = { … }` 这种以零填充数字（可带一位后缀字母）为键的顶层表。 */
export const isKcwikiEntryKey = (key) => /^[0-9]{3,4}[a-z]?$/.test(key)
