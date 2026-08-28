// 锚：登录态保鲜——不用每次启动都重新登录 DMM。
// 1) DMM 的登录 cookie 多为会话 cookie（无过期时间），Chromium 重启即弃：
//    把 dmm 域的会话 cookie 复写为带过期时间的持久 cookie；
// 2) 崩溃/强杀会丢 cookie 存储：定期 + 退出前 flushStore 落盘。
import { app, BrowserWindow, ipcMain, session } from 'electron'

import config from './config'

const PERSIST_DOMAINS = ['dmm.com', 'dmm.co.jp']
const PERSIST_DAYS = 180
const FLUSH_INTERVAL_MS = 5 * 60 * 1000

export interface LoginHealth {
  lastPersistedAt: number | null
  lastFlushedAt: number | null
  lastError: string | null
}

let loginHealth: LoginHealth = {
  lastPersistedAt: null,
  lastFlushedAt: null,
  lastError: null,
}

const publishLoginHealth = () => {
  for (const win of BrowserWindow.getAllWindows()) {
    // 窗口正在关闭的窄窗口期 webContents 已销毁但窗口还在枚举结果里
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send('yu:login-health', loginHealth)
    }
  }
}

const recordLoginError = (error: unknown) => {
  loginHealth = {
    ...loginHealth,
    lastError: error instanceof Error ? error.message : String(error),
  }
  publishLoginHealth()
}

const flushCookies = async () => {
  try {
    await session.defaultSession.cookies.flushStore()
    loginHealth = { ...loginHealth, lastFlushedAt: Date.now(), lastError: null }
    publishLoginHealth()
  } catch (error) {
    recordLoginError(error)
  }
}

ipcMain.handle('yu:login-health', () => loginHealth)

const shouldPersist = (rawDomain = '') => {
  const domain = rawDomain.replace(/^\./, '')
  return PERSIST_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))
}

app.on('ready', () => {
  const ses = session.defaultSession

  ses.cookies.on('changed', async (_event, cookie, _cause, removed) => {
    // 只处理新增/更新的会话 cookie；复写后的 cookie 带过期时间，
    // 再次触发本监听时 cookie.session 为 false，不会死循环
    if (removed || !cookie.session) return
    if (!config.get('kanso.persistLogin', true)) return
    if (!shouldPersist(cookie.domain)) return
    try {
      const host = (cookie.domain ?? '').replace(/^\./, '')
      await ses.cookies.set({
        url: `${cookie.secure ? 'https' : 'http'}://${host}${cookie.path ?? '/'}`,
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        sameSite: cookie.sameSite,
        expirationDate: Date.now() / 1000 + PERSIST_DAYS * 86400,
      })
      loginHealth = { ...loginHealth, lastPersistedAt: Date.now(), lastError: null }
      publishLoginHealth()
    } catch (error) {
      recordLoginError(error)
    }
  })

  setInterval(() => {
    void flushCookies()
  }, FLUSH_INTERVAL_MS)
})

app.on('before-quit', () => {
  void flushCookies()
})
