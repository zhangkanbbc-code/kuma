// 远征页只会发下面这几种请求。维护者账本 2026-08-03～09-25：
// 924 次进页中，349 次经别的页面离开；进页后首个集合外请求即表示离开。
const MISSION_SCENE_PATHS = new Set([
  '/kcsapi/api_get_member/mission',
  '/kcsapi/api_req_mission/start',
  '/kcsapi/api_req_mission/return_instruction',
  '/kcsapi/api_req_mission/result',
  '/kcsapi/api_get_member/deck',
])

export const createMissionSceneTracker = (): (apiPath: string) => 'mission' | 'away' | null => {
  let inMissionScene = false
  return (apiPath) => {
    if (apiPath === '/kcsapi/api_get_member/mission') {
      inMissionScene = true
      return 'mission'
    }
    if (inMissionScene && !MISSION_SCENE_PATHS.has(apiPath)) {
      inMissionScene = false
      return 'away'
    }
    return null
  }
}
