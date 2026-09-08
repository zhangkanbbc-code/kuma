// 任务舰种的展示分组；与判定引擎 STYPE_ALIASES 的同名别名逐组对拍。
// 不 import：主进程、渲染层与 Node 护栏都能直接读取这份纯表，避免带入运行时依赖。
export const QUEST_SHIP_TYPE_GROUPS: { key: string; label: string; stypes: number[]; aliases: string[] }[] = [
  { key: 'heavyCruiser', label: '重巡系', stypes: [5, 6], aliases: ['重巡', '重巡洋舰'] },
  { key: 'carrier', label: '空母系', stypes: [7, 11, 18], aliases: ['空母', '航空母舰', '航母', '空母系', '航空母舰系'] },
  { key: 'battleship', label: '战舰系', stypes: [8, 9, 10], aliases: ['战舰', '战列舰'] },
  { key: 'submarine', label: '潜水舰系', stypes: [13, 14], aliases: ['潜水舰', '潜艇', '潜水艇'] },
]
