/* 交大演示 · 侧栏工作台
   纯原生 JS：模板卡、封面实时预览、正文页编辑、生成与最近文件。 */

const STORE_KEY = 'sjtu-ppt:draft:v1'
const THUMB_BASE = '/sjtu-ppt/assets/thumbs/'
const $ = (sel, root = document) => root.querySelector(sel)
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)]

const state = {
  templates: [],
  layouts: [],
  version: '',
  tId: 'basic',
  title: '',
  subtitle: '',
  author: '',
  date: '',
  pageNumbers: true,
  slides: [],
  recent: [],
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

/* ── 封面预览 ─────────────────────────────────────────── */

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
  clear(els.heroCover)
  els.heroCover.append(buildMock(t))
  els.heroTemplateName.textContent = `${t.name} · ${t.label}`
  const pages = visibleSlides().length + (state.title.trim() ? 1 : 0)
  els.heroPages.textContent = `${pages} 页`
  els.heroVersion.textContent = state.version ? `v${state.version}` : ''
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
  if (!$('#aiModal').hidden) $('#aiTemplateName').textContent = `${currentTemplate().label} · ${currentTemplate().name}`
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
    tId: state.tId,
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
    applyDraft(JSON.parse(raw))
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
  return [
    '用 sjtu-ppt skill 帮我做一份交大风格的 PPT。',
    '',
    `模板：${t.label}（${t.name}，${t.file}）`,
    brief ? `主题与要求：\n${brief}` : '主题我还没想好。先问我三个问题：讲给谁听、想讲什么、大概多少页。',
    '',
    '请先给我 6–8 页的提纲；如果信息已经够，也可以直接生成。生成时用 sjtu_ppt_generate 工具，把 .pptx 放到当前工作区，并把路径告诉我。',
  ].join('\n')
}

function openAi() {
  const t = currentTemplate()
  if (t) els.aiTemplateName.textContent = `${t.label} · ${t.name}`
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
  els.heroCover = $('#heroCover')
  els.heroTemplateName = $('#heroTemplateName')
  els.heroPages = $('#heroPages')
  els.heroVersion = $('#heroVersion')
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
    state.version = data.version || ''
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

  for (const button of ['#aiTop', '#aiHero']) $(button).addEventListener('click', openAi)
  $('#aiStartBtn').addEventListener('click', startAi)
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
      for (const name of ['ai', 'result']) closeModal(name)
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
