# 改造素材结构分档核对（2026-09-06）

本单起点 f6a39b7，工作树干净；测试基线3877、skipped 0。跨版本旧消费仍冻结在 176de57822f51c6376fc76b08868acc18a76b306 的555条边，未覆盖旧基线。当前事实 142 条边，初次 121 条（此前101），往复 39 条。循环内初次从0填到 **20** 条。这里只计API表外素材；“缺”不是零，有值也不表示所有素材齐全。

2026-09-06 画面裁定补单起点 b70d12b，工作树干净；测试基线3911、skipped 0。仅补502→507初次高建40／开发35，往复不变；原始来源冲突保留并标为已裁。

## 判档规则前后

旧：先合并各来源同边素材，再找初回／2回目以降／コンバート字样；无文字标注的循环边成为档不明。

新：wikiwiki每个目标的主条目直接归first，edges[source=footnote]直接归convert，各保留raw和结构evidence。返回／再度等文字只作佐证，不是门槛。附加index/chart不是主条目；与百科同边明确往复列逐项相等才归convert，未对齐的不猜档。

2026-09-06 单向进入边纠错（起点292255b）：运行时原先只判目标属于循环，现要求出发与目标同属 api_mst_shipupgrade 穷举出的循环。23条单向进入边固定first，无游戏报文也不生成往复档、不标uncertain，需求合计正常纳入62个真实素材数量格。伪往复档的19格缺料及43个重复原生chip归零。生成器同样不收非循环边的convert；本次检查已有事实表，此类档为0，清理0档，事实素材数据不变。

以下逐边列出无游戏报文输出；均仅first、missing=false，反查uncertain=false。素材键为种类与主数据ID，数量为实际初次消耗。

| 单向进入边 | 初次素材 |
| --- | --- |
| 112→462 | {"useitem:58":1,"useitem:65":1} |
| 117→555 | {} |
| 121→502 | {"useitem:58":1,"useitem:78":1,"useitem:77":2,"useitem:3":60} |
| 129→503 | {"useitem:58":1} |
| 130→504 | {"useitem:58":1} |
| 136→911 | {"useitem:58":3,"useitem:78":1,"slotitem:87":2,"useitem:75":3} |
| 151→593 | {"useitem:58":2,"useitem:78":1,"useitem:94":2,"useitem:3":390} |
| 215→652 | {"useitem:58":1,"useitem:2":55,"useitem:3":55} |
| 248→463 | {} |
| 253→464 | {} |
| 277→594 | {"useitem:58":2,"useitem:65":1,"useitem:78":1,"useitem:77":2,"useitem:3":100} |
| 278→698 | {"useitem:58":2,"useitem:65":1,"useitem:78":1,"useitem:77":2,"useitem:3":120} |
| 285→894 | {"useitem:58":1,"useitem:65":1,"useitem:2":20} |
| 288→461 | {"useitem:58":1,"useitem:65":1} |
| 293→622 | {"useitem:58":1,"useitem:78":1,"useitem:2":30,"useitem:3":30} |
| 307→663 | {"useitem:58":1,"useitem:78":1,"useitem:2":88,"useitem:3":88} |
| 318→883 | {"useitem:58":1,"useitem:65":1,"useitem:3":20} |
| 325→955 | {"useitem:58":1,"useitem:78":1,"useitem:3":30} |
| 369→588 | {"useitem:58":1,"useitem:78":1} |
| 390→903 | {"useitem:58":1,"useitem:2":10,"useitem:3":20} |
| 438→545 | {"useitem:58":1,"useitem:65":1} |
| 692→628 | {"useitem:58":1,"useitem:2":30,"useitem:3":120} |
| 73→501 | {"useitem:58":1,"useitem:78":1,"useitem:77":2,"useitem:3":60} |

百科“可以进行转换改装的舰船”段落按箭头及各列归convert；其他单串（模块、舰页）整列与wikiwiki同边已定档值比较，共有素材全部相等才佐证该档，单侧缺少的素材记来源缺项；唯一候选档不等记录冲突，多档均不等保留unknown。同值可佐证两档，不以方向代替档位。舰页的“互相转换”介绍句不传作后面形态需求子句的档名。初次原生道具逐边核对api_mst_shipupgrade的drawing/report/catapult/aviation_mat/arms_mat/boiler/tech字段，显式零也核对；冲突留审计，原生字段仍由API提供。

## 往复对与当前收录

主数据直接互逆21对，另有3组三形态循环。表中useitem:2为高速建造材，useitem:3为开发资材；原生道具不重复入事实表。

| 往复对（mstId/日文主数据名） | 左→右 | 右→左 |
| --- | --- | --- |
| 461 翔鶴改二 ⇄ 466 翔鶴改二甲 | 初次：缺；往复：{"useitem:3":15} | 初次：缺；往复：{"useitem:3":10} |
| 462 瑞鶴改二 ⇄ 467 瑞鶴改二甲 | 初次：缺；往复：{"useitem:3":15} | 初次：缺；往复：{"useitem:3":10} |
| 463 朝潮改二 ⇄ 468 朝潮改二丁 | 初次：缺；往复：缺 | 初次：缺；往复：缺 |
| 464 霞改二 ⇄ 470 霞改二乙 | 初次：缺；往复：缺 | 初次：缺；往复：缺 |
| 501 最上改二 ⇄ 506 最上改二特 | 初次：{"useitem:2":60,"useitem:3":45}；往复：{"useitem:2":40,"useitem:3":15} | 初次：缺；往复：缺 |
| 502 三隈改二 ⇄ 507 三隈改二特 | 初次：{"useitem:2":40,"useitem:3":35}；往复：{"useitem:2":40,"useitem:3":35} | 初次：缺；往复：{"useitem:2":40,"useitem:3":15} |
| 503 鈴谷改二 ⇄ 508 鈴谷航改二 | 初次：{"useitem:2":20,"useitem:3":10}；往复：{"useitem:2":20,"useitem:3":10} | 初次：缺；往复：{"useitem:2":20,"useitem:3":10} |
| 504 熊野改二 ⇄ 509 熊野航改二 | 初次：{"useitem:2":20,"useitem:3":10}；往复：{"useitem:2":20,"useitem:3":10} | 初次：缺；往复：{"useitem:2":20,"useitem:3":10} |
| 545 Saratoga Mk.II ⇄ 550 Saratoga Mk.II Mod.2 | 初次：缺；往复：{"useitem:2":30,"useitem:3":20} | 初次：缺；往复：{"useitem:2":30,"useitem:3":20} |
| 555 瑞鳳改二 ⇄ 560 瑞鳳改二乙 | 初次：{"useitem:2":20,"useitem:3":5}；往复：{"useitem:2":20,"useitem:3":5} | 初次：缺；往复：{"useitem:2":20,"useitem:3":5} |
| 594 赤城改二 ⇄ 599 赤城改二戊 | 初次：{"useitem:2":30,"useitem:3":80}；往复：{"useitem:2":30,"useitem:3":80} | 初次：缺；往复：{"useitem:2":30,"useitem:3":80} |
| 628 Fletcher改 Mod.2 ⇄ 629 Fletcher Mk.II | 初次：{"useitem:2":30,"useitem:3":180}；往复：{"useitem:2":30,"useitem:3":180} | 初次：缺；往复：缺 |
| 652 球磨改二 ⇄ 657 球磨改二丁 | 初次：{"useitem:2":15,"useitem:3":30}；往复：{"useitem:2":15,"useitem:3":30} | 初次：缺；往复：{"useitem:2":15,"useitem:3":30} |
| 588 山風改二 ⇄ 667 山風改二丁 | 初次：{"useitem:2":10,"useitem:3":10}；往复：{"useitem:2":10,"useitem:3":10} | 初次：缺；往复：{"useitem:2":10,"useitem:3":10} |
| 663 矢矧改二 ⇄ 668 矢矧改二乙 | 初次：{"useitem:2":30,"useitem:3":45}；往复：{"useitem:2":20,"useitem:3":15} | 初次：缺；往复：{"useitem:2":20,"useitem:3":15} |
| 883 龍鳳改二戊 ⇄ 888 龍鳳改二 | 初次：{"useitem:2":20}；往复：缺 | 初次：缺；往复：{"useitem:2":20} |
| 894 鳳翔改二 ⇄ 899 鳳翔改二戦 | 初次：{"useitem:2":20,"useitem:3":20}；往复：{"useitem:2":20,"useitem:3":20} | 初次：缺；往复：{"useitem:2":20} |
| 903 天霧改二 ⇄ 908 天霧改二丁 | 初次：{"useitem:2":10,"useitem:3":20}；往复：{"useitem:2":10,"useitem:3":20} | 初次：缺；往复：{"useitem:2":10,"useitem:3":5} |
| 911 大和改二 ⇄ 916 大和改二重 | 初次：缺；往复：缺 | 初次：缺；往复：{"useitem:2":50,"useitem:3":50} |
| 593 榛名改二乙 ⇄ 954 榛名改二丙 | 初次：{"useitem:2":35,"useitem:3":55}；往复：{"useitem:2":35,"useitem:3":55} | 初次：缺；往复：{"useitem:2":35,"useitem:3":15} |
| 955 清霜改二 ⇄ 960 清霜改二丁 | 初次：{"useitem:2":10,"useitem:3":10}；往复：{"useitem:2":10,"useitem:3":10} | 初次：缺；往复：{"useitem:2":10,"useitem:3":10} |

| 循环 | 边 | 两档 |
| --- | --- | --- |
| 610 加賀改二戊／646 加賀改二護／698 加賀改二 | 698→610 | 初次：{"useitem:2":30,"useitem:3":88}；往复：{"useitem:2":30,"useitem:3":88} |
| 610 加賀改二戊／646 加賀改二護／698 加賀改二 | 610→646 | 初次：{"useitem:2":84,"useitem:3":84}；往复：{"useitem:2":84,"useitem:3":84} |
| 610 加賀改二戊／646 加賀改二護／698 加賀改二 | 646→698 | 初次：缺；往复：缺 |
| 622 夕張改二／623 夕張改二特／624 夕張改二丁 | 624→622 | 初次：缺；往复：{"useitem:2":30,"useitem:3":30} |
| 622 夕張改二／623 夕張改二特／624 夕張改二丁 | 622→623 | 初次：{"useitem:2":30,"useitem:3":30}；往复：{"useitem:2":30,"useitem:3":30} |
| 622 夕張改二／623 夕張改二特／624 夕張改二丁 | 623→624 | 初次：{"useitem:2":30,"useitem:3":30}；往复：{"useitem:2":30,"useitem:3":30} |
| 645 宗谷／650 宗谷／699 宗谷 | 699→645 | 初次：{"useitem:2":5,"useitem:3":5}；往复：缺 |
| 645 宗谷／650 宗谷／699 宗谷 | 645→650 | 初次：缺；往复：缺 |
| 645 宗谷／650 宗谷／699 宗谷 | 650→699 | 初次：缺；往复：缺 |

## 按档对账

### 初次

数值冲突（API也是核对来源；未裁素材不收，已裁项保留原值）：

| 边 | 素材 | 各来源值 | 处理 |
| --- | --- | --- | --- |
| 152→694 | useitem:94 | {"wikiwiki":2,"api":0} | 不收；API字段仍按主数据显示 |
| 502→507 | useitem:2 | {"wikiwiki":40,"kcwiki":40,"kcwikiPage":60} | 已裁（画面证据）；收录40 |
| 502→507 | useitem:3 | {"wikiwiki":45,"kcwiki":35,"kcwikiPage":45} | 已裁（画面证据）；收录35 |
| 718→1033 | useitem:78 | {"wikiwiki":2,"api":0} | 不收；API字段仍按主数据显示 |

来源缺项（逐素材；API字段只核对、不入事实表）：

| 边 | 素材 | 已提供该档数值的来源 | 收录 |
| --- | --- | --- | --- |
| 152→694 | useitem:75 | {"kcwiki":2} | 2 |
| 152→694 | useitem:94 | {"wikiwiki":2} | 未入表（API／冲突） |
| 503→508 | useitem:2 | {"kcwiki":20} | 20 |
| 503→508 | useitem:3 | {"kcwiki":10} | 10 |
| 504→509 | useitem:2 | {"kcwiki":20} | 20 |
| 504→509 | useitem:3 | {"kcwiki":10} | 10 |
| 718→1033 | useitem:78 | {"wikiwiki":2} | 未入表（API／冲突） |
| 718→1033 | useitem:94 | {"kcwiki":2} | 未入表（API／冲突） |
| 991→747 | useitem:2 | {"kcwiki":20} | 20 |
| 991→747 | useitem:3 | {"kcwiki":100} | 100 |

旧解析修正：

| 边 | 来源 | 旧身份 | 新身份 | 数量 | 依据 |
| --- | --- | --- | --- | --- | --- |
| 323→975 | kcwiki | unknown:改修资材 | useitem:4 | 5 | api_mst_useitem[api_id=4].api_name=改修資材；kcwiki 别名 改修资材 |
| 215→652 | wikiwiki | unknown:高速建造剤 | useitem:2 | 55 | api_mst_useitem[api_id=2].api_name=高速建造材 |
| 652→657 | wikiwiki | unknown:高速建造剤 | useitem:2 | 15 | api_mst_useitem[api_id=2].api_name=高速建造材 |
| 323→975 | wikiwiki | unknown:改修資材 | useitem:4 | 5 | api_mst_useitem[api_id=4].api_name=改修資材 |

### 往复

数值冲突（API也是核对来源；未裁素材不收，已裁项保留原值）：

| 边 | 素材 | 各来源值 | 处理 |
| --- | --- | --- | --- |
| 506→501 | useitem:2 | {"wikiwiki":40,"kcwikiTable":30,"kcwiki":40} | 不收；API字段仍按主数据显示 |
| 506→501 | useitem:3 | {"wikiwiki":15,"kcwikiTable":45,"kcwiki":15} | 不收；API字段仍按主数据显示 |
| 629→628 | useitem:2 | {"wikiwiki":20,"kcwikiTable":65,"kcwiki":20} | 不收；API字段仍按主数据显示 |
| 629→628 | useitem:3 | {"wikiwiki":20,"kcwikiTable":45,"kcwiki":20} | 不收；API字段仍按主数据显示 |

来源缺项（逐素材；API字段只核对、不入事实表）：

| 边 | 素材 | 已提供该档数值的来源 | 收录 |
| --- | --- | --- | --- |
| 461→466 | useitem:3 | {"kcwikiTable":15} | 15 |
| 462→467 | useitem:3 | {"kcwikiTable":15} | 15 |
| 501→506 | useitem:2 | {"kcwikiTable":40} | 40 |
| 501→506 | useitem:3 | {"kcwikiTable":15} | 15 |
| 502→507 | useitem:2 | {"preserved":40} | 40 |
| 502→507 | useitem:3 | {"preserved":35} | 35 |
| 503→508 | useitem:2 | {"kcwikiTable":20} | 20 |
| 503→508 | useitem:3 | {"kcwikiTable":10} | 10 |
| 503→508 | useitem:58 | {"kcwikiTable":1} | 未入表（API／冲突） |
| 504→509 | useitem:2 | {"kcwikiTable":20} | 20 |
| 504→509 | useitem:3 | {"kcwikiTable":10} | 10 |
| 504→509 | useitem:58 | {"kcwikiTable":1} | 未入表（API／冲突） |
| 545→550 | useitem:2 | {"kcwikiTable":30} | 30 |
| 545→550 | useitem:3 | {"kcwikiTable":20} | 20 |
| 550→545 | useitem:2 | {"kcwikiTable":30} | 30 |
| 550→545 | useitem:3 | {"kcwikiTable":20} | 20 |
| 555→560 | useitem:2 | {"kcwikiTable":20} | 20 |
| 555→560 | useitem:3 | {"kcwikiTable":5} | 5 |
| 560→555 | useitem:2 | {"kcwikiTable":20} | 20 |
| 560→555 | useitem:3 | {"kcwikiTable":5} | 5 |
| 588→667 | useitem:2 | {"kcwikiTable":10} | 10 |
| 588→667 | useitem:3 | {"kcwikiTable":10} | 10 |
| 593→954 | useitem:2 | {"kcwikiTable":35} | 35 |
| 593→954 | useitem:3 | {"kcwikiTable":55} | 55 |
| 594→599 | useitem:2 | {"kcwikiTable":30} | 30 |
| 594→599 | useitem:3 | {"kcwikiTable":80} | 80 |
| 610→646 | useitem:2 | {"kcwikiTable":84} | 84 |
| 610→646 | useitem:3 | {"kcwikiTable":84} | 84 |
| 622→623 | useitem:2 | {"kcwikiTable":30} | 30 |
| 622→623 | useitem:3 | {"kcwikiTable":30} | 30 |
| 623→624 | useitem:2 | {"kcwikiTable":30} | 30 |
| 623→624 | useitem:3 | {"kcwikiTable":30} | 30 |
| 628→629 | useitem:2 | {"kcwikiTable":30} | 30 |
| 628→629 | useitem:3 | {"kcwikiTable":180} | 180 |
| 652→657 | useitem:2 | {"kcwikiTable":15} | 15 |
| 652→657 | useitem:3 | {"kcwikiTable":30} | 30 |
| 663→668 | useitem:2 | {"kcwikiTable":20} | 20 |
| 663→668 | useitem:3 | {"kcwikiTable":15} | 15 |
| 698→610 | useitem:2 | {"kcwikiTable":30} | 30 |
| 698→610 | useitem:3 | {"kcwikiTable":88} | 88 |
| 894→899 | useitem:2 | {"kcwikiTable":20} | 20 |
| 894→899 | useitem:3 | {"kcwikiTable":20} | 20 |
| 903→908 | useitem:2 | {"kcwikiTable":10} | 10 |
| 903→908 | useitem:3 | {"kcwikiTable":20} | 20 |
| 955→960 | useitem:2 | {"kcwikiTable":10} | 10 |
| 955→960 | useitem:3 | {"kcwikiTable":10} | 10 |

旧解析修正：

| 边 | 来源 | 旧身份 | 新身份 | 数量 | 依据 |
| --- | --- | --- | --- | --- | --- |

## 来源行错误与档不明

| 边 | 原档 | 来源 | 原值 | 原因 |
| --- | --- | --- | --- | --- |
| 502→507 | convert | kcwikiTable | {"useitem:2":40,"useitem:3":15} | 总表来源行错误：正向格放入脚注回程40/15，回程格30/45不符合本单回程裁定；不参加数值合并 |
| 507→502 | convert | kcwikiTable | {"useitem:2":30,"useitem:3":45} | 总表来源行错误：正向格放入脚注回程40/15，回程格30/45不符合本单回程裁定；不参加数值合并 |
| 502→507 | first | wikiwiki | {"useitem:3":45} | 来源错误：与公开游戏改装画面（2026-09 核）裁定不符；仅订正502→507初次高建40／开发35 |
| 502→507 | first | kcwikiPage | {"useitem:2":60,"useitem:3":45} | 来源错误：与公开游戏改装画面（2026-09 核）裁定不符；仅订正502→507初次高建40／开发35 |

| 边 | 来源 | 值 | 原文 |
| --- | --- | --- | --- |
| 646→698 | wikiwiki | {"useitem:2":30,"useitem:3":60} | Lv84+高速建造材x30+開発資材x60 |
| 461→466 | kcwiki | {"useitem:3":15} | 开发资材x15 |
| 462→467 | kcwiki | {"useitem:3":15} | 开发资材x15 |
| 545→550 | kcwiki | {"useitem:2":30,"useitem:3":20} | 高速建造材x30 开发资材x20 |
| 550→545 | kcwiki | {"useitem:2":30,"useitem:3":20} | 高速建造材x30 开发资材x20 |
| 560→555 | kcwiki | {"useitem:2":20,"useitem:3":5} | 高速建造材x20 开发资材x5 |
| 645→650 | kcwiki | {"useitem:2":10,"useitem:3":20} | 高速建造材x10 开发资材x20 |
| 646→698 | kcwiki | {"useitem:2":30,"useitem:3":60} | 高速建造材x30 开发资材x60 |
| 650→699 | kcwiki | {"useitem:2":5} | 高速建造材x5 |

| 舰页 | 修订 | 已提取边 | 数值原文（空表示本次数值扫描未找到） |
| --- | --- | --- | --- |
| 球磨 | 177085 |  |  |
| 春雨 | 187515 | 323→975 | *继16年实装三周年限定立绘后，时隔8年获得了改二形态。与大姐[[白露]]类似，改二仅需要战斗详报而不需要图纸。不过会额外需要改修资材×5，是首位需要改修资材进行改造的舰娘。 |
| 三隈 | 170343 | 121→502、502→507 | *2024年1月25日实装了改二与改二特形态，互相之间可以转换。改二需要80级和改装设计图x1+开发资材x60+战斗详报x1+新型航空兵装资材x2，改二特需要90级和高速建造材x60+开发资材x45。 |
| 贝尔格拉诺将军 | 170041 | 734→957 | ／改造一览=凤凰城→凤凰城改(Lv45)→贝尔格拉诺将军(Lv75+新型兵装资材x1+开发资材x30) ／改造一览=凤凰城→凤凰城改(Lv45)→贝尔格拉诺将军(Lv75+新型兵装资材x1+开发资材x30) ／改造一览=凤凰城→凤凰城改(Lv45)→贝尔格拉诺将军(Lv75+新型兵装资材x1+开发资材x30) |
| 翔鹤 | 175665 |  |  |
| 瑞鹤 | 181314 |  |  |
| 霞 | 146808 |  |  |
| 朝潮 | 141644 |  |  |
| 最上 | 174116 | 73→501、501→506 | *2021年3月30日实装了改二与改二特形态，互相之间可以转换。改二需要80级和改装设计图x1+开发资材x60+战斗详报x1+新型航空兵装资材x2，改二特需要90级和高速建造材x60+开发资材x45。 |
| 铃谷 | 78269 |  |  |
| 熊野 | 174382 |  |  |
| Saratoga | 168103 |  |  |
| 瑞凤 | 162801 |  |  |
| 山风 | 183524 |  |  |
| 榛名 | 181369 |  |  |
| 赤城 | 186853 |  |  |
| Fletcher | 183591 |  |  |
| 矢矧 | 182719 | 307→663 | *2021年3月30日正式实装了矢矧的改二形态<s>此时距离动画正式开播还有一年半多</s>，需要改装设计图×1+战斗详报×1+高速建造材×88+开发资材×88，具有改二（88级）与改二乙（90级）的双形态。 |
| 龙凤 | 181181 |  |  |
| 凤翔 | 167650 |  |  |
| 天雾 | 181240 |  |  |
| 大和 | 183550 |  |  |
| 清霜 | 181147 |  |  |
| 加贺 | 186764 |  |  |
| 夕张 | 181659 |  |  |
| 宗谷 | 154899 |  |  |

## 三隈两边两档

502→507初次：公开游戏改装画面（2026-09 核）显示 新型兵装資材1／高速建造材40／開発資材35，与舰娘百科模块、zekamashi 同值。初次收高建40／开发35；wikiwiki开发45、舰页高建60／开发45归来源错误，两项原始冲突标为“已裁（画面证据）”。

维护者订正（仅指定边、档及两种API表外素材）：

| 边 | 档 | 素材 | basis | evidence | date |
| --- | --- | --- | --- | --- | --- |
| 502→507 | first | {"useitem:2":40,"useitem:3":35} | maintainer | 公开游戏改装画面（2026-09 核）显示 新型兵装資材1／高速建造材40／開発資材35，与舰娘百科模块、zekamashi 同值 | 2026-09-06 |

对照资料主数据核对：api_mst_ship[api_id=502].api_afterbull=1800（画面弾薬1800），api_afterfuel=3800（画面鋼材3800）；502→507的api_mst_shipupgrade.api_arms_mat_count=1（画面新型兵装資材1）。三项均一致，主数据未改；新型兵装資材由API提供，不重复入事实表。

502→507往复：维持高建40／开发35；preserved证据单列，不伪称wikiwiki初次45是往复冲突。zekamashi仅保留统筹方给定URL，没有抓取或新判档。

507→502初次：缺；wikiwiki目标502主条目来路是121，不能挪到507。507→502往复：wikiwiki脚注高建40／开发15，模块同边同值佐证；事实表收40/15。

百科总表缓存正向行确为40/15、回程行确为30/45，解析器按箭头读取无误；按本单回程裁定，把这两行记作总表来源行错误而排除合并，保留原边原档原值，不能静默互换。其15落在正向格，却与wikiwiki回程15对应。

| 边 | 来源 | 档 | 值 | 判档依据 |
| --- | --- | --- | --- | --- |
| 507→502 | wikiwiki | convert | {"useitem:2":40,"useitem:3":15} | edges[source=footnote] → convert |
| 502→507 | wikiwiki | first | {"useitem:94":1,"useitem:2":40,"useitem:3":45} | targetShipId 主条目 → first |
| 502→507 | kcwiki | first | {"useitem:2":40,"useitem:3":35,"useitem:94":1} | 同边 wikiwiki 唯一候选档；数值不等，整列进入冲突核对 |
| 507→502 | kcwiki | convert | {"useitem:2":40,"useitem:3":15} | 与同边 wikiwiki convert 共有素材全相等，整列归档；未提供素材记来源缺项 |
| 502→507 | kcwikiPage | first | {"useitem:2":60,"useitem:3":45} | 同边 wikiwiki 唯一候选档；数值不等，整列进入冲突核对 |
| 502→507 | preserved | convert | {"useitem:3":35,"useitem:2":40} | 本单授权保留 f6a39b7 裁决前往复35/40；zekamashi仅出处，未出网核文 |

## 运行时、口径与输入

此前结构分档返工未改运行时；本次仅收紧分档边界。API显式值（含零）优先，循环内边未知历史两档并列、不相加；单向进入边只计初次。生产口径审计及白名单复核见[player-view-audit.md](player-view-audit.md)，不得用白名单掩盖来源冲突。

反查等级以主数据 api_afterlv 为准（2026-09-06 跨版本对账确认为纠错）：取出发形态的 api_mst_ship[from].api_afterlv，替代旧 wiki 明细／目标等级回退值。74e0b67 → 292255b 对账的16条边、27个等级格均符合API，例如330→963由88改85，507→502由82改89。本次只补记裁决，不改等级逻辑。

三份资料、主数据及百科缓存均只读核对；sourceHashes在夹具，逐素材结构/raw/API核对在meta.evidence，冲突的原文证据在夹具conflicts。本次不出网、不写资料目录、不改上游包。百科页面修订如下：

| 百科页面 | 修订 |
| --- | --- |
| 改造 | 182671 |
| 模块:舰娘数据 | 187523 |
| 球磨 | 177085 |
| 春雨 | 187515 |
| 三隈 | 170343 |
| 凤凰城 | 170041 |
| 翔鹤 | 175665 |
| 瑞鹤 | 181314 |
| 霞 | 146808 |
| 朝潮 | 141644 |
| 最上 | 174116 |
| 铃谷 | 78269 |
| 熊野 | 174382 |
| 萨拉托加 | 168103 |
| 瑞凤 | 162801 |
| 山风 | 183524 |
| 榛名 | 181369 |
| 赤城 | 186853 |
| 弗莱彻 | 183591 |
| 矢矧 | 182719 |
| 大鲸 | 181181 |
| 凤翔 | 167650 |
| 天雾 | 181240 |
| 大和 | 183550 |
| 清霜 | 181147 |
| 加贺 | 186764 |
| 夕张 | 181659 |
| 宗谷 | 154899 |

## 冻结旧消费逐档差异

| 边 | 档 | 素材 | HEAD旧值 | 本次 |
| --- | --- | --- | --- | --- |
| 461→466 | first | useitem:3 | 15 | 缺 |
| 462→467 | first | useitem:3 | 15 | 缺 |
| 466→461 | first | useitem:3 | 10 | 缺 |
| 467→462 | first | useitem:3 | 10 | 缺 |
| 506→501 | first | useitem:2 | 40 | 缺 |
| 506→501 | first | useitem:3 | 15 | 缺 |
| 507→502 | first | useitem:2 | 40 | 缺 |
| 507→502 | first | useitem:3 | 15 | 缺 |
| 508→503 | first | useitem:2 | 20 | 缺 |
| 508→503 | first | useitem:3 | 10 | 缺 |
| 509→504 | first | useitem:2 | 20 | 缺 |
| 509→504 | first | useitem:3 | 10 | 缺 |
| 545→550 | first | useitem:2 | 30 | 缺 |
| 545→550 | first | useitem:3 | 20 | 缺 |
| 550→545 | first | useitem:2 | 30 | 缺 |
| 550→545 | first | useitem:3 | 20 | 缺 |
| 560→555 | first | useitem:2 | 20 | 缺 |
| 560→555 | first | useitem:3 | 5 | 缺 |
| 599→594 | first | useitem:2 | 30 | 缺 |
| 599→594 | first | useitem:3 | 80 | 缺 |
| 624→622 | first | useitem:2 | 30 | 缺 |
| 624→622 | first | useitem:3 | 30 | 缺 |
| 629→628 | first | useitem:2 | 20 | 缺 |
| 629→628 | first | useitem:3 | 20 | 缺 |
| 645→650 | first | useitem:2 | 10 | 缺 |
| 645→650 | first | useitem:3 | 20 | 缺 |
| 646→698 | first | useitem:2 | 30 | 缺 |
| 646→698 | first | useitem:3 | 60 | 缺 |
| 650→699 | first | useitem:2 | 5 | 缺 |
| 657→652 | first | useitem:2 | 15 | 缺 |
| 657→652 | first | useitem:3 | 30 | 缺 |
| 667→588 | first | useitem:2 | 10 | 缺 |
| 667→588 | first | useitem:3 | 10 | 缺 |
| 668→663 | first | useitem:2 | 20 | 缺 |
| 668→663 | first | useitem:3 | 15 | 缺 |
| 888→883 | first | useitem:2 | 20 | 缺 |
| 899→894 | first | useitem:2 | 20 | 缺 |
| 908→903 | first | useitem:2 | 10 | 缺 |
| 908→903 | first | useitem:3 | 5 | 缺 |
| 916→911 | first | useitem:2 | 50 | 缺 |
| 916→911 | first | useitem:3 | 50 | 缺 |
| 954→593 | first | useitem:2 | 35 | 缺 |
| 954→593 | first | useitem:3 | 15 | 缺 |
| 960→955 | first | useitem:2 | 10 | 缺 |
| 960→955 | first | useitem:3 | 10 | 缺 |
| 501→506 | convert | useitem:2 | 60 | 40 |
| 501→506 | convert | useitem:3 | 45 | 15 |
| 506→501 | convert | useitem:2 | 40 | 缺 |
| 506→501 | convert | useitem:3 | 15 | 缺 |
| 629→628 | convert | useitem:2 | 20 | 缺 |
| 629→628 | convert | useitem:3 | 20 | 缺 |
| 645→650 | convert | useitem:2 | 10 | 缺 |
| 645→650 | convert | useitem:3 | 20 | 缺 |
| 646→698 | convert | useitem:2 | 30 | 缺 |
| 646→698 | convert | useitem:3 | 60 | 缺 |
| 650→699 | convert | useitem:2 | 5 | 缺 |
| 663→668 | convert | useitem:2 | 30 | 20 |
| 663→668 | convert | useitem:3 | 45 | 15 |
| 699→645 | convert | useitem:2 | 5 | 缺 |
| 699→645 | convert | useitem:3 | 5 | 缺 |
| 883→888 | convert | useitem:2 | 20 | 缺 |

## 任务书订正

1. “初次从0”指循环内边；旧全表实际有101条初次，不能报成全表0。
2. 对照资料附加边还有index与chart，除footnote外不应一律猜成初次或往复；本次按明确同边往复列核对，剩余列unknown。
3. 三隈总表40/15在正向、30/45在回程是缓存原文如此，并非本地箭头提取颠倒；属于来源行错误，按本单指定回程40/15执行。
4. 新型兵装资材等不都是初次专属：三隈舰页明确每次转为改二特均耗1个，API也为1；本次核对但不改运行时原生素材逻辑。
