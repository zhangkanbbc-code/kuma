// 道具的固定兑换（游戏内道具使用界面的常设选项）——手录小表。
// 历年/季节性的兑换目录走矿脉包（wikiwiki-item-exchange，抓 wikiwiki アイテム页
// 的表格化目录），两者在图鉴道具页的「可兑换列表」合流展示。
//
// 只录被两路证据同时支撑的条目：wikiwiki 对应道具页的「用途」节 + 游戏内
// アイテム一覧点击道具后的选项界面（本机随时可实测）。wiki 侧这些内容是散文
// 不是表格，机器解析不可靠，所以按仲裁表惯例手录并写明依据；新增条目照此办理。
//
// 勲章（2026-08-18 依 wikiwiki 勲章页「用途」节核对；游戏内选项共四项，
// 第四项「戻る」只是取消，不是兑换）：

export interface FixedItemExchange {
  /** 消耗本道具的数量 */
  cost: number
  /** 所得（名称口径与游戏/wiki 一致；渲染端按名字联到装备/道具实体） */
  gets: string
}

export const FIXED_ITEM_EXCHANGES: ReadonlyMap<number, readonly FixedItemExchange[]> = new Map([
  [
    57, // 勲章
    [
      { cost: 4, gets: '改装設計図x1' },
      { cost: 1, gets: '燃料x300 + 弾薬x300 + 鋼材x300 + ボーキサイトx300 + 高速修復材x2' },
      { cost: 1, gets: '改修資材x4' },
    ],
  ],
])
