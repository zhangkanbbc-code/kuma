import type { MergedQuestPre } from '../shared/quest-pre-merge'

import { esc } from './kernel'

/**
 * 前置口径的双源说明（2026-08-17 对账后加）：两个来源一致时不出声；
 * 有分歧/补缺/悬空修补时挂一枚短标，分歧本身要让人看见，不能静默吞掉。
 * 任务管理器详情与完整任务树窗口共用，两处说法必须一个字都不差。
 *
 * 玩家侧不出现源站名号（kcwiki / wikiwiki / KC3Kai），只留「有分歧、按哪一份判」的
 * 口径；谁是谁的台账在 shared/quest-pre-arbitration.ts 的 basis 里，那是给维护者
 * 对账用的。常驻只挂「⚖ 前置资料有分歧」一枚短标——一眼位置不给对账过程；两份口径
 * 各是什么、按哪份判、失效码怎么处理，全压成一句收进它的悬停。
 */
export const questPreSourceNoteHtml = (info: MergedQuestPre | undefined): string => {
  if (!info) return ''
  const parts: string[] = []
  if (info.source === 'arbitrated') {
    // 三源硬裁决：只说「按哪一份判」；逐条依据留在 basis 台账里不外显
    parts.push('按三方核对后的结论判定')
    if (info.dangling.length) {
      parts.push(`已失效的码 ${info.dangling.join('、')} 按「未同步」处理`)
    }
  } else {
    if (info.source === 'wikiwiki') {
      parts.push('主资料没有这条的前置，采用另一份资料')
    }
    if (info.dangling.length) {
      parts.push(
        info.source === 'merged'
          ? `已失效的码 ${info.dangling.join('、')}，现行链取自另一份资料`
          : `已失效的码 ${info.dangling.join('、')} 按「未同步」处理`,
      )
    }
    if (info.conflict && info.wwPre) {
      parts.push(
        `一份为 ${info.scnPre.join('+') || '无'}，另一份为 ${info.wwPre.join('+') || '无'}${
          info.wwUncertain ? '（后者自标待查证）' : ''
        }，此处按前者判定`,
      )
    }
  }
  if (!parts.length) return ''
  return `<span class="chain-src-note" title="${esc(parts.join(' · '))}">⚖ 前置资料有分歧</span>`
}
