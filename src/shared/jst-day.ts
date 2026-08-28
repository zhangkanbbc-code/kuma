// 「哪一天」在这个游戏里有两套口径，混用会在午夜前后错一整天：
//
//   · **本地自然日** —— 资源增减这类「我这台机器上的一天」的账，用它才符合直觉；
//   · **JST 自然日** —— 演习早/晚场、任务重置、战果月界，全都按游戏服务器的
//     JST（UTC+9）切。这一类的「日」必须也按 JST 切，否则同一个场次会被
//     本地午夜劈成两半：本机是 UTC+8，JST 日界落在**本地前一天 23:00**，
//     23:00–24:00 打的那几场按本地算会掉进前一张日卡里。
//
// 两套都留着，但各自明确——这个文件是 JST 那一套的唯一出处。

const JST_OFFSET = 9 * 3_600_000
const DAY = 86_400_000

/**
 * 该时刻所属 **JST 自然日**的 00:00，返回真实时刻（epoch 毫秒）。
 * 可直接当分组键与筛选键用：同一 JST 日的时刻算出来是同一个数。
 */
export const jstDayStart = (ts: number): number =>
  Math.floor((ts + JST_OFFSET) / DAY) * DAY - JST_OFFSET

/**
 * JST 自然日的日期标签「YYYY-MM-DD」（与 kernel 的 fmtDate 同格式）。
 *
 * **不能**拿 jstDayStart 的结果去喂 fmtDate——那个是按**本地**日历读的，
 * 本机 UTC+8 下 JST 日界是本地 23:00，读出来会整整差一天（标成前一天）。
 */
export const fmtJstDate = (ts: number): string =>
  new Date(ts + JST_OFFSET).toISOString().slice(0, 10)
