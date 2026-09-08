import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { transformSync } from 'esbuild'
import account from '../dist/shared/account-change.js'
import { mountLgToast } from './fixtures/render-lg-toast.mjs'

const { detectAccountChange, ACCOUNT_CHANGED_MESSAGE } = account
const read = (file) => fs.readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
const evaluate = (source, scope) => new Function(...Object.keys(scope), transformSync(source, { loader: 'ts' }).code)(...Object.values(scope))

test('换号判据区分首次、同号与换号，字符串和数字的同一编号不误报', () => {
  for (const stored of [undefined, null, '']) assert.equal(detectAccountChange(stored, '101'), 'first')
  assert.equal(detectAccountChange('101', 101), 'same')
  assert.equal(detectAccountChange(101, '101'), 'same')
  assert.equal(detectAccountChange('101', '202'), 'changed')
})

test('basic 真实归约保留 memberId；旧报文缺字段时沿用，port 刷新不丢身份', () => {
  const source = read('main/mg/store.ts')
  const marker = "'/kcsapi/api_get_member/basic': "
  const start = source.indexOf(marker) + marker.length
  const end = source.indexOf('\n  },', start) + 4
  const state = { player: { basic: null } }
  const reduce = evaluate(`return ${source.slice(start, end)}`, { state })
  assert.deepEqual(reduce({ api_nickname: 'fixture', api_level: 1, api_member_id: 101 }), ['basic'])
  assert.equal(state.player.basic.memberId, '101')
  reduce({ api_nickname: 'fixture', api_level: 2 })
  assert.equal(state.player.basic.memberId, '101')
  reduce({ api_nickname: 'fixture', api_level: 1, api_member_id: '202' })
  assert.equal(state.player.basic.memberId, '202')
  const portStart = source.indexOf('      p.basic = {')
  const portEnd = source.indexOf('\n      }', portStart) + 8
  const port = (api_basic) => evaluate(source.slice(portStart, portEnd), { p: state.player, body: { api_basic } })
  port({ api_nickname: 'fixture', api_level: 2 })
  assert.equal(state.player.basic.memberId, '202')
  port({ api_nickname: 'fixture', api_level: 3, api_member_id: 303 })
  assert.equal(state.player.basic.memberId, '303')
})

test('实时接线首次只记值，同号不写不报，换号先记新值再广播一次', () => {
  const source = read('main/mg/index.ts')
  const start = source.indexOf('const observeAccountChange =')
  const end = source.indexOf('const broadcastSortieScreen', start)
  const events = []
  let stored
  const observe = evaluate(`${source.slice(start, end)}\nreturn observeAccountChange`, {
    detectAccountChange,
    config: { get: (key) => { assert.equal(key, 'kuma.lastMemberId'); return stored }, set: (_key, value) => { stored = value; events.push(['set', value]) } },
    BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { isDestroyed: () => false, send: (...args) => events.push(args) } }] },
  })
  // 执行正式的 basic 接线分支，确保缺身份与无关报文不会误用快照。
  const branchStart = source.indexOf('    const accountBody =')
  const branchEnd = source.indexOf('\n  }', branchStart)
  const feed = (apiPath, body) => evaluate(source.slice(branchStart, branchEnd), { apiPath, body, observeAccountChange: observe })
  feed('/kcsapi/api_get_member/basic', { api_member_id: 101 })
  feed('/kcsapi/api_get_member/basic', { api_member_id: '101' })
  feed('/kcsapi/api_port/port', { api_basic: { api_member_id: '202' } })
  feed('/kcsapi/api_get_member/basic', { api_member_id: '202' })
  feed('/kcsapi/api_port/port', { api_basic: {} })
  feed('/kcsapi/api_req_kaisou/powerup', { api_member_id: '303' })
  assert.deepEqual(events, [['set', '101'], ['set', '202'], ['yu:account-changed', { previous: '101', current: '202' }]])
})

test('铃登记换号事件，默认弹卡并记一条通知，正文与钥共用', () => {
  const lg = mountLgToast()
  lg.accountChanged()
  assert.equal(lg.toasts().length, 1)
  assert.equal(lg.toast().dataset.event, 'accountChanged')
  const rows = lg.appendNoticeCalls()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].event, 'accountChanged')
  assert.equal(rows[0].title, '账号已变化')
  assert.equal(rows[0].detail, ACCOUNT_CHANGED_MESSAGE)
  assert.equal(lg.invokeCalls().filter(([channel]) => channel === 'push:send').length, 0)
})
