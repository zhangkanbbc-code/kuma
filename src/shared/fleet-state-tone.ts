export const FLEET_TONE_LABEL = {
  minor: '小破', moderate: '中破', heavy: '大破',
  dock: '入渠', anchorage: '泊地修理中', redFatigue: '红疲劳',
  fatigue: '橙疲劳', unsupplied: '未补给', sparkle: '闪光',
} as const

interface FleetToneInput {
  nowhp: number
  maxhp: number
  docked: boolean
  anchorage: boolean
  fatigue: 'red' | 'orange' | 'ready'
  sparkle: boolean
  unsupplied: boolean
}

type State = Exclude<keyof typeof FLEET_TONE_LABEL, 'minor' | 'moderate' | 'heavy'>

// 维护者裁决 2026-11-25：受损独立判档，竖条取首项，提示保留全项。
export const fleetStateTone = (input: FleetToneInput) => {
  const ratio = input.maxhp > 0 ? input.nowhp / input.maxhp : 1
  const damage = ratio <= 0.25 ? 'heavy' : ratio <= 0.5 ? 'moderate' : ratio <= 0.75 ? 'minor' : null
  const states: State[] = []
  if (input.docked) states.push('dock')
  if (input.anchorage) states.push('anchorage')
  if (input.fatigue === 'red') states.push('redFatigue')
  if (input.fatigue === 'orange') states.push('fatigue')
  if (input.unsupplied) states.push('unsupplied')
  if (input.sparkle) states.push('sparkle')
  const labels = [...(damage ? [FLEET_TONE_LABEL[damage]] : []), ...states.map(state => FLEET_TONE_LABEL[state])]
  return { damage, state: states[0] ?? null, labels }
}
