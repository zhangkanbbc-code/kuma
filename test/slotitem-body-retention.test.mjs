import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import vm from 'node:vm'
import { EventEmitter } from 'node:events'
import { fileURLToPath } from 'node:url'
import { SlotitemBodyRetention, readers } from './fixtures/slotitem-body-retention.mjs'
import { mountYu, cardHtml } from './fixtures/render-yu.mjs'
import settings from '../dist/shared/settings-sections.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const slot = '/kcsapi/api_get_member/slot_item', quest = '/kcsapi/api_get_member/questlist'
const now = Date.UTC(2026, 9, 15), day = 86_400_000, cutoff = now - 30 * day
const make = (t, onUpdate) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-slotitem-db-'))
  const file = path.join(dir, 'mg.sqlite'), db = new DatabaseSync(file)
  db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE events(id INTEGER PRIMARY KEY,ts INTEGER,path TEXT,body TEXT,post_body TEXT);
    CREATE INDEX idx_events_path ON events(path);`)
  let enabled = false
  const connection = onUpdate ? { prepare: sql => {
    const statement = db.prepare(sql)
    return sql.startsWith('UPDATE events') ? { run: (...args) => {
      const result = statement.run(...args)
      onUpdate(db)
      return result
    } } : statement
  } } : db
  const book = new SlotitemBodyRetention(connection, file, () => enabled)
  t.after(() => { book.stop(); if (db.isOpen) db.close(); fs.rmSync(dir, { recursive: true, force: true }) })
  return { db, file, dir, book, enable: value => { enabled = value } }
}
const put = (db, ts, apiPath = slot, body = { api_data: [{ api_id: 1, api_slotitem_id: 2 }] }) =>
  db.prepare('INSERT INTO events(ts,path,body,post_body) VALUES(?,?,?,?)').run(ts, apiPath, body == null ? null : JSON.stringify(body), '{"api_tab_id":"0"}')
const rows = db => db.prepare('SELECT * FROM events ORDER BY id').all().map(row => ({ ...row }))

test('默认关闭：事件逐字段不变，也不创建备份或压实状态', async t => {
  const { db, book, file } = make(t)
  put(db, now - 40 * day); put(db, now - 41 * day)
  const before = rows(db)
  await book.prune(now)
  assert.deepEqual(rows(db), before)
  assert.equal(book.needsVacuum, false)
  assert.equal(fs.existsSync(book.backupPath), false)
  assert.equal(fs.existsSync(`${file}.slotitem-trim.json`), false)
})

test('清理前备份失败：原正文逐字段不变，不允许进入压实', async t => {
  const { db, book, enable } = make(t)
  put(db, now - 42 * day); put(db, now - 40 * day)
  const before = rows(db)
  fs.writeFileSync(book.backupPath, 'invalid sqlite backup')
  enable(true)
  await assert.rejects(book.prune(now), /账本维护进程退出/)
  assert.deepEqual(rows(db), before)
  assert.equal(book.needsVacuum, false)
  assert.equal(fs.readFileSync(book.backupPath, 'utf8'), 'invalid sqlite backup')
})

test('清理提交且完整性通过：完整备份在压实前立即删除', async t => {
  let before, snapshot
  const { db, book, enable } = make(t, () => {
    const backup = new DatabaseSync(book.backupPath, { readOnly: true })
    snapshot = rows(backup)
    backup.close()
  })
  put(db, now - 42 * day); put(db, now - 40 * day)
  before = rows(db)
  enable(true); await book.prune(now)
  assert.deepEqual(snapshot, before)
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
  assert.equal(fs.existsSync(book.backupPath), false)
  assert.equal(book.needsVacuum, true)
  await book.prune(now)
  assert.equal(fs.existsSync(book.backupPath), false)
})

test('清理提交后主库完整性校验失败：保留备份并记录失败原因', async t => {
  const warnings = []
  t.mock.method(console, 'warn', (...args) => warnings.push(args.map(String).join(' ')))
  const { db, book, enable } = make(t, current => {
    // 临时库制造缺失索引项；校验仍由真实维护子进程执行。
    current.enableDefensive(false)
    current.exec(`CREATE TABLE validation_probe(value TEXT);
      CREATE INDEX validation_empty ON validation_probe(value);
      PRAGMA writable_schema=ON;
      UPDATE sqlite_master SET rootpage=(SELECT rootpage FROM sqlite_master WHERE name='validation_empty')
        WHERE name='idx_events_path';
      PRAGMA writable_schema=OFF;`)
    current.enableDefensive(true)
  })
  put(db, now - 42 * day); put(db, now - 40 * day)
  const before = rows(db)
  enable(true)
  await assert.rejects(book.prune(now), /主库完整性校验失败/)
  assert.equal(rows(db)[0].body, null)
  assert.equal(fs.existsSync(book.backupPath), true)
  assert.equal(book.needsVacuum, false)
  assert.match(warnings.join('\n'), /清理或校验失败，保留备份/)
  const backup = new DatabaseSync(book.backupPath, { readOnly: true })
  assert.deepEqual(rows(backup), before)
  assert.equal(backup.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
  backup.close()
})

test('清理UPDATE失败：保留完整备份并记日志', async t => {
  const warnings = []
  t.mock.method(console, 'warn', (...args) => warnings.push(args.map(String).join(' ')))
  const { db, book, enable } = make(t)
  put(db, now - 42 * day); put(db, now - 40 * day)
  db.exec(`CREATE TRIGGER reject_trim BEFORE UPDATE OF body ON events
    BEGIN SELECT RAISE(ABORT, 'fixture rejects update'); END;`)
  const before = rows(db)
  enable(true)
  await assert.rejects(book.prune(now), /fixture rejects update/)
  assert.deepEqual(rows(db), before)
  assert.equal(fs.existsSync(book.backupPath), true)
  assert.match(warnings.join('\n'), /清理或校验失败，保留备份/)
})

test('记录保留卡：瘦身开关默认关，点击逐键保存并更新状态', async () => {
  const key = 'kuma.ledger.trimSlotitemBodies'
  const yu = mountYu({ ui: { [settings.SETTINGS_SECTION_UI_KEY]: 'archive' } })
  await yu.settled()
  const card = () => cardHtml(yu.pane.innerHTML, 'retention')
  assert.match(card(), /精简旧装备清单/)
  assert.match(card(), /只清 30 天前的装备清单 · 最新清单与时间保留 · 获得、改修、掉落等记录不变/)
  assert.doesNotMatch(card(), /装备整表正文瘦身|报文的正文/)
  assert.match(card(), /class="ysw" data-toggle="kuma\.ledger\.trimSlotitemBodies"/)
  yu.click({ toggle: key })
  assert.equal(yu.configOf(key), true)
  assert.match(card(), /class="ysw on" data-toggle="kuma\.ledger\.trimSlotitemBodies"/)
  yu.click({ toggle: key })
  assert.equal(yu.configOf(key), false)
})

test('30天严格边界、仅slot_item正文；保留行/ts/post、最新基线、全部questlist与其它路径', async t => {
  const { db, book, enable } = make(t)
  put(db, cutoff - 1); put(db, cutoff); put(db, cutoff + 1)
  put(db, now - 40 * day, quest, { api_data: { api_list: [{ api_no: 217, api_state: 2 }] } })
  put(db, now - 40 * day, '/kcsapi/api_get_member/require_info')
  put(db, now - 40 * day, '/kcsapi/api_req_quest/clearitemget')
  put(db, now - 40 * day, '/kcsapi/api_get_member/slot_item_extra')
  const before = rows(db), syncBefore = readers(db).queryEquipSyncTs()
  enable(true)
  await book.prune(now)
  const after = rows(db)
  assert.deepEqual(after, before.map(row => row.id === 1 ? { ...row, body: null } : row))
  assert.deepEqual(readers(db).queryEquipSyncTs(), syncBefore)
  assert.ok(readers(db).loadLatestSlotitemList())
  assert.equal(readers(db).loadLatestAuthoritativeQuestList().body.api_list[0].api_no, 217)
  assert.equal(fs.existsSync(book.backupPath), false)
})

test('40天没登录：最新一份非空slot_item与最新80条questlist仍可恢复', async t => {
  const { db, book, enable } = make(t)
  put(db, now - 42 * day); put(db, now - 41 * day); put(db, now - 40 * day)
  put(db, now - 39 * day, slot, null)
  for (let i = 0; i < 81; i++) put(db, now - 40 * day + i, quest, { api_data: { api_list: [{ api_no: 217, api_state: 2 }] } })
  const r = readers(db), baseline = r.loadLatestSlotitemList(), questBaseline = r.loadLatestAuthoritativeQuestList()
  assert.ok(baseline)
  assert.ok(questBaseline)
  enable(true); await book.prune(now)
  assert.deepEqual(r.loadLatestSlotitemList(), baseline)
  assert.deepEqual(r.loadLatestAuthoritativeQuestList(), questBaseline)
  assert.equal(db.prepare('SELECT count(*) n FROM events WHERE path=? AND body IS NOT NULL').get(slot).n, 1)
  assert.equal(db.prepare('SELECT count(*) n FROM events WHERE path=? AND body IS NOT NULL').get(quest).n, 81)
})

test('每批让出线程；关闭开关即停止后续批次，再开启可继续', async t => {
  let pause = false
  const { db, book, enable } = make(t, () => { if (pause) enable(false) })
  for (let i = 0; i < 15; i++) put(db, now - 40 * day + i)
  enable(true); await book.prune(now)
  for (let i = 0; i < 15; i++) put(db, now - 40 * day + i)
  const before = db.prepare('SELECT count(*) n FROM events WHERE body IS NOT NULL').get().n
  pause = true
  await book.prune(now)
  const partiallyCleaned = db.prepare('SELECT count(*) n FROM events WHERE body IS NOT NULL').get().n
  assert.equal(partiallyCleaned, before - 1)
  await book.prune(now)
  assert.equal(db.prepare('SELECT count(*) n FROM events WHERE body IS NOT NULL').get().n, partiallyCleaned)
  pause = false
  enable(true); await book.prune(now)
  assert.equal(db.prepare('SELECT count(*) n FROM events WHERE body IS NOT NULL').get().n, 1)
})

test('退出压实限时、失败重试；成功只压实一次，不留备份且重启记住结果', async t => {
  const { db, file, book, enable } = make(t)
  for (let i = 0; i < 6; i++) put(db, now - 40 * day + i)
  enable(true); await book.prune(now)
  book.stop(); db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  // 本测试的连接不再写；断言生产退出是在连接关闭后才启动 VACUUM。
  db.close()
  assert.equal(await book.compactOnQuit(1), false)
  assert.equal(book.needsVacuum, true)
  assert.equal(await book.compactOnQuit(), true)
  assert.equal(book.needsVacuum, false)
  assert.equal(await book.compactOnQuit(), false)
  const reopened = new DatabaseSync(file)
  assert.equal(reopened.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
  assert.equal(rows(reopened).length, 6)
  const next = new SlotitemBodyRetention(reopened, file, () => true)
  assert.equal(next.needsVacuum, false)
  next.stop(); reopened.close()
  assert.equal(fs.existsSync(book.backupPath), false)
})

test('退出连续三次超时后持久化暂停；无变化不重置，新清理才重置', async t => {
  const { db, file, book, enable } = make(t)
  put(db, now - 42 * day); put(db, now - 40 * day)
  enable(true); await book.prune(now)
  book.stop(); db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.close()
  const state = () => JSON.parse(fs.readFileSync(`${file}.slotitem-trim.json`, 'utf8'))
  for (let i = 1; i <= 3; i++) {
    const restarted = new SlotitemBodyRetention(db, file, () => true)
    assert.equal(await restarted.compactOnQuit(1), false)
    assert.equal(state().vacuumTimeouts, i)
    assert.equal(restarted.needsVacuum, i < 3)
    restarted.stop()
  }
  const reopened = new DatabaseSync(file)
  t.after(() => { if (reopened.isOpen) reopened.close() })
  const next = new SlotitemBodyRetention(reopened, file, () => true)
  const before = state()
  assert.equal(await next.compactOnQuit(1), false)
  assert.deepEqual(state(), before)
  await next.prune(now)
  assert.equal(next.needsVacuum, false)
  assert.equal(state().vacuumTimeouts, 3)
  put(reopened, now - 39 * day)
  await next.prune(now)
  assert.equal(state().vacuumTimeouts, 0)
  assert.equal(next.needsVacuum, true)
  next.stop(); reopened.close()
  assert.equal(await next.compactOnQuit(), true)
})

test('历史对账脚本报告已清空装备正文的准确条数', t => {
  const { db } = make(t)
  put(db, now, slot, null); put(db, now + 1, slot, null)
  put(db, now + 2, '/kcsapi/api_port/port', null)
  const source = fs.readFileSync(path.join(root, 'scripts/quest-replay.mjs'), 'utf8')
  const start = source.indexOf('const rows = db'), end = source.indexOf('const realNow = Date.now', start)
  assert.ok(start >= 0 && end > start)
  const output = []
  // 执行原脚本的读取/提示段，无需装配无关的战斗与任务归约器。
  vm.runInNewContext(source.slice(start, end), { db, console: { log: text => output.push(text) } })
  assert.deepEqual(output, ['装备整表正文已清空 2 条；对应时段的装备账无法完整对账。'])
})

test('退出等压实完成；关闭游戏触发的重入退出不提前结束，也不重复压实', async () => {
  const source = fs.readFileSync(path.join(root, 'src/main/mg/index.ts'), 'utf8')
  const start = source.indexOf('let ledgerCompactingOnQuit = false'), end = source.indexOf('type ApiRequestInfo', start)
  assert.ok(start >= 0 && end > start)
  const app = new EventEmitter(), calls = []
  let finish
  const pending = new Promise(resolve => { finish = resolve })
  const event = () => ({ prevented: false, preventDefault() { this.prevented = true } })
  app.quit = () => { calls.push('quit'); const next = event(); app.emit('before-quit', next); assert.equal(next.prevented, false) }
  const ledger = { closeDatabase: () => calls.push('close'), slotitemBodyRetention: {
    stop: () => calls.push('stop'), needsVacuum: true,
    compactOnQuit: () => { calls.push('compact'); return pending },
  } }
  const BrowserWindow = { getAllWindows: () => [
    { isDestroyed: () => false, hide: () => calls.push('hide-main') },
    { isDestroyed: () => false, hide: () => calls.push('hide-secondary') },
    { isDestroyed: () => true, hide: () => assert.fail('已销毁窗口不应调用hide') },
  ] }
  vm.runInNewContext(source.slice(start, end), { app, ledger, BrowserWindow, domainSaveTimer: null,
    saveDomainNow: () => calls.push('save'), flushVoiceUnmatched: () => calls.push('flush'), console })
  const first = event(); app.emit('before-quit', first)
  const reentrant = event(); app.emit('before-quit', reentrant)
  assert.equal(first.prevented, true)
  assert.equal(reentrant.prevented, true)
  assert.deepEqual(calls, ['hide-main', 'hide-secondary', 'flush', 'stop', 'close', 'compact'])
  finish(true)
  await pending
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls, ['hide-main', 'hide-secondary', 'flush', 'stop', 'close', 'compact',
    'quit', 'hide-main', 'hide-secondary', 'flush', 'stop'])
})
