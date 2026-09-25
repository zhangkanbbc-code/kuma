# 远征第一方事实层对照（2026-09-25）

基线 beea4bb。63 项逐一对照；对象递归到叶字段，数组为一格，null 与无字段同为缺项。
原始差异 666 格：wikiwiki 有 kcwiki 无 328；两者值不同 238；kcwiki 有 wikiwiki 无 100。
数组顺序、标点和未消费的 min 等差异仍在原始表保留；运行时对账只比较结构化消费语义。
输入 SHA-256：kcwiki 1ed74ee164d502f6f39e73d6883ced9f1f9dc66b1c8caf79e7d122500ff46e66；wikiwiki 0e0320b4d4c80c8137c25120a196bfa3fb316586148ebdea48e4e45161603a1b。

## 收录清单

31 个字段登记，19 项远征。增补 kcwiki 缺失或提取不同的格；维护者带出处订正覆盖指定字段。
- A4.stats.火力 = 300；kcwiki 说明与 wikiwiki 数值一致，补 kcwiki 提取缺项
- A5.stats.火力 = 280；kcwiki 说明与 wikiwiki 数值一致，补 kcwiki 提取缺项
- A5.stats.对空 = 220；kcwiki 说明与 wikiwiki 数值一致，补 kcwiki 提取缺项
- A5.stats.对潜 = 240；kcwiki 说明与 wikiwiki 数值一致，补 kcwiki 提取缺项
- A5.stats.索敌 = 150；kcwiki 说明与 wikiwiki 数值一致，补 kcwiki 提取缺项
- A6.stats.火力 = 330；kcwiki 说明与 wikiwiki 数值一致，补 kcwiki 提取缺项
- B4.stats.火力 = 500；wikiwiki 单站数值事实
- D2.stats.索敌 = 70；wikiwiki 单站数值事实
- 21.drumTotal = 3；kcwiki 字段值与其说明文字不一致，按说明文字（与 wikiwiki 一致）收
- 44.drumTotal = 6；kcwiki 字段值与其说明文字不一致，按说明文字（与 wikiwiki 一致）收
- 4.compositionBranches = [{"label":"","reqs":[{"label":"轻巡","types":[3],"count":1,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"驱逐/海防","types":[2,1],"count":2,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false}]},{"label":"wiki 变体1","reqs":[{"label":"駆","types":[2],"count":1,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"海防","types":[1],"count":3,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false}]},{"label":"wiki 变体2","reqs":[{"label":"護母","types":[7],"count":1,"flagship":false,"wildcard":false,"cve":true,"homogeneous":false},{"label":"駆","types":[2],"count":2,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false}]},{"label":"wiki 变体3","reqs":[{"label":"護母","types":[7],"count":1,"flagship":false,"wildcard":false,"cve":true,"homogeneous":false},{"label":"海防","types":[1],"count":2,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false}]},{"label":"wiki 变体4","reqs":[{"label":"練巡","types":[21],"count":1,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"海防","types":[1],"count":2,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false}]}]；基础编成沿用；附加可行分支为 wikiwiki 单站结构化重述
- 9.compositionBranches = [{"label":"","reqs":[{"label":"轻巡","types":[3],"count":1,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"驱逐/海防","types":[2,1],"count":2,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"其他*1","types":null,"count":1,"flagship":false,"wildcard":true,"cve":false,"homogeneous":false}]},{"label":"wiki 变体1","reqs":[{"label":"駆","types":[2],"count":1,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"海防","types":[1],"count":3,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false}]},{"label":"wiki 变体2","reqs":[{"label":"護母","types":[7],"count":1,"flagship":false,"wildcard":false,"cve":true,"homogeneous":false},{"label":"駆","types":[2],"count":2,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"他","types":null,"count":1,"flagship":false,"wildcard":true,"cve":false,"homogeneous":false}]},{"label":"wiki 变体3","reqs":[{"label":"護母","types":[7],"count":1,"flagship":false,"wildcard":false,"cve":true,"homogeneous":false},{"label":"海防","types":[1],"count":2,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"他","types":null,"count":1,"flagship":false,"wildcard":true,"cve":false,"homogeneous":false}]},{"label":"wiki 变体4","reqs":[{"label":"練巡","types":[21],"count":1,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"海防","types":[1],"count":2,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"他","types":null,"count":1,"flagship":false,"wildcard":true,"cve":false,"homogeneous":false}]}]；基础编成沿用；附加可行分支为 wikiwiki 单站结构化重述
- 20.compositionBranches = [{"label":"","reqs":[{"label":"潜水","types":[13,14],"count":1,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"轻巡","types":[3],"count":1,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false}]}]；两站舰种数量一致，结构化顺序沿用旧规划器槽位
- 43.compositionBranches = [{"label":"编成一","reqs":[{"label":"护卫空母(旗舰)","types":[7],"count":1,"flagship":true,"wildcard":false,"cve":true,"homogeneous":false},{"label":"驱逐/海防","types":[2,1],"count":2,"flagship":false,"wildcard":false,"cve":false,"homogeneous":true},{"label":"其他*3","types":null,"count":3,"flagship":false,"wildcard":true,"cve":false,"homogeneous":false}]},{"label":"编成二","reqs":[{"label":"轻空母(旗舰)","types":[7],"count":1,"flagship":true,"wildcard":false,"cve":false,"homogeneous":false},{"label":"轻巡","types":[3],"count":1,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"驱逐","types":[2],"count":4,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false}]},{"label":"wiki 变体1","reqs":[{"label":"軽母(旗舰)","types":[7],"count":1,"flagship":true,"wildcard":false,"cve":false,"homogeneous":false},{"label":"駆","types":[2],"count":1,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"海防","types":[1],"count":3,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"他","types":null,"count":1,"flagship":false,"wildcard":true,"cve":false,"homogeneous":false}]},{"label":"wiki 变体2","reqs":[{"label":"軽母(旗舰)","types":[7],"count":1,"flagship":true,"wildcard":false,"cve":false,"homogeneous":false},{"label":"軽巡","types":[3],"count":1,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"海防","types":[1],"count":2,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"他","types":null,"count":2,"flagship":false,"wildcard":true,"cve":false,"homogeneous":false}]},{"label":"wiki 变体3","reqs":[{"label":"軽母(旗舰)","types":[7],"count":1,"flagship":true,"wildcard":false,"cve":false,"homogeneous":false},{"label":"練巡","types":[21],"count":1,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"海防","types":[1],"count":2,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"他","types":null,"count":2,"flagship":false,"wildcard":true,"cve":false,"homogeneous":false}]},{"label":"wiki 变体4","reqs":[{"label":"軽母(旗舰)","types":[7],"count":1,"flagship":true,"wildcard":false,"cve":false,"homogeneous":false},{"label":"護母","types":[7],"count":1,"flagship":false,"wildcard":false,"cve":true,"homogeneous":false},{"label":"駆","types":[2],"count":2,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"他","types":null,"count":2,"flagship":false,"wildcard":true,"cve":false,"homogeneous":false}]},{"label":"wiki 变体5","reqs":[{"label":"軽母(旗舰)","types":[7],"count":1,"flagship":true,"wildcard":false,"cve":false,"homogeneous":false},{"label":"護母","types":[7],"count":1,"flagship":false,"wildcard":false,"cve":true,"homogeneous":false},{"label":"海防","types":[1],"count":2,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"他","types":null,"count":2,"flagship":false,"wildcard":true,"cve":false,"homogeneous":false}]}]；基础编成沿用；附加可行分支为 wikiwiki 单站结构化重述
- A3.compositionBranches = [{"label":"","reqs":[{"label":"轻巡","types":[3],"count":1,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"驱逐/海防","types":[2,1],"count":3,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"其他*1","types":null,"count":1,"flagship":false,"wildcard":true,"cve":false,"homogeneous":false}]},{"label":"wiki 变体1","reqs":[{"label":"駆","types":[2],"count":1,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"海防","types":[1],"count":3,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"他","types":null,"count":1,"flagship":false,"wildcard":true,"cve":false,"homogeneous":false}]},{"label":"wiki 变体2","reqs":[{"label":"護母","types":[7],"count":1,"flagship":false,"wildcard":false,"cve":true,"homogeneous":false},{"label":"駆","types":[2],"count":2,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"他","types":null,"count":2,"flagship":false,"wildcard":true,"cve":false,"homogeneous":false}]},{"label":"wiki 变体3","reqs":[{"label":"護母","types":[7],"count":1,"flagship":false,"wildcard":false,"cve":true,"homogeneous":false},{"label":"海防","types":[1],"count":2,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"他","types":null,"count":2,"flagship":false,"wildcard":true,"cve":false,"homogeneous":false}]},{"label":"wiki 变体4","reqs":[{"label":"練巡","types":[21],"count":1,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"海防","types":[1],"count":2,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"他","types":null,"count":2,"flagship":false,"wildcard":true,"cve":false,"homogeneous":false}]},{"label":"wiki 变体5","reqs":[{"label":"軽","types":[3],"count":1,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"海防","types":[1],"count":2,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"他","types":null,"count":2,"flagship":false,"wildcard":true,"cve":false,"homogeneous":false}]}]；基础编成沿用；附加可行分支为 wikiwiki 单站结构化重述
- A5.compositionBranches = [{"label":"","reqs":[{"label":"轻巡","types":[3],"count":1,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"驱逐","types":[2],"count":3,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"其他*1","types":null,"count":1,"flagship":false,"wildcard":true,"cve":false,"homogeneous":false}]},{"label":"wiki 变体1","reqs":[{"label":"駆","types":[2],"count":1,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"海防","types":[1],"count":3,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"他","types":null,"count":1,"flagship":false,"wildcard":true,"cve":false,"homogeneous":false}]},{"label":"wiki 变体2","reqs":[{"label":"護母","types":[7],"count":1,"flagship":false,"wildcard":false,"cve":true,"homogeneous":false},{"label":"駆","types":[2],"count":2,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"他","types":null,"count":2,"flagship":false,"wildcard":true,"cve":false,"homogeneous":false}]},{"label":"wiki 变体3","reqs":[{"label":"護母","types":[7],"count":1,"flagship":false,"wildcard":false,"cve":true,"homogeneous":false},{"label":"海防","types":[1],"count":2,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"他","types":null,"count":2,"flagship":false,"wildcard":true,"cve":false,"homogeneous":false}]},{"label":"wiki 变体4","reqs":[{"label":"練巡","types":[21],"count":1,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"海防","types":[1],"count":2,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"他","types":null,"count":2,"flagship":false,"wildcard":true,"cve":false,"homogeneous":false}]},{"label":"wiki 变体5","reqs":[{"label":"軽","types":[3],"count":1,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"海防","types":[1],"count":2,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"他","types":null,"count":2,"flagship":false,"wildcard":true,"cve":false,"homogeneous":false}]}]；基础编成沿用；附加可行分支为 wikiwiki 单站结构化重述
- A6.compositionBranches = [{"label":"","reqs":[{"label":"轻巡","types":[3],"count":1,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"驱逐","types":[2],"count":3,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"其他*2","types":null,"count":2,"flagship":false,"wildcard":true,"cve":false,"homogeneous":false}]},{"label":"wiki 变体1","reqs":[{"label":"駆","types":[2],"count":1,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"海防","types":[1],"count":3,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"他","types":null,"count":2,"flagship":false,"wildcard":true,"cve":false,"homogeneous":false}]},{"label":"wiki 变体2","reqs":[{"label":"護母","types":[7],"count":1,"flagship":false,"wildcard":false,"cve":true,"homogeneous":false},{"label":"駆","types":[2],"count":2,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"他","types":null,"count":3,"flagship":false,"wildcard":true,"cve":false,"homogeneous":false}]},{"label":"wiki 变体3","reqs":[{"label":"護母","types":[7],"count":1,"flagship":false,"wildcard":false,"cve":true,"homogeneous":false},{"label":"海防","types":[1],"count":2,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"他","types":null,"count":3,"flagship":false,"wildcard":true,"cve":false,"homogeneous":false}]},{"label":"wiki 变体4","reqs":[{"label":"練巡","types":[21],"count":1,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"海防","types":[1],"count":2,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"他","types":null,"count":3,"flagship":false,"wildcard":true,"cve":false,"homogeneous":false}]},{"label":"wiki 变体5","reqs":[{"label":"軽","types":[3],"count":1,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"海防","types":[1],"count":2,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"他","types":null,"count":3,"flagship":false,"wildcard":true,"cve":false,"homogeneous":false}]}]；基础编成沿用；附加可行分支为 wikiwiki 单站结构化重述
- B5.compositionBranches = [{"label":"","reqs":[{"label":"水母","types":[16],"count":1,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"轻巡","types":[3],"count":1,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"驱逐","types":[2],"count":2,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"其他*2","types":null,"count":2,"flagship":false,"wildcard":true,"cve":false,"homogeneous":false}]}]；两站编成条件一致；kcwiki 编成字段夹带属性说明，不把说明当成舰种
- B6.compositionBranches = [{"label":"","reqs":[{"label":"轻巡(旗舰)","types":[3],"count":1,"flagship":true,"wildcard":false,"cve":false,"homogeneous":false},{"label":"驱逐","types":[2],"count":5,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false}]}]；两站编成条件一致；kcwiki 编成字段夹带属性说明，不把说明当成舰种
- 40.greatSuccess = {"alternatives":[{"drumTotal":4,"kira":4}]}；两站一致：4 桶及 4 闪，仅作大成功说明
- D1.greatSuccess = {"alternatives":[{"kira":5},{"flagLv":128,"kira":4}]}；wikiwiki 单站说明结构化重述；D3 保留待验证标记
- D2.greatSuccess = {"alternatives":[{"kira":5},{"flagLv":128,"kira":4}]}；wikiwiki 单站说明结构化重述；D3 保留待验证标记
- D3.greatSuccess = {"alternatives":[{"kira":5},{"flagLv":128,"kira":4}],"tentative":true}；wikiwiki 单站说明结构化重述；D3 保留待验证标记
- D3.rewards.ammo = [800,67]；wikiwiki 单站每时数值；基础数值两站一致
- D3.rewards.steel = [500,42]；wikiwiki 单站每时数值；基础数值两站一致
- D3.rewards.baux = [400,33]；wikiwiki 单站每时数值；基础数值两站一致
- D1.rewards.shipExp = 45；maintainer；wikiwiki 45；en.kancollewiki.net/Expeditions 页（维护者核 2026-09-06）45；kcwiki 40 为来源错误；narublo 实测页 35 为提督经验；2026-09-06
- 5.compositionBranches = [{"label":"","reqs":[{"label":"轻巡","types":[3],"count":1,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"驱逐/海防","types":[2,1],"count":2,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"其他*1","types":null,"count":1,"flagship":false,"wildcard":true,"cve":false,"homogeneous":false}]},{"label":"wiki 变体1","reqs":[{"label":"駆","types":[2],"count":1,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"海防","types":[1],"count":3,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false}]},{"label":"wiki 变体2","reqs":[{"label":"護母","types":[7],"count":1,"flagship":false,"wildcard":false,"cve":true,"homogeneous":false},{"label":"駆","types":[2],"count":2,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"他","types":null,"count":1,"flagship":false,"wildcard":true,"cve":false,"homogeneous":false}]},{"label":"wiki 变体3","reqs":[{"label":"護母","types":[7],"count":1,"flagship":false,"wildcard":false,"cve":true,"homogeneous":false},{"label":"海防","types":[1],"count":2,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"他","types":null,"count":1,"flagship":false,"wildcard":true,"cve":false,"homogeneous":false}]},{"label":"wiki 变体4","reqs":[{"label":"練巡","types":[21],"count":1,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"海防","types":[1],"count":2,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"他","types":null,"count":1,"flagship":false,"wildcard":true,"cve":false,"homogeneous":false}]}]；maintainer；维护者裁决 2026-09-23：kcwiki 2025-06-29 改为驱逐/海防×3；wikiwiki「遠征」与 ElectronicObserver（andanteyk 2019-09-30、ElectronicObserverEN 2025-11-26 仍沿用）均为轻巡1＋（驱逐+海防）2＋其他1，取多数；变体编成取 wikiwiki 原文，ElectronicObserver 同认；en.kancollewiki.net「Expedition」（2021-04 起）同为轻巡或护卫空母1＋（驱逐/海防）2＋其他1，并列海防模式；2026-09-23
- 42.compositionBranches = [{"label":"","reqs":[{"label":"轻巡","types":[3],"count":1,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"驱逐","types":[2],"count":2,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"其他*1","types":null,"count":1,"flagship":false,"wildcard":true,"cve":false,"homogeneous":false}]},{"label":"wiki 变体1","reqs":[{"label":"駆","types":[2],"count":1,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"海防","types":[1],"count":3,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false}]},{"label":"wiki 变体2","reqs":[{"label":"軽","types":[3],"count":1,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"海防","types":[1],"count":2,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"他","types":null,"count":1,"flagship":false,"wildcard":true,"cve":false,"homogeneous":false}]},{"label":"wiki 变体3","reqs":[{"label":"護母","types":[7],"count":1,"flagship":false,"wildcard":false,"cve":true,"homogeneous":false},{"label":"駆","types":[2],"count":2,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"他","types":null,"count":1,"flagship":false,"wildcard":true,"cve":false,"homogeneous":false}]},{"label":"wiki 变体4","reqs":[{"label":"護母","types":[7],"count":1,"flagship":false,"wildcard":false,"cve":true,"homogeneous":false},{"label":"海防","types":[1],"count":2,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"他","types":null,"count":1,"flagship":false,"wildcard":true,"cve":false,"homogeneous":false}]},{"label":"wiki 变体5","reqs":[{"label":"練巡","types":[21],"count":1,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"海防","types":[1],"count":2,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"他","types":null,"count":1,"flagship":false,"wildcard":true,"cve":false,"homogeneous":false}]}]；maintainer；维护者裁决 2026-09-23：wikiwiki「遠征」基础驱逐2 并列五种海防模式、明写轻巡1驱逐1海防1 失败，kamigame（2023-01）与 zekamashi（2023-01）亦写驱逐2；kcwiki 要求驱逐至少1只（2021-09-30）放行轻巡1驱逐1海防1、不认零驱逐模式；ElectronicObserver 与 4/5/9 共用判定、未单列 42。取 wikiwiki 原文；en.kancollewiki.net「Expedition」42 行（2022-12 起写 1CVE/CL 1DD 3DD/DE）要求驱逐/海防不少于 3，与轻巡2驱逐2护卫空母1 的成功记录（2026-09-12）不符，不计票；2026-09-23
- A4.compositionBranches = [{"label":"","reqs":[{"label":"轻巡","types":[3],"count":1,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"驱逐","types":[2],"count":2,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"其他*2","types":null,"count":2,"flagship":false,"wildcard":true,"cve":false,"homogeneous":false}]},{"label":"wiki 变体1","reqs":[{"label":"駆","types":[2],"count":1,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"海防","types":[1],"count":3,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"他","types":null,"count":1,"flagship":false,"wildcard":true,"cve":false,"homogeneous":false}]},{"label":"wiki 变体2","reqs":[{"label":"護母","types":[7],"count":1,"flagship":false,"wildcard":false,"cve":true,"homogeneous":false},{"label":"駆","types":[2],"count":2,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"他","types":null,"count":2,"flagship":false,"wildcard":true,"cve":false,"homogeneous":false}]},{"label":"wiki 变体3","reqs":[{"label":"護母","types":[7],"count":1,"flagship":false,"wildcard":false,"cve":true,"homogeneous":false},{"label":"海防","types":[1],"count":2,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"他","types":null,"count":2,"flagship":false,"wildcard":true,"cve":false,"homogeneous":false}]},{"label":"wiki 变体4","reqs":[{"label":"練巡","types":[21],"count":1,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"海防","types":[1],"count":2,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"他","types":null,"count":2,"flagship":false,"wildcard":true,"cve":false,"homogeneous":false}]},{"label":"wiki 变体5","reqs":[{"label":"軽","types":[3],"count":1,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"海防","types":[1],"count":2,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"他","types":null,"count":2,"flagship":false,"wildcard":true,"cve":false,"homogeneous":false}]}]；maintainer；维护者裁决 2026-09-23：kcwiki 要求轻巡或护卫空母旗舰（2021-09-30），wikiwiki 与 ElectronicObserver 均不限旗舰，取多数；基础驱逐2 不计海防（kcwiki、wikiwiki 两票，ElectronicObserver 计海防）；变体编成取 wikiwiki 原文；en.kancollewiki.net「Expedition」（2021-04 起）同样不限旗舰、并列海防模式；2026-09-23
- 44.compositionBranches = [{"label":"水母2","reqs":[{"label":"水母","types":[16],"count":2,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"轻巡","types":[3],"count":1,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"驱逐/海防","types":[2,1],"count":2,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"其他*1","types":null,"count":1,"flagship":false,"wildcard":true,"cve":false,"homogeneous":false}]},{"label":"空母系＋水母","reqs":[{"label":"轻空母/空母","types":[7,11,18],"count":1,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"水母","types":[16],"count":1,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"轻巡","types":[3],"count":1,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"驱逐/海防","types":[2,1],"count":2,"flagship":false,"wildcard":false,"cve":false,"homogeneous":false},{"label":"其他*1","types":null,"count":1,"flagship":false,"wildcard":true,"cve":false,"homogeneous":false}]}]；maintainer；维护者裁决 2026-09-25：wikiwiki「遠征」44 写空母(水母,護母可)1隻、水母1隻、軽1隻、(駆+海防)2隻、他1隻必要(要検証)，另列水母×2,軽×1,駆×3；kcwiki 同文，空母数量写作 *1-2 并标待验证；ElectronicObserver（andanteyk 原版与 ElectronicObserverEN 分支现行代码相同）要求水母≥2 或水母≥1 且空母系(水母除く)≥1，另需轻巡≥1、（驱逐+海防）≥2、6 艘。三方一致：空母一格收正规空母、装甲空母、轻空母（含护卫空母）或第二艘水母，另需水母1、轻巡1、驱逐/海防2、其他1；2026-09-25

## 两站冲突清单

118 格未收。下表为运行时消费语义的逐格值；空数组与分组有意义，奖励原始文本在全差异表。
44 编成已按维护者裁决登记；未裁的奖励时薪、奖励分组、舰经验和交战档位冲突仍留底层。
| 远征 | 字段 | kcwiki／新值 | wikiwiki／旧值 | 分类或说明 |
|---|---|---|---|---|
| D1 | rewards.shipExp | 40 | 45 | 已裁（第三票）·待实测；运行时 45；2026-09-06；wikiwiki 45；en.kancollewiki.net/Expeditions 页（维护者核 2026-09-06）45；kcwiki 40 为来源错误；narublo 实测页 35 为提督经验 |

| 远征 | 字段 | kcwiki／新值 | wikiwiki／旧值 | 分类或说明 |
|---|---|---|---|---|
| 4 | rewards.items | [{"name":"高速修复材","count":1}] | [{"name":"高速修复材","count":1},{"name":"家具箱(小)","count":1}] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 4 | rewards.greatItems | [{"name":"家具箱(小)","count":1}] | [] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 8 | rewards.items | [{"name":"高速建造材","count":2}] | [{"name":"高速建造材","count":2},{"name":"开发资材","count":1}] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 8 | rewards.greatItems | [{"name":"开发资材","count":1}] | [] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 9 | rewards.items | [{"name":"家具箱(小)","count":1}] | [{"name":"高速修复材","count":2},{"name":"家具箱(小)","count":1}] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 9 | rewards.greatItems | [{"name":"高速修复材","count":2}] | [] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 10 | rewards.items | [{"name":"高速修复材","count":1}] | [{"name":"高速修复材","count":1},{"name":"高速建造材","count":1}] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 10 | rewards.greatItems | [{"name":"高速建造材","count":1}] | [] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 11 | rewards.items | [{"name":"家具箱(小)","count":1}] | [{"name":"高速修复材","count":1},{"name":"家具箱(小)","count":1}] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 11 | rewards.greatItems | [{"name":"高速修复材","count":1}] | [] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 12 | rewards.items | [{"name":"家具箱(中)","count":1}] | [{"name":"开发资材","count":1},{"name":"家具箱(中)","count":1}] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 12 | rewards.greatItems | [{"name":"开发资材","count":1}] | [] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 13 | rewards.items | [{"name":"高速修复材","count":2}] | [{"name":"高速修复材","count":2},{"name":"家具箱(小)","count":1}] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 13 | rewards.greatItems | [{"name":"家具箱(小)","count":1}] | [] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 14 | rewards.items | [{"name":"高速修复材","count":1}] | [{"name":"高速修复材","count":1},{"name":"开发资材","count":1}] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 14 | rewards.greatItems | [{"name":"开发资材","count":1}] | [] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 15 | rewards.items | [{"name":"家具箱(大)","count":1}] | [{"name":"开发资材","count":1},{"name":"家具箱(大)","count":1}] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 15 | rewards.greatItems | [{"name":"开发资材","count":1}] | [] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 16 | rewards.items | [{"name":"高速建造材","count":2}] | [{"name":"高速建造材","count":2},{"name":"开发资材","count":2}] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 16 | rewards.greatItems | [{"name":"开发资材","count":2}] | [] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 18 | rewards.baux | [150,20] | [150,30] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 19 | rewards.items | [{"name":"家具箱(小)","count":1}] | [{"name":"开发资材","count":1},{"name":"家具箱(小)","count":1}] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 19 | rewards.greatItems | [{"name":"开发资材","count":1}] | [] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 20 | rewards.items | [{"name":"开发资材","count":1}] | [{"name":"开发资材","count":1},{"name":"家具箱(中)","count":1}] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 20 | rewards.greatItems | [{"name":"家具箱(中)","count":1}] | [] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 23 | rewards.ammo | [50,12] | [50,13] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 23 | rewards.baux | [130,32] | [130,33] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 24 | greatSuccess | {"alternatives":[{"drumTotal":4,"kira":4}]} | {"ambiguousDrumTotals":[4,2],"kira":4} | 4 个以上／2 个以上混杂；大成功条件整个不收，底层原说明保留 |
| 24 | rewards.items | [{"name":"开发资材","count":2}] | [{"name":"高速修复材","count":1},{"name":"开发资材","count":2}] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 24 | rewards.greatItems | [{"name":"高速修复材","count":1}] | [] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 26 | rewards.items | [{"name":"高速修复材","count":3}] | [{"name":"高速修复材","count":3},{"name":"家具箱(大)","count":1}] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 26 | rewards.greatItems | [{"name":"家具箱(大)","count":1}] | [] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 27 | rewards.items | [{"name":"开发资材","count":2}] | [{"name":"开发资材","count":2},{"name":"家具箱(小)","count":2}] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 27 | rewards.greatItems | [{"name":"家具箱(小)","count":2}] | [] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 28 | rewards.items | [{"name":"开发资材","count":3}] | [{"name":"开发资材","count":3},{"name":"家具箱(中)","count":2}] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 28 | rewards.greatItems | [{"name":"家具箱(中)","count":2}] | [] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 29 | rewards.items | [{"name":"开发资材","count":1}] | [{"name":"开发资材","count":1},{"name":"家具箱(小)","count":1}] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 29 | rewards.greatItems | [{"name":"家具箱(小)","count":1}] | [] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 30 | rewards.ammo | [50,2] | [50,1] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 30 | rewards.items | [{"name":"开发资材","count":3}] | [{"name":"开发资材","count":3},{"name":"家具箱(大)","count":1}] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 30 | rewards.greatItems | [{"name":"家具箱(大)","count":1}] | [] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 32 | rewards.items | [{"name":"家具箱(大)","count":1}] | [{"name":"开发资材","count":3},{"name":"家具箱(大)","count":1}] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 32 | rewards.greatItems | [{"name":"开发资材","count":3}] | [] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 35 | rewards.items | [{"name":"家具箱(小)","count":2}] | [{"name":"开发资材","count":1},{"name":"家具箱(小)","count":2}] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 35 | rewards.greatItems | [{"name":"开发资材","count":1}] | [] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 36 | rewards.items | [{"name":"家具箱(中)","count":2}] | [{"name":"高速修复材","count":1},{"name":"家具箱(中)","count":2}] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 36 | rewards.greatItems | [{"name":"高速修复材","count":1}] | [] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 39 | rewards.items | [{"name":"高速修复材","count":2}] | [{"name":"高速修复材","count":2},{"name":"家具箱(中)","count":1}] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 39 | rewards.greatItems | [{"name":"家具箱(中)","count":1}] | [] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 40 | rewards.fuel | [300,43] | [300,44] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 40 | rewards.ammo | [300,43] | [300,44] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 40 | rewards.baux | [100,13] | [100,15] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 40 | rewards.items | [{"name":"家具箱(小)","count":3}] | [{"name":"高速修复材","count":1},{"name":"家具箱(小)","count":3}] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 40 | rewards.greatItems | [{"name":"高速修复材","count":1}] | [] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 41 | rewards.items | [{"name":"开发资材","count":1}] | [{"name":"高速修复材","count":1},{"name":"开发资材","count":1}] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 41 | rewards.greatItems | [{"name":"高速修复材","count":1}] | [] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 42 | rewards.items | [{"name":"家具箱(大)","count":1}] | [{"name":"高速建造材","count":3},{"name":"家具箱(大)","count":1}] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 42 | rewards.greatItems | [{"name":"高速建造材","count":3}] | [] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 43 | rewards.fuel | [2000,166] | [2000,167] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 43 | rewards.items | [{"name":"开发资材","count":4}] | [{"name":"开发资材","count":4},{"name":"改修资材","count":1}] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 43 | rewards.greatItems | [{"name":"改修资材","count":1}] | [] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 44 | rewards.items | [{"name":"开发资材","count":4}] | [{"name":"开发资材","count":4},{"name":"家具箱(大)","count":2}] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 44 | rewards.greatItems | [{"name":"家具箱(大)","count":2}] | [] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 46 | combat | "交战II型" | "交战型" | 两站机制不同，不覆盖 kcwiki |
| 46 | rewards.fuel | [300,85] | [300,86] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 46 | rewards.steel | [150,42] | [150,43] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 46 | rewards.baux | [380,108] | [380,109] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 46 | rewards.items | [{"name":"开发资材","count":3}] | [{"name":"开发资材","count":3},{"name":"改修资材","count":1}] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| 46 | rewards.greatItems | [{"name":"改修资材","count":1}] | [] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| A2 | rewards.ammo | [40,43] | [40,44] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| A2 | rewards.items | [{"name":"开发资材","count":1}] | [{"name":"高速修复材","count":1},{"name":"开发资材","count":1}] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| A2 | rewards.greatItems | [{"name":"高速修复材","count":1}] | [] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| A3 | rewards.items | [{"name":"高速修复材","count":1}] | [{"name":"高速修复材","count":1},{"name":"开发资材","count":2}] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| A3 | rewards.greatItems | [{"name":"开发资材","count":2}] | [] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| A4 | rewards.items | [{"name":"高速修复材","count":2}] | [{"name":"高速修复材","count":2},{"name":"高速建造材","count":2}] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| A4 | rewards.greatItems | [{"name":"高速建造材","count":2}] | [] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| A5 | rewards.items | [{"name":"开发资材","count":4}] | [{"name":"高速修复材","count":3},{"name":"开发资材","count":4}] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| A5 | rewards.greatItems | [{"name":"高速修复材","count":3}] | [] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| A6 | combat | "交战II型" | "交战型" | 两站机制不同，不覆盖 kcwiki |
| A6 | rewards.fuel | [100,28] | [100,29] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| A6 | rewards.ammo | [500,142] | [500,143] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| A6 | rewards.steel | [100,28] | [100,29] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| A6 | rewards.items | [{"name":"开发资材","count":5}] | [{"name":"开发资材","count":5},{"name":"改修资材","count":1}] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| A6 | rewards.greatItems | [{"name":"改修资材","count":1}] | [] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| B1 | rewards.items | [{"name":"家具箱(小)","count":1}] | [{"name":"高速修复材","count":1}] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| B1 | rewards.greatItems | [{"name":"高速修复材","count":1}] | [] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| B2 | rewards.items | [{"name":"开发资材","count":2}] | [{"name":"高速修复材","count":2},{"name":"开发资材","count":2}] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| B2 | rewards.greatItems | [{"name":"高速修复材","count":2}] | [] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| B3 | rewards.baux | [180,63] | [180,64] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| B3 | rewards.items | [{"name":"家具箱(大)","count":1}] | [{"name":"高速修复材","count":2}] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| B3 | rewards.greatItems | [{"name":"高速修复材","count":2}] | [] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| B4 | rewards.baux | [650,86] | [650,87] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| B4 | rewards.items | [{"name":"开发资材","count":4}] | [{"name":"开发资材","count":4},{"name":"改修资材","count":1}] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| B4 | rewards.greatItems | [{"name":"改修资材","count":1}] | [] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| B5 | combat | "交战II型" | "交战型" | 两站机制不同，不覆盖 kcwiki |
| B5 | rewards.fuel | [500,76] | [500,77] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| B5 | rewards.ammo | [500,76] | [500,77] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| B5 | rewards.steel | [1000,153] | [1000,154] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| B5 | rewards.items | [{"name":"高速修复材","count":4}] | [{"name":"高速修复材","count":4},{"name":"改修资材","count":1}] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| B5 | rewards.greatItems | [{"name":"改修资材","count":1}] | [] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| B6 | combat | "交战II型" | "交战型" | 两站机制不同，不覆盖 kcwiki |
| B6 | rewards.fuel | [600,102] | [600,103] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| B6 | rewards.steel | [600,102] | [600,103] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| B6 | rewards.baux | [600,102] | [600,103] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| B6 | rewards.items | [{"name":"开发资材","count":5}] | [{"name":"开发资材","count":5},{"name":"改修资材","count":1}] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| B6 | rewards.greatItems | [{"name":"改修资材","count":1}] | [] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| D2 | rewards.items | [{"name":"伊良湖","count":1}] | [{"name":"家具箱(大)","count":1}] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| D2 | rewards.greatItems | [{"name":"家具箱(大)","count":1}] | [] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| D3 | combat | "交战II型" | "交战型" | 两站机制不同，不覆盖 kcwiki |
| D3 | rewards.items | [{"name":"高速修复材","count":3}] | [{"name":"高速修复材","count":3},{"name":"改修资材","count":1}] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| D3 | rewards.greatItems | [{"name":"改修资材","count":1}] | [] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| E1 | combat | "交战II型" | "交战型" | 两站机制不同，不覆盖 kcwiki |
| E1 | rewards.items | [{"name":"家具箱(大)","count":2}] | [{"name":"改修资材","count":1},{"name":"家具箱(大)","count":2}] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| E1 | rewards.greatItems | [{"name":"改修资材","count":1}] | [] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| E2 | combat | "交战II型" | "交战型" | 两站机制不同，不覆盖 kcwiki |
| E2 | rewards.ammo | [480,160] | [480,156] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| E2 | rewards.items | [{"name":"高速修复材","count":2}] | [{"name":"高速修复材","count":2},{"name":"改修资材","count":1}] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |
| E2 | rewards.greatItems | [{"name":"改修资材","count":1}] | [] | 两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki |

来源本身另有 1 格编成原文差异，裁决与留底说明如下：
| 远征 | 字段 | kcwiki／新值 | wikiwiki／旧值 | 分类或说明 |
|---|---|---|---|---|
| 44 | composition | "空母(水母，护母可)*1-2 水母*1 轻巡*1 驱逐/海防*2 其他*1（待验证）" | "空母(水母,护卫空母可)*1、水母*1、轻巡*1、驱逐/海防*2、其他*1(要検証)" | 1-2 与 1 不同且含待验证标记；维护者裁决 2026-09-25 已按三方一致登记 compositionBranches，空母一格认空母系或第二艘水母，原文差异留底 |

## 维护者编成订正

5/42/A4 按维护者裁决逐格登记；主编成与 wikiwiki 原文变体一并转成 compositionBranches。
42 基础编成为轻巡1、驱逐2、其他1，另认五种海防模式；轻巡1驱逐1海防1 判失败，与 wikiwiki 原文消费语义一致。
44 按 ElectronicObserver 的或条件登记两个分支：「水母2」为水母2、轻巡1、驱逐/海防2、其他1；「空母系＋水母」为空母系1、水母1、轻巡1、驱逐/海防2、其他1。每支共6艘，坑位舰种互不重叠；普通轻空母与护卫空母均可，桶数、属性与等级条件不变。

| 远征 | 字段 | 依据 |
|---|---|---|
| 5 | compositionBranches | 维护者裁决 2026-09-23：kcwiki 2025-06-29 改为驱逐/海防×3；wikiwiki「遠征」与 ElectronicObserver（andanteyk 2019-09-30、ElectronicObserverEN 2025-11-26 仍沿用）均为轻巡1＋（驱逐+海防）2＋其他1，取多数；变体编成取 wikiwiki 原文，ElectronicObserver 同认；en.kancollewiki.net「Expedition」（2021-04 起）同为轻巡或护卫空母1＋（驱逐/海防）2＋其他1，并列海防模式 |
| 42 | compositionBranches | 维护者裁决 2026-09-23：wikiwiki「遠征」基础驱逐2 并列五种海防模式、明写轻巡1驱逐1海防1 失败，kamigame（2023-01）与 zekamashi（2023-01）亦写驱逐2；kcwiki 要求驱逐至少1只（2021-09-30）放行轻巡1驱逐1海防1、不认零驱逐模式；ElectronicObserver 与 4/5/9 共用判定、未单列 42。取 wikiwiki 原文；en.kancollewiki.net「Expedition」42 行（2022-12 起写 1CVE/CL 1DD 3DD/DE）要求驱逐/海防不少于 3，与轻巡2驱逐2护卫空母1 的成功记录（2026-09-12）不符，不计票 |
| A4 | compositionBranches | 维护者裁决 2026-09-23：kcwiki 要求轻巡或护卫空母旗舰（2021-09-30），wikiwiki 与 ElectronicObserver 均不限旗舰，取多数；基础驱逐2 不计海防（kcwiki、wikiwiki 两票，ElectronicObserver 计海防）；变体编成取 wikiwiki 原文；en.kancollewiki.net「Expedition」（2021-04 起）同样不限旗舰、并列海防模式 |
| 44 | compositionBranches | 维护者裁决 2026-09-25：wikiwiki「遠征」44 写空母(水母,護母可)1隻、水母1隻、軽1隻、(駆+海防)2隻、他1隻必要(要検証)，另列水母×2,軽×1,駆×3；kcwiki 同文，空母数量写作 *1-2 并标待验证；ElectronicObserver（andanteyk 原版与 ElectronicObserverEN 分支现行代码相同）要求水母≥2 或水母≥1 且空母系(水母除く)≥1，另需轻巡≥1、（驱逐+海防）≥2、6 艘。三方一致：空母一格收正规空母、装甲空母、轻空母（含护卫空母）或第二艘水母，另需水母1、轻巡1、驱逐/海防2、其他1 |

## 提取纠错与续单裁定

21/44 字段 1/2 与 kcwiki 说明 3/6 打架，按说明收 3/6，与 wikiwiki 一致。
| 远征 | 字段 | kcwiki／新值 | wikiwiki／旧值 | 分类或说明 |
|---|---|---|---|---|
| 24 | drumTotal | null | 4 | 2026-09-06 裁定：大成功桶数被误提取为普通门槛，不恢复 |
| 40 | drumTotal | null | 4 | 2026-09-06 裁定：大成功桶数被误提取为普通门槛，不恢复 |
24 的大成功事实不收；kcwiki 原有中文说明仍在底层，不视为新增认定。
B5/B6 只去除编成字段中的属性散文所产生的伪舰种；属性判定与机制注释保留。
33/34/D3 的零资源 [0,null] 与 null 消费相同，归格式差异；底层不改。

## 文字退出清单

457 格；这些日文原文、名称、格式和未消费的来源元数据退出 wikiwiki 运行时合并。
composition 的文字差异在全表；分支语义单独对账，不能凭「文字」名义跳过。greatNote 的条件也另投影为 greatSuccess。
stats 键顺序不影响消费；道具名称按玩家本地化归一、min 未被消费，不计机制冲突。
| 远征 | 字段 | kcwiki／新值 | wikiwiki／旧值 | 分类或说明 |
|---|---|---|---|---|
| 1 | nameZh | "练习航海" | null | kcwiki 有 wikiwiki 无 |
| 1 | difficulty | null | "E" | wikiwiki 有 kcwiki 无 |
| 1 | descriptionJp | null | "鎮守府近海を航海し、艦隊の練度を高めよう！" | wikiwiki 有 kcwiki 无 |
| 1 | useFuelText | null | "少量/30%" | wikiwiki 有 kcwiki 无 |
| 1 | useBullText | null | "なし" | wikiwiki 有 kcwiki 无 |
| 1 | rawComposition | null | "最低2隻。艦種自由／「駆×2」" | wikiwiki 有 kcwiki 无 |
| 2 | nameZh | "长距离练习航海" | null | kcwiki 有 wikiwiki 无 |
| 2 | difficulty | null | "E" | wikiwiki 有 kcwiki 无 |
| 2 | descriptionJp | null | "外海まで足を延ばし、艦隊の練度を高めよう！" | wikiwiki 有 kcwiki 无 |
| 2 | useFuelText | null | "普通/50%" | wikiwiki 有 kcwiki 无 |
| 2 | useBullText | null | "なし" | wikiwiki 有 kcwiki 无 |
| 2 | rawComposition | null | "最低4隻。艦種自由／「駆×4」" | wikiwiki 有 kcwiki 无 |
| 3 | nameZh | "警备任务" | null | kcwiki 有 wikiwiki 无 |
| 3 | difficulty | null | "D" | wikiwiki 有 kcwiki 无 |
| 3 | descriptionJp | null | "鎮守府担当海域をパトロールして領海の安全を守ろう！" | wikiwiki 有 kcwiki 无 |
| 3 | useFuelText | null | "少量/30%" | wikiwiki 有 kcwiki 无 |
| 3 | useBullText | null | "少量/20%" | wikiwiki 有 kcwiki 无 |
| 3 | rawComposition | null | "最低3隻。艦種自由／「駆×3」" | wikiwiki 有 kcwiki 无 |
| 4 | nameZh | "对潜警戒任务" | null | kcwiki 有 wikiwiki 无 |
| 4 | difficulty | null | "D" | wikiwiki 有 kcwiki 无 |
| 4 | descriptionJp | null | "水雷戦隊を編成、領海内を索敵、対潜水警戒任務に就こう！" | wikiwiki 有 kcwiki 无 |
| 4 | useFuelText | null | "普通/50%" | wikiwiki 有 kcwiki 无 |
| 4 | useBullText | null | "なし" | wikiwiki 有 kcwiki 无 |
| 4 | rawComposition | null | "最低3隻。軽1隻、(駆+海防)2隻必要。／「軽×1,駆×2」 (駆1海防3)(護母1駆2)(護母1海防2)(練巡1海防2)の編成でも成功する。詳しくは上記参照。" | wikiwiki 有 kcwiki 无 |
| 5 | nameZh | "海上护卫任务" | null | kcwiki 有 wikiwiki 无 |
| 5 | difficulty | null | "C" | wikiwiki 有 kcwiki 无 |
| 5 | descriptionJp | null | "輸送船団の安全を図るために、船団に同行し、これを護衛しよう！" | wikiwiki 有 kcwiki 无 |
| 5 | useFuelText | null | "普通/50%" | wikiwiki 有 kcwiki 无 |
| 5 | useBullText | null | "なし" | wikiwiki 有 kcwiki 无 |
| 5 | rawComposition | null | "最低4隻。軽1隻、(駆+海防)2隻、他1隻必要。／「軽×1,駆×3」 (駆1海防3)(護母1駆2他1)(護母1海防2他1)(練巡1海防2他1)の編成でも成功する。詳しくは上記参照。" | wikiwiki 有 kcwiki 无 |
| 6 | nameZh | "防空射击演习" | null | kcwiki 有 wikiwiki 无 |
| 6 | difficulty | null | "C" | wikiwiki 有 kcwiki 无 |
| 6 | descriptionJp | null | "敵艦載機襲来に備えて、対空射撃や回避運動の訓練をしよう！" | wikiwiki 有 kcwiki 无 |
| 6 | useFuelText | null | "少量/30%" | wikiwiki 有 kcwiki 无 |
| 6 | useBullText | null | "少量/20%" | wikiwiki 有 kcwiki 无 |
| 6 | rawComposition | null | "最低4隻。艦種自由／「駆×4」" | wikiwiki 有 kcwiki 无 |
| 7 | nameZh | "观舰式排演" | null | kcwiki 有 wikiwiki 无 |
| 7 | difficulty | null | "C" | wikiwiki 有 kcwiki 无 |
| 7 | descriptionJp | null | "海の一大ページェント「観艦式」の予行航海を実施しよう！" | wikiwiki 有 kcwiki 无 |
| 7 | useFuelText | null | "普通/50%" | wikiwiki 有 kcwiki 无 |
| 7 | useBullText | null | "なし" | wikiwiki 有 kcwiki 无 |
| 7 | rawComposition | null | "全6隻。艦種自由／「駆×6」" | wikiwiki 有 kcwiki 无 |
| 8 | nameZh | "观舰式" | null | kcwiki 有 wikiwiki 无 |
| 8 | difficulty | null | "B" | wikiwiki 有 kcwiki 无 |
| 8 | descriptionJp | null | "今こそ日頃の訓練の成果を見せるとき！「観艦式」を挙行しよう！" | wikiwiki 有 kcwiki 无 |
| 8 | useFuelText | null | "普通/50%" | wikiwiki 有 kcwiki 无 |
| 8 | useBullText | null | "少量/20%" | wikiwiki 有 kcwiki 无 |
| 8 | rawComposition | null | "全6隻。艦種自由／「駆×6」" | wikiwiki 有 kcwiki 无 |
| 9 | nameZh | "油轮护卫任务" | null | kcwiki 有 wikiwiki 无 |
| 9 | difficulty | null | "C" | wikiwiki 有 kcwiki 无 |
| 9 | descriptionJp | null | "油田地帯から燃料を満載して戻るタンカー船団を護衛しよう！" | wikiwiki 有 kcwiki 无 |
| 9 | useFuelText | null | "普通/50%" | wikiwiki 有 kcwiki 无 |
| 9 | useBullText | null | "なし" | wikiwiki 有 kcwiki 无 |
| 9 | rawComposition | null | "最低4隻。軽1隻、(駆+海防)2隻、他1隻必要。／「軽×1,駆×3」 (駆1海防3)(護母1駆2他1)(護母1海防2他1)(練巡1海防2他1)の編成でも成功する。詳しくは上記参照。" | wikiwiki 有 kcwiki 无 |
| 10 | nameZh | "强行侦察任务" | null | kcwiki 有 wikiwiki 无 |
| 10 | difficulty | null | "C" | wikiwiki 有 kcwiki 无 |
| 10 | descriptionJp | null | "水上偵察機搭載艦などを活用し、敵艦隊の動向を探れ！" | wikiwiki 有 kcwiki 无 |
| 10 | useFuelText | null | "少量/30%" | wikiwiki 有 kcwiki 无 |
| 10 | useBullText | null | "なし" | wikiwiki 有 kcwiki 无 |
| 10 | rawComposition | null | "最低3隻。軽2隻、他1隻必要／「軽×2,駆×1」" | wikiwiki 有 kcwiki 无 |
| 11 | nameZh | "铝土运送任务" | null | kcwiki 有 wikiwiki 无 |
| 11 | difficulty | null | "B" | wikiwiki 有 kcwiki 无 |
| 11 | descriptionJp | null | "資源集積地から、母港にボーキサイトを輸送しよう！" | wikiwiki 有 kcwiki 无 |
| 11 | useFuelText | null | "普通/50%" | wikiwiki 有 kcwiki 无 |
| 11 | useBullText | null | "なし" | wikiwiki 有 kcwiki 无 |
| 11 | rawComposition | null | "最低4隻。(駆+海防)2隻、他2隻必要／「駆×4」" | wikiwiki 有 kcwiki 无 |
| 12 | nameZh | "资源运送任务" | null | kcwiki 有 wikiwiki 无 |
| 12 | difficulty | null | "B" | wikiwiki 有 kcwiki 无 |
| 12 | descriptionJp | null | "資源国からの輸送部隊を護衛し、母港への輸送を無事完遂しよう！" | wikiwiki 有 kcwiki 无 |
| 12 | useFuelText | null | "普通/50%" | wikiwiki 有 kcwiki 无 |
| 12 | useBullText | null | "なし" | wikiwiki 有 kcwiki 无 |
| 12 | rawComposition | null | "最低4隻。(駆+海防)2隻、他2隻必要／「駆×4」" | wikiwiki 有 kcwiki 无 |
| 13 | nameZh | "鼠输送作战" | null | kcwiki 有 wikiwiki 无 |
| 13 | difficulty | null | "A" | wikiwiki 有 kcwiki 无 |
| 13 | descriptionJp | null | "快速の水雷戦隊を集中運用して、激戦の諸島へ物資を輸送しよう！" | wikiwiki 有 kcwiki 无 |
| 13 | useFuelText | null | "普通/50%" | wikiwiki 有 kcwiki 无 |
| 13 | useBullText | null | "普通/40%" | wikiwiki 有 kcwiki 无 |
| 13 | rawComposition | null | "全6隻。軽1隻、駆4隻、他1隻必要／「軽×1,駆×5」" | wikiwiki 有 kcwiki 无 |
| 14 | nameZh | "围困陆战队撤退运送任务" | null | kcwiki 有 wikiwiki 无 |
| 14 | difficulty | null | "A" | wikiwiki 有 kcwiki 无 |
| 14 | descriptionJp | null | "機動力のある小艦艇部隊を結集、包囲下の部隊を収容しよう！" | wikiwiki 有 kcwiki 无 |
| 14 | useFuelText | null | "普通/50%" | wikiwiki 有 kcwiki 无 |
| 14 | useBullText | null | "なし" | wikiwiki 有 kcwiki 无 |
| 14 | rawComposition | null | "全6隻。軽1隻、駆3隻、他2隻必要／「軽×1,駆×5」" | wikiwiki 有 kcwiki 无 |
| 15 | nameZh | "诱饵机动部队支援作战" | null | kcwiki 有 wikiwiki 无 |
| 15 | difficulty | null | "S" | wikiwiki 有 kcwiki 无 |
| 15 | descriptionJp | null | "敵機動部隊を誘引する空母を含む囮部隊で主力艦隊を支援しよう！" | wikiwiki 有 kcwiki 无 |
| 15 | useFuelText | null | "普通/50%" | wikiwiki 有 kcwiki 无 |
| 15 | useBullText | null | "普通/40%" | wikiwiki 有 kcwiki 无 |
| 15 | rawComposition | null | "全6隻。空母(水母,護母可)2隻、駆2隻、他2隻必要／「空母×2,駆×4」「水母×2,駆×4」" | wikiwiki 有 kcwiki 无 |
| 16 | nameZh | "舰队决战护卫作战" | null | kcwiki 有 wikiwiki 无 |
| 16 | difficulty | null | "S" | wikiwiki 有 kcwiki 无 |
| 16 | descriptionJp | null | "有力な艦隊を編成し、敵背後側面を奇襲、艦隊決戦を援護しよう！" | wikiwiki 有 kcwiki 无 |
| 16 | useFuelText | null | "普通/50%" | wikiwiki 有 kcwiki 无 |
| 16 | useBullText | null | "普通/40%" | wikiwiki 有 kcwiki 无 |
| 16 | rawComposition | null | "全6隻。軽1隻、駆2隻、他3隻必要／「軽×1,駆×5」" | wikiwiki 有 kcwiki 无 |
| 17 | nameZh | "敌基地侦察作战" | null | kcwiki 有 wikiwiki 无 |
| 17 | difficulty | null | "A" | wikiwiki 有 kcwiki 无 |
| 17 | descriptionJp | null | "精鋭水雷戦隊を投入し、北方海域の敵情勢を強行偵察せよ！" | wikiwiki 有 kcwiki 无 |
| 17 | useFuelText | null | "少量/30%" | wikiwiki 有 kcwiki 无 |
| 17 | useBullText | null | "普通/40%" | wikiwiki 有 kcwiki 无 |
| 17 | rawComposition | null | "全6隻。軽1隻、駆3隻、他2隻必要／「軽×1,駆×5」" | wikiwiki 有 kcwiki 无 |
| 18 | nameZh | "舰载机运送作战" | null | kcwiki 有 wikiwiki 无 |
| 18 | difficulty | null | "S" | wikiwiki 有 kcwiki 无 |
| 18 | descriptionJp | null | "「航空母艦」を多数配備した輸送部隊で前線に航空機を輸送せよ！" | wikiwiki 有 kcwiki 无 |
| 18 | useFuelText | null | "普通/50%" | wikiwiki 有 kcwiki 无 |
| 18 | useBullText | null | "少量/20%" | wikiwiki 有 kcwiki 无 |
| 18 | rawComposition | null | "全6隻。空母(水母,護母可)3隻、駆2隻、他1隻必要／「空母×3,駆×3」" | wikiwiki 有 kcwiki 无 |
| 19 | nameZh | "北号作战" | null | kcwiki 有 wikiwiki 无 |
| 19 | difficulty | null | "S" | wikiwiki 有 kcwiki 无 |
| 19 | descriptionJp | null | "高練度「航空戦艦」複数を基幹とする強行輸送船団を出航させよ！" | wikiwiki 有 kcwiki 无 |
| 19 | useFuelText | null | "普通/50%" | wikiwiki 有 kcwiki 无 |
| 19 | useBullText | null | "普通/40%" | wikiwiki 有 kcwiki 无 |
| 19 | rawComposition | null | "全6隻。航戦2隻、駆2隻、他2隻必要／「航戦×2,駆×4」" | wikiwiki 有 kcwiki 无 |
| 20 | nameZh | "潜水艇戒备任务" | null | kcwiki 有 wikiwiki 无 |
| 20 | difficulty | null | "S" | wikiwiki 有 kcwiki 无 |
| 20 | descriptionJp | null | "潜水艦と同支援艦艇による艦隊で北方海域の哨戒任務にあたれ！" | wikiwiki 有 kcwiki 无 |
| 20 | useFuelText | null | "普通/50%" | wikiwiki 有 kcwiki 无 |
| 20 | useBullText | null | "普通/40%" | wikiwiki 有 kcwiki 无 |
| 20 | rawComposition | null | "最低2隻。潜1隻、軽1隻必要 ／「潜×1,軽×1」" | wikiwiki 有 kcwiki 无 |
| 21 | nameZh | "北方鼠输送作战" | null | kcwiki 有 wikiwiki 无 |
| 21 | escortText | "至少3个舰娘\n各携带1个桶" | null | kcwiki 有 wikiwiki 无 |
| 21 | greatNote | "大成功要4桶以上+4闪" | "合計4個以上かつキラキラ艦4隻以上で大成功確定" | 两者值不同 |
| 21 | difficulty | null | "S" | wikiwiki 有 kcwiki 无 |
| 21 | descriptionJp | null | "水雷戦隊にドラム缶を積載、北方方面の友軍への糧食補給を図れ！" | wikiwiki 有 kcwiki 无 |
| 21 | useFuelText | null | "大量/80%" | wikiwiki 有 kcwiki 无 |
| 21 | useBullText | null | "大量/70%" | wikiwiki 有 kcwiki 无 |
| 21 | rawComposition | null | "最低5隻。軽1隻、駆4隻必要／「軽×1,駆×4,任意の3隻にドラム缶を合計3つ」 3隻以上にドラム缶(輸送用)が合計3個以上必要。合計4個以上かつキラキラ艦4隻以上で大成功確定。詳細はこちらを参照。" | wikiwiki 有 kcwiki 无 |
| 22 | nameZh | "舰队演习" | null | kcwiki 有 wikiwiki 无 |
| 22 | difficulty | null | "S" | wikiwiki 有 kcwiki 无 |
| 22 | descriptionJp | null | "練度向上のため艦隊演習を実施！(資源獲得の遠征ではありません)" | wikiwiki 有 kcwiki 无 |
| 22 | useFuelText | null | "大量/80%" | wikiwiki 有 kcwiki 无 |
| 22 | useBullText | null | "大量/70%" | wikiwiki 有 kcwiki 无 |
| 22 | rawComposition | null | "全6隻。重1隻、軽1隻、駆2隻、他2隻必要／「重×1,軽×1,駆×4」" | wikiwiki 有 kcwiki 无 |
| 23 | nameZh | "航空战舰运用演习" | null | kcwiki 有 wikiwiki 无 |
| 23 | difficulty | null | "S" | wikiwiki 有 kcwiki 无 |
| 23 | descriptionJp | null | "高練度「航空戦艦」戦隊を基幹とした艦隊の総合演習を実施せよ！" | wikiwiki 有 kcwiki 无 |
| 23 | useFuelText | null | "大量/80%" | wikiwiki 有 kcwiki 无 |
| 23 | useBullText | null | "大量/80%" | wikiwiki 有 kcwiki 无 |
| 23 | rawComposition | null | "全6隻。航戦2隻、駆2隻、他2隻必要／「航戦×2,駆×4」" | wikiwiki 有 kcwiki 无 |
| 24 | nameZh | "北方航路海上护卫" | null | kcwiki 有 wikiwiki 无 |
| 24 | greatNote | "大成功要4桶以上+4闪" | "合計4個以上合計2個以上かつキラキラ艦4隻以上で大成功確定" | 两者值不同 |
| 24 | difficulty | null | "S" | wikiwiki 有 kcwiki 无 |
| 24 | descriptionJp | null | "高練度軽巡が率いる精鋭護衛艦隊で北方航路海上護衛を実施せよ！" | wikiwiki 有 kcwiki 无 |
| 24 | useFuelText | null | "大量/90%" | wikiwiki 有 kcwiki 无 |
| 24 | useBullText | null | "普通/60%" | wikiwiki 有 kcwiki 无 |
| 24 | rawComposition | null | "全6隻。軽(旗艦固定)1隻、(駆+海防)4隻、他1隻必要／「軽×1,駆×5」 ドラム缶(輸送用)が合計4個以上合計2個以上かつキラキラ艦4隻以上で大成功確定。詳細はこちらを参照。" | wikiwiki 有 kcwiki 无 |
| 25 | nameZh | "通商破坏作战" | null | kcwiki 有 wikiwiki 无 |
| 25 | difficulty | null | "S" | wikiwiki 有 kcwiki 无 |
| 25 | descriptionJp | null | "快速かつ打撃力のある重巡戦隊を投入、敵後方補給線を遮断せよ！" | wikiwiki 有 kcwiki 无 |
| 25 | useFuelText | null | "普通/50%" | wikiwiki 有 kcwiki 无 |
| 25 | useBullText | null | "大量/80%" | wikiwiki 有 kcwiki 无 |
| 25 | rawComposition | null | "最低4隻。重2隻、駆2隻必要／「重×2,駆×2」" | wikiwiki 有 kcwiki 无 |
| 26 | nameZh | "敌母港空袭作战" | null | kcwiki 有 wikiwiki 无 |
| 26 | difficulty | null | "S" | wikiwiki 有 kcwiki 无 |
| 26 | descriptionJp | null | "敵潜水艦の哨戒線を長躯突破し、有力な機動艦隊で敵母港を叩け！" | wikiwiki 有 kcwiki 无 |
| 26 | useFuelText | null | "大量/80%" | wikiwiki 有 kcwiki 无 |
| 26 | useBullText | null | "大量/80%" | wikiwiki 有 kcwiki 无 |
| 26 | rawComposition | null | "最低4隻。空母(水母,護母可)1隻、軽1隻、駆2隻必要／「空母×1,軽×1,駆×2」" | wikiwiki 有 kcwiki 无 |
| 27 | nameZh | "潜水艇通商破坏作战" | null | kcwiki 有 wikiwiki 无 |
| 27 | difficulty | null | "S" | wikiwiki 有 kcwiki 无 |
| 27 | descriptionJp | null | "潜水艦2隻以上を伴う艦隊で、敵後方へ進出、通商破壊作戦実施！" | wikiwiki 有 kcwiki 无 |
| 27 | useFuelText | null | "大量/80%" | wikiwiki 有 kcwiki 无 |
| 27 | useBullText | null | "大量/80%" | wikiwiki 有 kcwiki 无 |
| 27 | rawComposition | null | "最低2隻。潜2隻必要／「潜×2」" | wikiwiki 有 kcwiki 无 |
| 28 | nameZh | "西方海域封锁作战" | null | kcwiki 有 wikiwiki 无 |
| 28 | difficulty | null | "S" | wikiwiki 有 kcwiki 无 |
| 28 | descriptionJp | null | "潜水艦3隻以上の艦隊で、西方海域の敵水上艦の活動を封鎖せよ！" | wikiwiki 有 kcwiki 无 |
| 28 | useFuelText | null | "大量/80%" | wikiwiki 有 kcwiki 无 |
| 28 | useBullText | null | "大量/80%" | wikiwiki 有 kcwiki 无 |
| 28 | rawComposition | null | "最低3隻。潜3隻必要／「潜×3」" | wikiwiki 有 kcwiki 无 |
| 29 | nameZh | "潜水艇派遣演习" | null | kcwiki 有 wikiwiki 无 |
| 29 | difficulty | null | "S" | wikiwiki 有 kcwiki 无 |
| 29 | descriptionJp | null | "潜水艦3隻以上の艦隊を編成し、長距離派遣の演習を実施せよ！" | wikiwiki 有 kcwiki 无 |
| 29 | useFuelText | null | "大量/90%" | wikiwiki 有 kcwiki 无 |
| 29 | useBullText | null | "普通/40%" | wikiwiki 有 kcwiki 无 |
| 29 | rawComposition | null | "最低3隻。潜3隻必要／「潜×3」" | wikiwiki 有 kcwiki 无 |
| 30 | nameZh | "潜水艇派遣作战" | null | kcwiki 有 wikiwiki 无 |
| 30 | difficulty | null | "S" | wikiwiki 有 kcwiki 无 |
| 30 | descriptionJp | null | "潜水艦4隻以上の艦隊を編成し、遠方友軍勢力との連絡を試みよ！" | wikiwiki 有 kcwiki 无 |
| 30 | useFuelText | null | "大量/90%" | wikiwiki 有 kcwiki 无 |
| 30 | useBullText | null | "大量/70%" | wikiwiki 有 kcwiki 无 |
| 30 | rawComposition | null | "最低4隻。潜4隻必要／「潜×4」" | wikiwiki 有 kcwiki 无 |
| 31 | nameZh | "和海外舰的接触" | null | kcwiki 有 wikiwiki 无 |
| 31 | difficulty | null | "S" | wikiwiki 有 kcwiki 无 |
| 31 | descriptionJp | null | "潜水艦4隻以上の艦隊を派遣し、海外艦との邂逅を試みよ！" | wikiwiki 有 kcwiki 无 |
| 31 | useFuelText | null | "普通/50%" | wikiwiki 有 kcwiki 无 |
| 31 | useBullText | null | "なし" | wikiwiki 有 kcwiki 无 |
| 31 | rawComposition | null | "最低4隻。潜4隻必要／「潜×4」" | wikiwiki 有 kcwiki 无 |
| 32 | nameZh | "远洋练习航海" | null | kcwiki 有 wikiwiki 无 |
| 32 | greatNote | "大成功要旗舰33级以上+5闪或旗舰128级以上+4闪(待验证)" | "旗艦Lv33以上かつキラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定？" | 两者值不同 |
| 32 | difficulty | null | "D" | wikiwiki 有 kcwiki 无 |
| 32 | descriptionJp | null | "練習巡洋艦を旗艦で遠洋練習航海を実施、基礎練度向上に努めよ！" | wikiwiki 有 kcwiki 无 |
| 32 | useFuelText | null | "大量/90%" | wikiwiki 有 kcwiki 无 |
| 32 | useBullText | null | "少量/30%" | wikiwiki 有 kcwiki 无 |
| 32 | rawComposition | null | "最低3隻。練巡(旗艦固定)1隻、駆2隻必要／「練巡×1，駆×2」 旗艦Lv33以上かつキラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定？。詳細はこちらを参照。" | wikiwiki 有 kcwiki 无 |
| 33 | nameZh | "前线部队支援任务" | null | kcwiki 有 wikiwiki 无 |
| 33 | escortText | "0" | null | kcwiki 有 wikiwiki 无 |
| 33 | difficulty | null | "E" | wikiwiki 有 kcwiki 无 |
| 33 | descriptionJp | null | "南方海域へ支援艦隊を出撃させ、主力艦隊の進撃を援護せよ！" | wikiwiki 有 kcwiki 无 |
| 33 | useFuelText | null | "普通/50%" | wikiwiki 有 kcwiki 无 |
| 33 | useBullText | null | "普通/40% or 大量/80%" | wikiwiki 有 kcwiki 无 |
| 33 | rawComposition | null | "最低2隻。駆2隻必要／「駆×2」" | wikiwiki 有 kcwiki 无 |
| 34 | nameZh | "舰队决战支援任务" | null | kcwiki 有 wikiwiki 无 |
| 34 | escortText | "0" | null | kcwiki 有 wikiwiki 无 |
| 34 | difficulty | null | "E" | wikiwiki 有 kcwiki 无 |
| 34 | descriptionJp | null | "南方海域へ決戦支援を行う別働隊を展開し、主力艦隊を援護せよ！" | wikiwiki 有 kcwiki 无 |
| 34 | useFuelText | null | "普通/50%" | wikiwiki 有 kcwiki 无 |
| 34 | useBullText | null | "普通/40% or 大量/80%" | wikiwiki 有 kcwiki 无 |
| 34 | rawComposition | null | "最低2隻。駆2隻必要／「駆×2」" | wikiwiki 有 kcwiki 无 |
| 35 | nameZh | "MO作战" | null | kcwiki 有 wikiwiki 无 |
| 35 | difficulty | null | "S" | wikiwiki 有 kcwiki 无 |
| 35 | descriptionJp | null | "空母2隻を含むMO機動部隊を投入し、南方海域制海権を確保せよ！" | wikiwiki 有 kcwiki 无 |
| 35 | useFuelText | null | "大量/80%" | wikiwiki 有 kcwiki 无 |
| 35 | useBullText | null | "大量/80%" | wikiwiki 有 kcwiki 无 |
| 35 | rawComposition | null | "全6隻。空母(水母,護母可)2隻、重1隻、駆1隻、他2隻必要／「空母×2,重×1,駆×3」" | wikiwiki 有 kcwiki 无 |
| 36 | nameZh | "水上飞机基地建设" | null | kcwiki 有 wikiwiki 无 |
| 36 | difficulty | null | "S" | wikiwiki 有 kcwiki 无 |
| 36 | descriptionJp | null | "水上機母艦2隻を南方に展開し、哨戒用の水上機基地を建設せよ！" | wikiwiki 有 kcwiki 无 |
| 36 | useFuelText | null | "大量/80%" | wikiwiki 有 kcwiki 无 |
| 36 | useBullText | null | "大量/80%" | wikiwiki 有 kcwiki 无 |
| 36 | rawComposition | null | "全6隻。水母2隻、軽1隻、駆1隻、他2隻必要／「水母×2,軽×1,駆×3」" | wikiwiki 有 kcwiki 无 |
| 37 | nameZh | "东京急行" | null | kcwiki 有 wikiwiki 无 |
| 37 | escortText | "至少3个舰娘\n携带4个桶以上" | null | kcwiki 有 wikiwiki 无 |
| 37 | greatNote | "大成功要5桶以上+4闪" | "合計5個以上かつキラキラ艦4隻以上で大成功確定" | 两者值不同 |
| 37 | difficulty | null | "S" | wikiwiki 有 kcwiki 无 |
| 37 | descriptionJp | null | "水雷戦隊に輸送ドラム缶を満載、南方への鼠輸送作戦を遂行せよ！" | wikiwiki 有 kcwiki 无 |
| 37 | useFuelText | null | "大量/80%" | wikiwiki 有 kcwiki 无 |
| 37 | useBullText | null | "大量/80%" | wikiwiki 有 kcwiki 无 |
| 37 | rawComposition | null | "全6隻。軽1隻、駆5隻必要／「軽×1,駆×5,任意の3隻にドラム缶を合計4つ」 3隻以上にドラム缶(輸送用)が合計4個以上必要。合計5個以上かつキラキラ艦4隻以上で大成功確定。詳細はこちらを参照。" | wikiwiki 有 kcwiki 无 |
| 38 | nameZh | "东京急行(二)" | null | kcwiki 有 wikiwiki 无 |
| 38 | escortText | "至少4个舰娘携带8个桶以上" | null | kcwiki 有 wikiwiki 无 |
| 38 | greatNote | "大成功要10桶以上+4闪" | "合計10個以上かつキラキラ艦4隻以上で大成功確定" | 两者值不同 |
| 38 | difficulty | null | "S" | wikiwiki 有 kcwiki 无 |
| 38 | descriptionJp | null | "可能な限り輸送ドラム缶を満載、南方への鼠輸送作戦を続行せよ！" | wikiwiki 有 kcwiki 无 |
| 38 | useFuelText | null | "大量/80%" | wikiwiki 有 kcwiki 无 |
| 38 | useBullText | null | "大量/80%" | wikiwiki 有 kcwiki 无 |
| 38 | rawComposition | null | "全6隻。駆5隻、他1隻必要／「駆×6,任意の4隻にドラム缶を合計8つ」 4隻以上にドラム缶(輸送用)が合計8個以上必要。合計10個以上かつキラキラ艦4隻以上で大成功確定。詳細はこちらを参照。" | wikiwiki 有 kcwiki 无 |
| 39 | nameZh | "远洋潜水艇作战" | null | kcwiki 有 wikiwiki 无 |
| 39 | difficulty | null | "S" | wikiwiki 有 kcwiki 无 |
| 39 | descriptionJp | null | "潜水母艦と潜水艦群による遠洋作戦を実施、敵勢力漸減に努めよ！" | wikiwiki 有 kcwiki 无 |
| 39 | useFuelText | null | "大量/90%" | wikiwiki 有 kcwiki 无 |
| 39 | useBullText | null | "大量/90%" | wikiwiki 有 kcwiki 无 |
| 39 | rawComposition | null | "最低5隻。潜水母艦(潜水空母ではない。迅鯨型、平安丸、改造前の大鯨を指す)1隻、潜4隻必要／「潜母艦×1,潜×4」" | wikiwiki 有 kcwiki 无 |
| 40 | nameZh | "水上机前线运输" | null | kcwiki 有 wikiwiki 无 |
| 40 | greatNote | "大成功要4桶以上+4闪" | "合計4個以上かつキラキラ艦4隻以上で大成功確定" | 两者值不同 |
| 40 | difficulty | null | "S" | wikiwiki 有 kcwiki 无 |
| 40 | descriptionJp | null | "軽巡旗艦と複数の水上機母艦で、水上機の前線輸送を実施せよ！" | wikiwiki 有 kcwiki 无 |
| 40 | useFuelText | null | "大量/80%" | wikiwiki 有 kcwiki 无 |
| 40 | useBullText | null | "大量/70%" | wikiwiki 有 kcwiki 无 |
| 40 | rawComposition | null | "全6隻。軽(旗艦固定)1隻、水母2隻、駆2隻、他1隻必要 ／「軽×1,水母×2,駆×3」 ドラム缶(輸送用)が合計4個以上かつキラキラ艦4隻以上で大成功確定。詳細はこちらを参照。" | wikiwiki 有 kcwiki 无 |
| 41 | nameZh | "文莱泊地海湾警戒" | null | kcwiki 有 wikiwiki 无 |
| 41 | escortText | "总火力≥60\n对潜≥210\n对空≥80" | null | kcwiki 有 wikiwiki 无 |
| 41 | greatNote | "大成功要旗舰33级以上+5闪或旗舰128级以上+4闪" | "旗艦Lv33以上かつキラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定" | 两者值不同 |
| 41 | difficulty | null | "A" | wikiwiki 有 kcwiki 无 |
| 41 | descriptionJp | null | "海防艦や駆逐艦による哨戒艦隊でブルネイ泊地沖対潜警戒を実施、同泊地周辺海域の安全を図れ！" | wikiwiki 有 kcwiki 无 |
| 41 | useFuelText | null | "普通/50%" | wikiwiki 有 kcwiki 无 |
| 41 | useBullText | null | "普通/50%" | wikiwiki 有 kcwiki 无 |
| 41 | rawComposition | null | "最低3隻。(駆+海防)3隻必要。／「駆×3」 艦隊の合計値で、火力60 / 対空80 / 対潜210 以上必要(装備込み。但し艦載機には補正が掛かる。詳細はこちらを参照。) 旗艦Lv33以上かつキラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定。詳細はこちらを参照。" | wikiwiki 有 kcwiki 无 |
| 42 | nameJp | "ミ船団護衛(一号船団)" | "ミ船団護衛(一号船団) (マンスリー)" | 两者值不同 |
| 42 | nameZh | "MI船团护卫（一号船团）" | null | kcwiki 有 wikiwiki 无 |
| 42 | difficulty | null | "S" | wikiwiki 有 kcwiki 无 |
| 42 | descriptionJp | null | "油田地帯から本土への輸送船団の護衛を行う。護衛空母と海防艦や軽巡級と駆逐艦等の対潜哨戒能力の高い部隊を編成、船団護衛を遂行せよ！【月一回実施可能遠征】" | wikiwiki 有 kcwiki 无 |
| 42 | useFuelText | null | "普通/80%" | wikiwiki 有 kcwiki 无 |
| 42 | useBullText | null | "普通/65%" | wikiwiki 有 kcwiki 无 |
| 42 | rawComposition | null | "最低4隻。軽1隻、駆2隻、他1隻必要。／「軽×1,駆×3」 (駆1海防3)(軽1海防2他1)(護母1駆2他1)(護母1海防2他1)(練巡1海防2他1)の編成でも成功する。詳しくは上記参照。" | wikiwiki 有 kcwiki 无 |
| 43 | nameJp | "ミ船団護衛(二号船団)" | "ミ船団護衛(二号船団) (マンスリー・交戦I型)" | 两者值不同 |
| 43 | nameZh | "MI船团护卫（二号船团）" | null | kcwiki 有 wikiwiki 无 |
| 43 | escortText | "总火力≥500\n对潜≥280\n对空≥280\n索敌≥170" | null | kcwiki 有 wikiwiki 无 |
| 43 | greatNote | "大成功要5闪或旗舰128级以上+4闪" | "キラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定" | 两者值不同 |
| 43 | difficulty | null | "S+" | wikiwiki 有 kcwiki 无 |
| 43 | descriptionJp | null | "大規模ミ船団の護衛作戦を行う。敵通商破壊部隊との会敵が予想される。護衛空母(または軽空母)を旗艦とする海上護衛部隊、出撃！【月一回実施可能・交戦遠征】" | wikiwiki 有 kcwiki 无 |
| 43 | useFuelText | null | "普通/85%" | wikiwiki 有 kcwiki 无 |
| 43 | useBullText | null | "普通/90%" | wikiwiki 有 kcwiki 无 |
| 43 | rawComposition | null | "全6隻。護衛空母(旗艦固定)1隻、(駆2隻or海防2隻 駆逐と海防1隻ずつでは不可)、他3隻 または 軽空母(旗艦固定)1隻、軽1隻、駆4隻必要 艦隊の合計値で、火力500 / 対空280 / 対潜280 / 索敵170 以上必要(装備込み。但し艦載機には補正が掛かる。詳細はこちらを参照。) (軽母(旗艦)1駆1海防3他1)(軽母(旗艦)1軽巡1海防2他2)(軽母(旗艦)1練巡1海防2他2)(軽母(旗艦)1護母1駆2他2)(軽母(旗艦)1護母1海防2他2)の編成でも成功する。詳しくは上記参照。 キラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定。詳細はこちらを参照。" | wikiwiki 有 kcwiki 无 |
| 44 | nameJp | "航空装備輸送任務" | "航空装備輸送任務 (マンスリー)" | 两者值不同 |
| 44 | nameZh | "航空装备输送任务" | null | kcwiki 有 wikiwiki 无 |
| 44 | escortText | "对潜≥200\n对空≥200\n索敌≥150\n至少3个舰娘\n各携带2个桶合计6个以上" | null | kcwiki 有 wikiwiki 无 |
| 44 | greatNote | "大成功要8桶以上+4闪" | "合計8個以上かつキラキラ艦4隻以上で大成功確定" | 两者值不同 |
| 44 | difficulty | null | "S" | wikiwiki 有 kcwiki 无 |
| 44 | descriptionJp | null | "航空母艦2及び水上機母艦1を投入して、南西海域拠点への航空装備輸送作戦を実施せよ！可能な限り輸送用ドラム缶も積載されたし！【月一回実施可能遠征】" | wikiwiki 有 kcwiki 无 |
| 44 | useFuelText | null | "普通/80%" | wikiwiki 有 kcwiki 无 |
| 44 | useBullText | null | "普通/40%" | wikiwiki 有 kcwiki 无 |
| 44 | rawComposition | null | "「A4 南西方面連絡線哨戒」をクリアすると出現 全6隻。空母(水母,護母可)1隻、水母1隻、軽1隻、(駆+海防)2隻、他1隻必要(要検証)／「水母×2,軽×1,駆×3,任意の3隻にドラム缶各2つで合計6つ」 艦隊の合計値で、対空200 / 対潜200 / 索敵150 以上必要(装備込み。但し艦載機には補正が掛かる。詳細はこちらを参照。) 3隻以上にドラム缶(輸送用)が合計6個以上必要。合計8個以上かつキラキラ艦4隻以上で大成功確定。詳細はこちらを参照。" | wikiwiki 有 kcwiki 无 |
| 45 | nameZh | "铝土船团护卫" | null | kcwiki 有 wikiwiki 无 |
| 45 | escortText | "舰队合计对空≥240\n对潜≥300\n索敌≥180\n（数值包含装备，舰载机对空对潜数值不计算在内飞机补正值不计算在内）" | null | kcwiki 有 wikiwiki 无 |
| 45 | greatNote | "大成功要5闪或旗舰128级以上+4闪" | "キラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定" | 两者值不同 |
| 45 | difficulty | null | "S" | wikiwiki 有 kcwiki 无 |
| 45 | descriptionJp | null | "海上護衛総隊によるボーキサイト輸送船団の護衛を実施する。護衛空母(または軽空母)を旗艦とする海上護衛部隊、抜錨せよ！" | wikiwiki 有 kcwiki 无 |
| 45 | useFuelText | null | "普通/60%" | wikiwiki 有 kcwiki 无 |
| 45 | useBullText | null | "普通/40%" | wikiwiki 有 kcwiki 无 |
| 45 | rawComposition | null | "最低5隻。護衛空母または軽空母(旗艦固定)1隻、(駆+海防)4隻必要 ／「護母×1,駆×4」 艦隊の合計値で、対空240 / 対潜300 / 索敵180 以上必要(装備込み。但し艦載機には補正が掛かる。詳細はこちらを参照。) キラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定。詳細はこちらを参照。" | wikiwiki 有 kcwiki 无 |
| 46 | tags | ["月常","交战II型"] | ["月常","交战型"] | 两者值不同 |
| 46 | nameJp | "南西海域戦闘哨戒" | "南西海域戦闘哨戒 (マンスリー・交戦II型)" | 两者值不同 |
| 46 | nameZh | "南西海域战斗警戒" | null | kcwiki 有 wikiwiki 无 |
| 46 | escortText | "舰队合计火力≥350\n对空≥250\n对潜≥220\n索敌≥190\n（数值包含装备，舰载机对空对潜数值不计算在内飞机补正值不计算在内）" | null | kcwiki 有 wikiwiki 无 |
| 46 | greatNote | "大成功要5闪或旗舰128级以上+4闪" | "キラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定" | 两者值不同 |
| 46 | difficulty | null | "S+" | wikiwiki 有 kcwiki 无 |
| 46 | descriptionJp | null | "精強な重巡戦隊と水雷戦隊を中核とした有力なる艦隊で、南西海域深部を哨戒、敵艦隊を捜索！発見次第、これを撃滅せよ！【月一回実施可能・交戦遠征】" | wikiwiki 有 kcwiki 无 |
| 46 | useFuelText | null | "普通/75%" | wikiwiki 有 kcwiki 无 |
| 46 | useBullText | null | "普通/95%" | wikiwiki 有 kcwiki 无 |
| 46 | rawComposition | null | "最低5隻。重2隻、軽1隻、駆2隻必要 ／「重×2,軽×1,駆×2」 艦隊の合計値で、火力350 / 対空250 / 対潜220 / 索敵190 以上必要(装備込み。但し艦載機には補正が掛かる。詳細はこちらを参照。) キラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定。詳細はこちらを参照。" | wikiwiki 有 kcwiki 无 |
| A1 | nameZh | "兵站强化任务" | null | kcwiki 有 wikiwiki 无 |
| A1 | difficulty | null | "D" | wikiwiki 有 kcwiki 无 |
| A1 | descriptionJp | null | "港湾施設強化と兵站備蓄施設拡充に協力し、補給体制を強化せよ！" | wikiwiki 有 kcwiki 无 |
| A1 | useFuelText | null | "普通/40%" | wikiwiki 有 kcwiki 无 |
| A1 | useBullText | null | "なし" | wikiwiki 有 kcwiki 无 |
| A1 | rawComposition | null | "最低4隻。(駆+海防)3隻、他1隻必要。／「駆×4」" | wikiwiki 有 kcwiki 无 |
| A2 | nameZh | "海峡警备任务" | null | kcwiki 有 wikiwiki 无 |
| A2 | escortText | "总火力≥50\n总对空≥70\n总对潜≥180\n*含装备属性，但水侦，水爆，大艇的反潜值无效" | null | kcwiki 有 wikiwiki 无 |
| A2 | greatNote | "大成功要旗舰33级以上+5闪或旗舰128级以上+4闪" | "旗艦Lv33以上かつキラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定" | 两者值不同 |
| A2 | difficulty | null | "C" | wikiwiki 有 kcwiki 无 |
| A2 | descriptionJp | null | "海防艦や駆逐艦による、沿岸警備部隊で、海峡警備を実施しよう！" | wikiwiki 有 kcwiki 无 |
| A2 | useFuelText | null | "普通/50%" | wikiwiki 有 kcwiki 无 |
| A2 | useBullText | null | "少量/20%" | wikiwiki 有 kcwiki 无 |
| A2 | rawComposition | null | "最低4隻。(駆+海防)4隻必要。／「駆×4」 艦隊の合計値で、火力50 / 対空70 / 対潜180 以上必要(装備込み。但し艦載機には補正が掛かる。詳細はこちらを参照。) 旗艦Lv33以上かつキラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定。詳細はこちらを参照。" | wikiwiki 有 kcwiki 无 |
| A3 | nameZh | "长时间对潜警戒" | null | kcwiki 有 wikiwiki 无 |
| A3 | escortText | "总对潜≥280\n总索敌≥60" | null | kcwiki 有 wikiwiki 无 |
| A3 | greatNote | "大成功要5闪或旗舰128级以上+4闪" | "キラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定" | 两者值不同 |
| A3 | difficulty | null | "B" | wikiwiki 有 kcwiki 无 |
| A3 | descriptionJp | null | "高練度の対潜部隊を展開、敵潜を制圧し、航路の安全を確保せよ！" | wikiwiki 有 kcwiki 无 |
| A3 | useFuelText | null | "普通/60%" | wikiwiki 有 kcwiki 无 |
| A3 | useBullText | null | "普通/30%" | wikiwiki 有 kcwiki 无 |
| A3 | rawComposition | null | "最低5隻。軽1隻、(駆+海防)3隻、他1隻必要。／「軽×1,駆×4」 艦隊の合計値で、 対潜280 / 索敵60 以上必要(装備込み。但し艦載機には補正が掛かる。詳細はこちらを参照。) (駆1海防3他1)(護母1駆2他2)(護母1海防2他2)(練巡1海防2他2)(軽1海防2他2)の編成でも成功する。詳しくは上記参照。 キラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定。詳細はこちらを参照。" | wikiwiki 有 kcwiki 无 |
| A4 | nameJp | "南西方面連絡線哨戒" | "南西方面連絡線哨戒 (マンスリー)" | 两者值不同 |
| A4 | nameZh | "南西方面联络线哨戒" | null | kcwiki 有 wikiwiki 无 |
| A4 | escortText | "总火力值≥300\n总对潜≥200\n总对空≥200\n索敌≥120\n含装备但不计算加成" | null | kcwiki 有 wikiwiki 无 |
| A4 | greatNote | "大成功要5闪或旗舰128级以上+4闪" | "キラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定" | 两者值不同 |
| A4 | difficulty | null | "S" | wikiwiki 有 kcwiki 无 |
| A4 | descriptionJp | null | "油田地帯航路の安全を確保する。対潜哨戒能力の高い海上護衛部隊を編成、南西方面連絡線に展開、同方面の対潜哨戒を実施せよ!【月一回実施可能遠征】" | wikiwiki 有 kcwiki 无 |
| A4 | useFuelText | null | "普通/75%" | wikiwiki 有 kcwiki 无 |
| A4 | useBullText | null | "普通/60%" | wikiwiki 有 kcwiki 无 |
| A4 | rawComposition | null | "最低5隻。軽1隻、駆2隻、他2隻必要。／「軽×1,駆×4」 艦隊の合計値で、火力300 / 対空200 / 対潜200 / 索敵120 以上必要(装備込み。但し艦載機には補正が掛かる。詳細はこちらを参照。) (駆1海防3他1)(護母1駆2他2)(護母1海防2他2)(練巡1海防2他2)(軽1海防2他2)の編成でも成功する。詳しくは上記参照。 キラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定。詳細はこちらを参照。" | wikiwiki 有 kcwiki 无 |
| A5 | tags | ["月常 交战型"] | ["月常","交战型"] | 两者值不同 |
| A5 | nameJp | "小笠原沖哨戒線" | "小笠原沖哨戒線 (マンスリー・交戦I型)" | 两者值不同 |
| A5 | nameZh | "小笠原群岛哨戒线" | null | kcwiki 有 wikiwiki 无 |
| A5 | escortText | "总火力值280\n总对潜240\n总对空220\n总索敌150\n含装备" | null | kcwiki 有 wikiwiki 无 |
| A5 | greatNote | "大成功要5闪或旗舰128级以上+4闪" | "キラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定" | 两者值不同 |
| A5 | difficulty | null | "S" | wikiwiki 有 kcwiki 无 |
| A5 | descriptionJp | null | "本土の守りの要、小笠原沖哨戒線に精強な哨戒小艦隊を展開する。敵遠征部隊との交戦に備え、練度装備の充実した戦隊を投入せよ！【月一回実施可能・交戦遠征】" | wikiwiki 有 kcwiki 无 |
| A5 | useFuelText | null | "普通/80%" | wikiwiki 有 kcwiki 无 |
| A5 | useBullText | null | "普通/75%" | wikiwiki 有 kcwiki 无 |
| A5 | rawComposition | null | "「A4 南西方面連絡線哨戒」及び「B3 南西諸島離島哨戒作戦」をクリアすると出現 最低5隻。軽1隻、駆3隻、他1隻必要。／「軽×1,駆×4」 艦隊の合計値で、火力280 / 対空220 / 対潜240 / 索敵150 以上必要(装備込み。但し艦載機には補正が掛かる。詳細はこちらを参照。) (駆1海防3他1)(護母1駆2他2)(護母1海防2他2)(練巡1海防2他2)(軽1海防2他2)の編成でも成功する。詳しくは上記参照。 キラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定。詳細はこちらを参照。" | wikiwiki 有 kcwiki 无 |
| A6 | tags | ["月常 交战II型"] | ["月常","交战型"] | 两者值不同 |
| A6 | nameJp | "小笠原沖戦闘哨戒" | "小笠原沖戦闘哨戒 (マンスリー・交戦II型)" | 两者值不同 |
| A6 | nameZh | "小笠原群岛战斗哨戒" | null | kcwiki 有 wikiwiki 无 |
| A6 | escortText | "总火力值≥330\n总对潜≥270\n总对空≥300\n总索敌≥180\n含装备" | null | kcwiki 有 wikiwiki 无 |
| A6 | greatNote | "大成功要5闪或旗舰128级以上+4闪" | "キラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定" | 两者值不同 |
| A6 | difficulty | null | "S" | wikiwiki 有 kcwiki 无 |
| A6 | descriptionJp | null | "小笠原沖方面への敵部隊の接近を確認した！同方面防衛のため、最精鋭の哨戒艦隊を編成、同方面の戦闘哨戒を実施、敵を撃破せよ！【月一回実施可能・交戦遠征】" | wikiwiki 有 kcwiki 无 |
| A6 | useFuelText | null | "普通/90%" | wikiwiki 有 kcwiki 无 |
| A6 | useBullText | null | "普通/95%" | wikiwiki 有 kcwiki 无 |
| A6 | rawComposition | null | "「A5 小笠原沖哨戒線」及び「B4 南西諸島離島防衛作戦」をクリアすると出現 全6隻。軽1隻、駆3隻、他2隻必要。／「軽×1,駆×5」 艦隊の合計値で、火力330 / 対空300 / 対潜270 / 索敵180 以上必要(装備込み。但し艦載機には補正が掛かる。詳細はこちらを参照。) (駆1海防3他2)(護母1駆2他3)(護母1海防2他3)(練巡1海防2他3)(軽1海防2他3)の編成でも成功する。詳しくは上記参照。 キラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定。詳細はこちらを参照。" | wikiwiki 有 kcwiki 无 |
| B1 | nameZh | "南西方面航空侦察作战" | null | kcwiki 有 wikiwiki 无 |
| B1 | escortText | "总对空≥200\n总对潜≥200\n总索敌≥140" | null | kcwiki 有 wikiwiki 无 |
| B1 | difficulty | null | "B" | wikiwiki 有 kcwiki 无 |
| B1 | descriptionJp | null | "索敵力の高い水上機母艦及び軽巡を伴う艦隊で敵情勢を偵察せよ！" | wikiwiki 有 kcwiki 无 |
| B1 | useFuelText | null | "普通/45%" | wikiwiki 有 kcwiki 无 |
| B1 | useBullText | null | "少量/15%" | wikiwiki 有 kcwiki 无 |
| B1 | rawComposition | null | "全6隻。水母1隻、軽1隻、(駆+海防)2隻、他2隻必要／「水母×1,軽×1,駆×4」 艦隊の合計値で、対空200 / 対潜200 / 索敵140 以上必要(装備込み。但し艦載機には補正が掛かる。詳細はこちらを参照。）" | wikiwiki 有 kcwiki 无 |
| B2 | nameJp | "敵泊地強襲反撃作戦" | "敵泊地強襲反撃作戦 (マンスリー)" | 两者值不同 |
| B2 | nameZh | "敌方泊地强袭反击作战" | null | kcwiki 有 wikiwiki 无 |
| B2 | escortText | "总火力≥360\n对空≥160\n对潜≥160\n索敌≥140" | null | kcwiki 有 wikiwiki 无 |
| B2 | difficulty | null | "B" | wikiwiki 有 kcwiki 无 |
| B2 | descriptionJp | null | "重巡1軽巡1と精強駆逐隊による最精鋭艦隊で敵泊地を強襲せよ！【月一回実施可能遠征】" | wikiwiki 有 kcwiki 无 |
| B2 | useFuelText | null | "大量/80%" | wikiwiki 有 kcwiki 无 |
| B2 | useBullText | null | "普通/65%" | wikiwiki 有 kcwiki 无 |
| B2 | rawComposition | null | "全6隻。重1隻、軽1隻、駆3隻、他1隻必要。／「重×1,軽×1,駆×4」 艦隊の合計値で、火力360 / 対空160 / 対潜160 / 索敵140 以上必要(装備込み。但し艦載機には補正が掛かる。詳細はこちらを参照。)" | wikiwiki 有 kcwiki 无 |
| B3 | nameJp | "南西諸島離島哨戒作戦" | "南西諸島離島哨戒作戦 (マンスリー)" | 两者值不同 |
| B3 | nameZh | "南西诸岛离岛哨戒作战" | null | kcwiki 有 wikiwiki 无 |
| B3 | escortText | "总火力≥400\n对潜≥220\n对空≥220\n索敌≥190" | null | kcwiki 有 wikiwiki 无 |
| B3 | greatNote | "大成功要5闪或旗舰128级以上+4闪" | "キラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定" | 两者值不同 |
| B3 | difficulty | null | "S" | wikiwiki 有 kcwiki 无 |
| B3 | descriptionJp | null | "水上機母艦と護衛水雷戦隊による哨戒部隊を編成、南西諸島海域の哨戒作戦を実施せよ！【月一回実施可能遠征】" | wikiwiki 有 kcwiki 无 |
| B3 | useFuelText | null | "普通/65%" | wikiwiki 有 kcwiki 无 |
| B3 | useBullText | null | "普通/80%" | wikiwiki 有 kcwiki 无 |
| B3 | rawComposition | null | "全6隻。水母1隻、軽1隻、(駆+海防)4隻必要。／「水母×1,軽×1,駆×4」 艦隊の合計値で、火力400 / 対空220 / 対潜220 / 索敵190 以上必要(装備込み。但し艦載機には補正が掛かる。詳細はこちらを参照。) キラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定。詳細はこちらを参照。" | wikiwiki 有 kcwiki 无 |
| B4 | tags | ["月常 交战型"] | ["月常","交战型"] | 两者值不同 |
| B4 | nameJp | "南西諸島離島防衛作戦" | "南西諸島離島防衛作戦 (マンスリー・交戦I型)" | 两者值不同 |
| B4 | nameZh | "南西诸岛离岛防御作战" | null | kcwiki 有 wikiwiki 无 |
| B4 | escortText | "总火力(含改修)≥500\n总对潜≥280(水上机对潜可能不计)\n对空≥280\n索敌≥170" | null | kcwiki 有 wikiwiki 无 |
| B4 | greatNote | "大成功要5闪或旗舰128级以上+4闪" | "キラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定" | 两者值不同 |
| B4 | difficulty | null | "S+" | wikiwiki 有 kcwiki 无 |
| B4 | descriptionJp | null | "重巡2軽巡1駆逐艦2、さらに潜水艦1隻を含む、精強な遊撃部隊を編成。同遊撃部隊による南西諸島海域防衛作戦を実施せよ！【月一回実施可能遠征】※交戦遠征" | wikiwiki 有 kcwiki 无 |
| B4 | useFuelText | null | "普通/85%" | wikiwiki 有 kcwiki 无 |
| B4 | useBullText | null | "普通/85%" | wikiwiki 有 kcwiki 无 |
| B4 | rawComposition | null | "全6隻。重2隻、軽1隻、駆2隻、潜1隻必要。／「重×2,軽×1,駆×2,潜×1」 艦隊の合計値で、火力500 / 対空280 / 対潜280 / 索敵170 以上必要(装備込み。但し艦載機には補正が掛かる。詳細はこちらを参照。) キラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定。詳細はこちらを参照。" | wikiwiki 有 kcwiki 无 |
| B5 | tags | ["月常 交战II型"] | ["月常","交战型"] | 两者值不同 |
| B5 | nameJp | "南西諸島捜索撃滅戦" | "南西諸島捜索撃滅戦 (マンスリー・交戦II型)" | 两者值不同 |
| B5 | nameZh | "南西诸岛搜索歼灭战" | null | kcwiki 有 wikiwiki 无 |
| B5 | escortText | "总火力≥510\n对空≥400\n对潜≥285\n索敌≥385" | null | kcwiki 有 wikiwiki 无 |
| B5 | greatNote | "大成功要5闪或旗舰128级以上+4闪" | "キラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定" | 两者值不同 |
| B5 | difficulty | null | "S+" | wikiwiki 有 kcwiki 无 |
| B5 | descriptionJp | null | "水上機母艦1軽巡1駆逐艦2を含む精鋭の捜索機動部隊を編成。南西諸島方面で索敵撃滅戦を展開、敵艦隊を捜索、これを撃破せよ！【月一回実施可能・交戦遠征】" | wikiwiki 有 kcwiki 无 |
| B5 | useFuelText | null | "普通/90%" | wikiwiki 有 kcwiki 无 |
| B5 | useBullText | null | "普通/95%" | wikiwiki 有 kcwiki 无 |
| B5 | rawComposition | null | "全6隻。水母1隻、軽1隻、駆2隻、他2隻必要。／「水母×1,軽×1,駆×4」 艦隊の合計値で、火力510 / 対空400 / 対潜285 / 索敵385 以上必要(装備込み。但し艦載機には補正が掛かる。詳細はこちらを参照。) キラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定。詳細はこちらを参照。" | wikiwiki 有 kcwiki 无 |
| B6 | tags | ["月常 交战II型"] | ["月常","交战型"] | 两者值不同 |
| B6 | nameJp | "精鋭水雷戦隊夜襲" | "精鋭水雷戦隊夜襲 (マンスリー・交戦II型)" | 两者值不同 |
| B6 | nameZh | "精锐水雷战队夜袭战" | null | kcwiki 有 wikiwiki 无 |
| B6 | escortText | "总火力≥410\n对空≥390\n对潜≥410\n索敌≥340" | null | kcwiki 有 wikiwiki 无 |
| B6 | greatNote | "大成功要5闪或旗舰128级以上+4闪（待验证）" | "キラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定？" | 两者值不同 |
| B6 | difficulty | null | "S+" | wikiwiki 有 kcwiki 无 |
| B6 | descriptionJp | null | "精鋭無比の軽巡が率いる、軽巡1駆逐艦5からなる精強な水雷戦隊を編成、敵泊地への夜襲を敢行、敵艦隊を痛撃せよ！【月一回実施可能・交戦遠征】" | wikiwiki 有 kcwiki 无 |
| B6 | useFuelText | null | "普通/95%" | wikiwiki 有 kcwiki 无 |
| B6 | useBullText | null | "普通/95%" | wikiwiki 有 kcwiki 无 |
| B6 | rawComposition | null | "「A4 南西方面連絡線哨戒」及び「B4 南西諸島離島防衛作戦」をクリアすると出現 全6隻。軽(旗艦固定)1隻、駆5隻必要。／「軽×1,駆×5」 艦隊の合計値で、火力410 / 対空390 / 対潜410 / 索敵340 以上必要(装備込み。但し艦載機には補正が掛かる。詳細はこちらを参照。) キラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定？。詳細はこちらを参照。" | wikiwiki 有 kcwiki 无 |
| D1 | nameZh | "西方海域侦察作战" | null | kcwiki 有 wikiwiki 无 |
| D1 | escortText | "全舰队对潜≥240\n对空≥240\n索敌≥300\n（均为含装备数值）" | null | kcwiki 有 wikiwiki 无 |
| D1 | greatNote | null | "キラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定" | wikiwiki 有 kcwiki 无 |
| D1 | difficulty | null | "S" | wikiwiki 有 kcwiki 无 |
| D1 | descriptionJp | null | "索敵能力の高い水上機母艦を旗艦とする偵察艦隊を編成し、西方海域敵情勢の偵察を実施せよ！" | wikiwiki 有 kcwiki 无 |
| D1 | useFuelText | null | "大量/75%" | wikiwiki 有 kcwiki 无 |
| D1 | useBullText | null | "普通/50%" | wikiwiki 有 kcwiki 无 |
| D1 | rawComposition | null | "最低5隻。水母(旗艦固定)1隻、駆3隻 、他1隻必要(要検証) ／「水母×1,駆×4」 艦隊の合計値で、対空240 / 対潜240 / 索敵300 以上必要(装備込み。但し艦載機には補正が掛かる。詳細はこちらを参照。) キラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定。詳細はこちらを参照。" | wikiwiki 有 kcwiki 无 |
| D2 | tags | ["月常 交战型"] | ["月常","交战型"] | 两者值不同 |
| D2 | nameJp | "西方潜水艦作戦" | "西方潜水艦作戦 (マンスリー・交戦I型)" | 两者值不同 |
| D2 | nameZh | "西方潜水艇作战" | null | kcwiki 有 wikiwiki 无 |
| D2 | escortText | "总火力≥60\n对空≥80\n对潜≥50\n（计算装备数值）" | null | kcwiki 有 wikiwiki 无 |
| D2 | greatNote | null | "キラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定" | wikiwiki 有 kcwiki 无 |
| D2 | difficulty | null | "S" | wikiwiki 有 kcwiki 无 |
| D2 | descriptionJp | null | "潜水母艦を旗艦として潜水艦3隻以上から構成される精強な潜水艦隊を編成、西方海域に進出、潜水艦作戦を実施せよ！【月一回実施可能・交戦遠征】" | wikiwiki 有 kcwiki 无 |
| D2 | useFuelText | null | "普通/90%" | wikiwiki 有 kcwiki 无 |
| D2 | useBullText | null | "普通/90%" | wikiwiki 有 kcwiki 无 |
| D2 | rawComposition | null | "最低5隻。潜水母艦(潜水空母ではない。迅鯨型、改氷川丸級、改造前の大鯨を指す)(旗艦固定)1隻、潜3隻、他1隻必要／「潜母艦×1,潜×3,駆×1」 艦隊の合計値で、火力60 / 対空80 / 対潜50 / 索敵70 以上必要(装備込み。但し艦載機には補正が掛かる。詳細はこちらを参照。) キラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定。詳細はこちらを参照。" | wikiwiki 有 kcwiki 无 |
| D3 | tags | ["月常 交战II型"] | ["月常","交战型"] | 两者值不同 |
| D3 | nameJp | "欧州方面友軍との接触" | "欧州方面友軍との接触 (マンスリー・交戦II型)" | 两者值不同 |
| D3 | nameZh | "与欧洲方面友军的接触" | null | kcwiki 有 wikiwiki 无 |
| D3 | escortText | "总火力≥115\n对空≥90\n对潜≥70\n索敌≥95\n（计算装备数值）" | null | kcwiki 有 wikiwiki 无 |
| D3 | greatNote | null | "キラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定？" | wikiwiki 有 kcwiki 无 |
| D3 | difficulty | null | "S+" | wikiwiki 有 kcwiki 无 |
| D3 | descriptionJp | null | "旗艦に潜水母艦、同随伴護衛艦艇と潜水艦3隻以上から構成される西方潜水艦隊で戦線を強行突破、欧州方面友軍艦隊と接触を図れ！【月一回実施可能・交戦遠征】" | wikiwiki 有 kcwiki 无 |
| D3 | useFuelText | null | "普通/90%" | wikiwiki 有 kcwiki 无 |
| D3 | useBullText | null | "普通/95%" | wikiwiki 有 kcwiki 无 |
| D3 | rawComposition | null | "最低5隻。潜水母艦(潜水空母ではない。迅鯨型、改氷川丸級、改造前の大鯨を指す)(旗艦固定)1隻、潜3隻、他1隻必要／「潜母艦×1,潜×3,駆×1」 艦隊の合計値で、火力115 / 対空90 / 対潜70 / 索敵95 以上必要(装備込み。但し艦載機には補正が掛かる。詳細はこちらを参照。) キラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定？。詳細はこちらを参照。" | wikiwiki 有 kcwiki 无 |
| E1 | tags | ["月常","交战II型","月常 交战II型"] | ["月常","交战型"] | 两者值不同 |
| E1 | nameJp | "ラバウル方面艦隊進出" | "ラバウル方面艦隊進出 (マンスリー・交戦II型)" | 两者值不同 |
| E1 | nameZh | "拉包尔方面舰队前进" | null | kcwiki 有 wikiwiki 无 |
| E1 | time | "7:30" | "07:30" | 两者值不同 |
| E1 | escortText | "总火力≥450\n对空≥350\n对潜≥330\n索敌≥250\n（均含装备，舰载机可能有数值调整）" | null | kcwiki 有 wikiwiki 无 |
| E1 | greatNote | "大成功要5闪或旗舰128级以上+4闪" | "キラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定" | 两者值不同 |
| E1 | difficulty | null | "S+" | wikiwiki 有 kcwiki 无 |
| E1 | descriptionJp | null | "重巡旗艦、軽巡1駆逐艦3を含む艦隊を南方海域の要衝、ラバウル方面に進出させる。同海域周辺は敵空襲も予想される。注意せよ！【月一回実施可能・交戦遠征】" | wikiwiki 有 kcwiki 无 |
| E1 | useFuelText | null | "普通/95%" | wikiwiki 有 kcwiki 无 |
| E1 | useBullText | null | "普通/85%" | wikiwiki 有 kcwiki 无 |
| E1 | rawComposition | null | "全6隻。重(旗艦固定)1隻、軽1隻、駆3隻、他1隻必要 ／「重×1,軽×1,駆×4」 艦隊の合計値で、火力450 / 対空350 / 対潜330 / 索敵250 以上必要(装備込み。但し艦載機には補正が掛かる。詳細はこちらを参照。) キラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定。詳細はこちらを参照。" | wikiwiki 有 kcwiki 无 |
| E2 | tags | ["月常","交战II型","月常 交战II型"] | ["月常","交战型"] | 两者值不同 |
| E2 | nameJp | "強行鼠輸送作戦" | "強行鼠輸送作戦 (マンスリー・交戦II型)" | 两者值不同 |
| E2 | nameZh | "强行鼠运输作战" | null | kcwiki 有 wikiwiki 无 |
| E2 | time | "3:05" | "03:05" | 两者值不同 |
| E2 | escortText | "总火力≥280\n对空≥240\n对潜≥200\n索敌≥160\n（均含装备，舰载机可能有数值调整）\n至少3个舰娘\n携带4个桶以上" | null | kcwiki 有 wikiwiki 无 |
| E2 | greatNote | "大成功要6桶以上+4闪" | "合計6個以上かつキラキラ艦4隻以上で大成功確定" | 两者值不同 |
| E2 | difficulty | null | "S+" | wikiwiki 有 kcwiki 无 |
| E2 | descriptionJp | null | "精鋭駆逐艦を連ねて輸送ドラム缶を満載し、南方への強行鼠輸送作戦を遂行せよ！敵の待ち伏せも予想される。戦闘準備も怠るな！【月一回実施可能・交戦遠征】" | wikiwiki 有 kcwiki 无 |
| E2 | useFuelText | null | "普通/90%" | wikiwiki 有 kcwiki 无 |
| E2 | useBullText | null | "普通/95%" | wikiwiki 有 kcwiki 无 |
| E2 | rawComposition | null | "最低5隻。駆5隻必要 ／「駆×5,任意の3隻にドラム缶を合計4つ」 艦隊の合計値で、火力280 / 対空240 / 対潜200 / 索敵160 以上必要(装備込み。但し艦載機には補正が掛かる。詳細はこちらを参照。) 3隻以上にドラム缶(輸送用)が合計4個以上必要。合計6個以上かつキラキラ艦4隻以上で大成功確定。詳細はこちらを参照。" | wikiwiki 有 kcwiki 无 |

## 63 项字段差异三分类全表

| 远征 | 字段 | kcwiki／新值 | wikiwiki／旧值 | 分类或说明 |
|---|---|---|---|---|
| 1 | nameZh | "练习航海" | null | kcwiki 有 wikiwiki 无 |
| 1 | difficulty | null | "E" | wikiwiki 有 kcwiki 无 |
| 1 | descriptionJp | null | "鎮守府近海を航海し、艦隊の練度を高めよう！" | wikiwiki 有 kcwiki 无 |
| 1 | useFuelText | null | "少量/30%" | wikiwiki 有 kcwiki 无 |
| 1 | useBullText | null | "なし" | wikiwiki 有 kcwiki 无 |
| 1 | rawComposition | null | "最低2隻。艦種自由／「駆×2」" | wikiwiki 有 kcwiki 无 |
| 2 | nameZh | "长距离练习航海" | null | kcwiki 有 wikiwiki 无 |
| 2 | rewards.items | [{"name":"高速修复材","count":1}] | [{"name":"高速修復材","count":1,"min":0}] | 两者值不同 |
| 2 | difficulty | null | "E" | wikiwiki 有 kcwiki 无 |
| 2 | descriptionJp | null | "外海まで足を延ばし、艦隊の練度を高めよう！" | wikiwiki 有 kcwiki 无 |
| 2 | useFuelText | null | "普通/50%" | wikiwiki 有 kcwiki 无 |
| 2 | useBullText | null | "なし" | wikiwiki 有 kcwiki 无 |
| 2 | rawComposition | null | "最低4隻。艦種自由／「駆×4」" | wikiwiki 有 kcwiki 无 |
| 3 | nameZh | "警备任务" | null | kcwiki 有 wikiwiki 无 |
| 3 | difficulty | null | "D" | wikiwiki 有 kcwiki 无 |
| 3 | descriptionJp | null | "鎮守府担当海域をパトロールして領海の安全を守ろう！" | wikiwiki 有 kcwiki 无 |
| 3 | useFuelText | null | "少量/30%" | wikiwiki 有 kcwiki 无 |
| 3 | useBullText | null | "少量/20%" | wikiwiki 有 kcwiki 无 |
| 3 | rawComposition | null | "最低3隻。艦種自由／「駆×3」" | wikiwiki 有 kcwiki 无 |
| 4 | nameZh | "对潜警戒任务" | null | kcwiki 有 wikiwiki 无 |
| 4 | composition | "轻巡*1 驱逐/海防*2" | "轻巡*1、驱逐/海防*2" | 两者值不同 |
| 4 | rewards.items | [{"name":"高速修复材","count":1}] | [{"name":"高速修復材","count":1,"min":0},{"name":"家具箱(小)","count":1,"min":0}] | 两者值不同 |
| 4 | rewards.greatItems | [{"name":"家具箱（小）","count":1}] | [] | 两者值不同 |
| 4 | difficulty | null | "D" | wikiwiki 有 kcwiki 无 |
| 4 | descriptionJp | null | "水雷戦隊を編成、領海内を索敵、対潜水警戒任務に就こう！" | wikiwiki 有 kcwiki 无 |
| 4 | useFuelText | null | "普通/50%" | wikiwiki 有 kcwiki 无 |
| 4 | useBullText | null | "なし" | wikiwiki 有 kcwiki 无 |
| 4 | rawComposition | null | "最低3隻。軽1隻、(駆+海防)2隻必要。／「軽×1,駆×2」 (駆1海防3)(護母1駆2)(護母1海防2)(練巡1海防2)の編成でも成功する。詳しくは上記参照。" | wikiwiki 有 kcwiki 无 |
| 5 | nameZh | "海上护卫任务" | null | kcwiki 有 wikiwiki 无 |
| 5 | composition | "轻巡*1 驱逐/海防*3" | "轻巡*1、驱逐/海防*2、其他*1" | 两者值不同 |
| 5 | difficulty | null | "C" | wikiwiki 有 kcwiki 无 |
| 5 | descriptionJp | null | "輸送船団の安全を図るために、船団に同行し、これを護衛しよう！" | wikiwiki 有 kcwiki 无 |
| 5 | useFuelText | null | "普通/50%" | wikiwiki 有 kcwiki 无 |
| 5 | useBullText | null | "なし" | wikiwiki 有 kcwiki 无 |
| 5 | rawComposition | null | "最低4隻。軽1隻、(駆+海防)2隻、他1隻必要。／「軽×1,駆×3」 (駆1海防3)(護母1駆2他1)(護母1海防2他1)(練巡1海防2他1)の編成でも成功する。詳しくは上記参照。" | wikiwiki 有 kcwiki 无 |
| 6 | nameZh | "防空射击演习" | null | kcwiki 有 wikiwiki 无 |
| 6 | rewards.items | [{"name":"家具箱（小）","count":1}] | [{"name":"家具箱(小)","count":1,"min":0}] | 两者值不同 |
| 6 | difficulty | null | "C" | wikiwiki 有 kcwiki 无 |
| 6 | descriptionJp | null | "敵艦載機襲来に備えて、対空射撃や回避運動の訓練をしよう！" | wikiwiki 有 kcwiki 无 |
| 6 | useFuelText | null | "少量/30%" | wikiwiki 有 kcwiki 无 |
| 6 | useBullText | null | "少量/20%" | wikiwiki 有 kcwiki 无 |
| 6 | rawComposition | null | "最低4隻。艦種自由／「駆×4」" | wikiwiki 有 kcwiki 无 |
| 7 | nameZh | "观舰式排演" | null | kcwiki 有 wikiwiki 无 |
| 7 | rewards.items | [{"name":"高速建造材","count":1}] | [{"name":"高速建造材","count":1,"min":0}] | 两者值不同 |
| 7 | difficulty | null | "C" | wikiwiki 有 kcwiki 无 |
| 7 | descriptionJp | null | "海の一大ページェント「観艦式」の予行航海を実施しよう！" | wikiwiki 有 kcwiki 无 |
| 7 | useFuelText | null | "普通/50%" | wikiwiki 有 kcwiki 无 |
| 7 | useBullText | null | "なし" | wikiwiki 有 kcwiki 无 |
| 7 | rawComposition | null | "全6隻。艦種自由／「駆×6」" | wikiwiki 有 kcwiki 无 |
| 8 | nameZh | "观舰式" | null | kcwiki 有 wikiwiki 无 |
| 8 | rewards.items | [{"name":"高速建造材","count":2}] | [{"name":"高速建造材","count":2,"min":0},{"name":"開発資材","count":1,"min":0}] | 两者值不同 |
| 8 | rewards.greatItems | [{"name":"开发资材","count":1}] | [] | 两者值不同 |
| 8 | difficulty | null | "B" | wikiwiki 有 kcwiki 无 |
| 8 | descriptionJp | null | "今こそ日頃の訓練の成果を見せるとき！「観艦式」を挙行しよう！" | wikiwiki 有 kcwiki 无 |
| 8 | useFuelText | null | "普通/50%" | wikiwiki 有 kcwiki 无 |
| 8 | useBullText | null | "少量/20%" | wikiwiki 有 kcwiki 无 |
| 8 | rawComposition | null | "全6隻。艦種自由／「駆×6」" | wikiwiki 有 kcwiki 无 |
| 9 | nameZh | "油轮护卫任务" | null | kcwiki 有 wikiwiki 无 |
| 9 | composition | "轻巡*1 驱逐/海防*2 其他*1" | "轻巡*1、驱逐/海防*2、其他*1" | 两者值不同 |
| 9 | rewards.items | [{"name":"家具箱（小）","count":1}] | [{"name":"高速修復材","count":2,"min":0},{"name":"家具箱(小)","count":1,"min":0}] | 两者值不同 |
| 9 | rewards.greatItems | [{"name":"高速修复材","count":2}] | [] | 两者值不同 |
| 9 | difficulty | null | "C" | wikiwiki 有 kcwiki 无 |
| 9 | descriptionJp | null | "油田地帯から燃料を満載して戻るタンカー船団を護衛しよう！" | wikiwiki 有 kcwiki 无 |
| 9 | useFuelText | null | "普通/50%" | wikiwiki 有 kcwiki 无 |
| 9 | useBullText | null | "なし" | wikiwiki 有 kcwiki 无 |
| 9 | rawComposition | null | "最低4隻。軽1隻、(駆+海防)2隻、他1隻必要。／「軽×1,駆×3」 (駆1海防3)(護母1駆2他1)(護母1海防2他1)(練巡1海防2他1)の編成でも成功する。詳しくは上記参照。" | wikiwiki 有 kcwiki 无 |
| 10 | nameZh | "强行侦察任务" | null | kcwiki 有 wikiwiki 无 |
| 10 | composition | "轻巡*2 其他*1" | "轻巡*2、其他*1" | 两者值不同 |
| 10 | rewards.items | [{"name":"高速修复材","count":1}] | [{"name":"高速修復材","count":1,"min":0},{"name":"高速建造材","count":1,"min":0}] | 两者值不同 |
| 10 | rewards.greatItems | [{"name":"高速建造材","count":1}] | [] | 两者值不同 |
| 10 | difficulty | null | "C" | wikiwiki 有 kcwiki 无 |
| 10 | descriptionJp | null | "水上偵察機搭載艦などを活用し、敵艦隊の動向を探れ！" | wikiwiki 有 kcwiki 无 |
| 10 | useFuelText | null | "少量/30%" | wikiwiki 有 kcwiki 无 |
| 10 | useBullText | null | "なし" | wikiwiki 有 kcwiki 无 |
| 10 | rawComposition | null | "最低3隻。軽2隻、他1隻必要／「軽×2,駆×1」" | wikiwiki 有 kcwiki 无 |
| 11 | nameZh | "铝土运送任务" | null | kcwiki 有 wikiwiki 无 |
| 11 | composition | "驱逐/海防*2 其他*2" | "驱逐/海防*2、其他*2" | 两者值不同 |
| 11 | rewards.items | [{"name":"家具箱（小）","count":1}] | [{"name":"高速修復材","count":1,"min":0},{"name":"家具箱(小)","count":1,"min":0}] | 两者值不同 |
| 11 | rewards.greatItems | [{"name":"高速修复材","count":1}] | [] | 两者值不同 |
| 11 | difficulty | null | "B" | wikiwiki 有 kcwiki 无 |
| 11 | descriptionJp | null | "資源集積地から、母港にボーキサイトを輸送しよう！" | wikiwiki 有 kcwiki 无 |
| 11 | useFuelText | null | "普通/50%" | wikiwiki 有 kcwiki 无 |
| 11 | useBullText | null | "なし" | wikiwiki 有 kcwiki 无 |
| 11 | rawComposition | null | "最低4隻。(駆+海防)2隻、他2隻必要／「駆×4」" | wikiwiki 有 kcwiki 无 |
| 12 | nameZh | "资源运送任务" | null | kcwiki 有 wikiwiki 无 |
| 12 | composition | "驱逐/海防*2 其他*2" | "驱逐/海防*2、其他*2" | 两者值不同 |
| 12 | rewards.items | [{"name":"家具箱（中）","count":1}] | [{"name":"開発資材","count":1,"min":0},{"name":"家具箱(中)","count":1,"min":0}] | 两者值不同 |
| 12 | rewards.greatItems | [{"name":"开发资材","count":1}] | [] | 两者值不同 |
| 12 | difficulty | null | "B" | wikiwiki 有 kcwiki 无 |
| 12 | descriptionJp | null | "資源国からの輸送部隊を護衛し、母港への輸送を無事完遂しよう！" | wikiwiki 有 kcwiki 无 |
| 12 | useFuelText | null | "普通/50%" | wikiwiki 有 kcwiki 无 |
| 12 | useBullText | null | "なし" | wikiwiki 有 kcwiki 无 |
| 12 | rawComposition | null | "最低4隻。(駆+海防)2隻、他2隻必要／「駆×4」" | wikiwiki 有 kcwiki 无 |
| 13 | nameZh | "鼠输送作战" | null | kcwiki 有 wikiwiki 无 |
| 13 | composition | "轻巡*1 驱逐*4 其他*1" | "轻巡*1、驱逐*4、其他*1" | 两者值不同 |
| 13 | rewards.items | [{"name":"高速修复材","count":2}] | [{"name":"高速修復材","count":2,"min":0},{"name":"家具箱(小)","count":1,"min":0}] | 两者值不同 |
| 13 | rewards.greatItems | [{"name":"家具箱（小）","count":1}] | [] | 两者值不同 |
| 13 | difficulty | null | "A" | wikiwiki 有 kcwiki 无 |
| 13 | descriptionJp | null | "快速の水雷戦隊を集中運用して、激戦の諸島へ物資を輸送しよう！" | wikiwiki 有 kcwiki 无 |
| 13 | useFuelText | null | "普通/50%" | wikiwiki 有 kcwiki 无 |
| 13 | useBullText | null | "普通/40%" | wikiwiki 有 kcwiki 无 |
| 13 | rawComposition | null | "全6隻。軽1隻、駆4隻、他1隻必要／「軽×1,駆×5」" | wikiwiki 有 kcwiki 无 |
| 14 | nameZh | "围困陆战队撤退运送任务" | null | kcwiki 有 wikiwiki 无 |
| 14 | composition | "轻巡*1 驱逐*3 其他*2" | "轻巡*1、驱逐*3、其他*2" | 两者值不同 |
| 14 | rewards.items | [{"name":"高速修复材","count":1}] | [{"name":"高速修復材","count":1,"min":0},{"name":"開発資材","count":1,"min":0}] | 两者值不同 |
| 14 | rewards.greatItems | [{"name":"开发资材","count":1}] | [] | 两者值不同 |
| 14 | difficulty | null | "A" | wikiwiki 有 kcwiki 无 |
| 14 | descriptionJp | null | "機動力のある小艦艇部隊を結集、包囲下の部隊を収容しよう！" | wikiwiki 有 kcwiki 无 |
| 14 | useFuelText | null | "普通/50%" | wikiwiki 有 kcwiki 无 |
| 14 | useBullText | null | "なし" | wikiwiki 有 kcwiki 无 |
| 14 | rawComposition | null | "全6隻。軽1隻、駆3隻、他2隻必要／「軽×1,駆×5」" | wikiwiki 有 kcwiki 无 |
| 15 | nameZh | "诱饵机动部队支援作战" | null | kcwiki 有 wikiwiki 无 |
| 15 | composition | "空母（水母，护母可）*2 驱逐*2 其他*2" | "空母(水母,护卫空母可)*2、驱逐*2、其他*2" | 两者值不同 |
| 15 | rewards.items | [{"name":"家具箱（大）","count":1}] | [{"name":"開発資材","count":1,"min":0},{"name":"家具箱(大)","count":1,"min":0}] | 两者值不同 |
| 15 | rewards.greatItems | [{"name":"开发资材","count":1}] | [] | 两者值不同 |
| 15 | difficulty | null | "S" | wikiwiki 有 kcwiki 无 |
| 15 | descriptionJp | null | "敵機動部隊を誘引する空母を含む囮部隊で主力艦隊を支援しよう！" | wikiwiki 有 kcwiki 无 |
| 15 | useFuelText | null | "普通/50%" | wikiwiki 有 kcwiki 无 |
| 15 | useBullText | null | "普通/40%" | wikiwiki 有 kcwiki 无 |
| 15 | rawComposition | null | "全6隻。空母(水母,護母可)2隻、駆2隻、他2隻必要／「空母×2,駆×4」「水母×2,駆×4」" | wikiwiki 有 kcwiki 无 |
| 16 | nameZh | "舰队决战护卫作战" | null | kcwiki 有 wikiwiki 无 |
| 16 | composition | "轻巡*1 驱逐*2 其他*3" | "轻巡*1、驱逐*2、其他*3" | 两者值不同 |
| 16 | rewards.items | [{"name":"高速建造材","count":2}] | [{"name":"高速建造材","count":2,"min":0},{"name":"開発資材","count":2,"min":0}] | 两者值不同 |
| 16 | rewards.greatItems | [{"name":"开发资材","count":2}] | [] | 两者值不同 |
| 16 | difficulty | null | "S" | wikiwiki 有 kcwiki 无 |
| 16 | descriptionJp | null | "有力な艦隊を編成し、敵背後側面を奇襲、艦隊決戦を援護しよう！" | wikiwiki 有 kcwiki 无 |
| 16 | useFuelText | null | "普通/50%" | wikiwiki 有 kcwiki 无 |
| 16 | useBullText | null | "普通/40%" | wikiwiki 有 kcwiki 无 |
| 16 | rawComposition | null | "全6隻。軽1隻、駆2隻、他3隻必要／「軽×1,駆×5」" | wikiwiki 有 kcwiki 无 |
| 17 | nameZh | "敌基地侦察作战" | null | kcwiki 有 wikiwiki 无 |
| 17 | composition | "轻巡*1 驱逐*3 其他*2" | "轻巡*1、驱逐*3、其他*2" | 两者值不同 |
| 17 | difficulty | null | "A" | wikiwiki 有 kcwiki 无 |
| 17 | descriptionJp | null | "精鋭水雷戦隊を投入し、北方海域の敵情勢を強行偵察せよ！" | wikiwiki 有 kcwiki 无 |
| 17 | useFuelText | null | "少量/30%" | wikiwiki 有 kcwiki 无 |
| 17 | useBullText | null | "普通/40%" | wikiwiki 有 kcwiki 无 |
| 17 | rawComposition | null | "全6隻。軽1隻、駆3隻、他2隻必要／「軽×1,駆×5」" | wikiwiki 有 kcwiki 无 |
| 18 | nameZh | "舰载机运送作战" | null | kcwiki 有 wikiwiki 无 |
| 18 | composition | "空母(水母，护母可)*3 驱逐*2 其他*1" | "空母(水母,护卫空母可)*3、驱逐*2、其他*1" | 两者值不同 |
| 18 | rewards.baux | [150,20] | [150,30] | 两者值不同 |
| 18 | rewards.items | [{"name":"高速修复材","count":1}] | [{"name":"高速修復材","count":1,"min":0}] | 两者值不同 |
| 18 | difficulty | null | "S" | wikiwiki 有 kcwiki 无 |
| 18 | descriptionJp | null | "「航空母艦」を多数配備した輸送部隊で前線に航空機を輸送せよ！" | wikiwiki 有 kcwiki 无 |
| 18 | useFuelText | null | "普通/50%" | wikiwiki 有 kcwiki 无 |
| 18 | useBullText | null | "少量/20%" | wikiwiki 有 kcwiki 无 |
| 18 | rawComposition | null | "全6隻。空母(水母,護母可)3隻、駆2隻、他1隻必要／「空母×3,駆×3」" | wikiwiki 有 kcwiki 无 |
| 19 | nameZh | "北号作战" | null | kcwiki 有 wikiwiki 无 |
| 19 | composition | "航战*2 驱逐*2 其他*2" | "航战*2、驱逐*2、其他*2" | 两者值不同 |
| 19 | rewards.items | [{"name":"家具箱（小）","count":1}] | [{"name":"開発資材","count":1,"min":0},{"name":"家具箱(小)","count":1,"min":0}] | 两者值不同 |
| 19 | rewards.greatItems | [{"name":"开发资材","count":1}] | [] | 两者值不同 |
| 19 | difficulty | null | "S" | wikiwiki 有 kcwiki 无 |
| 19 | descriptionJp | null | "高練度「航空戦艦」複数を基幹とする強行輸送船団を出航させよ！" | wikiwiki 有 kcwiki 无 |
| 19 | useFuelText | null | "普通/50%" | wikiwiki 有 kcwiki 无 |
| 19 | useBullText | null | "普通/40%" | wikiwiki 有 kcwiki 无 |
| 19 | rawComposition | null | "全6隻。航戦2隻、駆2隻、他2隻必要／「航戦×2,駆×4」" | wikiwiki 有 kcwiki 无 |
| 20 | nameZh | "潜水艇戒备任务" | null | kcwiki 有 wikiwiki 无 |
| 20 | composition | "轻巡*1 潜艇*1" | "潜水*1、轻巡*1" | 两者值不同 |
| 20 | rewards.items | [{"name":"开发资材","count":1}] | [{"name":"開発資材","count":1,"min":0},{"name":"家具箱(中)","count":1,"min":0}] | 两者值不同 |
| 20 | rewards.greatItems | [{"name":"家具箱（中）","count":1}] | [] | 两者值不同 |
| 20 | difficulty | null | "S" | wikiwiki 有 kcwiki 无 |
| 20 | descriptionJp | null | "潜水艦と同支援艦艇による艦隊で北方海域の哨戒任務にあたれ！" | wikiwiki 有 kcwiki 无 |
| 20 | useFuelText | null | "普通/50%" | wikiwiki 有 kcwiki 无 |
| 20 | useBullText | null | "普通/40%" | wikiwiki 有 kcwiki 无 |
| 20 | rawComposition | null | "最低2隻。潜1隻、軽1隻必要 ／「潜×1,軽×1」" | wikiwiki 有 kcwiki 无 |
| 21 | nameZh | "北方鼠输送作战" | null | kcwiki 有 wikiwiki 无 |
| 21 | composition | "轻巡*1 驱逐*4" | "轻巡*1、驱逐*4" | 两者值不同 |
| 21 | escortText | "至少3个舰娘\n各携带1个桶" | null | kcwiki 有 wikiwiki 无 |
| 21 | drumTotal | 1 | 3 | 两者值不同 |
| 21 | greatNote | "大成功要4桶以上+4闪" | "合計4個以上かつキラキラ艦4隻以上で大成功確定" | 两者值不同 |
| 21 | rewards.items | [{"name":"家具箱（小）","count":1}] | [{"name":"家具箱(小)","count":1,"min":0}] | 两者值不同 |
| 21 | difficulty | null | "S" | wikiwiki 有 kcwiki 无 |
| 21 | descriptionJp | null | "水雷戦隊にドラム缶を積載、北方方面の友軍への糧食補給を図れ！" | wikiwiki 有 kcwiki 无 |
| 21 | useFuelText | null | "大量/80%" | wikiwiki 有 kcwiki 无 |
| 21 | useBullText | null | "大量/70%" | wikiwiki 有 kcwiki 无 |
| 21 | rawComposition | null | "最低5隻。軽1隻、駆4隻必要／「軽×1,駆×4,任意の3隻にドラム缶を合計3つ」 3隻以上にドラム缶(輸送用)が合計3個以上必要。合計4個以上かつキラキラ艦4隻以上で大成功確定。詳細はこちらを参照。" | wikiwiki 有 kcwiki 无 |
| 22 | nameZh | "舰队演习" | null | kcwiki 有 wikiwiki 无 |
| 22 | composition | "重巡*1 轻巡*1 驱逐*2 其他*2" | "重巡*1、轻巡*1、驱逐*2、其他*2" | 两者值不同 |
| 22 | difficulty | null | "S" | wikiwiki 有 kcwiki 无 |
| 22 | descriptionJp | null | "練度向上のため艦隊演習を実施！(資源獲得の遠征ではありません)" | wikiwiki 有 kcwiki 无 |
| 22 | useFuelText | null | "大量/80%" | wikiwiki 有 kcwiki 无 |
| 22 | useBullText | null | "大量/70%" | wikiwiki 有 kcwiki 无 |
| 22 | rawComposition | null | "全6隻。重1隻、軽1隻、駆2隻、他2隻必要／「重×1,軽×1,駆×4」" | wikiwiki 有 kcwiki 无 |
| 23 | nameZh | "航空战舰运用演习" | null | kcwiki 有 wikiwiki 无 |
| 23 | composition | "航战*2 驱逐*2 其他*2" | "航战*2、驱逐*2、其他*2" | 两者值不同 |
| 23 | rewards.ammo | [50,12] | [50,13] | 两者值不同 |
| 23 | rewards.baux | [130,32] | [130,33] | 两者值不同 |
| 23 | rewards.items | [{"name":"家具箱（中）","count":1}] | [{"name":"家具箱(中)","count":1,"min":0}] | 两者值不同 |
| 23 | difficulty | null | "S" | wikiwiki 有 kcwiki 无 |
| 23 | descriptionJp | null | "高練度「航空戦艦」戦隊を基幹とした艦隊の総合演習を実施せよ！" | wikiwiki 有 kcwiki 无 |
| 23 | useFuelText | null | "大量/80%" | wikiwiki 有 kcwiki 无 |
| 23 | useBullText | null | "大量/80%" | wikiwiki 有 kcwiki 无 |
| 23 | rawComposition | null | "全6隻。航戦2隻、駆2隻、他2隻必要／「航戦×2,駆×4」" | wikiwiki 有 kcwiki 无 |
| 24 | nameZh | "北方航路海上护卫" | null | kcwiki 有 wikiwiki 无 |
| 24 | composition | "轻巡(必须旗舰)\n驱逐/海防*4 其他*1" | "轻巡(必须旗舰)*1、驱逐/海防*4、其他*1" | 两者值不同 |
| 24 | drumTotal | null | 4 | wikiwiki 有 kcwiki 无 |
| 24 | greatNote | "大成功要4桶以上+4闪" | "合計4個以上合計2個以上かつキラキラ艦4隻以上で大成功確定" | 两者值不同 |
| 24 | rewards.items | [{"name":"开发资材","count":2}] | [{"name":"高速修復材","count":1,"min":0},{"name":"開発資材","count":2,"min":0}] | 两者值不同 |
| 24 | rewards.greatItems | [{"name":"高速修复材","count":1}] | [] | 两者值不同 |
| 24 | difficulty | null | "S" | wikiwiki 有 kcwiki 无 |
| 24 | descriptionJp | null | "高練度軽巡が率いる精鋭護衛艦隊で北方航路海上護衛を実施せよ！" | wikiwiki 有 kcwiki 无 |
| 24 | useFuelText | null | "大量/90%" | wikiwiki 有 kcwiki 无 |
| 24 | useBullText | null | "普通/60%" | wikiwiki 有 kcwiki 无 |
| 24 | rawComposition | null | "全6隻。軽(旗艦固定)1隻、(駆+海防)4隻、他1隻必要／「軽×1,駆×5」 ドラム缶(輸送用)が合計4個以上合計2個以上かつキラキラ艦4隻以上で大成功確定。詳細はこちらを参照。" | wikiwiki 有 kcwiki 无 |
| 25 | nameZh | "通商破坏作战" | null | kcwiki 有 wikiwiki 无 |
| 25 | composition | "重巡*2 驱逐*2" | "重巡*2、驱逐*2" | 两者值不同 |
| 25 | rewards.items | [{"name":"家具箱（中）","count":1}] | [{"name":"家具箱(中)","count":1,"min":0}] | 两者值不同 |
| 25 | difficulty | null | "S" | wikiwiki 有 kcwiki 无 |
| 25 | descriptionJp | null | "快速かつ打撃力のある重巡戦隊を投入、敵後方補給線を遮断せよ！" | wikiwiki 有 kcwiki 无 |
| 25 | useFuelText | null | "普通/50%" | wikiwiki 有 kcwiki 无 |
| 25 | useBullText | null | "大量/80%" | wikiwiki 有 kcwiki 无 |
| 25 | rawComposition | null | "最低4隻。重2隻、駆2隻必要／「重×2,駆×2」" | wikiwiki 有 kcwiki 无 |
| 26 | nameZh | "敌母港空袭作战" | null | kcwiki 有 wikiwiki 无 |
| 26 | composition | "空母*1（水母，护母可） 轻巡*1 驱逐*2" | "空母(水母,护卫空母可)*1、轻巡*1、驱逐*2" | 两者值不同 |
| 26 | rewards.items | [{"name":"高速修复材","count":3}] | [{"name":"高速修復材","count":3,"min":0},{"name":"家具箱(大)","count":1,"min":0}] | 两者值不同 |
| 26 | rewards.greatItems | [{"name":"家具箱（大）","count":1}] | [] | 两者值不同 |
| 26 | difficulty | null | "S" | wikiwiki 有 kcwiki 无 |
| 26 | descriptionJp | null | "敵潜水艦の哨戒線を長躯突破し、有力な機動艦隊で敵母港を叩け！" | wikiwiki 有 kcwiki 无 |
| 26 | useFuelText | null | "大量/80%" | wikiwiki 有 kcwiki 无 |
| 26 | useBullText | null | "大量/80%" | wikiwiki 有 kcwiki 无 |
| 26 | rawComposition | null | "最低4隻。空母(水母,護母可)1隻、軽1隻、駆2隻必要／「空母×1,軽×1,駆×2」" | wikiwiki 有 kcwiki 无 |
| 27 | nameZh | "潜水艇通商破坏作战" | null | kcwiki 有 wikiwiki 无 |
| 27 | composition | "潜艇*2" | "潜水*2" | 两者值不同 |
| 27 | rewards.items | [{"name":"开发资材","count":2}] | [{"name":"開発資材","count":2,"min":0},{"name":"家具箱(小)","count":2,"min":0}] | 两者值不同 |
| 27 | rewards.greatItems | [{"name":"家具箱（小）","count":2}] | [] | 两者值不同 |
| 27 | difficulty | null | "S" | wikiwiki 有 kcwiki 无 |
| 27 | descriptionJp | null | "潜水艦2隻以上を伴う艦隊で、敵後方へ進出、通商破壊作戦実施！" | wikiwiki 有 kcwiki 无 |
| 27 | useFuelText | null | "大量/80%" | wikiwiki 有 kcwiki 无 |
| 27 | useBullText | null | "大量/80%" | wikiwiki 有 kcwiki 无 |
| 27 | rawComposition | null | "最低2隻。潜2隻必要／「潜×2」" | wikiwiki 有 kcwiki 无 |
| 28 | nameZh | "西方海域封锁作战" | null | kcwiki 有 wikiwiki 无 |
| 28 | composition | "潜艇*3" | "潜水*3" | 两者值不同 |
| 28 | rewards.items | [{"name":"开发资材","count":3}] | [{"name":"開発資材","count":3,"min":0},{"name":"家具箱(中)","count":2,"min":0}] | 两者值不同 |
| 28 | rewards.greatItems | [{"name":"家具箱（中）","count":2}] | [] | 两者值不同 |
| 28 | difficulty | null | "S" | wikiwiki 有 kcwiki 无 |
| 28 | descriptionJp | null | "潜水艦3隻以上の艦隊で、西方海域の敵水上艦の活動を封鎖せよ！" | wikiwiki 有 kcwiki 无 |
| 28 | useFuelText | null | "大量/80%" | wikiwiki 有 kcwiki 无 |
| 28 | useBullText | null | "大量/80%" | wikiwiki 有 kcwiki 无 |
| 28 | rawComposition | null | "最低3隻。潜3隻必要／「潜×3」" | wikiwiki 有 kcwiki 无 |
| 29 | nameZh | "潜水艇派遣演习" | null | kcwiki 有 wikiwiki 无 |
| 29 | composition | "潜艇*3" | "潜水*3" | 两者值不同 |
| 29 | rewards.items | [{"name":"开发资材","count":1}] | [{"name":"開発資材","count":1,"min":0},{"name":"家具箱(小)","count":1,"min":0}] | 两者值不同 |
| 29 | rewards.greatItems | [{"name":"家具箱（小）","count":1}] | [] | 两者值不同 |
| 29 | difficulty | null | "S" | wikiwiki 有 kcwiki 无 |
| 29 | descriptionJp | null | "潜水艦3隻以上の艦隊を編成し、長距離派遣の演習を実施せよ！" | wikiwiki 有 kcwiki 无 |
| 29 | useFuelText | null | "大量/90%" | wikiwiki 有 kcwiki 无 |
| 29 | useBullText | null | "普通/40%" | wikiwiki 有 kcwiki 无 |
| 29 | rawComposition | null | "最低3隻。潜3隻必要／「潜×3」" | wikiwiki 有 kcwiki 无 |
| 30 | nameZh | "潜水艇派遣作战" | null | kcwiki 有 wikiwiki 无 |
| 30 | composition | "潜艇*4" | "潜水*4" | 两者值不同 |
| 30 | rewards.ammo | [50,2] | [50,1] | 两者值不同 |
| 30 | rewards.items | [{"name":"开发资材","count":3}] | [{"name":"開発資材","count":3,"min":0},{"name":"家具箱(大)","count":1,"min":0}] | 两者值不同 |
| 30 | rewards.greatItems | [{"name":"家具箱（大）","count":1}] | [] | 两者值不同 |
| 30 | difficulty | null | "S" | wikiwiki 有 kcwiki 无 |
| 30 | descriptionJp | null | "潜水艦4隻以上の艦隊を編成し、遠方友軍勢力との連絡を試みよ！" | wikiwiki 有 kcwiki 无 |
| 30 | useFuelText | null | "大量/90%" | wikiwiki 有 kcwiki 无 |
| 30 | useBullText | null | "大量/70%" | wikiwiki 有 kcwiki 无 |
| 30 | rawComposition | null | "最低4隻。潜4隻必要／「潜×4」" | wikiwiki 有 kcwiki 无 |
| 31 | nameZh | "和海外舰的接触" | null | kcwiki 有 wikiwiki 无 |
| 31 | composition | "潜艇*4" | "潜水*4" | 两者值不同 |
| 31 | rewards.items | [{"name":"家具箱（小）","count":1}] | [{"name":"家具箱(小)","count":1,"min":0}] | 两者值不同 |
| 31 | difficulty | null | "S" | wikiwiki 有 kcwiki 无 |
| 31 | descriptionJp | null | "潜水艦4隻以上の艦隊を派遣し、海外艦との邂逅を試みよ！" | wikiwiki 有 kcwiki 无 |
| 31 | useFuelText | null | "普通/50%" | wikiwiki 有 kcwiki 无 |
| 31 | useBullText | null | "なし" | wikiwiki 有 kcwiki 无 |
| 31 | rawComposition | null | "最低4隻。潜4隻必要／「潜×4」" | wikiwiki 有 kcwiki 无 |
| 32 | nameZh | "远洋练习航海" | null | kcwiki 有 wikiwiki 无 |
| 32 | composition | "练巡(必须旗舰)\n驱逐*2" | "练巡(必须旗舰)*1、驱逐*2" | 两者值不同 |
| 32 | greatNote | "大成功要旗舰33级以上+5闪或旗舰128级以上+4闪(待验证)" | "旗艦Lv33以上かつキラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定？" | 两者值不同 |
| 32 | rewards.items | [{"name":"家具箱（大）","count":1}] | [{"name":"開発資材","count":3,"min":0},{"name":"家具箱(大)","count":1,"min":0}] | 两者值不同 |
| 32 | rewards.greatItems | [{"name":"开发资材","count":3}] | [] | 两者值不同 |
| 32 | difficulty | null | "D" | wikiwiki 有 kcwiki 无 |
| 32 | descriptionJp | null | "練習巡洋艦を旗艦で遠洋練習航海を実施、基礎練度向上に努めよ！" | wikiwiki 有 kcwiki 无 |
| 32 | useFuelText | null | "大量/90%" | wikiwiki 有 kcwiki 无 |
| 32 | useBullText | null | "少量/30%" | wikiwiki 有 kcwiki 无 |
| 32 | rawComposition | null | "最低3隻。練巡(旗艦固定)1隻、駆2隻必要／「練巡×1，駆×2」 旗艦Lv33以上かつキラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定？。詳細はこちらを参照。" | wikiwiki 有 kcwiki 无 |
| 33 | nameZh | "前线部队支援任务" | null | kcwiki 有 wikiwiki 无 |
| 33 | escortText | "0" | null | kcwiki 有 wikiwiki 无 |
| 33 | rewards.fuel | [0,null] | null | kcwiki 有 wikiwiki 无 |
| 33 | rewards.ammo | [0,null] | null | kcwiki 有 wikiwiki 无 |
| 33 | rewards.steel | [0,null] | null | kcwiki 有 wikiwiki 无 |
| 33 | rewards.baux | [0,null] | null | kcwiki 有 wikiwiki 无 |
| 33 | difficulty | null | "E" | wikiwiki 有 kcwiki 无 |
| 33 | descriptionJp | null | "南方海域へ支援艦隊を出撃させ、主力艦隊の進撃を援護せよ！" | wikiwiki 有 kcwiki 无 |
| 33 | useFuelText | null | "普通/50%" | wikiwiki 有 kcwiki 无 |
| 33 | useBullText | null | "普通/40% or 大量/80%" | wikiwiki 有 kcwiki 无 |
| 33 | rawComposition | null | "最低2隻。駆2隻必要／「駆×2」" | wikiwiki 有 kcwiki 无 |
| 34 | nameZh | "舰队决战支援任务" | null | kcwiki 有 wikiwiki 无 |
| 34 | escortText | "0" | null | kcwiki 有 wikiwiki 无 |
| 34 | rewards.fuel | [0,null] | null | kcwiki 有 wikiwiki 无 |
| 34 | rewards.ammo | [0,null] | null | kcwiki 有 wikiwiki 无 |
| 34 | rewards.steel | [0,null] | null | kcwiki 有 wikiwiki 无 |
| 34 | rewards.baux | [0,null] | null | kcwiki 有 wikiwiki 无 |
| 34 | difficulty | null | "E" | wikiwiki 有 kcwiki 无 |
| 34 | descriptionJp | null | "南方海域へ決戦支援を行う別働隊を展開し、主力艦隊を援護せよ！" | wikiwiki 有 kcwiki 无 |
| 34 | useFuelText | null | "普通/50%" | wikiwiki 有 kcwiki 无 |
| 34 | useBullText | null | "普通/40% or 大量/80%" | wikiwiki 有 kcwiki 无 |
| 34 | rawComposition | null | "最低2隻。駆2隻必要／「駆×2」" | wikiwiki 有 kcwiki 无 |
| 35 | nameZh | "MO作战" | null | kcwiki 有 wikiwiki 无 |
| 35 | composition | "空母（水母，护母可）*2 重巡*1\n驱逐*1 其他*2" | "空母(水母,护卫空母可)*2、重巡*1、驱逐*1、其他*2" | 两者值不同 |
| 35 | rewards.items | [{"name":"家具箱（小）","count":2}] | [{"name":"開発資材","count":1,"min":0},{"name":"家具箱(小)","count":2,"min":0}] | 两者值不同 |
| 35 | rewards.greatItems | [{"name":"开发资材","count":1}] | [] | 两者值不同 |
| 35 | difficulty | null | "S" | wikiwiki 有 kcwiki 无 |
| 35 | descriptionJp | null | "空母2隻を含むMO機動部隊を投入し、南方海域制海権を確保せよ！" | wikiwiki 有 kcwiki 无 |
| 35 | useFuelText | null | "大量/80%" | wikiwiki 有 kcwiki 无 |
| 35 | useBullText | null | "大量/80%" | wikiwiki 有 kcwiki 无 |
| 35 | rawComposition | null | "全6隻。空母(水母,護母可)2隻、重1隻、駆1隻、他2隻必要／「空母×2,重×1,駆×3」" | wikiwiki 有 kcwiki 无 |
| 36 | nameZh | "水上飞机基地建设" | null | kcwiki 有 wikiwiki 无 |
| 36 | composition | "水母*2 轻巡*1\n驱逐*1 其他*2" | "水母*2、轻巡*1、驱逐*1、其他*2" | 两者值不同 |
| 36 | rewards.items | [{"name":"家具箱（中）","count":2}] | [{"name":"高速修復材","count":1,"min":0},{"name":"家具箱(中)","count":2,"min":0}] | 两者值不同 |
| 36 | rewards.greatItems | [{"name":"高速修复材","count":1}] | [] | 两者值不同 |
| 36 | difficulty | null | "S" | wikiwiki 有 kcwiki 无 |
| 36 | descriptionJp | null | "水上機母艦2隻を南方に展開し、哨戒用の水上機基地を建設せよ！" | wikiwiki 有 kcwiki 无 |
| 36 | useFuelText | null | "大量/80%" | wikiwiki 有 kcwiki 无 |
| 36 | useBullText | null | "大量/80%" | wikiwiki 有 kcwiki 无 |
| 36 | rawComposition | null | "全6隻。水母2隻、軽1隻、駆1隻、他2隻必要／「水母×2,軽×1,駆×3」" | wikiwiki 有 kcwiki 无 |
| 37 | nameZh | "东京急行" | null | kcwiki 有 wikiwiki 无 |
| 37 | composition | "轻巡*1 驱逐*5" | "轻巡*1、驱逐*5" | 两者值不同 |
| 37 | escortText | "至少3个舰娘\n携带4个桶以上" | null | kcwiki 有 wikiwiki 无 |
| 37 | greatNote | "大成功要5桶以上+4闪" | "合計5個以上かつキラキラ艦4隻以上で大成功確定" | 两者值不同 |
| 37 | rewards.items | [{"name":"家具箱（小）","count":1}] | [{"name":"家具箱(小)","count":1,"min":0}] | 两者值不同 |
| 37 | difficulty | null | "S" | wikiwiki 有 kcwiki 无 |
| 37 | descriptionJp | null | "水雷戦隊に輸送ドラム缶を満載、南方への鼠輸送作戦を遂行せよ！" | wikiwiki 有 kcwiki 无 |
| 37 | useFuelText | null | "大量/80%" | wikiwiki 有 kcwiki 无 |
| 37 | useBullText | null | "大量/80%" | wikiwiki 有 kcwiki 无 |
| 37 | rawComposition | null | "全6隻。軽1隻、駆5隻必要／「軽×1,駆×5,任意の3隻にドラム缶を合計4つ」 3隻以上にドラム缶(輸送用)が合計4個以上必要。合計5個以上かつキラキラ艦4隻以上で大成功確定。詳細はこちらを参照。" | wikiwiki 有 kcwiki 无 |
| 38 | nameZh | "东京急行(二)" | null | kcwiki 有 wikiwiki 无 |
| 38 | composition | "驱逐*5 其他*1" | "驱逐*5、其他*1" | 两者值不同 |
| 38 | escortText | "至少4个舰娘携带8个桶以上" | null | kcwiki 有 wikiwiki 无 |
| 38 | greatNote | "大成功要10桶以上+4闪" | "合計10個以上かつキラキラ艦4隻以上で大成功確定" | 两者值不同 |
| 38 | rewards.items | [{"name":"家具箱（小）","count":1}] | [{"name":"家具箱(小)","count":1,"min":0}] | 两者值不同 |
| 38 | difficulty | null | "S" | wikiwiki 有 kcwiki 无 |
| 38 | descriptionJp | null | "可能な限り輸送ドラム缶を満載、南方への鼠輸送作戦を続行せよ！" | wikiwiki 有 kcwiki 无 |
| 38 | useFuelText | null | "大量/80%" | wikiwiki 有 kcwiki 无 |
| 38 | useBullText | null | "大量/80%" | wikiwiki 有 kcwiki 无 |
| 38 | rawComposition | null | "全6隻。駆5隻、他1隻必要／「駆×6,任意の4隻にドラム缶を合計8つ」 4隻以上にドラム缶(輸送用)が合計8個以上必要。合計10個以上かつキラキラ艦4隻以上で大成功確定。詳細はこちらを参照。" | wikiwiki 有 kcwiki 无 |
| 39 | nameZh | "远洋潜水艇作战" | null | kcwiki 有 wikiwiki 无 |
| 39 | composition | "潜水母舰*1(潜水空母不可) 潜艇*4" | "潜水母舰(潜水水空母ではない 迅鯨型、平安丸、改造前の大鯨を指す)*1、潜水*4" | 两者值不同 |
| 39 | rewards.items | [{"name":"高速修复材","count":2}] | [{"name":"高速修復材","count":2,"min":0},{"name":"家具箱(中)","count":1,"min":0}] | 两者值不同 |
| 39 | rewards.greatItems | [{"name":"家具箱（中）","count":1}] | [] | 两者值不同 |
| 39 | difficulty | null | "S" | wikiwiki 有 kcwiki 无 |
| 39 | descriptionJp | null | "潜水母艦と潜水艦群による遠洋作戦を実施、敵勢力漸減に努めよ！" | wikiwiki 有 kcwiki 无 |
| 39 | useFuelText | null | "大量/90%" | wikiwiki 有 kcwiki 无 |
| 39 | useBullText | null | "大量/90%" | wikiwiki 有 kcwiki 无 |
| 39 | rawComposition | null | "最低5隻。潜水母艦(潜水空母ではない。迅鯨型、平安丸、改造前の大鯨を指す)1隻、潜4隻必要／「潜母艦×1,潜×4」" | wikiwiki 有 kcwiki 无 |
| 40 | nameZh | "水上机前线运输" | null | kcwiki 有 wikiwiki 无 |
| 40 | composition | "轻巡(旗舰固定)\n水母*2 驱逐*2 其他*1" | "轻巡(必须旗舰)*1、水母*2、驱逐*2、其他*1" | 两者值不同 |
| 40 | drumTotal | null | 4 | wikiwiki 有 kcwiki 无 |
| 40 | greatNote | "大成功要4桶以上+4闪" | "合計4個以上かつキラキラ艦4隻以上で大成功確定" | 两者值不同 |
| 40 | rewards.fuel | [300,43] | [300,44] | 两者值不同 |
| 40 | rewards.ammo | [300,43] | [300,44] | 两者值不同 |
| 40 | rewards.baux | [100,13] | [100,15] | 两者值不同 |
| 40 | rewards.items | [{"name":"家具箱（小）","count":3}] | [{"name":"高速修復材","count":1,"min":0},{"name":"家具箱(小)","count":3,"min":0}] | 两者值不同 |
| 40 | rewards.greatItems | [{"name":"高速修复材","count":1}] | [] | 两者值不同 |
| 40 | difficulty | null | "S" | wikiwiki 有 kcwiki 无 |
| 40 | descriptionJp | null | "軽巡旗艦と複数の水上機母艦で、水上機の前線輸送を実施せよ！" | wikiwiki 有 kcwiki 无 |
| 40 | useFuelText | null | "大量/80%" | wikiwiki 有 kcwiki 无 |
| 40 | useBullText | null | "大量/70%" | wikiwiki 有 kcwiki 无 |
| 40 | rawComposition | null | "全6隻。軽(旗艦固定)1隻、水母2隻、駆2隻、他1隻必要 ／「軽×1,水母×2,駆×3」 ドラム缶(輸送用)が合計4個以上かつキラキラ艦4隻以上で大成功確定。詳細はこちらを参照。" | wikiwiki 有 kcwiki 无 |
| 41 | nameZh | "文莱泊地海湾警戒" | null | kcwiki 有 wikiwiki 无 |
| 41 | escortText | "总火力≥60\n对潜≥210\n对空≥80" | null | kcwiki 有 wikiwiki 无 |
| 41 | greatNote | "大成功要旗舰33级以上+5闪或旗舰128级以上+4闪" | "旗艦Lv33以上かつキラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定" | 两者值不同 |
| 41 | rewards.items | [{"name":"开发资材","count":1}] | [{"name":"高速修復材","count":1,"min":0},{"name":"開発資材","count":1,"min":0}] | 两者值不同 |
| 41 | rewards.greatItems | [{"name":"高速修复材","count":1}] | [] | 两者值不同 |
| 41 | difficulty | null | "A" | wikiwiki 有 kcwiki 无 |
| 41 | descriptionJp | null | "海防艦や駆逐艦による哨戒艦隊でブルネイ泊地沖対潜警戒を実施、同泊地周辺海域の安全を図れ！" | wikiwiki 有 kcwiki 无 |
| 41 | useFuelText | null | "普通/50%" | wikiwiki 有 kcwiki 无 |
| 41 | useBullText | null | "普通/50%" | wikiwiki 有 kcwiki 无 |
| 41 | rawComposition | null | "最低3隻。(駆+海防)3隻必要。／「駆×3」 艦隊の合計値で、火力60 / 対空80 / 対潜210 以上必要(装備込み。但し艦載機には補正が掛かる。詳細はこちらを参照。) 旗艦Lv33以上かつキラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定。詳細はこちらを参照。" | wikiwiki 有 kcwiki 无 |
| 42 | nameJp | "ミ船団護衛(一号船団)" | "ミ船団護衛(一号船団) (マンスリー)" | 两者值不同 |
| 42 | nameZh | "MI船团护卫（一号船团）" | null | kcwiki 有 wikiwiki 无 |
| 42 | composition | "护卫空母/轻巡*1 驱逐/海防*2 （驱逐至少1只） 其他*1" | "轻巡*1、驱逐*2、其他*1" | 两者值不同 |
| 42 | rewards.items | [{"name":"家具箱（大）","count":1}] | [{"name":"高速建造材","count":3,"min":0},{"name":"家具箱(大)","count":1,"min":0}] | 两者值不同 |
| 42 | rewards.greatItems | [{"name":"高速建造材","count":3}] | [] | 两者值不同 |
| 42 | difficulty | null | "S" | wikiwiki 有 kcwiki 无 |
| 42 | descriptionJp | null | "油田地帯から本土への輸送船団の護衛を行う。護衛空母と海防艦や軽巡級と駆逐艦等の対潜哨戒能力の高い部隊を編成、船団護衛を遂行せよ！【月一回実施可能遠征】" | wikiwiki 有 kcwiki 无 |
| 42 | useFuelText | null | "普通/80%" | wikiwiki 有 kcwiki 无 |
| 42 | useBullText | null | "普通/65%" | wikiwiki 有 kcwiki 无 |
| 42 | rawComposition | null | "最低4隻。軽1隻、駆2隻、他1隻必要。／「軽×1,駆×3」 (駆1海防3)(軽1海防2他1)(護母1駆2他1)(護母1海防2他1)(練巡1海防2他1)の編成でも成功する。詳しくは上記参照。" | wikiwiki 有 kcwiki 无 |
| 43 | nameJp | "ミ船団護衛(二号船団)" | "ミ船団護衛(二号船団) (マンスリー・交戦I型)" | 两者值不同 |
| 43 | nameZh | "MI船团护卫（二号船团）" | null | kcwiki 有 wikiwiki 无 |
| 43 | composition | "护卫空母*1(必须旗舰) 驱逐/海防*2(1驱逐+1海防不可)\n其他*3\n或\n轻空母*1(必须旗舰) 轻巡*1 驱逐*4" | null | kcwiki 有 wikiwiki 无 |
| 43 | escortText | "总火力≥500\n对潜≥280\n对空≥280\n索敌≥170" | null | kcwiki 有 wikiwiki 无 |
| 43 | greatNote | "大成功要5闪或旗舰128级以上+4闪" | "キラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定" | 两者值不同 |
| 43 | rewards.fuel | [2000,166] | [2000,167] | 两者值不同 |
| 43 | rewards.items | [{"name":"开发资材","count":4}] | [{"name":"開発資材","count":4,"min":0},{"name":"改修資材","count":1,"min":0}] | 两者值不同 |
| 43 | rewards.greatItems | [{"name":"改修资材","count":1}] | [] | 两者值不同 |
| 43 | difficulty | null | "S+" | wikiwiki 有 kcwiki 无 |
| 43 | descriptionJp | null | "大規模ミ船団の護衛作戦を行う。敵通商破壊部隊との会敵が予想される。護衛空母(または軽空母)を旗艦とする海上護衛部隊、出撃！【月一回実施可能・交戦遠征】" | wikiwiki 有 kcwiki 无 |
| 43 | useFuelText | null | "普通/85%" | wikiwiki 有 kcwiki 无 |
| 43 | useBullText | null | "普通/90%" | wikiwiki 有 kcwiki 无 |
| 43 | rawComposition | null | "全6隻。護衛空母(旗艦固定)1隻、(駆2隻or海防2隻 駆逐と海防1隻ずつでは不可)、他3隻 または 軽空母(旗艦固定)1隻、軽1隻、駆4隻必要 艦隊の合計値で、火力500 / 対空280 / 対潜280 / 索敵170 以上必要(装備込み。但し艦載機には補正が掛かる。詳細はこちらを参照。) (軽母(旗艦)1駆1海防3他1)(軽母(旗艦)1軽巡1海防2他2)(軽母(旗艦)1練巡1海防2他2)(軽母(旗艦)1護母1駆2他2)(軽母(旗艦)1護母1海防2他2)の編成でも成功する。詳しくは上記参照。 キラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定。詳細はこちらを参照。" | wikiwiki 有 kcwiki 无 |
| 44 | nameJp | "航空装備輸送任務" | "航空装備輸送任務 (マンスリー)" | 两者值不同 |
| 44 | nameZh | "航空装备输送任务" | null | kcwiki 有 wikiwiki 无 |
| 44 | composition | "空母(水母，护母可)*1-2 水母*1 轻巡*1 驱逐/海防*2 其他*1（待验证）" | "空母(水母,护卫空母可)*1、水母*1、轻巡*1、驱逐/海防*2、其他*1(要検証)" | 两者值不同 |
| 44 | escortText | "对潜≥200\n对空≥200\n索敌≥150\n至少3个舰娘\n各携带2个桶合计6个以上" | null | kcwiki 有 wikiwiki 无 |
| 44 | drumTotal | 2 | 6 | 两者值不同 |
| 44 | greatNote | "大成功要8桶以上+4闪" | "合計8個以上かつキラキラ艦4隻以上で大成功確定" | 两者值不同 |
| 44 | rewards.items | [{"name":"开发资材","count":4}] | [{"name":"開発資材","count":4,"min":0},{"name":"家具箱(大)","count":2,"min":0}] | 两者值不同 |
| 44 | rewards.greatItems | [{"name":"家具箱（大）","count":2}] | [] | 两者值不同 |
| 44 | difficulty | null | "S" | wikiwiki 有 kcwiki 无 |
| 44 | descriptionJp | null | "航空母艦2及び水上機母艦1を投入して、南西海域拠点への航空装備輸送作戦を実施せよ！可能な限り輸送用ドラム缶も積載されたし！【月一回実施可能遠征】" | wikiwiki 有 kcwiki 无 |
| 44 | useFuelText | null | "普通/80%" | wikiwiki 有 kcwiki 无 |
| 44 | useBullText | null | "普通/40%" | wikiwiki 有 kcwiki 无 |
| 44 | rawComposition | null | "「A4 南西方面連絡線哨戒」をクリアすると出現 全6隻。空母(水母,護母可)1隻、水母1隻、軽1隻、(駆+海防)2隻、他1隻必要(要検証)／「水母×2,軽×1,駆×3,任意の3隻にドラム缶各2つで合計6つ」 艦隊の合計値で、対空200 / 対潜200 / 索敵150 以上必要(装備込み。但し艦載機には補正が掛かる。詳細はこちらを参照。) 3隻以上にドラム缶(輸送用)が合計6個以上必要。合計8個以上かつキラキラ艦4隻以上で大成功確定。詳細はこちらを参照。" | wikiwiki 有 kcwiki 无 |
| 45 | nameZh | "铝土船团护卫" | null | kcwiki 有 wikiwiki 无 |
| 45 | composition | "护卫空母/轻空母（旗舰固定）*1，\n驱逐/海防*4" | null | kcwiki 有 wikiwiki 无 |
| 45 | escortText | "舰队合计对空≥240\n对潜≥300\n索敌≥180\n（数值包含装备，舰载机对空对潜数值不计算在内飞机补正值不计算在内）" | null | kcwiki 有 wikiwiki 无 |
| 45 | greatNote | "大成功要5闪或旗舰128级以上+4闪" | "キラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定" | 两者值不同 |
| 45 | rewards.items | [{"name":"家具箱（中）","count":1}] | [{"name":"家具箱(中)","count":1,"min":0}] | 两者值不同 |
| 45 | difficulty | null | "S" | wikiwiki 有 kcwiki 无 |
| 45 | descriptionJp | null | "海上護衛総隊によるボーキサイト輸送船団の護衛を実施する。護衛空母(または軽空母)を旗艦とする海上護衛部隊、抜錨せよ！" | wikiwiki 有 kcwiki 无 |
| 45 | useFuelText | null | "普通/60%" | wikiwiki 有 kcwiki 无 |
| 45 | useBullText | null | "普通/40%" | wikiwiki 有 kcwiki 无 |
| 45 | rawComposition | null | "最低5隻。護衛空母または軽空母(旗艦固定)1隻、(駆+海防)4隻必要 ／「護母×1,駆×4」 艦隊の合計値で、対空240 / 対潜300 / 索敵180 以上必要(装備込み。但し艦載機には補正が掛かる。詳細はこちらを参照。) キラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定。詳細はこちらを参照。" | wikiwiki 有 kcwiki 无 |
| 46 | tags | ["月常","交战II型"] | ["月常","交战型"] | 两者值不同 |
| 46 | nameJp | "南西海域戦闘哨戒" | "南西海域戦闘哨戒 (マンスリー・交戦II型)" | 两者值不同 |
| 46 | nameZh | "南西海域战斗警戒" | null | kcwiki 有 wikiwiki 无 |
| 46 | composition | "重巡*2 轻巡*1 驱逐*2 " | "重巡*2、轻巡*1、驱逐*2" | 两者值不同 |
| 46 | escortText | "舰队合计火力≥350\n对空≥250\n对潜≥220\n索敌≥190\n（数值包含装备，舰载机对空对潜数值不计算在内飞机补正值不计算在内）" | null | kcwiki 有 wikiwiki 无 |
| 46 | greatNote | "大成功要5闪或旗舰128级以上+4闪" | "キラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定" | 两者值不同 |
| 46 | combat | "交战II型" | "交战型" | 两者值不同 |
| 46 | rewards.fuel | [300,85] | [300,86] | 两者值不同 |
| 46 | rewards.steel | [150,42] | [150,43] | 两者值不同 |
| 46 | rewards.baux | [380,108] | [380,109] | 两者值不同 |
| 46 | rewards.items | [{"name":"开发资材","count":3}] | [{"name":"開発資材","count":3,"min":0},{"name":"改修資材","count":1,"min":0}] | 两者值不同 |
| 46 | rewards.greatItems | [{"name":"改修资材","count":1}] | [] | 两者值不同 |
| 46 | difficulty | null | "S+" | wikiwiki 有 kcwiki 无 |
| 46 | descriptionJp | null | "精強な重巡戦隊と水雷戦隊を中核とした有力なる艦隊で、南西海域深部を哨戒、敵艦隊を捜索！発見次第、これを撃滅せよ！【月一回実施可能・交戦遠征】" | wikiwiki 有 kcwiki 无 |
| 46 | useFuelText | null | "普通/75%" | wikiwiki 有 kcwiki 无 |
| 46 | useBullText | null | "普通/95%" | wikiwiki 有 kcwiki 无 |
| 46 | rawComposition | null | "最低5隻。重2隻、軽1隻、駆2隻必要 ／「重×2,軽×1,駆×2」 艦隊の合計値で、火力350 / 対空250 / 対潜220 / 索敵190 以上必要(装備込み。但し艦載機には補正が掛かる。詳細はこちらを参照。) キラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定。詳細はこちらを参照。" | wikiwiki 有 kcwiki 无 |
| A1 | nameZh | "兵站强化任务" | null | kcwiki 有 wikiwiki 无 |
| A1 | composition | "驱逐/海防*3\n其他*1" | "驱逐/海防*3、其他*1" | 两者值不同 |
| A1 | difficulty | null | "D" | wikiwiki 有 kcwiki 无 |
| A1 | descriptionJp | null | "港湾施設強化と兵站備蓄施設拡充に協力し、補給体制を強化せよ！" | wikiwiki 有 kcwiki 无 |
| A1 | useFuelText | null | "普通/40%" | wikiwiki 有 kcwiki 无 |
| A1 | useBullText | null | "なし" | wikiwiki 有 kcwiki 无 |
| A1 | rawComposition | null | "最低4隻。(駆+海防)3隻、他1隻必要。／「駆×4」" | wikiwiki 有 kcwiki 无 |
| A2 | nameZh | "海峡警备任务" | null | kcwiki 有 wikiwiki 无 |
| A2 | escortText | "总火力≥50\n总对空≥70\n总对潜≥180\n*含装备属性，但水侦，水爆，大艇的反潜值无效" | null | kcwiki 有 wikiwiki 无 |
| A2 | greatNote | "大成功要旗舰33级以上+5闪或旗舰128级以上+4闪" | "旗艦Lv33以上かつキラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定" | 两者值不同 |
| A2 | rewards.ammo | [40,43] | [40,44] | 两者值不同 |
| A2 | rewards.items | [{"name":"开发资材","count":1}] | [{"name":"高速修復材","count":1,"min":0},{"name":"開発資材","count":1,"min":0}] | 两者值不同 |
| A2 | rewards.greatItems | [{"name":"高速修复材","count":1}] | [] | 两者值不同 |
| A2 | difficulty | null | "C" | wikiwiki 有 kcwiki 无 |
| A2 | descriptionJp | null | "海防艦や駆逐艦による、沿岸警備部隊で、海峡警備を実施しよう！" | wikiwiki 有 kcwiki 无 |
| A2 | useFuelText | null | "普通/50%" | wikiwiki 有 kcwiki 无 |
| A2 | useBullText | null | "少量/20%" | wikiwiki 有 kcwiki 无 |
| A2 | rawComposition | null | "最低4隻。(駆+海防)4隻必要。／「駆×4」 艦隊の合計値で、火力50 / 対空70 / 対潜180 以上必要(装備込み。但し艦載機には補正が掛かる。詳細はこちらを参照。) 旗艦Lv33以上かつキラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定。詳細はこちらを参照。" | wikiwiki 有 kcwiki 无 |
| A3 | nameZh | "长时间对潜警戒" | null | kcwiki 有 wikiwiki 无 |
| A3 | composition | "轻巡*1 驱逐/海防*3 \n其他*1" | "轻巡*1、驱逐/海防*3、其他*1" | 两者值不同 |
| A3 | escortText | "总对潜≥280\n总索敌≥60" | null | kcwiki 有 wikiwiki 无 |
| A3 | greatNote | "大成功要5闪或旗舰128级以上+4闪" | "キラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定" | 两者值不同 |
| A3 | rewards.items | [{"name":"高速修复材","count":1}] | [{"name":"高速修復材","count":1,"min":0},{"name":"開発資材","count":2,"min":0}] | 两者值不同 |
| A3 | rewards.greatItems | [{"name":"开发资材","count":2}] | [] | 两者值不同 |
| A3 | difficulty | null | "B" | wikiwiki 有 kcwiki 无 |
| A3 | descriptionJp | null | "高練度の対潜部隊を展開、敵潜を制圧し、航路の安全を確保せよ！" | wikiwiki 有 kcwiki 无 |
| A3 | useFuelText | null | "普通/60%" | wikiwiki 有 kcwiki 无 |
| A3 | useBullText | null | "普通/30%" | wikiwiki 有 kcwiki 无 |
| A3 | rawComposition | null | "最低5隻。軽1隻、(駆+海防)3隻、他1隻必要。／「軽×1,駆×4」 艦隊の合計値で、 対潜280 / 索敵60 以上必要(装備込み。但し艦載機には補正が掛かる。詳細はこちらを参照。) (駆1海防3他1)(護母1駆2他2)(護母1海防2他2)(練巡1海防2他2)(軽1海防2他2)の編成でも成功する。詳しくは上記参照。 キラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定。詳細はこちらを参照。" | wikiwiki 有 kcwiki 无 |
| A4 | nameJp | "南西方面連絡線哨戒" | "南西方面連絡線哨戒 (マンスリー)" | 两者值不同 |
| A4 | nameZh | "南西方面联络线哨戒" | null | kcwiki 有 wikiwiki 无 |
| A4 | composition | "护卫空母/轻巡(必须旗舰) 驱逐*2 其他*2 \n或练巡旗舰+海防舰*2 其他*2" | "轻巡*1、驱逐*2、其他*2" | 两者值不同 |
| A4 | escortText | "总火力值≥300\n总对潜≥200\n总对空≥200\n索敌≥120\n含装备但不计算加成" | null | kcwiki 有 wikiwiki 无 |
| A4 | stats.火力 | null | 300 | wikiwiki 有 kcwiki 无 |
| A4 | greatNote | "大成功要5闪或旗舰128级以上+4闪" | "キラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定" | 两者值不同 |
| A4 | rewards.items | [{"name":"高速修复材","count":2}] | [{"name":"高速修復材","count":2,"min":0},{"name":"高速建造材","count":2,"min":0}] | 两者值不同 |
| A4 | rewards.greatItems | [{"name":"高速建造材","count":2}] | [] | 两者值不同 |
| A4 | difficulty | null | "S" | wikiwiki 有 kcwiki 无 |
| A4 | descriptionJp | null | "油田地帯航路の安全を確保する。対潜哨戒能力の高い海上護衛部隊を編成、南西方面連絡線に展開、同方面の対潜哨戒を実施せよ!【月一回実施可能遠征】" | wikiwiki 有 kcwiki 无 |
| A4 | useFuelText | null | "普通/75%" | wikiwiki 有 kcwiki 无 |
| A4 | useBullText | null | "普通/60%" | wikiwiki 有 kcwiki 无 |
| A4 | rawComposition | null | "最低5隻。軽1隻、駆2隻、他2隻必要。／「軽×1,駆×4」 艦隊の合計値で、火力300 / 対空200 / 対潜200 / 索敵120 以上必要(装備込み。但し艦載機には補正が掛かる。詳細はこちらを参照。) (駆1海防3他1)(護母1駆2他2)(護母1海防2他2)(練巡1海防2他2)(軽1海防2他2)の編成でも成功する。詳しくは上記参照。 キラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定。詳細はこちらを参照。" | wikiwiki 有 kcwiki 无 |
| A5 | tags | ["月常 交战型"] | ["月常","交战型"] | 两者值不同 |
| A5 | nameJp | "小笠原沖哨戒線" | "小笠原沖哨戒線 (マンスリー・交戦I型)" | 两者值不同 |
| A5 | nameZh | "小笠原群岛哨戒线" | null | kcwiki 有 wikiwiki 无 |
| A5 | composition | "轻巡*1 驱逐*3 其他*1" | "轻巡*1、驱逐*3、其他*1" | 两者值不同 |
| A5 | escortText | "总火力值280\n总对潜240\n总对空220\n总索敌150\n含装备" | null | kcwiki 有 wikiwiki 无 |
| A5 | stats.火力 | null | 280 | wikiwiki 有 kcwiki 无 |
| A5 | stats.对空 | null | 220 | wikiwiki 有 kcwiki 无 |
| A5 | stats.对潜 | null | 240 | wikiwiki 有 kcwiki 无 |
| A5 | stats.索敌 | null | 150 | wikiwiki 有 kcwiki 无 |
| A5 | greatNote | "大成功要5闪或旗舰128级以上+4闪" | "キラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定" | 两者值不同 |
| A5 | combat | "月常 交战型" | "交战型" | 两者值不同 |
| A5 | rewards.items | [{"name":"开发资材","count":4}] | [{"name":"高速修復材","count":3,"min":0},{"name":"開発資材","count":4,"min":0}] | 两者值不同 |
| A5 | rewards.greatItems | [{"name":"高速修复材","count":3}] | [] | 两者值不同 |
| A5 | difficulty | null | "S" | wikiwiki 有 kcwiki 无 |
| A5 | descriptionJp | null | "本土の守りの要、小笠原沖哨戒線に精強な哨戒小艦隊を展開する。敵遠征部隊との交戦に備え、練度装備の充実した戦隊を投入せよ！【月一回実施可能・交戦遠征】" | wikiwiki 有 kcwiki 无 |
| A5 | useFuelText | null | "普通/80%" | wikiwiki 有 kcwiki 无 |
| A5 | useBullText | null | "普通/75%" | wikiwiki 有 kcwiki 无 |
| A5 | rawComposition | null | "「A4 南西方面連絡線哨戒」及び「B3 南西諸島離島哨戒作戦」をクリアすると出現 最低5隻。軽1隻、駆3隻、他1隻必要。／「軽×1,駆×4」 艦隊の合計値で、火力280 / 対空220 / 対潜240 / 索敵150 以上必要(装備込み。但し艦載機には補正が掛かる。詳細はこちらを参照。) (駆1海防3他1)(護母1駆2他2)(護母1海防2他2)(練巡1海防2他2)(軽1海防2他2)の編成でも成功する。詳しくは上記参照。 キラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定。詳細はこちらを参照。" | wikiwiki 有 kcwiki 无 |
| A6 | tags | ["月常 交战II型"] | ["月常","交战型"] | 两者值不同 |
| A6 | nameJp | "小笠原沖戦闘哨戒" | "小笠原沖戦闘哨戒 (マンスリー・交戦II型)" | 两者值不同 |
| A6 | nameZh | "小笠原群岛战斗哨戒" | null | kcwiki 有 wikiwiki 无 |
| A6 | composition | "轻巡*1 驱逐*3 其他*2" | "轻巡*1、驱逐*3、其他*2" | 两者值不同 |
| A6 | escortText | "总火力值≥330\n总对潜≥270\n总对空≥300\n总索敌≥180\n含装备" | null | kcwiki 有 wikiwiki 无 |
| A6 | stats.火力 | null | 330 | wikiwiki 有 kcwiki 无 |
| A6 | greatNote | "大成功要5闪或旗舰128级以上+4闪" | "キラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定" | 两者值不同 |
| A6 | combat | "月常 交战II型" | "交战型" | 两者值不同 |
| A6 | rewards.fuel | [100,28] | [100,29] | 两者值不同 |
| A6 | rewards.ammo | [500,142] | [500,143] | 两者值不同 |
| A6 | rewards.steel | [100,28] | [100,29] | 两者值不同 |
| A6 | rewards.items | [{"name":"开发资材","count":5}] | [{"name":"開発資材","count":5,"min":0},{"name":"改修資材","count":1,"min":0}] | 两者值不同 |
| A6 | rewards.greatItems | [{"name":"改修资材","count":1}] | [] | 两者值不同 |
| A6 | difficulty | null | "S" | wikiwiki 有 kcwiki 无 |
| A6 | descriptionJp | null | "小笠原沖方面への敵部隊の接近を確認した！同方面防衛のため、最精鋭の哨戒艦隊を編成、同方面の戦闘哨戒を実施、敵を撃破せよ！【月一回実施可能・交戦遠征】" | wikiwiki 有 kcwiki 无 |
| A6 | useFuelText | null | "普通/90%" | wikiwiki 有 kcwiki 无 |
| A6 | useBullText | null | "普通/95%" | wikiwiki 有 kcwiki 无 |
| A6 | rawComposition | null | "「A5 小笠原沖哨戒線」及び「B4 南西諸島離島防衛作戦」をクリアすると出現 全6隻。軽1隻、駆3隻、他2隻必要。／「軽×1,駆×5」 艦隊の合計値で、火力330 / 対空300 / 対潜270 / 索敵180 以上必要(装備込み。但し艦載機には補正が掛かる。詳細はこちらを参照。) (駆1海防3他2)(護母1駆2他3)(護母1海防2他3)(練巡1海防2他3)(軽1海防2他3)の編成でも成功する。詳しくは上記参照。 キラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定。詳細はこちらを参照。" | wikiwiki 有 kcwiki 无 |
| B1 | nameZh | "南西方面航空侦察作战" | null | kcwiki 有 wikiwiki 无 |
| B1 | composition | "水母*1 (空母,轻母,潜水母舰不可)\n轻巡*1 驱逐/海防*2 其他*2" | "水母*1、轻巡*1、驱逐/海防*2、其他*2" | 两者值不同 |
| B1 | escortText | "总对空≥200\n总对潜≥200\n总索敌≥140" | null | kcwiki 有 wikiwiki 无 |
| B1 | rewards.items | [{"name":"家具箱（小）","count":1}] | [{"name":"高速修復材","count":1,"min":0}] | 两者值不同 |
| B1 | rewards.greatItems | [{"name":"高速修复材","count":1}] | [] | 两者值不同 |
| B1 | difficulty | null | "B" | wikiwiki 有 kcwiki 无 |
| B1 | descriptionJp | null | "索敵力の高い水上機母艦及び軽巡を伴う艦隊で敵情勢を偵察せよ！" | wikiwiki 有 kcwiki 无 |
| B1 | useFuelText | null | "普通/45%" | wikiwiki 有 kcwiki 无 |
| B1 | useBullText | null | "少量/15%" | wikiwiki 有 kcwiki 无 |
| B1 | rawComposition | null | "全6隻。水母1隻、軽1隻、(駆+海防)2隻、他2隻必要／「水母×1,軽×1,駆×4」 艦隊の合計値で、対空200 / 対潜200 / 索敵140 以上必要(装備込み。但し艦載機には補正が掛かる。詳細はこちらを参照。）" | wikiwiki 有 kcwiki 无 |
| B2 | nameJp | "敵泊地強襲反撃作戦" | "敵泊地強襲反撃作戦 (マンスリー)" | 两者值不同 |
| B2 | nameZh | "敌方泊地强袭反击作战" | null | kcwiki 有 wikiwiki 无 |
| B2 | composition | "重巡*1 轻巡*1 驱逐*3 其他*1" | "重巡*1、轻巡*1、驱逐*3、其他*1" | 两者值不同 |
| B2 | escortText | "总火力≥360\n对空≥160\n对潜≥160\n索敌≥140" | null | kcwiki 有 wikiwiki 无 |
| B2 | rewards.items | [{"name":"开发资材","count":2}] | [{"name":"高速修復材","count":2,"min":0},{"name":"開発資材","count":2,"min":0}] | 两者值不同 |
| B2 | rewards.greatItems | [{"name":"高速修复材","count":2}] | [] | 两者值不同 |
| B2 | difficulty | null | "B" | wikiwiki 有 kcwiki 无 |
| B2 | descriptionJp | null | "重巡1軽巡1と精強駆逐隊による最精鋭艦隊で敵泊地を強襲せよ！【月一回実施可能遠征】" | wikiwiki 有 kcwiki 无 |
| B2 | useFuelText | null | "大量/80%" | wikiwiki 有 kcwiki 无 |
| B2 | useBullText | null | "普通/65%" | wikiwiki 有 kcwiki 无 |
| B2 | rawComposition | null | "全6隻。重1隻、軽1隻、駆3隻、他1隻必要。／「重×1,軽×1,駆×4」 艦隊の合計値で、火力360 / 対空160 / 対潜160 / 索敵140 以上必要(装備込み。但し艦載機には補正が掛かる。詳細はこちらを参照。)" | wikiwiki 有 kcwiki 无 |
| B3 | nameJp | "南西諸島離島哨戒作戦" | "南西諸島離島哨戒作戦 (マンスリー)" | 两者值不同 |
| B3 | nameZh | "南西诸岛离岛哨戒作战" | null | kcwiki 有 wikiwiki 无 |
| B3 | composition | "水母*1 轻巡*1 驱逐/海防*4" | "水母*1、轻巡*1、驱逐/海防*4" | 两者值不同 |
| B3 | escortText | "总火力≥400\n对潜≥220\n对空≥220\n索敌≥190" | null | kcwiki 有 wikiwiki 无 |
| B3 | greatNote | "大成功要5闪或旗舰128级以上+4闪" | "キラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定" | 两者值不同 |
| B3 | rewards.baux | [180,63] | [180,64] | 两者值不同 |
| B3 | rewards.items | [{"name":"家具箱（大）","count":1}] | [{"name":"高速修復材","count":2,"min":0}] | 两者值不同 |
| B3 | rewards.greatItems | [{"name":"高速修复材","count":2}] | [] | 两者值不同 |
| B3 | difficulty | null | "S" | wikiwiki 有 kcwiki 无 |
| B3 | descriptionJp | null | "水上機母艦と護衛水雷戦隊による哨戒部隊を編成、南西諸島海域の哨戒作戦を実施せよ！【月一回実施可能遠征】" | wikiwiki 有 kcwiki 无 |
| B3 | useFuelText | null | "普通/65%" | wikiwiki 有 kcwiki 无 |
| B3 | useBullText | null | "普通/80%" | wikiwiki 有 kcwiki 无 |
| B3 | rawComposition | null | "全6隻。水母1隻、軽1隻、(駆+海防)4隻必要。／「水母×1,軽×1,駆×4」 艦隊の合計値で、火力400 / 対空220 / 対潜220 / 索敵190 以上必要(装備込み。但し艦載機には補正が掛かる。詳細はこちらを参照。) キラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定。詳細はこちらを参照。" | wikiwiki 有 kcwiki 无 |
| B4 | tags | ["月常 交战型"] | ["月常","交战型"] | 两者值不同 |
| B4 | nameJp | "南西諸島離島防衛作戦" | "南西諸島離島防衛作戦 (マンスリー・交戦I型)" | 两者值不同 |
| B4 | nameZh | "南西诸岛离岛防御作战" | null | kcwiki 有 wikiwiki 无 |
| B4 | composition | "重巡*2 轻巡*1 驱逐*2 潜水*1" | "重巡*2、轻巡*1、驱逐*2、潜水*1" | 两者值不同 |
| B4 | escortText | "总火力(含改修)≥500\n总对潜≥280(水上机对潜可能不计)\n对空≥280\n索敌≥170" | null | kcwiki 有 wikiwiki 无 |
| B4 | stats.火力 | null | 500 | wikiwiki 有 kcwiki 无 |
| B4 | greatNote | "大成功要5闪或旗舰128级以上+4闪" | "キラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定" | 两者值不同 |
| B4 | combat | "月常 交战型" | "交战型" | 两者值不同 |
| B4 | rewards.baux | [650,86] | [650,87] | 两者值不同 |
| B4 | rewards.items | [{"name":"开发资材","count":4}] | [{"name":"開発資材","count":4,"min":0},{"name":"改修資材","count":1,"min":0}] | 两者值不同 |
| B4 | rewards.greatItems | [{"name":"改修资材","count":1}] | [] | 两者值不同 |
| B4 | difficulty | null | "S+" | wikiwiki 有 kcwiki 无 |
| B4 | descriptionJp | null | "重巡2軽巡1駆逐艦2、さらに潜水艦1隻を含む、精強な遊撃部隊を編成。同遊撃部隊による南西諸島海域防衛作戦を実施せよ！【月一回実施可能遠征】※交戦遠征" | wikiwiki 有 kcwiki 无 |
| B4 | useFuelText | null | "普通/85%" | wikiwiki 有 kcwiki 无 |
| B4 | useBullText | null | "普通/85%" | wikiwiki 有 kcwiki 无 |
| B4 | rawComposition | null | "全6隻。重2隻、軽1隻、駆2隻、潜1隻必要。／「重×2,軽×1,駆×2,潜×1」 艦隊の合計値で、火力500 / 対空280 / 対潜280 / 索敵170 以上必要(装備込み。但し艦載機には補正が掛かる。詳細はこちらを参照。) キラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定。詳細はこちらを参照。" | wikiwiki 有 kcwiki 无 |
| B5 | tags | ["月常 交战II型"] | ["月常","交战型"] | 两者值不同 |
| B5 | nameJp | "南西諸島捜索撃滅戦" | "南西諸島捜索撃滅戦 (マンスリー・交戦II型)" | 两者值不同 |
| B5 | nameZh | "南西诸岛搜索歼灭战" | null | kcwiki 有 wikiwiki 无 |
| B5 | composition | "水母*1 轻巡*1 驱逐*2 其他*2\n舰载机的各种补正不算在内" | "水母*1、轻巡*1、驱逐*2、其他*2" | 两者值不同 |
| B5 | escortText | "总火力≥510\n对空≥400\n对潜≥285\n索敌≥385" | null | kcwiki 有 wikiwiki 无 |
| B5 | greatNote | "大成功要5闪或旗舰128级以上+4闪" | "キラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定" | 两者值不同 |
| B5 | combat | "月常 交战II型" | "交战型" | 两者值不同 |
| B5 | rewards.fuel | [500,76] | [500,77] | 两者值不同 |
| B5 | rewards.ammo | [500,76] | [500,77] | 两者值不同 |
| B5 | rewards.steel | [1000,153] | [1000,154] | 两者值不同 |
| B5 | rewards.items | [{"name":"高速修复材","count":4}] | [{"name":"高速修復材","count":4,"min":0},{"name":"改修資材","count":1,"min":0}] | 两者值不同 |
| B5 | rewards.greatItems | [{"name":"改修资材","count":1}] | [] | 两者值不同 |
| B5 | difficulty | null | "S+" | wikiwiki 有 kcwiki 无 |
| B5 | descriptionJp | null | "水上機母艦1軽巡1駆逐艦2を含む精鋭の捜索機動部隊を編成。南西諸島方面で索敵撃滅戦を展開、敵艦隊を捜索、これを撃破せよ！【月一回実施可能・交戦遠征】" | wikiwiki 有 kcwiki 无 |
| B5 | useFuelText | null | "普通/90%" | wikiwiki 有 kcwiki 无 |
| B5 | useBullText | null | "普通/95%" | wikiwiki 有 kcwiki 无 |
| B5 | rawComposition | null | "全6隻。水母1隻、軽1隻、駆2隻、他2隻必要。／「水母×1,軽×1,駆×4」 艦隊の合計値で、火力510 / 対空400 / 対潜285 / 索敵385 以上必要(装備込み。但し艦載機には補正が掛かる。詳細はこちらを参照。) キラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定。詳細はこちらを参照。" | wikiwiki 有 kcwiki 无 |
| B6 | tags | ["月常 交战II型"] | ["月常","交战型"] | 两者值不同 |
| B6 | nameJp | "精鋭水雷戦隊夜襲" | "精鋭水雷戦隊夜襲 (マンスリー・交戦II型)" | 两者值不同 |
| B6 | nameZh | "精锐水雷战队夜袭战" | null | kcwiki 有 wikiwiki 无 |
| B6 | composition | "轻巡*1（固定旗舰） 驱逐*5\n舰载机的各种补正不算在内" | "轻巡(必须旗舰)*1、驱逐*5" | 两者值不同 |
| B6 | escortText | "总火力≥410\n对空≥390\n对潜≥410\n索敌≥340" | null | kcwiki 有 wikiwiki 无 |
| B6 | greatNote | "大成功要5闪或旗舰128级以上+4闪（待验证）" | "キラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定？" | 两者值不同 |
| B6 | combat | "月常 交战II型" | "交战型" | 两者值不同 |
| B6 | rewards.fuel | [600,102] | [600,103] | 两者值不同 |
| B6 | rewards.steel | [600,102] | [600,103] | 两者值不同 |
| B6 | rewards.baux | [600,102] | [600,103] | 两者值不同 |
| B6 | rewards.items | [{"name":"开发资材","count":5}] | [{"name":"開発資材","count":5,"min":0},{"name":"改修資材","count":1,"min":0}] | 两者值不同 |
| B6 | rewards.greatItems | [{"name":"改修资材","count":1}] | [] | 两者值不同 |
| B6 | difficulty | null | "S+" | wikiwiki 有 kcwiki 无 |
| B6 | descriptionJp | null | "精鋭無比の軽巡が率いる、軽巡1駆逐艦5からなる精強な水雷戦隊を編成、敵泊地への夜襲を敢行、敵艦隊を痛撃せよ！【月一回実施可能・交戦遠征】" | wikiwiki 有 kcwiki 无 |
| B6 | useFuelText | null | "普通/95%" | wikiwiki 有 kcwiki 无 |
| B6 | useBullText | null | "普通/95%" | wikiwiki 有 kcwiki 无 |
| B6 | rawComposition | null | "「A4 南西方面連絡線哨戒」及び「B4 南西諸島離島防衛作戦」をクリアすると出現 全6隻。軽(旗艦固定)1隻、駆5隻必要。／「軽×1,駆×5」 艦隊の合計値で、火力410 / 対空390 / 対潜410 / 索敵340 以上必要(装備込み。但し艦載機には補正が掛かる。詳細はこちらを参照。) キラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定？。詳細はこちらを参照。" | wikiwiki 有 kcwiki 无 |
| D1 | nameZh | "西方海域侦察作战" | null | kcwiki 有 wikiwiki 无 |
| D1 | composition | "水母（旗舰固定）*1\n驱逐*3 其他*1(待验证)" | "水母(必须旗舰)*1、驱逐*3 、其他*1(要検証)" | 两者值不同 |
| D1 | escortText | "全舰队对潜≥240\n对空≥240\n索敌≥300\n（均为含装备数值）" | null | kcwiki 有 wikiwiki 无 |
| D1 | greatNote | null | "キラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定" | wikiwiki 有 kcwiki 无 |
| D1 | rewards.shipExp | 40 | 45 | 两者值不同 |
| D1 | rewards.items | [{"name":"高速修复材","count":1}] | [{"name":"高速修復材","count":1,"min":0}] | 两者值不同 |
| D1 | difficulty | null | "S" | wikiwiki 有 kcwiki 无 |
| D1 | descriptionJp | null | "索敵能力の高い水上機母艦を旗艦とする偵察艦隊を編成し、西方海域敵情勢の偵察を実施せよ！" | wikiwiki 有 kcwiki 无 |
| D1 | useFuelText | null | "大量/75%" | wikiwiki 有 kcwiki 无 |
| D1 | useBullText | null | "普通/50%" | wikiwiki 有 kcwiki 无 |
| D1 | rawComposition | null | "最低5隻。水母(旗艦固定)1隻、駆3隻 、他1隻必要(要検証) ／「水母×1,駆×4」 艦隊の合計値で、対空240 / 対潜240 / 索敵300 以上必要(装備込み。但し艦載機には補正が掛かる。詳細はこちらを参照。) キラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定。詳細はこちらを参照。" | wikiwiki 有 kcwiki 无 |
| D2 | tags | ["月常 交战型"] | ["月常","交战型"] | 两者值不同 |
| D2 | nameJp | "西方潜水艦作戦" | "西方潜水艦作戦 (マンスリー・交戦I型)" | 两者值不同 |
| D2 | nameZh | "西方潜水艇作战" | null | kcwiki 有 wikiwiki 无 |
| D2 | composition | "潜水母舰（旗舰固定，潜水空母不可）*1\n潜水艇*3\n其他*1" | "潜水母舰(潜水水空母ではない 迅鯨型、改氷川丸級、改造前の大鯨を指す)(必须旗舰)*1、潜水*3、其他*1" | 两者值不同 |
| D2 | escortText | "总火力≥60\n对空≥80\n对潜≥50\n（计算装备数值）" | null | kcwiki 有 wikiwiki 无 |
| D2 | stats.索敌 | null | 70 | wikiwiki 有 kcwiki 无 |
| D2 | greatNote | null | "キラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定" | wikiwiki 有 kcwiki 无 |
| D2 | combat | "月常 交战型" | "交战型" | 两者值不同 |
| D2 | rewards.items | [{"name":"伊良湖","count":1}] | [{"name":"家具箱(大)","count":1,"min":0}] | 两者值不同 |
| D2 | rewards.greatItems | [{"name":"家具箱（大）","count":1}] | [] | 两者值不同 |
| D2 | difficulty | null | "S" | wikiwiki 有 kcwiki 无 |
| D2 | descriptionJp | null | "潜水母艦を旗艦として潜水艦3隻以上から構成される精強な潜水艦隊を編成、西方海域に進出、潜水艦作戦を実施せよ！【月一回実施可能・交戦遠征】" | wikiwiki 有 kcwiki 无 |
| D2 | useFuelText | null | "普通/90%" | wikiwiki 有 kcwiki 无 |
| D2 | useBullText | null | "普通/90%" | wikiwiki 有 kcwiki 无 |
| D2 | rawComposition | null | "最低5隻。潜水母艦(潜水空母ではない。迅鯨型、改氷川丸級、改造前の大鯨を指す)(旗艦固定)1隻、潜3隻、他1隻必要／「潜母艦×1,潜×3,駆×1」 艦隊の合計値で、火力60 / 対空80 / 対潜50 / 索敵70 以上必要(装備込み。但し艦載機には補正が掛かる。詳細はこちらを参照。) キラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定。詳細はこちらを参照。" | wikiwiki 有 kcwiki 无 |
| D3 | tags | ["月常 交战II型"] | ["月常","交战型"] | 两者值不同 |
| D3 | nameJp | "欧州方面友軍との接触" | "欧州方面友軍との接触 (マンスリー・交戦II型)" | 两者值不同 |
| D3 | nameZh | "与欧洲方面友军的接触" | null | kcwiki 有 wikiwiki 无 |
| D3 | composition | "潜水母舰（旗舰固定，潜水空母不可）*1\n潜水艇*3\n其他*1" | "潜水母舰(潜水水空母ではない 迅鯨型、改氷川丸級、改造前の大鯨を指す)(必须旗舰)*1、潜水*3、其他*1" | 两者值不同 |
| D3 | escortText | "总火力≥115\n对空≥90\n对潜≥70\n索敌≥95\n（计算装备数值）" | null | kcwiki 有 wikiwiki 无 |
| D3 | greatNote | null | "キラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定？" | wikiwiki 有 kcwiki 无 |
| D3 | combat | "月常 交战II型" | "交战型" | 两者值不同 |
| D3 | rewards.fuel | [0,null] | null | kcwiki 有 wikiwiki 无 |
| D3 | rewards.ammo | [800,null] | [800,67] | 两者值不同 |
| D3 | rewards.steel | [500,null] | [500,42] | 两者值不同 |
| D3 | rewards.baux | [400,null] | [400,33] | 两者值不同 |
| D3 | rewards.items | [{"name":"高速修复材","count":3}] | [{"name":"高速修復材","count":3,"min":0},{"name":"改修資材","count":1,"min":0}] | 两者值不同 |
| D3 | rewards.greatItems | [{"name":"改修资材","count":1}] | [] | 两者值不同 |
| D3 | difficulty | null | "S+" | wikiwiki 有 kcwiki 无 |
| D3 | descriptionJp | null | "旗艦に潜水母艦、同随伴護衛艦艇と潜水艦3隻以上から構成される西方潜水艦隊で戦線を強行突破、欧州方面友軍艦隊と接触を図れ！【月一回実施可能・交戦遠征】" | wikiwiki 有 kcwiki 无 |
| D3 | useFuelText | null | "普通/90%" | wikiwiki 有 kcwiki 无 |
| D3 | useBullText | null | "普通/95%" | wikiwiki 有 kcwiki 无 |
| D3 | rawComposition | null | "最低5隻。潜水母艦(潜水空母ではない。迅鯨型、改氷川丸級、改造前の大鯨を指す)(旗艦固定)1隻、潜3隻、他1隻必要／「潜母艦×1,潜×3,駆×1」 艦隊の合計値で、火力115 / 対空90 / 対潜70 / 索敵95 以上必要(装備込み。但し艦載機には補正が掛かる。詳細はこちらを参照。) キラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定？。詳細はこちらを参照。" | wikiwiki 有 kcwiki 无 |
| E1 | tags | ["月常","交战II型","月常 交战II型"] | ["月常","交战型"] | 两者值不同 |
| E1 | nameJp | "ラバウル方面艦隊進出" | "ラバウル方面艦隊進出 (マンスリー・交戦II型)" | 两者值不同 |
| E1 | nameZh | "拉包尔方面舰队前进" | null | kcwiki 有 wikiwiki 无 |
| E1 | time | "7:30" | "07:30" | 两者值不同 |
| E1 | composition | "重巡*1（旗舰固定） 轻巡*1 驱逐*3 其他*1" | "重巡(必须旗舰)*1、轻巡*1、驱逐*3、其他*1" | 两者值不同 |
| E1 | escortText | "总火力≥450\n对空≥350\n对潜≥330\n索敌≥250\n（均含装备，舰载机可能有数值调整）" | null | kcwiki 有 wikiwiki 无 |
| E1 | greatNote | "大成功要5闪或旗舰128级以上+4闪" | "キラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定" | 两者值不同 |
| E1 | combat | "交战II型" | "交战型" | 两者值不同 |
| E1 | rewards.items | [{"name":"家具箱（大）","count":2}] | [{"name":"改修資材","count":1,"min":0},{"name":"家具箱(大)","count":2,"min":0}] | 两者值不同 |
| E1 | rewards.greatItems | [{"name":"改修资材","count":1}] | [] | 两者值不同 |
| E1 | difficulty | null | "S+" | wikiwiki 有 kcwiki 无 |
| E1 | descriptionJp | null | "重巡旗艦、軽巡1駆逐艦3を含む艦隊を南方海域の要衝、ラバウル方面に進出させる。同海域周辺は敵空襲も予想される。注意せよ！【月一回実施可能・交戦遠征】" | wikiwiki 有 kcwiki 无 |
| E1 | useFuelText | null | "普通/95%" | wikiwiki 有 kcwiki 无 |
| E1 | useBullText | null | "普通/85%" | wikiwiki 有 kcwiki 无 |
| E1 | rawComposition | null | "全6隻。重(旗艦固定)1隻、軽1隻、駆3隻、他1隻必要 ／「重×1,軽×1,駆×4」 艦隊の合計値で、火力450 / 対空350 / 対潜330 / 索敵250 以上必要(装備込み。但し艦載機には補正が掛かる。詳細はこちらを参照。) キラキラ艦5隻以上、または旗艦Lv128以上かつキラキラ艦4隻以上でも大成功確定。詳細はこちらを参照。" | wikiwiki 有 kcwiki 无 |
| E2 | tags | ["月常","交战II型","月常 交战II型"] | ["月常","交战型"] | 两者值不同 |
| E2 | nameJp | "強行鼠輸送作戦" | "強行鼠輸送作戦 (マンスリー・交戦II型)" | 两者值不同 |
| E2 | nameZh | "强行鼠运输作战" | null | kcwiki 有 wikiwiki 无 |
| E2 | time | "3:05" | "03:05" | 两者值不同 |
| E2 | escortText | "总火力≥280\n对空≥240\n对潜≥200\n索敌≥160\n（均含装备，舰载机可能有数值调整）\n至少3个舰娘\n携带4个桶以上" | null | kcwiki 有 wikiwiki 无 |
| E2 | greatNote | "大成功要6桶以上+4闪" | "合計6個以上かつキラキラ艦4隻以上で大成功確定" | 两者值不同 |
| E2 | combat | "交战II型" | "交战型" | 两者值不同 |
| E2 | rewards.ammo | [480,160] | [480,156] | 两者值不同 |
| E2 | rewards.items | [{"name":"高速修复材","count":2}] | [{"name":"高速修復材","count":2,"min":0},{"name":"改修資材","count":1,"min":0}] | 两者值不同 |
| E2 | rewards.greatItems | [{"name":"改修资材","count":1}] | [] | 两者值不同 |
| E2 | difficulty | null | "S+" | wikiwiki 有 kcwiki 无 |
| E2 | descriptionJp | null | "精鋭駆逐艦を連ねて輸送ドラム缶を満載し、南方への強行鼠輸送作戦を遂行せよ！敵の待ち伏せも予想される。戦闘準備も怠るな！【月一回実施可能・交戦遠征】" | wikiwiki 有 kcwiki 无 |
| E2 | useFuelText | null | "普通/90%" | wikiwiki 有 kcwiki 无 |
| E2 | useBullText | null | "普通/95%" | wikiwiki 有 kcwiki 无 |
| E2 | rawComposition | null | "最低5隻。駆5隻必要 ／「駆×5,任意の3隻にドラム缶を合計4つ」 艦隊の合計値で、火力280 / 対空240 / 対潜200 / 索敵160 以上必要(装備込み。但し艦載機には補正が掛かる。詳細はこちらを参照。) 3隻以上にドラム缶(輸送用)が合計4個以上必要。合計6個以上かつキラキラ艦4隻以上で大成功確定。詳細はこちらを参照。" | wikiwiki 有 kcwiki 无 |

## 运行时与护栏

bi 只查询 kcwiki-expedition 与 expedition-facts，中文名固定 kcwiki；属性与奖励按子字段覆盖。
编成检查与推荐均使用 compositionBranches；原文不再承担已登记分支的解析。
大成功条件转换为既有中文句式，再走原有大成功行（wait，不计 fails）。
夹具保存旧开发机合并的结构化语义与独立例外表，测试直接逐格对照运行时合并；无需 wikiwiki 包。
生成器 --check 校对事实包与维护者基线；--update-fixture 是显式更新对账基线，普通生成不改夹具。
生成与 --check 均通过既有 openLedgerDb 只读游戏报文 events，按 api_quest_name 对应远征 id。
仅取 api_clear_result=1 的 api_get_ship_exp.slice(1) 最小值；旗舰 ×1.5 向下取整与大成功 ×2 均排除，不反推基础经验。
控制台逐项报告全部已跑远征的结算数、普通成功样本数、实测值、当前值和 wikiwiki 值；无普通成功样本明确记为 null。
游戏报文差异只报、不自动写事实包或夹具；后续确认后仍走维护者订正，evidence 写「游戏结算报文核对（维护者核 2026-09-06） 日期」。D1 当前待游戏结算报文核对（维护者核 2026-09-06）。

## 玩家文案逐字登记

条件检查的行模板原样保留。D1/D2 新补出的说明为「大成功：大成功要5闪或旗舰128级以上+4闪」。
D3 为「大成功：大成功要5闪或旗舰128级以上+4闪（待验证）」。两者沿用 kcwiki 其它远征已有中文句式。
40 为「大成功：大成功要4桶以上+4闪」，原有中文不变。
新增包名「远征条件（第一方登记）」；来源「kuma 第一方登记表」；悬停说明「远征的舰队条件与大成功条件」。
维护者健康度影响文案「远征卷缺少部分舰队属性门槛、运输桶总量、可行编成与大成功条件」。
使用说明仅从不随包限制中去除已经退役的远征日文对照，未新增措辞。

## 任务书修正

原单要求 24/40 总量普通检查回来有误，以续单裁定为准。日文文字退出不算对账失败。
示例 fleet/transport 与实际 bi 字段不一致，实际使用 stats/drumTotal。
63 项并非只有所点名的门槛差异；奖励与编成等冲突不能照抄 wikiwiki。
