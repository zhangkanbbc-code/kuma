// 深海舰的同族归并键。
//
// 一艘深海舰会派生出一堆形态：`-壊`（破坏形态）、`改`、季节限定的
// `バカンスmode` / `夏季上陸mode`，而且**层层可叠**——
// 「集積地棲姫 バカンスmode-壊」三层都占了。把这些后缀剥掉才能归到同一族。

const SUFFIXES: RegExp[] = [
  /[‐‑‒–—―－-]?[壊坏]$/u, // -壊 / -坏
  /(?:夏|バカンス)?(?:mode|モード)$/i, // バカンスmode / 夏季上陸mode
  /改(?:II|Ⅱ|二)?$/iu, // 改 / 改II
]

/**
 * 归族用的键。剥到不再变化为止。
 *
 * 循环是必须的，不能只按固定顺序过一遍：原实现先试 mode 再试壊，
 * 遇到「…バカンスmode-壊」时 mode 规则不匹配（那时结尾是「壊」），
 * 等剥完壊已经没机会回头剥 mode，于是它自成一族、跟本体分了家。
 * 实测 2026-08-09：修好之后族数 188 → 180，25 条名字归位。
 *
 * 注意 `II` 不剥：「集積地棲姫II」是另一艘舰，不是「集積地棲姫」的形态。
 */
export const abyssFamilyKey = (name: string): string => {
  let key = name.normalize('NFKC').replace(/\s+/g, '')
  // 上限只是防手滑写出会自增长的规则；正常最多剥三层
  for (let i = 0; i < 5; i++) {
    let next = key
    for (const re of SUFFIXES) next = next.replace(re, '')
    if (next === key) break
    key = next
  }
  return key
}
