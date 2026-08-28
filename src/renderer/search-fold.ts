// 搜索折叠：小写 + NFKD（全角／→半角/、（→(、ｱ→ｱ 的半角归一）+ 变音符剥离
// （Modèle→modele）+「/ 两侧空格并入斜线」（wiki 原文常写「20.3cm / 50」）。
// 查询串与候选串**两侧同折**，只用于「找得到」，不改任何展示文本。
// 2026-08-12 实锤：主数据里明明有「13.8cm単装砲 Modèle 1927」与
// 「20.3cm/50 連装砲改(SHS改良弾)」，但图鉴搜无重音的 Modele、全角的「／」，
// 活动奖励原文里「20.3cm / 50」带空格，全都对不上——被误判成「没收录」。
//
// searchFoldMap 额外返回「折叠串下标 → 原文下标」映射：折叠会并字
// （è→e 是一并一、㎜→mm 是一拆二、/ 两侧吞空格），连字成链要在**原文**里
// 标出命中区间，必须能从折叠位置落回原文位置。
export const searchFoldMap = (value: string): { folded: string; map: number[] } => {
  const units: string[] = []
  const unitAt: number[] = []
  let at = 0
  for (const ch of value) {
    let piece = ''
    for (const f of ch.toLowerCase().normalize('NFKD')) {
      const code = f.codePointAt(0) ?? 0
      // U+0300–U+036F 拉丁组合变音符：NFKD 分解后剥掉（è→e）
      if (code < 0x300 || code > 0x36f) piece += f
    }
    for (let k = 0; k < piece.length; k++) {
      units.push(piece[k])
      unitAt.push(at)
    }
    at += ch.length
  }
  const folded: string[] = []
  const map: number[] = []
  for (let i = 0; i < units.length; i++) {
    if (units[i] === ' ') {
      let j = i
      while (j < units.length && units[j] === ' ') j++
      const prevSlash = folded.length > 0 && folded[folded.length - 1] === '/'
      const nextSlash = j < units.length && units[j] === '/'
      if (prevSlash || nextSlash) {
        i = j - 1
        continue
      }
    }
    folded.push(units[i])
    map.push(unitAt[i])
  }
  return { folded: folded.join(''), map }
}

export const searchFold = (value: string): string => searchFoldMap(value).folded
