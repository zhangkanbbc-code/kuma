/** 页面重定向或再次导航会中断前一次 loadURL，不代表加载失败。 */
export const isNavigationAborted = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false
  const { code, errno, message } = error as { code?: unknown; errno?: unknown; message?: unknown }
  return code === 'ERR_ABORTED' || errno === -3
    || (typeof message === 'string' && message.includes('ERR_ABORTED (-3)'))
}
