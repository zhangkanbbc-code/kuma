// Adapted from poi (https://github.com/poooi/poi) assets/js/kcs-resource-path.js
// MIT License, Copyright (c) poi contributors — 移植与改造：kuma 项目。
// 缓存路径逻辑：纯 CommonJS、无 Electron 依赖，主进程（kcs-resource.ts）与
// webview preload 隔离世界（resource-hack.js）两头共用。
const fs = require('fs')
const path = require('path')

const STATIC_RESOURCE_PATH_LIST = ['/kcs/', '/kcs2/', '/gadget_html5/']
const MOD_NIGHT_DEFAULT = { enabled: false, start: '18:00', end: '06:00' }

const modNightActive = (now, settings) => {
  if (!settings.enabled) return false
  const clock = /^([01]\d|2[0-3]):([0-5]\d)$/
  const start = clock.exec(settings.start)
  const end = clock.exec(settings.end)
  if (!start || !end) return false
  const from = Number(start[1]) * 60 + Number(start[2])
  const to = Number(end[1]) * 60 + Number(end[2])
  const minute = now.getHours() * 60 + now.getMinutes()
  return from < to ? minute >= from && minute < to : from > to && (minute >= from || minute < to)
}

const modPeriodOf = (now, settings) =>
  settings.enabled ? (modNightActive(now, settings) ? 'night' : 'day') : null

const isStaticResource = (pathname = '') =>
  typeof pathname === 'string' &&
  STATIC_RESOURCE_PATH_LIST.some((basePath) => pathname.startsWith(basePath))

// 魔改/缓存树的根：`<缓存目录>\KanColle`（与 poi 的「缓存与魔改」同一套摆法）。
// 主进程启动时按它把目录建出来、设置页按它开文件夹，别在别处重拼一遍这个 join。
const getModRootPath = (cacheDir) => path.join(cacheDir, 'KanColle')
const getDayModRootPath = (cacheDir) => path.join(cacheDir, 'KanColle-白天')
const getNightModRootPath = (cacheDir) => path.join(cacheDir, 'KanColle-夜间')

const getModRoots = (cacheDir, period) => {
  const base = getModRootPath(cacheDir)
  return period
    ? [period === 'night' ? getNightModRootPath(cacheDir) : getDayModRootPath(cacheDir), base]
    : [base]
}

// 这棵树里有没有东西。**不存在、读不动、空目录一律 false**——
// 「玩家没魔改」与「目录还没建」对查找器是同一件事（见 createResourceLookup 的注释）。
const hasModFiles = (modRootPath) => {
  try {
    return fs.readdirSync(modRootPath).length > 0
  } catch (_e) {
    return false
  }
}

// 一个 /kcs* pathname 在缓存目录下的候选磁盘路径：
// .hack.<ext> 覆盖变体（优先）与普通缓存原文件
const getCacheCandidatePaths = (cacheDir, pathname = '') => {
  return getModCandidatePaths(getModRootPath(cacheDir), pathname)
}

const getModCandidatePaths = (root, pathname, { period = null, overrideOnly = false } = {}) => {
  // URL 的首个 / 是资源树路径；解码后的分隔符也必须按磁盘路径钳到当次魔改根。
  // 盘符、UNC 与 NUL 不是资源路径，不能交给文件系统解释。
  if (typeof pathname !== 'string' || /[:\0]/.test(pathname) || /[\\/]{2}/.test(pathname)) return []
  const originFilePath = path.join(root, pathname)
  const sp = originFilePath.split('.')
  const ext = sp.pop()
  sp.push('hack')
  if (ext) {
    sp.push(ext)
  }
  const candidates = []
  // 根的先后不变；各根内先试当前时段后缀，再试常规覆盖，最后按需试原文件。
  if (period === 'day' || period === 'night') {
    const timed = [...sp]
    timed.splice(ext ? -2 : -1, 0, period)
    candidates.push(timed.join('.'))
  }
  candidates.push(sp.join('.'))
  if (!overrideOnly) candidates.push(originFilePath)
  return candidates.every((candidate) => isPathWithinRoot(root, candidate)) ? candidates : []
}

const isPathWithinRoot = (root, candidate) => {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

const findModFilePathAsync = async (cacheDir, pathname, { period = null, overrideOnly = false } = {}) => {
  const roots = getModRoots(cacheDir, period)
  for (const root of roots) {
    const candidates = getModCandidatePaths(root, pathname, { period, overrideOnly })
    for (const candidate of candidates) {
      try {
        await fs.promises.access(candidate, fs.constants.R_OK)
        return candidate
      } catch (_e) {
        // try next candidate
      }
    }
  }
  return undefined
}

// 同步解析（只在非热路径使用，如登录脚本重注入）
const findHackFilePath = (cacheDir, pathname = '') => {
  const [hackedFilePath, originFilePath] = getCacheCandidatePaths(cacheDir, pathname)
  if (!hackedFilePath) return undefined
  try {
    fs.accessSync(hackedFilePath, fs.constants.R_OK)
    return hackedFilePath
  } catch (_e) {
    try {
      fs.accessSync(originFilePath, fs.constants.R_OK)
      return originFilePath
    } catch (_e) {
      return undefined
    }
  }
}

// 游戏 Image.src 热路径用的查找：cacheDir 由调用方快照一次，这里不再碰 config。
//
// 进战斗 PIXI 会连打几十上百次 src。旧实现每张图都 config.get（同步 IPC）+
// 两次 accessSync；用户机器上 MyCache 目录根本不存在，等于空跑把游戏线程卡住，
// kuma自己的 UI（大破闪烁）还在动——那是另一个渲染进程。
//
// 规则：每个魔改文件夹里没东西 → 整段会话一次 readdir 之后该文件夹全部未命中；
// 图片默认只认 .hack 覆盖（注释里的「只动魔改图」）；脚本恢复才看普通缓存文件。
//
// 2026-08-29 判定从「目录存在」改成「目录非空」：那之后主进程启动时会**幂等建出**
// 这个目录（玩家只要把魔改文件丢进去，不必自己新建、也不必找 %APPDATA%），
// 「存在」于是恒为真，上面那段防的空跑就整个失效了。
// 语义与旧行为等价：空目录＝没人魔改＝这一段会话全部未命中，一次 readdir 就定案；
// 玩家放了文件之后，下一次建查找器（重新加载游戏页面）才重新判一遍。
const createResourceLookup = (cacheDir, { period = () => null } = {}) => {
  const memo = new Map()
  const trees = new Map()
  const hasTree = (root) => {
    if (!trees.has(root)) trees.set(root, hasModFiles(root))
    return trees.get(root)
  }
  return (absoluteUrl = '', includeOrigin = false) => {
    try {
      const { pathname } = new URL(absoluteUrl)
      if (!isStaticResource(pathname)) return undefined
      const decoded = decodeURIComponent(pathname)
      const currentPeriod = period()
      const key = `${currentPeriod}:${includeOrigin ? 'o' : 'h'}:${decoded}`
      const remembered = memo.get(key)
      if (remembered !== undefined) return remembered || undefined
      const roots = getModRoots(cacheDir, currentPeriod)
      let found = false
      for (const root of roots) {
        if (!hasTree(root)) continue
        for (const candidate of getModCandidatePaths(root, decoded, { period: currentPeriod, overrideOnly: !includeOrigin })) {
          try {
            fs.accessSync(candidate, fs.constants.R_OK)
            found = true
            break
          } catch (_e) {
            // try next candidate
          }
        }
        if (found) break
      }
      // 协议重新解析时也必须只读覆盖件，避免时段根里的原文件抢在常驻覆盖之前。
      const result = found ? `kuma-cache://resource${currentPeriod ? `-${currentPeriod}` : ''}${pathname}${includeOrigin ? '' : '?override-only=1'}` : ''
      memo.set(key, result)
      return result || undefined
    } catch (_e) {
      return undefined
    }
  }
}

module.exports = {
  MOD_NIGHT_DEFAULT,
  modNightActive,
  modPeriodOf,
  STATIC_RESOURCE_PATH_LIST,
  isStaticResource,
  getModRootPath,
  getDayModRootPath,
  getNightModRootPath,
  hasModFiles,
  getCacheCandidatePaths,
  getModRoots,
  isPathWithinRoot,
  findHackFilePath,
  findModFilePathAsync,
  createResourceLookup,
}
