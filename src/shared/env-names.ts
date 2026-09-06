// 产品运行时环境变量共用入口；主进程、渲染层与维护脚本都从这里读。
export const ENV_ALIASES = {
  // 永久保留：用户的验收配方、共享记忆与家法模板仍使用旧名。
  KUMA_DATA_DIR: 'KANSO_DATA_DIR',
  KUMA_SMOKE: 'KANSO_SMOKE',
  KUMA_DEBUG_UI: 'KANSO_DEBUG_UI',
  // 保留到下下版：迁移期间兼容旧的运行时开关。
  KUMA_DEVTOOLS: 'KANSO_DEVTOOLS',
  KUMA_QUIT_TRACE: 'KANSO_QUIT_TRACE',
  KUMA_PERF_SLOW_MS: 'KANSO_PERF_SLOW_MS',
  KUMA_PERF_PART_MS: 'KANSO_PERF_PART_MS',
  KUMA_PERF_LONGTASK_MS: 'KANSO_PERF_LONGTASK_MS',
} as const

export type RuntimeEnvName = keyof typeof ENV_ALIASES

/** 新名优先；显式空串也覆盖旧名，只有未设置时才回退。 */
export const readEnv = (
  name: RuntimeEnvName,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined => env[name] ?? env[ENV_ALIASES[name]]
