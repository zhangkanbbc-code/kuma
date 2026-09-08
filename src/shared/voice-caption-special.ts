// 特殊攻击号令独立于普通战斗弹幕；钥与字幕层共用这份值域和默认值。
export const VOICE_CAPTION_SPECIAL_PATH = 'kuma.voiceCaptionsSpecial'
export const VOICE_CAPTION_SPECIAL_DEFAULT = true

export const normalizeSpecialCaptionStyle = (raw: unknown): boolean =>
  // 旧 cutin / center 对应开启，top 对应关闭；其它值默认开启。
  raw === false || raw === 'top' ? false : VOICE_CAPTION_SPECIAL_DEFAULT
