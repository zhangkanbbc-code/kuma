import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// npm test 里有几条测试在缺对账资料时会优雅跳过（裸测试套件在干净环境也能跑）。
// 这里是它们的**大声兜底**：test:lodes 的契约是「全量对账」，跳过等于没测——
// 所以普通 npm test 允许跳的每一份资料，这个清单都必须点名。
const required = [
  'quests-scn',
  'kcwiki-localization',
  'kcwiki-quest-req',
  'poi-quest-goal',
  'kcwiki-expedition',
  'kcwiki-routing',
  'map-intel', // 掉落反查对账
  'map-enemy-comps', // 敌编成换源后的「37 图逐条带 mstId + 只换编成域」全量核对
  'map-drops', // 掉落换源后的「丢失原有条目 0 + 限定期原样带过来」全量核对
  // 限定期台账是**入仓文件**（第一方手工维护，抓不回来），照理不会缺；
  // 点名它是因为它缺了那条迁移对照会整条跳过——而那条正是「144 条一格不丢」的凭据。
  'map-drop-windows',
  'ship-exp', // 等级经验口径对账
  'poi-fcd-map', // kuma 补充规则的节点边号对账
  'build-recipes', // 建造参考表的真包形状抽查
  'wikiwiki-remodel', // 改造分边真值的锚定抽查
  'wikiwiki-ship-max', // 三维 Lv99 上限基准的锚定抽查
  'equip-upgrades', // 改修表换源后的锚定抽查(更新链/二番舰不要/仲裁钉)
  'wikiwiki-ship-profile', // kcwiki 停收形态的档案补缺锚定抽查
  'kcwiki-fit-bonus', // 装备加成词表的「504 个名字逐个有着落」全量核对
  // ---- 台词域：归属校正的四档分拣与自补层的全量对账 ----
  // 少一份，`voice-attribution` 那几条就整条跳过，而它们正是「1013 行一格不丢」
  // 与「自补层只补空」的凭据。kanso-voice 是入仓文件（第一方译文，抓不回来），
  // 照理不会缺，点名它同样是因为缺了就静静跳过。
  'kcwiki-voice',
  'kcwiki-seasonal-voice',
  'subtitle-ja',
  'subtitle-zh',
  'kcwiki-ships',
  'kanso-voice',
  'wikiwiki-voice', // 审稿单的日文底本（本机有、不随包）
  // 深海行号 → 场合名那张对照表的**唯一独立取证源**（本机有、不随包）。
  // 缺了 abyss-voice-archive 里那条「行号首位就是場合号」的对撞会整条跳过，
  // 而它正是「补名不是猜」的凭据——上游哪天串了档，只有它会当场红。
  'wikiwiki-abyss-voice',
]
const missing = required.filter((id) => (
  !fs.existsSync(path.join(root, 'assets', 'lodes', `${id}.json`))
))
// s2.json 不是矿脉（api_start2 原始样本，住在仓库上一级），
// 但 kanso-quest-rules 的逐条对账离了它会整组跳过
const fixtures = [path.join(root, '..', 's2.json')]
const missingFixtures = fixtures.filter((file) => !fs.existsSync(file))

if (missing.length > 0 || missingFixtures.length > 0) {
  if (missing.length > 0) console.error(`缺少完整矿脉测试资料：${missing.join('、')}`)
  if (missingFixtures.length > 0) {
    console.error(`缺少对账样本：${missingFixtures.join('、')}`)
  }
  console.error('请先在本地准备上述资料；此命令不会联网抓取。')
  process.exit(1)
}

console.log(`完整矿脉测试资料已就绪（${required.length} 包 + ${fixtures.length} 份样本）`)
