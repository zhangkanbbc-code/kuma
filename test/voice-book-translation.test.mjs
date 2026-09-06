import assert from 'node:assert/strict'
import test from 'node:test'
import { runtimeHost, runProductionSection } from '../scripts/lib/player-view-runtime.mjs'

// 编译图鉴实际加载段与 regularVoiceHtml；只替换资料、播放器和档案边界。
const source = 'src/renderer/modules/ji.ts'
const pack = data => ({ meta: {}, data })
const kc = (ja, zh, key = '024-Intro') => ({ key, scene: '获得/登录时', ja, zh })
const wiki = (ja, voiceId = 1) => ({ key: String(voiceId), scene: '入手/ログイン', ja, voiceId })
const render = (packs, ids = [212, 85]) => {
  const host = runtimeHost()
  const shared = name => host.load(`src/shared/${name}.ts`)
  const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
  const state = runProductionSection(source, '        installZhSimplifier(opencc)', '        // 三层第一方台账在', {
    ...shared('voice-overlay'), ...shared('voice-scene-slots'), ...shared('voice-lineage'),
    ...shared('npc-voice-book'), ...host.load('src/renderer/zh-simplify.ts'),
    v: packs.kcwiki ?? null, sv: null, w: packs.wikiwiki ?? null, a: null, ka: null,
    z: packs.zh ?? null, j: packs.ja ?? null, e: null, kv: packs.kuma ?? null,
    kvZh: packs.overlay ?? null, npc: null, opencc: null, kcwikiLode: null,
    abyssalShips: new Map(), resolveAbyssalName: () => null, localizedEntityId: () => null,
  })
  const row = host.extract(source, ['voiceRowWithUrl'], { esc }).api.voiceRowWithUrl
  const rows = []
  const rowHtml = (key, scene, ja, zh) => {
    rows.push({ key, scene, ja, zh })
    return row(key, scene, ja, zh, null)
  }
  const book = host.extract(source, ['regularVoiceHtml'], {
    ...state, esc, voiceFallbackOf: new Map([[ids[0], ids]]),
    voiceRow: (_id, _target, ...args) => rowHtml(...args), voiceRowWithUrl: rowHtml,
    kumaVoiceUrl: () => null, kumaVoiceOffNote: () => '', skeletonRows: () => [],
    bareArchiveRows: () => [], archiveVariantRows: () => [], voiceState: () => ({ enabled: true }),
    extraVoiceUrl: () => null, archivedExtraVoiceUrl: () => null,
    abyssArchiveRows: () => [], abyssArchiveIndex: () => new Map(),
    ensureAbyssVoiceSightings: () => {}, abyssHeardVoiceId: () => null, abyssGuessBlock: () => '',
    masterShipName: id => `舰${id}`, entityNameHtml: (_kind, _id, name) => name,
    lodeCreditMark: () => '',
  }).api
  return { html: book.regularVoiceHtml(ids[0]), rows, index: state.voiceZhByJa }
}

for (const origin of ['kcwiki', 'subtitle', 'overlay', 'kuma']) {
  test(`图鉴真编译：只有 wikiwiki 的形态按同句取 ${origin} 中文并保留日文副行`, () => {
    const ja = ' 同じ　台詞！ '
    const packs = { wikiwiki: pack({ 212: [wiki(ja)] }) }
    if (origin === 'kcwiki') packs.kcwiki = pack({ 100: [kc('同じ台詞！', '同句中文')] })
    if (origin === 'subtitle') {
      packs.ja = pack({ 100: { 1: '同じ台詞！' } })
      packs.zh = pack({ 100: { 1: '同句中文' } })
    }
    if (origin === 'overlay') packs.overlay = pack({ byJa: [{ ja: '同じ台詞！', zh: '同句中文' }] })
    if (origin === 'kuma') packs.kuma = pack({ ships: { 100: [kc('同じ台詞！', '同句中文')] } })
    const result = render(packs)
    assert.equal(result.rows[0].zh, '同句中文')
    assert.equal(result.rows[0].ja, ja)
    assert.match(result.html, /class="vo-ja"> 同じ　台詞！ <\/div>/)
    assert.match(result.html, /class="vo-zh">同句中文<\/div>/)
  })
}

test('图鉴真编译：同句没有中文时保留日文，深海 kcwiki 不得给舰娘补译', () => {
  const result = render({ wikiwiki: pack({ 212: [wiki('未知の台詞')] }), kcwiki: pack({ 1500: [kc('未知の台詞', '深海中文')] }) })
  assert.equal(result.rows[0].zh, '')
  assert.match(result.html, /class="vo-ja">未知の台詞<\/div>/)
  assert.doesNotMatch(result.html, /class="vo-zh"/)
})

test('图鉴真编译：同级字幕中文先于 wikiwiki；本形态与沿链续填均适用', () => {
  for (const id of [212, 85]) {
    const result = render({ wikiwiki: pack({ [id]: [wiki('別の転写')] }), ja: pack({ [id]: { 1: '字幕原文' } }), zh: pack({ [id]: { 1: '字幕中文' } }) })
    assert.deepEqual(result.rows.map(({ ja, zh }) => [ja, zh]), [['字幕原文', '字幕中文']])
  }
  const borrowed = render({ wikiwiki: pack({ 85: [wiki('沿用の台詞')] }), kcwiki: pack({ 100: [kc('沿用の台詞', '沿用中文')] }) })
  assert.equal(borrowed.rows[0].zh, '沿用中文')
})

test('图鉴真编译：同句索引沿用实时字幕的四源优先级', () => {
  const packs = {
    wikiwiki: pack({ 212: [wiki('同句')] }),
    ja: pack({ 100: { 1: '同句' } }), zh: pack({ 100: { 1: '字幕中文' } }),
    kcwiki: pack({ 100: [kc('同句', '百科中文')] }),
    overlay: pack({ byJa: [{ ja: '同句', zh: '覆盖层中文' }] }),
    kuma: pack({ ships: { 100: [kc('同句', '自译中文')] } }),
  }
  assert.equal(render(packs).rows[0].zh, '字幕中文')
  delete packs.zh
  assert.equal(render(packs).rows[0].zh, '百科中文')
  delete packs.kcwiki
  assert.equal(render(packs).rows[0].zh, '覆盖层中文')
  delete packs.overlay
  assert.equal(render(packs).rows[0].zh, '自译中文')
})

test('图鉴真编译：无 wikiwiki 玩家模式保留本形态和沿用槽，开发模式与其输出一致', () => {
  const packs = {
    kcwiki: pack({ 212: [kc('自前の台詞', '本形态中文', '024-Sec3')] }),
    ja: pack({ 212: { 1: '本形态原文' }, 85: { 2: '沿用原文' } }),
    zh: pack({ 212: { 1: '本形态字幕' }, 85: { 2: '沿用字幕' } }),
  }
  const player = render(packs)
  assert.deepEqual(player.rows.map(({ ja, zh }) => [ja, zh]), [
    ['自前の台詞', '本形态中文'], ['本形态原文', '本形态字幕'], ['沿用原文', '沿用字幕'],
  ])
  const developer = render({ ...packs, wikiwiki: pack({ 212: [wiki('別の転写')], 85: [wiki('沿用の別転写', 2)] }) })
  assert.equal(developer.html, player.html)
})
