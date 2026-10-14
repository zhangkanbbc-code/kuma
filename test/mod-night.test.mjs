// 魔改定时换装（2026-10-14：有玩家自己往客户端加了「昼夜换装」，想并进正式版；维护者裁决在魔改栏里接入、时间可调，
// 目录分法当晚改定为「常驻 + 白天 + 夜间」三个）：
//   <缓存目录>\KanColle        全天生效（不切换的放这里，原有用户不受影响）
//   <缓存目录>\KanColle-白天   打开定时换装后只在白天生效，优先于常驻
//   <缓存目录>\KanColle-夜间   打开定时换装后只在夜间生效，优先于常驻
// 本机时间落在「夜间开始 → 夜间结束」（可跨午夜，含开始不含结束）之内算夜间，其余算白天；
// 两个时刻相同或写坏了按不在夜间算（即白天）。关闭时只认常驻，与原来完全一致。默认关闭，夜间 18:00 → 06:00。
//
// 两条查找路要一致：
// - 图片在游戏页面侧（resource-hack.js → createResourceLookup）决定换不换，主进程只按 kuma-cache:// 地址供文件。
//   页面侧自己判时段（本机时钟，不走 IPC），并把时段写进地址：夜间 `kuma-cache://resource-night/…`、
//   白天 `kuma-cache://resource-day/…`、关闭时原来的 `kuma-cache://resource/…`；主进程按地址里的时段找。
// - 音频、样式、字体、脚本在主进程 webRequest 里判，用同一个 modPeriodOf。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const kcsPath = require('../assets/preload/kcs-resource-path.js')
const { MOD_NIGHT_DEFAULT, modNightActive, modPeriodOf } = kcsPath

const at = (hh, mm) => new Date(2026, 9, 14, hh, mm)

test('默认关闭，夜间 18:00 → 06:00；关闭时不分时段', () => {
  assert.deepEqual({ ...MOD_NIGHT_DEFAULT }, { enabled: false, start: '18:00', end: '06:00' })
  assert.equal(modNightActive(at(23, 0), MOD_NIGHT_DEFAULT), false)
  assert.equal(modPeriodOf(at(23, 0), MOD_NIGHT_DEFAULT), null)
  assert.equal(modPeriodOf(at(12, 0), MOD_NIGHT_DEFAULT), null)
})

test('跨午夜的夜间：含开始、不含结束；打开后其余时间算白天', () => {
  const s = { enabled: true, start: '18:00', end: '06:00' }
  assert.equal(modNightActive(at(17, 59), s), false)
  assert.equal(modNightActive(at(18, 0), s), true)
  assert.equal(modNightActive(at(23, 30), s), true)
  assert.equal(modNightActive(at(0, 0), s), true)
  assert.equal(modNightActive(at(5, 59), s), true)
  assert.equal(modNightActive(at(6, 0), s), false)
  assert.equal(modNightActive(at(12, 0), s), false)
  assert.equal(modPeriodOf(at(23, 30), s), 'night')
  assert.equal(modPeriodOf(at(12, 0), s), 'day')
})

test('不跨午夜的时段也行；两个时刻相同或写坏了按白天算', () => {
  const s = { enabled: true, start: '01:30', end: '05:00' }
  assert.equal(modNightActive(at(1, 29), s), false)
  assert.equal(modNightActive(at(1, 30), s), true)
  assert.equal(modNightActive(at(4, 59), s), true)
  assert.equal(modNightActive(at(5, 0), s), false)
  for (const bad of [{ start: '03:00', end: '03:00' }, { start: 'abc', end: '06:00' }, { start: '25:00', end: '06:00' }]) {
    assert.equal(modNightActive(at(3, 0), { enabled: true, ...bad }), false)
    assert.equal(modPeriodOf(at(3, 0), { enabled: true, ...bad }), 'day')
  }
})

const tree = () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-mod-night-'))
  const put = (root, rel) => {
    const file = path.join(cacheDir, root, rel)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, root)
    return file
  }
  return { cacheDir, put }
}

test('白天、夜间魔改文件夹与常驻的并列在缓存目录下', () => {
  assert.equal(kcsPath.getModRootPath('C:\\cache'), path.join('C:\\cache', 'KanColle'))
  assert.equal(kcsPath.getDayModRootPath('C:\\cache'), path.join('C:\\cache', 'KanColle-白天'))
  assert.equal(kcsPath.getNightModRootPath('C:\\cache'), path.join('C:\\cache', 'KanColle-夜间'))
})

test('主进程侧查找：当前时段的文件夹优先，找不到再用常驻；另一时段的不碰；关闭时只认常驻', async () => {
  const { cacheDir, put } = tree()
  const ship = (id) => `/kcs2/resources/ship/full/${id}.png`
  const hack = (id) => `/kcs2/resources/ship/full/${id}.hack.png`
  const baseYamato = put('KanColle', hack('0131_1'))
  const dayYamato = put('KanColle-白天', hack('0131_1'))
  const nightYamato = put('KanColle-夜间', hack('0131_1'))
  const baseNagato = put('KanColle', hack('0080_1'))
  const nightOnly = put('KanColle-夜间', hack('0186_1'))
  const dayOnly = put('KanColle-白天', hack('0185_1'))
  const find = kcsPath.findModFilePathAsync
  assert.equal(await find(cacheDir, ship('0131_1'), { period: 'night' }), nightYamato)
  assert.equal(await find(cacheDir, ship('0131_1'), { period: 'day' }), dayYamato)
  assert.equal(await find(cacheDir, ship('0131_1'), { period: null }), baseYamato)
  // 只有常驻：昼夜都生效
  assert.equal(await find(cacheDir, ship('0080_1'), { period: 'night' }), baseNagato)
  assert.equal(await find(cacheDir, ship('0080_1'), { period: 'day' }), baseNagato)
  // 只在某一时段的：另一时段与关闭时都不生效
  assert.equal(await find(cacheDir, ship('0186_1'), { period: 'night' }), nightOnly)
  assert.equal(await find(cacheDir, ship('0186_1'), { period: 'day' }), undefined)
  assert.equal(await find(cacheDir, ship('0186_1'), { period: null }), undefined)
  assert.equal(await find(cacheDir, ship('0185_1'), { period: 'day' }), dayOnly)
  assert.equal(await find(cacheDir, ship('0185_1'), { period: 'night' }), undefined)
  assert.equal(await find(cacheDir, ship('0185_1'), { period: null }), undefined)
})

test('主进程侧查找：只认覆盖件（.hack）时不拿原文件；不限时各文件夹的原文件按同样优先次序可用', async () => {
  const { cacheDir, put } = tree()
  const nightOrigin = put('KanColle-夜间', '/kcs2/img/title/01.png')
  const baseOrigin = put('KanColle', '/kcs2/img/title/02.png')
  const find = kcsPath.findModFilePathAsync
  assert.equal(await find(cacheDir, '/kcs2/img/title/01.png', { period: 'night', overrideOnly: true }), undefined)
  assert.equal(await find(cacheDir, '/kcs2/img/title/01.png', { period: 'night' }), nightOrigin)
  assert.equal(await find(cacheDir, '/kcs2/img/title/02.png', { period: 'night' }), baseOrigin)
  assert.equal(await find(cacheDir, '/kcs2/img/title/01.png', { period: 'day' }), undefined)
  assert.equal(await find(cacheDir, '/kcs2/img/title/01.png', { period: null }), undefined)
})

test('页面侧查找：到点切换不用重载页面，命中地址带上当前时段', () => {
  const { cacheDir, put } = tree()
  put('KanColle', '/kcs2/resources/ship/full/0080_1.hack.png')
  put('KanColle-白天', '/kcs2/resources/ship/full/0131_1.hack.png')
  put('KanColle-夜间', '/kcs2/resources/ship/full/0131_1.hack.png')
  put('KanColle-夜间', '/kcs2/resources/ship/full/0186_1.hack.png')
  let period = 'day'
  const lookup = kcsPath.createResourceLookup(cacheDir, { period: () => period })
  const url = (id) => `https://w01.example/kcs2/resources/ship/full/${id}.png?version=3`
  const cached = (host, id) => `kuma-cache://${host}/kcs2/resources/ship/full/${id}.png`
  assert.equal(lookup(url('0131_1')), cached('resource-day', '0131_1'))
  assert.equal(lookup(url('0080_1')), cached('resource-day', '0080_1'))
  assert.equal(lookup(url('0186_1')), undefined)
  period = 'night'
  assert.equal(lookup(url('0131_1')), cached('resource-night', '0131_1'))
  assert.equal(lookup(url('0080_1')), cached('resource-night', '0080_1'))
  assert.equal(lookup(url('0186_1')), cached('resource-night', '0186_1'))
  period = null
  assert.equal(lookup(url('0131_1')), undefined)
  assert.equal(lookup(url('0080_1')), cached('resource', '0080_1'))
  assert.equal(lookup(url('0186_1')), undefined)
  period = 'day'
  assert.equal(lookup(url('0186_1')), undefined)
})

test('页面侧查找：常驻文件夹是空的、只有时段文件夹有东西，照样命中', () => {
  const { cacheDir, put } = tree()
  fs.mkdirSync(path.join(cacheDir, 'KanColle'), { recursive: true })
  put('KanColle-夜间', '/kcs2/resources/ship/full/0186_1.hack.png')
  const lookup = kcsPath.createResourceLookup(cacheDir, { period: () => 'night' })
  assert.equal(lookup('https://w01.example/kcs2/resources/ship/full/0186_1.png'), 'kuma-cache://resource-night/kcs2/resources/ship/full/0186_1.png')
})

test('页面侧查找：不传时段时行为与原来一致', () => {
  const { cacheDir, put } = tree()
  put('KanColle', '/kcs2/resources/ship/full/0080_1.hack.png')
  put('KanColle-夜间', '/kcs2/resources/ship/full/0186_1.hack.png')
  const lookup = kcsPath.createResourceLookup(cacheDir)
  assert.equal(lookup('https://w01.example/kcs2/resources/ship/full/0080_1.png'), 'kuma-cache://resource/kcs2/resources/ship/full/0080_1.png')
  assert.equal(lookup('https://w01.example/kcs2/resources/ship/full/0186_1.png'), undefined)
})
