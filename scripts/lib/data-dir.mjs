// 维护者脚本与「拿本机真数据跑」的测试共用的数据目录探测。
//
// 数据目录是 `%APPDATA%\kuma`（改名前旧目录的回退已撤，维护者裁决 2026-11-26；
// 玩家侧的首启搬迁仍在 src/shared/data-dir.ts 与 src/main/env.ts，不归这一层管）。
// 目录不在时照样返回这个路径，让调用方按既有的「路径不存在」分支处理。

import { readEnv } from '../../src/shared/env-names.ts'
import os from 'node:os'
import path from 'node:path'

/** 现在的数据目录名。与 src/shared/data-dir.ts 的 DATA_DIR_NAME 同一个词。 */
export const DATA_DIR_NAME = 'kuma'

/**
 * 本机数据目录的绝对路径。
 *
 * `KUMA_DATA_DIR` 显式覆盖优先（验收副本自管，与主进程同一个开关）；
 * 没有 `%APPDATA%` 的平台退到用户主目录，与改动前的兜底一致。
 */
export const userDataDir = () => {
  const override = readEnv('KUMA_DATA_DIR')
  if (override) return override
  return path.join(process.env.APPDATA ?? os.homedir(), DATA_DIR_NAME)
}

/** 数据目录下的某个文件或子目录。 */
export const userDataPath = (...parts) => path.join(userDataDir(), ...parts)

/**
 * 只在 Windows 侧才有意义的那批调用方用这条：没有 `%APPDATA%`（也没有显式覆盖）
 * 时回 `null`，让「本机没有账本」与「账本在别处」保持成两件事。
 */
export const userDataPathIfAny = (...parts) =>
  readEnv('KUMA_DATA_DIR') || process.env.APPDATA ? userDataPath(...parts) : null
