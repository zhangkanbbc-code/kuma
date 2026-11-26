// 产品运行时环境变量共用入口；主进程、渲染层与维护脚本都从这里读。
// 改名前的旧变量名已撤除（维护者裁决 2026-11-26），只认下面这些。
export const RUNTIME_ENV_NAMES = [
  'KUMA_DATA_DIR',
  'KUMA_SMOKE',
  'KUMA_DEBUG_UI',
  'KUMA_DEVTOOLS',
  'KUMA_QUIT_TRACE',
  'KUMA_PERF_SLOW_MS',
  'KUMA_PERF_PART_MS',
  'KUMA_PERF_LONGTASK_MS',
  'KUMA_CRASH_DUMPS',
] as const

export type RuntimeEnvName = (typeof RUNTIME_ENV_NAMES)[number]

/** 原样返回；未设置是 undefined，显式空串照样是空串（由调用方决定空串算不算开）。 */
export const readEnv = (
  name: RuntimeEnvName,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined => env[name]
