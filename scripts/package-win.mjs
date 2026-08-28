import { packager } from '@electron/packager'
import { spawnSync } from 'child_process'
import { copyFileSync, existsSync, readFileSync, rmSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

import {
  classifyKansoProcesses,
  describeProcess,
  killPids,
  listKansoProcesses,
} from './lib/kanso-processes.mjs'
import { isPackageIgnored } from './lib/package-ignore.mjs'
import { BUNDLED_LODE_IDS } from './lib/bundled-lodes.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const releaseDir = path.join(root, 'release')
const tempDir = path.join(root, '.packager-tmp')
const icon = path.join(root, 'assets', 'branding', 'kuma.ico')
const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))

for (const dir of [releaseDir, tempDir]) {
  if (path.dirname(dir) !== root) {
    throw new Error(`拒绝清理工作区外的目录：${dir}`)
  }
}
if (!existsSync(path.join(root, 'dist', 'main', 'index.js'))) {
  throw new Error('缺少 dist/main/index.js，请先运行 npm run build')
}
if (!existsSync(icon)) {
  throw new Error(`缺少 Windows 图标：${icon}`)
}

// 随包矿脉：名单在 scripts/lib/bundled-lodes.mjs（唯一出处，来自 lode-sources 的 bundle 标志）。
// 缺一个就当场失败——产物少一个包不会报错，只会让玩家那边整块功能显示「待矿脉」，
// 而这种事只有装了才发现。
const missingLodes = BUNDLED_LODE_IDS.filter(
  (id) => !existsSync(path.join(root, 'assets', 'lodes', `${id}.json`)),
)
if (missingLodes.length) {
  throw new Error(
    `随包矿脉缺 ${missingLodes.length} 个：${missingLodes.join('、')}\n` +
      `  先跑 npm run lodes:fetch（或 --only=<id>）再打包。`,
  )
}
console.log(`[kanso] 随包矿脉 ${BUNDLED_LODE_IDS.length} 个：${BUNDLED_LODE_IDS.join(' ')}`)

/**
 * 玩家要能**直接打开**的三份文档。
 *
 * 它们走 extraResource 进 `resources/`，收尾再复制一份到产物根目录：
 *  · 打包进 asar 的话，双击打不开、`shell.openPath` 也打不开——asar 是个虚拟文件系统，
 *    系统的资源管理器与记事本看不见它（钥的「打开 NOTICE.md」按钮取的就是 resources/ 那份）；
 *  · 复制到产物根，是因为玩家解压后第一眼看的是那一层，不会去翻 resources/。
 *
 * 仓库那份 README.md 不在其中：它是开发者文档，已在 package-ignore 里排除。
 */
const BUNDLED_DOCS = ['NOTICE.md', 'LICENSE', '使用说明.md']
const missingDocs = BUNDLED_DOCS.filter((name) => !existsSync(path.join(root, name)))
if (missingDocs.length) {
  throw new Error(`随包文档缺 ${missingDocs.length} 份：${missingDocs.join('、')}`)
}

// 打包前查实例。判据是**命令行带不带 `--type=`**，不是「有没有同名进程」——
// 2026-08-20 两次拿「列出了一条 kuma.exe」当「应用在跑」，跳过了打包，
// 而那条其实是上次退出漏下的孤儿渲染进程（父进程早没了）。
// 孤儿会占着 release/ 让 rmSync 报 EPERM，正是这里该清掉的东西。
if (process.platform === 'win32') {
  const { mains, children } = classifyKansoProcesses(listKansoProcesses())
  if (mains.length) {
    throw new Error(
      `kuma 正在运行，拒绝打包（会占着 release/ 导致 EPERM）：${mains.map(describeProcess).join('；')}`,
    )
  }
  if (children.length) {
    // 没有主进程还剩子进程 = 全是孤儿。主进程该落盘的早落完了，清掉没有数据风险。
    console.warn(`[kanso] 清掉上次退出漏下的 ${children.length} 个孤儿进程：`)
    for (const row of children) console.warn(`  ${describeProcess(row)}`)
    killPids(children.map((row) => row.pid))
  }
}

rmSync(releaseDir, { recursive: true, force: true })
rmSync(tempDir, { recursive: true, force: true })

const options = {
  dir: root,
  out: releaseDir,
  // 不用临时目录。electron-packager 默认会把刚解压的模板整目录 rename 一次，
  // 而杀软此时正持着里面的 exe，rename 必然 EPERM——实测这一步失败与等待时长无关，
  // 退避到 5/10/20/30/30 秒仍是每次都挂。tmpdir:false 直接在产物目录里装配，
  // 没有那次 rename 就没有这个失败点。
  tmpdir: false,
  overwrite: true,
  platform: 'win32',
  arch: 'x64',
  name: 'kuma',
  executableName: 'kuma',
  appVersion: packageJson.version,
  electronVersion: packageJson.devDependencies.electron.replace(/^[^\d]*/, ''),
  icon,
  asar: true,
  prune: true,
  // Windows Defender/杀软会在 Electron 刚解压时持有里面的 exe，
  // electron-packager 紧接着要把整个模板目录 rename 成最终名字，于是 EPERM。
  //
  // 等待必须放在这里（rename 之前），放在「失败后重试前」没用——
  // 下一轮是新解压的目录，照样会被重新持有。实测 2026-08-08：
  // 外层退避到 5/10/20/30/30 秒仍是每次都挂，而这里从 1.8 秒加到 12 秒就过了。
  afterExtract: [
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 12000))
    },
  ],
  // 过滤器单独成模块（scripts/lib/package-ignore.mjs），测试拿它跑真路径——
  // 逐条依据写在那边，改之前先读一遍。
  //
  // ⚠️ 这里传的是**函数**，于是 @electron/packager 的 DEFAULT_IGNORES 整组失效
  //（populateIgnoredPaths 只在 ignore 不是函数时才并入默认清单）。
  // package-lock.json / node_modules/.bin / *.o 那几条已经在模块里自己抄了一份，
  // 别以为默认还在。函数化是为了矿脉目录的白名单——那一段用正则表达不了。
  ignore: isPackageIgnored,
  // 见上方 BUNDLED_DOCS：这三份要以**真实文件**落在 resources/，不能只待在 asar 里。
  extraResource: BUNDLED_DOCS.map((name) => path.join(root, name)),
  win32metadata: {
    CompanyName: 'kuma',
    FileDescription: 'kuma · 舰队收藏信息工作台',
    ProductName: 'kuma',
    InternalName: 'kuma',
    OriginalFilename: 'kuma.exe',
    'requested-execution-level': 'asInvoker',
  },
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 杀软扫描刚解压的 Electron 二进制时会短暂持有文件句柄，rename 与 rm 都会 EPERM。
 * 句柄是扫完才放的，所以清理本身也得能等——早先 rmSync 直接抛，
 * 失败会从 finally 里冒出来，把真正的原因盖掉（实测 2026-08-08 连挂两次）。
 */
const rmWithRetry = async (dir, label) => {
  for (let i = 1; i <= 6; i++) {
    try {
      rmSync(dir, { recursive: true, force: true })
      return true
    } catch (error) {
      if (error?.code !== 'EPERM' || i === 6) {
        console.warn(`[kanso] 清理${label}失败（${error?.code ?? error}），留在原地不阻断打包`)
        return false
      }
      await sleep(800 * i)
    }
  }
  return false
}

// 实测这台机器上 4/8/12 秒仍不够（2026-08-08 三次里挂了两次），退避改成指数并封顶 30 秒
const ATTEMPTS = 6
let outputs
try {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      outputs = await packager(options)
      break
    } catch (error) {
      // @electron/get 即使 zip 已在缓存，也要**每次**联网拉 SHASUMS256.txt 复核；
      // 拉不到就当缓存损坏、转头重新下载整个 zip——代理一断，打包就整个不能用
      // （实测 2026-08-13：fake-IP 连接被对端关闭，缓存里两份校验过的 v43.2.0 全被无视）。
      // 缓存命中的 zip 首次下载时已过校验，离线复用是安全的：网络失败时降级跳过
      // 复核直接用缓存，只降这一次，网络恢复后照常校验。
      const offline =
        /fetch failed/i.test(`${error?.message ?? error}`) && !options.download
      if (offline) {
        console.warn(
          '[kanso] 拉不到 SHASUMS 校验清单（网络/代理不通），改用本地已校验过的 Electron 缓存重试',
        )
        options.download = { unsafelyDisableChecksums: true }
        continue
      }
      const antivirusHold =
        error?.code === 'EPERM' &&
        (error?.syscall === 'rename' || error?.syscall === 'rm') &&
        `${error?.path ?? ''}`.includes('.packager-tmp')
      if (!antivirusHold || attempt === ATTEMPTS) throw error
      const wait = Math.min(30000, 5000 * 2 ** (attempt - 1))
      console.warn(
        `[kanso] Windows 暂时占用新解压的 Electron 文件，${wait / 1000}s 后重试（${attempt}/${ATTEMPTS - 1}）`,
      )
      await rmWithRetry(tempDir, '临时目录')
      await rmWithRetry(releaseDir, '上一次的产物')
      await sleep(wait)
    }
  }
} finally {
  await rmWithRetry(tempDir, '临时目录')
}

if (!outputs?.length) throw new Error('Windows 打包未返回输出目录')
const executable = path.join(outputs[0], 'kuma.exe')
if (!existsSync(executable)) {
  throw new Error(`打包结束但没有找到应用入口：${executable}`)
}

// 收尾：把三份文档也放一份到产物根。玩家解压后看的是这一层，不会去翻 resources/。
// 缺一份就当场失败——「说明书没跟着发出去」和「说明书写错了」一样是发布事故，
// 而它不会有任何报错，只会让第一次装的人不知道代理该怎么填。
for (const name of BUNDLED_DOCS) {
  const to = path.join(outputs[0], name)
  copyFileSync(path.join(root, name), to)
  if (!existsSync(to)) throw new Error(`随包文档没能复制到产物根：${to}`)
}
console.log(`[kanso] 随包文档 ${BUNDLED_DOCS.length} 份已就位（resources/ 与产物根各一份）`)

const shortcut = path.join(root, 'kuma.lnk')
const shortcutResult = spawnSync(
  'powershell.exe',
  [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    [
      '$shell = New-Object -ComObject WScript.Shell',
      '$link = $shell.CreateShortcut($env:KANSO_SHORTCUT)',
      '$link.TargetPath = $env:KANSO_EXE',
      '$link.WorkingDirectory = $env:KANSO_APP_DIR',
      '$link.IconLocation = \"$env:KANSO_EXE,0\"',
      '$link.Description = \"kuma · 舰队收藏信息工作台\"',
      '$link.Save()',
    ].join('; '),
  ],
  {
    env: {
      ...process.env,
      KANSO_SHORTCUT: shortcut,
      KANSO_EXE: executable,
      KANSO_APP_DIR: path.dirname(executable),
    },
    encoding: 'utf8',
    windowsHide: true,
  },
)
if (shortcutResult.status !== 0 || !existsSync(shortcut)) {
  throw new Error(`无法创建根目录应用快捷方式：${shortcutResult.stderr || shortcutResult.error}`)
}

console.log(`[kanso] Windows 便携应用已生成：${executable}`)
console.log(`[kanso] 根目录快捷方式已生成：${shortcut}`)
