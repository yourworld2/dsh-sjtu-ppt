/* 交大演示 · 侧栏工作台
   纯原生 JS：模板卡、封面实时预览、正文页编辑、生成与最近文件。 */

const STORE_KEY = 'sjtu-ppt:draft:v1'
const MODE_KEY = 'sjtu-ppt:mode:v1'
const THUMB_BASE = '/sjtu-ppt/assets/thumbs/'
const ASSET_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4', 'mov', 'webm', 'm4v', 'mp3', 'wav', 'm4a', 'aac', 'ogg'])
const UPDATE_PROMPT = '根据 https://github.com/yourworld2/dsh-sjtu-ppt ，帮我更新已有的插件。'
const ASSET_HINT = {
  toc: '4:3 · 1200×900',
  content: '4:3 · 1600×1200',
  section: '16:9 · 1920×1080',
  end: '16:9 · 1920×1080',
}
const $ = (sel, root = document) => root.querySelector(sel)
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)]

const state = {
  templates: [],
  layouts: [],
  tId: 'basic',
  title: '',
  subtitle: '',
  author: '',
  date: '',
  pageNumbers: true,
  slides: [],
  recent: [],
  materials: [],
  coverAssets: [],
  mode: 'quick',
  quickPages: null,
}

let lastDeck = null
let saveTimer = null

const els = {}

/* ── 数据 ─────────────────────────────────────────────── */

const SAMPLE = () => ({
  tId: 'basic',
  title: '饮水思源 · 年度工作汇报',
  subtitle: '2026 · 上海交通大学',
  author: '张三',
  date: '2026年11月',
  pageNumbers: true,
  slides: [
    { layout: 'toc', title: '目录', content: '年度回顾\n关键数据\n明年计划\n致谢' },
    { layout: 'section', title: '年度回顾', subtitle: '先从三件事说起' },
    {
      layout: 'content',
      title: '三件做成的事',
      content: '完成 A 平台一期上线\nB 项目按期交付\n  C 模块先做试点\n团队从 8 人扩到 12 人',
    },
    {
      layout: 'content',
      title: '关键数据',
      content: 'DAU 同比增长 120%\n  移动端占比 78%\nNPS 提升到 45\n交付周期缩短 30%',
    },
    { layout: 'end', title: '谢谢', subtitle: 'Q&A · 欢迎交流' },
  ],
})

const newSlideUid = () =>
  globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

const LAYOUT_DEFAULT = {
  toc: () => ({ uid: newSlideUid(), layout: 'toc', title: '目录', content: '', assets: [] }),
  content: () => ({ uid: newSlideUid(), layout: 'content', title: '', content: '', assets: [] }),
  section: () => ({ uid: newSlideUid(), layout: 'section', title: '', subtitle: '', assets: [] }),
  end: () => ({ uid: newSlideUid(), layout: 'end', title: '谢谢', subtitle: 'Q&A', assets: [] }),
}

const currentTemplate = () => state.templates.find((t) => t.id === state.tId) || state.templates[0] || null
const templateTitle = (t) => (t ? t.display || `${t.label} ${t.name}` : '')
const layoutInfo = (id) => state.layouts.find((l) => l.id === id) || { id, label: id, hint: '' }

/* ── DOM 小工具 ───────────────────────────────────────── */

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue
    if (key === 'className') node.className = value
    else if (key === 'text') node.textContent = value
    else if (key === 'dataset') Object.assign(node.dataset, value)
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value)
    else node.setAttribute(key, value === true ? '' : String(value))
  }
  for (const child of children.flat()) {
    if (child === undefined || child === null) continue
    node.append(child.nodeType ? child : document.createTextNode(String(child)))
  }
  return node
}

function clear(node) {
  node.replaceChildren()
}

function autoGrow(textarea) {
  textarea.style.height = 'auto'
  textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, 58), 360)}px`
}

function debounceSave() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(saveDraft, 260)
}

function fmtBytes(bytes) {
  if (!bytes) return '—'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function fmtDate(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function toast(message, kind = '', action = null) {
  const stack = els.toasts || $('#toasts')
  const node = el('div', { className: `toast ${kind}`.trim(), text: message })
  if (action) {
    node.style.pointerEvents = 'auto'
    node.append(
      el(
        'button',
        {
          className: 'text-btn',
          type: 'button',
          style: 'margin-left:10px;color:inherit;border-bottom-color:currentColor;font-size:11px;',
          onClick: () => {
            action.onClick()
            node.remove()
          },
        },
        action.label,
      ),
    )
  }
  stack.append(node)
  while (stack.children.length > 3) stack.firstElementChild.remove()
  setTimeout(() => node.remove(), action ? 8000 : 4600)
}

/* ── 封面 mock：结果弹窗 / 缩略图兜底 ───────────────── */

function buildMock(t, opts = {}) {
  if (!t) return el('div', { className: 'mock' })
  const mock = el('div', { className: 'mock', dataset: { art: t.art } })
  mock.style.setProperty('--m-paper', t.paper)
  mock.style.setProperty('--m-ink', t.ink)
  mock.style.setProperty('--m-accent', t.accent)
  mock.style.setProperty('--m-accent2', t.accent2)

  if (t.art === 'wine') {
    mock.append(el('img', { className: 'mock-photo', src: '/sjtu-ppt/assets/covers/wine.jpg', alt: '' }))
  }
  if (t.art === 'star') mock.append(el('div', { className: 'mock-photo', style: `background:url('/sjtu-ppt/assets/covers/star.jpg') center/cover no-repeat` }))
  if (t.art === 'global') mock.append(el('div', { className: 'mock-photo', style: `background:url('/sjtu-ppt/assets/covers/global.jpg') center/cover no-repeat` }))
  if (t.art === 'gate' || t.art === 'gate130' || t.art === 'origin') {
    mock.append(el('img', { className: 'mock-gate', src: '/sjtu-ppt/assets/covers/gate-red.png', alt: '' }))
  }
  if (t.art === 'blue') mock.append(el('img', { className: 'mock-gate', src: '/sjtu-ppt/assets/covers/gate-blue.png', alt: '' }))
  if (t.art === 'origin') mock.append(el('div', { className: 'mock-slot' }))

  const title = (opts.title || (state.title || '').trim() || '饮水思源').slice(0, 48)
  const subtitle = (opts.subtitle || (state.subtitle || '').trim() || '上海交通大学').slice(0, 60)
  const meta = opts.meta || [state.author, state.date].filter(Boolean).join(' · ') || 'SJTU DECK STUDIO'

  mock.append(
    el(
      'div',
      { className: 'mock-copy' },
      el('span', { className: 'mock-kicker', text: t.art === 'wine' ? 'SJTU · 1896' : 'SHANGHAI JIAO TONG UNIVERSITY' }),
      el('span', { className: 'mock-title', text: title }),
      el('span', { className: 'mock-sub', text: subtitle }),
      el('span', { className: 'mock-meta', text: meta }),
    ),
  )
  return mock
}

function renderHero() {
  const t = currentTemplate()
  if (!t) return
  els.heroTemplateName.textContent = templateTitle(t)
}

/* ── 模板 ─────────────────────────────────────────────── */

function thumbFor(t) {
  if (t.thumb) return t.thumb
  if (!t.file) return ''
  return `${THUMB_BASE}${t.file.replace(/\.pptx$/i, '.jpg')}`
}

function syncTemplateActive() {
  for (const card of $$('.tpl-card', els.grid)) {
    const active = card.dataset.template === state.tId
    card.classList.toggle('active', active)
    card.setAttribute('aria-pressed', active ? 'true' : 'false')
  }
}

function renderTemplates() {
  clear(els.grid)
  for (const t of state.templates) {
    const active = t.id === state.tId
    const card = el('button', {
      type: 'button',
      className: `tpl-card${active ? ' active' : ''}`,
      dataset: { template: t.id },
      'aria-pressed': active ? 'true' : 'false',
      'aria-label': `${templateTitle(t)} 模板`,
    })
    const mock = () => buildMock(t, { title: '饮水思源', subtitle: '上海交通大学', meta: 'SJTU · 2026' })
    const src = thumbFor(t)
    const cover = el('div', { className: 'tpl-cover' })
    if (src) {
      const img = el('img', {
        className: 'tpl-thumb',
        src,
        alt: `${templateTitle(t)} 模板封面`,
        loading: 'lazy',
        decoding: 'async',
      })
      img.addEventListener('error', () => img.replaceWith(mock()), { once: true })
      cover.append(img)
    } else {
      cover.append(mock())
    }
    cover.append(el('span', { className: 'tpl-pages', text: '5 页' }))
    card.append(cover)
    card.append(el('span', { className: 'tpl-check', text: '✓' }))
    card.append(
      el(
        'div',
        { className: 'tpl-meta' },
        el('span', { className: 'tpl-name' }, el('b', { text: t.label }), t.display ? '' : ` ${t.name}`),
        el('span', { className: 'tpl-tag', text: t.id === 'basic' ? '默认' : t.image ? '可换图' : '内置' }),
      ),
      el('p', { className: 'tpl-tagline', text: t.tagline }),
    )
    els.grid.append(card)
  }
  renderQuickTemplate()
  hideTemplatePreview()
}

let previewTimer = null
let previewCard = null
const canHover = typeof matchMedia === 'function' ? matchMedia('(hover: hover)').matches : true

function hideTemplatePreview() {
  if (previewTimer) clearTimeout(previewTimer)
  previewTimer = null
  previewCard = null
  if (!els.tplPreview) return
  els.tplPreview.classList.remove('visible')
  els.tplPreview.setAttribute('aria-hidden', 'true')
}

function showTemplatePreview(card) {
  const t = state.templates.find((item) => item.id === card.dataset.template)
  const src = t && thumbFor(t)
  if (!t || !src || !els.tplPreview) return
  els.tplPreviewImg.src = src
  els.tplPreviewImg.alt = `${templateTitle(t)} 整份模板`
  els.tplPreviewCaption.textContent = `${templateTitle(t)} · 5 页`

  const ratio = 2251 / 800
  let width = Math.min(300, Math.max(236, innerWidth * 0.25))
  let height = width * ratio
  const maxHeight = innerHeight - 150
  if (height > maxHeight) {
    height = maxHeight
    width = height / ratio
  }
  const outerWidth = width + 16
  const totalHeight = height + 42
  const rect = card.getBoundingClientRect()

  let left = rect.right + 14
  if (left + outerWidth > innerWidth - 14) left = rect.left - outerWidth - 14
  if (left < 14) left = Math.max(14, Math.min(innerWidth - outerWidth - 14, rect.left + rect.width / 2 - outerWidth / 2))

  let top = rect.top - 16
  top = Math.max(74, Math.min(innerHeight - totalHeight - 14, top))

  els.tplPreview.style.width = `${Math.round(outerWidth)}px`
  els.tplPreview.style.left = `${Math.round(left)}px`
  els.tplPreview.style.top = `${Math.round(top)}px`
  els.tplPreview.classList.add('visible')
  els.tplPreview.setAttribute('aria-hidden', 'false')
}

function renderFacts() {
  const t = currentTemplate()
  if (!t) return
  const swatches = el(
    'span',
    { className: 'swatches' },
    el('i', { className: 'swatch', style: `background:${t.accent}`, title: t.accent }),
    el('i', { className: 'swatch', style: `background:${t.accent2}`, title: t.accent2 }),
  )
  clear(els.tplFacts)
  const rows = [
    ['主色', swatches],
    ['封面', t.image ? '支持图片占位' : '固定图形'],
    ['版式', '封面 / 目录 / 内页 / 过渡 / 封底'],
    ['模板作者', t.author],
  ]
  for (const [label, value] of rows) {
    els.tplFacts.append(el('div', { className: 'fact' }, el('span', { text: label }), el('span', {}, value)))
  }
  els.tplFacts.append(
    el(
      'div',
      { className: 'fact' },
      el('span', { text: '模板文件' }),
      el('a', { className: 'text-btn', href: t.download, download: t.file, text: '下载 .pptx' }),
    ),
  )
}

function setTemplate(id) {
  if (!state.templates.some((t) => t.id === id)) return
  state.tId = id
  hideTemplatePreview()
  syncTemplateActive()
  renderFacts()
  renderHero()
  renderQuickTemplate()
  renderEditNote()
  renderCoverAssets()
  if (state.mode === 'edit') renderSlides()
  updateSummary()
  debounceSave()
}

/* ── 页面编辑 ─────────────────────────────────────────── */

function visibleSlides() {
  return state.slides.filter((s) => {
    if ((s.assets || []).length) return true
    if (s.layout === 'section' || s.layout === 'end') return Boolean((s.title || '').trim() || (s.subtitle || '').trim())
    return Boolean((s.title || '').trim() || (s.content || '').trim())
  })
}

function slidePlaceholder(layout) {
  if (layout === 'toc') return '每行一个目录项，例如：\n年度回顾\n关键数据\n明年计划'
  if (layout === 'content') return '每行一条要点；行首两个空格表示二级：\n完成 A 平台一期上线\n  移动端占比 78%'
  return ''
}

function renderSlides() {
  clear(els.slideList)
  if (!state.slides.length) {
    els.slideList.append(
      el(
        'div',
        { className: 'slide-empty' },
        el('p', { text: '还没有正文页。' }),
        el('button', { className: 'btn sm', type: 'button', dataset: { add: 'content' }, text: '加一页内页' }),
      ),
    )
  }

  state.slides.forEach((slide, index) => {
    const select = el('select', { className: 'layout-select', 'aria-label': `第 ${index + 1} 页版式`, dataset: { index } })
    for (const layout of state.layouts) select.append(el('option', { value: layout.id, text: layout.label }))
    select.value = slide.layout

    const actions = el(
      'div',
      { className: 'slide-actions' },
      el('button', { className: 'icon-btn', type: 'button', dataset: { act: 'up', index }, title: '上移', 'aria-label': '上移', text: '↑' }),
      el('button', { className: 'icon-btn', type: 'button', dataset: { act: 'down', index }, title: '下移', 'aria-label': '下移', text: '↓' }),
      el('button', { className: 'icon-btn danger', type: 'button', dataset: { act: 'remove', index }, title: '删除', 'aria-label': '删除', text: '×' }),
    )

    const card = el('article', { className: 'slide-card', dataset: { index } })
    card.append(el('div', { className: 'slide-head' }, el('span', { className: 'slide-no', text: String(index + 1).padStart(2, '0') }), select, actions))

    const title = el('input', {
      className: 'slide-title',
      type: 'text',
      maxlength: '120',
      value: slide.title || '',
      placeholder: slide.layout === 'end' ? '谢谢' : '这一页的标题',
      dataset: { field: 'title' },
      'aria-label': '页面标题',
    })
    card.append(title)

    if (slide.layout === 'section' || slide.layout === 'end') {
      card.append(
        el('input', {
          className: 'slide-sub',
          type: 'text',
          maxlength: '120',
          value: slide.subtitle || '',
          placeholder: slide.layout === 'end' ? 'Q&A · 欢迎交流' : '一句副标题，可以留空',
          dataset: { field: 'subtitle' },
          'aria-label': '副标题',
        }),
      )
    } else {
      const text = el('textarea', {
        className: 'slide-text',
        rows: '3',
        maxlength: '4000',
        placeholder: slidePlaceholder(slide.layout),
        dataset: { field: 'content' },
        'aria-label': '页面要点',
      })
      text.value = slide.content || ''
      card.append(text)
    }

    card.append(el('p', { className: 'slide-hint', text: layoutInfo(slide.layout).hint }))

    const assets = slideAssets(slide)
    const assetBlock = el('div', { className: 'asset-block slide-assets', dataset: { assetIndex: index } })
    assetBlock.append(
      el(
        'div',
        { className: 'asset-head' },
        el('span', { text: '页面素材' }),
        el('span', { className: 'asset-hint', text: assetHintText(slide.layout) }),
      ),
      renderAssetList(assets, { index }),
      el('button', { className: 'asset-add', type: 'button', dataset: { assetAdd: index }, text: '＋ 图片 / 视频 / 音频' }),
    )
    card.append(assetBlock)
    els.slideList.append(card)
  })

  for (const text of $$('textarea.slide-text', els.slideList)) autoGrow(text)
  updateSummary()
}

function addSlide(layout) {
  const factory = LAYOUT_DEFAULT[layout]
  if (!factory) return
  state.slides.push(factory())
  renderSlides()
  debounceSave()
  requestAnimationFrame(() => {
    const last = els.slideList.lastElementChild
    if (!last) return
    last.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    const input = $('.slide-title', last) || $('textarea', last)
    input?.focus()
  })
}

function onSlideInput(event) {
  const card = event.target.closest('.slide-card')
  if (!card) return
  const index = Number(card.dataset.index)
  const field = event.target.dataset.field
  if (!field || !state.slides[index]) return
  state.slides[index][field] = event.target.value
  if (event.target.tagName === 'TEXTAREA') autoGrow(event.target)
  updateSummary()
  debounceSave()
}

function onSlideClick(event) {
  const button = event.target.closest('[data-act]')
  if (!button) return
  const index = Number(button.dataset.index)
  if (!Number.isInteger(index) || !state.slides[index]) return
  if (button.dataset.act === 'up' && index > 0) {
    ;[state.slides[index - 1], state.slides[index]] = [state.slides[index], state.slides[index - 1]]
  } else if (button.dataset.act === 'down' && index < state.slides.length - 1) {
    ;[state.slides[index + 1], state.slides[index]] = [state.slides[index], state.slides[index + 1]]
  } else if (button.dataset.act === 'remove') {
    state.slides.splice(index, 1)
  } else {
    return
  }
  renderSlides()
  debounceSave()
}

function onLayoutChange(event) {
  const select = event.target.closest('.layout-select')
  if (!select) return
  const index = Number(select.dataset.index)
  const slide = state.slides[index]
  if (!slide) return
  slide.layout = select.value
  if ((slide.layout === 'section' || slide.layout === 'end') && !slide.subtitle) slide.subtitle = ''
  if (slide.layout === 'toc' && !slide.title) slide.title = '目录'
  if (slide.layout === 'end' && !slide.title) slide.title = '谢谢'
  renderSlides()
  debounceSave()
}

/* ── 内容 JSON ────────────────────────────────────────── */

function parseBullets(text) {
  const out = []
  for (const raw of String(text || '').split('\n')) {
    if (!raw.trim()) continue
    const match = raw.match(/^([ \t]*)(.*)$/)
    const indent = match[1].replace(/\t/g, '  ').length
    const body = match[2].replace(/^[-*·•]\s*/, '').trim()
    if (!body) continue
    out.push(indent >= 2 ? { text: body, level: indent >= 4 ? 2 : 1 } : body)
  }
  return out
}

function bulletsToText(items) {
  if (!Array.isArray(items)) return ''
  return items
    .map((item) => {
      if (typeof item === 'string') return item
      if (!item || typeof item !== 'object') return ''
      const level = Math.max(0, Math.min(4, Number(item.level) || 0))
      return `${'  '.repeat(level)}${item.text || ''}`
    })
    .filter((line) => line.trim())
    .join('\n')
}

function toContent() {
  const slides = []
  for (const slide of visibleSlides()) {
    const out = { layout: slide.layout }
    if ((slide.title || '').trim()) out.title = slide.title.trim()
    if ((slide.subtitle || '').trim()) out.subtitle = slide.subtitle.trim()
    const content = parseBullets(slide.content)
    if (content.length) out.content = content
    const image = slideAssets(slide).find((asset) => asset.kind === 'image' && asset.filePath)
    if (image) out.image = image.filePath
    slides.push(out)
  }
  const coverImage = state.coverAssets.find((asset) => asset.kind === 'image' && asset.filePath)
  return {
    title: state.title.trim(),
    subtitle: state.subtitle.trim(),
    date: state.date.trim(),
    author: state.author.trim(),
    page_numbers: state.pageNumbers,
    ...(coverImage ? { cover_image: coverImage.filePath } : {}),
    slides,
  }
}

function cleanAssets(value) {
  if (!Array.isArray(value)) return []
  const out = []
  for (const asset of value) {
    if (!asset || typeof asset !== 'object') continue
    if (typeof asset.id !== 'string' || !/^[a-z0-9-]+$/i.test(asset.id)) continue
    if (!['image', 'video', 'audio'].includes(asset.kind)) continue
    const width = Number(asset.width)
    const height = Number(asset.height)
    out.push({
      id: asset.id,
      name: typeof asset.name === 'string' ? asset.name : '素材',
      ext: typeof asset.ext === 'string' ? asset.ext : '',
      kind: asset.kind,
      bytes: Number(asset.bytes) || 0,
      mime: typeof asset.mime === 'string' ? asset.mime : '',
      width: Number.isFinite(width) && width > 0 ? width : null,
      height: Number.isFinite(height) && height > 0 ? height : null,
      filePath: typeof asset.filePath === 'string' ? asset.filePath : '',
      fileUrl: `/sjtu-ppt/api/materials/${asset.id}/file`,
      createdAt: typeof asset.createdAt === 'string' ? asset.createdAt : '',
    })
  }
  return out
}

function captureDraft() {
  return {
    title: state.title,
    subtitle: state.subtitle,
    author: state.author,
    date: state.date,
    pageNumbers: state.pageNumbers,
    coverAssets: state.coverAssets,
    slides: state.slides.map((s) => ({
      uid: s.uid,
      layout: s.layout,
      title: s.title || '',
      subtitle: s.subtitle || '',
      content: s.content || '',
      assets: s.assets || [],
    })),
  }
}

function applyDraft(data) {
  if (!data || typeof data !== 'object') throw new Error('不是有效的草稿')
  if (typeof data.tId === 'string' && state.templates.some((t) => t.id === data.tId)) state.tId = data.tId
  else if (typeof data.template === 'string' && state.templates.some((t) => t.id === data.template)) state.tId = data.template
  state.title = typeof data.title === 'string' ? data.title : ''
  state.subtitle = typeof data.subtitle === 'string' ? data.subtitle : ''
  state.author = typeof data.author === 'string' ? data.author : ''
  state.date = typeof data.date === 'string' ? data.date : ''
  state.pageNumbers = data.pageNumbers !== false && data.page_numbers !== false
  const slides = Array.isArray(data.slides) ? data.slides : []
  state.slides = slides.slice(0, 80).map((s) => {
    const layout = ['toc', 'content', 'section', 'end'].includes(s.layout) ? s.layout : 'content'
    return {
      uid: typeof s.uid === 'string' && s.uid ? s.uid : newSlideUid(),
      layout,
      title: typeof s.title === 'string' ? s.title : '',
      subtitle: typeof s.subtitle === 'string' ? s.subtitle : '',
      content: typeof s.content === 'string' ? s.content : bulletsToText(s.content),
      assets: cleanAssets(s.assets).slice(0, 8),
    }
  })
  state.coverAssets = cleanAssets(data.coverAssets).slice(0, 4)
  syncFields()
}

function saveDraft() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(captureDraft()))
  } catch {
    /* 隐私模式里存不了就算了 */
  }
}

function restoreDraft() {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return false
    const data = JSON.parse(raw)
    // 模板选择不跨刷新记忆：每次打开都回到 basic（交大红）。
    delete data.tId
    delete data.template
    applyDraft(data)
    return true
  } catch {
    return false
  }
}

function syncFields() {
  els.fTitle.value = state.title
  els.fSubtitle.value = state.subtitle
  els.fAuthor.value = state.author
  els.fDate.value = state.date
  els.fPageNumbers.checked = state.pageNumbers
}

/* ── 摘要 / 最近 ──────────────────────────────────────── */

function updateSummary() {
  const t = currentTemplate()
  const pages = visibleSlides().length + (state.title.trim() ? 1 : 0)
  els.slideCount.textContent = `${state.slides.length} 个正文页`
  els.genTitle.textContent = state.title.trim() || '未命名演示'
  els.genMeta.textContent = t ? `${t.label} 模板 · ${pages} 页 · ${state.slides.length} 个正文页` : `${pages} 页`
}

function renderRecent() {
  if (!state.recent.length) {
    els.recentSection.hidden = true
    return
  }
  els.recentSection.hidden = false
  clear(els.recentList)
  for (const deck of state.recent) {
    const t = state.templates.find((x) => x.id === deck.template)
    const bar = el('span', { className: 'recent-bar' })
    bar.style.setProperty('--m-accent', t ? t.accent : 'var(--red)')
    els.recentList.append(
      el(
        'div',
        { className: 'recent-row' },
        bar,
        el(
          'div',
          { className: 'recent-main' },
          el('span', { className: 'recent-title', text: deck.title }),
          el('span', {
            className: 'recent-meta',
            text: `${deck.templateLabel} · ${deck.slides} 页 · ${fmtBytes(deck.bytes)} · ${deck.source === 'tool' ? 'AI 生成' : '网页生成'} · ${fmtDate(deck.createdAt)}`,
          }),
        ),
        el(
          'div',
          { className: 'recent-actions' },
          el('button', { className: 'btn ghost', type: 'button', dataset: { reveal: deck.id }, text: '显示' }),
          el('a', { className: 'btn primary', href: deck.url, download: deck.file, text: '下载' }),
        ),
      ),
    )
  }
}

async function loadRecent() {
  try {
    const response = await fetch('/sjtu-ppt/api/recent')
    if (!response.ok) return
    const data = await response.json()
    state.recent = Array.isArray(data.decks) ? data.decks : []
    renderRecent()
  } catch {
    /* 最近列表不是关键路径 */
  }
}

/* ── 材料台 ───────────────────────────────────────────── */

const MATERIAL_MAX = 25 * 1024 * 1024
const MATERIAL_EXT = new Set([
  'doc', 'docx', 'rtf', 'pdf', 'md', 'markdown', 'txt', 'csv', 'json', 'html', 'htm',
  'ppt', 'pptx', 'xls', 'xlsx', 'png', 'jpg', 'jpeg', 'webp', 'gif',
])

function materialExt(name) {
  const i = String(name || '').lastIndexOf('.')
  return i > 0 ? name.slice(i + 1).toLowerCase() : ''
}

function extLabel(ext) {
  return ext === 'jpeg' ? 'JPG' : String(ext || '?').toUpperCase()
}

async function loadMaterials() {
  try {
    const response = await fetch('/sjtu-ppt/api/materials')
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json()
    state.materials = Array.isArray(data.materials) ? data.materials : []
  } catch {
    state.materials = []
  }
  renderMaterials()
}

function renderMaterials() {
  const mats = state.materials
  const list = els.materialList
  clear(list)
  els.materialEmpty.hidden = mats.length > 0
  els.materialFoot.hidden = mats.length === 0
  els.materialCount.textContent = `${mats.length} 份`
  if (!mats.length) {
    els.materialSummary.textContent = ''
    return
  }

  for (const m of mats) {
    const row = el('article', { className: 'material', dataset: { id: m.id } })
    if (m.error) row.title = m.error
    const mark = m.kind === 'image'
      ? el('span', { className: 'material-thumb', style: `background-image:url("${m.fileUrl}")` })
      : el('span', { className: `material-ext ext-${m.ext}`, text: extLabel(m.ext) })

    const metaBits = [fmtBytes(m.bytes)]
    if (m.kind === 'image') metaBits.push('图片')
    else if (m.chars) metaBits.push(`${m.chars.toLocaleString('zh-CN')} 字`)
    else metaBits.push('未提取文字')
    metaBits.push(extLabel(m.ext))

    const body = el('div', { className: 'material-body' })
    body.append(
      el('strong', { className: 'material-name', text: m.name, title: m.name }),
      el('span', { className: 'material-meta', text: metaBits.join(' · ') }),
    )
    if (m.excerpt) {
      body.append(el('p', { className: 'material-excerpt', text: m.excerpt.replace(/\s+/g, ' ').slice(0, 130) }))
    }

    const actions = el('div', { className: 'material-actions' })
    if (m.chars) actions.append(el('button', { className: 'text-btn', type: 'button', dataset: { view: m.id }, text: '看全文' }))
    if (m.kind === 'image') actions.append(el('a', { className: 'text-btn', href: m.fileUrl, target: '_blank', rel: 'noopener', text: '查看' }))
    actions.append(el('button', { className: 'material-remove', type: 'button', dataset: { remove: m.id }, 'aria-label': `移除 ${m.name}`, text: '×' }))

    row.append(mark, body, actions)
    list.append(row)
  }

  const bytes = mats.reduce((sum, m) => sum + (m.bytes || 0), 0)
  const chars = mats.reduce((sum, m) => sum + (m.chars || 0), 0)
  const images = mats.filter((m) => m.kind === 'image').length
  const bits = [`${mats.length} 份材料`, fmtBytes(bytes)]
  if (chars) bits.push(`${chars.toLocaleString('zh-CN')} 字`)
  if (images) bits.push(`${images} 张图片`)
  els.materialSummary.textContent = bits.join(' · ')
}

function setDropBusy(text) {
  els.dropZone.classList.toggle('busy', Boolean(text))
  els.dropZone.setAttribute('aria-busy', text ? 'true' : 'false')
  els.dropStatus.hidden = !text
  els.dropStatus.textContent = text || ''
}

async function uploadMaterials(files) {
  const list = [...(files || [])]
  if (!list.length) return
  let added = 0
  for (const file of list) {
    const ext = materialExt(file.name)
    if (!MATERIAL_EXT.has(ext)) {
      toast(`${file.name}：不支持 .${ext || '?'} 格式`, 'error')
      continue
    }
    if (file.size > MATERIAL_MAX) {
      toast(`${file.name} 超过 25 MB`, 'error')
      continue
    }
    setDropBusy(`正在读取 ${file.name}…`)
    try {
      const response = await fetch(`/sjtu-ppt/api/materials?name=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        headers: { 'content-type': file.type || 'application/octet-stream' },
        body: file,
      })
      let data = null
      try {
        data = await response.json()
      } catch {
        throw new Error(`HTTP ${response.status}`)
      }
      if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`)
      state.materials.unshift(data.material)
      renderMaterials()
      added += 1
      if (data.material.error && data.material.kind !== 'image') {
        toast(`${file.name} 已上传，但没提取到文字：${data.material.error}`, 'warn')
      }
    } catch (error) {
      toast(`上传 ${file.name} 失败：${error.message}`, 'error')
    }
  }
  setDropBusy(null)
  if (added) toast(`已加入 ${added} 份材料。`, 'ok')
}

async function removeMaterial(id) {
  const material = state.materials.find((m) => m.id === id)
  if (!material) return
  try {
    const response = await fetch(`/sjtu-ppt/api/materials/${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data.error || `HTTP ${response.status}`)
    }
    state.materials = state.materials.filter((m) => m.id !== id)
    renderMaterials()
    toast(`已移除「${material.name}」。`, 'ok')
  } catch (error) {
    toast(`移除失败：${error.message}`, 'error')
  }
}

async function openMaterialText(id) {
  const material = state.materials.find((m) => m.id === id)
  if (!material) return
  els.textTitle.textContent = material.name
  els.textMeta.textContent = [
    fmtBytes(material.bytes),
    material.chars ? `${material.chars.toLocaleString('zh-CN')} 字` : '未提取文字',
    fmtDate(material.createdAt),
  ].filter(Boolean).join(' · ')
  els.materialText.textContent = '读取中…'
  els.copyMaterial.dataset.text = ''
  openModal('text')
  try {
    const response = await fetch(material.textUrl)
    const data = await response.json()
    if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`)
    els.materialText.textContent = data.text || (material.error ? `没有提取到文字：${material.error}` : '这份材料没有可显示的文字。')
    els.copyMaterial.dataset.text = data.text || ''
  } catch (error) {
    els.materialText.textContent = `读取失败：${error.message}`
  }
}

/* ── 模式 / 快速生成 ──────────────────────────────────── */

let quickBusy = false
let assetTarget = null

function assetKind(ext) {
  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) return 'image'
  if (['mp4', 'mov', 'webm', 'm4v'].includes(ext)) return 'video'
  return 'audio'
}

async function imageSize(file) {
  try {
    const bitmap = await createImageBitmap(file)
    const size = { w: bitmap.width, h: bitmap.height }
    bitmap.close()
    return size
  } catch {
    return null
  }
}

function slideAssets(slide) {
  if (!Array.isArray(slide.assets)) slide.assets = []
  return slide.assets
}

function assetMeta(asset) {
  const bits = []
  if (asset.kind === 'image' && asset.width && asset.height) bits.push(`${asset.width}×${asset.height}`)
  bits.push(asset.kind === 'image' ? '图片' : asset.kind === 'video' ? '视频' : '音频')
  bits.push(fmtBytes(asset.bytes))
  return bits.join(' · ')
}

function renderAssetList(assets, { index = null, cover = false } = {}) {
  const list = el('div', { className: 'asset-list' })
  for (const asset of assets || []) {
    const tile = el('div', { className: 'asset' })
    const open = el('a', { className: 'asset-open', href: asset.fileUrl, target: '_blank', rel: 'noopener' })
    const thumb = asset.kind === 'image'
      ? el('span', { className: 'asset-thumb', style: `background-image:url("${asset.fileUrl}")` })
      : el('span', { className: `asset-thumb ${asset.kind}` })
    const info = el('span', { className: 'asset-info' })
    info.append(el('strong', { text: asset.name, title: asset.name }), el('span', { text: assetMeta(asset) }))
    open.append(thumb, info)
    const remove = el('button', {
      className: 'asset-remove',
      type: 'button',
      dataset: { assetRemove: asset.id },
      'aria-label': `移除 ${asset.name}`,
      text: '×',
    })
    if (index !== null) remove.dataset.assetIndex = String(index)
    if (cover) remove.dataset.assetCover = '1'
    tile.append(open, remove)
    list.append(tile)
  }
  return list
}

function renderCoverAssets() {
  if (!els.coverAssetList) return
  if (els.coverAssetHint) els.coverAssetHint.textContent = coverAssetHintText()
  clear(els.coverAssetList)
  els.coverAssetList.append(renderAssetList(state.coverAssets, { cover: true }))
}

function openAssetPicker(target) {
  assetTarget = target
  if (!els.assetInput) return
  els.assetInput.value = ''
  els.assetInput.click()
}

async function uploadAssets(files, target) {
  if (!target) return
  const list = [...(files || [])]
  let added = 0
  for (const file of list) {
    const ext = materialExt(file.name)
    if (!ASSET_EXT.has(ext)) {
      toast(`${file.name}：只支持图片 / 视频 / 音频`, 'error')
      continue
    }
    if (file.size > MATERIAL_MAX) {
      toast(`${file.name} 超过 25 MB`, 'error')
      continue
    }
    const dims = assetKind(ext) === 'image' ? await imageSize(file) : null
    const slideId = target.type === 'slide'
      ? target.slide.uid || (target.slide.uid = newSlideUid())
      : 'cover'
    const query = new URLSearchParams({ name: file.name, scope: 'slide', slide: slideId })
    if (dims) {
      query.set('w', String(dims.w))
      query.set('h', String(dims.h))
    }
    try {
      const response = await fetch(`/sjtu-ppt/api/materials?${query}`, {
        method: 'POST',
        headers: { 'content-type': file.type || 'application/octet-stream' },
        body: file,
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`)
      if (target.type === 'slide') {
        slideAssets(target.slide).push(data.material)
        renderSlides()
      } else {
        state.coverAssets.push(data.material)
        renderCoverAssets()
      }
      added += 1
      debounceSave()
    } catch (error) {
      toast(`上传 ${file.name} 失败：${error.message}`, 'error')
    }
  }
  if (added) toast(`已加入 ${added} 个页面素材。`, 'ok')
}

async function removeAsset(id, { index = null, cover = false } = {}) {
  try {
    const response = await fetch(`/sjtu-ppt/api/materials/${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data.error || `HTTP ${response.status}`)
    }
    if (cover) {
      state.coverAssets = state.coverAssets.filter((asset) => asset.id !== id)
      renderCoverAssets()
    } else if (Number.isInteger(index) && state.slides[index]) {
      state.slides[index].assets = slideAssets(state.slides[index]).filter((asset) => asset.id !== id)
      renderSlides()
    }
    debounceSave()
    toast('已移除素材。', 'ok')
  } catch (error) {
    toast(`移除失败：${error.message}`, 'error')
  }
}

function renderEditNote() {
  const t = currentTemplate()
  if (!t || !els.editNote) return
  els.editNote.textContent = t.id === 'origin'
    ? `当前「${templateTitle(t)}」：封面 / 过渡页有图位，图片会真正嵌进 PPTX；其他页面和音视频作为素材参考。`
    : `当前「${templateTitle(t)}」没有图片位：图片和音视频作为素材参考；换 origin 模板可放封面 / 过渡图。`
}

function renderQuickTemplate() {
  const t = currentTemplate()
  if (t && els.quickTemplateName) els.quickTemplateName.textContent = templateTitle(t)
}

function assetHintText(layout) {
  const size = ASSET_HINT[layout] || '16:9 · 1920×1080'
  return state.tId === 'origin' && layout === 'section' ? `会放进模板图位 · ${size}` : `当前模板无图位 · ${size}`
}

function coverAssetHintText() {
  return state.tId === 'origin' ? '会放进封面图位 · 16:9 · 1920×1080' : '当前模板封面无图位 · 16:9 · 1920×1080'
}

function setQuickPages(pages) {
  const n = Number.parseInt(pages, 10)
  const next = Number.isFinite(n) && n > 0 ? Math.min(20, Math.max(7, n)) : null
  state.quickPages = next
  if (els.quickPages) els.quickPages.value = next ? String(next) : ''
}

function readQuickPages() {
  const raw = els.quickPages ? els.quickPages.value.trim() : ''
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? Math.min(20, Math.max(7, n)) : null
}

function setMode(mode, { scroll = true } = {}) {
  const next = mode === 'edit' ? 'edit' : 'quick'
  state.mode = next
  if (els.quickPanel) els.quickPanel.hidden = next !== 'quick'
  if (els.editPanel) els.editPanel.hidden = next !== 'edit'
  if (els.buildBar) els.buildBar.hidden = next !== 'edit'
  for (const card of $$('.mode-card')) {
    const active = card.dataset.mode === next
    card.classList.toggle('active', active)
    card.setAttribute('aria-selected', active ? 'true' : 'false')
  }
  try {
    localStorage.setItem(MODE_KEY, next)
  } catch {
    /* 隐私模式里存不了就算了 */
  }
  if (scroll) {
    const panel = next === 'quick' ? els.quickPanel : els.editPanel
    if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  if (next === 'edit') {
    renderSlides()
    updateSummary()
  }
}

function setQuickBusy(busy, status = '') {
  quickBusy = busy
  if (els.quickGenerate) els.quickGenerate.disabled = busy
  if (els.quickSpinner) els.quickSpinner.hidden = !busy
  if (els.quickLabel) els.quickLabel.textContent = busy ? '正在生成…' : 'AI 分析并生成 PPTX'
  if (els.quickStatus) {
    els.quickStatus.hidden = !status
    els.quickStatus.textContent = status
  }
}

async function runQuick() {
  if (quickBusy) return
  const brief = els.quickBrief.value.trim()
  const materials = state.materials
  if (!materials.some((m) => m.chars > 0) && !brief) {
    toast('先上传能读出文字的材料，或者写一句补充要求。', 'error')
    els.dropZone.scrollIntoView({ behavior: 'smooth', block: 'center' })
    return
  }
  const pages = readQuickPages()
  state.quickPages = pages
  if (els.quickPages) {
    if (pages) els.quickPages.value = String(pages)
    else if (els.quickPages.value.trim()) els.quickPages.value = ''
  }
  setQuickBusy(true, '正在读材料…')
  const analysis = setTimeout(() => setQuickBusy(true, 'AI 正在分析材料…'), 1200)
  const layout = setTimeout(() => setQuickBusy(true, '正在套模板排版…'), 15_000)
  try {
    const response = await fetch('/sjtu-ppt/api/quick-generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        template: state.tId,
        brief,
        materialIds: materials.map((m) => m.id),
        pages,
      }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || !data.ok) throw new Error(data.error || `生成失败（HTTP ${response.status}）`)
    openResult(data.deck)
    await loadRecent()
  } catch (error) {
    toast(String(error.message || error), 'error')
  } finally {
    clearTimeout(analysis)
    clearTimeout(layout)
    setQuickBusy(false)
  }
}

/* ── 生成 ─────────────────────────────────────────────── */

function setBusy(busy) {
  els.generateBtn.disabled = busy
  els.genSpinner.hidden = !busy
  els.genLabel.textContent = busy ? '正在排版…' : '生成 PPTX'
}

async function generate() {
  const content = toContent()
  if (!content.title && !content.slides.length) {
    toast('先写一个标题，或者加一页内容。', 'error')
    return
  }
  setBusy(true)
  try {
    const response = await fetch('/sjtu-ppt/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ template: state.tId, content }),
    })
    let data = null
    try {
      data = await response.json()
    } catch {
      throw new Error(`生成失败（HTTP ${response.status}）`)
    }
    if (!response.ok || !data.ok) throw new Error(data.error || '生成失败')
    openResult(data.deck)
    await loadRecent()
  } catch (error) {
    toast(String(error.message || error), 'error')
  } finally {
    setBusy(false)
  }
}

function openResult(deck) {
  lastDeck = deck
  const t = currentTemplate()
  const preview = deck.preview || { subtitle: state.subtitle, author: state.author, date: state.date }
  els.resultTitle.textContent = deck.title || '做好了'
  els.resultMeta.textContent = `${deck.slides} 页 · ${deck.templateLabel} · ${fmtBytes(deck.bytes)} · ${deck.source === 'tool' ? 'AI 生成' : '网页生成'}`
  els.resultDownload.href = deck.url
  els.resultDownload.setAttribute('download', deck.file || 'deck.pptx')
  if (els.resultEdit) els.resultEdit.hidden = !(deck.content && Array.isArray(deck.content.slides))
  clear(els.resultCover)
  if (t) els.resultCover.append(buildMock(t, { title: deck.title, subtitle: preview.subtitle, meta: [preview.author, preview.date].filter(Boolean).join(' · ') }))
  if (deck.warnings && deck.warnings.length) {
    els.resultWarn.hidden = false
    els.resultWarn.textContent = `生成时有 ${deck.warnings.length} 条 warning：\n${deck.warnings.join('\n')}`
  } else {
    els.resultWarn.hidden = true
    els.resultWarn.textContent = ''
  }
  openModal('result')
}

function applyQuickContent(content) {
  if (!content || !Array.isArray(content.slides)) return
  state.title = typeof content.title === 'string' ? content.title : ''
  state.subtitle = typeof content.subtitle === 'string' ? content.subtitle : ''
  state.author = typeof content.author === 'string' ? content.author : ''
  state.date = typeof content.date === 'string' ? content.date : ''
  state.pageNumbers = content.page_numbers !== false
  state.slides = content.slides.map((slide) => ({
    uid: newSlideUid(),
    layout: ['toc', 'content', 'section', 'end'].includes(slide.layout) ? slide.layout : 'content',
    title: typeof slide.title === 'string' ? slide.title : '',
    subtitle: typeof slide.subtitle === 'string' ? slide.subtitle : '',
    content: bulletsToText(slide.content),
    assets: [],
  }))
  state.coverAssets = []
  syncFields()
  renderSlides()
  updateSummary()
  saveDraft()
}

async function revealDeck(id) {
  try {
    const response = await fetch('/sjtu-ppt/api/reveal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    const data = await response.json()
    if (!response.ok || !data.ok) throw new Error(data.error || '打不开文件夹')
    toast('已经在 Finder 里定位到文件。', 'ok')
  } catch (error) {
    toast(String(error.message || error), 'error')
  }
}

/* ── 导入 / 导出 ──────────────────────────────────────── */

function exportJson() {
  const payload = { template: state.tId, ...toContent() }
  const blob = new Blob([JSON.stringify(payload, null, 2) + '\n'], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = el('a', { href: url, download: `${(state.title.trim() || 'sjtu-deck').replace(/[\\/:*?"<>|]/g, '')}.json` })
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/* ── 模态框 ───────────────────────────────────────────── */

function openModal(name) {
  const modal = $(`#${name}Modal`)
  if (!modal) return
  modal.hidden = false
  document.body.style.overflow = 'hidden'
}

function closeModal(name) {
  const modal = $(`#${name}Modal`)
  if (!modal) return
  modal.hidden = true
  const open = $$('.modal').some((m) => !m.hidden)
  if (!open) document.body.style.overflow = ''
}

/* ── 示例 / 清空 ──────────────────────────────────────── */

let undoSnapshot = null

function applyState(nextIB, message) {
  undoSnapshot = captureDraft()
  applyDraft(nextIB)
  renderTemplates()
  renderFacts()
  renderSlides()
  renderHero()
  renderEditNote()
  updateSummary()
  saveDraft()
  toast(message, 'ok', {
    label: '撤销',
    onClick: () => {
      if (!undoSnapshot) return
      applyDraft(undoSnapshot)
      renderTemplates()
      renderFacts()
      renderSlides()
      renderHero()
      updateSummary()
      saveDraft()
    },
  })
}

function loadSample() {
  applyState(SAMPLE(), '已填入一份示例，可以直接改成你的内容。')
}

function clearAll() {
  applyState(
    { tId: state.tId, title: '', subtitle: '', author: '', date: '', pageNumbers: true, slides: [] },
    '已经清空，模板还留着。',
  )
}

/* ── 更新检查 ─────────────────────────────────────────── */

function applyUpdateState(data) {
  if (!data || !data.ok || !els.updateBtn) return
  const has = data.updateAvailable === true
  els.updateBtn.classList.toggle('has-update', has)
  if (els.updateDot) els.updateDot.hidden = !has
  const label = has
    ? `发现新版本 ${data.latest}（当前 ${data.current}），点击让 AI 更新`
    : `当前已是最新版本 ${data.current}`
  els.updateBtn.title = label
  els.updateBtn.setAttribute('aria-label', `更新插件：${label}`)
}

async function checkUpdateAvailability(force = false) {
  try {
    const response = await fetch(`/sjtu-ppt/api/version-check${force ? '?force=1' : ''}`)
    if (!response.ok) return
    applyUpdateState(await response.json())
  } catch {
    /* 网络不通时静默，按钮仍可点 */
  }
}

async function openUpdateConversation() {
  const hasUpdate = els.updateBtn.classList.contains('has-update')
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ type: 'sjtu-ppt:start', prompt: UPDATE_PROMPT }, location.origin)
    toast(
      hasUpdate
        ? '已打开新对话，更新指令在输入框里。'
        : '已打开新对话；当前已是最新版本，也可以让 AI 再检查一次。',
      'ok',
    )
    return
  }
  try {
    await navigator.clipboard.writeText(UPDATE_PROMPT)
    toast('更新指令已复制，请在 DSH 新对话里粘贴。', 'ok')
  } catch {
    toast(`更新指令：${UPDATE_PROMPT}`, 'ok')
  }
}

/* ── 初始化 ───────────────────────────────────────────── */

async function boot() {
  els.grid = $('#templateGrid')
  els.updateBtn = $('#updateBtn')
  els.updateDot = $('#updateDot')
  els.tplPreview = $('#tplPreview')
  els.tplPreviewImg = $('#tplPreviewImg')
  els.tplPreviewCaption = $('#tplPreviewCaption')
  els.tplFacts = $('#tplFacts')
  els.heroTemplateName = $('#heroTemplateName')
  els.fTitle = $('#fTitle')
  els.fSubtitle = $('#fSubtitle')
  els.fAuthor = $('#fAuthor')
  els.fDate = $('#fDate')
  els.fPageNumbers = $('#fPageNumbers')
  els.slideList = $('#slideList')
  els.slideCount = $('#slideCount')
  els.genTitle = $('#genTitle')
  els.genMeta = $('#genMeta')
  els.generateBtn = $('#generateBtn')
  els.genSpinner = $('#genSpinner')
  els.genLabel = $('#genLabel')
  els.recentSection = $('#recentSection')
  els.recentList = $('#recentList')
  els.dropZone = $('#dropZone')
  els.materialInput = $('#materialInput')
  els.materialList = $('#materialList')
  els.materialEmpty = $('#materialEmpty')
  els.materialFoot = $('#materialFoot')
  els.materialCount = $('#materialCount')
  els.materialSummary = $('#materialSummary')
  els.dropStatus = $('#dropStatus')
  els.textTitle = $('#textTitle')
  els.textMeta = $('#textMeta')
  els.materialText = $('#materialText')
  els.copyMaterial = $('#copyMaterial')
  els.quickPanel = $('#quickPanel')
  els.editPanel = $('#editPanel')
  els.buildBar = $('#buildBar')
  els.quickTemplateName = $('#quickTemplateName')
  els.quickBrief = $('#quickBrief')
  els.quickPages = $('#quickPagesInput')
  els.quickGenerate = $('#quickGenerate')
  els.quickSpinner = $('#quickSpinner')
  els.quickLabel = $('#quickLabel')
  els.quickStatus = $('#quickStatus')
  els.assetInput = $('#assetInput')
  els.coverAssets = $('#coverAssets')
  els.coverAssetList = $('#coverAssetList')
  els.coverAssetAdd = $('#coverAssetAdd')
  els.coverAssetHint = $('#coverAssetHint')
  els.editNote = $('#editNote')
  els.resultTitle = $('#resultTitle')
  els.resultMeta = $('#resultMeta')
  els.resultDownload = $('#resultDownload')
  els.resultCover = $('#resultCover')
  els.resultWarn = $('#resultWarn')
  els.resultEdit = $('#resultEdit')
  els.toasts = $('#toasts')

  document.documentElement.dataset.scheme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  bind()

  try {
    const response = await fetch('/sjtu-ppt/api/templates')
    const data = await response.json()
    state.templates = data.templates || []
    state.layouts = data.layouts || []
    if (!state.templates.length) throw new Error('模板列表是空的')
  } catch (error) {
    toast(`加载模板失败：${error.message}`, 'error')
    return
  }

  state.tId = state.templates[0].id
  if (!restoreDraft()) applyDraft(SAMPLE())
  syncFields()
  renderTemplates()
  renderFacts()
  renderSlides()
  renderHero()
  renderEditNote()
  updateSummary()
  renderCoverAssets()
  setQuickPages(state.quickPages)
  let savedMode = null
  try {
    savedMode = localStorage.getItem(MODE_KEY)
  } catch {
    /* ignore */
  }
  setMode(savedMode === 'edit' ? 'edit' : 'quick', { scroll: false })

  loadRecent()
  loadMaterials()
  checkUpdateAvailability(true)
  setInterval(() => {
    if (document.visibilityState === 'visible') checkUpdateAvailability()
  }, 10 * 60 * 1000)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkUpdateAvailability()
  })
}

function bind() {
  els.grid.addEventListener('click', (event) => {
    const card = event.target.closest('[data-template]')
    if (card) {
      hideTemplatePreview()
      setTemplate(card.dataset.template)
    }
  })

  els.grid.addEventListener('mouseover', (event) => {
    if (!canHover) return
    const card = event.target.closest('[data-template]')
    if (!card || card === previewCard) return
    previewCard = card
    if (previewTimer) clearTimeout(previewTimer)
    previewTimer = setTimeout(() => {
      if (previewCard === card) showTemplatePreview(card)
    }, 120)
  })

  els.grid.addEventListener('mouseout', (event) => {
    const card = event.target.closest('[data-template]')
    if (!card) return
    if (event.relatedTarget && card.contains(event.relatedTarget)) return
    if (previewCard === card) hideTemplatePreview()
  })

  els.grid.addEventListener('mouseleave', hideTemplatePreview)
  addEventListener('scroll', hideTemplatePreview, { passive: true, capture: true })
  addEventListener('resize', hideTemplatePreview)

  document.addEventListener('click', (event) => {
    const add = event.target.closest('[data-add]')
    if (add) addSlide(add.dataset.add)
  })

  for (const [input, key] of [
    [els.fTitle, 'title'],
    [els.fSubtitle, 'subtitle'],
    [els.fAuthor, 'author'],
    [els.fDate, 'date'],
  ]) {
    input.addEventListener('input', () => {
      state[key] = input.value
      renderHero()
      updateSummary()
      debounceSave()
    })
  }

  els.fPageNumbers.addEventListener('change', () => {
    state.pageNumbers = els.fPageNumbers.checked
    debounceSave()
  })

  els.slideList.addEventListener('input', onSlideInput)
  els.slideList.addEventListener('change', onLayoutChange)
  els.slideList.addEventListener('click', onSlideClick)

  document.addEventListener('click', (event) => {
    const close = event.target.closest('[data-close]')
    if (close) closeModal(close.dataset.close)
  })

  for (const card of $$('.mode-card')) {
    card.addEventListener('click', () => setMode(card.dataset.mode))
  }
  els.quickPages.addEventListener('input', () => {
    const n = Number.parseInt(els.quickPages.value, 10)
    state.quickPages = Number.isFinite(n) && n > 0 ? Math.min(20, Math.max(7, n)) : null
  })
  els.quickPages.addEventListener('change', () => setQuickPages(els.quickPages.value))
  els.quickGenerate.addEventListener('click', runQuick)

  els.dropZone.addEventListener('click', () => {
    if (!els.dropZone.classList.contains('busy')) els.materialInput.click()
  })
  els.dropZone.addEventListener('keydown', (event) => {
    if ((event.key === 'Enter' || event.key === ' ') && !els.dropZone.classList.contains('busy')) {
      event.preventDefault()
      els.materialInput.click()
    }
  })
  for (const type of ['dragenter', 'dragover']) {
    els.dropZone.addEventListener(type, (event) => {
      event.preventDefault()
      if (!els.dropZone.classList.contains('busy')) els.dropZone.classList.add('dragging')
    })
  }
  els.dropZone.addEventListener('dragleave', (event) => {
    if (!els.dropZone.contains(event.relatedTarget)) els.dropZone.classList.remove('dragging')
  })
  els.dropZone.addEventListener('drop', (event) => {
    event.preventDefault()
    els.dropZone.classList.remove('dragging')
    if (!els.dropZone.classList.contains('busy')) uploadMaterials(event.dataTransfer && event.dataTransfer.files)
  })
  els.materialInput.addEventListener('change', () => {
    uploadMaterials(els.materialInput.files)
    els.materialInput.value = ''
  })
  const isTextField = (target) => target instanceof Element && Boolean(target.closest('input, textarea'))
  addEventListener('dragover', (event) => {
    if (!isTextField(event.target)) event.preventDefault()
  })
  addEventListener('drop', (event) => {
    if (!isTextField(event.target)) event.preventDefault()
  })

  els.materialList.addEventListener('click', (event) => {
    const view = event.target.closest('[data-view]')
    if (view) return openMaterialText(view.dataset.view)
    const remove = event.target.closest('[data-remove]')
    if (remove) return removeMaterial(remove.dataset.remove)
  })

  els.coverAssetAdd.addEventListener('click', () => openAssetPicker({ type: 'cover' }))
  els.assetInput.addEventListener('change', () => {
    const target = assetTarget
    assetTarget = null
    uploadAssets(els.assetInput.files, target)
    els.assetInput.value = ''
  })

  els.slideList.addEventListener('click', (event) => {
    const add = event.target.closest('[data-asset-add]')
    if (add) {
      const slide = state.slides[Number(add.dataset.assetAdd)]
      if (slide) openAssetPicker({ type: 'slide', slide })
      return
    }
    const remove = event.target.closest('[data-asset-remove]')
    if (remove) {
      removeAsset(remove.dataset.assetRemove, {
        index: remove.dataset.assetIndex === undefined ? null : Number(remove.dataset.assetIndex),
        cover: remove.dataset.assetCover === '1',
      })
    }
  })
  els.coverAssetList.addEventListener('click', (event) => {
    const remove = event.target.closest('[data-asset-remove]')
    if (remove) removeAsset(remove.dataset.assetRemove, { cover: true })
  })

  const bindAssetDrop = (container, resolve) => {
    if (!container) return
    const blockAt = (target) => target.closest('.slide-assets, .cover-assets')
    container.addEventListener('dragover', (event) => {
      const block = blockAt(event.target)
      if (!block) return
      event.preventDefault()
      block.classList.add('dragging')
    })
    container.addEventListener('dragleave', (event) => {
      const block = blockAt(event.target)
      if (block && !block.contains(event.relatedTarget)) block.classList.remove('dragging')
    })
    container.addEventListener('drop', (event) => {
      const block = blockAt(event.target)
      if (!block) return
      event.preventDefault()
      event.stopPropagation()
      block.classList.remove('dragging')
      const target = resolve(block)
      if (target) uploadAssets(event.dataTransfer && event.dataTransfer.files, target)
    })
  }
  bindAssetDrop(els.slideList, (block) => {
    const slide = state.slides[Number(block.dataset.assetIndex)]
    return slide ? { type: 'slide', slide } : null
  })
  bindAssetDrop(els.coverAssets, () => ({ type: 'cover' }))

  els.copyMaterial.addEventListener('click', async () => {
    const text = els.copyMaterial.dataset.text || els.materialText.textContent
    try {
      await navigator.clipboard.writeText(text)
      toast('全文已复制。', 'ok')
    } catch {
      toast('复制失败，请手动选择文字。', 'error')
    }
  })
  $('#sampleBtn').addEventListener('click', loadSample)
  $('#clearBtn').addEventListener('click', clearAll)
  $('#generateBtn').addEventListener('click', generate)
  $('#exportBtn').addEventListener('click', exportJson)

  els.recentList.addEventListener('click', (event) => {
    const reveal = event.target.closest('[data-reveal]')
    if (reveal) revealDeck(reveal.dataset.reveal)
  })

  $('#resultReveal').addEventListener('click', () => {
    if (lastDeck) revealDeck(lastDeck.id)
  })

  els.updateBtn.addEventListener('click', openUpdateConversation)

  els.resultEdit.addEventListener('click', () => {
    if (!lastDeck || !lastDeck.content) return
    applyQuickContent(lastDeck.content)
    closeModal('result')
    setMode('edit')
    toast('已带入逐页编辑；图片以生成的 PPT 为准。', 'ok')
  })

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      hideTemplatePreview()
      for (const name of ['result', 'text']) closeModal(name)
    }
  })

  addEventListener('message', (event) => {
    if (event.origin !== location.origin) return
    const data = event.data
    if (!data || typeof data !== 'object') return
    if (data.type === 'sjtu-ppt:scheme' && (data.scheme === 'dark' || data.scheme === 'light')) {
      document.documentElement.dataset.scheme = data.scheme
    }
    if (data.type === 'sjtu-ppt:start-failed') {
      toast(`打开新对话失败：${data.message || '未知错误'}`, 'error')
    }
  })
}

document.addEventListener('DOMContentLoaded', boot)
