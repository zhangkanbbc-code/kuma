// Chromium 磁盘缓存上限的取值规则。
//
// 单独成文件是为了能被测试直接调用——它决定「游戏素材能不能留到下次登录」，
// 而调用点在主进程入口（import 一下就把整个 app 拉起来了，测不了）。

/** 默认 8 GiB：舰C 全部素材（立绘 + 卡面 + UI + BGM）大致在几个 GB 量级，留足余量 */
export const DEFAULT_DISK_CACHE_MB = 8192

/** 低于这个值意义不大——实测 Chromium 默认挑的 ~103 MB 就已经不够用了 */
export const MIN_DISK_CACHE_MB = 128

/** 上限只是防手滑写出荒谬值，不是推荐值 */
export const MAX_DISK_CACHE_MB = 65536

/**
 * 把配置里的原始值收敛成一个可用的 MB 数。
 * 任何读不出数的输入（undefined / 空串 / NaN / 0 / 负数）都回落到默认值，
 * 而不是变成 0——0 会让 Chromium 退回它自己那个过小的默认上限。
 */
export const resolveDiskCacheMB = (raw: unknown): number => {
  const n = Math.trunc(Number(raw))
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_DISK_CACHE_MB
  return Math.min(MAX_DISK_CACHE_MB, Math.max(MIN_DISK_CACHE_MB, n))
}
