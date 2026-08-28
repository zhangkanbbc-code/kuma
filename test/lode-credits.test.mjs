// 署名护栏：随包名单 ↔ 钥的「资料来源与许可」分源表 ↔ NOTICE.md，三者必须对得上。
//
// 加了一个包却忘了署名，是**许可事故**——而它不会报错，只会安静地少一行。
// 所以这一组断言全部是**数据级比对**（真名单 × 真 NOTICE 正文），
// 不去正则匹配源码里有没有写那句话：那种守卫判断写反了也照样绿
//（shared/source-pattern-guards-miss-logic-bugs）。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import credits from '../dist/shared/lode-credits.js'
import { BUNDLED_LODE_IDS, FIRST_PARTY_LODE_IDS } from '../scripts/lib/bundled-lodes.mjs'

const { LODE_CREDIT_SOURCES, LODE_CREDIT_INTRO, LODE_CREDIT_SHARE_ALIKE } = credits
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const notice = fs.readFileSync(path.join(root, 'NOTICE.md'), 'utf8')

/** 页面上会被玩家读到的全部文案（护栏对它整体成立，别漏掉折叠层） */
const playerCopy = [
  LODE_CREDIT_INTRO.lead,
  LODE_CREDIT_INTRO.licenseNote,
  LODE_CREDIT_INTRO.emphasis,
  LODE_CREDIT_SHARE_ALIKE,
  ...LODE_CREDIT_SOURCES.flatMap((s) => [s.name, s.license, s.provides, s.detail]),
].join('\n')

test('随包的每个包都能在分源表里找到归属，分源表也不许指向没随包的东西', () => {
  const claimed = new Map()
  for (const source of LODE_CREDIT_SOURCES) {
    for (const id of source.lodeIds) {
      claimed.set(id, [...(claimed.get(id) ?? []), source.key])
    }
  }
  for (const id of BUNDLED_LODE_IDS) {
    assert.ok(
      claimed.has(id),
      `${id} 随包分发，却没有在钥的「资料来源与许可」里归到任何一组——署名漏了一条`,
    )
  }
  for (const id of claimed.keys()) {
    assert.ok(
      BUNDLED_LODE_IDS.includes(id),
      `分源表里的 ${id} 并不随包（改名了？换源了？），署名指向了一个玩家拿不到的东西`,
    )
  }
})

test('随包的每个包在 NOTICE.md 里都点得出文件名', () => {
  for (const id of BUNDLED_LODE_IDS) {
    assert.ok(
      notice.includes(`assets/lodes/${id}.json`),
      `NOTICE.md 里没有 ${id}.json —— 随分发物提供的那一份声明漏了它`,
    )
  }
})

test('每一组署名都给得出「谁、按什么许可、提供了什么」，并在 NOTICE 里有对应节', () => {
  const keys = new Set()
  for (const source of LODE_CREDIT_SOURCES) {
    assert.ok(!keys.has(source.key), `分组键重复：${source.key}`)
    keys.add(source.key)
    for (const field of ['name', 'license', 'provides', 'detail']) {
      assert.ok(`${source[field] ?? ''}`.trim(), `${source.key} 的 ${field} 是空的`)
    }
    if (!source.lodeIds.length) continue
    // 第一方台账那一组例外：它的「出处」就是艦素自己，没有第三方链接可指
    // （参考来源的集中署名在 NOTICE 的对应小节里）。硬要它挂个链接只会指向
    // 一个与这份数据无关的地方——那比不挂更误导。
    if (source.lodeIds.every((id) => FIRST_PARTY_LODE_IDS.includes(id))) {
      assert.ok(!source.url, `${source.key} 全是第一方台账，不该挂第三方出处链接`)
      continue
    }
    // 有随包内容的组必须给得出出处链接，且 NOTICE 里点得到同一个来源
    assert.ok(source.url, `${source.key} 有随包内容却没有出处链接`)
    const host = new URL(source.url).host + new URL(source.url).pathname.replace(/\/$/, '')
    assert.ok(
      notice.includes(host),
      `NOTICE.md 里找不到 ${source.key} 的出处（${host}）——两处署名对不上`,
    )
  }
})

test('非商业这条硬约束在集中页与 NOTICE 各出现一次', () => {
  // NC 是随包数据带来的唯一硬约束（代码仍是 MIT），两处都要说，且都不许含糊
  assert.match(LODE_CREDIT_INTRO.emphasis, /免费/)
  assert.match(LODE_CREDIT_INTRO.emphasis, /商业/)
  assert.match(notice, /永远免费/)
  assert.match(notice, /非商业性使用/)
  // SA：从 CC 资料加工出的文件同样按该许可提供
  assert.match(LODE_CREDIT_SHARE_ALIKE, /相同方式共享/)
  assert.match(notice, /CC BY-NC-SA 3\.0 提供/)
  // 许可证 URI 必须随分发物提供（CC 3.0 第 4(a) 条）
  assert.ok(notice.includes('https://creativecommons.org/licenses/by-nc-sa/3.0/'))
})

test('集中页文案守住发布纪律：零日期、零工程黑话', () => {
  // 本页一个日期都不出现——新鲜度归「矿脉健康度」卡（纪律七之四）
  assert.doesNotMatch(playerCopy, /\d{4}\s*[-/年]\s*\d{1,2}/)
  // 玩家不该在这页读到施工词汇
  for (const jargon of ['矿脉', '装配', '抓取', '停更', '正则', '解析器', 'json', 'JSON']) {
    assert.ok(!playerCopy.includes(jargon), `集中页文案里出现了工程用语「${jargon}」`)
  }
})

test('署名只在这一处集中履行，不许有第二个消费方', () => {
  // 这一条是「不散布」的结构守卫：分源表只该被钥的那张卡读。
  // 真正的行为断言在上面几条（数据级）；这里补的是「有没有人又把它撒回模块里」。
  const hits = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.ts') && fs.readFileSync(full, 'utf8').includes('lode-credits')) {
        hits.push(full.split(path.sep).join('/').split('/src/')[1])
      }
    }
  }
  walk(path.join(root, 'src'))
  assert.deepEqual(hits.sort(), ['renderer/modules/yu.ts', 'shared/lode-credits.ts'])
})
