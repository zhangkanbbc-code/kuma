# EO `FitBonuses.json` 字段规范 · 维护者侧对账专用

> **先看这一段，别把本文件当 kuma 的数据规格。**
>
> - kuma **发布侧**的装备加成基座是第一方包 `kcwiki-fit-bonus`（CC BY-NC-SA 3.0，随包），
>   它的字段规格在 **`scripts/fit-bonus-schema.md`** —— 要改代码、要看运行时吃的是什么结构，
>   去那一份。
> - 本文件描述的 `fit-bonus`（EO 的 `FitBonuses.json`）自 2026-08-22 起**运行时零读取、
>   永不随包**（`NEVER_BUNDLED_LODE_IDS`），只剩一个用途：
>   `node scripts/fit-bonus-reconcile.mjs` 拿它当另一份独立整理，逐格核我们自己的数。
>   本文件因此保留——对账脚本要读它的结构，规格不能没有。
> - 文末「换源过程记录」那几节是**当时的调研与实装日志**，留作依据，不描述现状。
>   凡与上面两条打架的，一律以上面两条为准。
>
> 最后一次按现状复核：2026-08-22（换源二期）。

数据源：`ElectronicObserverEN/Data` → `Data/FitBonuses.json`（矿脉包 `fit-bonus`，维护者侧）。
字段语义**逐条录自 EO 源码的 XML 注释**，非推测：

- 条件与加成结构 `ElectronicObserver.Core/Types/Serialization/FitBonus/FitBonusData.cs`
- 加成数值 `…/FitBonusValue.cs`
- 装备维度 `…/FitBonusPerEquipment.cs`
- 判定实现 `ElectronicObserver.Core/Types/Extensions/FitBonusExtensions.cs`（实装前应再对一遍）

> 定位方法备忘：GitHub 代码搜索要登录、API 常年限流、猜路径全 404。
> 走 **jsDelivr 文件索引**最省事，无需认证也不限流：
> `https://data.jsdelivr.com/v1/packages/gh/{owner}/{repo}@{ref}?structure=flat`
> 取文件内容用 `https://cdn.jsdelivr.net/gh/{owner}/{repo}@{ref}{path}`。

## 顶层（FitBonusPerEquipment）

一条记录 = 「哪些装备」在「哪些条件」下给「什么加成」。

| JSON | 含义 |
|---|---|
| `types` | 按**装备类型**匹配（`api_type[2]`） |
| `ids` | 按**具体装备 mstId** 匹配（实测 296 条里 289 条走这个） |
| `bonuses` | 条件+加成列表，见下 |

## 条件（FitBonusData）

### 舰的维度

| JSON | C# | 官方注释 / 含义 |
|---|---|---|
| `shipX` | `ShipMasterIds` | **Master id = exact id of the ship** —— 精确到该改造形态 |
| `shipS` | `ShipIds` | **Base id (minimum remodel), bonus applies to all of the ship forms** —— 链首 id，**全形态生效** |
| `shipClass` | `ShipClasses` | 舰级（`api_ctype`） |
| `shipType` | `ShipTypes` | 舰种（`api_stype`） |
| `shipNationality` | `ShipNationalities` | 国籍 |

> `shipX` 与 `shipS` 的区别是本规范最关键的一条：前者只认那一个形态，
> 后者认整条改造链。搞反会让加成套错舰。

### 装备的维度

| JSON | C# | 含义 |
|---|---|---|
| `level` | `EquipmentLevel` | **本装备**的改修等级门槛（★N） |
| `num` | `NumberOfEquipmentsRequiredAfterOtherFilters` | 过滤后所需的**本装备**数量 |
| `requires` | `EquipmentRequired` | 需**同时装备**的其他装备 id |
| `requiresLevel` | `EquipmentRequiresLevel` | 上条装备的最低改修等级 |
| `requiresNum` | `NumberOfEquipmentsRequired` | 上条装备需要几件 |
| `requiresType` | `EquipmentTypesRequired` | 需同时装备的装备**类型** |
| `requiresNumType` | `NumberOfEquipmentTypesRequired` | 上条类型需要几件 |

## 加成（FitBonusValue）

数值字段与 `api_mst_slotitem` 同名：
`houg` 火力 / `raig` 雷装 / `tyku` 对空 / `souk` 装甲 / `kaih` 回避 /
`tais` 对潜 / `saku` 索敌 / `houm` 命中 / `leng` 射程 / `baku` 爆装。

> EO 在 `houm`（命中）上留了一句注释：
> *Visible acc fit actually doesn't work according to some studies* —— 展示时值得标注存疑。

### 四个加成槽（互斥，实测 41 条 `bonusAR` 中 0 条同时有 `bonus`）

| JSON | 生效条件（官方注释） |
|---|---|
| `bonus` | 无附加条件 |
| `bonusSR` | 该舰装备了 **索敌 ≥ 5 的电探** |
| `bonusAR` | 该舰装备了 **对空 ≥ 2 的电探** |
| `bonusAccR` | 该舰装备了 **命中 ≥ 8 的电探** |

### 叠加规则（最易错的一条）

`bonus` 的注释原文：

> Applied x times, x being the number of equipment matching the conditions of the bonus fit.
> **If `num` or `requires` or `requiresType`, bonus is applied only once.**

即：默认按**匹配到的装备件数**倍乘；但只要设了 `num` / `requires` / `requiresType`
中的任意一个，就**只加一次**。

## 实测数据分布（2026-08-03 抓取的包）

条目 296 条、bonus 子条目 1721 条：

| 字段 | 条数 |
|---|---:|
| `bonus` | 1603 |
| `shipX` | 804 |
| `level` | 633 |
| `num` | 558 |
| `shipClass` | 416 |
| `shipNationality` | 166 |
| `shipS` | 153 |
| `shipType` | 105 |
| `requires` | 101 |
| `bonusSR` | 69 |
| `bonusAR` | 41 |
| `requiresLevel` | 34 |
| `bonusAccR` | 8 |
| `requiresType` / `requiresNumType` | 各 2 |

已核对：`shipX`/`shipS` 的值全部命中舰表、`shipClass` 全部命中 `api_ctype`、
`requires` 的值全部命中装备表。

## 时效性：已实证停滞，边界为装备 id ≤ 554

取 GitHub commit 时间四次都撞 403 限流，改用**数据内容自证**——
比时间戳更直接，且能给出可写进 UI 的精确边界：

- 包内覆盖的装备 id **最大值 554**
- 2026 年 4–7 月实装的 No.572/573/574/575/577/578/581/582/583/584/587/588
  **命中 0/12，全缺**

结论：**该包只对 id ≤ 554 的装备有效**，之后实装的一件都没有。

### ⛔ 已作废的候选新源：akashi-list.me（2026-08-03 发现 → 2026-08-22 整层退役）

> 下面这一节是当时的调研记录。结论已被推翻：该站未声明数据许可，
> 「不随包、玩家显式拉取」这条中间路已被用户废弃，运行时那一层连同出网点整个删掉了
> （详见本文件末尾「⛔ 已退役」那节）。别照它去写新的拉取代码。


用户指出该站的装备页直接列了「装備ボーナス」，例如 No.377 爆雷 RUR-4A Weapon Alpha改：

```
対潜+3 回避+3   Fletcher Mk.II
対潜+2 回避+1   アメリカ艦
対潜+1 回避+2   丹陽・雪風改二
対潜+1 回避+1   イギリス艦・オーストラリア艦
```

实测（应用内浏览器）：

- 页面 HTML 内**含**「装備ボーナス」文本，7 个内联 script，**无独立数据 API**
  （网络请求只有 GA/AdSense）→ 数据随页面下发，**需 HTML/JS 清洗层**才能取，
  同 kcwiki 远征那层的性质
- 注意区分：我们已在用的 `akashi-list` 矿脉包（kcwiki-luatable 的 `akashi-list.json`）
  **不含** fit bonus——里面的「ボーナス」是改修逐星加成（如「空母ボーナス 索敵+1」），
  两者同名不同物
- 但那个包有个有价值的副产品：**items 覆盖到 id 578**（含 2026 新装 572–578），
  而 EO fit-bonus 只到 554 —— 说明 kcwiki-luatable 侧是活跃更新的

许可：该站**未声明数据许可** → 若接入，仅用户显式拉取、不随包分发。

~~下一步：写清洗层从页面提取 `装備ボーナス` 段，与 EO 包做实体级回退
（EO 覆盖 id ≤ 554，akashi 补 555+），并与面板反推三方互印。~~
（这条「下一步」当时做了，2026-08-22 又整层退役——缺口现在由面板反推的实测轨兜。）

### 穷举过的其他机读源（都不更新）

| 源 | 结论 |
|---|---|
| `kcwiki/kancolle-data` | 94 文件里只有 `refit`（改修），无 fit bonus |
| `KC3Kai` / `noro6/kc-web` | 无 fit bonus 数据文件；kc-web 的数据内嵌在 TS 源码里，无可复用数据文件。<br>⚠️ 2026-08-22 订正：原写「jsDelivr 未收录」**不准确**——`cdn.jsdelivr.net/gh/KC3Kai/KC3Kai@master/src/data/*.json` 实测 200 可取，`KC3Kai/kc3-translations` 的 `data.jsdelivr.com` 文件索引也正常（286 文件）；只有 `KC3Kai/KC3Kai` 这个大仓的**索引 API** 返 403（内容 CDN 不受影响）。要列大仓的文件用 GitHub `contents` API |
| `zh.kcwiki 模块:装备增益` | 见下条订正 |

~~故仍以 EO 为基线，但必须在 UI 标注上述边界。~~
**这句已作废**：2026-08-22 起基线是 `kcwiki-fit-bonus`（CC，随包），EO 退为对账印证票。
上面那张「穷举过的其他机读源」表也只反映 2026-08-03 那次普查，别当现状读。

### ⚠️ 订正（2026-08-21 换源第一期实测）：kcwiki 那条上面写错了

上面那句「模块:装备增益 最后编辑 2022-11-26，比 EO 更旧」**结论对、理由错**，
照它去查会绕远路：

- **`模块:装备增益`（pageid 31393）不是数据表，是渲染函数**。开头就是
  `local eqData = require("模块:舰娘装备数据改")`，它只负责把数据排成 wikitext。
  2022-11-26 是那段渲染代码最后一次改动的日期，与数据新鲜度无关。
- **真正的数据在 `模块:舰娘装备数据改`（pageid 11634）**，字段是
  `额外收益` / `额外收益2` … `额外收益20`，**2026-08-19 仍在更新**——比 EO 的
  2025-03-01 新一年半。（`localization.mjs` 早就在读这张表取装备译名。）
- 早前记的「kcwiki-luatable 的 items.json 只到 id 526」说的是 **GitHub 镜像仓**，
  站点原模块比镜像新得多，别拿镜像的结论判站点。

**那为什么还是没换源？** 因为逐条对账下来 kcwiki **不是超集**（2026-08-21 实测）：

| | EO `FitBonuses.json` | zh.kcwiki `模块:舰娘装备数据改` |
|---|---|---|
| 带加成的装备 | **313**（id 3–554） | 281（id 5–565） |
| 条件行 | **1721** | 1107 |
| 只有己方有的装备 | **43** 件（含 522–551 一整段 2024–2025 装备） | 11 件（54/74/140/142/151/460 + 555/559/560/564/565）|
| 两边都有 | 270 | 270 |
| 许可 | NOASSERTION（不能随包） | **CC BY-NC-SA 3.0（能随包）** |

直接切等于用 43 件换 11 件（净 −32 件装备、−614 条规则），
违反「同域单基准：B 比 A 更全面才整体替换」。

**结构也不同构，不是换个 URL 的事。** EO 是机器可读的 id 空间
（`shipX`/`shipS`/`shipClass`/`shipType`/`shipNationality` + `level`/`num`/`requires`），
kcwiki 是中文名字空间：`适用舰娘` 里 504 个不同取值，其中 371 个能直接对上舰娘中文名、
11 个对上 `级别[0]`、8 个对上舰种名，**剩 114 个要人工建词表**——舰级别名（绫波级/改大和级/
改装阳炎级）、舰种别名（轻型航母/正规航母/潜艇/航空潜艇）、伪类目（全部舰船/其他阳炎型/
其他白露型）、拉丁名（Norge/Eidsvold/Graf Zeppelin）。
语义还各有各的独门字段：kcwiki 有 `非适用舰娘`（排除项，EO 无对应）与 `收益类型:区域`
（出击北方海域加成），EO 有 `bonusSR`/`bonusAR`/`bonusAccR`（按所载电探索敌/对空/命中分档，
kcwiki 无对应）。消费端（`main/akashi-fit.ts`、`ji.ts`、`ru.ts`、`shared/lode-health.ts`）
吃的是 EO 结构，换源不是零改动。（2026-08-22 第二批已全部迁完，见下方「重建第二批」。
电探分档那一维**没有补进 schema**：kcwiki 没写、我们也不猜，
预期层算不出的那部分自然落进「实测 − 预期」的差值里，UI 如实标「条件待定」。）

结论：fit-bonus 留在换源队列里，出路是重建。
以 kcwiki（CC，281 件）当预期值底表 + 本文件前面写的「面板反推」当实测层，
43 件缺口交给反推与自补。做之前要先建那张 504 项的名字词表并逐条对账，
是一件独立的工程，不是这一期的顺手活。

### ✅ 重建第一批已落地（2026-08-22）：数据工程做完了

上面那条「独立的工程」已完成，产出物与它自己的规范另起一份：
**`scripts/fit-bonus-schema.md`**（第一方 schema 逐字段说明）。这里只留路牌：

- 新包 `assets/lodes/kcwiki-fit-bonus.json`（CC BY-NC-SA 3.0，**随包**），
  281 件装备 / 1113 条规则 / 零挂牌；中文名在**抓取时**就翻成 id 空间，运行时零解析。
- 504 项名字词表 100% 着落：形态名 374 + 舰级名 105 + 舰种名 8 + 人工词表 17。
  人工那 17 条逐条带依据，写在 `scripts/lib/fit-bonus-vocab.mjs`。
- **上面「114 个要人工建词表」那句是高估的**：其中 94 个只是「◯◯级 ↔ ◯◯型」的
  写法差（kcwiki 的 `级别[0]` 写「型」，`适用舰娘` 写「级」），一条机器规则就够；
  另有 3 个（Norge / Eidsvold / Graf Zeppelin）只要把主数据的**日文名**也收进索引就解了。
- **`适用舰娘` 是精确形态，不是整条改造链**（对应 EO 的 `shipX` 而非 `shipS`）。
  实证：上游逐形态列举（106 号一行写了 23 个形态名），且按「链首=全形态」读会让
  同一装备的不同行产生 549 对重叠、数值自相矛盾；按精确形态读只剩 300 对，
  且那 300 对全是条件不同的叠加行。
- EO 退居**印证票**：`node scripts/fit-bonus-reconcile.mjs` 在共同分母
 （★0 · 1 件 · 无协同 · 无电探档）上逐格对数；吵起来的装备再用
  `node scripts/fit-bonus-votes.mjs` 去 wikiwiki / akashi 取票。裁过的进
  `scripts/lib/fit-bonus-conflicts.mjs` 台账（指纹自失效）。
- 消费端**这一改一行没动**：`main/akashi-fit.ts`、`ji.ts`、`ru.ts`、`shared/lode-health.ts`
  仍吃旧的 `fit-bonus` 包。切换是第二批（面板反推 + 自补层）的事。

### ✅ 重建第二批已落地（2026-08-22）：应用接入

运行时整层搬到新包，并把「你的实测」那一轨真正做出来。产出物：

- **求值器 `src/shared/fit-bonus.ts`**（纯函数，`node --test` 直接跑）——
  预期层 `expectedFitBonus` 与实测层 `observedFitBonus` 住在一起，
  三个消费端（鉴的装备卷/舰娘卷、锐的编队详情、钦的舰娘卡）共用。
  分层规则「最具体的一层胜出」照第一批对账量出来的模型（specific 9490 vs additive 9479），
  且**逐格与 `fit-bonus-reconcile.mjs` 的 `ourBaseline` 零差异**（全 281 件 × 全舰实测）。
- **修正台账 `src/shared/fit-bonus-corrections.ts`**——已裁的 4 件（317/358/505/322）
  以「逐形态补正量」的形式在**加载时**叠一层，不动 CC 包文件一个字节。
  每条盯着它依赖的上游行的指纹，上游一改就作废并告警。
  73 件待裁的**照上游原样显示**，不提前替用户拍板；用户裁完一条就往台账加一条。
- **双轨展示**：鉴的舰娘卷「装备加成」页下半 = 你的实测 / 预期值 两行对齐并列，
  对不上时标「N 项对不上 · 以实测为准」；装备卷的抽屉里也有一轨「你的实测」，
  按装着这件的舰逐艘列（**只有那艘舰上再没有第二件有加成记录的装备时**才敢标
  「只有这一件」，否则如实写「整条配装合计」）。
- **akashi 运行时整层退役**：`src/main/akashi-fit.ts` 删除、IPC 与拉取按钮一并撤，
  应用里不再有指向该站点的出网点。`scripts/akashi-fit-parser.mjs` 留在维护者侧
  给 `fit-bonus-votes.mjs` 取票用。上游没收录的装备（id > 565）显示
  「暂无预期数据」+ 实测值——**这正是双轨的价值：新装备不等上游**。
- **EO 包降级到维护者侧**：`fit-bonus` 退出 `CONSUMED_LODES`，进
  `NEVER_BUNDLED_LODE_IDS`（与 eo-quests 同档），只剩对账一个用途。

## 两套机制必须分开（2026-08-03 补）

> 来源：社区调研整理的转述汇总，属**二手**。
> 具体数值一律不入代码，只作校验样本；机制性结论与本地实测印证后采信。

1. **可见「装備ボーナス」**——火力/雷装/对空/对潜/索敌/装甲/回避/命中等蓝字加成，
   进入面板值。EO 的 `FitBonuses.json` 即此套，本规范前述字段全属于它。
2. **不可见「主炮适重／命中 fit」**——直接进昼夜战命中计算，**不显示在面板**，
   无官方完整数值矩阵，社区表多停在 2024 年。
   **本项目不实装此套**：既反推不出，也无可信机读源——属于该挂牌的东西。

### 数值可信度阶梯（社区共识）

装备后的**舰娘最终面板** ＞ 日文 Wiki 近期验证表 ＞ 英文 Wiki ＞ 旧表格/旧计算器。
（英文 Wiki 依赖的 Google 表格最后更新 2023-11-07；旧 KC3 Replay fit 表同样过期。）

## 面板反推：最高可信度那一档我们本来就有

因为 `最终面板 = 舰娘裸值 + 近代化改修 + Σ装备原始值 + Bonus`，而四项里三项已知：

```
实测Bonus = api_ship.{karyoku,raisou,taiku,soukou,…}      面板值（已含全部加成）
          − api_mst_ship 的对应基础值
          − ship.kyouka[]                                  近代化改修
          − Σ 该舰所载装备的 api_mst_slotitem 原始值
```

意义：**新装备不必等上游补录**——只要玩家装上了，面板就给出真实加成。
这与遭遇志/任务计数同属「被动只读 + 本地反哺」，零许可风险。

边界与注意：
- 只对**可见**那套成立；不可见 fit 反推不出（不进面板）
- 改修（★）带来的加成也在面板里，若要单独分离 Bonus 需扣除改修部分
- 装备选择卡的 `↑+` 预览有已知显示错误记录 → 一律以实际装备后的面板为准

### 对既有实装的交叉印证（已核对，结论：现有代码是对的）

| 规则 | 我方实装 | 是否正确 |
|---|---|---|
| 对空 Bonus 影响对空炮火，但**不增制空值** | `fleetAirPower` 用 `api_mst_slotitem.api_tyku`（装备原始值），未掺 bonus | ✅ |
| 索敌 Bonus **进入**路线索敌分 | `fleetLos33` 用 `api_ship.sakuteki`（面板值，已含 bonus） | ✅ |

### 实装方向（双轨）——已落地，但供「预期值」的不是 EO

~~EO 包给「预期值」（标注 id ≤ 554 边界）~~，面板反推给「你的实测」，两者并列；
不一致时以实测为准并显示差异——同镝的「你的实测 vs 离线确认目录」。
如此即使上游长期停更，功能也不失效。

**订正（2026-08-22）**：双轨本身按这个方向做成了，但「预期值」那一轨在落地时
换成了 `kcwiki-fit-bonus`（CC，随包）+ `src/shared/fit-bonus-supplement.ts` 自补层；
EO 从头到尾没进过发行版。求值器是 `src/shared/fit-bonus.ts`。

---

## akashi-list.me 清洗层：实测结论（2026-08-03 收工）

### 缺口的真实大小（前一版记的 191 件是错的）

之前把**深海装备**算进了缺口。EO 的 `Equipments.json`（2026-07-27 仍在更新）里
`api_id` 干净地分两段：**1–588 是玩家装备（584 件）**、**1500+ 是敌方装备（158 件，
如 1522「飛び魚艦戦 / Flying-fish Abyssal Fighter」、1647「GFCS+深海5inch連装砲」）**，
中间无交集。敌方装备不会给玩家舰加成，不该算缺口。

| | |
|---|---|
| 玩家装备 | 584 件（api_id 1–588）|
| EO fit-bonus 覆盖 | id 3–554（313 件有加成记录）|
| **真实缺口** | **33 件**（555–588，跳过 563）|
| akashi 有页面的 | 23 件（555–578）|
| 两边都没有 | 10 件（579–588）|

### 缺失从什么时候开始：2025-03-01

`ElectronicObserverEN/Data` 的 `Data/FitBonuses.json` 最后一次提交是 **2025-03-01**
（"Fit bonuses - 44"）。此前节奏规律（2024-06-29 / 08-07 / 08-17 / 10-04 / 11-13 /
12-09 / 2025-01-07 / 03-01，约 1~2 月一次），之后彻底断更。

**不是项目死了**：同仓库 2026-07-29 仍在提交（Equipments / Ships / Maintenance information）。
`FitBonuses.json` 还在原地，没搬家、无替代文件——是这一份数据单独没人维护了。

> 取 commit 时间的办法：GitHub API 常年限流（本项目已撞 5 次 403）。
> 改用**无需认证的 Atom feed**：`https://github.com/{owner}/{repo}/commits/{branch}/{path}.atom`。

### 排除掉的候选替代源

`kcwiki-luatable` 的 `items.json` / `items_v2.json` 里有 `额外收益/额外收益2/…` 字段，
确实就是结构化的装备加成，且来自我们已在用的源——但**两者都只到 id 526，比 EO 的 554 还旧**，
带加成的 275 件里 id > 554 的一件都没有。填不了缺口。
（同域单基准律下也不能拿它替换 EO：EO 有而 kcwiki 无的有 44 件。）

### 数据入口：不是抓渲染后的 DOM

站点是 hash 路由的 SPA，主页 822KB 里**没有**加成正文（"Fletcher" 零命中）。
加成详情由前端 XHR 按需取——在其内联 app 里读出来的：

```js
r.open("GET", "detail/" + e + ".html")   // e = wid，如 w377
```

即 `https://akashi-list.me/detail/w{id}.html`，每件装备一个 ~5–10KB 的 HTML 片段。
这是站点自己下发的接口，不是爬渲染结果。

### 片段结构（w555 这类复杂例子才看得全）

```html
<div class="detail-row bonus-contents">        <!-- 目标类名在 class 的第二个 -->
  <td class=fit>
    <span>
      <div>
        <sunit>火力+2<sn class=rbonus><r>…</r>×10</sn></sunit>  <!-- 基础值 + ★1..★10 逐星追加 -->
        <sunit>対潜+1</sunit>
      </div>
      <div class=sm1>＋<a>10cm/56…</a>：<sunit>火力+1</sunit>…</div>   <!-- 併用シナジー -->
    </span>
    <span><sunit>Киров</sunit></span>          <!-- 适用对象 -->
  </td>
```

三处踩过的坑（清洗层 `scripts/akashi-fit-parser.mjs` 已处理）：

1. **类名在第二位**：`class="detail-row bonus-contents"`，正则若要求类名紧跟 `class=` 则全库零命中。
2. **`<sn>` 必须整块摘掉再取基础值**：`<r>` 里嵌着 `<sunit>`，不摘的话 w555「Киров以外」那格
   本来一个基础值都没有，会被读成「火力+1 火力+1 火力+1…」十几个。
3. **一格里可能有多个 `<sn>` 组**（w564 有 4 组）：混成一串会变出 40 档的假数据，各归各的。

### 产出与忠实度自评

对缺口 23 件实测：

| | |
|---|---|
| 完全解析（対象 → 一组固定加成） | **5 件** — 559/560/566/567/569 |
| 部分解析（挂牌 + 指向原页） | **7 件** — 555/564/565/570/573/574/575 |
| 本来就无加成 | 11 件 |

「部分解析」= 该格掺了**逐星追加 / 併用 / 按装备数分档**（`火力+2,+6,+8,+10` 这种逗号串）
三者的组合关系尚未建模对。解析器给这类打 `partial: true`，
**UI 应挂牌并给原页链接，不把半懂的结构拼成一个看起来像真值的数字**。

### ⛔ 已退役（2026-08-22）：曾接进应用（2026-08-03 ~ 2026-08-22）

「不随包、玩家显式拉取」这条中间路已被用户废弃——该站未声明数据许可，
应用里不该有指向它的出网点。`src/main/akashi-fit.ts`（清洗层 + 取回 + 缓存 + 两个 IPC）
与鉴的装备抽屉里那个拉取按钮**整层删除**；缺口改由面板反推的实测层兜。
`scripts/akashi-fit-parser.mjs` 保留为维护者侧取票工具（`fit-bonus-votes.mjs` 用）。
下面这一段留作**当时的实装记录**，不再描述现状：

`src/main/akashi-fit.ts`（清洗层 + 取回 + 缓存）与鉴的装备抽屉：

- **仅显式拉取**：装备 id > 554 且 EO 无记录时才出按钮，点了才联网；
  打开抽屉只读本地缓存（`akashi-fit-cache/`，TTL 30 天），命中直显、不联网。
- **实体级回退**：只补 EO 没有的，不做字段级混拼（矿脉铁律）。
- **partial 挂牌**：掺了逐星/併用/按数量分档的条目标「条件复杂」，
  只列原文并给原页链接，不拼成一个数。
- 另有 `akashi-fit:prefetch` 批量口径（逐件串行 + 400ms 间隔）。

> ~~清洗层在 `src/main/akashi-fit.ts` 与 `scripts/akashi-fit-parser.mjs` 各存一份
> （主进程用 TS 版，离线核对用 mjs 版）——**改动要两边同步**。~~
> 2026-08-22 TS 那份随运行时一起删了，现在只剩 mjs 一份，这条注意事项随之作废。

实测（跑真实页面，用的是实装代码不是复刻）：24 页 → 完全解析 6 / 部分 7 /
本就无加成 11 / 脏数据 0；★ 逐星数组档数一律 10。
