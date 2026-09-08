/**
 * 常规出击的候选舰队。只供出击类编成检查使用：A82 要求第三舰队编成，不能套用此筛选。
 * 联合 = 第 1 + 2 舰队：store 的 api_combined_flag / api_req_hensei/combined，
 * chronicle、ship-life 同样据 combinedFlag > 0 合并两队。
 * 游击 = 单队 7 舰：见 shared/sortie-escape 的舰位说明；只数 ships 中 > 0 的有效舰位。
 */
export const sortieEligibleDecks = (
  decks: { id: number; ships: number[] }[],
  combinedFlag: number,
): number[] => decks
  .filter((deck) => !(combinedFlag > 0 && (deck.id === 1 || deck.id === 2)))
  .filter((deck) => deck.ships.filter((id) => id > 0).length < 7)
  .map((deck) => deck.id)
