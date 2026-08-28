// 改修事实表（第一方随包）的护栏。
//
// 这张表顶掉了 `equip-upgrades` 那个自取包：那个包上游无许可、不随发行版，
// 于是首发玩家的改修卡整块是「待补」——而改修的消耗、二号舰、开放星期、更新链
// 是**游戏机制的客观事实**，不属于任何转录者。事实表把它接回玩家手里。
//
// 这里钉四件事：schema 真校验（跑主进程那只校验器，不是自己重写一遍判据）、
// 每行都有置信等级、随包数据里不点名任何转录者、以及合成器幂等。
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import validation from '../dist/main/lode-validation.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const TABLE = new URL('../assets/lodes/equip-improve.json', import.meta.url)

const table = () => (fs.existsSync(TABLE) ? JSON.parse(fs.readFileSync(TABLE, 'utf8')) : null)

/** 置信等级的四档。多一档少一档都要在这里显式改，不许悄悄冒出新说法 */
const BASIS_SHAPES = [
  /^整理参照·交叉核对$/,
  /^整理参照·交叉核对 · 官方公告 \d{4}-\d{2}-\d{2} 佐证$/,
  /^机制通则推定 · \d{4}-\d{2}-\d{2}$/,
  /^游戏内实测 \d{4}-\d{2}-\d{2}$/,
]

test('事实表随包存在，且过主进程那只 schema 校验', () => {
  const pack = table()
  assert.ok(pack, '随包的改修事实表不见了——首发玩家的改修卡会整块「待补」')
  assert.equal(pack.meta?.id, 'equip-improve', 'meta.id 不对')
  // 真走主进程加载包时的那一只校验器（meta + data 一起验），不在这里重写判据
  const verdict = validation.validateLodePack(pack)
  assert.ok(verdict.ok, `事实表没过 schema 校验：${verdict.error}`)
  assert.ok(
    validation.SUPPORTED_LODE_IDS.includes('equip-improve'),
    'equip-improve 没登记进校验器注册表——加载时会被当成不认识的包',
  )
  assert.ok(pack.data.length > 300, `只有 ${pack.data.length} 件装备，表像是被截断了`)
})

test('每一行都写着置信等级，且只用约定的那四档', () => {
  const pack = table()
  if (!pack) return
  const seen = new Map()
  for (const entry of pack.data) {
    assert.ok(entry.improvement?.length, `eq_id=${entry.eq_id} 一套方案都没有`)
    for (const row of entry.improvement) {
      assert.ok(row.basis, `eq_id=${entry.eq_id} 有一行没写 basis`)
      assert.ok(
        BASIS_SHAPES.some((shape) => shape.test(row.basis)),
        `eq_id=${entry.eq_id} 的 basis 冒出了新说法：${row.basis}` +
          '——档位是玩家判断「这个数可不可信」的唯一依据，不许自由发挥',
      )
      seen.set(row.basis, (seen.get(row.basis) ?? 0) + 1)
    }
  }
  // 四档不必都有货，但「整理参照」与「游戏内实测」必须同时存在：
  // 全是实测说明有人在硬标，一条实测都没有说明升级那条路没走通
  assert.ok([...seen.keys()].some((one) => /^整理参照/.test(one)), '一条「整理参照」都没有？')
  assert.ok(
    [...seen.keys()].some((one) => /^游戏内实测/.test(one)),
    '一条「游戏内实测」都没有——实测到了要升级 basis，这条路像是断了',
  )
})

test('随包数据里不点名任何转录者：判据来路留给维护者侧的台账', () => {
  const raw = fs.existsSync(TABLE) ? fs.readFileSync(TABLE, 'utf8') : ''
  if (!raw) return
  // 纪律七之三：署名集中在 NOTICE 与钥的资料页，不在每条数据下面散布。
  // 而且逐条点名会把注意力从「这个数可不可信」引到「这个数抄自谁」
  for (const name of ['wikiwiki', 'kcwiki', 'akashi', '舰娘百科', 'KC3Kai']) {
    assert.ok(
      !raw.includes(name),
      `事实表里出现了「${name}」——随包数据不逐条点名转录者，判据来路写在 shared 台账里`,
    )
  }
})

test('挂着待核项的那几件，说法里不带转录者也不带猜测值', () => {
  const pack = table()
  if (!pack) return
  const pending = pack.data.filter((one) => one.pending?.length)
  assert.ok(pending.length > 0, '一条待核项都没有？那几件分歧不该凭空消失')
  for (const entry of pending) {
    for (const text of entry.pending) {
      assert.ok(text.length > 10, `eq_id=${entry.eq_id} 的待核项太短，说不清是什么`)
      assert.ok(
        /待核/.test(text),
        `eq_id=${entry.eq_id} 的待核项没写明它是待核的：${text}`,
      )
    }
  }
})

test('合成器幂等：重跑一遍产出同样的字节，不制造假的「刚更新」', (t) => {
  if (!fs.existsSync(new URL('../assets/lodes/equip-upgrades.json', import.meta.url))) {
    t.skip('本机没有上游自取包（玩家机器上本来就没有），跳过重跑')
    return
  }
  const before = fs.readFileSync(TABLE)
  // 产物改道到临时目录再比字节：node --test 多进程并行，另外两份测试正在读仓里那份，
  // 原地重写会让它们读到半截（2026-08-26 前四次「偶发红一条」全是这个）。
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-equip-improve-'))
  const tmpOut = path.join(tmpDir, 'equip-improve.json')
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }))
  try {
    execFileSync(process.execPath, ['scripts/build-equip-improve.mjs'], {
      cwd: ROOT,
      stdio: 'pipe',
      env: { ...process.env, KANSO_EQUIP_IMPROVE_OUT: tmpOut },
    })
  } catch (error) {
    assert.fail(`合成器跑不起来：${error.stderr?.toString() ?? error.message}`)
  }
  const after = fs.readFileSync(tmpOut)
  assert.ok(
    before.equals(after),
    '合成器重跑产出了不同的字节——它不幂等，重跑会把时间戳或顺序搅动一遍',
  )
  assert.ok(fs.readFileSync(TABLE).equals(before), '幂等护栏不该碰仓里那份事实表')
})

// ---- 装配层换底座（第 2 步）----

test('装配层读的是事实表，不再读那个自取包，也不再叠校正层', () => {
  const ji = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  assert.ok(ji.includes("queryLode('equip-improve')"), '装配层没有读事实表')
  assert.ok(
    !ji.includes("queryLode('equip-upgrades')"),
    '装配层还在读那个自取包——玩家产物里没有它，改修卡会整块「待补」',
  )
  // 四案与通则补档在合成事实表时就吃进去了，运行时再叠一层等于叠两次
  assert.ok(
    !ji.includes('applyEquipUpgradeCorrections'),
    '装配层还在叠校正层——事实表已经是底座了，再叠一次是重复施加',
  )
})

test('自取包退役得干净：运行时不读、永不随包；事实表随包且在读取清单里', async () => {
  const lodeIds = (await import('../dist/shared/lode-ids.js')).default
  const { BUNDLED_LODE_IDS, NEVER_BUNDLED_LODE_IDS } = await import(
    '../scripts/lib/bundled-lodes.mjs'
  )
  const consumed = lodeIds.CONSUMED_LODE_IDS
  assert.ok(consumed.includes('equip-improve'), '事实表不在运行时读取清单里')
  assert.ok(BUNDLED_LODE_IDS.includes('equip-improve'), '事实表没随包——首发玩家还是看不到改修')
  assert.ok(
    !consumed.includes('equip-upgrades'),
    '那个自取包还挂在运行时读取清单里——它已经降级成维护者侧对照票了',
  )
  assert.ok(
    NEVER_BUNDLED_LODE_IDS.includes('equip-upgrades'),
    '那个自取包没进「永不随包」名单——降级要钉死，不能只靠「反正没标 bundle」',
  )
  assert.ok(!BUNDLED_LODE_IDS.includes('equip-upgrades'), '降级了却还在随包名单里')
})

test('置信档的判定真调用：四档各认得出，认不出的一律当默认档', async () => {
  const { improveBasisTier, improveEntryTier } = await import('../dist/shared/equip-sources.js')
  assert.equal(improveBasisTier('游戏内实测 2026-08-25'), 'measured')
  assert.equal(improveBasisTier('机制通则推定 · 2026-08-25'), 'rule')
  assert.equal(improveBasisTier('整理参照·交叉核对 · 官方公告 2024-05-29 佐证'), 'official')
  assert.equal(improveBasisTier('整理参照·交叉核对'), 'default')
  // 认不出的落默认档：宁可少挂一枚角标，也不要凭空宣称一个更高的置信
  assert.equal(improveBasisTier('天知道'), 'default')
  assert.equal(improveBasisTier(null), 'default')

  // 件级：提醒不许被加分压掉
  const rows = (...list) => list.map((basis) => ({ basis }))
  assert.equal(
    improveEntryTier(rows('游戏内实测 2026-08-25', '机制通则推定 · 2026-08-25')),
    'rule',
    '同一件里既有实测又有推定时，该显示的是「这里有格子是推的」',
  )
  assert.equal(improveEntryTier(rows('整理参照·交叉核对', '游戏内实测 2026-08-25')), 'measured')
  assert.equal(improveEntryTier(rows('整理参照·交叉核对')), 'default')
  assert.equal(improveEntryTier([]), 'default')
})

test('改修卡的角标按置信档挂，且三句说明都不点名转录者', () => {
  const ji = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  assert.ok(ji.includes('improveTierMark'), '改修卡没有置信角标')
  assert.ok(/case 'rule':[\s\S]{0,400}补档/.test(ji), '「补档」角标没挂在推定那一档上')
  assert.ok(/case 'measured':[\s\S]{0,300}实测/.test(ji), '「实测」角标没挂在实测那一档上')
  assert.ok(/case 'official':[\s\S]{0,300}官方/.test(ji), '「官方」角标没挂在官方公告那一档上')
  // 角标是置信提示，不是来源声明（纪律七之三：署名集中在钥的资料页与 NOTICE）
  const mark = ji.slice(ji.indexOf('const improveTierMark'), ji.indexOf('const improveTierMark') + 1500)
  for (const name of ['wikiwiki', 'kcwiki', '舰娘百科', '上游']) {
    assert.ok(!mark.includes(name), `角标说明里出现了「${name}」——那是来源声明不是置信提示`)
  }
})

test('与对照票的差异只出现在裁过的那些装备上，没有一件是被顺手改的', async (t) => {
  const upstreamFile = new URL('../assets/lodes/equip-upgrades.json', import.meta.url)
  if (!fs.existsSync(upstreamFile)) {
    t.skip('本机没有维护者侧的对照票（玩家机器上本来就没有）')
    return
  }
  const pack = table()
  if (!pack) return
  const raw = JSON.parse(fs.readFileSync(upstreamFile, 'utf8')).data
  const upstream = new Map(
    (Array.isArray(raw) ? raw : Object.values(raw ?? {})).map((one) => [Number(one.eq_id), one]),
  )
  const stage = (one) =>
    one
      ? [one.devmats ?? '', one.devmats_sli ?? '', one.screws ?? '', one.screws_sli ?? '',
         (one.equips ?? []).map((e) => `${e.id}x${e.eq_count}`).join(',')].join('/')
      : '—'
  const key = (row) =>
    [Number(row?.convert?.id_after) || 0,
     (row?.helpers ?? []).flatMap((h) => (h?.ship_ids ?? []).map(Number)).sort((a, b) => a - b).join('.')].join('#')

  // 差异本身不是问题——逐件裁过的那几件本来就该与对照票不同（那正是裁决的意义），
  // 「照公开资料补上对照票缺的一段」同样落在默认档，那也是正当的。
  // 真正要防的是**合成器动了没人裁过的装备**：那种改动看不出、也说不清。
  const corrections = (await import('../dist/shared/equip-upgrade-corrections.js')).default
  const judged = new Set([
    ...corrections.EQUIP_UPGRADE_CORRECTIONS.map((one) => one.eqId),
    ...corrections.EQUIP_UPGRADE_LADDER_FILLS.map((one) => one.eqId),
  ])

  const differing = new Set()
  for (const entry of pack.data) {
    const other = upstream.get(entry.eq_id)
    if (!other) continue
    const otherRows = new Map((other.improvement ?? []).map((row) => [key(row), row]))
    for (const row of entry.improvement) {
      const match = otherRows.get(key(row))
      if (!match) continue
      if (['p1', 'p2', 'conv'].some((seg) => stage(row.costs?.[seg]) !== stage(match.costs?.[seg])))
        differing.add(entry.eq_id)
    }
  }
  assert.ok(differing.size > 0, '一处差异都没有？那几件裁过的格子本该与对照票不同')
  for (const eqId of differing) {
    assert.ok(
      judged.has(eqId),
      `eq_id=${eqId} 与对照票不同，却在裁决台账里查无此件` +
        '——合成器动了没人裁过的装备，这种改动看不出也说不清',
    )
  }
})

// ---- 出处克制（第 3 步）----
//
// 用户定的口径：来源说明只留在钥的「资料来源与许可」与 NOTICE 两处，
// 玩家主界面不新增任何来源标注，且那两处也不点名具体的转录站点。
// 他的理由两条：玩家看的是结果，多一句来源只冲淡观感；点名等于告诉人家这里有地雷。

test('署名两处都到位：NOTICE 点得出文件，钥的资料页归得到组', async () => {
  const notice = fs.readFileSync(new URL('../NOTICE.md', import.meta.url), 'utf8')
  assert.ok(notice.includes('equip-improve.json'), 'NOTICE 里没有事实表——随分发物的声明漏了它')
  assert.ok(
    notice.includes('equip-upgrade-corrections.ts'),
    'NOTICE 里没有裁决台账——它随源码分发，同样该点得出来',
  )
  const credits = (await import('../dist/shared/lode-credits.js')).default
  const group = credits.LODE_CREDIT_SOURCES.find((one) => one.lodeIds.includes('equip-improve'))
  assert.ok(group, '钥的资料页里没有一组认领事实表')
  assert.equal(group.key, 'kanso', '事实表被归到了别人名下——它是第一方整理')
})

test('NOTICE 的措辞红线：不出现「转载」「搬运」这类说法', () => {
  const notice = fs.readFileSync(new URL('../NOTICE.md', import.meta.url), 'utf8')
  for (const word of ['转载', '搬运', '来源 wikiwiki', '来源为 wikiwiki']) {
    assert.ok(!notice.includes(word), `NOTICE 里出现了「${word}」——那不是这些台账的性质`)
  }
})

test('钥资料页那一组的措辞：说清置信怎么来的，不点名任何站点', async () => {
  const credits = (await import('../dist/shared/lode-credits.js')).default
  const group = credits.LODE_CREDIT_SOURCES.find((one) => one.key === 'kanso')
  const text = `${group.provides}${group.detail}`
  // 这一组是「艦素自行整理」，点名别人等于把署名散到这里来
  for (const name of ['wikiwiki', 'kcwiki', '舰娘百科', 'KC3Kai', 'akashi']) {
    assert.ok(!text.includes(name), `第一方那一组的说明里出现了「${name}」`)
  }
  // 改修这一块要让玩家看懂：置信分档说得出来
  assert.ok(/改修/.test(text), '资料页没提改修数据')
  assert.ok(/实测/.test(text), '没说清「在游戏里实测过」是更硬的一档')
  // 「两份资料打架时不替你猜一个值」这句 2026-08-26 文案清扫随维护者第一人称长段删了
  //（族 D/F，用户批复的拟稿）。纪律本身不在那句话里——它在补值器的弃权分支上，
  // 改钉那条实现：同一档消耗对不上就整件弃权，绝不挑一个填进去。
  const fill = fs.readFileSync(
    new URL('../src/shared/equip-upgrade-corrections.ts', import.meta.url),
    'utf8',
  )
  assert.match(fill, /return \{ improvement: null, conflict: true \}/, '同档消耗打架时不再弃权')
  assert.match(fill, /reason: 'stage-conflict'/, '弃权没有落进报告，静默猜值查不出来')
})

test('玩家主界面没有新增来源标注：改修卡上仍旧只有那一枚「源」记号', () => {
  const ji = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  // 置信角标不是来源声明——它说的是「这个数有多硬」，与署名无关
  const marks = ji.match(/lodeCreditMark\(eoLode/g) ?? []
  assert.equal(
    marks.length,
    2,
    `改修那一块的「源」记号有 ${marks.length} 处（原本 2 处：暂无收录那一支与改修卡各一）` +
      '——出处克制口径下不新增来源标注',
  )
  // 那 2 处都在卡级（整块改修的页脚），不在逐条方案里：逐条署名是明令禁止的
  //（纪律七之三：「千万不要每一条信息下面都放一个贞操锁」）。
  // 数目钉住就够——它涨了必然是有人在某处又挂了一枚，那时再看挂在哪一层。
  assert.ok(
    !ji.includes('lodeCreditMark(eoLode.meta)}</span>'),
    '「源」记号被塞进了逐条方案的行内',
  )
})

test('打包不会把事实表滤掉，也不会把退役的对照票放进去', async () => {
  const { isPackageIgnored } = await import('../scripts/lib/package-ignore.mjs')
  // 这一条钉的是**玩家那份产物里到底有没有它**——件 J 的全部意义就在这儿。
  // 实打包核对过：25 个矿脉包进了 app.asar，事实表在其中，对照票不在。
  assert.equal(
    isPackageIgnored('/assets/lodes/equip-improve.json'),
    false,
    '事实表被打包过滤掉了——玩家的改修卡还是会整块「待补」',
  )
  assert.equal(
    isPackageIgnored('/assets/lodes/equip-upgrades.json'),
    true,
    '退役的对照票混进了产物——它上游无许可，只该留在维护者机器上',
  )
})
