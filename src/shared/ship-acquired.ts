// 报文里「这一下有舰娘到手」的一手信号。
//
// 任务奖励与战斗掉落都**只给图鉴号、不带在籍数据**：舰娘要等回港时游戏下发的舰娘列表才进账，
// 「新舰入库」按在籍列表比对，于是晚到回港那一刻（2026-11-26 他选秃鹫当任务奖励，回港才提醒）。
// 主进程在报文落地时把图鉴号推给渲染层，「首次持有」当场按谱系记账（见 ship-first-owned 的 noteAcquiredShips）。
//
// - 任务奖励：clearitemget 的 api_bounus 里 api_type 11，图鉴号在 api_item.api_ship_id
//   （与季节账本 seasonal-ledger 的 parseRewards 同一判据，141f5abb 起实弹核过：#866 选明石 → api_ship_id 182）；
// - 战斗掉落：battleresult 的 api_get_ship.api_ship_id。演习结算没有掉落。
// 建造领取（getship）报文自带整艘舰的数据，store 当场入账，不走这里。

export interface ShipAcquiredCue {
  ts: number
  /** 这一下到手的舰娘图鉴号（去重） */
  mstIds: number[]
}

export const QUEST_CLEAR_PATH = '/kcsapi/api_req_quest/clearitemget'
export const DROP_RESULT_PATHS: readonly string[] = [
  '/kcsapi/api_req_sortie/battleresult',
  '/kcsapi/api_req_combined_battle/battleresult',
]

export const acquiredShipsOf = (apiPath: string, body: any): number[] => {
  const out = new Set<number>()
  if (apiPath === QUEST_CLEAR_PATH) {
    const bonuses = body?.api_bounus ?? body?.api_bonus
    for (const entry of Array.isArray(bonuses) ? bonuses : []) {
      const item = entry?.api_item ?? entry
      if (entry?.api_type !== 11 && item?.api_ship_id == null) continue
      const id = Number(item?.api_ship_id)
      if (Number.isInteger(id) && id > 0) out.add(id)
    }
  } else if (DROP_RESULT_PATHS.includes(apiPath)) {
    const id = Number(body?.api_get_ship?.api_ship_id)
    if (Number.isInteger(id) && id > 0) out.add(id)
  }
  return [...out]
}
