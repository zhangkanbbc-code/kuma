`erhlwuihpcnw.config.ini`：玩家提供的魔改坐标样本，原样复制自玩家包
Kuma_Coordinate_Hotfix_v3_1 的 tests/fixtures；只用样本，不采用该补丁代码。

`shipgraph-start2.json`：从本地已有 start2 主数据样本节选两条真实 shipgraph、
匹配舰船和一条装备，补上服务器响应外层。匹配条目原本缺少 api_ensyue_d，
用于验证坐标文件的 15 个显示字段均能应用；非坐标字段保留原值。

`cispmgxqaedk.config.ini` / `.config.json`：2026-10-18 维护者施工单中提供的玩家包
原文，15 对坐标内容相同。ini 保持 CRLF；用于双格式并存的磁盘读取至 start2 显示坐标端到端测试。
