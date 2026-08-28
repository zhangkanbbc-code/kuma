// 把 wikiwiki 敌编成表里的标注名定到游戏的 mstId 上。
//
// 为什么要在维护期做：运行时只该认数字或如实标注的候选池。wiki 写的是
// 「重巡夏姫(A)(HP400)」这种人读的标注，主数据里叫「重巡夏姫」且有三个同名 id；
// 在运行时把它猜成单一 id，一旦指错就是在战斗界面上对着玩家说错敌人是谁。
// 挪到入库这一步，产物要过 candidate → diff → approve 那道人工闸，
// 错了在合入前就能看见。
//
// 标注解析与候选池口径在 src/shared/abyssal-label.ts——运行时的模糊命中
// 也用那一份，两边算出的池必须一致。这里在池的基础上做**收敛到单一 id**
// 的判据仲裁，这一步只许维护期做。
//
// 判据只用能查证的三样，全部来自已有数据，不发明约定：
//
// 1. **基名 + 等级**：主数据的 api_name 与 api_yomi（""/"-"/"elite"/"flagship"）。
//    剥括号必须**最长匹配优先**——「飛行場姫(哨戒機配備)」整个就是主数据里的名字，
//    当成标注剥掉会把候选池扩大到十几个 飛行場姫。
// 2. **字母**：wiki 的 (A)(B)(C)… = 同名同等级的形态按 mstId 升序的第几个。
//    这条是从数据里立出来的，不是猜的——见下面的交叉校验。
// 3. **HP**：wiki 常一并写 (HP400)，abyssal-stats 有逐 id 的 api_taik。
//
// **两条判据都在时必须一致，不一致就拒绝定号。** 这是这套东西的安全阀，
// 也是字母那条规律的证据：矿脉里 106 个同时带字母和 HP 的标注，100 个两者一致；
// 剩下 6 个不是规律不成立，而是 abyssal-stats 还没收录的新舰（HP 查不到）。
// 拒绝掉的标注保持原样留在包里，照常显示名字，只是不参与前三舰的精确匹配——
// 宁可少一条线索，也不能指错敌人。

import {
  createAbyssalNameIndex,
  parseAbyssalLabel,
  stripAbyssalWikiMarkup,
} from '../../src/shared/abyssal-label.ts'

export const stripWikiMarkup = stripAbyssalWikiMarkup
export { parseAbyssalLabel }

/**
 * @param masterShips api_mst_ship 里的深海条目（含 api_id / api_name / api_yomi）
 * @param abyssalStats abyssal-stats 资料包的 data（id → { api_taik, ... }）
 */
export const createAbyssalIdPinner = ({ masterShips, abyssalStats = {} }) => {
  const index = createAbyssalNameIndex(
    masterShips.map((ship) => ({
      id: Number(ship.api_id),
      name: `${ship.api_name ?? ''}`,
      yomi: `${ship.api_yomi ?? ''}`,
    })),
  )

  const hpOf = (id) => abyssalStats[id]?.api_taik ?? abyssalStats[`${id}`]?.api_taik ?? null

  /** @returns {{ id: number|null, reason: string, candidates?: number[] }} */
  return (label) => {
    if (typeof label === 'number') return { id: label, reason: '资料包里已是数字' }
    const exactId = index.exactIdOf(label)
    if (exactId != null) return { id: exactId, reason: '与主数据名字完全一致' }

    const parsed = index.parse(label)
    if (!index.isKnownBase(parsed.base)) {
      return { id: null, reason: `主数据里没有「${parsed.base}」这个名字` }
    }
    const pool = index.poolOf(label)
    if (!pool.length) {
      return { id: null, reason: `主数据里没有「${parsed.base}」的 ${parsed.rank || '無印'} 形态` }
    }
    if (pool.length === 1) return { id: pool[0], reason: '同名同级只有一个形态', candidates: pool }

    const byLetter = parsed.letter ? (pool[parsed.letter.charCodeAt(0) - 65] ?? null) : null
    const byHp = parsed.hp ? pool.filter((id) => hpOf(id) === parsed.hp) : null

    if (byLetter && byHp) {
      if (byHp.length === 1 && byHp[0] === byLetter) {
        return { id: byLetter, reason: `字母 ${parsed.letter} 与 HP${parsed.hp} 两条判据一致`, candidates: pool }
      }
      // 冲突：宁可不定。多半是 abyssal-stats 还没收录这条新舰的 HP。
      return {
        id: null,
        reason: `字母 ${parsed.letter} 指向 ${byLetter}，HP${parsed.hp} 指向 ${
          byHp.length ? byHp.join('/') : '（查不到）'
        }，两者不一致`,
        candidates: pool,
      }
    }
    if (byLetter) return { id: byLetter, reason: `字母 ${parsed.letter} = 同名同级第 ${parsed.letter.charCodeAt(0) - 64} 个`, candidates: pool }
    if (byHp?.length === 1) return { id: byHp[0], reason: `HP${parsed.hp} 在同名同级里唯一`, candidates: pool }

    return {
      id: null,
      reason: parsed.notes.length
        ? `标注「${parsed.notes.join('/')}」没有可查证的对应项，${pool.length} 个形态分不开`
        : `没有任何区分标注，${pool.length} 个形态分不开`,
      candidates: pool,
    }
  }
}
