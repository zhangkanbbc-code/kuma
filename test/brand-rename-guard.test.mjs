import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = fileURLToPath(new URL('../', import.meta.url))
const manifest = 'test/fixtures/brand-legacy-allowlist.json'
const allowlist = JSON.parse(fs.readFileSync(path.join(root, manifest), 'utf8'))
// 字符类避免扫描规则自己包含待扫描的完整旧名；沿革注释也纳入白名单实命中检查。
const oldName = /kan[s]o|艦素 → ku[m]a/i

const audit = (sources, entries) => {
  const errors = []
  const hits = entries.map(() => 0)
  const seen = new Set()
  for (const entry of entries) {
    const key = `${entry.file}\0${entry.pattern}`
    if (seen.has(key)) errors.push(`重复白名单：${entry.file}`)
    seen.add(key)
    if (Object.keys(entry).sort().join(',') !== 'file,max,pattern,why' ||
        !entry.why?.trim() || !Number.isInteger(entry.max) || entry.max < 1 ||
        !oldName.test(entry.pattern) || !sources.has(entry.file) || entry.file === manifest) {
      errors.push(`白名单格式或目标不合法：${entry.file}`)
    }
  }
  for (const [file, source] of sources) {
    // 清单里的 pattern 是已校验的目标原文镜像。只准该字段携带旧名；
    // 其余字段照扫，且下面每条都必须在真实目标命中，不能用死条目放行。
    const text = file === manifest
      ? JSON.stringify(entries.map(({ pattern, ...metadata }) => metadata))
      : source
    for (const [index, line] of text.split(/\r?\n/).entries()) {
      if (!oldName.test(line)) continue
      const allowed = entries.findIndex((entry) => entry.file === file && entry.pattern === line)
      if (allowed < 0) errors.push(`未获准的旧名：${file}:${index + 1}: ${line}`)
      else hits[allowed]++
    }
  }
  entries.forEach((entry, index) => {
    if (hits[index] === 0 || hits[index] > entry.max) {
      errors.push(`白名单命中异常：${entry.file} 实际 ${hits[index]}，允许 1..${entry.max}`)
    }
  })
  return errors
}

test('受控文件旧名不超过逐行白名单，清单本身及所有条目均实命中', () => {
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: root, windowsHide: true }).toString('utf8').split('\0').filter(Boolean)
  const sources = new Map([...new Set(files)].map((file) =>
    [file, fs.readFileSync(path.join(root, file), 'utf8')]))
  assert.deepEqual(audit(sources, allowlist), [])
})

test('旧名护栏变异：新增、重复、大小写变化、死条目与清单夹带都报错', () => {
  const entry = allowlist.find((item) => item.file === 'src/shared/env-names.ts')
  const sources = new Map([[entry.file, entry.pattern]])
  assert.deepEqual(audit(sources, [entry]), [])
  assert.ok(audit(new Map([[entry.file, `${entry.pattern}\n${entry.pattern}`]]), [entry]).length)
  assert.ok(audit(new Map([[entry.file, `${entry.pattern}\n${entry.pattern.toLowerCase()}`]]), [entry]).length)
  assert.ok(audit(new Map([[entry.file, '']]), [entry]).length)
  assert.ok(audit(sources, [entry, entry]).length)
  const polluted = [{ ...entry, why: entry.pattern }]
  assert.ok(audit(new Map([...sources, [manifest, JSON.stringify(polluted)]]), polluted).length)
})
