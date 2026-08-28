// kcwiki 深海台词档名 → api_mst_ship ID。
// 一期资源使用三位号（556 → 1556），后续已经使用完整四位号（1722 → 1722）。
export const abyssVoiceMstIdFromKey = (key) => {
  const match = /^ShinkaiSeikan(\d+)/i.exec(`${key ?? ''}`.trim())
  if (!match) return null
  const resourceId = Number(match[1])
  if (!Number.isInteger(resourceId) || resourceId <= 0) return null
  const mstId = resourceId >= 1500 ? resourceId : 1000 + resourceId
  return mstId >= 1500 && mstId <= 9999 ? mstId : null
}
