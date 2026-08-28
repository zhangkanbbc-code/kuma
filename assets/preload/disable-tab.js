// Adapted from poi (https://github.com/poooi/poi) assets/js/disable-tab.js
// MIT License, Copyright (c) poi contributors — 移植与改造：艦素 kanso 项目。
// MAIN WORLD
// Tab 键会把焦点切出游戏 canvas，按原版行为在页面主世界屏蔽。
function installDisableTab() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      if (!['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(e?.target?.tagName)) {
        e.preventDefault()
      } else if (
        e?.target?.baseURI?.includes('kancolle-server') ||
        e?.target?.baseURI?.includes('kcsapi')
      ) {
        e.preventDefault()
      }
    }
  })
}

module.exports = { installDisableTab }
