import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

// 2026-09-06 晚用户裁决：「正式版里要移除」使用说明迁移提示与配置读时兜底。
// 整对象搬迁永久保留；此处只提醒撤除上述两项，不检查搬迁实现。
// 预发布版也断言待撤项仍在，连待撤清单本身一起校验，避免护栏一直空跑。
test('正式版撤除使用说明迁移提示与配置读时兜底', () => {
  const { version } = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const guide = fs.readFileSync(new URL('../使用说明.md', import.meta.url), 'utf8')
  const config = fs.readFileSync(new URL('../src/main/config.ts', import.meta.url), 'utf8')
  const guideLine = guide.split(/\r?\n/).findIndex(line =>
    line.includes('自动搬过来') && line.includes('kanso.')) + 1
  const hasReadFallback = config.includes('// release-cleanup: config-read-fallback')
  // 只检查构建元数据之前的版本部分，避免将 +build-name 的连字符当成预发布后缀。
  const isPrerelease = version.split('+')[0].includes('-')

  if (isPrerelease) {
    assert.ok(guideLine > 0, '预发布版待撤项必须仍在：使用说明中含「自动搬过来」与「kanso.」的那句')
    assert.ok(hasReadFallback, '预发布版待撤项必须仍在：config.ts 读时兜底标记')
  } else {
    const message = `正式版前必须撤：使用说明${guideLine > 0 ? `第 ${guideLine} 行` : '中'}那句 + config.ts 读时兜底`
    assert.equal(guideLine, 0, message)
    assert.equal(hasReadFallback, false, message)
  }
})
