/** 返港的本地时刻；跨本地日历日时补月日，时钟由调用方提供。 */
export const fmtReturnClock = (returnTs: number, now: number): string => {
  const returned = new Date(returnTs)
  const current = new Date(now)
  const pad = (n: number) => `${n}`.padStart(2, '0')
  const sameDay = returned.getFullYear() === current.getFullYear()
    && returned.getMonth() === current.getMonth()
    && returned.getDate() === current.getDate()
  const day = sameDay ? '' : `${pad(returned.getMonth() + 1)}-${pad(returned.getDate())} `
  return `${day}${pad(returned.getHours())}:${pad(returned.getMinutes())}`
}
