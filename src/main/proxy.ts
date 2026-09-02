// Adapted from poi (https://github.com/poooi/poi) lib/proxy.ts
// MIT License, Copyright (c) poi contributors — 移植与改造：艦素 kanso 项目。
// 锚：上游代理配置（socks5 / http / pac），支持运行中热切换。
import { app, BrowserWindow, ipcMain, session, type ProxyConfig } from 'electron'

import config from './config'

interface ResolvedProxy {
  options: ProxyConfig
  description: string
}

const BYPASS_RULES = '<local>'

const resolveProxy = (): ResolvedProxy => {
  switch (config.get('proxy.use')) {
    // HTTP Request via SOCKS5 proxy
    case 'socks5': {
      const socksHost: string = config.get('proxy.socks5.host', '127.0.0.1')
      const socksPort: number = config.get('proxy.socks5.port', 1080)
      return {
        options: {
          proxyRules: `socks://${socksHost}:${socksPort},direct://`,
          proxyBypassRules: BYPASS_RULES,
        },
        description: `SOCKS5 ${socksHost}:${socksPort}`,
      }
    }
    // HTTP Request via HTTP proxy
    case 'http': {
      const host = config.get('proxy.http.host', '127.0.0.1')
      const port = config.get('proxy.http.port', 8118)
      const requirePassword = config.get('proxy.http.requirePassword', false)
      const username = config.get('proxy.http.username', '')
      const password = config.get('proxy.http.password', '')
      const useAuth = requirePassword && username !== '' && password !== ''
      const strAuth = useAuth
        ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`
        : ''
      return {
        options: {
          proxyRules: `http://${strAuth}${host}:${port},direct://`,
          proxyBypassRules: BYPASS_RULES,
        },
        description: `HTTP ${host}:${port}${useAuth ? '（已配置认证）' : ''}`,
      }
    }
    // PAC
    case 'pac': {
      return {
        options: {
          pacScript: config.get('proxy.pacAddr'),
          proxyBypassRules: BYPASS_RULES,
        },
        description: 'PAC 脚本',
      }
    }
  }
  return {
    options: {
      proxyRules: 'direct://',
      proxyBypassRules: BYPASS_RULES,
    },
    description: '直连',
  }
}

let proxyApplyQueue: Promise<void> = Promise.resolve()
let proxyGeneration = 0

export interface ProxyRuntimeStatus {
  state: 'applying' | 'ok' | 'error'
  description: string
  message: string
  updatedAt: number
}

let proxyStatus: ProxyRuntimeStatus = {
  state: 'applying',
  description: '尚未初始化',
  message: '正在等待网络会话就绪',
  updatedAt: Date.now(),
}

const publishProxyStatus = () => {
  for (const win of BrowserWindow.getAllWindows()) {
    // 窗口正在关闭的窄窗口期 webContents 已销毁但窗口还在枚举结果里
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send('yu:proxy-status', proxyStatus)
    }
  }
}

ipcMain.handle('yu:proxy-status', () => proxyStatus)

export const setProxyConfig = (): Promise<void> => {
  const resolved = resolveProxy()
  const generation = ++proxyGeneration
  proxyStatus = {
    state: 'applying',
    description: resolved.description,
    message: '正在应用到游戏与登录会话',
    updatedAt: Date.now(),
  }
  publishProxyStatus()
  proxyApplyQueue = proxyApplyQueue
    .then(async () => {
      await session.defaultSession.setProxy(resolved.options)
      if (generation !== proxyGeneration) return
      proxyStatus = {
        state: 'ok',
        description: resolved.description,
        message: '已应用',
        updatedAt: Date.now(),
      }
      console.info(`[kanso] 代理已应用：${resolved.description}`)
      publishProxyStatus()
    })
    .catch((error) => {
      if (generation !== proxyGeneration) return
      proxyStatus = {
        state: 'error',
        description: resolved.description,
        message: error instanceof Error ? error.message : String(error),
        updatedAt: Date.now(),
      }
      console.error(`[kanso] 代理应用失败：${resolved.description}`, error)
      publishProxyStatus()
    })
  return proxyApplyQueue
}

app.on('ready', () => {
  void setProxyConfig()
})

config.on('config.set', (path: string) => {
  if (path.startsWith('proxy')) {
    void setProxyConfig()
  }
})
