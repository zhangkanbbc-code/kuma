// 舰娘目录在这个范围使用单列；620px 起改为多列。
// 宽度取图鉴面板：小于 700px 的抽屉覆盖在列表上，不挤占索引宽度。
export const canDeferCatalogRows = (paneWidth: number): boolean =>
  paneWidth >= 300 && paneWidth < 620

// 300px 面板扣除滚动条、头像、间距与内边距后，文字区仍能放下
// 18 个 10.5px 的全角字符。长副标题与额外收藏标记继续完整布局。
export const canDeferCatalogRow = (subtitle: string, favorite: boolean): boolean =>
  !favorite && subtitle.length <= 18
