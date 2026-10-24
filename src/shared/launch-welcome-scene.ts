// 第零幕的选幕与作战灯模型。主数据判活动，季节检测判企划；缓存只供下一次开屏。
import { detectEventAreas } from './event-area'
import { eventPhasesOf } from './event-lifecycle'
import { mapIdOf } from './map-id'
import { detectSeasonalCampaigns } from './seasonal-campaign'
import type { MapGauge } from './mg-types'

export type WelcomeSeason = 'newyear' | 'setsubun' | 'valentine' | 'spring' | 'tsuyu' | 'summer' | 'sanma' | 'halloween' | 'xmas'
export interface WelcomeLamp {
  mapId: number
  state: 'done' | 'current' | 'empty'
  breakBefore: boolean
}
export type WelcomeScene = { key: 'base' | WelcomeSeason } | {
  key: 'event'
  mapAreaId: number
  lamps: WelcomeLamp[]
  complete: boolean
}
export const WELCOME_SCENE_CONFIG_KEY = 'kuma.launchWelcomeScene.v1'

const CAMPAIGN_SCENES: [WelcomeSeason, string[]][] = [
  ['halloween', ['pumpkin']],
  ['newyear', ['kazari']],
  ['setsubun', ['setsubun']],
  ['valentine', ['choco']],
  ['spring', ['hishimochi', 'ribbon', 'tasuki']],
  ['tsuyu', ['umeboshi', 'rice', 'nori', 'tea', 'teruteru']],
  ['sanma', ['sanma', 'iwashi']],
]

export const calendarWelcomeScene = (now: number): WelcomeScene => {
  const jst = new Date(now + 9 * 60 * 60 * 1000)
  const month = jst.getUTCMonth() + 1
  const day = jst.getUTCDate()
  if (month === 7 || month === 8) return { key: 'summer' }
  if (month === 12 && day <= 25) return { key: 'xmas' }
  return { key: 'base' }
}

/** 包含尚未开放的后段，不能把「前段全通」误画成整场全通。 */
export const welcomeEventLamps = (
  maps: readonly { api_id: number; api_maparea_id: number; api_no: number }[],
  gauges: Record<number, Pick<MapGauge, 'cleared' | 'selectedRank'>>,
  lifecycle: unknown,
  now: number,
): Extract<WelcomeScene, { key: 'event' }> => {
  const mapAreaId = maps[0].api_maparea_id
  const phases = eventPhasesOf(lifecycle, mapAreaId)
  const ids = [...new Set([
    ...maps.filter((m) => m.api_maparea_id === mapAreaId).map((m) => m.api_id),
    ...phases.flatMap((phase) => phase.maps.map((no) => mapIdOf(mapAreaId, no))),
  ])].sort((a, b) => a - b)
  const open = (id: number) => {
    const phase = phases.find((p) => p.maps.some((no) => mapIdOf(mapAreaId, no) === id))
    return (!phase || Date.parse(phase.openedAt) <= now) && maps.some((m) => m.api_id === id)
  }
  const current = ids.find((id) => open(id) && !gauges[id]?.cleared)
  const lamps = ids.map((mapId, i): WelcomeLamp => {
    const phase = phases.findIndex((p) => p.maps.some((no) => mapIdOf(mapAreaId, no) === mapId))
    const previousPhase = phases.findIndex((p) => p.maps.some((no) => mapIdOf(mapAreaId, no) === ids[i - 1]))
    return {
      mapId,
      state: open(mapId) && gauges[mapId]?.cleared ? 'done' : mapId === current ? 'current' : 'empty',
      breakBefore: i > 0 && phase >= 0 && previousPhase >= 0 && phase !== previousPhase,
    }
  })
  return { key: 'event', mapAreaId, lamps, complete: lamps.every((lamp) => lamp.state === 'done') }
}

export interface WelcomeSceneInput {
  master: {
    api_mst_maparea?: { api_id: number; api_type?: number }[]
    api_mst_mapinfo?: { api_id: number; api_maparea_id: number; api_no: number }[]
    api_mst_useitem?: { api_id: number; api_name: string }[]
  }
  useitems: Record<number, number>
  quests: { no: number; title?: string; detail?: string }[]
  recordedCampaignKeys?: string[] // 本季尚未结账的企划；道具花光、任务领完后仍参与选幕。
  mapGauges: Record<number, Pick<MapGauge, 'cleared' | 'selectedRank'>>
  lifecycle: unknown
  now: number
}

export const selectWelcomeScene = (input: WelcomeSceneInput): WelcomeScene => {
  const maps = detectEventAreas(input.master.api_mst_maparea, input.master.api_mst_mapinfo).eventMaps
  if (maps.length) return welcomeEventLamps(maps, input.mapGauges, input.lifecycle, input.now)
  const campaigns = detectSeasonalCampaigns({
    useitemMst: (input.master.api_mst_useitem ?? []).map((item) => ({ id: item.api_id, name: item.api_name })),
    useitems: input.useitems,
    quests: input.quests,
    recordedKeys: input.recordedCampaignKeys,
  })
  for (const [key, items] of CAMPAIGN_SCENES) {
    if (campaigns.some((campaign) => items.includes(campaign.key))) return { key }
  }
  return calendarWelcomeScene(input.now)
}

export interface WelcomeSceneConfig {
  get(key: string, fallback: WelcomeScene): WelcomeScene
  get(key: string, fallback: null): WelcomeScene | null
  set(key: string, value: WelcomeScene): void
}
export const readWelcomeScene = (config: WelcomeSceneConfig, now: number): WelcomeScene =>
  config.get(WELCOME_SCENE_CONFIG_KEY, calendarWelcomeScene(now))

const sameWelcomeScene = (scene: WelcomeScene, saved: WelcomeScene | null): boolean => {
  if (!saved || scene.key !== saved.key) return false
  if (scene.key !== 'event') return true
  return saved.key === 'event' && scene.mapAreaId === saved.mapAreaId &&
    scene.complete === saved.complete && scene.lamps.length === saved.lamps.length &&
    scene.lamps.every((lamp, i) => {
      const previous = saved.lamps[i]
      return lamp.mapId === previous.mapId && lamp.state === previous.state &&
        lamp.breakBefore === previous.breakBefore
    })
}

export const rememberWelcomeScene = (config: WelcomeSceneConfig, input: WelcomeSceneInput): WelcomeScene => {
  const scene = selectWelcomeScene(input)
  // 对象写入会同步落盘并 fsync；只在幕或灯态确实变化时写，首次无缓存仍需保存。
  if (!sameWelcomeScene(scene, config.get(WELCOME_SCENE_CONFIG_KEY, null))) config.set(WELCOME_SCENE_CONFIG_KEY, scene)
  return scene
}
