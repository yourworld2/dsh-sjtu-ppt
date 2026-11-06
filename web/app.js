/* 交大演示 · 侧栏工作台
   纯原生 JS：模板卡、封面实时预览、正文页编辑、生成与最近文件。 */

const STORE_KEY = 'sjtu-ppt:draft:v1'
const THUMB_BASE = '/sjtu-ppt/assets/thumbs/'
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
  health: null,
}

let lastDeck = null
let saveTimer = null
let healthDetail = null

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

const LAYOUT_DEFAULT = {
  toc: () => ({ layout: 'toc', title: '目录', content: '' }),
  content: () => ({ layout: 'content', title: '', content: '' }),
  section: () => ({ layout: 'section', title: '', subtitle: '' }),
  end: () => ({ layout: 'end', title: '谢谢', subtitle: 'Q&A' }),
}

const currentTemplate = () => state.templates.find((t) => t.id === state.tId) || state.templates[0] || null
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
  els.heroTemplateName.textContent = `${t.label} ${t.name}`
  const pages = visibleSlides().length + (state.title.trim() ? 1 : 0)
  els.heroPages.textContent = `${pages} 页`
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
  const scroll = els.grid ? els.grid.scrollLeft : 0
  clear(els.grid)
  for (const t of state.templates) {
    const active = t.id === state.tId
    const card = el('button', {
      type: 'button',
      className: `tpl-card${active ? ' active' : ''}`,
      dataset: { template: t.id },
      'aria-pressed': active ? 'true' : 'false',
      'aria-label': `${t.label} ${t.name} 模板`,
    })
    const mock = () => buildMock(t, { title: '饮水思源', subtitle: '上海交通大学', meta: 'SJTU · 2026' })
    const src = thumbFor(t)
    if (src) {
      const wrap = el('div', { className: 'tpl-thumb-wrap' })
      const img = el('img', {
        className: 'tpl-thumb',
        src,
        alt: `${t.label} ${t.name} 模板整页封面`,
        loading: 'lazy',
        decoding: 'async',
      })
      img.addEventListener('error', () => wrap.replaceWith(mock()), { once: true })
      wrap.append(img)
      card.append(wrap)
    } else {
      card.append(mock())
    }
    card.append(el('span', { className: 'tpl-check', text: '✓' }))
    card.append(
      el(
        'div',
        { className: 'tpl-meta' },
        el('span', { className: 'tpl-name' }, el('b', { text: t.label }), ` ${t.name}`),
        el('span', { className: 'tpl-tag', text: t.id === 'basic' ? '默认' : t.image ? '可换图' : '内置' }),
      ),
      el('p', { className: 'tpl-tagline', text: t.tagline }),
    )
    els.grid.append(card)
  }
  if (els.grid) els.grid.scrollLeft = scroll
  requestAnimationFrame(updateTemplateNav)
}

function updateTemplateNav() {
  if (!els.grid || !els.tplPrev || !els.tplNext) return
  const max = els.grid.scrollWidth - els.grid.clientWidth
  els.tplPrev.disabled = els.grid.scrollLeft <= 2
  els.tplNext.disabled = max <= 2 || els.grid.scrollLeft >= max - 2
}

function scrollTemplates(direction) {
  if (!els.grid) return
  const card = els.grid.querySelector('.tpl-card')
  const step = (card ? card.getBoundingClientRect().width : 232) + 14
  els.grid.scrollBy({ left: direction * step * 2, behavior: 'smooth' })
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
  syncTemplateActive()
  renderFacts()
  renderHero()
  updateSummary()
  if (!$('#aiModal').hidden) $('#aiTemplateName').textContent = `${currentTemplate().label} ${currentTemplate().name}`
  debounceSave()
}

/* ── 页面编辑 ─────────────────────────────────────────── */

function visibleSlides() {
  return state.slides.filter((s) => {
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
    slides.push(out)
  }
  return {
    title: state.title.trim(),
    subtitle: state.subtitle.trim(),
    date: state.date.trim(),
    author: state.author.trim(),
    page_numbers: state.pageNumbers,
    slides,
  }
}

function captureDraft() {
  return {
    title: state.title,
    subtitle: state.subtitle,
    author: state.author,
    date: state.date,
    pageNumbers: state.pageNumbers,
    slides: state.slides.map((s) => ({ layout: s.layout, title: s.title || '', subtitle: s.subtitle || '', content: s.content || '' })),
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
      layout,
      title: typeof s.title === 'string' ? s.title : '',
      subtitle: typeof s.subtitle === 'string' ? s.subtitle : '',
      content: typeof s.content === 'string' ? s.content : bulletsToText(s.content),
    }
  })
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
  els.heroPages.textContent = `${pages} 页`
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
  els.resultTitle.textContent = deck.title || '做好了'
  els.resultMeta.textContent = `${deck.slides} 页 · ${deck.templateLabel} · ${fmtBytes(deck.bytes)} · ${deck.source === 'tool' ? 'AI 生成' : '网页生成'}`
  els.resultDownload.href = deck.url
  els.resultDownload.setAttribute('download', deck.file || 'deck.pptx')
  clear(els.resultCover)
  if (t) els.resultCover.append(buildMock(t, { title: deck.title, subtitle: state.subtitle, meta: [state.author, state.date].filter(Boolean).join(' · ') }))
  if (deck.warnings && deck.warnings.length) {
    els.resultWarn.hidden = false
    els.resultWarn.textContent = `生成时有 ${deck.warnings.length} 条 warning：\n${deck.warnings.join('\n')}`
  } else {
    els.resultWarn.hidden = true
    els.resultWarn.textContent = ''
  }
  openModal('result')
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

async function importJson(file) {
  try {
    const text = await file.text()
    const data = JSON.parse(text)
    applyDraft(data)
    renderTemplates()
    renderFacts()
    renderSlides()
    renderHero()
    updateSummary()
    saveDraft()
    toast(`已导入「${state.title || '未命名'}」，${state.slides.length} 个正文页。`, 'ok')
  } catch (error) {
    toast(`导入失败：${error.message}`, 'error')
  }
}

/* ── AI 草稿 ──────────────────────────────────────────── */

function aiPrompt() {
  const t = currentTemplate()
  const brief = els.aiBrief.value.trim()
  const textMats = state.materials.filter((m) => m.chars > 0)
  const imageMats = state.materials.filter((m) => m.kind === 'image')
  const lines = [
    '用 sjtu-ppt skill 帮我做一份交大风格的 PPT。',
    '',
    `模板：${t.label}（${t.name}，${t.file}）`,
    brief ? `主题与要求：\n${brief}` : '主题我还没想好。先问我三个问题：讲给谁听、想讲什么、大概多少页。',
  ]

  if (textMats.length) {
    lines.push('', '我上传了这些材料，请优先依据材料内容写，不要编造材料里没有的数据：')
    let budget = 6000
    for (const material of textMats.slice(0, 8)) {
      if (budget <= 0) break
      const excerpt = material.excerpt.slice(0, Math.min(1600, budget))
      budget -= excerpt.length
      lines.push(`【${material.name}】`, excerpt)
    }
    lines.push('', '材料全文在本地，需要细节时可以直接读：')
    for (const material of textMats) lines.push(`- ${material.name}：${material.textPath}`)
  }

  if (imageMats.length) {
    lines.push('', '图片素材（可用于封面 / 过渡页）：')
    for (const material of imageMats) lines.push(`- ${material.name}：${material.filePath}`)
  }

  lines.push(
    '',
    '请先给我 6–8 页的提纲；如果信息已经够，也可以直接生成。生成时用 sjtu_ppt_generate 工具，把 .pptx 放到当前工作区，并把路径告诉我。',
  )
  return lines.join('\n')
}

function openAi(prefill = '') {
  const t = currentTemplate()
  if (t) els.aiTemplateName.textContent = `${t.label} ${t.name}`
  if (typeof prefill === 'string' && prefill && !els.aiBrief.value.trim()) els.aiBrief.value = prefill
  const mats = state.materials
  const chars = mats.filter((m) => m.chars > 0).reduce((sum, m) => sum + m.chars, 0)
  els.aiMaterialNote.hidden = mats.length === 0
  if (mats.length) {
    const names = mats.slice(0, 3).map((m) => m.name).join('、')
    els.aiMaterialNote.textContent = `会带上 ${mats.length} 份材料${chars ? `（约 ${Math.min(chars, 6000).toLocaleString('zh-CN')} 字摘录）` : ''}：${names}${mats.length > 3 ? ' 等' : ''}`
  }
  openModal('ai')
  setTimeout(() => els.aiBrief.focus(), 80)
}

function startAi() {
  const prompt = aiPrompt()
  window.parent.postMessage({ type: 'sjtu-ppt:start', prompt }, location.origin)
  closeModal('ai')
  toast('已打开新对话，草稿在输入框里；补完直接发送。', 'ok')
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

/* ── 环境检查 ─────────────────────────────────────────── */

async function checkHealth() {
  try {
    const response = await fetch('/sjtu-ppt/api/health')
    const data = await response.json()
    state.health = data.python
    healthDetail = data
    if (data.python?.ok) {
      els.runtime.classList.add('ok')
      els.runtime.classList.remove('bad')
      els.runtimeText.textContent = `Python ${data.python.python || '3.x'} · 可生成`
      els.runtime.title = `${data.python.path} · python-pptx ${data.python.version}`
    } else {
      els.runtime.classList.add('bad')
      els.runtime.classList.remove('ok')
      els.runtimeText.textContent = '生成环境未就绪'
      els.runtime.title = data.python?.error || ''
    }
  } catch {
    els.runtime.classList.add('bad')
    els.runtimeText.textContent = '生成环境未知'
  }
}

/* ── 初始化 ───────────────────────────────────────────── */

async function boot() {
  els.grid = $('#templateGrid')
  els.tplPrev = $('#tplPrev')
  els.tplNext = $('#tplNext')
  els.tplFacts = $('#tplFacts')
  els.heroTemplateName = $('#heroTemplateName')
  els.heroPages = $('#heroPages')
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
  els.aiMaterialNote = $('#aiMaterialNote')
  els.textTitle = $('#textTitle')
  els.textMeta = $('#textMeta')
  els.materialText = $('#materialText')
  els.copyMaterial = $('#copyMaterial')
  els.resultTitle = $('#resultTitle')
  els.resultMeta = $('#resultMeta')
  els.resultDownload = $('#resultDownload')
  els.resultCover = $('#resultCover')
  els.resultWarn = $('#resultWarn')
  els.aiBrief = $('#aiBrief')
  els.aiTemplateName = $('#aiTemplateName')
  els.runtime = $('#runtime')
  els.runtimeText = $('#runtimeText')
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
  updateSummary()

  checkHealth()
  loadRecent()
  loadMaterials()
}

function bind() {
  els.grid.addEventListener('click', (event) => {
    const card = event.target.closest('[data-template]')
    if (card) setTemplate(card.dataset.template)
  })

  els.tplPrev.addEventListener('click', () => scrollTemplates(-1))
  els.tplNext.addEventListener('click', () => scrollTemplates(1))
  els.grid.addEventListener('scroll', updateTemplateNav, { passive: true })
  addEventListener('resize', updateTemplateNav)

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

  for (const button of ['#aiTop', '#aiHero']) $(button).addEventListener('click', () => openAi())
  $('#aiMaterials').addEventListener('click', () =>
    openAi('请根据我上传的材料，整理一份 8–10 页的汇报：先给我提纲；如果信息足够，直接生成。'),
  )
  $('#aiStartBtn').addEventListener('click', startAi)

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

  $('#importBtn').addEventListener('click', () => $('#fileInput').click())
  $('#fileInput').addEventListener('change', (event) => {
    const file = event.target.files && event.target.files[0]
    if (file) importJson(file)
    event.target.value = ''
  })

  els.recentList.addEventListener('click', (event) => {
    const reveal = event.target.closest('[data-reveal]')
    if (reveal) revealDeck(reveal.dataset.reveal)
  })

  $('#resultReveal').addEventListener('click', () => {
    if (lastDeck) revealDeck(lastDeck.id)
  })

  els.runtime.addEventListener('click', () => {
    if (state.health?.ok) toast(`生成环境：Python ${state.health.python || '3.x'} · python-pptx ${state.health.version}\n${state.health.path}`, 'ok')
    else toast(healthDetail?.python?.error || '还读不到生成环境。', 'error')
  })

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      for (const name of ['ai', 'result', 'text']) closeModal(name)
    }
  })

  addEventListener('message', (event) => {
    if (event.origin !== location.origin) return
    const data = event.data
    if (!data || typeof data !== 'object') return
    if (data.type === 'sjtu-ppt:scheme' && (data.scheme === 'dark' || data.scheme === 'light')) {
      document.documentElement.dataset.scheme = data.scheme
    }
    if (data.type === 'sjtu-ppt:start-failed') toast(`打开新对话失败：${data.message || '未知错误'}`, 'error')
  })
}

document.addEventListener('DOMContentLoaded', boot)
