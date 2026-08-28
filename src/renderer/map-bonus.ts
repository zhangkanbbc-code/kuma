// 常规图特效舰的那一节 HTML（鉴的海域详情页用）。
//
// 单独一个文件是为了**能对渲染产物下断言**：鉴是一万两千行、顶层就牵 electron 的模块，
// 给它整套 mount 桩不现实；这一节的判据（没数据的图零痕迹、Boss 点标出来、
// 倍率照台账原样两位小数）都必须真跑一遍才验得了写没写反。
// 护栏在 test/normal-map-bonus.test.mjs，走 test/fixtures/render-map-bonus.mjs。
//
// 数据在 shared/normal-map-bonus.ts（第一方台账），那里的文件头写清楚了
// 「只展示、不进任何伤害计算」这条边界——这个文件只管画。
import { esc, mg } from './kernel'
import { elink } from './link'
import { entityNameHtml } from './localization'
import { normalMapBonusOf } from '../shared/normal-map-bonus'
import type { MapBonusSubject } from '../shared/normal-map-bonus'

const nodesHtml = (nodes: readonly string[], bossNodes: readonly string[]): string =>
  nodes
    .map((node) => {
      const boss = bossNodes.includes(node)
      return `<i${boss ? ' class="boss"' : ''} title="${boss ? 'Boss 点' : '道中'}">${esc(node)}</i>`
    })
    .join('')

const subjectHtml = (subject: MapBonusSubject): string =>
  subject.kind === 'stype'
    ? // 鉴是资料视图，舰种名保留可折叠日文原名（同模块内其他实体名的口径）
      entityNameHtml('shipType', subject.stypeId, mg.master.stypes[subject.stypeId] ?? subject.ja, {
        compact: true,
        showOriginal: true,
      })
    : `${esc(subject.zh)}<em>${esc(subject.ja)}</em>`

/** 这张常规图的特效舰一节；台账没收录这张图就返回空串，整节不出。 */
export const mapSpecialBonusHtml = (code: string): string => {
  const entry = normalMapBonusOf(code)
  if (!entry) return ''
  const rows = entry.rows
    .map((row) => {
      const cells = row.cells
        .map(
          (cell) => `<span class="mb-cell">
            <span class="mb-nodes">${nodesHtml(cell.nodes, entry.bossNodes)}</span>
            <b>×${cell.value.toFixed(2)}</b>
          </span>`,
        )
        .join('')
      // 点名到舰的那几行才列舰名；舰种行（7-4）列了等于把整个舰种抄一遍
      const ships =
        row.subject.kind === 'ships'
          ? `<div class="mb-ships">${row.subject.ships
              .map((ship) => elink('mstShip', ship.id, mg.master.ships[ship.id]?.name ?? ship.ja))
              .join('')}</div>`
          : ''
      return `<div class="mb-row">
        <div class="mb-subject">${subjectHtml(row.subject)}</div>
        <div class="mb-cells">${cells}</div>
        ${ships}
      </div>`
    })
    .join('')
  // 一眼位置只放数据本体：谁、在哪几个点、吃多少。
  // Boss 点靠颜色 + 点位自己的 title，不另写图例；出处收进「源」，
  // 玩家会问的那一句收进「口径」。台账里的 evidence / deferred 是维护者字段，不上屏。
  return `<div class="sec map-bonus">
    <div class="sec-h">特效舰<span class="aux">这张图的攻击补正
      <span class="credit-mark" title="${esc(
        `${entry.source} · 页面最后编辑 ${entry.sourceUpdatedAt} · ${entry.checkedAt} 只读核对`,
      )}">源</span>${
        entry.playerNote ? `<span class="credit-mark" title="${esc(entry.playerNote)}">口径</span>` : ''
      }</span></div>
    ${rows}
  </div>`
}
