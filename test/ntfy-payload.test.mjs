// ntfy 载荷构造（安卓那一侧的默认目标）。
//
// 这里钉的第一条是**实测出来的硬约束**：艦素的通知标题全是中文，而 node 的
// fetch（undici）在遇到非 ASCII 头值时**直接抛 TypeError**——不是发出去乱码，
// 是在进程里就炸，一条也发不出去。官方文档给的解法是把头按 RFC 2047 编码
// （"you may also encode any header (including the title) as RFC 2047"），
// 服务端侧 server/util.go 的 maybeDecodeHeader 对每个参数头都会跑一遍
// Go 的 mime.WordDecoder.DecodeHeader。所以下面既验编码格式，也直接把
// 构造出的 headers 塞进 new Headers()——那一步才是真正会炸的地方。
import assert from 'node:assert/strict'
import test from 'node:test'

import ntfyModule from '../dist/shared/ntfy-payload.js'
import configModule from '../dist/shared/push-config.js'

const {
  buildNtfyRequest,
  encodeNtfyHeader,
  generateNtfyTopic,
  isAsciiHeaderSafe,
  NTFY_DEFAULT_PRIORITY,
} = ntfyModule
const {
  checkNtfyServer,
  checkNtfyTopic,
  isWeakNtfyTopic,
  NTFY_TOPIC_LENGTH,
  NTFY_TOPIC_MAX,
  PUSH_PLACEHOLDER_BODY,
} = configModule

const TOPIC = 'kansoTestTopic7f3Kd9Qm'
const BASE = { server: 'https://ntfy.sh', topic: TOPIC, titleOnly: false }

/** 把 RFC 2047 的 base64 encoded-word 解回来，模拟服务端那一侧 */
const decodeWord = (value) => {
  const hit = /^=\?UTF-8\?B\?(.*)\?=$/.exec(value)
  return hit ? Buffer.from(hit[1], 'base64').toString('utf8') : null
}

test('中文标题必须按 RFC 2047 编码——否则 node 的 fetch 在发出去之前就抛 TypeError', () => {
  const title = '远征 21 返港'
  // 先把「不编码会炸」这件事本身钉住：它是整条设计的前提
  assert.throws(
    () => new Headers({ 'x-title': title }),
    /ByteString/,
    '这个 node 版本居然收下了非 ASCII 头值——前提变了，编码策略要重新评估',
  )

  const built = buildNtfyRequest({ title, body: '第2舰队 · 可再次派遣' }, BASE)
  assert.match(built.headers['x-title'], /^=\?UTF-8\?B\?/)
  assert.equal(decodeWord(built.headers['x-title']), title, '编码后解不回原标题')
  // 真正的验收：这组头能不能进 fetch
  assert.doesNotThrow(() => new Headers(built.headers), '构造出的头 fetch 收不下')
})

test('纯 ASCII 标题原样发，不做无谓的编码（自架服务端的日志里一眼能读）', () => {
  const built = buildNtfyRequest({ title: 'Expedition 21 back', body: 'ok' }, BASE)
  assert.equal(built.headers['x-title'], 'Expedition 21 back')
  assert.equal(isAsciiHeaderSafe('Expedition 21 back'), true)
  // 控制字符与换行不算安全：头注入
  assert.equal(isAsciiHeaderSafe('a\r\nX-Evil: 1'), false)
  assert.match(encodeNtfyHeader('a\r\nX-Evil: 1'), /^=\?UTF-8\?B\?/, '换行没被编码掉 = 头注入')
  assert.doesNotThrow(() => new Headers({ 'x-title': encodeNtfyHeader('a\r\nX-Evil: 1') }))
})

test('请求形态：POST 到 服务器/频道名，正文进 body，标题与优先级进 X- 规范头', () => {
  const built = buildNtfyRequest({ title: 'Dock done', body: '渠1 空闲' }, BASE)
  assert.equal(built.url, `https://ntfy.sh/${TOPIC}`)
  assert.equal(built.body, '渠1 空闲', '正文应该就是请求体本身')
  assert.equal(built.headers['content-type'], 'text/plain; charset=utf-8')
  assert.equal(built.headers['x-priority'], `${NTFY_DEFAULT_PRIORITY}`)
  assert.equal(NTFY_DEFAULT_PRIORITY, 3, '默认优先级不是 3（default）')
  // 用 X- 规范名：服务端 readParam 按 x-title/title/t 顺序取，而裸 Priority
  // 还会撞上 RFC 9218 那个被 ntfy 专门忽略的同名头
  assert.ok('x-title' in built.headers)
  assert.ok(!('title' in built.headers))
  assert.ok(!('priority' in built.headers))
  // 没有令牌就不带 Authorization
  assert.ok(!('authorization' in built.headers))
})

test('ntfy 没有加密，但「只推标题」照样把正文挡在本机', () => {
  const detail = '第2舰队 · 東京急行 · 可再次派遣'
  const built = buildNtfyRequest({ title: '远征 21 返港', body: detail }, { ...BASE, titleOnly: true })
  assert.equal(built.body, PUSH_PLACEHOLDER_BODY)
  assert.ok(!built.body.includes('東京急行'), '正文还在请求体里')
  assert.ok(
    !JSON.stringify(built.headers).includes('東京急行'),
    '正文漏进了请求头',
  )
  // 与 Bark 侧同一个占位：两个目标观感一致
  assert.equal(
    buildNtfyRequest({ title: 't', body: '' }, BASE).body,
    PUSH_PLACEHOLDER_BODY,
    '空正文会被 ntfy 顶成 "triggered"，必须给占位',
  )
})

test('访问令牌走 Bearer；非 ASCII 令牌当场抛错而不是组一个发不出去的头', () => {
  const built = buildNtfyRequest({ title: 't', body: 'b' }, { ...BASE, token: 'tk_AgQdq7mVBoFD37' })
  assert.equal(built.headers.authorization, 'Bearer tk_AgQdq7mVBoFD37')
  assert.doesNotThrow(() => new Headers(built.headers))
  // 空白令牌 = 没填，不带头
  assert.ok(!('authorization' in buildNtfyRequest({ title: 't', body: 'b' }, { ...BASE, token: '  ' }).headers))
  assert.throws(
    () => buildNtfyRequest({ title: 't', body: 'b' }, { ...BASE, token: '令牌' }),
    /ASCII/,
  )
})

test('生成的频道名足够长、且落在 ntfy 允许的字符集里（它就是口令）', () => {
  assert.ok(NTFY_TOPIC_LENGTH >= 20, `生成的频道名只有 ${NTFY_TOPIC_LENGTH} 位，猜得动`)
  const seen = new Set()
  for (let i = 0; i < 50; i++) {
    const topic = generateNtfyTopic()
    assert.equal(topic.length, NTFY_TOPIC_LENGTH)
    // ntfy 官方限制：[-_A-Za-z0-9]；我们的字母表还额外剔掉了易混字符
    assert.match(topic, /^[-_A-Za-z0-9]+$/, `频道名含 ntfy 不收的字符：${topic}`)
    assert.match(topic, /^[A-HJ-NP-Za-km-z2-9]+$/, `频道名含易混字符：${topic}`)
    assert.equal(checkNtfyTopic(topic).value, topic, '自己生成的频道名过不了自己的校验')
    seen.add(topic)
  }
  assert.equal(seen.size, 50, '生成器出现重复，随机源有问题')
  assert.equal(isWeakNtfyTopic(generateNtfyTopic()), false, '生成的频道名被判成「太短」')
  assert.equal(isWeakNtfyTopic('kanso'), true, '短频道名没被提示')
  assert.equal(isWeakNtfyTopic(''), false, '空频道名不该报「太短」，那是「还没填」')
})

test('频道名校验：认出 ntfy 的字符集与长度限制', () => {
  const empty = checkNtfyTopic('')
  assert.equal(empty.value, null)
  assert.equal(empty.empty, true, '空频道名要标成「还没填」，否则会被报成推送失败')
  assert.equal(checkNtfyTopic('my topic').value, null, '空格被放行了')
  assert.equal(checkNtfyTopic('我的频道').value, null, '中文频道名被放行了')
  assert.equal(checkNtfyTopic('a'.repeat(NTFY_TOPIC_MAX + 1)).value, null)
  assert.equal(checkNtfyTopic('a'.repeat(NTFY_TOPIC_MAX)).value, 'a'.repeat(NTFY_TOPIC_MAX))
  assert.equal(checkNtfyTopic('  kanso-alerts_1  ').value, 'kanso-alerts_1')
})

test('服务器校验：认出「把整条频道 URL 贴进服务器格」这个最常犯的错', () => {
  assert.equal(checkNtfyServer('https://ntfy.sh').value, 'https://ntfy.sh')
  assert.equal(checkNtfyServer('https://ntfy.sh/').value, 'https://ntfy.sh')
  // 自架挂在子路径下也放行
  assert.equal(checkNtfyServer('https://例子.example/ntfy/'.replace('例子', 'x')).value, 'https://x.example/ntfy')
  assert.equal(checkNtfyServer('http://10.0.0.2:8080').value, 'http://10.0.0.2:8080')
  assert.equal(checkNtfyServer('ntfy.sh').value, null, '没有协议的地址被放行了')
  assert.equal(checkNtfyServer('https://ntfy.sh?x=1').value, null)
  // 频道名已经在服务器那一格里了 → 拼出来会变成 /topic/topic
  const doubled = checkNtfyServer(`https://ntfy.sh/${TOPIC}`, TOPIC)
  assert.equal(doubled.value, null)
  assert.match(doubled.error, /频道名/)
  // 但没填频道名时不该乱猜：那可能真是个子路径
  assert.equal(checkNtfyServer(`https://ntfy.sh/${TOPIC}`, '').value, `https://ntfy.sh/${TOPIC}`)
  const empty = checkNtfyServer('')
  assert.equal(empty.empty, true)
})
