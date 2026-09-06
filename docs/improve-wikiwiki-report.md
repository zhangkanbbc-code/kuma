# wikiwiki 改修第三票勘探

2026-09-06，只读访问 [wikiwiki「改修工廠」](https://wikiwiki.jp/kancolle/改修工廠)。原样调用现有 `fetch-lodes.mjs` 的 `fetchWikiwikiPage` 通道，缓存放 TEMP，原站间隔 10.5 秒及退避规则沿用；未访问 akashi-list 原站。

页面有 **6 张可机读的 ★1–★max 数字表**。它们是类别/系数早见表，不是按装备 id 列出的实测表。另查的「改修工廠/改修効果」子页为 404，主页面已含所需结构。

解析器按页面标题、完整星级表头及行标签识别，展开 rowspan/colspan。命中、加权对空、舰队防空、索敌共映射 11 个明确类别行；伤害倍率、泛称「多数装备」等 7 行未扩展到具体装备。不会用第三票的系数训练公式。

| 逐格比较结果 | 格数 | 处理 |
|---|---:|---|
| CC 模块、对照资料、wikiwiki 三方一致 | 725 | 原有实收仍标 `kcwiki` |
| wikiwiki 与对照资料一致，CC 模块缺失 | 84 | 只作为报告证据，不收录 |
| wikiwiki 与对照资料一致，CC 模块有不同值 | 0 | 不收录 |
| wikiwiki 与对照资料不同 | 471 | 只报告 |
| 对照资料无比较值 | 0 | 无票 |

84 格涉及 #138、#172、#178、#397、#398、#423、#522、#523、#572、#573、#574。未因此修改正式包或提升推算格来源。数字格保持表内小数位，仅为 wikiwiki 无正号的数值补 `+` 后作字符串比较。

分歧包含小数处理差异，如索敌 1.4√★ 在 ★2 的 wikiwiki 值为 `+1.98`，对照资料为 `+1.97`。不能把 471 格全部称作机制特例，也不能把类别早见表当成针对这些装备的逐件实测。完整逐格票留在维护者 TEMP 报告 `kuma-improve-three-votes.json`。

输入校验值（SHA-256）：

- CC 模块离线快照，revision 182356，资料时间 2026-02-24T14:59:55Z：`1c6d120fbff03eee7abeda7de7f1e66bc520958924aa036d9a758ffe56fb251c`
- wikiwiki HTML：`9e3767590df3870fa609751cf74413a1dc752c9566841954a4a961866e791141`
- 对照资料比较包：`7f456dfd63f2aa374484de9fbcbd1fc540a118dbf225bf2b99607581b1b21511`

重跑（先定位仓库根，替换输入和输出占位符；只读两票及 HTML，仅写报告）：

```powershell
Set-Location '<仓库根>'
node scripts/build-akashi-improve.mjs --from-file '<修订清单>' --akashi '<对照表>' --compare '<wikiwiki HTML>' --report '<临时目录>/kuma-improve-three-votes.json'
```

`--compare` 不调用正式包写入器；原始 wikiwiki HTML 和表格不随包。
