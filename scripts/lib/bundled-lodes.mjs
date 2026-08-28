// 「哪些矿脉包随发行版分发」的**唯一出处**。
//
// 这份名单有三个消费方：打包过滤（scripts/lib/package-ignore.mjs）、
// .gitignore 的反选块（scripts/sync-bundled-lodes.mjs 生成）、以及护栏测试。
// 手写三份必然漂移——加了一个包只改一处，结果要么仓库里没有、
// 要么产物里多出一个不该有的（那是**许可事故**，不是体积问题）。
//
// 判据只有一条：`scripts/lode-sources.json` 里 `bundle: true`。
// 而 `bundle` 能不能是 true，取决于那一条的 `licenseId` ——
// 只有数据本身所在的源有明确、允许再分发的许可声明（MIT / CC BY-NC-SA 3.0）才行。
// 无声明或明文禁止的一律换源，不留中间路（2026-08-21 用户定稿的发布侧口径）。

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = path.resolve(here, '..', '..')

/** 允许随包的许可。不在这张表里的一律不许翻 bundle。 */
export const REDISTRIBUTABLE_LICENSES = new Set(['MIT', 'CC-BY-NC-SA-3.0'])

/**
 * 第一方自补层：不是抓来的，所以不在 lode-sources.json 里
 *（那份清单会被 fetch-lodes 逐条遍历，塞进没有 url 的条目会炸）。
 * 自补内容是 kuma 自己维护的数据，可入仓可随包。
 *
 * 与 `map-drops` / `ship-stats` 那种「第一方汇编」不是一回事：那几个仍旧是抓来的，
 * 只是汇编与取舍是自己的，所以它们在 lode-sources.json 里有条目、跑 `lodes:fetch` 会重抓。
 * 这张名单里的是**手工维护、抓不回来**的那种——`lodes:fetch` 一行都不该动它们。
 *
 * 头一个住户是 `map-drop-windows`（2026-08-22 批次 4）：常规海域限定期窗口。
 * 那一格穷举过的社区机读源只有一家给，而那家的许可不允许随包分发；
 * 于是事实自己记一份台账（哪张图哪个点从哪天起掉哪条船，是运营行为事实），
 * 抓取脚本降为维护者侧对照工具（scripts/refresh-map-intel-limited.mjs）。
 *
 * 第二个住户是 `kanso-voice`（2026-08-22）：台词自补层。
 * 舰娘百科与 poi-plugin-subtitle 都没收录的形态，中文层整片是空的；
 * 唯一有那些台词的机读源（wikiwiki）无许可声明、不随包，且只有日文。
 * 于是**中文译文由 kuma 自己译**——译文是第一方劳动，与舰娘百科做翻译是同一种姿态。
 * 包里同时带**日文原文列**（2026-08-22 起；此前一版只落中文，同日撤销）：
 * 逐字转写的权利归游戏方，与随包早就有的 `kcwiki-voice.ja`、整份 `subtitle-ja`
 * 同级同灰度，挡住它只会让台词卷变成半张对照表。
 * 它同样抓不回来：`lodes:fetch` 一行都不该动它，逐句订正直接改包文件。
 *
 * **这两个包的 note 归属**：它们不在 lode-sources.json 里，所以两份文案都住在包自己的
 * meta 里——`meta.note` 是玩家可见的（lodeCredit 渲染进「源」悬停，只写一两句人话），
 * `meta.maintainerNote` 是维护者考古（lodeCredit 不读它，玩家看不到）。
 * 改包文件时别把考古写回 note；抓来的包对应的位置是 lode-sources.json 的同名两字段。
 *
 * 第三个住户是 `equip-improve`（2026-08-25）：改修事实表。
 * 改修的消耗、二号舰、开放星期、更新链是**游戏机制的客观事实**——由游戏决定，
 * 不属于任何转录者；攻略站是把这些事实抄下来的人，不是这些事实的来源。
 * 它顶掉的是 `equip-upgrades` 那个自取包：那个包的上游无许可、`bundle: false`，
 * 于是**首发玩家的改修卡整块是「待补」**——一个明明是客观事实的东西，
 * 因为转录者的许可而对玩家消失了。事实表把它接回来：schema 是我们的，
 * 每条带 `basis` 写明置信等级（整理参照／官方公告／游戏内实测），实测到了升级。
 * 它抓不回来：`lodes:fetch` 一行都不该动它，维护直接改包文件
 *（`scripts/build-equip-improve.mjs` 只是当初的合成器，不是日常工序）。
 *
 * 第四个住户是 `equip-aa-evasion`（2026-08-27）：对空射击回避事实表。
 * 同一套法理——哪件机体挨敌方对空射击时吃哪个减免补正，是游戏定的客观事实。
 * 与改修表的差别只在置信度：改修那张能拿官方公告与游戏内实测升级，这张**整表单源待印证**
 * （官方从未公布系数，社区验证而来；转述它的几家攻略站都是同一张表的转录，不算第二票），
 * 所以 basis 一律写「单源待印证」，别因为条目多就以为它硬。
 * 它同样抓不回来：`lodes:fetch` 一行都不该动它，维护直接改包文件
 *（`scripts/build-equip-aa-evasion.mjs` 是当初的合成器，不是日常工序）。
 *
 * 第五个住户是 `event-plane-groups`（2026-08-28）：活动陆航特効分组事实表。
 * 同一套法理——哪架机体属于哪个特効组是策划定的客观事实。它与 `event-bonus`
 * 是**同一域的两半**：倍率（哪张图哪个点 C2 是多少）在 event-bonus 那个自取包里，
 * 分组名单在这里，因为上游把它放在**另一个页面上的另一张表**。
 * 置信度与 aa-evasion 同级但成因不同：名单核过 wikiwiki 与 kcwiki 两家、37/37 一致，
 * **但两家都写明转自同一份社区分类表**——同源转录，不算两票，basis 照此写。
 * 它按期号（`data.event`）与 event-bonus 的 `page=` 对齐，换期对不上就整表不生效。
 */
export const FIRST_PARTY_LODE_IDS = [
  'map-drop-windows',
  'kanso-voice',
  'equip-improve',
  'equip-aa-evasion',
  'event-plane-groups',
]

/**
 * 维护者侧专用、**永不随包**的包。
 *
 * 这些包运行时一行都不读（不在 src/shared/lode-ids 的 CONSUMED_LODES 里），
 * 只在 scripts/ 的对账流水线里用；它们的许可又不允许再分发。
 * 名单在这里显式写出来，而不是「反正不在白名单里就进不去」——
 * 因为「忘了加白名单」和「明知故犯地钉死」是两件事，后者要留得下痕迹。
 */
export const NEVER_BUNDLED_LODE_IDS = [
  'eo-quests',
  'fit-bonus',
  'wikiwiki-ship-max',
  // 2026-08-25 降级：改修数据已换成第一方事实表 `equip-improve`（随包）。
  // 这个包从此**只在维护者侧当对照票**——跑 `scripts/diff-equip-improve.mjs`
  // 看事实表与上游哪一格对不上，供人工复核。运行时一行都不读。
  'equip-upgrades',
]

const readSources = () =>
  JSON.parse(readFileSync(path.join(REPO_ROOT, 'scripts', 'lode-sources.json'), 'utf8'))

/** 随包的矿脉包 id，排序固定（.gitignore 块与产物核对都靠它稳定）。 */
export const bundledLodeIds = (sources = readSources()) => {
  const ids = []
  for (const source of sources) {
    if (source?.bundle !== true) continue
    if (NEVER_BUNDLED_LODE_IDS.includes(source.id)) {
      throw new Error(`${source.id} 在「永不随包」名单里，不许标 bundle: true`)
    }
    if (!REDISTRIBUTABLE_LICENSES.has(source.licenseId)) {
      throw new Error(
        `${source.id} 标了 bundle: true，但 licenseId=${JSON.stringify(source.licenseId)}` +
          ` 不在允许再分发的许可里（${[...REDISTRIBUTABLE_LICENSES].join(' / ')}）`,
      )
    }
    ids.push(source.id)
  }
  return [...ids, ...FIRST_PARTY_LODE_IDS].sort()
}

export const BUNDLED_LODE_IDS = bundledLodeIds()

/** packager 口径的相对路径（POSIX 分隔符、以 / 开头）。 */
export const BUNDLED_LODE_FILES = new Set(
  BUNDLED_LODE_IDS.map((id) => `/assets/lodes/${id}.json`),
)
