// 「时长对齐」：拿本机实测的音轨长度，去认誊写源报出来的曲名。
//
// ---- 这条路是干嘛的 ----
// 战斗曲缺的一直是「资源号 → 曲名」。最硬的证据是**文件名键入**（誊写源自己
// 贴的就是游戏原文件名 `275_1741.mp3`，中间没有人的判断）。可惜多数老曲，站方
// 只留了自己的上传序号，号就丢了——那些条目往往还带着**时长**。
// 本机这边则相反：`/kcs2/resources/bgm/battle/NNN_XXXX.mp3` 有号没名，
// 但音轨实物在手、秒数量得出来。两边拼一次，理论上能机械地钉出几个名字。
//
// ---- 三条纪律（缺一条就不许落账） ----
//  ① **先校准再对齐**：拿两边都认得的号（誊写源给了原文件名、本机也有实物）
//     比一遍秒数。口径对不上就**整层停**，一条都不收——不是调大容差。
//  ② **双向唯一**：号的容差里只有一首曲，且那首曲的容差里也只有这一个号。
//     单向唯一是陷阱：本机 10 号只落在「士魂の反撃」附近，看着唯一，
//     可那首曲同时也落在 52 和 93 附近，而 93 才是它（提督实听 + EN Fandom 两票）。
//  ③ **名字已经归了别的号就不算命中**：同一首曲的不同版本（全长版 / 游戏内循环）
//     确实会各占一个号，所以撞名不等于矛盾——但它是歧义，歧义一律不自动落账，
//     挂出来让人裁。
//
// ---- 2026-08-24 第一次跑的结论：这一层**停着** ----
// 用 zh.kcwiki 拆包BGM列表的 104 条「只有上传名」的曲子，对本机缓存里量到的
// 63 首战斗曲，三条纪律逐条挡下来，可落账的是 0 条。三个各自独立的原因：
//   · **站方标的时长本身有误差**：129 号两边是同一个版本键（`129_5256.mp3`），
//     站方写 0:56，实测 50.59s，差 5.41 秒——已经超出 ±2 秒；
//   · **上传名那些条目多半不是游戏内的那份**：「華の二水戦（インストver）」站方
//     标 2:53，而游戏里 13 号（提督实听确认就是这首）实测 1:28——站方传的是
//     全长版，游戏内是循环段，时长天然对不上；
//   · 仅有的 3 个正向唯一命中，被纪律 ② ③ 全数否掉（10 的名字其实归 93；
//     91 反向撞上 4 个号；274 提的名字已经归 13）。
// 等 BGM 档案（响过即存）攒够实物，本机侧的样本变多，这一层可以再跑一次
// （`npm run bgm:align`）——但纪律不放宽：宁可只显示编号，也不许拿差不多的秒数编名字。

/**
 * @typedef {{ id: number, seconds: number }} MeasuredTrack 本机量到的音轨
 * @typedef {{ name: string, seconds: number, era?: string }} SourceSong 誊写源报的曲名与时长
 */

/**
 * @param {{
 *   tracks: readonly MeasuredTrack[],
 *   songs: readonly SourceSong[],
 *   calibration: readonly { id: number, name: string, seconds: number }[],
 *   taken?: Readonly<Record<string, number>>,
 *   toleranceSeconds?: number,
 * }} input
 *   `calibration` 是「两边都认得的号」：id 与誊写源标的 seconds。
 *   `taken` 是已经定下来的「曲名 → 号」，用来识别纪律 ③ 的撞名。
 */
export const joinBgmByDuration = (input) => {
  const tolerance = input.toleranceSeconds ?? 2
  const tracks = [...(input.tracks ?? [])].sort((a, b) => a.id - b.id)
  const songs = [...(input.songs ?? [])]
  const taken = input.taken ?? {}
  const measured = new Map(tracks.map((t) => [t.id, t.seconds]))

  // ---- 纪律 ①：校准 ----
  const checked = []
  const failures = []
  for (const sample of input.calibration ?? []) {
    const got = measured.get(sample.id)
    // 本机没有这一首就是没有，不算失败也不算通过
    if (got == null) continue
    const delta = got - sample.seconds
    const row = { ...sample, measured: got, delta }
    checked.push(row)
    if (Math.abs(delta) > tolerance) failures.push(row)
  }
  const stop = (reason, extra) => ({
    stopped: true,
    reason,
    tolerance,
    calibration: { checked, failures },
    matched: [],
    ambiguous: [],
    contested: [],
    silent: [],
    ...extra,
  })
  if (!checked.length) return stop('no-calibration')
  if (failures.length) return stop('calibration-failed')

  // ---- 纪律 ②：双向唯一 ----
  const near = (a, b) => Math.abs(a - b) <= tolerance
  const matched = []
  const ambiguous = []
  const contested = []
  const silent = []
  for (const track of tracks) {
    const hits = songs.filter((song) => near(song.seconds, track.seconds))
    if (!hits.length) {
      silent.push(track.id)
      continue
    }
    if (hits.length > 1) {
      ambiguous.push({ id: track.id, seconds: track.seconds, candidates: hits.map((h) => h.name) })
      continue
    }
    const song = hits[0]
    const backHits = tracks.filter((other) => near(other.seconds, song.seconds))
    if (backHits.length > 1) {
      ambiguous.push({
        id: track.id,
        seconds: track.seconds,
        candidates: [song.name],
        alsoFits: backHits.map((t) => t.id),
      })
      continue
    }
    // ---- 纪律 ③：名字已经归了别的号 ----
    const heldBy = taken[song.name]
    if (heldBy != null && heldBy !== track.id) {
      contested.push({ id: track.id, name: song.name, heldBy })
      continue
    }
    matched.push({
      id: track.id,
      name: song.name,
      measured: track.seconds,
      stated: song.seconds,
      delta: track.seconds - song.seconds,
      era: song.era,
    })
  }
  return {
    stopped: false,
    reason: null,
    tolerance,
    calibration: { checked, failures },
    matched,
    ambiguous,
    contested,
    silent,
  }
}
