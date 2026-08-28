// Adapted from poi (https://github.com/poooi/poi) assets/js/kcs-resource-path.js
// MIT License, Copyright (c) poi contributors — 移植与改造：艦素 kanso 项目。
// 缓存路径逻辑：纯 CommonJS、无 Electron 依赖，主进程（kcs-resource.ts）与
// webview preload 隔离世界（resource-hack.js）两头共用。
const fs = require('fs')
const path = require('path')

const STATIC_RESOURCE_PATH_LIST = ['/kcs/', '/kcs2/', '/gadget_html5/']

const isStaticResource = (pathname = '') =>
  typeof pathname === 'string' &&
  STATIC_RESOURCE_PATH_LIST.some((basePath) => pathname.startsWith(basePath))

// 一个 /kcs* pathname 在缓存目录下的候选磁盘路径：
// .hack.<ext> 覆盖变体（优先）与普通缓存原文件
const getCacheCandidatePaths = (cacheDir, pathname = '') => {
  const originFilePath = path.join(cacheDir, 'KanColle', pathname)
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
// 艦素自己的 UI（大破闪烁）还在动——那是另一个渲染进程。
//
// 规则：KanColle 树不存在 → 整段会话一次 stat 之后全部未命中；
// 图片默认只认 .hack 覆盖（注释里的「只动魔改图」）；脚本恢复才看普通缓存文件。
const createResourceLookup = (cacheDir) => {
  const memo = new Map()
  let treeExists
  const hasTree = () => {
    if (treeExists !== undefined) return treeExists
    try {
      fs.accessSync(path.join(cacheDir, 'KanColle'), fs.constants.R_OK)
      treeExists = true
    } catch (_e) {
      treeExists = false
    }
    return treeExists
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
      const result = found ? `kanso-cache://resource${pathname}` : ''
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
  getCacheCandidatePaths,
  findHackFilePath,
  createResourceLookup,
}
