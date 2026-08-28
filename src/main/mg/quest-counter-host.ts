// 铭 · 任务计数引擎的 Electron 装配层。
// 引擎本体（quest-counter.ts）不认识 Electron；这里把矿脉、账本、状态、广播四样接上，
// 起一台进程级单例，并把 qp:get / qp:check-fleet 两个查询口开给渲染层。
//
// 拆开的理由：引擎从前在模块顶层自执行 initQuestCounter() 并直接 ipcMain.handle，
// 离线工具（回放器、逐条对账）一 require 就撞 electron。装配挪到这一层之后，
// 那些工具跑的是**同一份引擎源码**，对账结论才算数。
import { BrowserWindow, ipcMain } from 'electron'

import { getLode } from '../lode'
import ledger from './ledger'
import * as store from './store'
import { createQuestEngine } from './quest-counter'

const engine = createQuestEngine({
  getLode,
  ledger,
  store,
  send: (channel, payload) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(channel, payload)
    }
  },
})

export const initQuestCounter = engine.init
export const onQuestApi = engine.onApi
export const reconcileQuestProgress = engine.reconcile

ipcMain.handle('qp:get', () => engine.state())
ipcMain.handle('qp:check-fleet', () => engine.checkFleet())

engine.init()
// 分钟级只跑周期重置：repair 那一段要等权威受领集合，交给 reconcile 的调用点。
const resetTimer = setInterval(() => engine.resetExpired(), 60_000)
resetTimer.unref()
