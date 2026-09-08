import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { cleanWikiwikiVoiceText, normalizeWikiwikiVoiceRows, parseWikiwikiVoicePage } from '../scripts/lib/wikiwiki-voice.mjs'
import { ingestSpecialAttackRows, specialAttackForms } from '../scripts/voice-special-attack-ingest.mjs'
import { SPECIAL_VOICE_SLOT_IDS, VOICE_SCENE_SLOTS, voiceSlotOfKey } from '../src/shared/voice-scene-slots.ts'
import validation from '../dist/main/lode-validation.js'
import { captionsFromLodes } from './fixtures/render-ship-caption.mjs'
import { runtimeHost } from '../scripts/lib/player-view-runtime.mjs'
import voiceSound from '../dist/shared/voice-sound-path.js'

const { voiceSoundPathname } = voiceSound

const readPack = id => JSON.parse(readFileSync(new URL(`../assets/lodes/${id}.json`, import.meta.url), 'utf8'))
const kuma = readPack('kuma-voice')
const wikiwiki = readPack('wikiwiki-voice')
const fixture = readFileSync(new URL('./fixtures/wikiwiki-special-attack.html', import.meta.url), 'utf8')
const forms = parseWikiwikiVoicePage(fixture, '夹具')

test('特殊槽校验：沿用名单放行自译与底本，表外编号与坏备注拒绝', () => {
  for (const slot of [1, 53, ...SPECIAL_VOICE_SLOT_IDS, 0, 54, 899, 904, 989, 994, 900.5]) {
    const allowed = slot === 1 || slot === 53 || SPECIAL_VOICE_SLOT_IDS.includes(slot)
    const pack = structuredClone(kuma)
    pack.data.ships = { 916: [{ ...kuma.data.ships[916].find(row => row.slot === 900), slot }] }
    assert.equal(validation.validateLodePack(pack, 'kuma-voice').ok, allowed, `kuma ${slot}`)
    const base = structuredClone(wikiwiki)
    base.data = { 916: [{ key: '大和#0-1', scene: '特殊攻撃', ja: '号令', page: '大和', voiceId: slot, note: '備考' }] }
    assert.equal(validation.validateLodePack(base, 'wikiwiki-voice').ok, allowed, `wikiwiki ${slot}`)
    base.data[916][0].note = 123
    assert.equal(validation.validateLodePack(base, 'wikiwiki-voice').ok, false)
  }
})

test('自译 basis 五档均可校验，英文 wiki 不接受拼错的出处档', () => {
  const pack = structuredClone(kuma)
  const row = { ...kuma.data.ships[591].find(row => row.slot === 991) }
  pack.data.ships = { 591: [row] }
  for (const basis of ['key-confirmed', 'wikiwiki-mapped', 'enwiki-mapped', 'divergent', 'ambiguous']) {
    row.basis = basis
    assert.equal(validation.validateLodePack(pack, 'kuma-voice').ok, true, basis)
  }
  row.basis = 'enwiki-map'
  assert.equal(validation.validateLodePack(pack, 'kuma-voice').ok, false)
})

test('英文 wiki 许可只标原文列，中文保持 kuma 第一方译文', () => {
  assert.equal(validation.validateLodePack(kuma, 'kuma-voice').ok, true)
  assert.match(kuma.meta.source, /僚舰夜战突击分支、部分特殊攻击号令、Glorious 四形态与 Gloire 两形态补缺台词的日文底本参考 en\.kancollewiki\.net 各舰 Quotes 表/)
  const source = kuma.meta.extraSources.find(row => row.source === 'en.kancollewiki.net')
  assert.equal(source.license, 'CC BY-NC-SA')
  assert.match(source.note, /仅 ja 原文列/)
  assert.match(source.note, /zh 为 kuma 自行翻译，中文译文权利归 kuma/)
  assert.equal(kuma.meta.license, 'kuma 自行整理（第一方译文）')
})

test('英文 wiki 行沿用播放观测的 off-note，不误标为多候选或音轨分歧', () => {
  const host = runtimeHost()
  const api = host.extract('src/renderer/modules/ji.ts', ['kumaVoiceOffNote'], {
    ...host.load('src/shared/voice-scene-slots.ts'),
    voiceObservedOffNote: (mstId, slot) => `${mstId} / ${slot} 播放观测`,
  }).api
  assert.equal(api.kumaVoiceOffNote(591, { slot: 991, basis: 'enwiki-mapped' }), '591 / 991 播放观测')
  assert.equal(api.kumaVoiceOffNote(591, { slot: 991, basis: 'divergent' }), '与游戏当前音轨对不上')
  assert.equal(api.kumaVoiceOffNote(591, { slot: 2, basis: 'ambiguous' }), '当前场合有多个候选 · 对应台词未确定')
})

test('SpecialAtk token 独立于常规表，三个形态五条档名各归其槽', () => {
  assert.ok(Object.values(VOICE_SCENE_SLOTS).every(row => row.slot <= 53))
  const voice = readPack('kcwiki-voice').data
  const actual = [944, 1065, 1070].flatMap(id => voice[id].filter(row => /SpecialAtk/.test(row.key))
    .map(row => [id, voiceSlotOfKey(row.key)]))
  assert.deepEqual(actual, [[944, 900], [944, 901], [1065, 900], [1065, 901], [1070, 900]])
  assert.equal(voiceSlotOfKey('544-SpecialAtk3'), null)
})

test('大和夹具：分组与号令、适用列的 rowspan 续行均保留', () => {
  assert.ok(!forms.some(form => form.name === '大和' || form.name === '大和改'))
  for (const name of ['大和改二', '大和改二重']) {
    const rows = forms.find(form => form.name === name).lines
    assert.deepEqual(rows.map(row => row.voiceId), [900, 901])
    assert.deepEqual(rows.map(row => row.scene), ['特殊攻撃 / 号令', '特殊攻撃 / 号令'])
    assert.deepEqual(rows.map(row => row.note), ['2番艦が武蔵改二', '2番艦が武蔵改二以外'])
  }
})

test('Colorado 夹具：開戦・攻撃里的特殊攻撃归 900，常规編成仍归 13', () => {
  const rows = forms.find(form => form.name === 'Colorado').lines
  assert.deepEqual(rows.map(row => row.voiceId), [900, 13])
  assert.equal(rows[0].scene, '開戦・攻撃 / 特殊攻撃')
})

test('金剛式夹具：备注夜战号令未点名僚舰时归 900，点名分支仍从 990 起', () => {
  const rows = forms.find(form => form.name === '金剛改二丙').lines
  assert.equal(rows.length, 1)
  assert.equal(rows[0].scene, '特殊攻撃')
  assert.equal(rows[0].note, '【僚艦夜戦突撃】号令')
  assert.equal(rows[0].voiceId, 900)
  assert.deepEqual(normalizeWikiwikiVoiceRows(rows), rows)
  assert.equal(normalizeWikiwikiVoiceRows([{ ...rows[0], note: '僚艦夜戦突撃' }])[0].voiceId, 900)
  for (const name of ['金剛', '比叡', '榛名', '霧島']) {
    assert.equal(normalizeWikiwikiVoiceRows([{ ...rows[0], note: `${name}僚艦ボイス` }])[0].voiceId, 990)
  }
})

test('榛名夹具：两格场景加四条备注，汎用不占槽、后三句归 990–992', () => {
  for (const name of ['榛名改二乙', '榛名改二丙']) {
    const rows = forms.find(form => form.name === name).lines
    assert.deepEqual(rows.map(row => row.voiceId), [undefined, 990, 991, 992])
    assert.ok(rows.every(row => row.scene === '開戦・攻撃 / 特殊攻撃 / 各僚艦ボイス'))
    assert.deepEqual(rows.map(row => row.note), ['【僚艦夜戦突撃】号令 汎用', '金剛僚艦ボイス', '比叡僚艦ボイス', '霧島僚艦ボイス'])
    assert.deepEqual(normalizeWikiwikiVoiceRows(rows), rows)
  }
})

test('脚注与英文注音剥离，長門旧句只入 note，重复归一化不变', () => {
  assert.equal(cleanWikiwikiVoiceText('Nelson Touch！(ネルソン タッチ)*10。主砲、1番！*2'), 'Nelson Touch！主砲、1番！')
  const rows = wikiwiki.data[541].filter(row => row.key.includes('#900-'))
  assert.equal(rows.length, 4)
  assert.equal(rows[0].ja, '行くぞ、主砲一斉射！て――ッ！！')
  assert.match(rows[0].note, /旧句：行くぞ、一斉射！て――ッ！！/)
  assert.deepEqual(normalizeWikiwikiVoiceRows(rows), rows)
})

test('离线补录按列解形态并幂等，空白和编辑模板不入底本', () => {
  const pages = [{ page: '/kancolle/大和改二重', rows: [
    { forms: ['大和', '大和改', '改二', '改二重'], grp: '特殊攻撃', cells: ['号令', '武蔵、続いて！', '×', '×', '◯', '◯', '武蔵改二', '編集'] },
    { forms: ['大和', '大和改', '改二', '改二重'], grp: '特殊攻撃', cells: ['二番艦も続いて！', 'その他', '編集'] },
  ] }]
  const pack = { data: {} }
  const ships = [911, 916].map((api_id, i) => ({ api_id, api_sortno: 1, api_name: ['大和改二', '大和改二重'][i] }))
  assert.equal(ingestSpecialAttackRows(pack, pages, ships), 4)
  const first = JSON.stringify(pack)
  assert.equal(ingestSpecialAttackRows(pack, pages, ships), 0)
  assert.equal(JSON.stringify(pack), first)
  for (const [name, labels] of [['Nelson', ['ネルソン', 'ネルソン改']], ['Rodney', ['未改造', '改']]]) {
    const page = { page: `/kancolle/${name}`, rows: [{ forms: labels, grp: '特殊攻撃', cells: ['号令', '突入！', '◯', '◯', '', '編集'] }] }
    assert.deepEqual(specialAttackForms(page).map(form => form.name), [name, `${name}改`])
    for (const ja of ['', 'ネルソンタッチなどの特殊攻撃専用ボイスです。項目毎削除してください']) {
      page.rows[0].cells[1] = ja
      assert.deepEqual(specialAttackForms(page), [])
    }
  }
})

test('真包字幕：916 两种二番舰分支、944 百科中文、英法五形态号令；玩家与底本模式一致', async () => {
  const lodes = Object.fromEntries(['kcwiki-ships', 'kcwiki-voice', 'kcwiki-seasonal-voice', 'subtitle-ja', 'subtitle-zh', 'kuma-voice', 'kuma-voice-zh', 'opencc-t2s'].map(id => [id, readPack(id)]))
  for (const withBase of [false, true]) {
    const input = { lodes: { ...lodes, ...(withBase ? { 'wikiwiki-voice': wikiwiki } : {}) }, ships: [] }
    for (const slot of [900, 901]) {
      const expected = kuma.data.ships[916].find(row => row.slot === slot)
      const lines = await captionsFromLodes(input, { kind: 'ship', mstId: 916, voiceId: slot })
      assert.deepEqual(lines.map(line => line.text), [expected.zh])
      assert.ok(lines.every(line => line.speaker === '舰916'))
    }
    const lines = await captionsFromLodes(input, { kind: 'ship', mstId: 944, voiceId: 900 })
    assert.equal(lines[0].text, '第六舰队！第一潜艇战队！出动！各位第一潜艇战队的战友，有劳了！动手！！')
    assert.equal(lines.length, 1)
    for (const mstId of [364, 392, 724, 733, 969]) {
      const expected = kuma.data.ships[mstId].find(row => row.slot === 900)
      const special = await captionsFromLodes(input, { kind: 'ship', mstId, voiceId: 900 })
      assert.deepEqual(special.map(line => line.text), [expected.zh])
    }
    for (const mstId of [591, 592, 593, 954, 694]) {
      for (const voiceId of [900, 990, 991, 992, 993]) {
        const expected = kuma.data.ships[mstId].find(row => row.slot === voiceId)
        const special = await captionsFromLodes(input, { kind: 'ship', mstId, voiceId })
        assert.deepEqual(special.map(line => line.text), expected ? [expected.zh] : [])
      }
    }
  }
})

test('字幕中文优先、无中文回日文：顶部与底部均调度同一条', async () => {
  const scheduled = []
  const host = runtimeHost()
  let mode = 'friendly'
  const api = host.extract('src/renderer/voice-subtitle.ts', ['displayAtPlaybackTime'], {
    ...host.load('src/shared/voice-scene-slots.ts'),
    captionsFor: () => [], mg: { sortie: null },
    // 顶部与底部共用单条字幕调度；中部的完整 DOM 行为另有护栏。
    // 中部演出已替换为突入式；这里仍只验证顶部与底部的调度出口。
    specialCaptionStyle: false, showCutin: () => assert.fail('关闭视觉加强时不应走突入字幕'),
    modeFor: () => mode, scheduleLines: (lines, target) => scheduled.push({ lines, target }),
  }).api
  const cue = { kind: 'ship', mstId: 916, voiceId: 900 }
  for (const zh of ['中文。', '']) {
    const lines = await captionsFromLodes({
      lodes: { 'kuma-voice': { data: { ships: { 916: [{ slot: 900, zh, ja: '全艦、一斉射！' }] } } } },
    }, cue)
    assert.deepEqual(lines, [{ speaker: '舰916', text: zh ? '中文' : '全艦、一斉射！', delay: 0 }])
    scheduled.length = 0
    mode = 'friendly'
    api.displayAtPlaybackTime(cue, lines)
    mode = 'bottom'
    api.displayAtPlaybackTime(cue, lines)
    assert.deepEqual(scheduled, [{ lines, target: 'friendly' }, { lines, target: 'bottom' }])
  }
})

test('591 的 991 与 392 的 900 在生产 consume 路径显示台词，仍触发特殊攻击事件', async () => {
  for (const [mstId, voiceId] of [[591, 991], [392, 900]]) {
    const calls = []
    const fired = []
    const host = runtimeHost()
    const cue = { kind: 'ship', mstId, voiceId }
    const lodes = Object.fromEntries(['kcwiki-ships', 'kcwiki-voice', 'kcwiki-seasonal-voice', 'subtitle-ja', 'subtitle-zh', 'kuma-voice', 'kuma-voice-zh', 'opencc-t2s', 'wikiwiki-voice'].map(id => [id, readPack(id)]))
    const lines = await captionsFromLodes({ lodes, ships: [] }, cue)
    const expected = kuma.data.ships[mstId].find(row => row.slot === voiceId)
    assert.match(expected.ja, mstId === 591 ? /榛名、大丈夫デスカー？/ : /戦艦Richelieuの火力/)
    assert.deepEqual(lines.map(line => line.text), [expected.zh])
    const displayed = []
    const api = host.extract('src/renderer/voice-subtitle.ts', ['consume'], {
      captionsEnabled: true, mg: { sortie: null }, captionsFor: () => lines,
      resolveVoiceRequest: () => cue,
      window: { dispatchEvent: (event) => fired.push(event) },
      CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail } },
      ipcRenderer: { invoke: (...args) => calls.push(args) },
      displayAtPlaybackTime: (...args) => displayed.push(args),
    }).api
    const pathname = `/kcs/sound/kctest/${voiceId}.mp3`
    api.consume({ pathname, ts: Date.now() })
    assert.equal(calls.length, 0)
    assert.equal(displayed.length, 1)
    assert.deepEqual(displayed[0], [cue, lines.map(line => ({ ...line, pathname }))])
    assert.equal(fired.length, 1)
    assert.equal(fired[0].type, 'special-attack-fired')
    assert.equal(fired[0].detail.mstId, mstId)
    assert.equal(fired[0].detail.voiceId, voiceId)
  }
})

test('图鉴真渲染：金剛四行、霧島五行与英法五形态号令可播，金剛 993 保留探测钮', () => {
  const host = runtimeHost()
  const sound = (id, slot) => voiceSoundPathname(`form${id}`, id, slot)
  const api = host.extract('src/renderer/modules/ji.ts', ['regularVoiceHtml', 'kumaVoiceUrl'], {
    esc: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'),
    kumaVoiceLode: kuma, correctedVoiceRows: new Map(), voiceFallbackOf: new Map(),
    subtitleJa: null, subtitleZh: null, wikiwikiVoiceLode: null, voiceZhByJa: new Map(),
    voiceLode: null, voiceAbsentReady: () => true, archivedVoiceUrl: () => null,
    isVoiceAbsent: () => false, voiceObservedOffNote: () => '',
    voicePlaybackFor: (id, slot) => ({ url: sound(id, slot), pathname: sound(id, slot) }),
    voiceRow: () => assert.fail('这些样本由自译或骨架显示'),
    bareArchiveRows: () => [], archiveVariantRows: () => [],
    extraVoiceUrl: () => null, archivedExtraVoiceUrl: () => null,
    abyssArchiveIndex: () => new Map(), ensureAbyssVoiceSightings: () => {},
    abyssHeardVoiceId: () => null, abyssGuessBlock: () => '', voiceState: () => ({ enabled: true }),
    abyssArchiveRows: () => [], voiceFootNote: () => '', lodeCreditMark: () => '',
    masterShipName: id => `舰${id}`, entityNameHtml: (_kind, _id, name) => name,
    voiceAbsentDay: () => '',
  }).api
  for (const [id, slots] of [[916, [900, 901]], [591, [900, 990, 991, 992]], [694, [900, 990, 991, 992, 993]],
    ...[364, 392, 724, 733, 969].map(id => [id, [900]])]) {
    const html = api.regularVoiceHtml(id)
    for (const slot of slots) {
      const row = kuma.data.ships[id].find(row => row.slot === slot)
      assert.ok(html.includes(row.ja))
      assert.ok(html.includes(row.zh))
      assert.ok(html.includes(row.scene))
      assert.equal(html.split(`data-voice-path="${sound(id, slot)}"`).length - 1, 1)
      assert.ok(!html.includes(`data-voice-probe="${slot}"`))
    }
    assert.equal(html.split('槽位待耳测').length - 1, 0)
    if (id === 591) for (const slot of [993]) {
      assert.equal(html.split(`data-voice-probe="${slot}"`).length - 1, 1)
      assert.ok(!html.includes(`data-voice-path="${sound(id, slot)}"`))
    }
  }
  assert.equal(api.kumaVoiceUrl(591, { slot: 2, basis: 'ambiguous' }), null)
})

test('自译清单 25 形态 50 行；金刚型搭档分支与英法五形态号令各标出处', () => {
  const rows = Object.entries(kuma.data.ships).flatMap(([id, lines]) => lines
    .filter(row => (row.slot >= 900 && row.slot <= 903) || (row.slot >= 990 && row.slot <= 993))
    .map(row => ({ id: Number(id), ...row })))
  assert.equal(rows.length, 50)
  assert.equal(new Set(rows.map(row => row.id)).size, 25)
  assert.deepEqual([...new Set(rows.map(row => row.id))].sort((a, b) => a - b),
    [364, 392, 541, 546, 571, 572, 573, 576, 577, 591, 592, 593, 601, 634, 639, 694, 724, 733, 911, 913, 916, 918, 954, 969, 1496])
  for (const id of [364, 392, 724, 733, 969]) {
    assert.deepEqual(rows.filter(row => row.id === id).map(row => [row.key, row.slot, row.scene, row.basis]),
      [[`${id}-900`, 900, '特殊攻击', 'enwiki-mapped']])
  }
  const partners = { 591: ['比叡', '榛名', '雾岛'], 592: ['金刚', '榛名', '雾岛'],
    593: ['金刚', '比叡', '雾岛'], 954: ['金刚', '比叡', '雾岛'], 694: ['金刚', '比叡', '榛名', ' South Dakota'] }
  for (const id of [591, 592, 593, 954, 694]) {
    const own = rows.filter(row => row.id === id)
    const branchBasis = [593, 954].includes(id) ? 'ambiguous' : 'enwiki-mapped'
    assert.deepEqual(own.map(row => [row.key, row.slot, row.scene, row.basis]), [
      [`${id}-900`, 900, '特殊攻击', id === 694 ? 'enwiki-mapped' : 'wikiwiki-mapped'],
      ...partners[id].map((partner, i) => [`${id}-${990 + i}`, 990 + i, `僚舰夜战突击 · 僚舰${partner}`, branchBasis]),
    ])
  }
  for (const id of [591, 592]) {
    const own = rows.filter(row => row.id === id)
    const base = wikiwiki.data[id].filter(row => row.voiceId >= 900)
    assert.deepEqual(base.map(row => [row.voiceId, row.ja]), [[900, own[0].ja]])
    assert.deepEqual(normalizeWikiwikiVoiceRows(base), base)
  }
})
