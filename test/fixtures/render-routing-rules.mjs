import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const source = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'modules', 'ji.ts'), 'utf8')
const start = source.indexOf('const routingHtml = (code: string): string =>')
const end = source.indexOf('\n/**', start)
assert.ok(start >= 0 && end > start, 'ji.ts 里找不到 routingHtml')
const routingHtmlSource = source.slice(start, end)
const routingRuleName = path.join(ROOT, 'src', 'shared', 'routing-rule-name.ts').replace(/\\/g, '/')

const harness = `
import {
  buildRoutingRuleShipNameIndex,
  normalizeRoutingRuleShipNames,
  type RoutingRuleShipNameIndex,
} from '${routingRuleName}'

let routingLode: any = null
let routingRuleShipNameIndex: RoutingRuleShipNameIndex = []
const kcnavRoutingHtml = (_code: string) => ''
const wikiwikiRoutingHtml = (_code: string) => ''
const lodeCreditMark = (_meta: unknown) => '<span class="credit-mark">源</span>'
const esc = (value: unknown) =>
  String(value ?? '').replace(/[&<>"']/g, (char) => \`&#\${char.charCodeAt(0)};\`)

export const setRoutingData = (data: unknown, localizationData: unknown) => {
  routingLode = { meta: {}, data }
  routingRuleShipNameIndex = buildRoutingRuleShipNameIndex(localizationData)
}

${routingHtmlSource}

export { routingHtml }
`

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-routing-rules-'))
const entry = path.join(dir, 'routing-rules.ts')
const outfile = path.join(dir, 'routing-rules.cjs')
fs.writeFileSync(entry, harness)
buildSync({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  logLevel: 'silent',
})

const loaded = createRequire(import.meta.url)(outfile)

export const renderRoutingRules = (code, data, localizationData) => {
  loaded.setRoutingData(data, localizationData)
  return loaded.routingHtml(code)
}

export const renderedRulesOf = (html) =>
  [...String(html).matchAll(/<div class="rt-r(?: sub)?">([\s\S]*?)<\/div>/g)].map(
    (match) => match[1],
  )

export const cleanupRoutingRuleFixture = () => fs.rmSync(dir, { recursive: true, force: true })
