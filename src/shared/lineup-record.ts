import type { PlayerShip, SlotitemInstance } from './mg-types'

export interface LineupSlot {
  mstId: number
  level: number
  alv: number
}

export interface LineupShip {
  rosterId: number
  mstId: number
  lv: number
  slots: LineupSlot[]
  ex: LineupSlot | null
}

export interface LineupRecord {
  deckId: number
  recordedAt: number
  ships: LineupShip[]
  note: string
}

export const LINEUP_UI_KEY = 'qn.lineup'

const capturedSlot = (
  instanceId: number,
  slotitems: Record<number, SlotitemInstance>,
): LineupSlot | null => {
  if (instanceId <= 0) return null
  const instance = slotitems[instanceId]
  if (!instance) return null
  return { mstId: instance.mstId, level: instance.level, alv: instance.alv }
}

export const captureLineup = (
  deck: { id: number; ships: readonly number[] },
  ships: Record<number, PlayerShip>,
  slotitems: Record<number, SlotitemInstance>,
  now: number,
  note = '',
): LineupRecord | null => {
  const captured: LineupShip[] = []
  for (const rosterId of deck.ships) {
    if (rosterId <= 0) continue
    const ship = ships[rosterId]
    if (!ship) continue
    captured.push({
      rosterId,
      mstId: ship.shipId,
      lv: ship.lv,
      slots: ship.slot
        .map((instanceId) => capturedSlot(instanceId, slotitems))
        .filter((slot): slot is LineupSlot => slot != null),
      ex: capturedSlot(ship.slotEx, slotitems),
    })
  }
  if (!captured.length) return null
  return { deckId: deck.id, recordedAt: now, ships: captured, note }
}

const PERIOD_LABELS = new Set(['日', '周', '月', '季', '年'])

export const lineupApplies = (periodLabel: string): boolean => PERIOD_LABELS.has(periodLabel)

const isObject = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value)

const isNonNegativeInteger = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= 0

const isPositiveInteger = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) > 0

const readSlot = (raw: unknown): LineupSlot | null => {
  if (
    !isObject(raw) ||
    !isPositiveInteger(raw.mstId) ||
    !isNonNegativeInteger(raw.level) ||
    !isNonNegativeInteger(raw.alv)
  ) return null
  return { mstId: raw.mstId, level: raw.level, alv: raw.alv }
}

const readShip = (raw: unknown): LineupShip | null => {
  if (
    !isObject(raw) ||
    !isPositiveInteger(raw.rosterId) ||
    !isPositiveInteger(raw.mstId) ||
    !isPositiveInteger(raw.lv) ||
    !Array.isArray(raw.slots) ||
    !(raw.ex === null || isObject(raw.ex))
  ) return null
  const slots = raw.slots.map(readSlot)
  const ex = raw.ex === null ? null : readSlot(raw.ex)
  if (slots.some((slot) => slot == null) || (raw.ex !== null && ex == null)) return null
  return {
    rosterId: raw.rosterId,
    mstId: raw.mstId,
    lv: raw.lv,
    slots: slots as LineupSlot[],
    ex,
  }
}

const readRecord = (raw: unknown): LineupRecord | null => {
  if (
    !isObject(raw) ||
    !isPositiveInteger(raw.deckId) ||
    typeof raw.recordedAt !== 'number' ||
    !Number.isFinite(raw.recordedAt) ||
    raw.recordedAt < 0 ||
    !Array.isArray(raw.ships) ||
    !raw.ships.length ||
    typeof raw.note !== 'string'
  ) return null
  const ships = raw.ships.map(readShip)
  if (ships.some((ship) => ship == null)) return null
  return {
    deckId: raw.deckId,
    recordedAt: raw.recordedAt,
    ships: ships as LineupShip[],
    note: raw.note,
  }
}

export const readLineups = (raw: unknown): Record<string, LineupRecord> => {
  if (!isObject(raw)) return {}
  const lineups: Record<string, LineupRecord> = {}
  for (const [questId, value] of Object.entries(raw)) {
    const record = readRecord(value)
    if (record) lineups[questId] = record
  }
  return lineups
}
