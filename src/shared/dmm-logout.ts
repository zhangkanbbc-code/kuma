export interface DmmLogoutCookie {
  domain?: string
  path?: string
  secure?: boolean
  name: string
}

/** 按域边界选择，第三方域与游戏服务器不属于退出清理范围。 */
export const dmmLogoutTargets = (cookies: readonly DmmLogoutCookie[]) => {
  const targets = cookies.filter((cookie) => {
    const host = (cookie.domain ?? '').replace(/^\./, '')
    return ['dmm.com', 'dmm.co.jp'].some((domain) => host === domain || host.endsWith(`.${domain}`))
  })
  return {
    cookies: targets.map((cookie) => ({
      url: `${cookie.secure ? 'https' : 'http'}://${(cookie.domain ?? '').replace(/^\./, '')}${cookie.path ?? '/'}`,
      name: cookie.name,
    })),
    origins: [...new Set(targets.map((cookie) => `https://${(cookie.domain ?? '').replace(/^\./, '')}`))],
  }
}
