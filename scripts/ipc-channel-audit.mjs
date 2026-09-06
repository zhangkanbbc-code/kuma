import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const mainRoot = path.join(repoRoot, 'src', 'main')
const rendererRoot = path.join(repoRoot, 'src', 'renderer')
const preloadRoot = path.join(repoRoot, 'assets', 'preload')
const testRoot = path.join(repoRoot, 'test')
const allowKanso = process.argv.includes('--allow-kanso')
const channelPattern = /^(?:kanso|kuma):[\w-]+$/

const walk = (root) => {
  const files = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name)
    if (entry.isDirectory()) files.push(...walk(target))
    else if (/\.(?:[cm]?[jt]s|tsx)$/.test(entry.name)) files.push(target)
  }
  return files
}

const relative = (file) => path.relative(repoRoot, file).replaceAll(path.sep, '/')

const constantsOf = (source) => {
  const constants = new Map()
  const pattern =
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\r\n]+)?=\s*(['"`])([^'"`\r\n]+)\2/g
  for (const match of source.matchAll(pattern)) constants.set(match[1], match[3])
  return constants
}

const channelOf = (expression, constants) => {
  const value = expression.trim()
  const literal = value.match(/^(['"`])([^'"`\r\n]+)\1$/)?.[2]
  const channel = literal ?? constants.get(value)
  return channelPattern.test(channel ?? '') ? channel : null
}

const add = (found, channel, file, source, index) => {
  const line = source.slice(0, index).split(/\r?\n/).length
  const locations = found.get(channel) ?? []
  locations.push(`${relative(file)}:${line}`)
  found.set(channel, locations)
}

const collectCalls = (files, pattern) => {
  const found = new Map()
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8')
    const constants = constantsOf(source)
    for (const match of source.matchAll(pattern)) {
      const channel = channelOf(match.at(-1), constants)
      if (channel) add(found, channel, file, source, match.index)
    }
  }
  return found
}

const mainFiles = walk(mainRoot)
const rendererFiles = walk(rendererRoot)
const preloadFiles = walk(preloadRoot)
const controlledFiles = [...mainFiles, ...rendererFiles, ...preloadFiles, ...walk(testRoot)]

const mainListeners = collectCalls(
  [...mainFiles, ...preloadFiles],
  /\bipcMain\.(on|handle)\s*\(\s*([^,\r\n)]+)/g,
)
const rendererSenders = collectCalls(
  [...rendererFiles, ...preloadFiles],
  /\bipcRenderer\.(send|invoke)\s*\(\s*([^,\r\n)]+)/g,
)
const rendererListeners = collectCalls(
  rendererFiles,
  /\bipcRenderer\.(on|once)\s*\(\s*([^,\r\n)]+)/g,
)
// preview-duck preload 以注入的 ipc 参数接收 ipcRenderer，保留这个可测试接缝。
const preloadListeners = collectCalls(
  preloadFiles,
  /\b(?:ipcRenderer|ipc)\.(on|once)\s*\(\s*([^,\r\n)]+)/g,
)
for (const [channel, locations] of preloadListeners) {
  rendererListeners.set(channel, [...(rendererListeners.get(channel) ?? []), ...locations])
}
// src/main 中的 frame/game 变量也是 WebContents；一并审计它们的 send 调用。
const mainBroadcasters = collectCalls(mainFiles, /\.send\s*\(\s*([^,\r\n)]+)/g)

const difference = (left, right) =>
  [...left.keys()].filter((channel) => !right.has(channel)).sort()

const mainWithoutRenderer = difference(mainListeners, rendererSenders)
const rendererWithoutMain = difference(rendererSenders, mainListeners)
const broadcastsWithoutRenderer = difference(mainBroadcasters, rendererListeners)
const listenersWithoutMain = difference(rendererListeners, mainBroadcasters)

const scanMatches = (pattern) => {
  const matches = new Map()
  for (const file of controlledFiles) {
    const source = fs.readFileSync(file, 'utf8')
    for (const match of source.matchAll(pattern)) add(matches, match[0], file, source, match.index)
  }
  return matches
}

const oldChannels = scanMatches(/kanso:[\w-]+/g)
const newChannels = scanMatches(/kuma:[\w-]+/g)
const dynamicChannels = scanMatches(/(?:kanso|kuma):\$\{/g)
const configChannels = new Map()
for (const file of controlledFiles) {
  const source = fs.readFileSync(file, 'utf8')
  const pattern = /\bconfig\.get\s*\(\s*(['"`])((?:kanso|kuma):[^'"`\r\n]+)\1/g
  for (const match of source.matchAll(pattern)) add(configChannels, match[2], file, source, match.index)
}

const countOccurrences = (found) =>
  [...found.values()].reduce((total, locations) => total + locations.length, 0)

const printSet = (label, found) => {
  console.log(`${label} (${found.size}): ${[...found.keys()].sort().join(', ') || '(empty)'}`)
}

const printDifference = (label, channels) => {
  console.log(`${label} (${channels.length}): ${channels.join(', ') || '(empty)'}`)
}

console.log('IPC channel audit')
printSet('main listeners', mainListeners)
printSet('renderer senders', rendererSenders)
printSet('main broadcasters', mainBroadcasters)
printSet('renderer listeners', rendererListeners)
printDifference('main listens but renderer never sends', mainWithoutRenderer)
printDifference('renderer sends but main never listens', rendererWithoutMain)
printDifference('main broadcasts but renderer never listens', broadcastsWithoutRenderer)
printDifference('renderer listens but main never broadcasts', listenersWithoutMain)
console.log(
  `old kanso channels: ${countOccurrences(oldChannels)} occurrences, ${oldChannels.size} unique`,
)
console.log(
  `new kuma channels: ${countOccurrences(newChannels)} occurrences, ${newChannels.size} unique`,
)
console.log(`dynamic channel names: ${countOccurrences(dynamicChannels)}`)
console.log(`config.get channel names: ${countOccurrences(configChannels)}`)

const mismatches = [
  ...mainWithoutRenderer,
  ...rendererWithoutMain,
  ...broadcastsWithoutRenderer,
  ...listenersWithoutMain,
]
const failed =
  mismatches.length > 0 ||
  dynamicChannels.size > 0 ||
  configChannels.size > 0 ||
  (!allowKanso && oldChannels.size > 0)

console.log(`RESULT: ${failed ? 'FAIL' : 'PASS'}`)
process.exitCode = failed ? 1 : 0
