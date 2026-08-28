// Adapted from poi (https://github.com/poooi/poi) lib/game-api-broadcaster.ts
// MIT License, Copyright (c) poi contributors — 移植与改造：艦素 kanso 项目。
// 锚：游戏 API 事件广播器。svdata= 前缀解析、api_result 门控、镇守府服务器识别。
import { EventEmitter } from 'events'
import { ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import querystring from 'querystring'
import { URL } from 'url'

import { ROOT } from './env'
import type { KcsBgmCue } from '../shared/kcs-bgm'

type RequestOrigin = string | undefined
type PathName = string | undefined
type Url = string
type RequestInfo = [RequestOrigin, PathName, Url]

interface KancolleServer {
  num?: number
  name?: string
  ip?: string
}

interface KancolleServerInfo {
  [host: string]: KancolleServer
}

class GameAPIBroadcaster extends EventEmitter {
  serverList: KancolleServerInfo = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'assets', 'data', 'server.json'), 'utf8'),
  )

  serverInfo: KancolleServer = {}
  currentBgm: KcsBgmCue | null = null

  setCurrentBgm = (cue: KcsBgmCue | null) => {
    if (
      cue &&
      this.currentBgm?.kind === cue.kind &&
      this.currentBgm.id === cue.id &&
      this.currentBgm.pathname === cue.pathname
    ) {
      this.currentBgm = cue
      return
    }
    this.currentBgm = cue
    this.emit('kancolle.bgm', cue)
  }

  sendRequest = (method: string, requestInfo: RequestInfo, rawReqBody: string) => {
    this.emit(
      'network.on.request',
      method,
      requestInfo,
      JSON.stringify(querystring.parse(rawReqBody || '')),
      Date.now(),
    )
  }

  sendResponse = (
    method: string,
    requestInfo: RequestInfo,
    rawReqBody: string,
    rawResBody: unknown,
    resType: string,
    statusCode?: number,
  ) => {
    this.updateKanColleServer(requestInfo)
    const resBody = this.parseResponseBody(rawResBody, resType)
    if (resBody && statusCode === 200) {
      this.emit(
        'network.on.response',
        method,
        requestInfo,
        resBody,
        JSON.stringify(querystring.parse(rawReqBody || '')),
        Date.now(),
      )
    }
  }

  sendError = (requestInfo: RequestInfo, statusCode?: number) => {
    this.emit('network.error', requestInfo, statusCode)
  }

  private parseResponseBody = (rawResBody: unknown, resType: string) => {
    if (rawResBody == null) {
      return undefined
    }
    switch (resType) {
      case 'arraybuffer':
      case 'blob':
      case 'document': {
        // not parseable
        return undefined
      }
      case 'json': {
        return JSON.stringify(rawResBody)
      }
      case 'text':
      default: {
        try {
          if (typeof rawResBody !== 'string') {
            return undefined
          }
          const bodyStr = rawResBody || undefined
          const parsed = bodyStr?.startsWith('svdata=') ? bodyStr.substring(7) : bodyStr
          JSON.parse(parsed || '')
          return parsed
        } catch (_e) {
          return undefined
        }
      }
    }
  }

  private updateKanColleServer = (requestInfo: RequestInfo) => {
    const [, pathName, reqUrl] = requestInfo
    if (this.isKancolleGameApi(pathName)) {
      const { hostname } = new URL(reqUrl)
      if (hostname) {
        if (this.serverList[hostname]) {
          this.serverInfo = {
            ...this.serverList[hostname],
            ip: hostname,
          }
        } else {
          this.serverInfo = {
            num: -1,
            name: '__UNKNOWN',
            ip: hostname,
          }
        }
        this.emit('kancolle.server.change', this.serverInfo)
      }
    }
  }

  private isKancolleGameApi = (pathname: PathName = ''): boolean =>
    !!pathname?.startsWith('/kcsapi')
}

// export = ：让 preload 的 remote.require('./game-api-broadcaster') 直接拿到实例
const broadcaster = new GameAPIBroadcaster()

// 抓包桥的主进程侧。preload 曾经用 @electron/remote **同步**调进来——
// 游戏渲染进程的 XHR loadend 回调要等主进程把 JSON.parse、整条记账链跑完才返回，
// 回港/登录的大包一到游戏就卡一下。改成 ipcMain 异步接线：同一 channel 保序，
// 阻塞成本从游戏侧挪走。校验与 preload 侧同一份（IPC 对任意渲染进程可达，
// 这里是第二道门）：只收 webview 的、方法白名单、路径 /kcs 前缀。
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'PATCH', 'OPTIONS'])
const isAllowedMethod = (method: unknown): method is string =>
  typeof method === 'string' && ALLOWED_METHODS.has(method.toUpperCase())
const isGamePath = (pathname: unknown): pathname is string =>
  typeof pathname === 'string' && pathname.startsWith('/kcs')

ipcMain.on('kanso:game-api', (event, kind: unknown, payload: any) => {
  try {
    if (event.sender.getType() !== 'webview') return
    if (!payload || typeof payload !== 'object') return
    const { method, pathname, responseURL } = payload
    if (typeof responseURL !== 'string') return
    const requestInfo: RequestInfo = [undefined, pathname, responseURL]
    if (kind === 'response') {
      if (!isAllowedMethod(method) || !isGamePath(pathname)) return
      broadcaster.sendResponse(
        method,
        requestInfo,
        payload.request,
        payload.response,
        payload.responseType,
        payload.status,
      )
    } else if (kind === 'request') {
      if (!isAllowedMethod(method) || !isGamePath(pathname)) return
      broadcaster.sendRequest(method, requestInfo, payload.request)
    } else if (kind === 'error') {
      broadcaster.sendError(requestInfo, payload.status)
    }
  } catch (e) {
    console.warn('[kanso] game-api bridge dispatch failed', e)
  }
})

export = broadcaster
