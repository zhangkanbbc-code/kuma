// 维护者裁决 2026-10-30：用生产实体链接渲染器，只替换本地化与宿主边界。
import { runtimeHost } from '../../scripts/lib/player-view-runtime.mjs'

export const esc = value => `${value ?? ''}`.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)
const links = runtimeHost().extract('src/renderer/link.ts', ['elink', 'registerEntityRoute'], {
  esc, localizedLinkLabel: () => null, entityLinkColorClass: () => '',
}).api
links.registerEntityRoute('mstEquip', { mod: 'ji', colorClass: 'e-equip', open() {} })
export const elink = links.elink
export const rewardHost = () => runtimeHost({ './kernel': { esc }, './link': { elink } })
