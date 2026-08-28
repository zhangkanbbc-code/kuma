// 手机推送（Bark）的载荷构造与配置口径。
//
// 这里钉的第一条是**互操作实测向量**：官方加密文档（https://bark.day.app/encryption.md）
// 给了一段 openssl 示例，连同它算出来的密文一起印在文档里。我们用同样的
// key/iv/json 走 node 的 createCipheriv，必须逐字节得到同一串 base64——
// 这比任何「我觉得是 AES-128-CBC」都硬：算法、模式、padding、编码、
// key/iv 是不是按 ASCII 原文取，全在这一条里一次性验完。
import assert from 'node:assert/strict'
import { createDecipheriv } from 'node:crypto'
import test from 'node:test'

import payloadModule from '../dist/shared/push-payload.js'
import configModule from '../dist/shared/push-config.js'

const {
  barkParams,
  buildPushRequestBody,
  encryptPushPayload,
  generatePushKey,
  randomPushIv,
} = payloadModule
const {
  checkBarkEndpoint,
  clampPushIdleMinutes,
  isValidPushKey,
  NTFY_DEFAULT_SERVER,
  NTFY_SERVER_PLACEHOLDER,
  PUSH_CONFIG_PATHS,
  PUSH_DEFAULTS,
  PUSH_IDLE_MINUTES_MAX,
  PUSH_IDLE_MINUTES_MIN,
  PUSH_IV_LENGTH,
  PUSH_KEY_LENGTH,
  PUSH_PLACEHOLDER_BODY,
  readPushSettings,
  shouldHoldForPresence,
  utf8ByteLength,
} = configModule

const KEY = '1234567890123456'
const IV = '1234567890123456'

/** 把加密模式的表单体拆回 {ciphertext, iv} 再解密，模拟手机上那一侧 */
const decryptForm = (body, key) => {
  const params = new URLSearchParams(body)
  const decipher = createDecipheriv(
    'aes-128-cbc',
    Buffer.from(key, 'utf8'),
    Buffer.from(params.get('iv'), 'utf8'),
  )
  const json = Buffer.concat([
    decipher.update(Buffer.from(params.get('ciphertext'), 'base64')),
    decipher.final(),
  ]).toString('utf8')
  return JSON.parse(json)
}

test('加密与 Bark 官方文档的实测向量逐字节一致（AES-128-CBC / PKCS#7 / base64 / key 与 iv 取 ASCII 原文）', () => {
  // 文档示例：json='{"body": "test", "sound": "birdsong"}'，key 与 iv 都是
  // '1234567890123456'，openssl 打印出的密文原样抄在这里。
  assert.equal(
    encryptPushPayload('{"body": "test", "sound": "birdsong"}', KEY, IV),
    '+aPt5cwN9GbTLLSFri60l3h1X00u/9j1FENfWiTxhNHVLGU+XoJ15JJG5W/d/yf0',
  )
})

test('加密推送：往返解得回原样的 title/body/group，且表单里带上这一条用的 iv', () => {
  const built = buildPushRequestBody(
    { title: '远征 21 返港', body: '第2舰队 · 東京急行 · 可再次派遣', group: '远征返港' },
    { titleOnly: false, encryptKey: KEY, iv: IV },
  )
  assert.equal(built.mode, 'encrypted')
  assert.equal(built.contentType, 'application/x-www-form-urlencoded; charset=utf-8')
  assert.equal(built.iv, IV)
  // iv 必须真出现在表单里：随机 iv 不发出去，手机那边只能拿设置里的固定 iv 解，必然失败
  assert.equal(new URLSearchParams(built.body).get('iv'), IV)
  assert.deepEqual(decryptForm(built.body, KEY), {
    title: '远征 21 返港',
    body: '第2舰队 · 東京急行 · 可再次派遣',
    group: '远征返港',
  })
})

test('只推标题：正文压根不进载荷——明文体和密文体里都搜不到它', () => {
  const detail = '第2舰队 · 東京急行 · 可再次派遣'
  const plain = buildPushRequestBody(
    { title: '远征 21 返港', body: detail, group: '远征返港' },
    { titleOnly: true },
  )
  assert.equal(plain.mode, 'plain')
  assert.equal(JSON.parse(plain.body).body, PUSH_PLACEHOLDER_BODY)
  assert.ok(!plain.body.includes('東京急行'), '明文载荷里还带着正文')

  const sealed = buildPushRequestBody(
    { title: '远征 21 返港', body: detail, group: '远征返港' },
    { titleOnly: true, encryptKey: KEY, iv: IV },
  )
  assert.ok(!sealed.body.includes('東京急行'), '密文表单里还带着正文（明文残留）')
  // 解开也没有：不是被谁在外层截掉，是从来没构造进去
  assert.equal(decryptForm(sealed.body, KEY).body, PUSH_PLACEHOLDER_BODY)
  assert.equal(barkParams({ title: 'x', body: detail }, true).body, PUSH_PLACEHOLDER_BODY)
})

test('正文占位不能是空串——服务端会把「三项全空」顶成 Empty Message，手机上就只剩那句英文', () => {
  assert.ok(PUSH_PLACEHOLDER_BODY.length > 0)
  // 正文本来就空的通知也走占位，明文/加密两条路观感一致
  assert.equal(barkParams({ title: '建造完成', body: '' }, false).body, PUSH_PLACEHOLDER_BODY)
})

test('明文模式：Content-Type 与字段形状就是 Bark 文档那三个键，不多塞', () => {
  const built = buildPushRequestBody(
    { title: '入渠完成', body: '渠1 空闲', group: '入渠完成' },
    { titleOnly: false },
  )
  assert.equal(built.mode, 'plain')
  assert.equal(built.contentType, 'application/json; charset=utf-8')
  assert.equal(built.iv, null)
  assert.deepEqual(JSON.parse(built.body), {
    title: '入渠完成',
    body: '渠1 空闲',
    group: '入渠完成',
  })
  // group 可选：不给就不出现这个键
  const noGroup = buildPushRequestBody({ title: 'a', body: 'b' }, { titleOnly: false })
  assert.deepEqual(Object.keys(JSON.parse(noGroup.body)), ['title', 'body'])
})

test('IV 每条一换：同样的输入连发两次，密文和 iv 都不许相同', () => {
  const one = buildPushRequestBody({ title: 't', body: 'b' }, { titleOnly: false, encryptKey: KEY })
  const two = buildPushRequestBody({ title: 't', body: 'b' }, { titleOnly: false, encryptKey: KEY })
  assert.notEqual(one.iv, two.iv, 'IV 复用了——同 key 同 IV 下相同前缀会给出相同密文块')
  assert.notEqual(one.body, two.body)
  // 换了 IV 也照样解得开（iv 随表单一起发）
  assert.equal(decryptForm(one.body, KEY).title, 't')
  assert.equal(decryptForm(two.body, KEY).title, 't')
  assert.equal(utf8ByteLength(one.iv), PUSH_IV_LENGTH)
})

test('密钥不合格时抛错，绝不悄悄退回明文', () => {
  const notice = { title: '大破', body: '别继续前进' }
  for (const bad of ['', ' ', '123456789012345', '12345678901234567']) {
    if (!bad.trim()) continue // 空 = 用户没开加密，那条路径是合法的明文
    // 2026-08-26 文案清扫：错误条从「必须正好 16 字节（16 个 ASCII 字符）——Bark 的
    // AES-128 只认这个长度」缩成「必须正好 16 个 ASCII 字符」（族 E，同一件事说两遍）。
    // 判据仍是 UTF-8 字节数，见下面那条汉字密钥的断言。
    assert.throws(
      () => buildPushRequestBody(notice, { titleOnly: false, encryptKey: bad }),
      /必须正好 16 个 ASCII 字符/,
      `${bad.length} 位的密钥被放行了`,
    )
  }
  // 16 个汉字是 48 字节：长度看着对，AES 一样不收。按字符数判会在这里放行
  assert.equal('一二三四五六七八九十甲乙丙丁戊己'.length, PUSH_KEY_LENGTH)
  assert.throws(
    () => buildPushRequestBody(notice, { titleOnly: false, encryptKey: '一二三四五六七八九十甲乙丙丁戊己' }),
    /必须正好 16 个 ASCII 字符/,
    '密钥长度按字符数判了，不是按 UTF-8 字节数',
  )
  assert.equal(isValidPushKey(KEY), true)
  assert.equal(isValidPushKey('一二三四五六七八九十甲乙丙丁戊己'), false)
})

test('生成的密钥正好 16 字节、全是可抄写的 ASCII，且不重样', () => {
  const keys = new Set()
  for (let i = 0; i < 50; i++) {
    const key = generatePushKey()
    assert.equal(utf8ByteLength(key), PUSH_KEY_LENGTH)
    assert.equal(key.length, PUSH_KEY_LENGTH)
    // 0/O、1/l/I 这几组抄错就是「推送到了但解不开」，字母表里不该有
    assert.match(key, /^[A-HJ-NP-Za-km-z2-9]+$/, `生成的密钥含易混字符：${key}`)
    keys.add(key)
  }
  assert.equal(keys.size, 50, '生成器出现重复，随机源有问题')
  assert.equal(utf8ByteLength(randomPushIv()), PUSH_IV_LENGTH)
})

test('推送默认值：总开关默认关，目标默认 ntfy，只推标题与 Bark 加密默认开', () => {
  assert.equal(PUSH_DEFAULTS.enabled, false, '推送总开关不是默认关')
  // ntfy 在安卓上收得到、服务器还能自架；Bark 走苹果 APNs，安卓装不了——默认必须是 ntfy
  assert.equal(PUSH_DEFAULTS.provider, 'ntfy', '默认目标不是 ntfy')
  assert.equal(PUSH_DEFAULTS.titleOnly, true, '只推标题不是默认开')
  // 2026-08-23：撤掉 https://ntfy.sh 预置。推送是唯一会打到非游戏服务器的出网路径，
  // 预置一个主机等于替玩家决定「东西发给谁」——目标必须他自己填
  assert.equal(PUSH_DEFAULTS.ntfyServer, '', 'ntfy 服务器又被预置了一个默认主机')
  assert.equal(NTFY_DEFAULT_SERVER, '', 'ntfy 服务器又被预置了一个默认主机')
  // 示例文本是 placeholder，不是值：它进不了配置也进不了任何一次请求
  assert.ok(NTFY_SERVER_PLACEHOLDER.startsWith('例：'), '示例文本没写成示例的样子')
  assert.equal(PUSH_DEFAULTS.ntfyTopic, '', '频道名不是默认空——必须用户亲手填/生成')
  assert.equal(PUSH_DEFAULTS.ntfyToken, '')
  assert.equal(PUSH_DEFAULTS.barkEndpoint, '', '地址不是默认空——必须用户亲手填')
  assert.equal(PUSH_DEFAULTS.barkEncrypt, true, 'Bark 加密不是默认开')
  assert.equal(PUSH_DEFAULTS.barkKey, '')
  // 在场门槛默认开、3 分钟：开推送的人要的是「人不在时提醒」，
  // 坐在电脑前那一份 Toast 已经说过一遍，手机再响是纯噪音。
  assert.equal(PUSH_DEFAULTS.presenceHold, true, '在场门槛不是默认开')
  assert.equal(PUSH_DEFAULTS.presenceIdleMinutes, 3, '默认空闲阈值不是 3 分钟')
  assert.equal(PUSH_IDLE_MINUTES_MIN, 1)
  assert.equal(PUSH_IDLE_MINUTES_MAX, 30)
})

test('在场门槛：空闲秒数与分钟阈值的比较只有这一处，且失灵方向一律「照发」', () => {
  const on = { presenceHold: true, presenceIdleMinutes: 3 }

  // —— 单位：一边是**秒**（powerMonitor.getSystemIdleTime()），一边是**分钟** ——
  // 把秒直接和分钟比（3 < 3 = false）会让「刚放开键盘 3 秒」被判成不在场，
  // 那正是这个功能要消除的那一份重复通知。
  assert.equal(shouldHoldForPresence(on, 3), true, '3 秒被当成 3 分钟了（单位错）')
  assert.equal(shouldHoldForPresence(on, 0), true, '人正在敲键盘却照推')
  assert.equal(shouldHoldForPresence(on, 179), true, '差 1 秒就到阈值，仍算在场')
  // 到点即发：>= 阈值就不再暂缓（毫秒/秒混用会让这一条变成 true）
  assert.equal(shouldHoldForPresence(on, 180), false, '空闲已达阈值却还压着不发')
  assert.equal(shouldHoldForPresence(on, 3600), false, '离开一小时了还压着不发')

  // —— 判反检测：门槛关着 = 与没有这个功能时逐字一致（无条件即发）——
  const off = { presenceHold: false, presenceIdleMinutes: 3 }
  for (const idle of [0, 1, 179, 180, 99999]) {
    assert.equal(shouldHoldForPresence(off, idle), false, `门槛关着却暂缓了（空闲 ${idle}s）`)
  }

  // —— 读不出空闲时间：照发。压着不发等于把用户唯一要的那条提醒静默丢掉 ——
  for (const bad of [Number.NaN, -1, undefined, null, 'abc', {}]) {
    assert.equal(shouldHoldForPresence(on, bad), false, `空闲时间是 ${String(bad)} 时不该暂缓`)
  }

  // —— 阈值本身也过一遍区间：0 分钟等于把门槛悄悄关掉，不许出现 ——
  assert.equal(shouldHoldForPresence({ presenceHold: true, presenceIdleMinutes: 0 }, 5), true)
  assert.equal(clampPushIdleMinutes(0), 1, '0 分钟没被抬到下限')
  assert.equal(clampPushIdleMinutes(-5), 1)
  assert.equal(clampPushIdleMinutes(31), 30, '超上限没被压回 30')
  assert.equal(clampPushIdleMinutes(1), 1)
  assert.equal(clampPushIdleMinutes(30), 30)
  assert.equal(clampPushIdleMinutes(2.6), 3, '小数没取整')
  // 空框/读不出来 = 「没填」，回默认 3，而不是 clamp 成最短的 1
  assert.equal(clampPushIdleMinutes(''), 3)
  assert.equal(clampPushIdleMinutes('  '), 3)
  assert.equal(clampPushIdleMinutes('abc'), 3)
  assert.equal(clampPushIdleMinutes(undefined), 3)
  assert.equal(clampPushIdleMinutes(null), 3)
  assert.equal(clampPushIdleMinutes('12'), 12, '输入框给的是字符串，得认')

  // 配置里的坏值同样过 clamp（读设置那一路也不许放 0 分钟进来）
  assert.equal(
    readPushSettings((path, fallback) =>
      path === PUSH_CONFIG_PATHS.presenceIdleMinutes ? 0 : fallback,
    ).presenceIdleMinutes,
    1,
  )
  // 只有显式 false 才关得掉门槛（缺键、坏值都保持默认开）
  assert.equal(
    readPushSettings((path, fallback) =>
      path === PUSH_CONFIG_PATHS.presenceHold ? false : fallback,
    ).presenceHold,
    false,
  )
  assert.equal(
    readPushSettings((path, fallback) =>
      path === PUSH_CONFIG_PATHS.presenceHold ? 'no' : fallback,
    ).presenceHold,
    true,
    '坏值把默认开的门槛翻成关了',
  )
})

test('配置一律按叶子路径读：整对象读会拿到写叶子时留下的半份对象', () => {
  const asked = []
  const settings = readPushSettings((path, fallback) => {
    asked.push(path)
    return fallback
  })
  assert.deepEqual(asked.sort(), Object.values(PUSH_CONFIG_PATHS).sort())
  // 「叶子」的结构判据：没有哪条路径是另一条的前缀。读 kanso.push 或
  // kanso.push.ntfy 都会被这一条抓住——它们是别人的父节点。
  for (const path of asked) {
    assert.match(path, /^kanso\.push\./, `${path} 跑出 kanso.push 之外了`)
    const parents = asked.filter((other) => other !== path && other.startsWith(`${path}.`))
    assert.deepEqual(parents, [], `${path} 是整对象读，它下面还有 ${parents.length} 个叶子`)
  }
  // 全部读不到时回落到默认值，而不是 undefined
  assert.deepEqual(settings, { ...PUSH_DEFAULTS })
})

test('缺省项各回各的默认：坏值不许把「加密/只推标题」翻成关', () => {
  const stored = {
    [PUSH_CONFIG_PATHS.enabled]: true,
    [PUSH_CONFIG_PATHS.barkEndpoint]: '  https://api.day.app/abc  ',
  }
  const settings = readPushSettings((path, fallback) =>
    path in stored ? stored[path] : fallback,
  )
  assert.equal(settings.enabled, true)
  assert.equal(settings.barkEndpoint, 'https://api.day.app/abc', '地址没去掉首尾空白')
  assert.equal(settings.barkEncrypt, true, '没存过 barkEncrypt 就变成关了')
  assert.equal(settings.titleOnly, true, '没存过 titleOnly 就变成关了')
  // 认不出的 provider 退回默认，不拿一个不存在的目标去分发
  assert.equal(
    readPushSettings((path, fallback) => (path === PUSH_CONFIG_PATHS.provider ? 'telegram' : fallback)).provider,
    'ntfy',
  )
  assert.equal(
    readPushSettings((path, fallback) => (path === PUSH_CONFIG_PATHS.provider ? 'bark' : fallback)).provider,
    'bark',
  )
  // 服务器留空就是**没配**（没有默认目标了）：整条推送停在本机，不会拼出半截地址去发
  assert.equal(
    readPushSettings((path, fallback) => (path === PUSH_CONFIG_PATHS.ntfyServer ? '   ' : fallback)).ntfyServer,
    '',
  )
  // 撤预置不许伤到已经填过的人：存过的值照旧读出来
  assert.equal(
    readPushSettings((path, fallback) =>
      path === PUSH_CONFIG_PATHS.ntfyServer ? 'https://ntfy.example.test' : fallback,
    ).ntfyServer,
    'https://ntfy.example.test',
  )
  // 只有显式的 false 才关得掉
  assert.equal(
    readPushSettings((path, fallback) => (path === PUSH_CONFIG_PATHS.barkEncrypt ? false : fallback)).barkEncrypt,
    false,
  )
  // enabled 反过来：只有显式 true 才算开，别的值一律当关
  assert.equal(
    readPushSettings((path, fallback) => (path === PUSH_CONFIG_PATHS.enabled ? 'yes' : fallback)).enabled,
    false,
  )
})

test('Bark 地址校验：分清「还没填」和「填错了」，并认出缺设备码那一种', () => {
  const empty = checkBarkEndpoint('')
  assert.equal(empty.value, null)
  assert.equal(empty.empty, true, '空地址要标成「还没填」，否则会被报成推送失败')

  const bad = checkBarkEndpoint('api.day.app/abc') // 没有协议
  assert.equal(bad.value, null)
  assert.equal(bad.empty, false)

  assert.equal(checkBarkEndpoint('ftp://api.day.app/abc').value, null)
  // 只有主机没有设备码：发出去必然 404，当场就能判死
  const noKey = checkBarkEndpoint('https://api.day.app')
  assert.equal(noKey.value, null)
  assert.match(noKey.error, /设备码/)

  assert.equal(checkBarkEndpoint('https://api.day.app/abc123').value, 'https://api.day.app/abc123')
  // 末尾斜杠去掉：Bark 按路径段匹配路由，多一个空段会落到别的路由上
  assert.equal(checkBarkEndpoint('https://api.day.app/abc123/').value, 'https://api.day.app/abc123')
  assert.equal(checkBarkEndpoint('  https://api.day.app/abc123  ').value, 'https://api.day.app/abc123')
  // 自建服务端：http 与非默认端口都得放行
  assert.equal(checkBarkEndpoint('http://10.0.0.2:8080/abc').value, 'http://10.0.0.2:8080/abc')
})
