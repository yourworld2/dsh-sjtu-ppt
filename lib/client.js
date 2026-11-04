// 交大演示 · DeepSeek Harness 插件：浏览器半边
//   - 侧栏加一个「交大演示」入口，主区域是插件页面（/sjtu-ppt/，iframe）
//   - 页面里点「让 AI 写」：页面 postMessage 一段草稿，这里开一个新对话并把草稿填进输入框
window.__ModuleLoader__.load({
  id: 'dsh-sjtu-ppt',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement
    const PANEL = 'sjtu-ppt'
    const SRC = '/sjtu-ppt/'

    // 侧栏图标：一份带红色书脊的演示稿
    function DeckIcon(props) {
      const s = (props && props.size) || 18
      return h(
        'svg',
        { width: s, height: s, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
        h('rect', { x: 2.6, y: 4, width: 18.8, height: 16, rx: 2.2, stroke: 'currentColor', strokeWidth: 1.5 }),
        h('path', { d: 'M2.6 6.2A2.2 2.2 0 0 1 4.8 4h3.1v16H4.8a2.2 2.2 0 0 1-2.2-2.2z', fill: '#C8161E' }),
        h('path', { d: 'M11.2 9h6.8M11.2 12.4h6.8M11.2 15.8h4.2', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', opacity: 0.85 }),
      )
    }

    function apply(ctx) {
      // 明暗跟随 dsh：主题服务在的话，把当前配色发给页面，切换时再发
      const frames = new Set()
      let scheme = null
      const post = (frame) => scheme && frame.contentWindow && frame.contentWindow.postMessage({ type: 'sjtu-ppt:scheme', scheme }, location.origin)
      ctx.inject(['theme'], (c) => {
        const push = (snap) => {
          scheme = snap.active.colorScheme
          frames.forEach(post)
        }
        push(c.theme.getTheme())
        c.on('theme/change', push)
      })

      function DeckPanel() {
        const ref = React.useRef(null)
        React.useEffect(() => {
          const self = ref.current
          if (self) frames.add(self)
          function onMessage(e) {
            const frame = ref.current
            if (!frame || e.source !== frame.contentWindow || e.origin !== location.origin) return
            const m = e.data
            if (!m || m.type !== 'sjtu-ppt:start' || typeof m.prompt !== 'string') return
            try {
              ctx.uiWorkspace.startSession(undefined, { prompt: m.prompt, whenDraftExists: 'replace' })
            } catch (err) {
              console.error('[sjtu-ppt] 开新对话失败', err)
              frame.contentWindow.postMessage({ type: 'sjtu-ppt:start-failed', message: String((err && err.message) || err) }, location.origin)
            }
          }
          addEventListener('message', onMessage)
          return () => {
            removeEventListener('message', onMessage)
            frames.delete(self)
          }
        }, [])
        return h('iframe', {
          ref,
          src: SRC,
          title: '交大演示',
          allow: 'fullscreen',
          onLoad: (e) => post(e.currentTarget),
          style: { width: '100%', height: '100%', border: 0, display: 'block' },
        })
      }

      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register({ name: 'sidebar.panellist', id: PANEL, order: 5, label: () => '交大演示' }, DeckIcon),
      )
      ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL }, DeckPanel))
    }

    exports.isPlugin = true
    exports.inject = ['slots', 'uiWorkspace']
    exports.apply = apply
    return module.exports
  },
})
