// 数据目录选哪一个（纯判定，不碰 fs 与 electron，好让测试直接跑）。
//
// 2026-08-28 产品改名，数据目录跟着从 `%APPDATA%\kanso` 换成 `%APPDATA%\kuma`。
// 已经在用的机器上那一整套东西（账本 mg.sqlite、config.json、三份档案、缓存）
// 都在旧目录里，换个名字就等于「打开是空的」——所以首次启动要把旧目录整体搬过来。
//
// 判定与搬迁分开：这里只回答「用哪个目录、要不要搬」，真正的 renameSync 在
// main/env.ts。搬迁会失败（目录被占用、权限不足、跨盘），失败时的口径是
// **数据可用性高于目录名**：继续用旧目录，把失败记进 crash.log，下次启动再试。

/** 现在的数据目录名。 */
export const DATA_DIR_NAME = 'kuma'

/** 改名前的数据目录名。只在首启搬迁这一处出现，搬完就不再有人读它。 */
export const LEGACY_DATA_DIR_NAME = 'kanso'

/** `%APPDATA%` 在 Windows 上是反斜杠路径；拼接不引入 node:path，保持本层零依赖。 */
const joinUnder = (root: string, name: string): string => {
  const sep = root.includes('\\') ? '\\' : '/'
  return `${root.replace(/[\\/]+$/, '')}${sep}${name}`
}

/** 两个候选目录的绝对路径。调用方拿它去 stat，再把结果喂给 `planDataDir`。 */
export const dataDirCandidates = (appData: string): { dir: string; legacyDir: string } => ({
  dir: joinUnder(appData, DATA_DIR_NAME),
  legacyDir: joinUnder(appData, LEGACY_DATA_DIR_NAME),
})

export interface DataDirInput {
  /** `%APPDATA%` 根（`app.getPath('appData')`）。 */
  appData: string
  /** 旧目录 `<appData>/kanso` 在不在。 */
  legacyExists: boolean
  /** 新目录 `<appData>/kuma` 在不在。 */
  currentExists: boolean
  /** `KANSO_DATA_DIR` 显式覆盖（验收副本用）。给了就一切照它，用户自管。 */
  override?: string | null
}

export interface DataDirPlan {
  /** 最终要用的数据目录。 */
  dir: string
  /** 旧目录的绝对路径（`migrate` 为真时是搬迁的源）。 */
  legacyDir: string
  /** 要不要把 `legacyDir` 整体搬成 `dir`。 */
  migrate: boolean
}

/**
 * 四种情形，穷举：
 *   ① 旧有、新无   → 用新目录，**搬**（首次启动改名版的那一次）；
 *   ② 旧无         → 用新目录，不搬（全新安装，或已经搬过了）；
 *   ③ 两个都在     → 用新目录，不搬、也**不删旧**（旧的留着由人处置，
 *                    自动删用户数据不是这条路该做的事）；
 *   ④ 显式覆盖     → 一切照覆盖值，跳过搬迁（验收副本自管，绝不动正式目录）。
 */
export const planDataDir = (input: DataDirInput): DataDirPlan => {
  const { dir, legacyDir } = dataDirCandidates(input.appData)
  if (input.override) return { dir: input.override, legacyDir, migrate: false }
  return { dir, legacyDir, migrate: input.legacyExists && !input.currentExists }
}
