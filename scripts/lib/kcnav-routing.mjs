import { readFileSync } from 'node:fs'
import path from 'node:path'

const asCalendarDate = (value) =>
  /^\d{4}-\d{2}-\d{2}$/.test(`${value ?? ''}`) ? `${value}` : null

// KCNav 的在线接口会明确拒绝未授权自动化。这里只接收用户从官方途径取得的
// 离线导出包，不在抓取脚本中模拟浏览器、复用 Cookie 或绕过上游限制。
export const loadKcnavRoutingExport = (file) => {
  if (!file) {
    throw new Error(
      'KCNav 明确拒绝未授权 API 自动化；请把官方/用户手动导出的离线包路径写入 KANSO_KCNAV_EXPORT 后重试',
    )
  }
  const absolute = path.resolve(file)
  const raw = JSON.parse(readFileSync(absolute, 'utf8'))
  const data = raw?.data?.schemaVersion === 1 ? raw.data : raw
  if (data?.schemaVersion !== 1 || !data?.window || !data?.maps) {
    throw new Error(`KCNav 离线包格式不受支持：${absolute}`)
  }
  const start = asCalendarDate(data.window.start)
  const end = asCalendarDate(data.window.end)
  if (!start || !end) throw new Error(`KCNav 离线包缺少有效统计窗口：${absolute}`)
  return {
    data,
    upstreamUpdatedAt:
      raw?.meta?.upstreamUpdatedAt ??
      raw?.meta?.fetchedAt ??
      `${end}T00:00:00Z`,
  }
}
