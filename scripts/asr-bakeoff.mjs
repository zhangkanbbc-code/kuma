// 三方案对比试验：转写这件事该怎么做。
//
// **一次性的选型试验，不是管线本身。** 留在仓库里是因为「为什么默认档是它」
// 这个问题，日后一定会有人再问一遍；重跑一次比翻聊天记录快。
//
// ---- 要回答的问题 ----
// fun-asr 这类纯 ASR 是「不思考」的直接转译：实测它假名骨架满分，
// 倒在**需要知识的选字**（水上機母艦→水上規模感、秋津洲→秋篠、大艇→大抵）。
// 那么把「会思考」的模型接进来，是不是更好？
//
// ---- 三个方案（外加 C 的两种配置）----
//  A 纯 ASR 两遍法：fun-asr 裸跑 → 从主数据词表按相似度挑候选 → 带偏置重转
//  B 耳朵+脑子：fun-asr 单遍出稿 → 思考型文本模型拿非循环上下文做知识校字
//  C1 qwen3-asr 一体：单次调用，上下文只给身份词
//  C2 qwen3-asr 一体：单次调用，上下文给身份词 + 全量装备词表
//
// ---- 非循环纪律（这一条决定试验有没有意义）----
// 任何方案的上下文都**不许含待验句原文**。拿所称日文去偏置、再回头跟它算相似度，
// 是让模型照着答案抄一遍：分数必然虚高，而对账的全部意义就是让分歧显形。
// 允许进上下文的只有两类：
//  ① **身份事实**——舰名 / 读み / 舰种 / 场合。它们是从 pathname 反解出来的，
//     与待验文本无关（判据见 lib/asr-archive.mjs 的文件头）。
//  ② **全量主数据词表**——`api_mst_slotitem` 的 741 个装备名**整张表**照搬。
//     整张表照搬这一点是关键：一旦开始「挑几个相关的」，挑的动作本身就用到了
//     待验文本的知识，循环就从后门溜回来了。
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadArchiveRows } from './lib/asr-archive.mjs'
import { PRICE_PER_SECOND, requireApiKey, transcribeWithRetry } from './lib/asr-client.mjs'
import { foldForCompare, similarityOf } from './lib/asr-normalize.mjs'
import { loadStart2MasterArray } from './lib/start2.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CHAT_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'

const ASR_MODEL = 'fun-asr-flash-2026-06-15'
const ASR_CTX_MODEL = 'qwen3-asr-flash'
/**
 * 便宜的思考档。
 *
 * ⚠️ 这个账号开着「仅用免费额度」，2026-08-23 实测**绝大多数文本模型的免费额度已耗尽**
 * （qwen-turbo / qwen-plus / qwen-flash / qwen3-max / qwen3.5-flash / deepseek-v3 /
 * kimi-k2.6 / qwen3-32b 一律 403 AllocationQuota.FreeTierOnly）。
 * 还能调的只有 `qwen3.7-flash` 与 `glm-5.2` 两个——ASR 那几个模型不受影响。
 * 换模型前先跑一遍探活，别默认清单里列出来的就能用。
 *
 * `enable_thinking` 这个顶层参数它不收（invalid_request_error），推理是模型内部的事。
 */
const THINK_MODEL = 'qwen3.7-flash'

/** 试验样本：5 条，覆盖不同舰 / 不同场合 / 不同专名密度。 */
const SAMPLE = [
  { pick: '445:1', why: '基准条；水上機母艦 / 秋津洲 / 大艇 三个专名叠在一句' },
  { pick: '94:1', why: '专名密度最高；綾波型駆逐艦 + 漣 + 自报读音さざなみ' },
  { pick: '392:23', why: '拉丁字母与法语；Richelieu / Merci / mon amiral' },
  { pick: '158:7', why: '军语缩写；三水戦（第三水雷戦隊）' },
  { pick: '537:26', why: '对照组；整句无专名，只有省略号与停顿' },
]

const chat = async (model, messages, extra = {}) => {
  const key = requireApiKey()
  const response = await fetch(CHAT_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, ...extra }),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`)
  const json = JSON.parse(text)
  if (json?.error) throw new Error(`${json.error.message ?? ''}`)
  return {
    text: `${json?.choices?.[0]?.message?.content ?? ''}`.trim(),
    usage: json?.usage ?? {},
  }
}

/** 身份事实（非循环：全部来自 pathname 反解 + 主数据）。 */
const factsOf = (row, ships, stypes) => {
  const self = ships.find((s) => Number(s?.api_id) === row.mstId)
  const stype = stypes.find((s) => Number(s?.api_id) === Number(self?.api_stype))
  return {
    name: `${self?.api_name ?? ''}`,
    yomi: `${self?.api_yomi ?? ''}`,
    stype: `${stype?.api_name ?? ''}`,
    scene: row.scene,
  }
}

const identityTerms = (facts) => [facts.name, facts.yomi, facts.stype].filter(Boolean)

/**
 * A 的候选挑选：拿裸转写去撞全量装备词表，按**字面**相似度取前 N。
 *
 * ⚠️ 这里做不到「按读音近似」——本仓库没有汉字→読み的引擎，
 * 而主数据只给了**舰名**的 api_yomi，装备名没有读音字段。
 * 于是同音异字这一类（大抵 ↔ 二式大艇 字面相似度只有 0.25）本来就撞不上，
 * 这正是 A 的结构性上限，试验要量的就是它。
 */
const pickCandidates = (draft, vocabulary, limit = 8) => {
  const scored = []
  for (const term of vocabulary) {
    if (term.length < 3) continue
    let best = 0
    for (let width = Math.max(1, term.length - 1); width <= term.length + 1; width++) {
      for (let start = 0; start + width <= draft.length; start++) {
        const score = similarityOf(draft.slice(start, start + width), term)
        if (score > best) best = score
      }
    }
    if (best >= 0.34) scored.push({ term, score: best })
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.term)
}

/** B 的校字提示。只修同音/近音错字，不改句构、不加词。 */
const correctionPrompt = (draft, facts, vocabulary) => [
  {
    role: 'system',
    content:
      '你是《舰队Collection》日文语音转写的校字员。输入是一段 ASR 转写稿：' +
      '它的**假名骨架可信**，错误集中在需要背景知识的**汉字选字**（同音/近音写错）。\n' +
      '规则（务必严格遵守）：\n' +
      '1. 只修同音或近音的错字，**不得改动句子结构、不得增删词语、不得补全省略**。\n' +
      '2. 保持原有的假名/汉字混写风格与标点，不要「润色」。\n' +
      '3. 拿不准的地方**保持原样**，不要猜。\n' +
      '4. 只输出校对后的日文文本本身，不要解释、不要引号、不要任何前后缀。',
  },
  {
    role: 'user',
    content:
      `这一句的说话人：${facts.name}（读作 ${facts.yomi}，舰种 ${facts.stype}）\n` +
      `场合：${facts.scene}\n\n` +
      `游戏内装备名词表（供识别专名，未必出现在本句中）：\n${vocabulary.join('、')}\n\n` +
      `ASR 转写稿：\n${draft}`,
  },
]

const main = async () => {
  const rows = loadArchiveRows({ root: ROOT })
  const ships = loadStart2MasterArray('api_mst_ship', ROOT)
  const stypes = loadStart2MasterArray('api_mst_stype', ROOT)
  const vocabulary = [
    ...new Set(loadStart2MasterArray('api_mst_slotitem', ROOT).map((i) => `${i?.api_name ?? ''}`)),
  ].filter(Boolean)

  const picked = []
  for (const { pick, why } of SAMPLE) {
    const [mst, slot] = pick.split(':')
    const row = rows.find(
      (r) => String(r.mstId) === mst && String(r.slot) === slot && r.file && r.claimedJa,
    )
    if (!row) throw new Error(`样本 ${pick} 找不到（没实物或没所称文本）`)
    picked.push({ ...row, why })
  }

  console.log(`样本 ${picked.length} 条，装备词表 ${vocabulary.length} 个词`)
  console.log(`ASR=${ASR_MODEL} / ${ASR_CTX_MODEL}，思考档=${THINK_MODEL}\n`)

  const RUNS = 2 // 跑两遍量确定性
  const results = []
  let asrSeconds = 0
  let promptTokens = 0
  let completionTokens = 0

  for (const row of picked) {
    const facts = factsOf(row, ships, stypes)
    const ident = identityTerms(facts)
    const record = { row, facts, arms: {} }

    for (let run = 1; run <= RUNS; run++) {
      // ---- 裸跑（A/B 共用的第一遍）----
      const bare = await transcribeWithRetry(row.file, { model: ASR_MODEL, biasTerms: [] })
      asrSeconds += bare.seconds || Math.ceil(row.bytes / 7000)

      // ---- A：候选挑选 → 带偏置重转 ----
      const candidates = pickCandidates(bare.text, vocabulary)
      const second = await transcribeWithRetry(row.file, {
        model: ASR_CTX_MODEL,
        biasTerms: [...ident, ...candidates],
      })
      asrSeconds += second.seconds || 0

      // ---- B：思考档校字 ----
      let corrected = ''
      try {
        const out = await chat(THINK_MODEL, correctionPrompt(bare.text, facts, vocabulary), {
          temperature: 0,
        })
        corrected = out.text
        promptTokens += Number(out.usage?.prompt_tokens) || 0
        completionTokens += Number(out.usage?.completion_tokens) || 0
      } catch (error) {
        corrected = `【校字失败】${error?.message ?? error}`
      }

      // ---- C1 / C2：一体单次 ----
      const c1 = await transcribeWithRetry(row.file, { model: ASR_CTX_MODEL, biasTerms: ident })
      asrSeconds += c1.seconds || 0
      const c2 = await transcribeWithRetry(row.file, {
        model: ASR_CTX_MODEL,
        biasTerms: [...ident, ...vocabulary],
      })
      asrSeconds += c2.seconds || 0

      const push = (arm, text, extra = {}) => {
        record.arms[arm] ??= []
        record.arms[arm].push({ text, score: Number(similarityOf(text, row.claimedJa).toFixed(3)), ...extra })
      }
      push('bare', bare.text)
      push('A', second.text, { candidates })
      push('B', corrected)
      push('C1', c1.text)
      push('C2', c2.text)
    }
    results.push(record)

    console.log(`── ${row.mstId} ${row.shipName} 槽${row.slot} ${row.scene}（${row.why}）`)
    console.log(`   原文 : ${row.claimedJa}`)
    for (const arm of ['bare', 'A', 'B', 'C1', 'C2']) {
      const runs = record.arms[arm]
      const stable = runs.every((r) => r.text === runs[0].text)
      console.log(`   ${arm.padEnd(4)} ${runs[0].score.toFixed(3)} ${stable ? '稳定' : '★不稳'} ${runs[0].text}`)
    }
    console.log('')
  }

  // ---- 汇总 ----
  const mean = (arm) =>
    results.reduce((sum, r) => sum + r.arms[arm][0].score, 0) / results.length
  const exact = (arm) =>
    results.filter((r) => foldForCompare(r.arms[arm][0].text) === foldForCompare(r.row.claimedJa)).length
  const stableCount = (arm) =>
    results.filter((r) => r.arms[arm].every((x) => x.text === r.arms[arm][0].text)).length

  const asrCost = asrSeconds * PRICE_PER_SECOND
  // qwen3.5-flash 按 flash 档估：入 ¥0.0003/1K，出 ¥0.0006/1K（价目表 qwen-turbo 档）
  const textCost = (promptTokens / 1000) * 0.0003 + (completionTokens / 1000) * 0.0006

  console.log('=== 汇总（5 条样本，每条跑 2 遍）===')
  console.log('方案   平均相似度  逐字全中  确定性   说明')
  const label = {
    bare: 'fun-asr 裸跑（对照）',
    A: '两遍法：候选偏置重转',
    B: 'fun-asr + 思考档校字',
    C1: 'qwen3-asr 一体（身份词）',
    C2: 'qwen3-asr 一体（身份词+全词表）',
  }
  for (const arm of ['bare', 'A', 'B', 'C1', 'C2']) {
    console.log(
      `${arm.padEnd(5)}  ${mean(arm).toFixed(3)}       ${exact(arm)}/${results.length}      ` +
        `${stableCount(arm)}/${results.length}     ${label[arm]}`,
    )
  }
  console.log(`\nASR 计费 ${asrSeconds} 秒 = ¥${asrCost.toFixed(5)}`)
  console.log(`文本档 ${promptTokens} 入 / ${completionTokens} 出 tokens ≈ ¥${textCost.toFixed(5)}`)
  console.log(`合计 ≈ ¥${(asrCost + textCost).toFixed(5)}`)

  const outDir = path.join(ROOT, 'assets', 'review')
  mkdirSync(outDir, { recursive: true })
  writeFileSync(
    path.join(outDir, 'asr-bakeoff.json'),
    JSON.stringify(
      {
        meta: {
          note: '三方案选型试验。上下文一律不含待验句原文（非循环纪律）。',
          asrModel: ASR_MODEL, asrCtxModel: ASR_CTX_MODEL, thinkModel: THINK_MODEL,
          runs: RUNS, vocabularySize: vocabulary.length,
          asrSeconds, promptTokens, completionTokens,
          costCny: Number((asrCost + textCost).toFixed(5)),
          summary: Object.fromEntries(
            ['bare', 'A', 'B', 'C1', 'C2'].map((arm) => [
              arm,
              { mean: Number(mean(arm).toFixed(3)), exact: exact(arm), stable: stableCount(arm) },
            ]),
          ),
        },
        rows: results.map((r) => ({
          mstId: r.row.mstId, ship: r.row.shipName, slot: r.row.slot, scene: r.row.scene,
          why: r.row.why, claimedJa: r.row.claimedJa, facts: r.facts, arms: r.arms,
        })),
      },
      null,
      2,
    ),
    'utf8',
  )
  console.log('\n明细：assets/review/asr-bakeoff.json')
}

main().catch((error) => {
  console.error('[bakeoff] 失败:', error?.message ?? error)
  process.exitCode = 1
})
