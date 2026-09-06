// Adapted from poi (https://github.com/poooi/poi) assets/js/kcs-resource-path.js
// MIT License, Copyright (c) poi contributors — 移植与改造：kuma 项目。
// 缓存路径逻辑：纯 CommonJS、无 Electron 依赖，主进程（kcs-resource.ts）与
// webview preload 隔离世界（resource-hack.js）两头共用。
const fs = require('fs')
const path = require('path')

const STATIC_RESOURCE_PATH_LIST = ['/kcs/', '/kcs2/', '/gadget_html5/']

const isStaticResource = (pathname = '') =>
  typeof pathname === 'string' &&
  STATIC_RESOURCE_PATH_LIST.some((basePath) => pathname.startsWith(basePath))

// 魔改/缓存树的根：`<缓存目录>\KanColle`（与 poi 的「缓存与魔改」同一套摆法）。
// 主进程启动时按它把目录建出来、设置页按它开文件夹，别在别处重拼一遍这个 join。
const getModRootPath = (cacheDir) => path.join(cacheDir, 'KanColle')

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
  const originFilePath = path.join(getModRootPath(cacheDir), pathname)
  const sp = originFilePath.split('.')
  const ext = sp.pop()
  sp.push('hack')
  if (ext) {
    sp.push(ext)
  }
  return [sp.join('.'), originFilePath]
}

// 同步解析（只在非热路径使用，如登录脚本重注入）
const findHackFilePath = (cacheDir, pathname = '') => {
  const [hackedFilePath, originFilePath] = getCacheCandidatePaths(cacheDir, pathname)
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
// 规则：KanColle 树里没东西 → 整段会话一次 readdir 之后全部未命中；
// 图片默认只认 .hack 覆盖（注释里的「只动魔改图」）；脚本恢复才看普通缓存文件。
//
// 2026-08-29 判定从「目录存在」改成「目录非空」：那之后主进程启动时会**幂等建出**
// 这个目录（玩家只要把魔改文件丢进去，不必自己新建、也不必找 %APPDATA%），
// 「存在」于是恒为真，上面那段防的空跑就整个失效了。
// 语义与旧行为等价：空目录＝没人魔改＝这一段会话全部未命中，一次 readdir 就定案；
// 玩家放了文件之后，下一次建查找器（重新加载游戏页面）才重新判一遍。
const createResourceLookup = (cacheDir) => {
  const memo = new Map()
  let treeFilled
  const hasTree = () => {
    if (treeFilled !== undefined) return treeFilled
    treeFilled = hasModFiles(getModRootPath(cacheDir))
    return treeFilled
  }
  return (absoluteUrl = '', includeOrigin = false) => {
    try {
      const { pathname } = new URL(absoluteUrl)
      if (!isStaticResource(pathname)) return undefined
      const decoded = decodeURIComponent(pathname)
      const key = `${includeOrigin ? 'o' : 'h'}:${decoded}`
      const remembered = memo.get(key)
      if (remembered !== undefined) return remembered || undefined
      if (!hasTree()) return undefined
      const [hackedFilePath, originFilePath] = getCacheCandidatePaths(cacheDir, decoded)
      let found = false
      try {
        fs.accessSync(hackedFilePath, fs.constants.R_OK)
        found = true
      } catch (_e) {
        if (includeOrigin) {
          try {
            fs.accessSync(originFilePath, fs.constants.R_OK)
            found = true
          } catch (_e2) {
            /* 普通缓存也没有 */
          }
        }
      }
      const result = found ? `kuma-cache://resource${pathname}` : ''
      memo.set(key, result)
      return result || undefined
    } catch (_e) {
      return undefined
    }
  }
}

module.exports = {
  STATIC_RESOURCE_PATH_LIST,
  isStaticResource,
  getModRootPath,
  hasModFiles,
  getCacheCandidatePaths,
  findHackFilePath,
  createResourceLookup,
}
