const MAX_SOURCE_BYTES = 2_000_000
const MAX_QUESTS = 2_000
const MAX_FIELDS = 200
const MAX_ARRAY = 2_000
const MAX_DEPTH = 12
const MAX_STRING = 4_000

const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key)

const stripLineComment = (line) => {
  let quote = ''
  let escaped = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (quote && char === '\\') {
      escaped = true
      continue
    }
    if (quote) {
      if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === '#') return line.slice(0, index)
  }
  return line
}

const colonAtTopLevel = (line) => {
  let quote = ''
  let escaped = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (quote && char === '\\') {
      escaped = true
      continue
    }
    if (quote) {
      if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === ':') return index
  }
  return -1
}

const bracketDelta = (line) => {
  let delta = 0
  let quote = ''
  let escaped = false
  for (const char of line) {
    if (escaped) {
      escaped = false
      continue
    }
    if (quote && char === '\\') {
      escaped = true
      continue
    }
    if (quote) {
      if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === '[') delta += 1
    else if (char === ']') delta -= 1
  }
  return delta
}

const decodeEscape = (char) => ({
  n: '\n',
  r: '\r',
  t: '\t',
  b: '\b',
  f: '\f',
  v: '\v',
  0: '\0',
}[char] ?? char)

const parseValue = (source) => {
  let index = 0
  let nodes = 0

  const skip = () => {
    while (index < source.length && (/[\s,]/.test(source[index]))) index += 1
  }

  const parse = (depth) => {
    nodes += 1
    if (nodes > 100_000) throw new Error('poi quest CSON has too many value nodes')
    if (depth > MAX_DEPTH) throw new Error('poi quest CSON value is nested too deeply')
    skip()
    const char = source[index]
    if (char === '[') {
      index += 1
      const values = []
      while (true) {
        skip()
        if (source[index] === ']') {
          index += 1
          return values
        }
        if (index >= source.length) throw new Error('unterminated CSON array')
        if (values.length >= MAX_ARRAY) throw new Error('poi quest CSON array is too long')
        values.push(parse(depth + 1))
      }
    }
    if (char === '"' || char === "'") {
      const quote = char
      index += 1
      let value = ''
      while (index < source.length) {
        const current = source[index]
        index += 1
        if (current === quote) {
          if (value.length > MAX_STRING) throw new Error('poi quest CSON string is too long')
          return value
        }
        if (current !== '\\') {
          value += current
          continue
        }
        if (index >= source.length) throw new Error('unterminated CSON escape')
        const escaped = source[index]
        index += 1
        if (escaped === 'u') {
          const code = source.slice(index, index + 4)
          if (!/^[0-9a-f]{4}$/i.test(code)) throw new Error('invalid CSON unicode escape')
          value += String.fromCharCode(parseInt(code, 16))
          index += 4
        } else {
          value += decodeEscape(escaped)
        }
      }
      throw new Error('unterminated CSON string')
    }
    const tail = source.slice(index)
    const number = tail.match(/^-?\d+(?:\.\d+)?/)
    if (number) {
      index += number[0].length
      const value = Number(number[0])
      if (!Number.isFinite(value) || Math.abs(value) > 1_000_000_000) {
        throw new Error('poi quest CSON number is out of range')
      }
      return value
    }
    for (const [token, value] of [['true', true], ['false', false], ['null', null]]) {
      if (tail.startsWith(token) && !/[A-Za-z0-9_]/.test(tail[token.length] ?? '')) {
        index += token.length
        return value
      }
    }
    throw new Error(`unsupported value near ${JSON.stringify(tail.slice(0, 40))}`)
  }

  const value = parse(0)
  skip()
  if (index !== source.length) {
    throw new Error(`unsupported value tail ${JSON.stringify(source.slice(index, index + 40))}`)
  }
  return value
}

const parseKey = (source) => {
  const value = source.trim()
  if (!value) throw new Error('empty CSON key')
  if (value[0] === '"' || value[0] === "'") {
    const parsed = parseValue(value)
    if (typeof parsed !== 'string' || !parsed.length || parsed.length > 200) {
      throw new Error('invalid quoted CSON key')
    }
    return parsed
  }
  if (!/^[A-Za-z0-9_.-]{1,200}$/.test(value)) {
    throw new Error(`unsupported CSON key ${JSON.stringify(value)}`)
  }
  return value
}

export const parsePoiQuestGoalCson = (raw) => {
  if (typeof raw !== 'string' || !raw.length || raw.length > MAX_SOURCE_BYTES) {
    throw new Error('poi quest CSON must be a bounded non-empty string')
  }
  const lines = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n')
  const root = {}
  const stack = [{ indent: -1, value: root }]
  let blockComment = false

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const original = lines[lineIndex]
    if (original.includes('\t')) throw new Error(`tabs are not allowed at line ${lineIndex + 1}`)
    if (original.trim() === '###') {
      blockComment = !blockComment
      continue
    }
    if (blockComment) continue
    let line = stripLineComment(original).replace(/\s+$/, '')
    if (!line.trim()) continue
    const indent = line.length - line.trimStart().length
    if (indent > 40) throw new Error(`indentation is too deep at line ${lineIndex + 1}`)
    line = line.trimStart()
    const colon = colonAtTopLevel(line)
    if (colon <= 0) throw new Error(`expected key:value at line ${lineIndex + 1}`)
    const key = parseKey(line.slice(0, colon))
    let rawValue = line.slice(colon + 1).trim()

    if (rawValue.startsWith('[')) {
      let balance = bracketDelta(rawValue)
      while (balance > 0) {
        lineIndex += 1
        if (lineIndex >= lines.length) throw new Error('unterminated multiline CSON array')
        const next = stripLineComment(lines[lineIndex])
        rawValue += `\n${next}`
        balance += bracketDelta(next)
      }
      if (balance !== 0) throw new Error(`unbalanced CSON array near line ${lineIndex + 1}`)
    }

    while (stack[stack.length - 1].indent >= indent) stack.pop()
    const parent = stack[stack.length - 1]?.value
    if (!parent) throw new Error(`invalid indentation at line ${lineIndex + 1}`)
    if (own(parent, key)) throw new Error(`duplicate key ${key}`)
    if (Object.keys(parent).length >= MAX_FIELDS) {
      throw new Error(`too many fields near line ${lineIndex + 1}`)
    }
    if (!rawValue) {
      const object = {}
      parent[key] = object
      stack.push({ indent, value: object })
    } else {
      parent[key] = parseValue(rawValue)
    }
  }
  if (blockComment) throw new Error('unterminated CSON block comment')
  const questIds = Object.keys(root)
  if (!questIds.length || questIds.length > MAX_QUESTS) {
    throw new Error('poi quest CSON has an invalid quest count')
  }
  for (const id of questIds) {
    if (!/^\d{1,6}$/.test(id) || Number(id) <= 0) {
      throw new Error(`invalid poi quest id ${id}`)
    }
  }
  return root
}
