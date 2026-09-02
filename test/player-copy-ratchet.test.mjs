/**
 * 玩家可见文案的**棘轮闸门**。
 *
 * 为什么有这一份（2026-09-01 用户原话）：「这次发现是在很隐蔽的地方，说实话我不可能一个个
 * 盯着看，所以总会漏……保不齐哪天就被玩家抓到不和谐的词句了」。
 * 于是分工定死：**机器守旧判例，人眼立新判例**——凡是他已经当场判过一次的措辞，
 * 从此由这份表挡住，不再靠人复查；没判过的新毛病仍然只能靠人读，机器不替他拍板。
 *
 * 判例出处只有三种，逐条写在表里：
 * - 《文案审计·三把尺子复扫》的 A 级 18 条与**已裁**的 B 级条目（`A9`/`B26` 这类编号）；
 * - 落地那几笔提交：`d4ab018`（A 级 18 条全修 + 空态统一「暂无」+ B 级按裁定收）、
 *   `d245b75`（两条漏网）、`ed03fae`（「问过没有」→「核实过官方没有」）、
 *   `4dfc282`（破折号后面把结论替玩家念一遍，砍掉）、`7444228`（「打不到」→「敌后方」）、
 *   `cca8e77`（「从建造坞领回」→「建造入港」）、`3c58fec`（「夜战转昼」→「拂晓战」）。
 * - 用户带日期的亲笔裁定。
 *
 * 三条纪律：
 * 1. **只收判过的**。审计里「拿不准 / 待裁」而现仓还留着原样的（B3 在场检测、
 *    B18「…的话」、B20 框选说明），一条都不进表——机器不许替用户拍板。
 * 2. **误报宁缺**。每一条上表前都拿现仓全量跑过，除豁免表外必须**零命中**；
 *    拿不准会误伤的一律不进硬表。闸门一旦开始误报，人就会绕过它，那比漏网更贵。
 * 3. **豁免要写理由**。见 `ALLOWLIST`。
 *
 * 与 `core-regressions` 里那条「日式直译词表」（`player-facing copy avoids stiff
 * Japanese calques`）是同族但不同层：那条按整份文件做正则、只管**直译腔词汇**；
 * 这一条走 AST 语料、管**已裁定的句式与措辞**。两条互不覆盖，都留着。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import { collectPlayerCopy, collectStructuralPlayerCopy } from './player-copy-corpus.mjs'

/**
 * 豁免表。每条必须写清「为什么这不是那条判例要禁的东西」。
 * 机制是**先把豁免短语从串里抠掉，再拿词表打**——所以豁免的是短语本身，
 * 不是整条串，同一条串里别的毛病照旧会被抓住。
 */
const ALLOWLIST = [
  {
    phrase: '未缓存的立绘/语音从游戏资源服务器取',
    why:
      '这是设置项的**正式名称**（定义在 yu.ts 的设置卡上，另有六处文案引用它指路）。' +
      'A18 判掉的是拿「未缓存」当空态说法用（bgm-preview「这一首本机又还没存过」→「本机没有这一首」），' +
      '不是禁掉这个开关自己的名字——定稿建议句里就原样带着它。',
  },
]

const scrub = (text) => {
  let out = text
  for (const { phrase } of ALLOWLIST) out = out.split(phrase).join('')
  return out
}

/**
 * 已定稿替换词的旧形。这一层打**全部两层语料**（渲染层 + 主/共享层）：
 * 一词一判，读到就是回潮，在哪一层都一样。
 */
const RETIRED_WORDS = [
  {
    id: '打不到 → 敌后方',
    re: /打不到/,
    verdict: '7444228「对潜空袭战退后空母的标注定稿:「打不到」改「敌后方」」',
    fix: '状态词写「敌后方」',
  },
  {
    id: '灭掉 → 熄灭',
    re: /灭掉/,
    verdict: '审计 B2（图鉴清空确认框「已点亮的格子会全部灭掉」）；d4ab018「「灭掉」随行改「熄灭」」',
    fix: '「已点亮的格子会全部熄灭」',
  },
  {
    id: '随便派',
    re: /随便派/,
    verdict: '审计 A16（ru.ts「这支队随便派」——有人在给你发话许可）；d4ab018 拟人族',
    fix: '「这支队不受限」',
  },
  {
    id: '还没挑人',
    re: /还没挑人/,
    verdict: '审计 B10（ru.ts 沙盘空位「还没挑人」）；d4ab018 按建议收',
    fix: '「尚未选择舰娘」',
  },
  {
    id: '逛 DMM',
    re: /逛\s?DMM/,
    verdict: '审计 A14（index.html 新窗悬停「开一扇浏览窗逛 DMM，可以开好几扇」）；d4ab018 拟人族',
    fix: '「新开浏览窗 · 可多开 · 与游戏共用登录与代理」',
  },
  {
    id: '好几扇',
    re: /好几扇/,
    verdict: '审计 A14 同句（「可以开好几扇」是聊天体，同排三个兄弟悬停都是短标签）',
    fix: '「可多开」',
  },
  {
    id: '从建造坞领回 → 建造入港',
    re: /从建造坞领回/,
    verdict: 'cca8e77「建造出处的措辞定稿:「从建造坞领回」改「建造入港」」',
    fix: '「建造入港」',
  },
  {
    id: '夜战转昼 → 拂晓战',
    re: /夜战转昼/,
    verdict: '3c58fec「夜战转昼改叫拂晓战」',
    fix: '「拂晓战」',
  },
  {
    id: '未缓存（设置项名之外）',
    re: /未缓存/,
    verdict:
      '审计 A18（bgm-preview:46「设置里关掉了…，这一首本机又还没存过，所以放不出来」→「本机没有这一首」）；' +
      '设置项本名已在豁免表里放行',
    fix: '空态说「本机没有」，别说「未缓存」',
  },
  {
    id: '能找谁当',
    re: /能找谁当/,
    verdict:
      '审计 B23（equip-improve 的 meta.note「能找谁当二号舰」把二号舰写成「谁」）；' +
      'd4ab018「矿脉包 note（json 与生成模板两处同改）」',
    fix: '「改修消耗、二号舰、开放曜日与更新链」',
  },
  {
    id: '练半级',
    re: /练半级/,
    verdict: '审计 B22（di/qa 排序规则悬停「按还差的总经验排，练半级也算数；算不出的沉底」）；d4ab018 按建议收',
    fix: '写判据本身：不足一级也计入 / 无值者排末',
  },
  {
    id: '曲线记录中',
    re: /曲线记录中/,
    verdict: '审计 A9（resource-trend-window:102「曲线记录中——还没有足够的记录可画。」）',
    fix: '「记录不足，暂不能画」',
  },
  {
    id: '实际吃到多少',
    re: /实际吃到多少/,
    verdict: '审计 B24（ji.ts 小节标题「你这一艘实际吃到多少」是问句形口语标题）；d4ab018 按建议收',
    fix: '「这一艘的实测加成」',
  },
  {
    id: '还没有来路 / 前方没有记录',
    re: /还没有来路|前方没有记录/,
    verdict: '审计 B25（导航钮 disabled 悬停把导航栈写成一条路）；d4ab018「导航钮 disabled 悬停…按建议收」',
    fix: '「已在最上层」/「已在最下层」',
  },
  {
    id: '09-02 · 口语叙事腔',
    re: /看看|瞧瞧|试试|接着找|接着放|接着输入|选一艘|挑一艘|摆装备|来看看/,
    verdict:
      '用户 2026-09-02 亲裁组合实验室「看看 / 摆装备 / 接着找」同族，并指定「接着放 / 接着输入 / 选一艘」一并清理',
    fix: '改用标签语：查看 / 查找其他 / 继续播放 / 继续输入；去掉替玩家推进的祈使',
  },
  {
    id: '09-02 · 解释腔从句',
    re: /填了[^，。]{0,12}也不|没吃满|多出一条|那一档/,
    verdict: '用户 2026-09-02 亲裁对空 CI 注文「填了…也不… / 没吃满 / 多出一条 / 那一档」同族',
    fix: '只留成立条件、概率与改修项事实，不写操作后的解释性推论',
  },
]

/**
 * 句式类闸门。**只打渲染层语料**（renderer 的 .ts/.html + 矿脉 meta.note）。
 *
 * 为什么不打主/共享层：那两层混着维护者台账散文（`fit-bonus-corrections` 的取票记录、
 * `bgm-heard` 的耳测注、`quest-*-rules` 的裁决注），这些句子本来就是写给维护者读的，
 * 破折号推论、弯引号、口语尾在里面全是合法的。硬打过去只会得到一串误报。
 * 台账字段的剔除见 `player-copy-corpus.mjs` 的 `LEDGER_KEYS`——那层已经挡掉大半，
 * 但挡不干净，所以句式类整体只留在渲染层。玩家文案的落点也确实几乎全在渲染层。
 */
const SENTENCE_SHAPES = [
  {
    id: 'A1/A2/A3-A5 · 拟人：问官方 / 会自己',
    re: /(?<![访询])问过|再问|会自己/,
    verdict:
      '审计 A1（ji「刚问过，官方还是没有」）· A2（yu「点一下会再问一次官方」）· A3–A5（三张档案卡「会自己收进来」）；' +
      'ed03fae 定稿「核实过官方没有 · 点击重新核实」；4dfc282 砍掉「真该记的会自己补回来」；d4ab018 拟人族五路全改',
    fix: '写机制陈述：核实 / 重新核实 / 自动入档',
  },
  {
    id: 'A15/B7 · 口语承诺尾「…就有(了)」',
    re: /就有了?[」』"'）]?$/,
    verdict:
      '审计 A15（equip-stock:719「登录游戏一次就有」，隔壁 :717 就是定稿样板）· B7 三处；' +
      'd4ab018「「就有了」族（B7 裁定，推翻 08-26 旧拟稿）」；d245b75 补上漏网的「进一次游戏就有」',
    fix: '「等待… · 登录一次即可」/「进一次游戏后自动获取」',
  },
  {
    id: 'B1 · 口语感叹「再也…了」',
    re: /再也.{0,8}了/,
    verdict:
      '审计 B1（清空档案确认框三处「清掉就再也收不回来了。」）；' +
      'd4ab018 改用用户亲笔句「…请谨慎清除。」——安全提示可以叮嘱，但不用这种感叹体',
    fix: '「清空后无法恢复，请谨慎清除。」',
  },
  {
    id: 'A7/A8 · 破折号后面替玩家念结论',
    re: /——[^」]*?(?:所以|说明|意味着|只能是|就能|会自己)/,
    verdict:
      '4dfc282 提交标题原话「破折号后面是把结论替玩家念一遍」；' +
      '审计 A7（友军要請横幅）· A8（「这条没能删掉——只有补记行可删」）；d245b75（Bark 密钥那条破折号从句）',
    fix: '破折号后半句删掉，只留事实',
  },
  {
    id: 'A6 · 「不是「X」，是 Y」自辩句',
    re: /不是[「『][^」』\n]{0,14}[」』]，?(?:而)?是/,
    verdict:
      '审计 A6（yu:576「不是「上游没有」，是这次没读出来」）；08-26 族 9 已判「只留 X 或删」；' +
      'd4ab018「「不是 X 是 Y」自辩句…只留事实」',
    fix: '只留事实，别替玩家澄清「别误会」',
  },
  {
    id: 'B11 · 把推论念出来「只能是…了」',
    re: /只能是[^」』\n]{0,12}了/,
    verdict: '审计 B11（qn:1004 悬停「前置都满足却不在任务表里，只能是已经交付了」）；d4ab018「任务判为已交付」',
    fix: '「前置都满足却不在任务表里 · 判为已交付」',
  },
  {
    id: 'B13 · 弯引号',
    re: /[“”]/,
    verdict:
      '审计 B13「附带一处真错：这里用的是弯引号，全仓其余一律用「」」；' +
      'd4ab018「bi.ts:936 的弯引号是真错，随文案一并消除」',
    fix: '一律用「」',
  },
  {
    id: 'A11/A12 · 委婉叙事「已经不在了」',
    re: /已经不在了/,
    verdict:
      '审计 A11（shi:1499）· A12（di:4186）——「已经不在了」像在说人没了；' +
      '同文件 08-26 定稿的说法是「那段记录已清理」；d4ab018 叙事腔族',
    fix: '「这场战斗的记录已清理」',
  },
  {
    id: 'A9/A10/A13 · 「还没…。」整串',
    re: /^还没[^。！？\n]{0,30}。$/,
    verdict:
      '审计 A13（crash-guard:164「这次运行还没有出过错。」，同一件事设置页写的是「本次运行未出错」）' +
      '· A9 · A10（破折号 + 行尾句号 + 「还没」）；d4ab018 叙事腔族',
    fix: '去掉「还没」与行尾句号：「本次运行未出错」',
  },
  {
    id: 'A8 · 「这条没能删掉——」',
    // A8 的原句破折号后面没有推论连接词，上面那条「破折号推论」抓不到它；
    // 这一条把 A8 的原形单钉住，别让它从连接词的缝里溜回来。
    re: /没能删掉/,
    verdict: '审计 A8（shi:1817「这条没能删掉——只有补记行可删」，与 4dfc282 判掉的形状相同）；d4ab018 只留事实',
    fix: '「只有补记行可删」',
  },
  {
    id: 'A13 · 「还没有出过错」',
    re: /还没有出过错/,
    verdict:
      '审计 A13（crash-guard:164「这次运行还没有出过错。」是故事书语气，' +
      '同一件事设置页 yu:1240 写的是「本次运行未出错」）；d4ab018 叙事腔族',
    fix: '「本次运行未出错」',
  },
  {
    id: 'A9 · 「还没有足够…」',
    re: /还没有足够/,
    verdict: '审计 A9（resource-trend-window:102「还没有足够的记录可画。」，同文件 :419 的合格样板写的是「尚无历史记录」）',
    fix: '「记录不足，暂不能画」',
  },
  {
    id: 'A18 · 口语连接「又还没」',
    re: /又还没/,
    verdict: '审计 A18（bgm-preview:46「这一首本机又还没存过，所以放不出来」）',
    fix: '「本机没有这一首」',
  },
  {
    id: 'A1 · 口语惊讶「刚…还是…」',
    re: /刚[一-鿿]{1,6}，?还是/,
    verdict: '审计 A1（ji:11443「刚问过，官方还是没有」——「刚…还是…」的口语惊讶语气）；ed03fae 定稿',
    fix: '「刚核实过 · 官方仍无」',
  },
  {
    id: 'B26 · 空态展示语统一「暂无」',
    // 只打 class 里带 empty 的容器：B26 裁定原话「只动列表/卡片/图表的空状态展示语，
    // 句中用法、悬停层、图例、校验提示与调试门后一律不扫」——这是能从串本身认出
    // 「这是空态展示位」的唯一硬信号，比按「还没」起头去猜窄得多，也就误报得少。
    re: /class="[^"]*empty[^"]*"[^<]*(?:还没|尚无)/,
    verdict:
      '审计 B26（全仓三种写法并存：还没 83 / 尚无 60 / 暂无 15，请裁一个统一词）；' +
      'd4ab018「空态统一「暂无」族（B26 裁定）…还没→暂无 42 条、尚无→暂无 10 条」',
    fix: '空态一律「暂无…」',
  },
  {
    id: 'A17/B5 · UI 自我解说',
    re: /这里就会|就调这里/,
    verdict:
      '审计 A17（yu:944「字太小就调这里」——UI 指着自己说「这里」）· B5（ji:5264「这里就会有图」）；' +
      '08-26 族 7「这里会显示…」整族删',
    fix: '只留机制（「即时生效」），别让 UI 指着自己说「这里」',
  },
  {
    id: 'B8/B9/B12 · 口语祈使',
    re: /再点一下|看一眼|挑一个|就按它算/,
    verdict:
      '审计 B9（ji「深海舰的资料还没就绪，稍后再点一下」）· B12（zi:845「看一眼官方战果填进来」）' +
      '· B8（ji:8606「从「目标点」里挑一个，走向就按它算」）；d4ab018「战果校准指路…按建议收」',
    fix: '「稍后重试」/「抄下…填入」/「在「目标点」中选定，走向按其计算」',
  },
  {
    id: 'B4 · 第一人称标签「我的X」',
    re: /(?:^|[>」』])我的[一-鿿]/,
    verdict:
      '审计 B4（ji 五处「我的遭遇」「我的海域记录」，同一份数据在别处一律叫「你的实测」）；' +
      'd4ab018「第一人称「我的X」五处归中性（与「你的实测」那族并存的「你的」不动）」',
    fix: '去掉人称：「海域记录」（副标已写明来源）',
  },
  {
    id: 'B6 · 叙事完成体标题「终了了 / 活动结束了」',
    re: /终了了|活动结束了/,
    verdict: '审计 B6（ji:1866/1872 掉点分组标题「活动结束了」「限定期终了了」——后者叠了两个「了」）；d4ab018 按建议收',
    fix: '「活动已结束 · …」/「限定期已终了 · …」',
  },
  {
    id: 'B19 · 开发者动作出现在玩家面',
    re: /看调用栈/,
    verdict: '审计 B19（mu:887「重试仍失败就去设置 · 运行诊断打开 crash.log 看调用栈」）；d4ab018 按建议收',
    fix: '「可在「设置 · 运行诊断」查看 crash.log」',
  },
  {
    id: 'B17 · 叮嘱口吻（ntfy 口令）',
    re: /猜得到|别发到/,
    verdict:
      '审计 B17（yu:679「太短别人猜得到」/ yu:1748「别发到公开的地方」）；' +
      'd4ab018「ntfy 安全提示只除猜测腔与口语祈使，步骤与「频道名=口令」信息保留」',
    fix: '保住「频道名 = 口令」这个决策依据，去掉「别人猜得到」「别发到」的叮嘱腔',
  },
  {
    id: 'B21 · 口语定语「买了还没用的」',
    re: /买了还没/,
    verdict: '审计 B21（shi:1075「没有买了还没用的课金道具」，同卡 :1064 的小标正是「已购未用」）；d4ab018 按建议收',
    fix: '「没有已购未用的课金道具」',
  },
  {
    id: 'B22 · 口语「沉底」',
    re: /沉底/,
    verdict: '审计 B22（di:4364 / qa:1123 排序规则悬停「算不出的沉底」）；d4ab018 按建议收',
    fix: '写判据本身：无值者排末',
  },
  {
    id: 'B27 · 建议口吻「想设的话…是个合适的起点」',
    re: /想设的话|是个[一-鿿]{0,4}的起点/,
    verdict: '审计 B27（yu:800 磁盘缓存上限说明）；d4ab018 按建议收',
    fix: '「MB · 留空或 0 = 不限量（默认）；参考值 …」',
  },
]

const offendersIn = (rows, table) => {
  const out = []
  for (const row of rows) {
    const text = scrub(row.text)
    for (const rule of table) {
      if (!rule.re.test(text)) continue
      out.push(
        `[${rule.id}] ${row.file}:${row.line}\n      原句：${row.text.replace(/\n/g, '\\n').slice(0, 160)}\n      判例：${rule.verdict}\n      改法：${rule.fix}`,
      )
    }
  }
  return out
}

const plainText = (text) =>
  text
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(?:nbsp|amp|lt|gt|quot|#\d+);/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const titleTexts = (row) => {
  const out = []
  if (row.properties.includes('title')) out.push(row.text)
  for (const match of row.text.matchAll(/\btitle="([^"]*)"/g)) out.push(match[1])
  return [...new Set(out.map(plainText).filter(Boolean))]
}

const visibleTexts = (row) => {
  const visible = plainText(row.text)
  return visible ? [visible] : []
}

const allTexts = (row) => [...new Set([...visibleTexts(row), ...titleTexts(row)])]

const confirmContext = (row) =>
  row.calls.some((name) => /(?:^|\.)(?:confirm|dialog|message)$/i.test(name)) ||
  row.functions.some((name) => /(?:confirm|dialog|message)/i.test(name))

const pronounSubjectOrPossessive = /(?:^|[>，。；：！？·\s])(?:你的|你|她们?|它们?)(?:的)?(?=[\u4e00-\u9fff])/
const asciiParenAfterCjk = /[\u4e00-\u9fff]\s*\([A-Za-z0-9][^()\r\n]{0,12}\)/
const numericApprox = /(?<![誓条归违契公盟制签预])约\s*(?:[-+]?\d|〔插值〕)|(?:\d|〔插值〕)\s*约(?!翰)/
const futureExpected = (text) =>
  /预计修理/.test(text) ||
  /预计回满/.test(text) ||
  /预计(?:时刻|时间)/.test(text) ||
  /预计\s*〔插值〕/.test(text) ||
  /预计[^，。；\n]{0,24}(?:\d{1,2}:\d{2}|〔插值〕)[^，。；\n]{0,10}(?:后|时|完成|恢复)/.test(text)

const emptyFirstTexts = (row) => {
  const out = []
  const open = /<([a-z][\w-]*)\b[^>]*class="[^"]*(?:empty|placeholder|waiting|loading|pending)[^"]*"[^>]*>/gi
  for (const match of row.text.matchAll(open)) {
    const direct = row.text.slice((match.index ?? 0) + match[0].length).split('<', 1)[0]
    const value = plainText(direct.replace(/〔插值〕/g, ''))
    if (/[\u4e00-\u9fff]/.test(value)) out.push(value)
  }
  if (
    !out.length &&
    !row.text.includes('<') &&
    row.functions.some((name) => /empty|placeholder/i.test(name))
  ) {
    out.push(...visibleTexts(row))
  }
  return out
}

const STRUCTURAL_RULES = [
  {
    id: '① 面板人称主语/定语',
    check: (row) => !confirmContext(row) && allTexts(row).some((text) => pronounSubjectOrPossessive.test(text)),
    sample: { text: '你的实测', properties: [], calls: [], functions: [] },
  },
  {
    id: '② 空态/等待节点状态词',
    check: (row) => {
      const firstTexts = emptyFirstTexts(row)
      return firstTexts.some(
        (first) =>
          !/(?:^|^.{1,8})(?:暂无|尚未|暂未)/.test(first) &&
          !/^(?:正在|[^·，。；：\n]{1,18}(?:中|失败|未出错)(?:\s|·|（|$))/.test(first) &&
          !/^(?:输入|点击|单击|打开|选择)/.test(first) &&
          !/^(?:S 胜空手|◇ 存在空掉落|空位|未装备|无装备)/.test(first),
      )
    },
    sample: {
      text: '<div class="audit-empty">等待同步</div>',
      properties: [],
      calls: [],
      functions: [],
    },
  },
  {
    id: '③ 非确认框句末句号',
    check: (row) => !confirmContext(row) && allTexts(row).some((text) => text.endsWith('。')),
    sample: { text: '短标签。', properties: [], calls: [], functions: [] },
  },
  {
    id: '④ 数值/概率限定词',
    check: (row) =>
      !confirmContext(row) &&
      allTexts(row).some(
        (text) =>
          /保守|约莫|大概|近似|暂估/.test(text) ||
          (/预计/.test(text) && !futureExpected(text)),
      ),
    sample: { text: '当前概率大概 50%', properties: [], calls: [], functions: [] },
  },
  {
    id: '⑥ 数字/插值紧邻「约」',
    check: (row) =>
      allTexts(row).some((text) => numericApprox.test(text) && !/(?:估算|推定)/.test(text)),
    sample: { text: '概率约 50%', properties: [], calls: [], functions: [] },
  },
  {
    id: '⑦ 动作提示保证式',
    check: (row) => allTexts(row).some((text) => /(?:即可|就会恢复)$|就会恢复/.test(text)),
    sample: { text: '打开任务页即可', properties: [], calls: [], functions: [] },
  },
  {
    id: '⑧ title 人称主语/定语',
    check: (row) => !confirmContext(row) && titleTexts(row).some((text) => pronounSubjectOrPossessive.test(text)),
    sample: {
      text: '<span title="她不会被击沉">状态</span>',
      properties: [],
      calls: [],
      functions: [],
    },
  },
  {
    id: '⑨ 游戏自报/自述',
    check: (row) => allTexts(row).some((text) => /游戏自报|游戏自述/.test(text)),
    sample: { text: '游戏自报进度', properties: [], calls: [], functions: [] },
  },
  {
    id: '⑩ 可见中文后短 ASCII 括号',
    check: (row) => allTexts(row).some((text) => asciiParenAfterCjk.test(text)),
    sample: { text: '关闭 (Esc)', properties: [], calls: [], functions: [] },
  },
  {
    id: '⑪ 推断/反推',
    check: (row) => allTexts(row).some((text) => /推断|反推/.test(text)),
    sample: { text: '由后续任务反推', properties: [], calls: [], functions: [] },
  },
  {
    id: '⑫ 口语动作收尾',
    check: (row) => allTexts(row).some((text) => /(?:就成了|即可|就行)$/.test(text)),
    sample: { text: '完成就成了', properties: [], calls: [], functions: [] },
  },
]

const STRUCTURAL_CASEBOOK = {
  '①': ['用户 2026-09-02 施工单：面板串人称代词主语/定语为红线', '改用本地、本舰、当前或该'],
  '②': ['用户 2026-09-02 施工单：空态/等待节点首文本必须是状态词', '以暂无、尚未、…中或…失败起头'],
  '③': ['用户 2026-09-02 施工单：非确认框玩家串禁止句末句号', '删除标签、空态、通知标题与悬停末尾句号'],
  '④': ['用户 2026-09-02 施工单：数值与概率限定词分预计/估算/推定', '未来时刻用预计，当前判断用估算，资料结论用推定'],
  '⑤': ['用户 2026-09-02 施工单：rule.correction 进 title 禁维护过程叙事', '只写按 wikiwiki 值或按本地实测值等结果句'],
  '⑥': ['用户 2026-09-02 施工单：数字或插值紧邻“约”为红线', '数值判断改用估算，资料结论改用推定'],
  '⑦': ['用户 2026-09-02 施工单：动作提示禁“即可”收尾与“就会恢复”保证', '改成短祈使或失败 · 下一步动作'],
  '⑧': ['用户 2026-09-02 施工单：title/悬停里她、它作主语定语为红线', '改用本舰、当前或该对象'],
  '⑨': ['用户 2026-09-02 施工单：游戏自报/自述统一退役', '改用游戏显示、返回值或条件原文'],
  '⑩': ['用户 2026-09-02 施工单：可见中文后的短 ASCII 括号为红线', '改用全角括号；代码、公式、URL 与快捷键组合除外'],
  '⑪': ['用户 2026-09-02 施工单：玩家串与属性标题禁推断/反推', '改用推定或无法推定'],
  '⑫': ['用户 2026-09-02 施工单：就成了/即可/就行收尾为红线', '删除口语保证尾，保留动作或状态'],
}

const STRUCTURAL_ALLOWLIST = [
  {
    rule: '②',
    file: 'src/renderer/modules/ji.ts',
    phrase: '仅有拆解、素材消耗或击沉记录',
    why: 'mem-empty 在这里承载的是“仍有离库记录”的摘要，不是空集合或等待态',
  },
  {
    rule: '②',
    file: 'src/renderer/modules/yu.ts',
    phrase: '上游无表',
    why: 'yl-empty 是矿脉覆盖矩阵的分类徽记，前置插值是海域清单，不是空态文案',
  },
  {
    rule: '③',
    file: 'src/renderer/modules/mgstate.ts',
    phrase: 'KANSO_DEBUG_UI',
    why: '两条均为审计 C 级调试模拟说明，本单明确要求 C 不动',
  },
]

const structuralAllowed = (row, rule) =>
  STRUCTURAL_ALLOWLIST.some(
    (entry) =>
      rule.id.startsWith(entry.rule) &&
      row.file === entry.file &&
      row.text.includes(entry.phrase),
  )

const structuralOffenders = (rows, rule) =>
  rows
    .filter((row) => rule.check(row) && !structuralAllowed(row, rule))
    .map((row) => `[${rule.id}] ${row.file}:${row.line} ${plainText(row.text).slice(0, 140)}`)

const fitCorrectionNarrativeOffenders = () => {
  const file = new URL('../src/shared/fit-bonus-corrections.ts', import.meta.url)
  const source = fs.readFileSync(file, 'utf8')
  const notes = [...source.matchAll(/^\s+note:\s*'([^'\r\n]*)',/gm)]
  assert.equal(notes.length, 73, `第一方修正 UI 说明应为 73 条，实际 ${notes.length}`)
  assert.match(
    fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8'),
    /rule\.correction \? ` · <em title="\$\{esc\(rule\.correction\)\}">第一方修正<\/em>`/,
    'rule.correction 进 title 的显示路径断了',
  )
  return notes
    .filter((match) => /按[^，。；\n]{0,24}(?:补|退回|归位|改回)/.test(match[1]))
    .map((match) => `[⑤ correction 处理叙事] src/shared/fit-bonus-corrections.ts:${source.slice(0, match.index).split('\n').length} ${match[1]}`)
}

test('玩家文案语料提取器没有静默塌掉', () => {
  const { tierA, tierB } = collectPlayerCopy()
  // 提取器要是哪天被改坏、返回空数组，下面两条闸门会「全绿」——那是最坏的失败形态。
  // 所以先钉住规模与几条正样本（数值是 2026-09-01 实测 tierA 5891 / tierB 3858 的下限留量）。
  assert.ok(tierA.length > 5000, `渲染层语料只剩 ${tierA.length} 条，提取器多半坏了`)
  assert.ok(tierB.length > 3000, `主/共享层语料只剩 ${tierB.length} 条，提取器多半坏了`)
  assert.ok(new Set(tierA.map((r) => r.file)).size > 80)
  assert.ok(new Set(tierB.map((r) => r.file)).size > 90)
  assert.ok(
    tierA.some((r) => r.layer === 'html' && r.text.includes('新开浏览窗')),
    'index.html 的顶栏悬停没被收进来：html 那一路断了',
  )
  assert.ok(
    tierA.some((r) => r.file.endsWith('modules/di.ts') && r.text.includes('敌后方')),
    '渲染层 .ts 那一路断了',
  )
  // 注释必须收不进来：这是整套提取器的地基（按行 grep 会把维护者注释当文案）。
  assert.ok(
    !tierB.some((r) => r.text.includes('那个读数就再也拿不回来了')),
    'ledger.ts 的 SQL 行注释混进了语料，注释剔除失效',
  )
})

test('玩家可见文案的棘轮闸门：已定稿替换词不许回潮', () => {
  const { tierA, tierB } = collectPlayerCopy()
  const offenders = offendersIn([...tierA, ...tierB], RETIRED_WORDS)
  assert.deepEqual(offenders, [], `\n${offenders.join('\n')}\n`)
})

test('玩家可见文案的棘轮闸门：已裁定的句式不许回潮', () => {
  const { tierA } = collectPlayerCopy()
  const offenders = offendersIn(tierA, SENTENCE_SHAPES)
  assert.deepEqual(offenders, [], `\n${offenders.join('\n')}\n`)
})

test('玩家可见文案的结构棘轮：09-02 全量审计判例不许回潮', () => {
  const { tierA, tierB } = collectStructuralPlayerCopy()
  const all = []
  for (const rule of STRUCTURAL_RULES) {
    const deliveryRows =
      rule.id.startsWith('④') || rule.id.startsWith('⑥')
        ? tierB.filter((row) => row.file === 'src/shared/ship-stat-layers.ts')
        : rule.id.startsWith('⑦') || rule.id.startsWith('⑫')
          ? tierB.filter((row) => row.file === 'src/shared/qp-types.ts')
          : []
    const offenders = structuralOffenders([...tierA, ...deliveryRows], rule)
    console.log(`[棘轮] ${rule.id}：现语料命中 ${offenders.length}`)
    all.push(...offenders)
  }
  const correctionOffenders = fitCorrectionNarrativeOffenders()
  console.log(`[棘轮] ⑤ correction 处理叙事：现语料命中 ${correctionOffenders.length}`)
  all.push(...correctionOffenders)
  assert.deepEqual(all, [], `\n${all.join('\n')}\n`)
})

test('结构棘轮反向判例：每条红线放回旧句都会命中', () => {
  for (const rule of STRUCTURAL_RULES) {
    assert.equal(rule.check(rule.sample), true, `${rule.id} 没抓住反向旧句`)
  }
  const oldCorrection = '火力按日文原表补 1'
  assert.match(oldCorrection, /按[^，。；\n]{0,24}(?:补|退回|归位|改回)/)
})

test('玩家文案观察名单：只列 file:line，不阻断提交', () => {
  const { tierA } = collectStructuralPlayerCopy()
  const rows = tierA
  const watch = [
    {
      id: '去标签后长度 ≥14 且含全角逗号',
      hit: (row) => visibleTexts(row).some((text) => text.length >= 14 && text.includes('，')),
    },
    {
      id: '括号内 ≥6 字',
      hit: (row) =>
        allTexts(row).some((text) =>
          /（[^）\r\n]{6,}）/.test(text),
        ),
    },
    {
      id: '破折号后判断/劝告从句',
      hit: (row) =>
        allTexts(row).some((text) =>
          /——[^。！？\n]*(?:所以|说明|意味着|建议|应该|需要|不要|只能|可以|可)/.test(text),
        ),
    },
    {
      id: '同一串含两步以上操作',
      hit: (row) =>
        allTexts(row).some(
          (text) =>
            (text.match(/点击|单击|打开|选择|输入|填写|复制|返回|切换|清除|重试|领取/g) ?? [])
              .length >= 2,
        ),
    },
    {
      id: '确认上屏 title/悬停末尾句号',
      hit: (row) => titleTexts(row).some((text) => text.endsWith('。')),
    },
  ]
  for (const rule of watch) {
    const refs = [
      ...new Set(
        rows
          .filter(rule.hit)
          .map((row) => `${row.file}:${row.line}`),
      ),
    ]
    console.log(`[观察] ${rule.id}：${refs.length}`)
    for (const ref of refs) console.log(`[观察] ${ref}`)
  }
})

test('棘轮词表本身是可读的判例账：每条都写了判例与改法', () => {
  for (const rule of [...RETIRED_WORDS, ...SENTENCE_SHAPES]) {
    assert.ok(rule.id && rule.re instanceof RegExp, `词表条目缺 id 或正则：${rule.id}`)
    // 「每条注：裁定日期+判例出处」——判例栏必须点到审计编号、提交号或用户亲裁日期，
    // 否则这条就是凭感觉加的，下一个人无从复核。
    assert.match(
      rule.verdict,
      /审计 [AB]\d|[0-9a-f]{7}|用户 20\d{2}-\d{2}-\d{2}/,
      `「${rule.id}」的判例栏没写审计编号、提交号或用户亲裁日期：${rule.verdict}`,
    )
    assert.ok(rule.fix && rule.fix.length > 2, `「${rule.id}」没写改法`)
  }
  for (const entry of ALLOWLIST) {
    assert.ok(entry.phrase && entry.why.length > 20, `豁免「${entry.phrase}」没写足理由`)
  }
  assert.deepEqual(
    Object.keys(STRUCTURAL_CASEBOOK),
    ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫'],
    '09-02 结构判例账不完整',
  )
  for (const [id, [verdict, fix]] of Object.entries(STRUCTURAL_CASEBOOK)) {
    assert.match(verdict, /用户 2026-09-02/, `${id} 缺少带日期的裁定出处`)
    assert.ok(fix.length > 8, `${id} 缺少可执行改法`)
  }
  for (const entry of STRUCTURAL_ALLOWLIST) {
    assert.ok(entry.rule && entry.file && entry.phrase && entry.why.length > 20, '结构豁免缺少范围或理由')
  }
})

/*
 * ── 观察名单（**故意没进硬表**，别照抄进去）──────────────────────────
 *
 * 下面这些形状 2026-09-01 建表时逐条跑过现仓，都因为「现仓还留着活的用例」或
 * 「审计里只列为待裁、用户没拍过板」而落选。留在这里是为了下一次审计不必重推一遍；
 * 哪天用户真判了某一条，把它连同裁定出处一起搬进上面的表。
 *
 * - `多半是`（现仓 2 处）：yu:499 / yu:1271「不见了多半是文件损坏，重装一次即可」——
 *   这是审计 B16 亲自挑中的**定稿写法**，不是毛病。别拿它当推测腔的指纹。
 * - `…的话`（现仓 1 处）：zi:856「本月在别的设备打过的话」。审计 B18 只列为待裁；
 *   同族的 index.ts:181 已在 d4ab018 改掉，这一处没跟上——是漏网还是有意，用户没说。
 * - `把鼠标移到`（现仓 1 处）：resource-trend-window:299 的框选说明。审计 B20 待裁，
 *   理由是「框选这个交互没有别的可发现性入口，删掉可能真丢功能」。
 * - `你还在`（现仓 1 处）：yu:748「你还在动键鼠时先不推」。审计 B3 待裁，
 *   问的是「条件标签」与「运行时状态播报」要不要拆开处理。
 * - `^尚无…`（现仓 3 处）：ji:9186 / shi:385「尚无本地战斗记录」、mgstate:40。
 *   B26 只裁了**空态展示位**统一「暂无」，这三处不在那个位上。
 * - `^还没…`（现仓 9 处）：ji / qn / ru / sally-tag 与 push-config 的校验提示。
 *   B26 裁定原话明确排除「句中用法、悬停层、图例、校验提示」，所以只钉了
 *   `class=…empty…` 容器里的那一种。
 * - 单独一个 `——`（现仓 6 处）：两处是装饰分隔（`—— 初段改造 ——`）、两处在诊断卡、
 *   一处在调试模块、一处是 qn:1711 的「…除外——旗舰同时计入它所属的那一类」。
 *   最后那条形状上正是 A7，但没被判过；要收就得先给前五处写豁免。
 * - 句末语气词（`吧/呢/啊/呀/嘛` 收尾，现仓 0 处）：三把尺子的尺 1 点过名，
 *   但审计报告里没有对应条目——按「每条能从报告找到判例的才进表」的规矩落选。
 * - 短标签的行尾句号（现仓 18 处）：里面混着 B1 定稿的「…请谨慎清除。」，
 *   一律拦会把用户亲笔句也拦掉。
 */
