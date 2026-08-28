// 导出文本的纯逻辑：CSV 转义、BOM、带日期戳的默认文件名。
//
// 放在 shared 而不是 renderer，是为了能被真正**跑起来**测：渲染层打成一个 iife，
// 测试只能对着源码正则断言（判断写反了照样绿）；shared 是逐文件产物，
// 守卫可以直接调这几个函数验行为。
// 对话框与写盘那半边在 renderer/csv-export.ts（要 @electron/remote）。

/** CSV 单元格转义：含引号/逗号/换行的整格用双引号包住，格内引号翻倍。 */
export const csvCell = (value: string | number): string => {
  const text = `${value}`
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/**
 * 表格 → CSV 文本。行分隔 CRLF；开头加 BOM（U+FEFF）——
 * Excel 不认无 BOM 的 UTF-8，中文会乱码。
 */
export const csvText = (rows: (string | number)[][]): string =>
  '﻿' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n')

/** 默认文件名的日期戳（本地日期）：kanso-ships-20260820.csv 这样。 */
export const stampedFileName = (
  prefix: string,
  extension: string,
  at: Date = new Date(),
): string => {
  const pad = (n: number) => `${n}`.padStart(2, '0')
  return `${prefix}-${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}.${extension}`
}
