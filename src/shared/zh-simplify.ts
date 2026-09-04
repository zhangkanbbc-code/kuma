// 只做繁体中文→简体中文：转换是多对一，按字方向安全。
// 词表只为「乾/著/餘/週/隻/裡」这类一繁对多简的字兜底；不是给日文原文用的。

export interface ZhSimplifyTable {
  schemaVersion: number
  chars: Record<string, string>
  phrases: Record<string, string>
}

type PhraseNode = {
  children: Map<string, PhraseNode>
  replacement?: string
}

export type ChineseSimplifier = (text: string) => string

const identity: ChineseSimplifier = (text) => text
const containsHan = /\p{Script=Han}/u

export const buildSimplifier = (
  table: ZhSimplifyTable | null | undefined,
): ChineseSimplifier => {
  if (!table) return identity

  const root: PhraseNode = { children: new Map() }
  for (const [phrase, replacement] of Object.entries(table.phrases)) {
    let node = root
    for (const char of phrase) {
      let child = node.children.get(char)
      if (!child) {
        child = { children: new Map() }
        node.children.set(char, child)
      }
      node = child
    }
    node.replacement = replacement
  }

  return (text) => {
    if (!containsHan.test(text)) return text
    const chars = [...text]
    let simplified = ''
    for (let index = 0; index < chars.length;) {
      let node = root
      let cursor = index
      let matchEnd = index
      let replacement: string | undefined
      while (cursor < chars.length) {
        const child = node.children.get(chars[cursor])
        if (!child) break
        node = child
        cursor += 1
        if (node.replacement !== undefined) {
          matchEnd = cursor
          replacement = node.replacement
        }
      }
      if (replacement !== undefined) {
        simplified += replacement
        index = matchEnd
      } else {
        simplified += table.chars[chars[index]] ?? chars[index]
        index += 1
      }
    }
    return simplified
  }
}

export const simplifyChinese = (
  text: string,
  table: ZhSimplifyTable | null | undefined,
): string => buildSimplifier(table)(text)
