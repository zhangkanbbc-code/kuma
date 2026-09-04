import { buildSimplifier, type ChineseSimplifier, type ZhSimplifyTable } from '../shared/zh-simplify'

type ZhSimplifierPack = { data: ZhSimplifyTable } | null | undefined

const identity: ChineseSimplifier = (text) => text
let simplify = identity
let installedTable: ZhSimplifyTable | null | undefined

export const installZhSimplifier = (pack: ZhSimplifierPack): void => {
  const table = pack?.data ?? null
  if (table === installedTable) return
  installedTable = table
  simplify = table ? buildSimplifier(table) : identity
}

export const simplifyZh = (text: string): string => simplify(text)
