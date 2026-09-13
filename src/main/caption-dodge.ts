import { ipcMain, type WebContents } from 'electron'
import broadcaster from './game-api-broadcaster'
import {
  CAPTION_ZONE_CHANNEL,
  CAPTION_HOVER_CHANNEL,
  CAPTION_HOVER_EVENT,
  sanitizeCaptionZone,
} from '../shared/caption-dodge'

export const installCaptionDodge = ({ hostWebContents, gameWebContents }: {
  hostWebContents: WebContents
  gameWebContents: () => WebContents | null | undefined
}) => {
  ipcMain.on(CAPTION_ZONE_CHANNEL, (event, raw: unknown) => {
    if (event.sender !== hostWebContents) return
    const zone = sanitizeCaptionZone(raw)
    const game = gameWebContents()
    if (!game || game.isDestroyed()) return
    // webContents.send 只到主帧；画布所在子帧也必须收到区域。
    for (const frame of game.mainFrame.framesInSubtree) {
      try {
        frame.send(CAPTION_ZONE_CHANNEL, zone)
      } catch {
        // 这一帧刚导航走/已销毁，继续通知其余帧。
      }
    }
  })
  ipcMain.on(CAPTION_HOVER_CHANNEL, (event, inside: unknown) => {
    if (event.sender.getType() === 'webview') {
      broadcaster.emit(CAPTION_HOVER_EVENT, Boolean(inside))
    }
  })
}
