# 矿脉 · 内置数据包

每个 `.json` 是一个版本化社区数据包，格式：

```json
{
  "meta": {
    "id": "abyssal-stats",
    "name": "深海数值推定",
    "version": "2026.08.03",
    "source": "KC3Kai",
    "sourceUrl": "https://github.com/KC3Kai/KC3Kai",
    "fetchedAt": "2026-08-03T00:00:00Z",
    "note": "实测推定值，非官方数据"
  },
  "data": { }
}
```

- **来源与日期必填**——消费端（鉴等模块）会在页脚原样展示「谁说的、多新」；
- 用户可把更新的包放进 `%APPDATA%/kuma/lodes/`，同 id 覆盖内置；
- 抓取/更新：`npm run lodes:fetch`（源清单在 `scripts/lode-sources.json`）。
- 应用运行时只读本地包；下面的抓取命令只能由维护者显式执行，不会在后台自动联网。

## `note` 与 `maintainerNote`：玩家文案与维护者考古分开住

`meta.note` **是玩家可见文案**——`lodeCredit()` 把它渲染进模块里那枚「源」的悬停，
玩家一 hover 就整段读到。2026-08-24 之前这个字段是两拨人共用的：维护者把换源考古、
逐条对账、`pageid`、脚本路径、⚠️ 标记全堆进去，于是「源」悬停变成了一段开发日志
（`equip-upgrades` 那条到过 1522 字）。现在拆开：

| 字段 | 谁看 | 写什么 | 住在哪 |
|---|---|---|---|
| `note` | 玩家 | 一两句人话：这是什么资料、覆盖什么 | 抓来的包 → `scripts/lode-sources.json` 的 `note`（抓取器照抄进 `meta.note`）；手工台账 → 包自己的 `meta.note` |
| `maintainerNote` | 维护者 | 换源史、对账结论、否掉过的候选源、结构口径、别再重跑的调查 | 抓来的包 → `scripts/lode-sources.json` 的 `maintainerNote`（**抓取器一行都不读**）；手工台账 → 包自己的 `meta.maintainerNote` |

`note` 里**不要**写来源站名与更新日期——`lodeCredit()` 本来就单独展示这两样，
写了就在悬停里重复一遍。也不要写 ⚠️、「不是 A 而是 B」的考古句式、`pageid`、
模块名、脚本名、对账史、日期堆砌；语气按七之五的口径（解释语句折叠或不写，别带 AI 腔）。

护栏在 `test/lode-validation-coverage.test.mjs`：遍历清单与本地全部包的 `meta.note`
逐条查长度与禁用词，并要求本批迁移过考古的包都有对应的 `maintainerNote`
（防「从 note 里删了却没搬走」）。**改抓取器模板时记得连护栏一起看**，
否则下次重抓一秒打回原形。

## 事实源分层

运行时按以下口径选资料，不把“有中文”误当成“事实更新更快”：

1. 游戏 `api_start2` 等原生字段；
2. `wikiwiki.jp/kancolle` 的日文一手事实表；
3. KC3Kai、EOEN、KCNav 等专门化结构源；
4. kcwiki 的中文译名、任务文本、字幕与最终事实兜底。

`wikiwiki-remodel` 一次读取「改造」总表及脚注，只对总表尚未收录的最新形态定向补页；
改造需求按“游戏 API 七字段 → wikiwiki 表外素材 → kcwiki 最终兜底”合并。`wikiwiki-expedition`
提供时间、消耗、报酬和编成条件，中文远征名继续来自 kcwiki；游戏原生的奖励物品、官方示例编成
和难度优先于两者。

任务的**精确计数与编成条件**由四层规则源装配，优先级从上到下、只填空位：
`kcwiki-quest-req`（MIT）→ `poi-quest-goal`（MIT）→ **kuma 自研** → 中文正文兜底。
自研那一层是主力：废弃装备/演习/远征/出击（纯海域与带点位）四类由中文任务正文 +
游戏一手主数据 + `poi-fcd-map` 拓扑推导，编成门另行推导；少量条目逐条人工解码。
上游编码与游戏日文原文对不上的逐条走 `src/main/mg/quest-source-conflicts.ts` 的修正台账。
（2026-08-21 之前这一层由 EO 的 `quest-trackers` 包供给，该包已整层退场。）

任务前置链是双源：`quests-scn`（kcwiki/kcQuests，判定基准）+ `wikiwiki-quests`
（任務各分类页的開放条件列，抓取时用 `eo-quests` 的日文名公证 code 对齐——周期任务
历史上重编过号，code 不能裸信）。`eo-quests` 是**维护者侧专用包**：运行时一行不读，
打包一定被排除（`scripts/lib/package-ignore.mjs`），只在抓取与对账流水线里用。wikiwiki 只补 kcwiki 的缺口、修指向已失效码的悬空前置，
以及把双方口径分歧原样标给界面；wikiwiki 自标「検証中/達成後？」的条目不作判定依据。
每次刷新 `wikiwiki-quests` 会重出三方对账 `assets/review/quest-pre-reconcile.json`。

常规海域带路并列显示三种不同证据：`wikiwiki-routing` 保留日文一手分歧表供人核对，
`kcnav-routing` 只显示官方途径/手动导入且精确命中当前舰种编成的实测频率，
`kcwiki-routing` 提供中文说明。自然语言条件不会被自动翻译成硬判定，实测频率也不会冒充规则。

抓取任一资料包失败时命令会返回非零退出码；改造或远征事实包失败时不会继续拿旧包生成“新对账”。
`wikiwiki-remodel` 的原始总表按日本日期保存一次缓存，`--force` 才会跳过当日缓存重新请求。

每次切换事实源后运行：

```bash
npm run lodes:reconcile
```

差异写入 `assets/review/source-reconciliation.json`，只列原始事实差异，不拿每小时收益的舍入值、
对象键顺序或 `07:30`/`7:30` 格式差冒充数据冲突。

KCNav 在线接口明确拒绝未授权 API 自动化，所以抓取器不会模拟浏览器或绕过限制。
只有从官方途径或由用户手动取得离线包后才导入：

```powershell
$env:KANSO_KCNAV_EXPORT = 'C:\path\to\kcnav-routing.json'
npm run lodes:fetch -- --only=kcnav-routing
```

没有该包时，路线页继续使用 `wikiwiki-routing` / `kcwiki-routing` 的文字解释；有包时也只在
舰队类型和两队舰种多重集合完全一致、样本量足够时显示实测频率，不把频率称作硬带路规则。

## 汉化包

`kcwiki-localization` 保存舰娘、装备、深海舰/装备、道具、舰种和海域的 `{ja, zh}`，
运行时不会联网。刷新使用单一批处理命令：

```bash
npm run lodes:localization
```

它一次拉取 KCWiki / kcwikizh 的聚合表与原始 Lua 模块，再生成紧凑本地包。中文作为
主显示；日文原文由名称旁的“原”按钮折叠展开。译名缺失时只做可审计的游戏术语和简繁
降级，仍无法可靠翻译的名称保留原文。

## 语音字幕包

`subtitle-zh` / `subtitle-ja` 对应舰娘语音；`wikiwiki-voice` 从 wikiwiki.jp 的舰娘页
按「改装阶段」列补齐尚未进入前两包的新形态日文台词；`wikiwiki-abyss-voice` 按深海舰页面
列出的精确 No. 补全各形态场景原文；`subtitle-npc` 对应 `kc9999` 的明石、大淀、间宫、伊良湖
及活动短剧；`subtitle-enemies` 对应 `kc9998` 的深海战斗语音。应用只在
游戏实际请求音轨时读取这些本地包，中文缺失才回退日文，不会在运行时联网取字幕。

`kcwiki-seasonal-voice` 是**另一个域**：各年季节限定台词（圣诞/情人节/节分/秋刀鱼……）。
它不在舰娘页上——舰娘页的「季节限定语音」小节整段是 `{{#widget:SeasonalSubtitle}}` 挂件，
文本住在 155 张 `季节性/*` 独立页里，`kcwiki-voice` 的抓取器一直把它们当
「未匹配到 mstId 的段落」丢掉。抓取器按档名的**形态码**（`080` / `080a` / `145`）落位，
不按图鉴号猜（时雨改的形态码是 `080a`，图鉴号却是 1343）；往年台词会在此后每张同季节页上
重复列出，所以按档名去重、并把每条落回它自己那一年。

这个包收**日中两列**（2026-08-22 起；此前一版只落中文，那是把任务域的「日文原文不进
分发物」类推过来，同日撤销——逐字转写与随包早就有的 `kcwiki-voice.ja`、整份 `subtitle-ja`
同级同灰度，挡住它只会让台词卷变成半张对照表）。任一侧上游没有的行都如实留空。
要看**每一次列出**的原始行（往年台词会在每张同季节页上重复列出，包里只留「本家那一次」），
跑 `npm run lodes:fetch -- --only=kcwiki-seasonal-voice --seasonal-voice-audit`，
材料落 `assets/review/`，不入仓也不随包。

季节语音在游戏里**占用与常规台词同一个音轨槽位**（官方语音编号只有 0..53 + 141/241，
季节语音没有独立编号），官方在当季把那个地址上的文件换成季节版、过季换回。
所以图鉴里季节台词**不给按地址拼出来的播放钮**——过季点下去播的是平时那句，不是眼前这句。

装备不能直接采用 `kcdata/slotitem/all.json` 的 `chinese_name`：当前数据中 511 以后会被
旧深海装备的同号中文名覆盖。抓取器以 `模块:舰娘装备数据改` 的 ID 与日文名为准，
`kcdata` 只补最新日文原名；深海旧编号 511…633 则显式迁移到现行 1511…1633。

## 海域情报目录

海域情报是**四层**：

| 包 | 管什么 | 谁供 |
|---|---|---|
| `map-intel` | 活动图四难度层（含活动图的掉落与编成） | wikiwiki 抓取 + 人工维护，**不随包** |
| `map-enemy-comps` | **常规图敌编成**（2026-08-22 起） | 第一方汇编，随包 |
| `map-drops` | **常规图确认掉落 + 空掉落标记**（2026-08-22 起） | 第一方汇编，随包 |
| `map-drop-windows` | **常规图限定期窗口**（2026-08-22 起） | 第一方**手工台账**，入仓随包，抓不回来 |

装配顺序在 `shared/map-intel.ts` 的 `rebuildCatalog` 里定死：
底座 → 敌编成层 → 掉落层 → 限定期台账。**台账必须最后叠**——掉落层会整格重写 `ships`，
先叠台账等于把刚写上去的窗口再抹掉一次，而且形状没变、一条报错都不会有。
除了各自那一格，**其余字段一格不动**——一个域一个包，整包换掉会把还没换源的那几域一起弄丢。
活动图走 `difficulties` 分层，三个常规图层都不覆盖它。

**底座缺图时，掉落层与敌编成层要自建条目**（`ensureMapShell`）。这两层覆盖同样 37 张图、
同时随包，而底座 `map-intel` 是禁品、**永不随包**——玩家那份产物里它只有内置兜底的 1-1。
从前三个叠加函数都写着「底座没有的图不新建」，结果三层在 1-1 以外整层被丢弃，
界面上一律「本地目录待更新」（2026-08-22 发布前在打包产物上验收才抓到，开发机照不出来）。
限定期台账**不自建图**：只有窗口没有掉落表是真的半张图。
「半张图」那条顾虑改由展示层接住——`mapDropsInfo()` / `mapEnemyCompsInfo()` 回答
「这一域这张图有没有人供数据」，展示层据此说「待更新」而不是把空列表说成「0 条」。

### `map-drop-windows`：限定期台账

限定期窗口（从哪天起掉、属于哪一批、现在还开着没有）是**唯一一格穷举过、
只剩一家社区源在给、而那一家的许可又不允许随包分发**的资料。所以这一格的做法是：
事实自己记一份台账（哪张图哪个点从哪天起掉哪条船，是运营行为事实），
`scripts/refresh-map-intel-limited.mjs` 降为**维护者侧对照工具**（`eo-quests` 地位），
读上游只出差异报告，**一个字都不写进 `assets/lodes/`**。

它是 `scripts/lib/bundled-lodes.mjs` 里 `FIRST_PARTY_LODE_IDS` 的头一个住户：
不在 `lode-sources.json` 里（那份清单会被 `fetch-lodes` 逐条遍历，没有 url 的条目会炸），
`npm run lodes:fetch` 一行都不会动它。

```json
{
  "schemaVersion": 1,
  "compiledAt": "2026-08-22",
  "checkedAt": "2026-06-26",
  "source": "kuma 限定期台账（第一方维护）",
  "revision": "2026.08.22",
  "maps": {
    "1-1": {
      "C": [
        {
          "id": 457,
          "limitedOnly": true,
          "window": {
            "from": "2025-10-29",
            "until": null,
            "lastConfirmedAt": "2026-06-26",
            "status": "active_confirmed",
            "label": "山風、磯風など"
          },
          "evidence": { "kind": "community", "note": "…", "recordedAt": "2026-08-22" },
          "votes": ["wikiwiki"]
        }
      ]
    }
  }
}
```

- 舰号一律是**改钉后**的形态号（见 `shared/map-drop-corrections.ts`），与 `map-drops` 同键；
  两边不同键的表现是「宗谷只在限定期掉」这句话悄悄消失，不报错、形状也没变。
- **每条必须有 `evidence`**（`official` / `ledger` / `community` + 凭据 + 录入日期）。
  没有凭据的台账条目与凭空捏造无法区分，而它看起来和有凭据的一模一样——校验器直接拒收。
- `votes` 里的 `ledger` 是本机遭遇志，**按图归不按点**（理由同 `map-drops`）。
- `conflict` 挂待裁项（批次 2 的 7 条 `limited-vs-plain`），运行时一行都不读，**脚本不代拍**。
- 三态由 `shared/limited-window.ts` 的 `limitedWindowPhase` 判：
  `open_undated`（没有截止日，常规图的常态）/ `open_dated`（有日子还没到）/
  `closed`（已收窗）/ `end_pending`（上游不再列出但说不出哪天关的）。

**收窗之后本机确认层怎么办：永不删除，只换语境。**「你在这里捞到过」是永真的历史事实；
最近一次捞到的日子落在已收窗的窗口里，就挂「限定期捞到 · 窗口已结束」折进往期，
不再混在面向当下的清单里。窗口关了之后**又**捞到过的仍然算当下——那正说明它其实还在掉。

### `map-drops` 的算票口径

三张票：kcwiki 掉落表（中文舰名经 `kcwiki-ships` 解号）、现行 `map-intel` 的既有条目、
本机遭遇志 `encounters.drop_mst`。**票的独立性与敌编成域不一样**：kcwiki 的常规海域页
页脚 37/37 自述「主要数据来源为日wiki」（原文照录在包的 `sourceNotes` 里），
所以两 wiki 一致只算「同源转录」，只有账本票才算真正独立的第二票。四档印证状态：

| 状态 | 判据 |
|---|---|
| 多源一致 | 有账本票 + 至少一张 wiki 票 |
| 同源转录 | kcwiki 与 wikiwiki 都收，但没有账本票（同祖，不升级） |
| 单源待印证 | 只有一家收；**照收不丢**（5-6、7-5 不归零） |
| 待裁 | 见 `assets/review/map-drops-conflicts.json` |

账本票**按图归不按点**：`encounters.cell` 是罗盘边号，要变成 wiki 点位字母得再过一层推导，
那一层的错法是把掉落挂到错的点上，比少一张票坏得多。
中文舰名解不出 mstId 一律硬错拒绝出包（不静默丢）；写法对不上的少数几个在
`scripts/lib/map-drops.mjs` 的 `KCWIKI_DROP_NAME_ALIASES` 里，**每条都要有同点锚定证据**。
kcwiki 掉落表里红色粗体的稀有度分级**故意不收**——那是编辑者的归纳，不是游戏事实。

`map-intel` 只保存“确认掉落”、空掉落标记和离散敌编成，不保存掉率。它是完整目录覆盖包；
应用重启后，鉴与镝会同时读取用户目录里的新版。

```json
{
  "meta": {
    "id": "map-intel",
    "name": "海域确认掉落与敌编成",
    "version": "2026.08.04.1",
    "source": "人工核对",
    "fetchedAt": "2026-08-04T00:00:00Z"
  },
  "data": {
    "schemaVersion": 1,
    "maps": {
      "1-1": {
        "source": "艦これ攻略 Wiki",
        "sourceUrl": "https://wikiwiki.jp/kancolle/鎮守府海域/1-1",
        "checkedAt": "2026-08-04",
        "revision": "2026.08.04.1",
        "nodes": {
          "C": {
            "ships": [
              {
                "id": 89,
                "limitedOnly": true,
                "limited": {
                  "from": "2025-01-28",
                  "until": null,
                  "lastConfirmedAt": "2026-06-26"
                }
              }
            ],
            "emptyDrop": "confirmed",
            "enemyComps": [
              { "formation": 1, "ships": [1505, 1501, 1501] }
            ]
          }
        }
      }
    }
  }
}
```

- 上面这个例子里的 `limited` / `limitedOnly` 是**旧形状**：2026-08-22 起常规图那一域整体
  搬进了第一方台账 `map-drop-windows`，底座里残留的同名字段在装配时一律不被继承。
  活动图那几层还照旧长这样。
- `until: null`：界面显示“暂无截止日期”；获知结束日后填 `YYYY-MM-DD`。
  **这是如实记录不是资料缺失**——常规图的限定掉落多是追加后一直开着的，
  调用方不许据此制造「快关门」的紧迫感（有护栏钉着）。
- `lastConfirmedAt`：资料仍处于有效名单的最后核对日，不拿抓取时间冒充确认时间。
- `limitedOnly: true`：这艘船只因本期限定而出现在该点。
- 已过 `until` 的限定条目自动退出当前掉落列表；常规敌编成无需随每次活动重复维护。

维护分两档：

```bash
npm run lodes:map-intel          # 低频：从 7 张聚合页重建 36 图掉落与敌编成
npm run lodes:map-intel-limited  # 高频：限定期台账 × 上游总表的**对照报告**（只读，不写包）
npm run lodes:fetch -- --only=map-enemy-comps  # 常规图敌编成汇编包（独立一层，见下）
```

第二条 2026-08-22 起**不再写数据**：它读上游的「当前持续中」一页，与第一方台账逐条比，
产物是 `assets/review/map-drop-windows-report.json`（差异逐条、带指纹）+ 控制台摘要，
外加账本给的「疑似已收窗」信号。改哪一条台账由人决定——尤其 `ledger-only`
（上游不再列出它）：写不写 `until`、写哪一天，脚本一条都不代拍。
加 `--offline` 可跳过联网，只跑台账自检与账本信号。
第一条重建常规图时会原样保留已有活动图四难度层，不会覆盖人工维护成果。
活动海域暂不套用常规海域资料，界面会明确显示“本地维护包待补”。

### 活动海域的四难度

活动图不得使用顶层 `nodes`，必须把资料放进 `difficulties`。甲、乙、丙、丁各自拥有完整节点表；
即使两档内容暂时相同也分别写明，消费端不会跨难度兜底：

```json
{
  "62-1": {
    "source": "艦これ攻略 Wiki",
    "sourceUrl": "https://wikiwiki.jp/kancolle/活动页",
    "checkedAt": "2026-08-04",
    "revision": "2026.08.04",
    "difficulties": {
      "甲": {
        "nodes": {
          "A": {
            "ships": [{ "id": 1 }],
            "emptyDrop": "unknown",
            "enemyComps": [{ "formation": "単縦陣", "ships": ["駆逐イ級"] }]
          }
        }
      },
      "乙": { "nodes": {} },
      "丙": { "nodes": {} },
      "丁": { "nodes": {} }
    }
  }
}
```

图鉴会优先显示游戏已选难度，并允许在四档间切换核对；镝在出击中只读取本次所选难度。
缺少某一档时明确显示“待补”，不会借用相邻难度的掉落或敌编成。

### 常规图敌编成汇编包 `map-enemy-comps`

自家 schema，随包（`npm run lodes:fetch -- --only=map-enemy-comps`）。
节点值直接就是编成数组——掉落与空掉落仍归 `map-intel`，一个域一个包。

```json
{
  "schemaVersion": 1,
  "compiledAt": "2026-08-22",
  "voters": { "kcwiki": "…", "wikiwiki": "…", "ledger": "…" },
  "maps": {
    "1-1": {
      "source": "kuma 汇编（舰娘百科「深海配置」× kuma 定号流水线 × 本机遭遇志）",
      "sourceUrl": "https://zh.kcwiki.cn/wiki/镇守府海域/1-1",
      "checkedAt": "2026-08-22",
      "revision": "2026.08.22",
      "contentDate": "2026-03-19",
      "nodes": {
        "A": [
          {
            "formation": 1,
            "ships": [1501],
            "labels": ["駆逐イ級"],
            "exp": 10,
            "votes": ["kcwiki", "wikiwiki", "ledger"]
          }
        ]
      }
    }
  }
}
```

- `ships` **全是 mstId**：上游（zh.kcwiki 的「深海配置」表）逐条自带号，不再从名字猜。
- `labels` 与 `ships` 等长，是 wiki 的形态标注（`軽母ヌ級改 flagship 艦載機鳥赤` 这类
  主数据没有的信息）。界面显示标注原文、链接用号。**长度对不上整包拒收**——
  展示层按下标取名，错位一格就是在战斗界面上说错敌人是谁。
- `formation`：单阵形出数字，多阵形出空格分隔的短假名（`"梯形 単横"`，与旧包同一约定，
  运行时 `formationTokensOf` 按它拆）。资料没写阵形时如实标 `"不明"`，不猜一个。
- `votes`：印证票。`kcwiki`（上游直接填的号）/ `wikiwiki`（旧包里定号流水线定出来的号）/
  `ledger`（本机遭遇志实测）。**运行时一行都不读**，UI 不逐条挂标。
- `conflict`：两票在同一条上互斥时才有。取值按基座源（kcwiki），同时进
  `assets/review/map-enemy-comps-conflicts.json` 等人裁——脚本不替人拍板。
- `contentDate`：上游页面最后一次**非机器人**编辑，内容的真实年龄。

单源条目照收不丢：只有一方收录的编成同样进包，只是 `votes` 长度为 1。
对账与反校跑 `node scripts/compare-map-intel-sources.mjs --air`。

## 考察过但未采用的源

留个档，免得下一个人重走一遍。

### 开发配方（「想要某装备该用什么配方 + 秘书舰」）

2026-08-09 普查，四个候选全部不合格：

| 源 | 许可 | 判据 |
| --- | --- | --- |
| `wantora/kancolle-recipe-generator` | MIT | 最后推送 2018-04-21，**停更 8 年** |
| `winddweb/KanColle-JSON-Database` | MIT | 最后推送 2015-09-22，**停更 11 年**，0 star |
| `kcwiki/kancolle-data` `db/development.json` | 无 | 仓库新鲜（2026-08-08），但内容是 `{装备id: true}` —— 「可否开发」的布尔标记，**不是配方** |
| `KC3Kai/KC3Kai` `src/data/` | MIT | 目录里没有配方数据（`developers.json` 是开发者名单，不是开发配方） |

开发产出本身也不是规则数据：输入是资源配比 + 秘书舰舰种，输出表在游戏内部，
社区那些配方表都是大样本统计的推定值——引进来必须按「推定」标注，
而唯一新鲜的源又不含这类数据。

本地替代（拿自己的账本做「装备 → 我用哪些配方出过它」的反查）同样不成立：
史·工厂已经做了正方向的「配方 → 结果 → 个人出货率」，但账本只保留 90 日，
本机实测开发仅 7 次、建造 12 次，反查出来几乎必然是空的。

**结论：暂不做。** 等出现活着的、结构化的配方源再议；在那之前不摆一个永远空着的面板。
