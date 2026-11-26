// 动画复盘每一步的文字：舞台顶部的阶段标题与说明、右侧同步流水的一行。
//
// 词一律沿用战斗面板（镝）那一份：阶段名就是解析层写好的 stage.label，CI 名、航向、制空、索敌、
// 战型、战损词、对空 CI 说明都从 modules/di 导入。这里只负责把它们拼成一句，不另起名词。
// 新出现的说法（「烟幕」「进入夜战」这一类）是 Claude 起草、待维护者定稿的初稿。

import { formationText } from '../../shared/enemy-formation'
import { mapCellLetter } from '../map-cell-letter'
import {
  DETECTION,
  ENGAGEMENT,
  SEIKU,
  aaciDescribe,
  battleShipName,
  battleTypeLabel,
  ciLabel,
  rankLabel,
} from '../modules/di'

import type { AnimHit, AnimSide, BattleAnimStep } from '../../shared/battle-anim-script'
import type { BattleShipView, BattleSnapshotSummary, BattleView } from '../../shared/mg-types'

export interface StepText {
  /** 舞台顶部大字：这一步是什么 */
  title: string
  /** 顶部小字：数字与细节 */
  detail: string
}

export const shipMetaOf = (battle: BattleView, side: AnimSide, index: number): BattleShipView | undefined =>
  (side === 0 ? battle.fShips : side === 1 ? battle.eShips : battle.friendShips)?.find((ship) => ship.index === index)

export const shipNameOf = (battle: BattleView, side: AnimSide, index: number): string => {
  const meta = shipMetaOf(battle, side, index)
  return meta ? battleShipName(meta) : `#${index + 1}`
}

const stageLabelOf = (battle: BattleView, stage: number | null): string =>
  battle.stages.find((entry) => entry.order === stage)?.label ?? ''

// 一击的结果：伤害数（暴击加「!」）、落空、护卫、应急修理
const hitText = (hit: AnimHit): string => {
  if (hit.repairItem === 43) return `${hit.damage} 女神发动`
  if (hit.repairItem === 42) return `${hit.damage} 要员发动`
  if (hit.hitState === 'miss') return '落空'
  const value = `${hit.damage}${hit.critical ? '!' : ''}`
  return hit.protect ? `${value}（护卫）` : value
}

const hitsText = (hits: readonly AnimHit[]): string => hits.map(hitText).join('+')

const sumDamage = (hits: readonly AnimHit[]) => hits.reduce((sum, hit) => sum + hit.damage, 0)

export const stepText = (battle: BattleView, step: BattleAnimStep): StepText => {
  switch (step.kind) {
    case 'intro': {
      const engagement = step.showsEngagement ? ENGAGEMENT[battle.engagement] ?? '' : ''
      const detection = battle.detection ? DETECTION[battle.detection[0]] ?? '' : ''
      return {
        title: [`${formationText(battle.fFormation)} 对 ${formationText(battle.eFormation)}`, engagement].filter(Boolean).join(' · '),
        detail: [battleTypeLabel(battle), detection, battle.enemyDeckName ?? '', battle.balloonCell ? '阻塞气球' : ''].filter(Boolean).join(' · '),
      }
    }
    case 'smoke':
      return { title: `烟幕 ×${step.level}`, detail: '水面交战之前展开' }
    case 'transition': {
      const notes: string[] = []
      if (step.smokeLeaving) notes.push('烟幕散去')
      if (step.after.env.flare) notes.push('照明弹')
      if (step.after.env.nightContact) notes.push('夜间触接')
      return { title: step.toNight ? '进入夜战' : '转入昼战', detail: notes.join(' · ') }
    }
    case 'air': {
      // 一波航空战的全部数字收在一行：制空、双方机数与损失、对空 CI、投弹结果
      const air = step.air
      const notes: string[] = []
      if (air && !step.jet && air.seiku != null) notes.push(SEIKU[air.seiku] ?? '')
      if (step.clash && air) notes.push(`我方 ${air.fCount} 机 -${air.fLost}`, `敌方 ${air.eCount} 机 -${air.eLost}`)
      if (step.aaciShip != null && air) {
        notes.push(`${shipNameOf(battle, 0, step.aaciShip)} 对空CI ${aaciDescribe(air.aaCutinKind).label}${air.eLost2 ? ` 击坠 ${air.eLost2}` : ''}`)
      }
      if (step.strikes.length) {
        notes.push(`命中 ${step.strikes.filter((entry) => entry.damage > 0).length} 舰`, `合计 ${sumDamage(step.strikes)}`)
      }
      if (step.strikes.some((entry) => entry.skipBomb)) notes.push('跳弹轰炸')
      if (step.rescue) notes.push(`卡特琳娜救援 ×${step.rescue}`)
      return { title: stageLabelOf(battle, step.stage), detail: notes.filter(Boolean).join(' · ') }
    }
    case 'support':
      return {
        title: stageLabelOf(battle, step.stage),
        detail: [step.mode === 'gun' && step.support ? `第${step.support.deckId}舰队炮击支援` : '航空支援', `合计 ${sumDamage(step.hits)}`].join(' · '),
      }
    case 'torpedo-salvo':
      return { title: stageLabelOf(battle, step.stage), detail: `${step.torpedoes.length} 发 · 合计 ${sumDamage(step.torpedoes)}` }
    case 'special-cutin':
      return {
        title: ciLabel(step.ciKind, step.ciType) ?? '特殊攻击',
        detail: step.participants.map((index) => shipNameOf(battle, step.side, index)).join('、'),
      }
    case 'attack': {
      const targetSide = step.hits[0]?.targetSide ?? (step.side === 1 ? 0 : 1)
      const targets = [...new Set(step.hits.map((hit) => hit.target))]
      const ci = step.special ? `${ciLabel(step.ciKind, step.special.ciType) ?? ''} ${step.special.segment + 1}/${step.special.of}` : ciLabel(step.ciKind, step.ciType)
      return {
        title: `${shipNameOf(battle, step.side, step.attacker)} → ${targets.map((index) => shipNameOf(battle, targetSide, index)).join('、')}`,
        detail: [ci ?? '', hitsText(step.hits)].filter(Boolean).join(' · '),
      }
    }
    case 'outro': {
      const rank = battle.result?.rank ?? battle.prediction.rank
      const mvp = battle.result && battle.result.mvp >= 0 ? `MVP ${shipNameOf(battle, 0, battle.result.mvp)}` : ''
      const mvp2 = battle.result && battle.result.mvpCombined >= 0 ? `MVP ${shipNameOf(battle, 0, battle.result.mvpCombined + 6)}` : ''
      return {
        title: `${battle.result ? '判定' : '预测'} ${rankLabel(rank, battle.prediction)}`,
        detail: [mvp, mvp2, battle.result?.dropShipName ? `掉落 ${battle.result.dropShipName}` : ''].filter(Boolean).join(' · '),
      }
    }
  }
}

/** 同次出击航迹条上的一格：第几战 · 点位字母 · 评级 */
export const trailLabel = (row: BattleSnapshotSummary): string =>
  [`第${row.battleNo}战`, row.practice ? '演习' : mapCellLetter(row.map, row.cell), row.rank ?? ''].filter(Boolean).join(' ')
