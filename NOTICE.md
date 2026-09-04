# 第三方代码与数据出处

## 许可范围

仓库根目录那份 `LICENSE`（MIT）**只管代码**

随包的资料与美术不在它的范围里。那些各有各的许可，逐项写在下面。
其中几份带「非商业性使用」条款，连带把整个发行版限成非商业用途

拿走某一份随包资料之前，请照它自己那一栏的条款来，不要按 MIT 处理

---

kuma 移植了 [poi](https://github.com/poooi/poi)（MIT License,
Copyright (c) 2015-2021 poi contributors）的下列文件。移植文件均在文件头
保留出处标注；poi 原始许可证全文附于本文件末尾

| kuma 文件 | poi 来源 | 说明 |
|---|---|---|
| `assets/preload/xhr-hack.js` | `assets/js/xhr-hack.js` | 主世界 XHR 截获 |
| `assets/preload/webview-preload.js` | `assets/js/webview-preload.js` | 隔离世界桥 + 输入校验 |
| `assets/preload/cookie-hack.js` | `assets/js/cookie-hack.js` | DMM 地区 cookie / UA / 重定向 |
| `assets/preload/resource-hack.js` | `assets/js/resource-hack.js` | 图片 CORS / 登录脚本恢复 |
| `assets/preload/page-align.js` | `assets/js/page-align.js` | 游戏页面对齐 CSS |
| `assets/preload/disable-tab.js` | `assets/js/disable-tab.js` | Tab 键屏蔽 |
| `assets/preload/capture-page.js` | `assets/js/capture-page.js` | canvas 截图 |
| `assets/preload/kcs-resource-path.js` | `assets/js/kcs-resource-path.js` | 缓存路径逻辑 |
| `src/shared/ship-special-attack.ts` | `views/utils/combat/aaci/*`、`views/utils/combat/oasw.ts` | 对空CI 一览表与先制对潜发动条件（poi 侧另自 KC3Kai 移植，见文件头） |
| `src/main/kcs-resource.ts` | `lib/kcs-resource.ts` | 特权 scheme 资源服务 |
| `src/main/proxy.ts` | `lib/proxy.ts` | 上游代理配置 |
| `src/main/game-api-broadcaster.ts` | `lib/game-api-broadcaster.ts` | API 事件广播 |
| `src/main/webcontent-utils.ts` | `lib/webcontent-utils.ts` | iframe preload 兜底等 |
| `src/main/index.ts`（部分） | `app.ts` | 启动开关 / 窗口恢复 / 证书信任 |
| `src/renderer/index.ts`（部分） | `views/kan-game-wrapper.tsx` | webview 参数 / UA 清洗 |
| `assets/data/server.json` | `assets/data/server.json` | 镇守府服务器表 |
| `assets/lodes/poi-fcd-map.json` | `fcd/map.json` | 海图路线/点位 |
| `assets/lodes/poi-quest-goal.json` | `assets/data/quest_goal.cson` | 任务进度目标（抓取时转成 JSON） |

`src/main/config.ts` 为接口同构（get/set/on 界面对齐 poi `lib/config.ts`），实现为重写

语音文件名解码规则及下列台词数据来自
[poi-plugin-subtitle](https://github.com/kcwikizh/poi-plugin-subtitle)
（MIT License, Copyright (c) 2015 poi contributors）：
`assets/lodes/subtitle-zh.json`、`assets/lodes/subtitle-ja.json`、
`assets/lodes/subtitle-npc.json`、`assets/lodes/subtitle-enemies.json`。
下方 MIT 许可条款同样适用于该部分；这四个台词包随发行版分发，应用运行时不连接该仓库

视觉素材另行说明，不把它们误算进 poi 的 MIT 代码许可证：

| kuma 文件 | poi 来源 | 权利说明 |
|---|---|---|
| `src/renderer/assets/slotitem/*.svg` | `assets/svg/slotitem/*.svg` | 遵循 poi `assets/svg/COPYRIGHT.md`：仅限 poi、插件、扩展及 poi 衍生项目使用；原作者保留全部权利 |
| `src/renderer/assets/material/*.png` | `assets/img/material/0*.png` | poi 默认资源图标；仅记录素材来源，不主张该图像受下方 MIT 代码许可证覆盖 |

---

## 随发行版分发的资料包

发行版里 `assets/lodes/` 只放**数据本身所在的源有明确、允许再分发的许可**的那些包。
名单的唯一出处是 `scripts/lode-sources.json` 的 `bundle` 标志
（打包过滤与 `.gitignore` 共用同一份，见 `scripts/lib/bundled-lodes.mjs`）。
其余资料一律不随包——它们的上游没有给出可再分发的授权

### OpenCC — Apache License 2.0

| kuma 文件 | OpenCC 来源 |
|---|---|
| `assets/lodes/opencc-t2s.json` | [OpenCC `data/dictionary`](https://github.com/BYVoid/OpenCC/tree/master/data/dictionary) 的 `TSCharacters.txt`、`TSPhrases.txt` |

该文件只取 OpenCC 的繁体转简体字表与词表，按
[Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0) 使用；转换在显示期本地完成，运行时零联网
另含 kuma 第一方补充的少量字词（妳→你、助词 著→着 等），清单在仓库 scripts/lib/zh-simplify-overrides.mjs

### 舰娘百科 zh.kcwiki.cn — CC BY-NC-SA 3.0

下列数据取自**舰娘百科（zh.kcwiki.cn）及其编辑者**，按
[知识共享 署名-非商业性使用-相同方式共享 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/)
授权使用：

| kuma 文件 | 来源页面 |
|---|---|
| `assets/lodes/kcwiki-ships.json` | `模块:舰娘数据` |
| `assets/lodes/quests-scn.json` | `任务`、`任务/最新任务` |
| `assets/lodes/kcwiki-localization.json`（中文译名部分） | `模块:舰娘数据`、`模块:深海栖舰数据改二`、`模块:舰娘装备数据改`、`模块:深海装备数据`、`模块:入手方式地图数据` |
| `assets/lodes/kcwiki-voice.json` | 各舰娘/深海舰页的 `{{台词翻译表}}` |
| `assets/lodes/kcwiki-seasonal-voice.json` | 144 张 `季节性/*` 页的 `{{台词翻译表\|type=seasonal}}`（日中两列） |
| `assets/lodes/kcwiki-expedition.json` | `远征列表` |
| `assets/lodes/kcwiki-routing.json` | 各海域的「带路条件」子页 |
| `assets/lodes/event-bonus.json` | 当期活动页的倍卡表 |
| `assets/lodes/kcwiki-fit-bonus.json` | `模块:舰娘装备数据改` 的 `额外收益*` 字段 |
| `assets/lodes/map-enemy-comps.json` | 37 张常规海域页的「深海配置」表 |
| `assets/lodes/map-drops.json` | 37 张常规海域页的「舰娘掉落表」 |
| `assets/lodes/ship-stats.json` | `模块:舰娘数据` 的 `数据.回避/对潜/索敌`（[Lv1, Lv99] 成长端点） |
| `assets/lodes/kcwiki-bgm.json` | `拆包BGM列表`（战斗曲的官方曲名，按游戏资源号） |

该许可的三项条件，kuma 逐条履行：

- **署名（BY）**：即本节，以及应用内「设置 → 资料来源与许可」那一页
- **非商业性使用（NC）**：kuma 永远免费，不含任何付费功能、广告或捐赠解锁
- **相同方式共享（SA）**：上述文件是对舰娘百科内容的改编，因此**同样以
  CC BY-NC-SA 3.0 提供**；抓取与转换脚本在 `scripts/`，任何人可据以重建

另注：`src/shared/bgm-heard.ts` 是**第一方耳测台账**，不属于上面那张表。
战斗曲的曲名游戏一个字都不发，舰娘百科的拆包页也只收到一部分；余下的号由 kuma 的
维护者在自己的客户端里逐个试听、亲耳确认，逐条记下确认日期。候选名字由舰娘百科的
`BGM反向索引` 提出（该页写于 2020 年，其中相当一部分已与现状不符），
**采信与否一律以亲历试听为准**：听下来对的收，听下来不对的连同「那个名字是错的」
一并记下、真名留空。曲名本身是官方作品的名称，不是任何一方的表达

另注：`kcwiki-bgm.json` 只收「游戏资源号 ↔ 官方曲名」这一对，不含该页的音频文件、
中文译名、时长与排版。曲名是官方作品的名称、资源号是游戏自己的文件名，两者都是事实；
包里没有任何一段可播放的音频——试听仍是现取游戏自己的服务器。站方为多数条目另起了
自己的上传文件名（数字是站内序号不是资源号），那些条目一律不收，宁可少几首也不错认

另注：`kcwiki-seasonal-voice.json` 收**日中两列**（2026-08-22 起；此前只收中文）。
台词的日文原文是游戏方的创作性表达，舰娘百科的 CC 声明只能覆盖它自己的劳动
（中文翻译与整理）——这一点没有变；变的是对「那么日文该不该随包」的判断：
日文列与 `kcwiki-voice`、`subtitle-ja` 同性质，一并随包。
译文或原文任何一侧缺失的条目都如实留空，不拿另一侧顶上。
更细的逐次列出记录（往年台词会在每张同季节的页上重复列出）仍留在维护者本机
（`npm run lodes:fetch -- --only=kcwiki-seasonal-voice --seasonal-voice-audit`，
产物落 `assets/review/`，不入仓也不随包）

另注：`kcwiki-routing.json` 的原始表格多由舰娘百科编辑者从 nga「梦美」等处转录，
包内逐图保留了各自出处；那一层的原作者授权不在舰娘百科的 CC 声明覆盖范围内

另注：`ship-stats.json` 是**多源汇编**：值来自舰娘百科的成长端点基座，外加 `src/shared/ship-stats-patches.ts` 里逐格转写的 64 处分歧（见下一节）与本机账本一手裁定

另注：`map-enemy-comps.json` 与 `map-drops.json` 是**多源汇编**而非单页转写。
敌编成与掉落本身是游戏行为事实（「某点会出现哪几艘深海舰、什么阵形」「某点确认掉过哪条船」），
事实不受著作权保护；汇编的取舍、schema 与互印判据是 kuma 自己的。
舰娘百科的「深海配置」表与「舰娘掉落表」是其中最主要的两张票，故一并在此署名。
舰娘百科的常规海域页自述其掉落数据主要转录自日文 Wiki（37 张页面逐张核过，全部挂着这行注记），
这一句原文照录在 `map-drops.json` 的 `sourceNotes` 里——它是算票时判断两张票同不同源的依据

### 艦これ攻略 Wiki（wikiwiki.jp/kancolle）— 第一方台账的参考来源，集中署名

下列文件是**kuma 自己写的第一方台账**，随源码分发，不含该站的任何页面、文件或表格：

| kuma 文件 | 是什么 |
|---|---|
| `assets/lodes/map-drop-windows.json` | 常规海域限定期台账：哪张图哪个点从哪天起掉哪条船、那一批是什么名义、现在还开着没有 |
| `assets/lodes/kanso-voice.json` | 台词自补层：上游两家都没收录的舰娘形态，其台词的**中文译文**，外加对应的日文原文列 |
| `assets/lodes/kanso-voice-zh.json` | 台词译文自补层：上游已有行但中文栏为空或照抄英文原文时叠上的**中文译文**，外加对应的上游日文原文 |
| `src/shared/fit-bonus-corrections.ts` | 装备加成的修正台账：随包 kcwiki 底表某几行的数与日文一手对不上时，加载时叠一层补正 |
| `src/shared/fit-bonus-supplement.ts` | 装备加成的自补层：随包底表整件没收的装备（mstId 566–588），按日文一手转写成第一方条目 |
| `scripts/lib/fit-bonus-conflicts.mjs` | 装备加成的冲突台账：两份独立整理在同一格给了不同的数，逐条记下裁给谁 |
| `src/shared/ship-stats-patches.ts` | 舰娘成长三维端点的补丁台账：随包 kcwiki 基座与该站「艦船最大値」不一致的 64 格，逐条记下取哪一侧与凭什么（另有 14 格挂牌复核、6 格三方皆缺） |
| `src/shared/normal-map-bonus.ts` | 常规海图的特效舰台账：7-4 与 7-5 这两张图对哪些舰、在哪几个点位有多少攻击补正（常规图里有特效的只有这两张）；纯展示，不进任何伤害计算 |
| `assets/lodes/equip-improve.json` | 装备改修事实表：每件改修每一段要花多少、能找谁当二号舰、开在星期几、推满后能更新成什么。每一行带 `basis` 写明这一格是照资料整理的、有官方公告佐证、按游戏机制推的，还是在游戏里实测过 |
| `src/shared/equip-upgrade-corrections.ts` | 改修事实表的裁决台账：逐件记下某一格为什么取现在这个值（游戏内实测、官方公告、机制通则），以及记下来还没定的分歧 |
| `assets/lodes/equip-aa-evasion.json` | 对空射击回避事实表：哪些机体挨敌方对空射击时更不容易被打下来，两个减免补正分别是多少、综合档位是哪一档。每一行带 `basis` 写明这一格现在有多硬 |
| `assets/lodes/event-plane-groups.json` | 活动陆航特効分组事实表：本期活动里哪架飞机属于哪个陆航特効组（C1/C2/C3）。带期号，换期对不上就整表不生效 |
| `assets/lodes/event-lifecycle.json` | kuma 第一方登记表，官方公告日期 |

台账里记的是**数值与运营事实**（「Bofors 12cm単装両用砲 在 Gotland 上 火力+2」「1-1 的 C 点自
2025-10-29 起掉某条船」这类游戏行为事实，事实不受著作权保护），逐条带着核对当时那一页的页名与
最后编辑日期，任何人可据以复核。`map-drop-windows.json` 的每一条另带 `evidence`，写明这一条
是官方公告、本机实测、还是社区资料整理（后者明写「只作参考」）。
`normal-map-bonus.ts` 同理带 `evidence`（那一页自述凭什么这么写）与 `deferred`
（取到票却没转写进来的东西，逐条写明为什么不收，不许静默丢）。
`equip-improve.json` 的每一行带 `basis`（这一格现在有多硬：照资料整理的／有官方公告佐证／
按游戏机制推的／游戏内实测过的），实测到了就升级；记下来还没定的分歧挂在 `pending` 里只标不改。
`equip-aa-evasion.json` 记的同样是游戏行为事实：某件机体挨敌方对空射击时，敌方的加重对空値与
舰队防空値各自乘上多少。官方从未公布这些系数，它们由玩家验证得出，因此整张表的 `basis` 一律写
**单源待印证**；哪天有了独立的第二份验证或本机实测才升级。
表里没有的机体是「不减免」，与最低档不是一回事，界面上分开显示。
`event-plane-groups.json` 记的是策划给本期活动定的分组事实：哪架飞机属于哪个陆航特効组。
名单核过两家公开资料、37 件逐条一致，**但两家都自述转录自同一份社区分类表**，因此 `basis`
写**同源转录**而不是「多源印证」——一致只证明誊抄没串行，不证明那张表本身对。
倍率本身不在这张表里（那在 `event-bonus` 里），这里只有「谁属于哪一组」

署名集中在本节，**条目内逐条不署名**——与 `map-drops.json` 的 `sourceNotes` 同一口径：
来源自述与判据集中说清楚一处，而不是每条重复一遍

`kanso-voice.json` 是这一族里唯一不是「数值台账」的一份，单独说清楚：
包里**中文是 kuma 自己译的**，是第一方的翻译劳动；同一句话舰娘百科若已有译文，
以舰娘百科的为准，自译的只补空缺

同包的 `ja` 列是该形态台词的**逐字转写**，据日文 Wiki 的对应表整理（2026-08-22 起随包；
此前一版只落中文）。台词本身的著作权归游戏方，逐字转写不构成新的权利主张——
这一列与随发行版早就带着的 `kcwiki-voice` 日文列、整份 `subtitle-ja` 同源同性质，
单独把它挡在外面并不会让分发物更干净，只会让台词卷变成半张对照表。
上游确实没有转写日文的行照实留空，不据中文回译

`kanso-voice-zh.json` 只补两份随包上游台词里仍缺译的行：中文栏为空，或原文本身是英文、
中文栏照抄英文原文。上游已有中文时一律不覆盖；上游补上中文后该条进入可删清单，
上游日文原文变化时也不会把旧译文硬贴上去。原文是日文口癖或外来语、上游有意保留罗马字的行不动

kuma 运行时不连接该站；台账里的数是维护者只读核对后手工转写的，抓取脚本在 `scripts/`

另注：`map-drop-windows.json` 自 2026-08-23 起另有第二个参考来源 **艦ログ（kanlog.info）**——
玩家上传数据的掉落统计站，其「開催中の期間限定ドロップ」名单用来印证某一批限定期现在还开着没有。
它同样只是参考：台账里出现的仍旧是运营行为事实与 kuma 自己的判据，站上的表格、数字、页面一格都不随包。
**该站按其站点纪律不接受任何自动化抓取，kuma 也没有对它的抓取脚本**——`votes` 里的 `kanlog` 一律
来自维护者本人打开页面核阅后的手工记录，`evidence.note` 里逐条写明核阅的日期与页面时间戳

### KC3Kai — MIT

| kuma 文件 | 来源 |
|---|---|
| `assets/lodes/abyssal-stats.json` | [KC3Kai/KC3Kai](https://github.com/KC3Kai/KC3Kai) `src/data/abyssal_stats.json` |
| `assets/lodes/ship-exp.json` | 同上 `src/data/exp_ship.json` |
| `assets/lodes/kcwiki-localization.json`（道具中文名部分） | [KC3Kai/kc3-translations](https://github.com/KC3Kai/kc3-translations) `data/scn/useitems.json` |

```
The MIT License (MIT)

Copyright (c) 2015-2026 dragonjet

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### kcwiki-quest-data — MIT

| kuma 文件 | 来源 |
|---|---|
| `assets/lodes/kcwiki-quest-req.json` | [kcwikizh/kcwiki-quest-data](https://github.com/kcwikizh/kcwiki-quest-data)（任务的机器可读 requirements） |
| `assets/lodes/kcwiki-localization.json`（任务日文原名部分） | 同上 `data.min.json` 的任务名字段 |

该仓库以 MIT 发布——声明写在 `package.json` 的 `license` 字段与 npm 包元数据里，
仓库内没有单独的许可证正文文件

### 游戏原始数据

`assets/lodes/kcwiki-localization.json` 里的**日文原名与实体编号**不来自任何第三方资料库，
而是《艦隊これくしょん -艦これ-》自身下发的主数据（`api_start2`）。这些名称与编号的权利
属于游戏的权利人；kuma 只是把它们与中文译名成对存放，供离线显示

`src/shared/event-map-bgm.ts` 同属这一类：它逐格照抄活动期间主数据里的
「哪张活动图的哪一步用哪个配曲编号」，字段名原样保留，一个字都不是转写来的。
活动撤场后这几行会从主数据里消失，图鉴里那张图的配曲就再也拼不出来——
所以趁在场先抄一份，并标明抄自哪一天。往期活动不补：那些行早已撤场，
没有一手来源，不靠社区资料倒推

### 本机档案与缓存

kuma 运行后会在本机形成语音档案、立绘档案、BGM 档案与浏览器缓存。里面的音频与图像
全部是《艦隊これくしょん -艦これ-》的游戏资产，权利属于游戏的权利人；kuma 只在
使用者自己的机器上、为其个人游玩体验留存副本，**发行版里不含其中任何一个字节**

这些缓存与档案文件**仅供本机使用者自行使用，不得外传或再分发**。语音档案与立绘档案
里存的是游戏本体的素材，版权归原权利方。试图传播、散布，或将其用于未经权利人许可的
商业目的，由此产生的法律责任均由行为人自行承担

kuma 与《艦隊これくしょん -艦これ-》的运营方无关，也未获其授权或认可

---

## poi 原始许可证

The MIT License (MIT)

Copyright (c) 2015-2021 poi contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
