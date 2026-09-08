// 一页只挂一枚清空钮：事件委托接住后来重画的文本框，不进入数据更新的渲染路径。
export function initInputClear(): void {
  const button = document.createElement('button')
  button.id = 'input-clear'
  button.type = 'button'
  button.title = '清空'
  button.textContent = '×'
  button.hidden = true
  document.body.appendChild(button)

  let current: HTMLInputElement | null = null
  let hovered: EventTarget | null = null
  const hide = () => {
    current?.classList.remove('has-clear')
    current = null
    button.hidden = true
    removal.disconnect()
  }
  // innerHTML 移除焦点框未必派发 focusout。只在显示期间浅观察祖先链的 childList，
  // 不开 subtree、不扫描新增节点；任一层被换掉后只查 isConnected，隐藏即解除观察。
  const removal = new MutationObserver(() => {
    if (current && !current.isConnected) hide()
  })

  const show = (target: EventTarget | null, preserveFocused = false) => {
    const keepCurrent = preserveFocused && current === document.activeElement
    if (!keepCurrent) hide()
    if (!(target instanceof HTMLInputElement) || !target.isConnected ||
        !['text', 'search', 'url'].includes(target.type) || target.readOnly || target.disabled ||
        target.hasAttribute('data-no-clear') || (target.maxLength >= 0 && target.maxLength <= 4) ||
        !target.value) return
    const rect = target.getBoundingClientRect()
    if (rect.width < 96 || rect.height <= 0) return
    if (keepCurrent) hide()
    current = target
    target.classList.add('has-clear')
    button.style.left = `${rect.right - 4 - 16}px`
    button.style.top = `${rect.top + (rect.height - 16) / 2}px`
    button.hidden = false
    for (let parent = target.parentElement; parent; parent = parent.parentElement) {
      removal.observe(parent, { childList: true })
    }
  }

  document.addEventListener('focusin', (event) => show(event.target))
  document.addEventListener('focusout', (event) => {
    if (event.target === current) hide()
  })
  document.addEventListener('pointerover', (event) => {
    if (event.target === button) return
    hovered = event.target
    show(event.target, true)
  })
  document.addEventListener('pointerout', (event) => {
    if (event.target === hovered) hovered = null
    if (current === document.activeElement) return
    if ((event.target === current || event.target === button) &&
        event.relatedTarget !== current && event.relatedTarget !== button) hide()
  })
  document.addEventListener('input', (event) => {
    if (event.target === document.activeElement || event.target === hovered || event.target === current) {
      show(event.target)
    } else if (current && !current.isConnected) hide()
  })
  document.addEventListener('scroll', hide, true)
  window.addEventListener('resize', hide)
  button.addEventListener('pointerdown', (event) => event.preventDefault())
  button.addEventListener('click', () => {
    const target = current
    if (!target?.isConnected) {
      hide()
      return
    }
    target.value = ''
    target.dispatchEvent(new Event('input', { bubbles: true }))
    target.dispatchEvent(new Event('change', { bubbles: true }))
    target.focus()
    hide()
  })
}
