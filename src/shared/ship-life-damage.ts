// 人生记录里「承受伤害 / 大破次数 / 造成伤害」三项的措辞。图鉴收容库与在籍列表共用一份，
// 免得同一个数字在两处说法不一致。放 shared 而不是 renderer：纯粹是对报表对象的判读，
// 不碰 DOM，放这儿才逐文件产出、测得到。
//
// 数字本身好算，难的是别让它撒谎：这几项是后加的列，更早的战斗记录里根本没有。
// 把缺的补成 0 混进总数，等于替那些旧记录断言「那几十场一滴血没掉、也没打出去」——
// 于是一艘打了三年的舰会显示成「承受伤害 320」。所以只要存在说不出的场次，
// 数字旁边就得挂上「不含更早的 N 场」，起点写进悬停供核对。

import type { ShipLifeReport } from './mg-types'

const dayText = (ts: number) => {
  const date = new Date(ts)
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`
}

export interface ShipLifeDamageText {
  damage: string // 承受伤害的主数字（不可知时是 —）
  taiha: string // 大破次数的主数字
  dealt: string // 造成伤害的主数字
  /** 只覆盖了一部分历史：调用端据此加视觉提示 */
  partial: boolean
  /** 承受伤害与大破的悬停说明 */
  title: string
  /** 造成伤害的悬停说明：口径不同，单独一份 */
  dealtTitle: string
}

const SCOPE = '出击与演习合计，按每场战斗结算逐场累加'
const TAIHA_SCOPE =
  '大破按每场收尾时 HP ≤ 25% 计；女神／要员发动过的也算——它们发动的前提就是先跌破了大破线'
// 这条是「造成伤害」最容易被误读的地方：这个数天生就比战斗界面上看到的总输出小。
const DEALT_SCOPE =
  '只统计游戏给出了明确施加方的伤害：炮击、雷击、开幕对潜、夜战。\n' +
  '航空战、基地航空与支援射击是阶段伤害，游戏不指明是哪一舰打的，因此不摊给任何人——\n' +
  '空母的这个数会明显偏低，那是口径如此，不是漏记。'

export const shipLifeDamageText = (life: ShipLifeReport): ShipLifeDamageText => {
  const unknown = life.damageUnknownBattles
  // 一场都没记过：分清「还没开始记」和「确实没打过」，别对着老舰显示 0
  if (life.damageTrackedFrom == null) {
    const lead =
      unknown > 0
        ? `这几项是后来才开始记的，本地留下的 ${unknown} 场战斗里没有伤害数据，说不出打了多少、挨了多少。\n下一次出击起开始累计。\n`
        : '本地记录里她还没打过仗。\n'
    return {
      damage: unknown > 0 ? '—' : '0',
      taiha: unknown > 0 ? '—' : '0',
      dealt: unknown > 0 ? '—' : '0',
      partial: unknown > 0,
      title: `${lead}${SCOPE}`,
      dealtTitle: `${lead}${DEALT_SCOPE}`,
    }
  }
  const since = dayText(life.damageTrackedFrom)
  const lead =
    unknown > 0
      ? `自 ${since} 起记录；更早的 ${unknown} 场不可知，没有计入。\n`
      : `自 ${since} 起记录，覆盖本地留下的全部战斗。\n`
  return {
    damage: life.damageTaken.toLocaleString(),
    taiha: `${life.taihaCount}`,
    dealt: life.damageDealt.toLocaleString(),
    partial: unknown > 0,
    title: `${lead}${SCOPE}\n${TAIHA_SCOPE}`,
    dealtTitle: `${lead}${DEALT_SCOPE}`,
  }
}
