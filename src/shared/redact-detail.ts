// perf、崩溃日志与加载失败浮层共用的凭据边界。
export const redactSensitiveDetail = (detail: string): string =>
  detail.replace(/\b(?:api_token|token)=[^&\s]*/gi, 'api_token=［已隐去］')

/** 诊断 URL 只留来源与路径；查询、hash、userinfo 都不进入日志或截图。 */
export const diagnosticUrl = (raw: string): string => {
  try {
    const url = new URL(raw)
    return `${url.protocol}//${url.host}${url.pathname}`
  } catch {
    return redactSensitiveDetail(raw.split(/[?#]/, 1)[0])
  }
}
