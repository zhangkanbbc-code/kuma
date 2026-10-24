import assert from 'node:assert/strict'
import test from 'node:test'
import { runtimeHost, plainHtml } from '../scripts/lib/player-view-runtime.mjs'

const esc = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const noop = () => {}

const setup = ({ shipId = 101, lv = 30, afterShipId = 202, afterLv = 30, reversible = false } = {}) => {
  const ship = { id: 1, shipId, lv, slot: [], slotEx: -1, kyouka: [], expTotal: 1000, expNext: 100,
    cond: 49, nowhp: 30, maxhp: 30, karyoku: 10, raisou: 20 }
  const names = { [shipId]: '当前形态', [afterShipId]: '下一形态 & <改>' }
  const masterShipName = id => names[id]
  const mg = { ships: { 1: ship }, slotitems: {}, decks: [], ndocks: [], master: { stypes: {}, upgrades: {}, ships: {
    [shipId]: { afterShipId, afterLv },
    ...(afterShipId ? { [afterShipId]: { afterShipId: reversible ? shipId : 0, afterLv: reversible ? afterLv - 1 : 0 } } : {}),
  } } }
  const host = runtimeHost({ './kernel': { mg, masterShipName } })
  const { progressiveRemodelOf } = host.load('src/renderer/remodel.ts')
  const documentHandlers = new Map()
  const element = () => ({ classList: { remove: noop }, style: {}, addEventListener: noop })
  const document = {
    createElement: element, body: { appendChild: noop }, querySelectorAll: () => [],
    addEventListener: (type, listener) => documentHandlers.set(type, [...(documentHandlers.get(type) ?? []), listener]),
  }
  const routes = {}, navigations = [], opened = []
  const link = host.extract('src/renderer/link.ts', ['elink', 'registerEntityRoute', 'navigate'], {
    routes, esc, entityLinkColorClass: () => '', localizedLinkLabel: () => null,
    getPopModule: () => null, poppedNow: [],
    ipcRenderer: { invoke: () => assert.fail('本地导航不应调用 IPC') },
  }).api
  link.registerEntityRoute('mstShip', { mod: 'ji', colorClass: 'e-ship', open: ref => opened.push(ref) })
  host.extract('src/renderer/link.ts', ['initLink'], {
    document, routes, esc, initRichTips: noop,
    showPeek: noop, showMenu: noop, pinEntityPeek: () => assert.fail('普通单击不应钉住速览卡'),
    navigate: ref => { navigations.push(ref); return link.navigate(ref) },
  }).api.initLink()
  const qa = host.extract('src/renderer/modules/qa.ts', ['buildRows', 'previewHtml'], {
    mg, masterShipName, progressiveRemodelOf, esc, elink: link.elink,
    mstShips: new Map(), kcwikiByMst: new Map(), shipProfileByMst: new Map(),
    favoriteSignature: () => '', ensureLevelExpLode: noop, ensureFavoriteRoots: noop,
    pane: {}, render: noop, deferPassive: noop, fleetLabel: () => ({ canonical: '' }),
    buildRemodelStageMap: () => new Map(), expNeededTo: () => 112146,
    isFinalRemodelTarget: () => false, isAdvancedRemodelTarget: () => false,
    entityNamePlain: (_type, _id, name) => name,
    entityNameHtml: (_type, _id, name) => esc(name),
    isFavoriteOwnedShip: () => false, isFavoriteRoster: () => false, openingAswOutlookOf: () => null,
    STYPE_CN: {}, shipThumbHtml: () => '', fatigueBand: () => 'normal',
    instanceStatBarsHtml: () => '', equipLinesHtml: () => '', bonusLineHtml: () => '',
    shipRosterNote: () => '', noteTagsOf: () => [], state: { compare: [] },
    repairDuration: String, repairDurationSeconds: String, entityTermHtml: () => '',
  }).api
  const row = qa.buildRows()[0]
  const html = qa.previewHtml(row)
  const chain = html.match(/<div class="pv-chain">([\s\S]*?)<\/div>/)[1]
  // 解析实际渲染出的节点属性，再交给生产 initLink 的 document 点击监听器。
  const nodes = [...chain.matchAll(/<span\b([^>]*)>([\s\S]*?)<\/span>/g)].map(([, attrs, body]) => {
    const attributes = Object.fromEntries([...attrs.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value]))
    const classes = (attributes.class ?? '').split(/\s+/)
    const node = { attributes, body, dataset: { etype: attributes['data-etype'], eid: attributes['data-eid'] },
      closest: selector => selector === '.el' && classes.includes('el') ? node : null }
    return node
  }).filter(node => node.attributes.class.split(/\s+/).includes('pv-node'))
  const click = node => {
    for (const listener of documentHandlers.get('click') ?? []) listener({ target: node, ctrlKey: false, altKey: false })
  }
  return { row, nodes, chain, click, navigations, opened }
}

for (const [state, fixture] of [
  ['ready', { shipId: 101, lv: 30, afterShipId: 202, afterLv: 30 }],
  ['near', { shipId: 303, lv: 22, afterShipId: 404, afterLv: 30 }],
  ['flip', { shipId: 505, lv: 72, afterShipId: 606, afterLv: 80, reversible: true }],
]) {
  test(`详情下一改造 ${state}：行数据到实体链接，再经全局点击 navigate 到目标形态`, () => {
    const view = setup(fixture)
    assert.equal(view.row.kai.state, state)
    assert.equal(view.row.kai.nextId, fixture.afterShipId)
    assert.equal(view.nodes.length, 2)
    const [current, next] = view.nodes
    assert.equal(current.attributes.class, 'pv-node on')
    assert.equal(current.dataset.etype, undefined)
    assert.equal(next.dataset.etype, 'mstShip')
    assert.equal(next.dataset.eid, String(fixture.afterShipId))
    assert.equal(plainHtml(next.body), view.row.kai.next)
    assert.deepEqual(view.navigations, [])
    view.click(next)
    assert.deepEqual(view.navigations, [{ type: 'mstShip', id: String(fixture.afterShipId), ctx: undefined }])
    assert.deepEqual(view.opened, [{ type: 'mstShip', id: String(fixture.afterShipId), ctx: undefined, num: fixture.afterShipId }])
  })
}

test('详情 ready 下一形态保留绿色边框、字色与原名', () => {
  const { nodes } = setup()
  assert.equal(nodes[1].attributes.style, 'border-color:var(--ok);color:var(--remodel-ready-ink)')
  assert.equal(nodes[1].body, '下一形态 &amp; &lt;改&gt;')
})

test('详情 final 没有下一形态链接，当前形态保持原样', () => {
  const view = setup({ afterShipId: 0, afterLv: 0 })
  assert.equal(view.row.kai.state, 'final')
  assert.equal(view.nodes.length, 1)
  assert.equal(view.nodes[0].attributes.class, 'pv-node on')
  assert.equal(view.nodes[0].dataset.etype, undefined)
  assert.match(view.chain, /无更高改造/)
  view.click(view.nodes[0])
  assert.deepEqual(view.navigations, [])
  assert.deepEqual(view.opened, [])
})
