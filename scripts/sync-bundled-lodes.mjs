// 把「随包矿脉名单」同步进 .gitignore 的反选块。
//
// .gitignore 只能是静态文本，读不了 JSON，所以名单在这里**生成**而不是手写——
// 手写两份必然漂移：加了一个包只改一处，结果要么仓库里没有那份数据、
// 要么产物里多出一个不该有的。名单的唯一出处是 scripts/lib/bundled-lodes.mjs。
//
//   node scripts/sync-bundled-lodes.mjs            重写标记块
//   node scripts/sync-bundled-lodes.mjs --check    只比对，不一致就非零退出（测试跑这条）

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { BUNDLED_LODE_IDS, REPO_ROOT } from './lib/bundled-lodes.mjs'

const BEGIN = '# >>> bundled-lodes（由 scripts/sync-bundled-lodes.mjs 生成，别手改）'
const END = '# <<< bundled-lodes'

export const gitignorePath = path.join(REPO_ROOT, '.gitignore')

/** 标记块应有的样子。 */
export const bundledBlock = (ids = BUNDLED_LODE_IDS) =>
  [BEGIN, ...ids.map((id) => `!assets/lodes/${id}.json`), END].join('\n')

/** 把现有 .gitignore 文本里的标记块换成应有的样子；没有块就追加到 lodes 规则之后。 */
export const withBundledBlock = (text, ids = BUNDLED_LODE_IDS) => {
  const block = bundledBlock(ids)
  const begin = text.indexOf(BEGIN)
  if (begin >= 0) {
    const end = text.indexOf(END, begin)
    if (end < 0) throw new Error('.gitignore 里的 bundled-lodes 块只有开头没有结尾')
    return text.slice(0, begin) + block + text.slice(end + END.length)
  }
  const anchor = 'assets/lodes/*.json'
  const at = text.indexOf(anchor)
  if (at < 0) throw new Error(`.gitignore 里找不到 ${anchor}，不知道该把反选块插在哪`)
  const insertAt = at + anchor.length
  return `${text.slice(0, insertAt)}\n${block}${text.slice(insertAt)}`
}

const main = () => {
  const check = process.argv.includes('--check')
  const current = readFileSync(gitignorePath, 'utf8')
  const next = withBundledBlock(current)
  if (current === next) {
    console.log(`[lodes] .gitignore 的随包名单已是最新（${BUNDLED_LODE_IDS.length} 个）`)
    return
  }
  if (check) {
    console.error(
      '[lodes] .gitignore 的随包名单与 scripts/lode-sources.json 的 bundle 标志不一致。\n' +
        '  跑 npm run lodes:sync-ignore 重新生成。',
    )
    process.exitCode = 1
    return
  }
  writeFileSync(gitignorePath, next)
  console.log(`[lodes] 已重写 .gitignore 的随包名单（${BUNDLED_LODE_IDS.length} 个）`)
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main()
