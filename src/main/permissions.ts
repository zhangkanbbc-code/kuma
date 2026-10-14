import { session } from 'electron'
import { isKumaPage, isKumaWindow } from './kuma-sender'

export const installPermissionHandlers = () => {
  // 实际调用：crash-guard / ru 的复制按钮、lg 的系统通知。没有剪贴板读取需求。
  // 未发现游戏使用需要授权的 API；远程主帧、广告子帧和无 document 的检查全部拒绝。
  const localPermissions = new Set(['clipboard-sanitized-write', 'notifications'])
  const allowed = (contents: Electron.WebContents | null, permission: string, details: {
    isMainFrame: boolean; requestingUrl?: string
  }): boolean => localPermissions.has(permission) && isKumaWindow(contents) &&
    details.isMainFrame && !!details.requestingUrl && isKumaPage(details.requestingUrl)
  session.defaultSession.setPermissionCheckHandler((contents, permission, _origin, details) =>
    allowed(contents, permission, details))
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) =>
    callback(allowed(contents, permission, details)))
}
