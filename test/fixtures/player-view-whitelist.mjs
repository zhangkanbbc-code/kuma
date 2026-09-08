// 2026-09-06：改造需求 chip 原 9 格迁入事实表后命中零，按退役流程删除；见 remodel-facts-report。
// 2026-09-06 结构分档返工：玩家／开发机各1611格、差异0；逐组指纹复核无漂移，改造白名单维持退役，不新增豁免。
// 2026-09-06 施工单的存量差异登记。每组锁定全部格键与两侧值，不是整域通配。
// 除日文带路的明确裁决外，登记不表示资料正确或可永久缺失；样例与挂牌见 docs/player-view-audit.md。
export const PLAYER_VIEW_WHITELIST = [
  {
    "domain": "舰娘实时字幕",
    "reason": "2026-09-07 本机 wikiwiki 底本按规律①～④与新增规律⑤重归一化；wikiwiki 春雨改二 975 的 19/20 与随包 subtitle-ja 405/323 及舰娘百科春雨 205-LightDmg1/2 一致，19 为「きゃぁっ！」、20 为「や、やめて～！」，两侧这两格实时字幕不再有差异。舰娘实时字幕差异数由 733→726；剩余差异仍按最终格键与两侧值重锁，非整域豁免。2026-09-08 补三隈改二与春雨改二常规及报时自译：502 的 11/17/18 与 975 的 3 改为本形态原句的自译，更新既有差异 4 格；975 另 41 格由上游译文变为第一方译文，与开发机层所用上游译文形成措辞差异，合计 726→767。改前包复现旧指纹，逐格核对仅涉及 502/975；继续锁定全部格键与两侧值。",
    "decidedAt": "2026-09-08",
    "cells": 767,
    "fingerprint": "7fbacf6179abe364e1f62175348bd4ecdb6fe79d6b6b36cacc7f5db613f70e49"
  },
  {
    "domain": "活动敌编成",
    "reason": "event-map-intel 未覆盖的节点编成仍由本机 map-intel 补缺；登记本次存量，禁止扩大缺格。",
    "decidedAt": "2026-09-06",
    "cells": 154,
    "fingerprint": "211372835ad321e24745fc2cd2cc4fe61a45424faaed107d7ca5c56f4184829f"
  },
  {
    "domain": "活动机关",
    "reason": "仅 E4 四难度机关：本机 map-intel 补入随包整域未收的分组。2026-09-06 E1 丙 P1 C2/C3 订正后复核仍为这 4 格、指纹不变；未命中零，保留登记，禁止扩大差异。",
    "decidedAt": "2026-09-06",
    "cells": 4,
    "fingerprint": "751f36686931b75eb3df09cd35508c39eb39a6aed5f7337aa63a702bff61e323"
  },
  {
    "domain": "活动航程",
    "reason": "随包活动层只有部分节点航程，用户 map-intel 补齐其余节点；登记本次存量，禁止扩大缺格。",
    "decidedAt": "2026-09-06",
    "cells": 308,
    "fingerprint": "5bef1307a2c0006d6f718eda36b4a1e31444010bb412bc35b84dcc9c1da10e1c"
  },
  {
    "domain": "装备说明",
    "reason": "随包明石说明优先，本机 akashi-list 补随包缺失的说明；玩家对应说明显示待补。",
    "decidedAt": "2026-09-06",
    "cells": 35,
    "fingerprint": "8410a01718af27c70fedb83d771b8f13bbae7c5377f1bb10ca9d8c775285d08c"
  },
  {
    "domain": "任务前置链",
    "reason": "wikiwiki-quests 补缺、悬空修补及冲突信息仍属用户层；2026-09-06 B211、F48 裁决后为 1169 格；本次 B216 按 wikiwiki、kobayangame、zekamashi 三家正面主张裁为 B207（待实测），kcwiki/tsunkit 空栏为未登记，不作无前置主张。B216 的 pre/0、source 差异 2 格消失，既有仲裁分支标记两 wiki 集合不同使 conflict 新增 1 格，净减 1 格至 1168；wwPre/0 及其余格键与两侧值不变。",
    "decidedAt": "2026-09-06",
    "cells": 1168,
    "fingerprint": "1abae3a2c7b3e9b4cea827a4bfb3920d3b7729035684f96f637219e9d6019421"
  },
  {
    "domain": "图鉴台词卷",
    "reason": "2026-09-07 本机 wikiwiki 底本按规律①～④与新增规律⑤重归一化；wikiwiki 春雨改二 975 的 19/20 与随包 subtitle-ja 405/323 及舰娘百科春雨 205-LightDmg1/2 一致，19 为「きゃぁっ！」、20 为「や、やめて～！」，两侧图鉴中 975 两行「小破1/小破2」场合标签不再有差异。图鉴台词卷差异数由 3307→3279；剩余差异仍按最终格键与两侧值重锁，非整域豁免。2026-09-08 补三隈改二与春雨改二常规及报时自译后，502 消除 147 格（含婚后秘书舰台词）、975 消除 150 格，合计 3279→2982；无新增或改值差异。改前包复现旧指纹，其余形态与消费域未漂移；继续锁定全部格键与两侧值。2026-09-08 补 Glorious 四形态 16 行后，741 婚后秘书舰的无槽回退行退出，消除 ja／scene／zh 三格差异，2982→2979；改前包在内存中复现旧指纹，无新增或改值差异，其余消费域指纹不变。",
    "decidedAt": "2026-09-08",
    "cells": 2979,
    "fingerprint": "559e2ba2f4ac6dcb8625b066dc357bb74bea2aa06c3eb9ea43ddb1178230f65d"
  },
  {
    "domain": "深海台词卷",
    "reason": "随包深海自译优先，本机 wikiwiki-abyss-voice 仍给部分形态补行；页签与正文一并登记存量。",
    "decidedAt": "2026-09-06",
    "cells": 410,
    "fingerprint": "345279ff4f8ad343e7c6d4d6e5f07ca32c53d14a94e32ca4903db2daf98e40c1"
  },
  {
    "domain": "舰娘档案",
    "reason": "kcwiki-ships 未收录的五个形态仍由 wikiwiki-ship-profile 补身份与初期装备；玩家有既有未收录提示。",
    "decidedAt": "2026-09-06",
    "cells": 10,
    "fingerprint": "08b881e12ed34d354f033752d0c117ab7811aec642ff48c24d128a1e5238513a"
  },
  {
    "domain": "日文带路说明",
    "reason": "wikiwiki-routing 日文一手说明不随包；本单给定的他 2026-09-06 裁不做，玩家不显示该小节。",
    "decidedAt": "2026-09-06",
    "cells": 37,
    "fingerprint": "155c70243e4061a74e0d8043d116fd44645f1f71e1718e0e8a93ed2d6e51b7c2"
  }
]
