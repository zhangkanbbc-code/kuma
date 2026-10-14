import fs from 'fs'

const { DatabaseSync } = require('node:sqlite')
const [dbPath, operation] = process.argv.slice(2)
const check = operation === '--check'
const backupPath = check ? undefined : operation
const db = new DatabaseSync(dbPath, { readOnly: check || Boolean(backupPath) })
try {
  if (check) {
    const result = db.prepare('PRAGMA integrity_check').get()
    if (result.integrity_check !== 'ok') throw new Error(`主库完整性校验失败：${result.integrity_check}`)
  } else if (backupPath) {
    if (fs.existsSync(backupPath)) {
      const backup = new DatabaseSync(backupPath, { readOnly: true })
      try {
        if (backup.prepare('PRAGMA integrity_check(1)').get().integrity_check !== 'ok') throw new Error('装备正文清理前备份校验失败')
      } finally { backup.close() }
    } else {
      const temp = `${backupPath}.tmp`
      fs.rmSync(temp, { force: true })
      // 与内置完整备份相同的 VACUUM INTO；WAL 的读快照不独占游戏写连接。
      db.exec(`VACUUM INTO '${temp.replace(/'/g, "''")}'`)
      fs.renameSync(temp, backupPath)
    }
  } else db.exec('VACUUM')
} finally { db.close() }
