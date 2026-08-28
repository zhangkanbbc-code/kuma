# `kcwiki-fit-bonus` 包的字段规范（kuma 第一方口径）

产出物：`assets/lodes/kcwiki-fit-bonus.json`
生成：`npm run lodes:fetch -- --only=kcwiki-fit-bonus`（解析在 `scripts/lib/kcwiki-fit-bonus.mjs`）
底表：zh.kcwiki`模块:舰娘装备数据改`（pageid 11634）的 `额外收益` / `额外收益2` … `额外收益25`
许可：CC BY-NC-SA 3.0（kcwiki 站点条款）→ **可随发行版分发**

> 这份 schema 是**我们自己设计的**，不是任何上游的转录。
> 语义划分借鉴了 EO 与 kcwiki 双方（谁都不是凭空发明的），
> 但字段命名与文件结构自定；EO 的数据文件与字段名一行都没有拼进来。
>
> 署名**只在 NOTICE.md 与钥的许可页履行一次**，包里不逐条塞来源注释——
> 每条数据挂一个来源字段既是噪音，也会让人误以为署名义务是逐条的。
> 包级的来源、许可与抓取日期写在 `meta` 里（抓取器统一生成）。

## 为什么要重建，而不是换个端点

发布侧原来的基座是 EO 的 `FitBonuses.json`（NOASSERTION，不能随包）。
kcwiki 那张表是 CC，能随包，但**不是 EO 的超集**，而且结构完全不同构：
EO 是 id 空间（`shipX`/`shipClass`/`shipType` + `level`/`num`），
kcwiki 是中文名字空间（`适用舰娘` 里 504 个不同取值）。
所以出路是重建——上游的中文名在**抓取时**就翻成 id 空间，运行时零解析、零猜名。
名字词表与逐条依据在 `scripts/lib/fit-bonus-vocab.mjs`。

## 顶层

```jsonc
{
  "meta": { /* 抓取器统一生成：id / name / source / sourceUrl / fetchedAt / upstreamUpdatedAt / license / note */ },
  "data": {
    "schemaVersion": 1,
    "equipGroups": { "<组键>": { "zh": "对水面电探", "tokens": ["对水面雷达/电探", "水上电探"] } },
    "equips": { "<装备 mstId>": Equip },
    "unresolved": [ { "equipId": 529, "row": 15, "reason": "…" } ]
  }
}
```

- `equipGroups`：`need.with[].group` 用到的**装备类目**词表，包级只出现一次。
  上游用「对水面雷达/电探」这种同义词串写类目，我们收敛成稳定键。
  **故意不展开成 id 列表**：「多少索敌算对水面电探」上游没写，我们也不替它拍板，
  留给第二批的面板反推去定。
- `unresolved`：解析不了的东西**挂在这里，不静默丢**。当前为空。

## Equip

```jsonc
{ "id": 122, "nameJa": "10cm連装高角砲+高射装置", "nameZh": "10cm连装高角炮+94式高射装置", "rules": [ Rule ] }
```

`rules` 按上游 `额外收益N` 的 N 升序，`rule.row` 保留那个 N——上游改版时能逐行对回去。

## Rule

```jsonc
{
  "row": 3,
  "who":  { "forms": [656], "classes": [30], "types": [3], "all": true },
  "not":  { "forms": [648], "classes": [94], "types": [1] },
  "need": { "star": 4, "with": [ { "any": [307, 315] }, { "group": "radar-surface" } ] },
  "gain": { "kind": "flat" | "byStar" | "byCount" | "byArea", … },
  "stack": "perEquip" | "once" | "table",
  "cap": 2,
  "setTotal": { "fire": 3, "torpedo": 7 }
}
```

### `who` / `not`：适用集合与排除集合

| 字段 | 含义 | 值域 |
|---|---|---|
| `forms` | **精确形态**（那一个改造形态） | `api_mst_ship.api_id` |
| `classes` | 舰级 | `api_mst_ship.api_ctype` |
| `types` | 舰种 | `api_mst_stype.api_id` |
| `all` | 全部舰船 | `true` |

四者是**并集**；`not` 用同样的四个槽表示排除，排除优先于适用。

> **`forms` 是精确形态，不是整条改造链。**
> 上游那张表**逐形态列举**（106 号写「矢矧、矢矧改、矢矧改二、矢矧改二乙、霞、霞改…」，
> 144 号把「翔鹤、翔鹤改」与「翔鹤改二、翔鹤改二甲」拆成两行且数值不同）。
> 按「链首=全形态」读，同一装备的不同行会产生 549 对重叠、数值自相矛盾；
> 按精确形态读只剩 300 对，且那 300 对全是条件不同的叠加行。实证与推导见词表顶部。
>
> schema 里**没有** `chains` 槽（整条链生效），因为本源没有这种写法。
> 第二批的面板反推与自补层如果需要，再加不迟——现在留一个永远是空的槽只会误导。

**国籍维度**：本源不用国籍，它把海外舰逐条列成 `forms`/`classes`。所以 schema 里也不设
`nations` 槽。第二批要补时按同样的办法加，不必先占位。

### `need`：条件

| 字段 | 含义 |
|---|---|
| `star` | **本装备**的改修门槛（★N）。只在 `gain.kind = "flat"` 上出现——分档收益的门槛写在档里 |
| `with[]` | 需**同时装备**的其他东西。一个元素 = 一个槽位，同一个装备写两遍就是要两件 |
| `with[].any` | 该槽位接受的装备 mstId（上游用「/」列备选，如「试制51cm连装炮/51cm连装炮」） |
| `with[].group` | 该槽位要的是一**类**装备，键见顶层 `equipGroups` |

> 「/」在上游有两个意思：同义词（雷达/电探）与备选装备，而装备名自己也可能带斜杠
>（`14inch/45 三連装砲`）。解析按「最长可识别片段」贪心切，切不动就整串查类目词表，
> 两条都不中才挂牌。

### `gain`：收益值

四种形状，对应上游的 `收益类型`：

```jsonc
{ "kind": "flat",   "flat":   { "fire": 4, "evasion": 3 } }
{ "kind": "byStar", "steps":  [ { "from": 5, "to": 7, "stats": {…} }, { "from": 10, "to": 10, "stats": {…} } ] }
{ "kind": "byCount","counts": [ { "count": 1, "stats": {…} }, { "count": 2, "stats": {…} } ] }
{ "kind": "byArea", "areas":  [ { "area": "north", "stats": {…} } ] }
```

- **分档写的是该档的总值，不是增量。** 依据：529 号时雨改三的数量档
  1/2/3 件 = 火力 7 / 17 / 25、回避 5 / 10 / 15，逐档单调递增；
  285 号的回避档是 1 / 2 / 2（第三件不再涨）——按增量读，那条会变成「第三件再 +2」，
  与「回避封顶 2」的写法自相矛盾。
- `byStar` 的 `to` 为 `null` 表示「该档起、直到下一档之前」；上游写 `max` 的一律读成 ★10
 （游戏改修上限就是 10，且上游用 `8~9` 直接接 `max`，中间不留空档）。
- `byArea` 目前只有一条：268 号「北方迷彩(+北方装備)」出击**北方**海域时装甲 +3。
  区域用稳定键（`north`），**不写海域号**——上游没给号，我们不猜。

**属性字段**（刻意不沿用游戏内部缩写，读的人不必先背一张表）：

| 我们 | 上游 |
|---|---|
| `fire` | 火力 |
| `torpedo` | 雷装 |
| `bomb` | 爆装 |
| `aa` | 对空 |
| `armor` | 装甲 |
| `evasion` | 回避 |
| `asw` | 对潜 |
| `los` | 索敌 |
| `accuracy` | 命中 |
| `range` | 射程（上游是字符串，`"1"` = 抬一档；我们按整数存） |

### `stack` / `cap`：叠加规则

| 值 | 含义 |
|---|---|
| `perEquip` | 按命中的件数倍乘，`cap` 是最多算几件（无 `cap` 即不限） |
| `once` | 只加一次 |
| `table` | 规则就是 `gain.counts` 那张表本身，不再另行倍乘 |

**上游没有显式的叠加字段**，这一列是按两条可查的依据推出来的：
① 上游的 `最大数量`（-1 = 不限、1 = 只算一件、2 = 最多两件）直接落成 `cap`；
② 带协同装备（`need.with`）的行只加一次——这是游戏通则，`fit-bonus-spec.md` 里
   已从 EO 源码注释逐字录过（「If num or requires or requiresType, bonus is applied only once」）。
用的是**规则**，不是 EO 的数据。

### `setTotal`：累计套装加成

上游 `累计套装加成`（9 条，全在 `通用` 行上）：整套凑齐时的合计值，
与本行的 `gain` 并列而不是相加。例：293 号「12cm単装砲改二」配两门「53cm连装鱼雷」时，
本行 `gain` 是火力+1 雷装+3，`setTotal` 是火力+3 雷装+7。

## 电探分档：**故意留空**

EO 有 `bonusSR` / `bonusAR` / `bonusAccR`（按所载电探的索敌/对空/命中分档），
kcwiki **没有这一维**。这里不造一个空槽，也不拿 EO 的数填——
第二批的面板反推能实测出这一层，到时候按实测的形状加字段。
现在的 schema 只表达上游真正写了的东西。

## 规模（2026-08-22 抓取，上游更新于 2026-08-19）

| | |
|---|---|
| 带加成的装备 | 281 件（id 5–565） |
| 条件行 | 1113 条 |
| 挂牌未解析 | 0 |
| 形态引用 / 舰级引用 / 舰种引用 | 2419 / 1109 / 92（全部命中主数据） |

## 对账（EO / wikiwiki / akashi 只当**印证票**，不当源）

```bash
node scripts/fit-bonus-reconcile.mjs   # 与 EO 的 FitBonuses.json 逐格对数
node scripts/fit-bonus-votes.mjs       # 只给吵起来的那几件，去 wikiwiki / akashi 取票
```

两边不同构，只能在**共同分母**上比：★0 · 装 1 件 · 不带协同装备 · 不看所载电探 · 不限区域。
在这一格上两边都是「把命中的行加起来」，可以逐 (装备 × 形态) 对数。
差异报告落 `assets/review/fit-bonus-reconcile.json`（已 gitignore），
真矛盾按装备聚成待裁清单；裁过的进 `scripts/lib/fit-bonus-conflicts.mjs` 台账，
台账带**指纹自失效**——两边哪一边改了数，那条裁决自动作废并告警。

可靠性阶梯（用户 2026-08-22 定稿）：
**装备后的舰娘最终面板（账本一手）> 日文侧近期验证（wikiwiki / akashi，取更新日期近者）
> kcwiki > EO（2025-03-01 起停更）**。裁决 ≠ 改数：即使日文一手站 EO 那边，
也**不把 EO 的数抄进这份 CC 包**（那是许可事故），修正走第二批的面板反推与自补层。
