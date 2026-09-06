// 同 id 资料包按版本取新；相等仍保留手动导入的覆盖意义。
// 日期与数字序列逐段比较，非数字版本（如内容摘要）按字符串比较。
export const compareLodeVersions = (user: unknown, builtin: unknown): number | null => {
  const parse = (value: unknown): number[] | string | null => {
    if (typeof value !== 'string' || !value.trim() || value.length > 100) return null
    const text = value.trim()
    if (/^\d+(?:[.\-/]\d+)*$/.test(text)) {
      const parts = text.split(/[.\-/]/).map(Number)
      return parts.every(Number.isSafeInteger) ? parts : null
    }
    // 数字序列中断或混入空白属于解析失败；字母/摘要版本保留字符串回退。
    if (/\s/.test(text) || /^[\d.\-/]+$/.test(text)) return null
    return text
  }
  const a = parse(user)
  const b = parse(builtin)
  if (a === null || b === null) return null
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const diff = (a[i] ?? 0) - (b[i] ?? 0)
      if (diff) return Math.sign(diff)
    }
    return 0
  }
  const left = String(user).trim()
  const right = String(builtin).trim()
  return left === right ? 0 : left > right ? 1 : -1
}
