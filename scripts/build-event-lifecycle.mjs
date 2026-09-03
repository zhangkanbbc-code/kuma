#!/usr/bin/env node
// 从维护者登记表生成活动生命周期第一方随包资料，全程只读本地文件。

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = path.join(ROOT, 'scripts', 'map-intel-events.json')
const OUT = path.join(ROOT, 'assets', 'lodes', 'event-lifecycle.json')
const registry = JSON.parse(fs.readFileSync(SOURCE, 'utf8'))

// 扩展点：登记表将来加入 archived[] 时，与 active 一并按同一形状输出。
const registeredEvents = [
  registry.active,
  ...(Array.isArray(registry.archived) ? registry.archived : []),
].filter(Boolean)

const jstDate = (value) =>
  new Date(new Date(value).getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
const generatedAt = new Date()
const events = registeredEvents.map((event) => ({
  mapAreaId: event.mapAreaId,
  name: event.name,
  ...(event.nameZh === undefined ? {} : { nameZh: event.nameZh }),
  from: jstDate(event.openedAt),
  until: event.until ?? null,
  status: event.status,
  phases: event.phases,
  ...(event.mapNamesZh === undefined ? {} : { mapNamesZh: event.mapNamesZh }),
  ...(event.operationNamesZh === undefined ? {} : { operationNamesZh: event.operationNamesZh }),
}))

const pack = {
  meta: {
    id: 'event-lifecycle',
    name: '活动生命周期（第一方登记）',
    version: jstDate(generatedAt).replaceAll('-', '.'),
    source: 'kuma 第一方登记表',
    sourceUrl: registry.active?.lifecycleSourceUrl ?? registeredEvents[0]?.lifecycleSourceUrl,
    fetchedAt: generatedAt.toISOString(),
    license: '第一方产物',
    note: '活动开始与结束日期，来自官方公告',
    maintainerNote: [
      '由 scripts/map-intel-events.json 生成；结束日只在官方公告后填；活动结束后改 status 为 ended 再重新生成',
    ],
  },
  data: {
    schemaVersion: 1,
    events,
  },
}

fs.writeFileSync(OUT, `${JSON.stringify(pack, null, 2)}\n`, 'utf8')
console.log(`已写出 ${path.relative(ROOT, OUT)}：${events.length} 条`)
