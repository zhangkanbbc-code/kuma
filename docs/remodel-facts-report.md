# 改造素材结构分档核对（2026-09-07）

本单起点 f6a39b7，工作树干净；测试基线3877、skipped 0。跨版本旧消费仍冻结在 176de57822f51c6376fc76b08868acc18a76b306 的555条边，未覆盖旧基线。当前事实 222 条边，初次 200 条（此前101），往复 45 条。循环内初次从0填到 **25** 条。这里只计API表外素材；“缺”不是零，有值也不表示所有素材齐全。

2026-09-06 画面裁定补单起点 b70d12b，工作树干净；测试基线3911、skipped 0。仅补502→507初次高建40／开发35，往复不变；原始来源冲突保留并标为已裁。

2026-09-10 维护新增边登记：起点a923ce11550f44fcdec0bb1a5dab571646be7c69，工作树干净；测试基线4614、skipped 0。按公开游戏改装画面登记以下三条first事实，仅收API没有字段的工廠資源、高速建造材、開発資材；API显式素材仍由主数据提供。三个目标均无回程，不登记convert或确认无空档。既有222条边的值保留；重生成时，新主数据另使25→58、58→119按既有三源规则确认first无特殊素材，证据逐边列于下表。当前事实227条，first 205条、convert 45条，循环内first 25条；确认无共87边/档，first 81、convert 6。旧555边消费基线与循环单向进入23边62格的范围不变，新增终点边单独复验，运行时扶桑／山城各4项、北上5项。

| 边 | 档 | 来源依据 | 日期 | 登记素材 | 公开游戏改装画面原文 |
| --- | --- | --- | --- | --- | --- |
| 411→748 | first | maintainer | 2026-09-10 | {"useitem:104":3,"useitem:2":188,"useitem:3":48} | 公开游戏改装画面（2026-09-10 核）显示 扶桑改二→扶桑改二補：工廠資源3／新型航空兵装資材3／高速建造材188／開発資材48／弾薬3200／鋼材5400 |
| 412→749 | first | maintainer | 2026-09-10 | {"useitem:104":3,"useitem:2":188,"useitem:3":48} | 公开游戏改装画面（2026-09-10 核）显示 山城改二→山城改二補：工廠資源3／新型航空兵装資材3／高速建造材188／開発資材48／弾薬3200／鋼材5400 |
| 119→1071 | first | maintainer | 2026-09-10 | {"useitem:104":5,"useitem:2":550,"useitem:3":55} | 公开游戏改装画面（2026-09-10 核）显示 北上改二→北上改三：改装設計図2／新型兵装資材3／工廠資源5／高速建造材550／開発資材55／弾薬1500／鋼材2500 |

## 确认无特殊素材

2026-09-07，首单起点ca53fbe、测试基线3967；续单起点2b216f9、工作树干净、测试基线3998，skipped均为0。某档{}表示确认无特殊素材；缺边或缺档仍未知，stages本身不允许为空。正向first规则保持：wikiwiki目标主条目fromShipId同出发且needs=[]，同边api_mst_shipupgrade全部*_count显式零，以及百科出发形态的改造行“改造后”对齐目标且无图纸或图纸为空。回程first与convert按下面两条补充判据。以下共85边/档，first 79、convert 6；数据不限定循环边，显示层仅convertible为真时显示“无特殊素材”，普通单向空档不显示文字。

### 回程与转换段空成本行

主数据api_mst_shipupgrade直接互逆A⇄B的B→A回程first：API同边全部*_count显式零；百科ID=B的改造行指向A且图纸栏缺失或为空；wikiwiki无B→A脚注附加边；百科转换段无B→A带成本行（显式空成本行不算带成本）；目标A主条目needs=[]。该主条目可来自常规前置形态，来路不同仅作目标形态无需特殊道具的佐证，写入basis，不再否决。

convert确认无有两条独立规则：①主数据直接互逆、两向first均确认无、两向无wikiwiki脚注、百科转换段无该对；②百科转换段该方向有显式空成本格（空白或“-”，缺成本格不算）、wikiwiki同向无脚注、API同边全部*_count显式零。两规则均逐条保留三源evidence；无行／无脚注的核对结果记[]，空成本保留原格文字与边方向。

本地实测新增8边/档：468→463、470→464的first；463→468、468→463、464→470、470→464、911→916及646→698的convert。朝潮／霞转换段四方向实际均有“-”成本格，命中规则②，不能报告成“转换段无该对”。额外646→698（加贺改二护→加贺改二）属于既有三形态循环，转换段该方向空成本、wikiwiki同向无脚注、API同边全零，同样按规则②收录；该规则未限定直接互逆对，循环口径不变。

公开来源原文（核对日期2026-09-07；wikiwiki注明页面日期，百科随包模块来源日期2026-08-11T07:53:09Z；API为游戏api_mst_shipupgrade对应行）：

| 边 | 档 | wikiwiki原文／结构 | API原文 | 百科原文／结构 | 结论 |
| --- | --- | --- | --- | --- | --- |
| 25→58 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）10；目标58主条目fromShipId=25，needs=[] | {"api_current_ship_id":25,"api_id":58,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":10,"弹药":400,"钢材":100,"改造前":-1,"改造后":"098","系列":"020"}；ID=25的改造后=098对应目标58，图纸栏缺失或为空 | 无特殊素材 |
| 77→82 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）10；目标82主条目fromShipId=77，needs=[] | {"api_current_ship_id":77,"api_id":82,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":10,"弹药":150,"钢材":500,"改造前":-1,"改造后":"102","系列":"003"}；ID=77的改造后=102对应目标82，图纸栏缺失或为空 | 无特殊素材 |
| 87→88 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）10；目标88主条目fromShipId=87，needs=[] | {"api_current_ship_id":87,"api_id":88,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":10,"弹药":150,"钢材":500,"改造前":-1,"改造后":"103","系列":"004"}；ID=87的改造后=103对应目标88，图纸栏缺失或为空 | 无特殊素材 |
| 58→119 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）50；目标119主条目fromShipId=58，needs=[] | {"api_current_ship_id":58,"api_id":119,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":50,"弹药":770,"钢材":400,"改造前":"020","改造后":"115","系列":"020"}；ID=58的改造后=115对应目标119，图纸栏缺失或为空 | 无特殊素材 |
| 243→145 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）60；目标145主条目fromShipId=243，needs=[] | {"api_current_ship_id":243,"api_id":145,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":60,"弹药":200,"钢材":180,"改造前":"080","改造后":"145","系列":"080"}；ID=243的改造后=145对应目标145，图纸栏缺失或为空 | 无特殊素材 |
| 143→148 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）40；目标148主条目fromShipId=143，needs=[] | {"api_current_ship_id":143,"api_id":148,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":40,"弹药":2500,"钢材":3000,"改造前":-1,"改造后":"148","系列":"143"}；ID=143的改造后=148对应目标148，图纸栏缺失或为空 | 无特殊素材 |
| 209→149 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）75；目标149主条目fromShipId=209，needs=[] | {"api_current_ship_id":209,"api_id":149,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":75,"弹药":2400,"钢材":2400,"改造前":"021","改造后":"149","系列":"021"}；ID=209的改造后=149对应目标149，图纸栏缺失或为空 | 无特殊素材 |
| 210→150 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）75；目标150主条目fromShipId=210，needs=[] | {"api_current_ship_id":210,"api_id":150,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":75,"弹药":2400,"钢材":2400,"改造前":"022","改造后":"150","系列":"022"}；ID=210的改造后=150对应目标150，图纸栏缺失或为空 | 无特殊素材 |
| 211→151 | first | https://wikiwiki.jp/kancolle/%E6%A6%9B%E5%90%8D（2026-06-02）Lv80；目标151主条目fromShipId=211，needs=[] | {"api_current_ship_id":211,"api_id":151,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":80,"弹药":2400,"钢材":2400,"改造前":"023","改造后":"151","系列":"023"}；ID=211的改造后=151对应目标151，图纸栏缺失或为空 | 无特殊素材 |
| 212→152 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）75；目标152主条目fromShipId=212，needs=[] | {"api_current_ship_id":212,"api_id":152,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":75,"弹药":2400,"钢材":2400,"改造前":"024","改造后":"152","系列":"024"}；ID=212的改造后=152对应目标152，图纸栏缺失或为空 | 无特殊素材 |
| 171→172 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）30；目标172主条目fromShipId=171，needs=[] | {"api_current_ship_id":171,"api_id":172,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":30,"弹药":800,"钢材":600,"改造前":-1,"改造后":"172","系列":"171"}；ID=171的改造后=172对应目标172，图纸栏缺失或为空 | 无特殊素材 |
| 280→196 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）77；目标196主条目fromShipId=280，needs=[] | {"api_current_ship_id":280,"api_id":196,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":77,"弹药":1700,"钢材":1200,"改造前":"009","改造后":"196","系列":"009"}；ID=280的改造后=196对应目标196，图纸栏缺失或为空 | 无特殊素材 |
| 9→201 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）20；目标201主条目fromShipId=9，needs=[] | {"api_current_ship_id":9,"api_id":201,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":20,"弹药":100,"钢材":100,"改造前":-1,"改造后":"011a","系列":"011"}；ID=9的改造后=011a对应目标201，图纸栏缺失或为空 | 无特殊素材 |
| 10→202 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）20；目标202主条目fromShipId=10，needs=[] | {"api_current_ship_id":10,"api_id":202,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":20,"弹药":100,"钢材":100,"改造前":-1,"改造后":"012a","系列":"012"}；ID=10的改造后=012a对应目标202，图纸栏缺失或为空 | 无特殊素材 |
| 32→203 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）20；目标203主条目fromShipId=32，needs=[] | {"api_current_ship_id":32,"api_id":203,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":20,"弹药":100,"钢材":100,"改造前":-1,"改造后":"013a","系列":"013"}；ID=32的改造后=013a对应目标203，图纸栏缺失或为空 | 无特殊素材 |
| 11→204 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）20；目标204主条目fromShipId=11，needs=[] | {"api_current_ship_id":11,"api_id":204,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":20,"弹药":100,"钢材":100,"改造前":-1,"改造后":"014a","系列":"014"}；ID=11的改造后=014a对应目标204，图纸栏缺失或为空 | 无特殊素材 |
| 12→206 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）20；目标206主条目fromShipId=12，needs=[] | {"api_current_ship_id":12,"api_id":206,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":20,"弹药":100,"钢材":100,"改造前":-1,"改造后":"016a","系列":"016"}；ID=12的改造后=016a对应目标206，图纸栏缺失或为空 | 无特殊素材 |
| 78→209 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）25；目标209主条目fromShipId=78，needs=[] | {"api_current_ship_id":78,"api_id":209,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":25,"弹药":600,"钢材":400,"改造前":-1,"改造后":"021a","系列":"021"}；ID=78的改造后=021a对应目标209，图纸栏缺失或为空 | 无特殊素材 |
| 86→210 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）25；目标210主条目fromShipId=86，needs=[] | {"api_current_ship_id":86,"api_id":210,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":25,"弹药":600,"钢材":400,"改造前":-1,"改造后":"022a","系列":"022"}；ID=86的改造后=022a对应目标210，图纸栏缺失或为空 | 无特殊素材 |
| 85→212 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）25；目标212主条目fromShipId=85，needs=[] | {"api_current_ship_id":85,"api_id":212,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":25,"弹药":600,"钢材":400,"改造前":-1,"改造后":"024a","系列":"024"}；ID=85的改造后=024a对应目标212，图纸栏缺失或为空 | 无特殊素材 |
| 100→216 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）20；目标216主条目fromShipId=100，needs=[] | {"api_current_ship_id":100,"api_id":216,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":20,"弹药":200,"钢材":200,"改造前":-1,"改造后":"040a","系列":"040"}；ID=100的改造后=040a对应目标216，图纸栏缺失或为空 | 无特殊素材 |
| 23→220 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）20；目标220主条目fromShipId=23，needs=[] | {"api_current_ship_id":23,"api_id":220,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":20,"弹药":200,"钢材":200,"改造前":-1,"改造后":"045a","系列":"045"}；ID=23的改造后=045a对应目标220，图纸栏缺失或为空 | 无特殊素材 |
| 17→225 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）20；目标225主条目fromShipId=17，needs=[] | {"api_current_ship_id":17,"api_id":225,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":20,"弹药":100,"钢材":100,"改造前":-1,"改造后":"091a","系列":"091"}；ID=17的改造后=091a对应目标225，图纸栏缺失或为空 | 无特殊素材 |
| 18→226 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）20；目标226主条目fromShipId=18，needs=[] | {"api_current_ship_id":18,"api_id":226,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":20,"弹药":100,"钢材":100,"改造前":-1,"改造后":"092a","系列":"092"}；ID=18的改造后=092a对应目标226，图纸栏缺失或为空 | 无特殊素材 |
| 19→227 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）20；目标227主条目fromShipId=19，needs=[] | {"api_current_ship_id":19,"api_id":227,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":20,"弹药":100,"钢材":100,"改造前":-1,"改造后":"093a","系列":"093"}；ID=19的改造后=093a对应目标227，图纸栏缺失或为空 | 无特殊素材 |
| 20→228 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）20；目标228主条目fromShipId=20，needs=[] | {"api_current_ship_id":20,"api_id":228,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":20,"弹药":100,"钢材":100,"改造前":-1,"改造后":"005a","系列":"005"}；ID=20的改造后=005a对应目标228，图纸栏缺失或为空 | 无特殊素材 |
| 15→231 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）20；目标231主条目fromShipId=15，needs=[] | {"api_current_ship_id":15,"api_id":231,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":20,"弹药":100,"钢材":100,"改造前":-1,"改造后":"068a","系列":"068"}；ID=15的改造后=068a对应目标231，图纸栏缺失或为空 | 无特殊素材 |
| 42→242 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）20；目标242主条目fromShipId=42，needs=[] | {"api_current_ship_id":42,"api_id":242,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":20,"弹药":100,"钢材":100,"改造前":-1,"改造后":"079a","系列":"079"}；ID=42的改造后=079a对应目标242，图纸栏缺失或为空 | 无特殊素材 |
| 43→243 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）20；目标243主条目fromShipId=43，needs=[] | {"api_current_ship_id":43,"api_id":243,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":20,"弹药":100,"钢材":100,"改造前":-1,"改造后":"080a","系列":"080"}；ID=43的改造后=080a对应目标243，图纸栏缺失或为空 | 无特殊素材 |
| 44→244 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）20；目标244主条目fromShipId=44，needs=[] | {"api_current_ship_id":44,"api_id":244,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":20,"弹药":100,"钢材":100,"改造前":-1,"改造后":"081a","系列":"081"}；ID=44的改造后=081a对应目标244，图纸栏缺失或为空 | 无特殊素材 |
| 96→249 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）20；目标249主条目fromShipId=96，needs=[] | {"api_current_ship_id":96,"api_id":249,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":20,"弹药":100,"钢材":100,"改造前":-1,"改造后":"086a","系列":"086"}；ID=96的改造后=086a对应目标249，图纸栏缺失或为空 | 无特殊素材 |
| 98→251 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）20；目标251主条目fromShipId=98，needs=[] | {"api_current_ship_id":98,"api_id":251,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":20,"弹药":100,"钢材":100,"改造前":-1,"改造后":"088a","系列":"088"}；ID=98的改造后=088a对应目标251，图纸栏缺失或为空 | 无特殊素材 |
| 48→252 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）20；目标252主条目fromShipId=48，needs=[] | {"api_current_ship_id":48,"api_id":252,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":20,"弹药":100,"钢材":100,"改造前":-1,"改造后":"089a","系列":"089"}；ID=48的改造后=089a对应目标252，图纸栏缺失或为空 | 无特殊素材 |
| 69→272 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）25；目标272主条目fromShipId=69，needs=[] | {"api_current_ship_id":69,"api_id":272,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":25,"弹药":450,"钢材":300,"改造前":-1,"改造后":"062a","系列":"062"}；ID=69的改造后=062a对应目标272，图纸栏缺失或为空 | 无特殊素材 |
| 71→273 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）25；目标273主条目fromShipId=71，needs=[] | {"api_current_ship_id":71,"api_id":273,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":25,"弹药":450,"钢材":300,"改造前":-1,"改造后":"063a","系列":"063"}；ID=71的改造后=063a对应目标273，图纸栏缺失或为空 | 无特殊素材 |
| 72→274 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）25；目标274主条目fromShipId=72，needs=[] | {"api_current_ship_id":72,"api_id":274,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":25,"弹药":450,"钢材":300,"改造前":-1,"改造后":"064a","系列":"064"}；ID=72的改造后=064a对应目标274，图纸栏缺失或为空 | 无特殊素材 |
| 80→275 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）30；目标275主条目fromShipId=80，needs=[] | {"api_current_ship_id":80,"api_id":275,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":30,"弹药":900,"钢材":800,"改造前":-1,"改造后":"001a","系列":"001"}；ID=80的改造后=001a对应目标275，图纸栏缺失或为空 | 无特殊素材 |
| 81→276 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）30；目标276主条目fromShipId=81，needs=[] | {"api_current_ship_id":81,"api_id":276,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":30,"弹药":900,"钢材":800,"改造前":-1,"改造后":"002a","系列":"002"}；ID=81的改造后=002a对应目标276，图纸栏缺失或为空 | 无特殊素材 |
| 91→280 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）30；目标280主条目fromShipId=91，needs=[] | {"api_current_ship_id":91,"api_id":280,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":30,"弹药":300,"钢材":650,"改造前":-1,"改造后":"009a","系列":"009"}；ID=91的改造后=009a对应目标280，图纸栏缺失或为空 | 无特殊素材 |
| 26→286 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）20；目标286主条目fromShipId=26，needs=[] | {"api_current_ship_id":26,"api_id":286,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":20,"弹药":150,"钢材":500,"改造前":-1,"改造后":"026a","系列":"026"}；ID=26的改造后=026a对应目标286，图纸栏缺失或为空 | 无特殊素材 |
| 27→287 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）20；目标287主条目fromShipId=27，needs=[] | {"api_current_ship_id":27,"api_id":287,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":20,"弹药":150,"钢材":500,"改造前":-1,"改造后":"027a","系列":"027"}；ID=27的改造后=027a对应目标287，图纸栏缺失或为空 | 无特殊素材 |
| 113→289 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）17；目标289主条目fromShipId=113，needs=[] | {"api_current_ship_id":113,"api_id":289,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":17,"弹药":200,"钢材":200,"改造前":-1,"改造后":"109a","系列":"109"}；ID=113的改造后=109a对应目标289，图纸栏缺失或为空 | 无特殊素材 |
| 114→290 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）17；目标290主条目fromShipId=114，needs=[] | {"api_current_ship_id":114,"api_id":290,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":17,"弹药":200,"钢材":200,"改造前":-1,"改造后":"110a","系列":"110"}；ID=114的改造后=110a对应目标290，图纸栏缺失或为空 | 无特殊素材 |
| 132→301 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）30；目标301主条目fromShipId=132，needs=[] | {"api_current_ship_id":132,"api_id":301,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":30,"弹药":120,"钢材":110,"改造前":-1,"改造后":"132a","系列":"132"}；ID=132的改造后=132a对应目标301，图纸栏缺失或为空 | 无特殊素材 |
| 133→302 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）30；目标302主条目fromShipId=133，needs=[] | {"api_current_ship_id":133,"api_id":302,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":30,"弹药":130,"钢材":110,"改造前":-1,"改造后":"133a","系列":"133"}；ID=133的改造后=133a对应目标302，图纸栏缺失或为空 | 无特殊素材 |
| 134→303 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）30；目标303主条目fromShipId=134，needs=[] | {"api_current_ship_id":134,"api_id":303,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":30,"弹药":120,"钢材":110,"改造前":-1,"改造后":"134a","系列":"134"}；ID=134的改造后=134a对应目标303，图纸栏缺失或为空 | 无特殊素材 |
| 138→306 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）35；目标306主条目fromShipId=138，needs=[] | {"api_current_ship_id":138,"api_id":306,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":35,"弹药":220,"钢材":300,"改造前":-1,"改造后":"138a","系列":"138"}；ID=138的改造后=138a对应目标306，图纸栏缺失或为空 | 无特殊素材 |
| 181→316 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）20；目标316主条目fromShipId=181，needs=[] | {"api_current_ship_id":181,"api_id":316,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":20,"弹药":100,"钢材":120,"改造前":-1,"改造后":"181a","系列":"181"}；ID=181的改造后=181a对应目标316，图纸栏缺失或为空 | 无特殊素材 |
| 185→318 | first | https://wikiwiki.jp/kancolle/%E5%A4%A7%E9%AF%A8（2026-08-06）Lv50；目标318主条目fromShipId=185，needs=[] | {"api_current_ship_id":185,"api_id":318,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":50,"弹药":550,"钢材":450,"改造前":"184","改造后":"190","系列":"184"}；ID=185的改造后=190对应目标318，图纸栏缺失或为空 | 无特殊素材 |
| 405→323 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）30；目标323主条目fromShipId=405，needs=[] | {"api_current_ship_id":405,"api_id":323,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":30,"弹药":120,"钢材":110,"改造前":-1,"改造后":"205a","系列":"205"}；ID=405的改造后=205a对应目标323，图纸栏缺失或为空 | 无特殊素材 |
| 409→324 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）30；目标324主条目fromShipId=409，needs=[] | {"api_current_ship_id":409,"api_id":324,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":30,"弹药":140,"钢材":110,"改造前":-1,"改造后":"209a","系列":"209"}；ID=409的改造后=209a对应目标324，图纸栏缺失或为空 | 无特殊素材 |
| 421→330 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）40；目标330主条目fromShipId=421，needs=[] | {"api_current_ship_id":421,"api_id":330,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":40,"弹药":270,"钢材":170,"改造前":-1,"改造后":"221a","系列":"221"}；ID=421的改造后=221a对应目标330，图纸栏缺失或为空 | 无特殊素材 |
| 424→345 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）30；目标345主条目fromShipId=424，needs=[] | {"api_current_ship_id":424,"api_id":345,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":30,"弹药":130,"钢材":110,"改造前":-1,"改造后":"224a","系列":"224"}；ID=424的改造后=224a对应目标345，图纸栏缺失或为空 | 无特殊素材 |
| 453→349 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）30；目标349主条目fromShipId=453，needs=[] | {"api_current_ship_id":453,"api_id":349,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":30,"弹药":140,"钢材":120,"改造前":-1,"改造后":"253a","系列":"253"}；ID=453的改造后=253a对应目标349，图纸栏缺失或为空 | 无特殊素材 |
| 458→350 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）30；目标350主条目fromShipId=458，needs=[] | {"api_current_ship_id":458,"api_id":350,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":30,"弹药":150,"钢材":100,"改造前":-1,"改造后":"258a","系列":"258"}；ID=458的改造后=258a对应目标350，图纸栏缺失或为空 | 无特殊素材 |
| 423→357 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）40；目标357主条目fromShipId=423，needs=[] | {"api_current_ship_id":423,"api_id":357,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":40,"弹药":270,"钢材":170,"改造前":-1,"改造后":"223a","系列":"223"}；ID=423的改造后=223a对应目标357，图纸栏缺失或为空 | 无特殊素材 |
| 448→358 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）40；目标358主条目fromShipId=448，needs=[] | {"api_current_ship_id":448,"api_id":358,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":40,"弹药":420,"钢材":280,"改造前":-1,"改造后":"248a","系列":"248"}；ID=448的改造后=248a对应目标358，图纸栏缺失或为空 | 无特殊素材 |
| 452→359 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）30；目标359主条目fromShipId=452，needs=[] | {"api_current_ship_id":452,"api_id":359,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":30,"弹药":130,"钢材":110,"改造前":-1,"改造后":"252a","系列":"252"}；ID=452的改造后=252a对应目标359，图纸栏缺失或为空 | 无特殊素材 |
| 456→362 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）35；目标362主条目fromShipId=456，needs=[] | {"api_current_ship_id":456,"api_id":362,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":35,"弹药":140,"钢材":110,"改造前":-1,"改造后":"256a","系列":"256"}；ID=456的改造后=256a对应目标362，图纸栏缺失或为空 | 无特殊素材 |
| 486→368 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）30；目标368主条目fromShipId=486，needs=[] | {"api_current_ship_id":486,"api_id":368,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":30,"弹药":100,"钢材":100,"改造前":-1,"改造后":"286a","系列":"286"}；ID=486的改造后=286a对应目标368，图纸栏缺失或为空 | 无特殊素材 |
| 526→380 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）60；目标380主条目fromShipId=526，needs=[] | {"api_current_ship_id":526,"api_id":380,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":60,"弹药":230,"钢材":390,"改造前":"321","改造后":"326a","系列":"321"}；ID=526的改造后=326a对应目标380，图纸栏缺失或为空 | 无特殊素材 |
| 534→381 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）60；目标381主条目fromShipId=534，needs=[] | {"api_current_ship_id":534,"api_id":381,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":60,"弹药":280,"钢材":420,"改造前":-1,"改造后":"324a","系列":"324"}；ID=534的改造后=324a对应目标381，图纸栏缺失或为空 | 无特殊素材 |
| 492→392 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）45；目标392主条目fromShipId=492，needs=[] | {"api_current_ship_id":492,"api_id":392,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":45,"弹药":1600,"钢材":2000,"改造前":-1,"改造后":"292a","系列":"292"}；ID=492的改造后=292a对应目标392，图纸栏缺失或为空 | 无特殊素材 |
| 544→396 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）45；目标396主条目fromShipId=544，needs=[] | {"api_current_ship_id":544,"api_id":396,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":45,"弹药":900,"钢材":300,"改造前":-1,"改造后":"344a","系列":"344"}；ID=544的改造后=344a对应目标396，图纸栏缺失或为空 | 无特殊素材 |
| 201→426 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）70；目标426主条目fromShipId=201，needs=[] | {"api_current_ship_id":201,"api_id":426,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":70,"弹药":270,"钢材":230,"改造前":"011","改造后":"226","系列":"011"}；ID=201的改造后=226对应目标426，图纸栏缺失或为空 | 无特殊素材 |
| 248→463 | first | https://wikiwiki.jp/kancolle/%E6%9C%9D%E6%BD%AE（2026-06-19）Lv70；目标463主条目fromShipId=248，needs=[] | {"api_current_ship_id":248,"api_id":463,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":70,"弹药":360,"钢材":390,"改造前":"085","改造后":"263","系列":"085"}；ID=248的改造后=263对应目标463，图纸栏缺失或为空 | 无特殊素材 |
| 468→463 | first | https://wikiwiki.jp/kancolle/%E6%9C%9D%E6%BD%AE（2026-06-19）Lv70；直接互逆回程；目标463主条目fromShipId=248与出发468不同，描述常规路径；needs=[]仅佐证目标形态无需特殊道具；https://wikiwiki.jp/kancolle/%E6%9C%9D%E6%BD%AE（2026-06-19）[]；468→463方向脚注附加边核对 | {"api_current_ship_id":468,"api_id":463,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":85,"弹药":360,"钢材":390,"改造前":"263","改造后":"263","系列":"085"}；ID=468的改造后=263对应目标463，图纸栏缺失或为空；https://zh.kcwiki.cn/wiki/改造#可以进行转换改装的舰船 [{"edge":"468→463","raw":"-","materials":{}}]；468→463方向转换段行核对；[]表示无该方向行 | 无特殊素材；直接互逆回程：同边API计数全零、百科出发改造行无图纸、无同向脚注或转换段带成本行，目标常规路径主条目needs=[] |
| 253→464 | first | https://wikiwiki.jp/kancolle/%E9%9C%9E（2026-08-10）Lv75；目标464主条目fromShipId=253，needs=[] | {"api_current_ship_id":253,"api_id":464,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":75,"弹药":300,"钢材":390,"改造前":"090","改造后":"264","系列":"090"}；ID=253的改造后=264对应目标464，图纸栏缺失或为空 | 无特殊素材 |
| 470→464 | first | https://wikiwiki.jp/kancolle/%E9%9C%9E（2026-08-10）Lv75；直接互逆回程；目标464主条目fromShipId=253与出发470不同，描述常规路径；needs=[]仅佐证目标形态无需特殊道具；https://wikiwiki.jp/kancolle/%E9%9C%9E（2026-08-10）[]；470→464方向脚注附加边核对 | {"api_current_ship_id":470,"api_id":464,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":88,"弹药":300,"钢材":390,"改造前":"264","改造后":"264","系列":"090"}；ID=470的改造后=264对应目标464，图纸栏缺失或为空；https://zh.kcwiki.cn/wiki/改造#可以进行转换改装的舰船 [{"edge":"470→464","raw":"-","materials":{}}]；470→464方向转换段行核对；[]表示无该方向行 | 无特殊素材；直接互逆回程：同边API计数全零、百科出发改造行无图纸、无同向脚注或转换段带成本行，目标常规路径主条目needs=[] |
| 463→468 | first | https://wikiwiki.jp/kancolle/%E6%9C%9D%E6%BD%AE（2026-06-19）Lv85；目标468主条目fromShipId=463，needs=[] | {"api_current_ship_id":463,"api_id":468,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":85,"弹药":390,"钢材":360,"改造前":"085a","改造后":"268","系列":"085"}；ID=463的改造后=268对应目标468，图纸栏缺失或为空 | 无特殊素材 |
| 464→470 | first | https://wikiwiki.jp/kancolle/%E9%9C%9E（2026-08-10）Lv88；目标470主条目fromShipId=464，needs=[] | {"api_current_ship_id":464,"api_id":470,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":88,"弹药":390,"钢材":300,"改造前":"090a","改造后":"270","系列":"090"}；ID=464的改造后=270对应目标470，图纸栏缺失或为空 | 无特殊素材 |
| 521→526 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）30；目标526主条目fromShipId=521，needs=[] | {"api_current_ship_id":521,"api_id":526,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":30,"弹药":190,"钢材":350,"改造前":-1,"改造后":"326","系列":"321"}；ID=521的改造后=326对应目标526，图纸栏缺失或为空 | 无特殊素材 |
| 117→555 | first | https://wikiwiki.jp/kancolle/%E7%91%9E%E9%B3%B3（2026-06-20）Lv80；目标555主条目fromShipId=117，needs=[] | {"api_current_ship_id":117,"api_id":555,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":80,"弹药":700,"钢材":1700,"改造前":"112","改造后":"355","系列":"112"}；ID=117的改造后=355对应目标555，图纸栏缺失或为空 | 无特殊素材 |
| 574→579 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）55；目标579主条目fromShipId=574，needs=[] | {"api_current_ship_id":574,"api_id":579,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":55,"弹药":450,"钢材":550,"改造前":-1,"改造后":"379","系列":"374"}；ID=574的改造后=379对应目标579，图纸栏缺失或为空 | 无特殊素材 |
| 561→681 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）50；目标681主条目fromShipId=561，needs=[] | {"api_current_ship_id":561,"api_id":681,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":50,"弹药":160,"钢材":130,"改造前":-1,"改造后":"361a","系列":"361"}；ID=561的改造后=361a对应目标681，图纸栏缺失或为空 | 无特殊素材 |
| 528→688 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）35；目标688主条目fromShipId=528，needs=[] | {"api_current_ship_id":528,"api_id":688,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":35,"弹药":240,"钢材":110,"改造前":-1,"改造后":"328a","系列":"328"}；ID=528的改造后=328a对应目标688，图纸栏缺失或为空 | 无特殊素材 |
| 674→718 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）30；目标718主条目fromShipId=674，needs=[] | {"api_current_ship_id":674,"api_id":718,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":30,"弹药":150,"钢材":110,"改造前":-1,"改造后":"474a","系列":"474"}；ID=674的改造后=474a对应目标718，图纸栏缺失或为空 | 无特殊素材 |
| 886→720 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）37；目标720主条目fromShipId=886，needs=[] | {"api_current_ship_id":886,"api_id":720,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":37,"弹药":190,"钢材":110,"改造前":-1,"改造后":"486a","系列":"486"}；ID=886的改造后=486a对应目标720，图纸栏缺失或为空 | 无特殊素材 |
| 922→730 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）45；目标730主条目fromShipId=922，needs=[] | {"api_current_ship_id":922,"api_id":730,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":45,"弹药":130,"钢材":50,"改造前":-1,"改造后":"522a","系列":"522"}；ID=922的改造后=522a对应目标730，图纸栏缺失或为空 | 无特殊素材 |
| 522→884 | first | https://wikiwiki.jp/kancolle/%E6%94%B9%E9%80%A0（2026-08-18）33；目标884主条目fromShipId=522，needs=[] | {"api_current_ship_id":522,"api_id":884,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":33,"弹药":200,"钢材":350,"改造前":-1,"改造后":"484","系列":"322"}；ID=522的改造后=484对应目标884，图纸栏缺失或为空 | 无特殊素材 |
| 911→916 | first | https://wikiwiki.jp/kancolle/%E5%A4%A7%E5%92%8C（2026-08-16）Lv93；目标916主条目fromShipId=911，needs=[] | {"api_current_ship_id":911,"api_id":916,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/模块:舰娘数据 {"等级":93,"弹药":3600,"钢材":3300,"改造前":"136","改造后":"516","系列":"131"}；ID=911的改造后=516对应目标916，图纸栏缺失或为空 | 无特殊素材 |
| 464→470 | convert | https://wikiwiki.jp/kancolle/%E9%9C%9E（2026-08-10）[]；464→470方向脚注附加边核对 | {"api_current_ship_id":464,"api_id":470,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/改造#可以进行转换改装的舰船 [{"edge":"464→470","raw":"-","materials":{}}]；464→470方向转换段行核对；[]表示无该方向行 | 无特殊素材；百科转换段同方向显式空成本行、wikiwiki同方向无脚注、API同边全部*_count显式零 |
| 470→464 | convert | https://wikiwiki.jp/kancolle/%E9%9C%9E（2026-08-10）[]；470→464方向脚注附加边核对 | {"api_current_ship_id":470,"api_id":464,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/改造#可以进行转换改装的舰船 [{"edge":"470→464","raw":"-","materials":{}}]；470→464方向转换段行核对；[]表示无该方向行 | 无特殊素材；百科转换段同方向显式空成本行、wikiwiki同方向无脚注、API同边全部*_count显式零 |
| 463→468 | convert | https://wikiwiki.jp/kancolle/%E6%9C%9D%E6%BD%AE（2026-06-19）[]；463→468方向脚注附加边核对 | {"api_current_ship_id":463,"api_id":468,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/改造#可以进行转换改装的舰船 [{"edge":"463→468","raw":"-","materials":{}}]；463→468方向转换段行核对；[]表示无该方向行 | 无特殊素材；百科转换段同方向显式空成本行、wikiwiki同方向无脚注、API同边全部*_count显式零 |
| 468→463 | convert | https://wikiwiki.jp/kancolle/%E6%9C%9D%E6%BD%AE（2026-06-19）[]；468→463方向脚注附加边核对 | {"api_current_ship_id":468,"api_id":463,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/改造#可以进行转换改装的舰船 [{"edge":"468→463","raw":"-","materials":{}}]；468→463方向转换段行核对；[]表示无该方向行 | 无特殊素材；百科转换段同方向显式空成本行、wikiwiki同方向无脚注、API同边全部*_count显式零 |
| 646→698 | convert | https://wikiwiki.jp/kancolle/%E5%8A%A0%E8%B3%80（2026-08-11）[]；646→698方向脚注附加边核对 | {"api_current_ship_id":646,"api_id":698,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/改造#可以进行转换改装的舰船 [{"edge":"646→698","raw":"","materials":{}}]；646→698方向转换段行核对；[]表示无该方向行 | 无特殊素材；百科转换段同方向显式空成本行、wikiwiki同方向无脚注、API同边全部*_count显式零 |
| 911→916 | convert | https://wikiwiki.jp/kancolle/%E5%A4%A7%E5%92%8C（2026-08-16）[]；911→916方向脚注附加边核对 | {"api_current_ship_id":911,"api_id":916,"api_drawing_count":0,"api_catapult_count":0,"api_report_count":0,"api_aviation_mat_count":0,"api_arms_mat_count":0,"api_tech_count":0} | https://zh.kcwiki.cn/wiki/改造#可以进行转换改装的舰船 [{"edge":"911→916","raw":"","materials":{}}]；911→916方向转换段行核对；[]表示无该方向行 | 无特殊素材；百科转换段同方向显式空成本行、wikiwiki同方向无脚注、API同边全部*_count显式零 |

朝潮与霞逐边核对（2026-09-07）：

| 边 | wikiwiki目标主条目来路／原文 | 结果 |
| --- | --- | --- |
| 463→468 | 463→468／Lv85 | 初次：{}；往复：{}；同来路三源确认first；同向转换段成本“-”、无脚注、API全零，convert确认无 |
| 468→463 | 248→463／Lv70 | 初次：{}；往复：{}；按直接互逆回程判据确认first，常规路径主条目仅作目标佐证；同向转换段成本“-”、无脚注、API全零，convert确认无 |
| 464→470 | 464→470／Lv88 | 初次：{}；往复：{}；同来路三源确认first；同向转换段成本“-”、无脚注、API全零，convert确认无 |
| 470→464 | 253→464／Lv75 | 初次：{}；往复：{}；按直接互逆回程判据确认first，常规路径主条目仅作目标佐证；同向转换段成本“-”、无脚注、API全零，convert确认无 |

## 三条数字边重对与Glorious

2026-09-07保持既有判档与冲突规则。最上506→501：脚注40/15与百科模块“高速建造材x40 开发资材x15”整列同值，可归convert；百科转换段按←归此边却为30/45，两素材均冲突，仍不收。Fletcher 629→628：脚注20/20与模块“高速建造材x20 开发资材x20”同值归convert；百科转换段按←为65/45，两素材均冲突，仍不收。两条的first均缺同来路wikiwiki主条目，不能借convert补first。

大和911→916：wikiwiki目标916主条目来自911，原文“Lv93”、needs=[]；API同边计数全零；百科ID=911的改造行无图纸，故first按三源规则确认无。百科“高速建造材x50 开发资材x50”实际在ID=916的改造行，改造后=511对应911，即916→911；不能挪到911→916。百科转换段911→916存在显式空成本行、wikiwiki同向无脚注、API同边全零，convert确认无；反向916→911的convert仍为50/50。

重对原文与分档依据（均为既有公开来源，核对日期2026-09-07）：

| 边 | 档 | 来源 | 原文 | 判据 |
| --- | --- | --- | --- | --- |
| 506→501 | convert | https://wikiwiki.jp/kancolle/%E6%9C%80%E4%B8%8A | 改二特を改二に戻す場合、高速建造材x40と開発資材x15と資材を消費する 母港ボイスは各艦娘につき3つ割り当てられています | edges[source=footnote] → convert |
| 629→628 | convert | https://wikiwiki.jp/kancolle/Fletcher | Mk.IIを改Mod.2に戻す場合、高速建造材と開発資材を20個ずつと資材を消費する de facto standard 事実上の標準 ニュアンスとしては「意図してなかったが、結果として標準となった基準」を指す 母港ボイスは各艦娘につき3つ割り当てられています | edges[source=footnote] → convert |
| 916→911 | convert | https://wikiwiki.jp/kancolle/%E5%A4%A7%E5%92%8C | 改二重を改二に戻す場合、高速建造材x50と開発資材x50と資材を消費する 母港ボイスは各艦娘につき3つ割り当てられています | edges[source=footnote] → convert |
| 506→501 | convert | https://zh.kcwiki.cn/wiki/改造#可以进行转换改装的舰船 | 高速建造材30・开发资材45 | 可以进行转换改装的舰船段落／方向列 → convert |
| 629→628 | convert | https://zh.kcwiki.cn/wiki/改造#可以进行转换改装的舰船 | 高速建造材65・开发资材45 | 可以进行转换改装的舰船段落／方向列 → convert |
| 911→916 | convert | https://zh.kcwiki.cn/wiki/改造#可以进行转换改装的舰船 |  | 可以进行转换改装的舰船段落／方向列 → convert |
| 916→911 | convert | https://zh.kcwiki.cn/wiki/改造#可以进行转换改装的舰船 | 高速建造材50・开发资材50 | 可以进行转换改装的舰船段落／方向列 → convert |
| 506→501 | convert | https://zh.kcwiki.cn/wiki/模块:舰娘数据 | 高速建造材x40 开发资材x15 | 与同边 wikiwiki convert 共有素材全相等，整列归档；未提供素材记来源缺项 |
| 629→628 | convert | https://zh.kcwiki.cn/wiki/模块:舰娘数据 | 高速建造材x20 开发资材x20 | 与同边 wikiwiki convert 共有素材全相等，整列归档；未提供素材记来源缺项 |
| 916→911 | convert | https://zh.kcwiki.cn/wiki/模块:舰娘数据 | 高速建造材x50 开发资材x50 | 与同边 wikiwiki convert 共有素材全相等，整列归档；未提供素材记来源缺项 |

| 边 | 当前事实 | 未收数值及冲突来源 |
| --- | --- | --- |
| 506→501 | 初次：缺；往复：缺 | convert/useitem:2 {"wikiwiki":40,"kcwikiTable":30,"kcwiki":40}；convert/useitem:3 {"wikiwiki":15,"kcwikiTable":45,"kcwiki":15} |
| 629→628 | 初次：缺；往复：缺 | convert/useitem:2 {"wikiwiki":20,"kcwikiTable":65,"kcwiki":20}；convert/useitem:3 {"wikiwiki":20,"kcwikiTable":45,"kcwiki":20} |
| 911→916 | 初次：{}；往复：{} | 无数值冲突；缺档按上文结构判据保留未知 |

Glorious：解析器现在只按页面明确的Glorious改(正規空母)／Glorious改(巡洋戦艦)注记分别解为741／740，无注记不猜。随包wikiwiki的740与741主记录只保留目标编号、等级65／50、空needs及总表日期2026-08-18，未保留sourceName或fromShipId，不能由这些记录恢复原页面注记；本单不取原页面、不改上游包。当前API升级表也没有740→741或741→740行，百科随包数据没有两形态改造行；因此两向不生成确认无事实。api_mst_ship虽有同名互指，但不等于api_mst_shipupgrade直接互逆对，现行运行时也不会为它们生成可逆“素材待补”档。本单只报告证据缺口，不更改循环识别口径。

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
| 463 朝潮改二 ⇄ 468 朝潮改二丁 | 初次：{}；往复：{} | 初次：{}；往复：{} |
| 464 霞改二 ⇄ 470 霞改二乙 | 初次：{}；往复：{} | 初次：{}；往复：{} |
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
| 911 大和改二 ⇄ 916 大和改二重 | 初次：{}；往复：{} | 初次：缺；往复：{"useitem:2":50,"useitem:3":50} |
| 593 榛名改二乙 ⇄ 954 榛名改二丙 | 初次：{"useitem:2":35,"useitem:3":55}；往复：{"useitem:2":35,"useitem:3":55} | 初次：缺；往复：{"useitem:2":35,"useitem:3":15} |
| 955 清霜改二 ⇄ 960 清霜改二丁 | 初次：{"useitem:2":10,"useitem:3":10}；往复：{"useitem:2":10,"useitem:3":10} | 初次：缺；往复：{"useitem:2":10,"useitem:3":10} |

| 循环 | 边 | 两档 |
| --- | --- | --- |
| 610 加賀改二戊／646 加賀改二護／698 加賀改二 | 698→610 | 初次：{"useitem:2":30,"useitem:3":88}；往复：{"useitem:2":30,"useitem:3":88} |
| 610 加賀改二戊／646 加賀改二護／698 加賀改二 | 610→646 | 初次：{"useitem:2":84,"useitem:3":84}；往复：{"useitem:2":84,"useitem:3":84} |
| 610 加賀改二戊／646 加賀改二護／698 加賀改二 | 646→698 | 初次：缺；往复：{} |
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
| 119→1071 | useitem:104 | {"maintainer":5} | 5 |
| 119→1071 | useitem:2 | {"maintainer":550} | 550 |
| 119→1071 | useitem:3 | {"maintainer":55} | 55 |
| 152→694 | useitem:75 | {"kcwiki":2} | 2 |
| 152→694 | useitem:94 | {"wikiwiki":2} | 未入表（API／冲突） |
| 411→748 | useitem:104 | {"maintainer":3} | 3 |
| 411→748 | useitem:2 | {"maintainer":188} | 188 |
| 411→748 | useitem:3 | {"maintainer":48} | 48 |
| 412→749 | useitem:104 | {"maintainer":3} | 3 |
| 412→749 | useitem:2 | {"maintainer":188} | 188 |
| 412→749 | useitem:3 | {"maintainer":48} | 48 |
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
5. 首单严格要求主条目同来路，朝潮和霞只命中正向first，回程主条目各来自248与253。续单已修正为直接互逆回程判据，四边两档均确认无，不把常规路径主条目写成回程原文。
6. 22对包含了api_mst_ship中Glorious的同名互指；对照api_mst_shipupgrade实为21直接对，不含Glorious。原始wikiwiki页面并未包含在允许的随包JSON中，不能声称已验证原页面有或无注记。
7. 百科改造行挂在出发形态；911→916没有50/50，50/50属于916→911。最上与Fletcher并非分档失败，而是已定convert后的数值冲突。
8. 数据规则未限制普通单向边，首单实际77条first均保留；续单按裁定把“无特殊素材”的显示限定在可逆改造，单向空档继续不显示文字。
9. 续单实测朝潮／霞转换段并非无该对，而是四方向均有“-”空成本；convert由新增规则②确认。规则②还命中三形态循环的646→698，故新增convert为6档而非预期5档。
