// 隔离世界只报告进出；以本帧画布的实时矩形为参照，不接触页面主世界。
const {
  CAPTION_ZONE_CHANNEL,
  CAPTION_HOVER_CHANNEL,
  sanitizeCaptionZone,
  pointerInZone,
} = require('../../dist/shared/caption-dodge')

const installCaptionDodge = (ipcRenderer) => {
  let zone = null
  let inside = false
  let installed = false
  let pending = false
  let pointer = null

  const report = (next) => {
    if (next === inside) return
    inside = next
    ipcRenderer.send(CAPTION_HOVER_CHANNEL, inside)
  }
  const leave = () => {
    pointer = null
    report(false)
  }
  const schedule = () => {
    if (pending) return
    pending = true
    requestAnimationFrame(() => {
      pending = false
      if (!zone || !pointer) return
      const canvas = document.querySelector('canvas')
      if (!canvas) return leave()
      const rect = canvas.getBoundingClientRect()
      report(rect.width > 0 && rect.height > 0 && pointerInZone(
        zone,
        (pointer.x - rect.left) / rect.width,
        (pointer.y - rect.top) / rect.height,
      ))
    })
  }

  ipcRenderer.on(CAPTION_ZONE_CHANNEL, (_event, raw) => {
    zone = sanitizeCaptionZone(raw)
    if (!zone) return leave()
    if (!installed && document.querySelector('canvas')) {
      installed = true
      document.addEventListener('mousemove', (event) => {
        if (!zone) return
        pointer = { x: event.clientX, y: event.clientY }
        schedule()
      }, { passive: true })
      document.addEventListener('mouseleave', leave)
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) leave()
      })
    }
    if (pointer) schedule()
  })
}

module.exports = { installCaptionDodge }
