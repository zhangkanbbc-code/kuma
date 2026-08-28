// 出击类推导的测试主数据：`api_mst_mapinfo` 只留 id / 海域号两列
// （推导用到的就这两列——「X-Y 是不是一张真存在的图」）。
// 常设海域 1-1 ~ 7-5 加上活动海域区（62 区）的五张图，都是游戏自报的客观事实。
// 活动区留在表里是有意的：它证明「只认 1..9 单位数」这条判别线不是靠表里没有活动图撑着。

const AREAS = [
  [1, 6], [2, 5], [3, 5], [4, 5], [5, 6], [6, 5], [7, 5], [62, 5],
]

export const sortieMaster = {
  api_mst_mapinfo: AREAS.flatMap(([area, count]) =>
    Array.from({ length: count }, (_, index) => ({
      api_id: area * 10 + index + 1,
      api_maparea_id: area,
      api_no: index + 1,
    })),
  ),
}
