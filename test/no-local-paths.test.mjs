import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = fileURLToPath(new URL('../', import.meta.url))
const binaryExtension = /\.(?:png|jpe?g|gif|webp|avif|ico|bmp|tiff?|pdf|woff2?|ttf|otf|eot|mp3|ogg|wav|flac|mp4|webm|mov|zip|gz|bz2|xz|7z|rar|exe|dll|node|wasm|sqlite3?|db)$/i
// 分隔符允许源码里的连续转义；字符类避免规则自身含有被禁的完整文本。
const localPath = /C:[\\/]+Users[\\/]+|[A-Z]:[\\/]+POI插件工作室|AppData[\\/]+Local[\\/]+Temp[\\/]+claude|scratch[p]ad/i

test('Git 受控文本不含本机路径', () => {
  const files = execFileSync('git', ['ls-files', '-z'], {
    cwd: root,
    windowsHide: true,
    encoding: 'utf8',
  }).split('\0').filter(Boolean)
  const hits = []
  for (const file of files) {
    if (binaryExtension.test(file)) continue
    const source = fs.readFileSync(path.join(root, file), 'utf8')
    for (const [index, line] of source.split(/\r\n|\n|\r/).entries()) {
      if (localPath.test(line)) hits.push(`${file}:${index + 1}: ${line}`)
    }
  }
  assert.equal(hits.length, 0, `受控文本含本机路径：\n${hits.join('\n')}`)
})
