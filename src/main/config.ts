// 配置中枢（钥的雏形）。接口同构自 poi lib/config.ts（get/set/getDefault/on），
// 实现重写：JSON 存储、无第三方依赖。
import { EventEmitter } from 'events'
import fs from 'fs'
import path from 'path'

import { atomicWriteJsonSync } from './atomic-json'
import { APPDATA_PATH, DEFAULT_CACHE_PATH } from './env'
import { LAUNCH_GLOW_DEFAULT } from '../shared/launch-glow'

const CONFIG_PATH = path.join(APPDATA_PATH, 'config.json')

const DEFAULTS: Record<string, unknown> = {
  proxy: {
    use: 'none', // 'none' | 'socks5' | 'http' | 'pac'
    socks5: { host: '127.0.0.1', port: 1080 },
    http: { host: '127.0.0.1', port: 8118, requirePassword: false, username: '', password: '' },
    pacAddr: '',
  },
  kanso: {
    homepage: 'https://play.games.dmm.com/game/kancolle',
    // DMM 地区 cookie 兜底默认开启（poi 默认关，但对本项目的目标用户这是刚需）
    dmmcookie: true,
    // 把 dmm 域会话 cookie 复写为持久 cookie，重启免登录
    persistLogin: true,
    disablenetworkalert: false,
    cache: { path: DEFAULT_CACHE_PATH },
    // 静态美术/语音服务器与账号镇守府绑定；记住上次识别结果，重启后无需等登录 API。
    lastGameHost: '',
    // 游戏画面上的语音字幕/战斗弹幕；关闭只影响文字，不影响游戏原声。
    voiceCaptions: true,
    // 游戏实际播放的总音量、语音/BGM 分项增益与内容过滤；不改游戏自身设置。
    gameAudio: { volume: 1, voiceVolume: 1, bgmVolume: 1, mode: 'all' },
    // 新舰 / 大破 / 应急修理的置顶横幅及应用外框光效；铃中的事件记录不受影响。
    eventBannerEffects: true,
    // 出击中舰娘被击沉后的哀悼视觉（界面失色 + 编队卡碎裂），到返港为止。
    // 关掉只是不画，击沉本身照样进铃的通知与记录。
    sunkEffects: true,
    // 启动时先来一屏「欢迎返港」等舰C加载，随后顺次点亮各面板、最后亮起游戏画面
    //（默认关）。
    // 默认值取自 shared/launch-glow：钥的开关与镇壳的读取都引同一份，别在这里写字面量。
    launchGlow: LAUNCH_GLOW_DEFAULT,
    network: { customCertificateAuthority: '' },
    trustedCerts: [] as string[],
  },
}

const getByPath = (obj: unknown, keys: string[]): unknown =>
  keys.reduce<unknown>((cur, key) => (cur as Record<string, unknown>)?.[key], obj)

const setByPath = (obj: Record<string, unknown>, keys: string[], value: unknown) => {
  let cur = obj
  for (const key of keys.slice(0, -1)) {
    if (typeof cur[key] !== 'object' || cur[key] === null) cur[key] = {}
    cur = cur[key] as Record<string, unknown>
  }
  cur[keys.at(-1) as string] = value
}

class KansoConfig extends EventEmitter {
  private data: Record<string, unknown> = {}

  constructor() {
    super()
    try {
      this.data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
    } catch (_e) {
      this.data = {}
    }
  }

  get = (configPath: string, fallback?: unknown): any => {
    const keys = configPath.split('.')
    const value = getByPath(this.data, keys)
    if (value !== undefined) return value
    return this.getDefault(configPath, fallback)
  }

  getDefault = (configPath: string, fallback?: unknown): any => {
    const value = getByPath(DEFAULTS, configPath.split('.'))
    // 对象要发深拷贝：把 DEFAULTS 子对象的引用交出去，调用方就地改字段
    // 会污染全局默认值，而且不触发保存与事件
    if (value !== undefined) {
      return typeof value === 'object' && value !== null ? JSON.parse(JSON.stringify(value)) : value
    }
    return fallback
  }

  set = (configPath: string, value: unknown): void => {
    // `===` 相等早退只对原始值成立：调用方复用同一对象引用改字段再 set，
    // 引用相等会让它既不落盘也不 emit——对象一律走完整写入
    if (typeof value !== 'object' || value === null) {
      if (this.get(configPath) === value) return
    }
    setByPath(this.data, configPath.split('.'), value)
    this.emit('config.set', configPath, value)
    this.save()
  }

  save = () => {
    try {
      // 配置是人会打开看的，保留缩进
      atomicWriteJsonSync(CONFIG_PATH, this.data, { pretty: true })
    } catch (e) {
      console.warn('[kanso] config save failed', e)
    }
  }

  // 完整备份只通过显式用户操作调用。返回深拷贝，避免备份序列化期间
  // 其它 config.set 改动同一个引用；配置内可能含代理凭据，设置页会明确提示。
  snapshot = (): Record<string, unknown> =>
    JSON.parse(JSON.stringify(this.data)) as Record<string, unknown>

  restoreSnapshot = (value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('备份中的配置结构无效')
    }
    const serialized = JSON.stringify(value)
    if (serialized.length > 4 * 1024 * 1024) throw new Error('备份中的配置异常过大')
    this.data = JSON.parse(serialized)
    this.save()
    this.emit('config.restore')
  }
}

// export = ：让 webview preload 里的 remote.require('./config') 直接拿到实例
const config = new KansoConfig()

export = config
