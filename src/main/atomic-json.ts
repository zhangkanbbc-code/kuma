import fs from 'fs'
import path from 'path'

// JSON 配置/快照必须以“整份旧文件或整份新文件”的形态出现。
// 直接覆盖目标文件时，进程崩溃或断电会留下半截 JSON；先写同目录临时文件，
// 再 rename 替换，可把这个窗口收敛到文件系统的原子重命名。
//
// 两个后补的坑：
// · 不 fsync 的话数据可能只在页缓存里，掉电时 rename 的元数据先落盘，
//   文件照样可以变成 0 字节——「整份旧或整份新」的承诺要 fsync 才成立；
// · Windows 上目标文件被杀软/备份工具短暂占用时 rename 抛 EPERM，
//   不重试的话这一次数据就丢了。
//
// 序列化默认**紧凑**：快照/领域状态是机器读的，两空格缩进只是白白把
// 几 MB 的 start2 写成两三倍体积（还在每包的记账路径上）。
// 人要读的（config）由调用方传 pretty 保留缩进。
export interface AtomicWriteOptions {
  pretty?: boolean
}

const RENAME_RETRIES = 3
const RENAME_RETRY_WAIT_MS = 25
const sleepSync = (ms: number) => {
  // 仅在 rename 撞占用的罕见路径上用；同步小睡换一次成功写入是划算的
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

export const atomicWriteJsonSync = (
  file: string,
  value: unknown,
  options: AtomicWriteOptions = {},
) => {
  const dir = path.dirname(file)
  const temp = path.join(dir, `.${path.basename(file)}.${process.pid}.tmp`)
  fs.mkdirSync(dir, { recursive: true })
  try {
    const json = options.pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value)
    const fd = fs.openSync(temp, 'w')
    try {
      fs.writeSync(fd, json, null, 'utf8')
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
    for (let attempt = 1; ; attempt += 1) {
      try {
        fs.renameSync(temp, file)
        break
      } catch (error: any) {
        const busy = error?.code === 'EPERM' || error?.code === 'EBUSY' || error?.code === 'EACCES'
        if (!busy || attempt >= RENAME_RETRIES) throw error
        sleepSync(RENAME_RETRY_WAIT_MS)
      }
    }
  } catch (e) {
    try {
      fs.rmSync(temp, { force: true })
    } catch (_cleanupError) {
      // 原始写入异常更重要；临时文件下次写入会被同名覆盖。
    }
    throw e
  }
}
