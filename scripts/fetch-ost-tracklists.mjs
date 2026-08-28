// 官方 OST 曲名参考总库的抓取器（**维护者侧**，运行时零读取、不随包）。
//
// ## 为什么要这一份
//
// 曲名这件事，本仓有三层来源：拆包层（站方编辑照官方曲目表**手打**）、
// 第一方耳测层（提督亲耳听）、母港主数据（游戏自己发，只覆盖母港树的一部分）。
// 前两层都经过人的手，而 2026-08-24 一天之内就逮到两笔字形错：
// 124 号上游把「決戦！北大西洋」打成「北太平洋」（太/大），
// 拆包层 109 写的是繁体「出擊前夜」（官方日文用新字体「撃」）。
// 一笔之差不报错、不显眼，只有拿**官方曲目表**逐字对才照得出来。
//
// 网易云是持牌平台，舰これ历代 OST 九卷都有正式专辑页，曲目表是发行方（Kadokawa）
// 报上去的官方曲名。所以它当**对账原料**：不是判决书，是能一次性铺开 200 多个
// 官方曲名的字形底本。
//
// ## 这份数据的三条边界（写在这里，也写进产物的 note 里）
//
// ① **约物不是官方原样**。平台会把曲名里的标点归一：全角「！」写成半角「!」，
//    括号前后补空格。所以**约物差异一律不算发现**，比对时先归一再比，
//    真正照得出来的是汉字/假名那一档（太/大、擊/撃、平假名片假名混写）。
// ② **时长是碟面版，不是游戏内版**。碟面收的是完整版，游戏内是循环剪辑版——
//    实案在档：「華の二水戦」碟面 2:53、游戏内 1:28。所以这一列**绝不许喂给
//    时长对齐**（scripts/bgm-duration-align.mjs）。收它只为人眼参考。
// ③ **专辑收录 ≠ 游戏内编号**。碟上有的曲子游戏里可能改过名/没实装/换过号，
//    碟序更不是资源号。这份表只能给候选，定名仍要耳测或官宣。
//
// ## 网络礼貌
//
// 九张专辑页 + 一次检索页，两次请求之间等一拍。`--discover` 才发检索请求，
// 平时只按下面钉好的 ID 逐张取——ID 钉死也是为了可复现：改版了要人来看，
// 不许悄悄换一张专辑继续跑。
import { readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(root, 'scripts', 'ost-tracklists.json')

// `os=pc` 这条 cookie 是必须的，**不是伪装**：不带它服务端会走「未登录移动端」那条
// 风控分支，返回 `code -462「请绑定手机后再试哦~」`（实测，同一个 ID 带上就是 200）。
// 带它相当于声明「我在读你们的 PC 网页版专辑页」，取到的也正是那一页公开显示的曲目表。
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Referer: 'https://music.163.com/',
  'Accept-Language': 'zh-CN,zh;q=0.9,ja;q=0.8',
  Cookie: 'os=pc; appver=2.9.7; osver=Microsoft-Windows-10',
}

/**
 * 九卷的专辑 ID，逐张钉死。
 *
 * `vol` 是官方卷号（第一张 2014 年那本身没印 vol.，社区与本仓一律记作 vol.I），
 * `volName` 是卷名那个汉字——本仓别处引用官方曲目表时写的就是这个字
 *（如 kcwiki-bgm 的转写台账写「OST vol.VI【雪】」）。
 * `tracks` 是检索页报的曲目数，抓下来对不上就告警：那说明专辑页改版或换了版本。
 */
const ALBUMS = [
  { id: 3103387, vol: 'I', volName: '暁', tracks: 16 },
  { id: 3211826, vol: 'II', volName: '風', tracks: 18 },
  { id: 34590316, vol: 'III', volName: '雲', tracks: 24 },
  { id: 72316755, vol: 'IV', volName: '雨', tracks: 28 },
  { id: 78530073, vol: 'V', volName: '波', tracks: 25 },
  { id: 147600544, vol: 'VI', volName: '雪', tracks: 27 },
  { id: 147531398, vol: 'VII', volName: '夕', tracks: 26 },
  { id: 166857729, vol: 'VIII', volName: '夜', tracks: 28 },
  { id: 198558661, vol: 'IX', volName: '護', tracks: 26 },
]

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const fmtDuration = (ms) => {
  const total = Math.round(ms / 1000)
  return `${Math.floor(total / 60)}:${`${total % 60}`.padStart(2, '0')}`
}

const fetchAlbum = async (entry) => {
  const url = `https://music.163.com/api/album/${entry.id}`
  const res = await fetch(url, { headers: HEADERS })
  if (!res.ok) throw new Error(`${entry.volName} 卷取不回来：HTTP ${res.status}`)
  const body = await res.json()
  if (body.code !== 200) throw new Error(`${entry.volName} 卷返回 code ${body.code}`)
  const album = body.album
  if (!album) throw new Error(`${entry.volName} 卷没有 album 段`)
  const songs = album.songs ?? []
  if (!songs.length) throw new Error(`${entry.volName} 卷曲目表是空的`)
  // 卷名核对：专辑标题里必须含我们钉的那个字，否则就是 ID 指到了别的碟
  if (!album.name.includes(entry.volName)) {
    throw new Error(`专辑 ${entry.id} 的标题「${album.name}」里没有卷名「${entry.volName}」`)
  }
  return {
    vol: entry.vol,
    volName: entry.volName,
    albumId: entry.id,
    title: album.name,
    company: album.company ?? null,
    publishedAt: album.publishTime ? new Date(album.publishTime).toISOString().slice(0, 10) : null,
    url: `https://music.163.com/album?id=${entry.id}`,
    tracks: songs
      .map((song) => ({
        no: song.no,
        name: song.name,
        durationMs: song.duration,
        duration: fmtDuration(song.duration),
      }))
      .sort((a, b) => a.no - b.no),
  }
}

/** 只在 --discover 时发这一次检索请求：看看有没有新卷 */
const discover = async () => {
  const res = await fetch('https://music.163.com/api/search/get/web?csrf_token=', {
    method: 'POST',
    headers: { ...HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      s: 'KanColle Original Sound Track',
      type: '10',
      offset: '0',
      total: 'true',
      limit: '40',
    }),
  })
  const body = await res.json()
  const found = body.result?.albums ?? []
  const known = new Set(ALBUMS.map((a) => a.id))
  console.log(`[ost] 检索到 ${found.length} 张专辑`)
  for (const album of found) {
    const mark = known.has(album.id) ? '已收' : '**新卷？**'
    console.log(`  ${mark} ${album.id} ${album.name}（${album.size} 曲）`)
  }
}

const main = async () => {
  if (process.argv.includes('--discover')) {
    await discover()
    return
  }
  const albums = []
  const warnings = []
  for (const entry of ALBUMS) {
    const album = await fetchAlbum(entry)
    if (album.tracks.length !== entry.tracks) {
      warnings.push(
        `vol.${entry.vol}【${entry.volName}】曲目数 ${album.tracks.length}，清单记的是 ${entry.tracks}——专辑页改版了，人工核对后再改 ALBUMS`,
      )
    }
    const nos = album.tracks.map((t) => t.no)
    if (new Set(nos).size !== nos.length) {
      warnings.push(`vol.${entry.vol}【${entry.volName}】曲序有重复：${nos.join(',')}`)
    }
    albums.push(album)
    console.log(`[ost] vol.${entry.vol}【${entry.volName}】${album.tracks.length} 曲`)
    await sleep(1200)
  }
  const total = albums.reduce((sum, a) => sum + a.tracks.length, 0)
  const previous = (() => {
    try {
      return JSON.parse(readFileSync(OUT, 'utf8'))
    } catch {
      return null
    }
  })()
  // 熔断：曲目总数塌了说明上游改版或被限流，不许拿残缺结果覆盖已有的表
  if (previous && total < previous.trackCount * 0.9) {
    throw new Error(`只抓到 ${total} 曲，已有的表有 ${previous.trackCount} 曲——不覆盖，先人工看`)
  }
  writeFileSync(
    OUT,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        fetchedAt: new Date().toISOString(),
        source: '网易云音乐 · 舰これ官方 OST 专辑页（发行方 Kadokawa 报送的曲目表）',
        sourceUrl: 'https://music.163.com/album?id=3103387',
        albumCount: albums.length,
        trackCount: total,
        note: [
          '**维护者侧对账原料，运行时零读取、不随包**（scripts/ 整个目录都在 package-ignore 里）。',
          '用途只有一个：拿官方曲目表逐字校我们自己收的曲名字形（太/大、擊/撃 这一档）。审计器是 scripts/bgm-name-audit.mjs。',
          '⚠ **约物不是官方原样**：平台把全角「！」归一成半角「!」、括号前后补空格。所以约物差异不算发现，比对前先归一。',
          '⚠ **时长是碟面完整版，不是游戏内循环版**（实案：華の二水戦 碟面 2:53 / 游戏内 1:28）。**绝不许喂给 scripts/bgm-duration-align.mjs**，收它只为人眼参考。',
          '⚠ **专辑收录 ≠ 游戏内编号**：碟序不是资源号，碟上有的曲子游戏里可能没实装或改过号。这份表只出候选，定名仍要耳测或官宣。',
        ],
        warnings,
        albums,
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
  console.log(`[ost] ${albums.length} 卷 ${total} 曲 → ${path.relative(root, OUT)}`)
  for (const line of warnings) console.warn(`[ost] ⚠ ${line}`)
}

await main()
