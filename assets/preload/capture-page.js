// Adapted from poi (https://github.com/poooi/poi) assets/js/capture-page.js
// MIT License, Copyright (c) poi contributors — 移植与改造：艦素 kanso 项目。
// MAIN WORLD
// window.capture 由宿主经 executeJavaScript 调用（页面主世界）。
// 依赖 resource-hack 维持的 canvas 无污染状态。
function installCapturePage() {
  window.capture = async function () {
    try {
      const canvas = document.querySelector('#game_frame')
        ? document
            .querySelector('#game_frame')
            .contentDocument.querySelector('#htmlWrap')
            .contentDocument.querySelector('canvas')
        : document.querySelector('#htmlWrap')
          ? document.querySelector('#htmlWrap').contentDocument.querySelector('canvas')
          : document.querySelector('canvas')
            ? document.querySelector('canvas')
            : null
      if (!canvas || !ImageCapture) return undefined
      const imageCapture = new ImageCapture(canvas.captureStream(0).getVideoTracks()[0])
      const imageBitmap = await imageCapture.grabFrame()
      const tempCanvas = document.createElement('canvas')
      tempCanvas.width = imageBitmap.width
      tempCanvas.height = imageBitmap.height
      tempCanvas.getContext('2d').drawImage(imageBitmap, 0, 0)
      return tempCanvas.toDataURL()
    } catch (e) {
      console.error(e)
      return undefined
    }
  }
}

module.exports = { installCapturePage }
