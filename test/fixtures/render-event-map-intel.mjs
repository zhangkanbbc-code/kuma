// 原样编译生产函数，验证实际 HTML；只桩掉图鉴链接与仓库资料等无关依赖。
import fs from 'node:fs'
import vm from 'node:vm'
import { transformSync } from 'esbuild'
import intel from '../../dist/shared/map-intel.js'

const slice = (module, start, end) => {
  const source = fs.readFileSync(new URL(`../../src/renderer/modules/${module}.ts`, import.meta.url), 'utf8')
  const from = source.indexOf(start), to = source.indexOf(end, from)
  if (from < 0 || to < 0) throw new Error(`渲染夹具锚点缺失：${module}`)
  return source.slice(from, to)
}
const compiled = transformSync(
  slice('ji', 'const confirmedDropPoolHtml = (', 'let voiceAudio:') +
  slice('du', 'const rewardCardHtml = (', '// 出击札：') +
  '\nexports.renderEventDropPool = dropPoolHtml; exports.renderEventRewards = rewardCardHtml;', { loader: 'ts' }).code
const context = {
  ...intel, exports: {},
  esc: (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
  chainInstances: () => [], rootOf: new Map(), mapState: {}, expandedMapDrops: new Set(),
  masterShipName: (id) => `舰${id}`, shipThumbHtml: () => '', elink: (_domain, _id, text) => text,
  localDropPoolHtml: () => '', mapKeyOfInfo: (info) => `${info.api_maparea_id}-${info.api_no}`,
  mg: { mapGauges: { 621: { selectedRank: 1 } } }, RANK_NAME: { 1: '丁' }, linkifyRewardText: (text) => text,
}
vm.runInNewContext(compiled, context)
export const { renderEventDropPool, renderEventRewards } = context.exports
