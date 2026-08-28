// 维护者脚本与「拿本机真数据跑」的测试共用的数据目录探测。
//
// 2026-08-28 产品改名之后数据目录是 `%APPDATA%\kuma`，而首次启动新版才会把
// `%APPDATA%\kanso` 整体搬过来（判定在 src/shared/data-dir.ts，搬迁在 src/main/env.ts）。
// 所以这一层不能写死任何一个名字：写死新名，还没启动过新版的机器上取不到；
// 写死旧名，搬完之后取到的是不存在的目录。两种都不会报错——账本/快照读不到时
// 这些调用方一律走「没有就降级/跳过」的分支，于是真实数据覆盖会**静默消失**。
//
// 判据只有一条：**新目录在就用新的，不在再回退旧的**；两个都不在时仍返回新目录，
// 让调用方按既有的「路径不存在」分支处理。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** 现在的数据目录名。与 src/shared/data-dir.ts 的 DATA_DIR_NAME 同一个词。 */
export const DATA_DIR_NAME = 'kuma'

/** 改名前的数据目录名。首启搬迁完成前的机器上数据还在这里。 */
export const LEGACY_DATA_DIR_NAME = 'kanso'

/**
 * 本机数据目录的绝对路径。
 *
 * `KANSO_DATA_DIR` 显式覆盖优先（验收副本自管，与主进程同一个开关）；
 * 没有 `%APPDATA%` 的平台退到用户主目录，与改动前的兜底一致。
 */
export const userDataDir = () => {
  if (process.env.KANSO_DATA_DIR) return process.env.KANSO_DATA_DIR
  const root = process.env.APPDATA ?? os.homedir()
  const dir = path.join(root, DATA_DIR_NAME)
  if (fs.existsSync(dir)) return dir
  const legacy = path.join(root, LEGACY_DATA_DIR_NAME)
  return fs.existsSync(legacy) ? legacy : dir
}

/** 数据目录下的某个文件或子目录。 */
export const userDataPath = (...parts) => path.join(userDataDir(), ...parts)

/**
 * 只在 Windows 侧才有意义的那批调用方用这条：没有 `%APPDATA%`（也没有显式覆盖）
 * 时回 `null`，让「本机没有账本」与「账本在别处」保持成两件事。
 */
export const userDataPathIfAny = (...parts) =>
  process.env.KANSO_DATA_DIR || process.env.APPDATA ? userDataPath(...parts) : null
