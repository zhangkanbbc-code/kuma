// 远征类推导的测试主数据：`api_mst_mission` 只留 id / disp_no / 日文名三列
// （推导用到的就这三列），外加 kcwiki 远征包的中文名对照。
// 都是游戏自报的客观事实与既有矿脉的字段投影，不是谁的整理成果。

export const missionMaster = { api_mst_mission: [
  {
    "api_id": 1,
    "api_disp_no": "01",
    "api_name": "練習航海"
  },
  {
    "api_id": 2,
    "api_disp_no": "02",
    "api_name": "長距離練習航海"
  },
  {
    "api_id": 3,
    "api_disp_no": "03",
    "api_name": "警備任務"
  },
  {
    "api_id": 4,
    "api_disp_no": "04",
    "api_name": "対潜警戒任務"
  },
  {
    "api_id": 5,
    "api_disp_no": "05",
    "api_name": "海上護衛任務"
  },
  {
    "api_id": 6,
    "api_disp_no": "06",
    "api_name": "防空射撃演習"
  },
  {
    "api_id": 7,
    "api_disp_no": "07",
    "api_name": "観艦式予行"
  },
  {
    "api_id": 8,
    "api_disp_no": "08",
    "api_name": "観艦式"
  },
  {
    "api_id": 9,
    "api_disp_no": "09",
    "api_name": "タンカー護衛任務"
  },
  {
    "api_id": 10,
    "api_disp_no": "10",
    "api_name": "強行偵察任務"
  },
  {
    "api_id": 11,
    "api_disp_no": "11",
    "api_name": "ボーキサイト輸送任務"
  },
  {
    "api_id": 12,
    "api_disp_no": "12",
    "api_name": "資源輸送任務"
  },
  {
    "api_id": 13,
    "api_disp_no": "13",
    "api_name": "鼠輸送作戦"
  },
  {
    "api_id": 14,
    "api_disp_no": "14",
    "api_name": "包囲陸戦隊撤収作戦"
  },
  {
    "api_id": 15,
    "api_disp_no": "15",
    "api_name": "囮機動部隊支援作戦"
  },
  {
    "api_id": 16,
    "api_disp_no": "16",
    "api_name": "艦隊決戦援護作戦"
  },
  {
    "api_id": 17,
    "api_disp_no": "17",
    "api_name": "敵地偵察作戦"
  },
  {
    "api_id": 18,
    "api_disp_no": "18",
    "api_name": "航空機輸送作戦"
  },
  {
    "api_id": 19,
    "api_disp_no": "19",
    "api_name": "北号作戦"
  },
  {
    "api_id": 20,
    "api_disp_no": "20",
    "api_name": "潜水艦哨戒任務"
  },
  {
    "api_id": 21,
    "api_disp_no": "21",
    "api_name": "北方鼠輸送作戦"
  },
  {
    "api_id": 22,
    "api_disp_no": "22",
    "api_name": "艦隊演習"
  },
  {
    "api_id": 23,
    "api_disp_no": "23",
    "api_name": "航空戦艦運用演習"
  },
  {
    "api_id": 24,
    "api_disp_no": "24",
    "api_name": "北方航路海上護衛"
  },
  {
    "api_id": 25,
    "api_disp_no": "25",
    "api_name": "通商破壊作戦"
  },
  {
    "api_id": 26,
    "api_disp_no": "26",
    "api_name": "敵母港空襲作戦"
  },
  {
    "api_id": 27,
    "api_disp_no": "27",
    "api_name": "潜水艦通商破壊作戦"
  },
  {
    "api_id": 28,
    "api_disp_no": "28",
    "api_name": "西方海域封鎖作戦"
  },
  {
    "api_id": 29,
    "api_disp_no": "29",
    "api_name": "潜水艦派遣演習"
  },
  {
    "api_id": 30,
    "api_disp_no": "30",
    "api_name": "潜水艦派遣作戦"
  },
  {
    "api_id": 31,
    "api_disp_no": "31",
    "api_name": "海外艦との接触"
  },
  {
    "api_id": 32,
    "api_disp_no": "32",
    "api_name": "遠洋練習航海"
  },
  {
    "api_id": 33,
    "api_disp_no": "33",
    "api_name": "前衛支援任務"
  },
  {
    "api_id": 34,
    "api_disp_no": "34",
    "api_name": "艦隊決戦支援任務"
  },
  {
    "api_id": 35,
    "api_disp_no": "35",
    "api_name": "MO作戦"
  },
  {
    "api_id": 36,
    "api_disp_no": "36",
    "api_name": "水上機基地建設"
  },
  {
    "api_id": 37,
    "api_disp_no": "37",
    "api_name": "東京急行"
  },
  {
    "api_id": 38,
    "api_disp_no": "38",
    "api_name": "東京急行(弐)"
  },
  {
    "api_id": 39,
    "api_disp_no": "39",
    "api_name": "遠洋潜水艦作戦"
  },
  {
    "api_id": 40,
    "api_disp_no": "40",
    "api_name": "水上機前線輸送"
  },
  {
    "api_id": 41,
    "api_disp_no": "41",
    "api_name": "ブルネイ泊地沖哨戒"
  },
  {
    "api_id": 42,
    "api_disp_no": "42",
    "api_name": "ミ船団護衛(一号船団)"
  },
  {
    "api_id": 43,
    "api_disp_no": "43",
    "api_name": "ミ船団護衛(二号船団)"
  },
  {
    "api_id": 44,
    "api_disp_no": "44",
    "api_name": "航空装備輸送任務"
  },
  {
    "api_id": 45,
    "api_disp_no": "45",
    "api_name": "ボーキサイト船団護衛"
  },
  {
    "api_id": 46,
    "api_disp_no": "46",
    "api_name": "南西海域戦闘哨戒"
  },
  {
    "api_id": 100,
    "api_disp_no": "A1",
    "api_name": "兵站強化任務"
  },
  {
    "api_id": 101,
    "api_disp_no": "A2",
    "api_name": "海峡警備行動"
  },
  {
    "api_id": 102,
    "api_disp_no": "A3",
    "api_name": "長時間対潜警戒"
  },
  {
    "api_id": 103,
    "api_disp_no": "A4",
    "api_name": "南西方面連絡線哨戒"
  },
  {
    "api_id": 104,
    "api_disp_no": "A5",
    "api_name": "小笠原沖哨戒線"
  },
  {
    "api_id": 105,
    "api_disp_no": "A6",
    "api_name": "小笠原沖戦闘哨戒"
  },
  {
    "api_id": 110,
    "api_disp_no": "B1",
    "api_name": "南西方面航空偵察作戦"
  },
  {
    "api_id": 111,
    "api_disp_no": "B2",
    "api_name": "敵泊地強襲反撃作戦"
  },
  {
    "api_id": 112,
    "api_disp_no": "B3",
    "api_name": "南西諸島離島哨戒作戦"
  },
  {
    "api_id": 113,
    "api_disp_no": "B4",
    "api_name": "南西諸島離島防衛作戦"
  },
  {
    "api_id": 114,
    "api_disp_no": "B5",
    "api_name": "南西諸島捜索撃滅戦"
  },
  {
    "api_id": 115,
    "api_disp_no": "B6",
    "api_name": "精鋭水雷戦隊夜襲"
  },
  {
    "api_id": 131,
    "api_disp_no": "D1",
    "api_name": "西方海域偵察作戦"
  },
  {
    "api_id": 132,
    "api_disp_no": "D2",
    "api_name": "西方潜水艦作戦"
  },
  {
    "api_id": 133,
    "api_disp_no": "D3",
    "api_name": "欧州方面友軍との接触"
  },
  {
    "api_id": 141,
    "api_disp_no": "E1",
    "api_name": "ラバウル方面艦隊進出"
  },
  {
    "api_id": 142,
    "api_disp_no": "E2",
    "api_name": "強行鼠輸送作戦"
  },
  {
    "api_id": 301,
    "api_disp_no": "S1",
    "api_name": "前衛支援任務"
  },
  {
    "api_id": 302,
    "api_disp_no": "S2",
    "api_name": "艦隊決戦支援任務"
  }
] }

export const expeditionPack = {
  "1": {
    "nameJp": "練習航海",
    "nameZh": "练习航海"
  },
  "2": {
    "nameJp": "長距離練習航海",
    "nameZh": "长距离练习航海"
  },
  "3": {
    "nameJp": "警備任務",
    "nameZh": "警备任务"
  },
  "4": {
    "nameJp": "対潜警戒任務",
    "nameZh": "对潜警戒任务"
  },
  "5": {
    "nameJp": "海上護衛任務",
    "nameZh": "海上护卫任务"
  },
  "6": {
    "nameJp": "防空射撃演習",
    "nameZh": "防空射击演习"
  },
  "7": {
    "nameJp": "観艦式予行",
    "nameZh": "观舰式排演"
  },
  "8": {
    "nameJp": "観艦式",
    "nameZh": "观舰式"
  },
  "9": {
    "nameJp": "タンカー護衛任務",
    "nameZh": "油轮护卫任务"
  },
  "10": {
    "nameJp": "強行偵察任務",
    "nameZh": "强行侦察任务"
  },
  "11": {
    "nameJp": "ボーキサイト輸送任務",
    "nameZh": "铝土运送任务"
  },
  "12": {
    "nameJp": "資源輸送任務",
    "nameZh": "资源运送任务"
  },
  "13": {
    "nameJp": "鼠輸送作戦",
    "nameZh": "鼠输送作战"
  },
  "14": {
    "nameJp": "包囲陸戦隊撤収作戦",
    "nameZh": "围困陆战队撤退运送任务"
  },
  "15": {
    "nameJp": "囮機動部隊支援作戦",
    "nameZh": "诱饵机动部队支援作战"
  },
  "16": {
    "nameJp": "艦隊決戦援護作戦",
    "nameZh": "舰队决战护卫作战"
  },
  "17": {
    "nameJp": "敵地偵察作戦",
    "nameZh": "敌基地侦察作战"
  },
  "18": {
    "nameJp": "航空機輸送作戦",
    "nameZh": "舰载机运送作战"
  },
  "19": {
    "nameJp": "北号作戦",
    "nameZh": "北号作战"
  },
  "20": {
    "nameJp": "潜水艦哨戒任務",
    "nameZh": "潜水艇戒备任务"
  },
  "21": {
    "nameJp": "北方鼠輸送作戦",
    "nameZh": "北方鼠输送作战"
  },
  "22": {
    "nameJp": "艦隊演習",
    "nameZh": "舰队演习"
  },
  "23": {
    "nameJp": "航空戦艦運用演習",
    "nameZh": "航空战舰运用演习"
  },
  "24": {
    "nameJp": "北方航路海上護衛",
    "nameZh": "北方航路海上护卫"
  },
  "25": {
    "nameJp": "通商破壊作戦",
    "nameZh": "通商破坏作战"
  },
  "26": {
    "nameJp": "敵母港空襲作戦",
    "nameZh": "敌母港空袭作战"
  },
  "27": {
    "nameJp": "潜水艦通商破壊作戦",
    "nameZh": "潜水艇通商破坏作战"
  },
  "28": {
    "nameJp": "西方海域封鎖作戦",
    "nameZh": "西方海域封锁作战"
  },
  "29": {
    "nameJp": "潜水艦派遣演習",
    "nameZh": "潜水艇派遣演习"
  },
  "30": {
    "nameJp": "潜水艦派遣作戦",
    "nameZh": "潜水艇派遣作战"
  },
  "31": {
    "nameJp": "海外艦との接触",
    "nameZh": "和海外舰的接触"
  },
  "32": {
    "nameJp": "遠洋練習航海",
    "nameZh": "远洋练习航海"
  },
  "33": {
    "nameJp": "前衛支援任務",
    "nameZh": "前线部队支援任务"
  },
  "34": {
    "nameJp": "艦隊決戦支援任務",
    "nameZh": "舰队决战支援任务"
  },
  "35": {
    "nameJp": "MO作戦",
    "nameZh": "MO作战"
  },
  "36": {
    "nameJp": "水上機基地建設",
    "nameZh": "水上飞机基地建设"
  },
  "37": {
    "nameJp": "東京急行",
    "nameZh": "东京急行"
  },
  "38": {
    "nameJp": "東京急行(弐)",
    "nameZh": "东京急行(二)"
  },
  "39": {
    "nameJp": "遠洋潜水艦作戦",
    "nameZh": "远洋潜水艇作战"
  },
  "40": {
    "nameJp": "水上機前線輸送",
    "nameZh": "水上机前线运输"
  },
  "41": {
    "nameJp": "ブルネイ泊地沖哨戒",
    "nameZh": "文莱泊地海湾警戒"
  },
  "42": {
    "nameJp": "ミ船団護衛(一号船団)",
    "nameZh": "MI船团护卫（一号船团）"
  },
  "43": {
    "nameJp": "ミ船団護衛(二号船団)",
    "nameZh": "MI船团护卫（二号船团）"
  },
  "44": {
    "nameJp": "航空装備輸送任務",
    "nameZh": "航空装备输送任务"
  },
  "45": {
    "nameJp": "ボーキサイト船団護衛",
    "nameZh": "铝土船团护卫"
  },
  "46": {
    "nameJp": "南西海域戦闘哨戒",
    "nameZh": "南西海域战斗警戒"
  },
  "A1": {
    "nameJp": "兵站強化任務",
    "nameZh": "兵站强化任务"
  },
  "A2": {
    "nameJp": "海峡警備行動",
    "nameZh": "海峡警备任务"
  },
  "A3": {
    "nameJp": "長時間対潜警戒",
    "nameZh": "长时间对潜警戒"
  },
  "A4": {
    "nameJp": "南西方面連絡線哨戒",
    "nameZh": "南西方面联络线哨戒"
  },
  "A5": {
    "nameJp": "小笠原沖哨戒線",
    "nameZh": "小笠原群岛哨戒线"
  },
  "A6": {
    "nameJp": "小笠原沖戦闘哨戒",
    "nameZh": "小笠原群岛战斗哨戒"
  },
  "B1": {
    "nameJp": "南西方面航空偵察作戦",
    "nameZh": "南西方面航空侦察作战"
  },
  "B2": {
    "nameJp": "敵泊地強襲反撃作戦",
    "nameZh": "敌方泊地强袭反击作战"
  },
  "B3": {
    "nameJp": "南西諸島離島哨戒作戦",
    "nameZh": "南西诸岛离岛哨戒作战"
  },
  "B4": {
    "nameJp": "南西諸島離島防衛作戦",
    "nameZh": "南西诸岛离岛防御作战"
  },
  "B5": {
    "nameJp": "南西諸島捜索撃滅戦",
    "nameZh": "南西诸岛搜索歼灭战"
  },
  "B6": {
    "nameJp": "精鋭水雷戦隊夜襲",
    "nameZh": "精锐水雷战队夜袭战"
  },
  "D1": {
    "nameJp": "西方海域偵察作戦",
    "nameZh": "西方海域侦察作战"
  },
  "D2": {
    "nameJp": "西方潜水艦作戦",
    "nameZh": "西方潜水艇作战"
  },
  "D3": {
    "nameJp": "欧州方面友軍との接触",
    "nameZh": "与欧洲方面友军的接触"
  },
  "E1": {
    "nameJp": "ラバウル方面艦隊進出",
    "nameZh": "拉包尔方面舰队前进"
  },
  "E2": {
    "nameJp": "強行鼠輸送作戦",
    "nameZh": "强行鼠运输作战"
  }
}
