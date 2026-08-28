// 打包排除清单。**单独成模块是为了能被测试真跑一遍**——
// 只在 package-win.mjs 里写一串正则，护栏就只能去匹配源码文本，
// 而「这条正则到底拦不拦得住那个路径」正是源码文本看不出来的那部分。
//
// 这是「列举排除」式的：根目录冒出任何新东西都会被默默打进产物。
// 实测踩过一次——某个工具在点开头的隐藏目录下开的 git worktree
// （整份仓库副本）被打进了 app.asar，4.6 MB，而且那目录事后就被删了，
// 只在产物里留下一份幽灵拷贝。所以点开头的一律不打。
//
// **`assets/lodes/` 是例外，那一段是白名单**（见文件末尾 isPackageIgnored）：
// 矿脉包里只有一部分上游给了允许再分发的许可，其余进了产物就是侵权分发。
// 「列举排除」在这里不成立——新抓一个包就会被默默打进去，
// 而漏一个的代价是许可事故，不是体积问题。

import { BUNDLED_LODE_FILES, NEVER_BUNDLED_LODE_IDS } from './bundled-lodes.mjs'

export const PACKAGE_IGNORE = [
  /^\/\.[^/]+(?:\/|$)/, // .git / .github / .cache / .packager-tmp / .gitignore …
  /^\/(?:src|test|scripts|release|docs)(?:\/|$)/, // docs/ 是维护者侧的规格文档，玩家产物里是噪音
  /^\/assets\/review(?:\/|$)/,
  /^\/(?:启动kuma\.cmd|kuma\.lnk|tsconfig\.json)$/, // .lnk 内嵌本机绝对路径，不能随包外发
  // 仓库首页 README 是给**逛仓库的人**看的（下载、许可、连哪些地方），玩家产物里是噪音，
  // 而且它会让人以为「说明书在 asar 里」。玩家那份是根目录的 使用说明.md
  //（extraResource 复制出来，双击就能开），见 package-win.mjs 的 BUNDLED_DOCS。
  // 开发者文档在 docs/，由上面 docs/ 那条盖住。
  /^\/README(?:-[^/]*)?\.md$/,
  /^\/NVIDIA Corporation(?:\/|$)/, // 显卡驱动在工作目录里留的日志，不是项目的一部分
  // 外挂 sourcemap 不进产物。发行版构建（scripts/build.mjs --release）本来就不生成它，
  // 这一条是第二道闸：dist/ 是构建产物目录，谁在开发构建之后直接打一次包，
  // 5.46MB 的 map 就会跟着进 asar 而没有任何东西会报错。
  // 主进程/共享层那份是**内联**的，不在这里——它由 crash.log 的可读性背书，见 build.mjs。
  /^\/dist\/.*\.map$/,
  // ---- 维护者侧专用的矿脉包：运行时零读取，**永远不随包外发** ----
  //
  // eo-quests（ElectronicObserver Quests.json，NOASSERTION）只在维护流水线里用：
  // 给 wikiwiki-quests 做任务码空间公证（fetch-lodes.mjs 的 name_jp 对齐）、
  // 喂 scn×eo×ww 的任务前提三方对账，以及给仲裁台账当日文原文的次级出处（desc_jp）。
  // 它不在 src/shared/lode-ids 的 CONSUMED_LODES 里——玩家那份产物一行都不会读它，
  // 而它的许可又不允许再分发，所以这里直接钉死。
  // 同源的 quest-trackers 已于 2026-08-21 整层退场（自研接管），不必再列。
  //
  // fit-bonus（同仓库的 FitBonuses.json，同样 NOASSERTION）2026-08-22 加入这一档：
  // 运行时的装备加成已换成第一方的 kcwiki-fit-bonus（CC，随包），它只剩
  // `scripts/fit-bonus-reconcile.mjs` 一个用途——当另一份独立整理逐格核我们自己的数。
  //
  // 下面这条与末尾的白名单**重复**了（白名单本来也放不进它）。留着是故意的：
  // 「忘了加白名单」和「明知故犯地钉死」是两回事，后者要留得下痕迹。
  ...NEVER_BUNDLED_LODE_IDS.map(
    (id) => new RegExp(`^/assets/lodes/${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.json$`),
  ),
  // ---- @electron/packager 的 DEFAULT_IGNORES，必须自己抄一份 ----
  //
  // 实读 node_modules/@electron/packager/dist/copy-filter.js 的 populateIgnoredPaths：
  // **只有 `opts.ignore` 不是函数时**才会把默认清单并进去。package-win.mjs 传的是
  // isPackageIgnored（矿脉白名单没法用正则表达），所以默认那组就整组失效了——
  // 少抄一条不会报错，只会在产物里静静多出一份东西。
  //（`.git` 与 `.gitignore` 已被上面「点开头」那条盖住，这里不重复。）
  /^\/(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/,
  // npm 自己在 node_modules 里记的那份账。packager 的默认清单其实也漏了它
  //（它那条是 `/package-lock\.json$`，而这个文件名前面多一个点），实测确实进过产物。
  /\/node_modules\/\.package-lock\.json$/,
  /\/node_modules\/\.bin(?:\/|$)/,
  /\.o(?:bj)?$/,
  /\/node_gyp_bins(?:\/|$)/,
]

/** `assets/lodes/` 下的路径（目录本身除外）。 */
const LODE_PATH = /^\/assets\/lodes\/.+/

/** 这条相对路径（以 / 开头，packager 的口径）会不会被排除。 */
export const isPackageIgnored = (relativePath) => {
  if (PACKAGE_IGNORE.some((pattern) => pattern.test(relativePath))) return true
  // 矿脉目录走白名单：只有 lode-sources.json 里 bundle: true 的那些包能进产物。
  // README.md 之类的目录内杂物自然也落在白名单外。
  if (LODE_PATH.test(relativePath)) return !BUNDLED_LODE_FILES.has(relativePath)
  return false
}
