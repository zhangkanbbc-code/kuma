// 用现行定号正文在内存还原旧的认领输入，保留按日文标题认领的行为回归。
export const halloweenFixedIds = { '2610Bw2': 1039, '2610Bm1': 987, '2610Bm2': 1040, '2610B4': 1002, '2610F1': 1171 }
export const halloweenTitles = {
  '2610Bw2': '【限定拡張作戦】Halloween海上護衛隊出撃！',
  '2610Bm1': '【期間限定任務】西方南瓜祭り!  Buono!',
  '2610Bm2': '【限定拡張作戦】Halloween狼隊、夜の襲撃！',
  '2610B4': '【限定拡張作戦】南瓜祭り2026、北方作戦！',
  '2610F1': '【限定拡張作戦】対潜装備の整理整頓！2026',
}
export const halloweenClaimPack = pack => {
  const source = structuredClone(pack)
  for (const [code, id] of Object.entries(halloweenFixedIds)) {
    source.unnumbered[code] = { ...source.data[id], titleJa: halloweenTitles[code] }
    delete source.data[id]
  }
  return source
}
