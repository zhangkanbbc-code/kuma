// 任务前提链三方对账：quests-scn（kcQuests/kcwiki）× eo-quests（EO，出 api_id↔code↔日文名的桥）
// × wikiwiki-quests（任務页 開放条件）。
//
// 对齐键是任务 code，但周期任务历史上重编过号（wikiwiki 有「定期任務のID変更一覧」页），
// 所以 code 不能裸信：先拿 EO 的日文名当公证人——wikiwiki 的 nameJp 与 EO 的 name_jp
// 在同一 code 下对不上，就说明两边 code 空间在这条上错位，前置比对结论一律作废。

/**
 * 日文名归一：NFKC 压全角、去空白、去引号/转义/注记差异。
 * 实测的 4 类排版差异都要吸收：A12 引号有无、B171 转义斜杠、
 * WB01/02 wikiwiki 加的「※編成ではなく…」注记、〜/～。
 */
export const normalizeJpName = (name) =>
  `${name ?? ''}`
    .normalize('NFKC')
    .replace(/※.*$/, '')
    .replace(/\\/g, '')
    .replace(/[「」『』]/g, '')
    .replace(/[〜～]/g, '~')
    .replace(/\s+/g, '')

const preKey = (list) => [...new Set(list ?? [])].sort().join(',')

export const reconcileQuestPre = ({ scn, eo, ww }) => {
  // scn: {idText: {code, name, pre...}}  eo: [{api_id, code, name_jp...}]  ww: {code: {nameJp, pre...}}
  const scnEntries = Object.entries(scn).map(([id, q]) => ({ id: Number(id), ...q }))
  const scnByCode = new Map(scnEntries.map((q) => [q.code, q]))
  const eoByApiId = new Map(eo.map((q) => [q.api_id, q]))
  const eoByCode = new Map(eo.map((q) => [q.code, q]))

  // 1) code 空间体检
  const codeMismatchScnEo = []
  for (const q of scnEntries) {
    const peer = eoByApiId.get(q.id)
    if (peer && peer.code !== q.code) {
      codeMismatchScnEo.push({ apiId: q.id, scnCode: q.code, eoCode: peer.code })
    }
  }
  const nameMismatchWwEo = []
  const wwAligned = new Map()
  for (const [code, entry] of Object.entries(ww)) {
    const peer = eoByCode.get(code)
    if (!peer) continue // EO 没有这条（如结婚任务某些码），无法公证，不参与前置比对
    if (normalizeJpName(entry.nameJp) !== normalizeJpName(peer.name_jp)) {
      nameMismatchWwEo.push({ code, wwName: entry.nameJp, eoName: peer.name_jp })
      continue
    }
    wwAligned.set(code, entry)
  }

  // 2) 前置比对（只在公证通过的 code 上做）
  const agree = []
  const conflicts = []
  const scnOnly = [] // scn 有前置、wikiwiki 明确无（開放条件空 = wiki 认为无条件/没写）
  const wwOnly = [] // scn 空前置、wikiwiki 有——可补缺的候选
  for (const [code, entry] of wwAligned) {
    const scnEntry = scnByCode.get(code)
    if (!scnEntry) continue
    const sKey = preKey(scnEntry.pre)
    const wKey = preKey(entry.pre)
    const row = {
      code,
      scnPre: [...new Set(scnEntry.pre ?? [])].sort(),
      wwPre: [...new Set(entry.pre ?? [])].sort(),
      ...(entry.uncertain ? { wwUncertain: true } : {}),
      condRaw: entry.condRaw,
    }
    if (sKey === wKey) agree.push(row)
    else if (!wKey) scnOnly.push(row)
    else if (!sKey) wwOnly.push(row)
    else conflicts.push(row)
  }

  // 3) 悬空前置：scn 的 pre 指向库里不存在的码（旧码/期间限定残留）
  const dangling = []
  for (const q of scnEntries) {
    const missing = (q.pre ?? []).filter((code) => !scnByCode.has(code))
    if (!missing.length) continue
    const wwEntry = wwAligned.get(q.code)
    dangling.push({
      code: q.code,
      missingPre: missing,
      wwPre: wwEntry ? [...wwEntry.pre].sort() : null,
    })
  }

  // 4) 覆盖差
  const wwCodes = new Set(Object.keys(ww))
  const scnMissingFromWw = scnEntries.filter((q) => !wwCodes.has(q.code)).map((q) => q.code)
  const wwMissingFromScn = [...wwCodes].filter((code) => !scnByCode.has(code))

  return {
    counts: {
      scn: scnEntries.length,
      ww: wwCodes.size,
      wwAligned: wwAligned.size,
      agree: agree.length,
      conflicts: conflicts.length,
      scnOnly: scnOnly.length,
      wwOnly: wwOnly.length,
      dangling: dangling.length,
    },
    codeMismatchScnEo,
    nameMismatchWwEo,
    conflicts,
    scnOnly,
    wwOnly,
    dangling,
    scnMissingFromWw,
    wwMissingFromScn,
  }
}
