// api_start2 主数据快照的读取口。
//
// 主数据是游戏数据，不入仓库——本机跑过一次 kuma 并登录游戏后就会有快照。
// 三个候选按「越具体越优先」排：显式指定 > 应用自己落的快照 > 仓库上一级的 s2.json
//（后者是历史上手工放的一份样本，多个 map-intel 脚本还在读它）。
//
// 快照的形状不止一种：应用落盘的是 `{ ts, body }`，手工样本是 `{ api_data: … }`
// 或裸对象——所以一律用递归找表，不按固定路径取。

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { userDataPathIfAny } from './data-dir.mjs'

const findNestedArray = (value, key, seen = new Set()) => {
  if (!value || typeof value !== 'object' || seen.has(value)) return null
  seen.add(value)
  if (Array.isArray(value[key])) return value[key]
  for (const child of Object.values(value)) {
    const found = findNestedArray(child, key, seen)
    if (found) return found
  }
  return null
}

export const start2Candidates = (root) =>
  [
    process.env.KANSO_START2_SNAPSHOT,
    userDataPathIfAny('snapshots', 'kcsapi_api_start2_getData.json'),
    root ? path.join(root, '..', 's2.json') : null,
  ].filter(Boolean)

/** 主数据里的某张表；一张都读不到时返回空数组（调用方自己决定是失败还是降级）。 */
export const loadStart2MasterArray = (key, root = null) => {
  for (const file of start2Candidates(root)) {
    if (!existsSync(file)) continue
    try {
      const snapshot = JSON.parse(readFileSync(file, 'utf8'))
      const value = findNestedArray(snapshot, key)
      if (Array.isArray(value) && value.length) return value
    } catch (error) {
      console.warn(`[lodes]   无法读取主数据快照 ${file}：${error.message}`)
    }
  }
  return []
}
