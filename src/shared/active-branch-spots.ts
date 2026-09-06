// 能动分歧点位第一方事实表。
//
// 「哪个分歧点由玩家手选去向」是游戏机制的客观事实，不属于转录它的攻略站。
// 整理参照：wikiwiki.jp/kancolle 各海域「ルート分岐」表的 `能動分岐` 标记，
// 核对快照日期 2026-08-11。没有第二票：kcwiki-routing 全包 0 处此标记。
// 运行时终审以游戏在玩家站上该点时发出的 `api_select_route` 为准。
//
// 本表直接随源码与发行版分发，不走 wikiwiki-routing 矿脉：该包不随发行版，
// 不能承担发行版离线判定；矿脉在场时仍由消费端并入其中的新标记。
export const ACTIVE_BRANCH_SPOTS = new Set<string>([
  // 4-5
  '4-5:A',
  '4-5:C',
  '4-5:I',
  // 5-3
  '5-3:O',
  // 5-5
  '5-5:F',
  // 6-3
  '6-3:A',
  // 7-4
  '7-4:F',
  // 7-5
  '7-5:F',
  '7-5:H',
  '7-5:O',
])

export const isBuiltInActiveBranchSpot = (mapKey: string, letter: string): boolean =>
  ACTIVE_BRANCH_SPOTS.has(`${mapKey}:${letter}`)
