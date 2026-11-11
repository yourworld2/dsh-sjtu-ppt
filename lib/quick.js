// 快速模式：把材料摘要交给 DSH 当前默认模型，拿回结构化页面 JSON，再走现有生成器。
import { randomUUID } from 'node:crypto'
import { generateDeck, normalizeContent } from './generate.js'
import { listMaterials, readMaterialText } from './materials.js'
import { templateById } from './templates.js'

/**
 * 用当前 DSH 默认模型跑一次纯文本补全，返回拼接后的文本。
 * 不依赖会话，直接在插件 Host 里调用宿主 llm 服务。
 */
export async function llmText(ctx, { system, prompt, maxTokens = 4000, timeoutMs = 180_000 } = {}) {
  const llm = ctx.get('llm')
  const defaults = ctx.get('agentDefaultModel')
  if (!llm || typeof llm.prepareCall !== 'function') {
    throw Object.assign(new Error('当前 DSH 没有可用的模型服务（llm）'), { status: 503 })
  }
  const selection = defaults && typeof defaults.currentSelection === 'function' ? defaults.currentSelection() : undefined
  if (!selection || !selection.provider || !selection.model) {
    throw Object.assign(new Error('还没有选择默认模型，请先在 DSH 设置里选一个模型'), { status: 503 })
  }

  const signal = AbortSignal.timeout(timeoutMs)
  const call = await llm.prepareCall(
    { provider: selection.provider, model: selection.model, maxTokens },
    signal,
    (controls) => ({ ...controls }),
  )
  const messages = [
    {
      id: randomUUID(),
      role: 'user',
      source: { kind: 'sjtu-ppt' },
      content: [{ type: 'text', text: String(prompt || '') }],
    },
  ]
  const options = { ...call.config, messages, system: String(system || ''), signal }

  let text = ''
  for await (const chunk of call.stream(options)) {
    if (chunk.type === 'text-delta') text += chunk.text
    else if (chunk.type === 'finish' && chunk.reason && chunk.reason.kind === 'error') {
      throw new Error(chunk.reason.failure?.message || '模型调用失败')
    }
  }
  if (!text.trim()) throw new Error('模型没有返回文字')
  return text
}

function pickMaterials(ids) {
  const all = listMaterials()
  if (!Array.isArray(ids) || ids.length === 0) return all
  const wanted = new Set(ids.filter((id) => typeof id === 'string'))
  return all.filter((m) => wanted.has(m.id))
}

function materialContext(materials) {
  const textMats = materials.filter((m) => m.chars > 0)
  const images = materials.filter((m) => m.kind === 'image' && m.filePath)
  let budget = 6000
  const blocks = []
  for (const material of textMats.slice(0, 8)) {
    if (budget <= 0) break
    const full = readMaterialText(material.id)?.text || material.excerpt || ''
    const excerpt = full.slice(0, Math.min(1800, budget))
    if (!excerpt.trim()) continue
    budget -= excerpt.length
    blocks.push(`【${material.name}】\n${excerpt.trim()}`)
  }
  return { text: blocks.join('\n\n'), images }
}

function parseJsonLoose(text) {
  let source = String(text || '').trim()
  source = source.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  const start = source.indexOf('{')
  const end = source.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('模型没有返回 JSON')
  source = source.slice(start, end + 1).replace(/,\s*([}\]])/g, '$1')
  return JSON.parse(source)
}

const LAYOUTS = new Set(['toc', 'content', 'section', 'end'])

function shapeContent(raw, maxSlides = 20) {
  const data = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const slides = Array.isArray(data.slides) ? data.slides : []
  const clean = []
  for (const slide of slides.slice(0, 30)) {
    if (!slide || typeof slide !== 'object' || Array.isArray(slide)) continue
    const layout = LAYOUTS.has(slide.layout) ? slide.layout : 'content'
    const content = Array.isArray(slide.content)
      ? slide.content
          .map((item) => (typeof item === 'string' ? item : item && typeof item === 'object' ? String(item.text || '') : ''))
          .filter((item) => item.trim())
          .slice(0, 8)
      : []
    clean.push({
      layout,
      title: String(slide.title || '').slice(0, 80),
      subtitle: String(slide.subtitle || '').slice(0, 120),
      content: layout === 'toc' ? content.slice(0, 4) : content,
    })
  }
  if (clean.length < 3) throw new Error('模型返回的页面太少，请重试')
  if (!clean.some((s) => s.layout === 'content')) throw new Error('模型没有返回内页，请重试')
  return {
    title: String(data.title || '').slice(0, 80),
    subtitle: String(data.subtitle || '').slice(0, 120),
    slides: trimSlides(ensureChapterSections(clean), maxSlides),
  }
}

function ensureChapterSections(slides) {
  const toc = slides.find((s) => s.layout === 'toc')
  const chapters = Array.isArray(toc?.content)
    ? toc.content.map((item) => String(item || '').trim()).filter(Boolean)
    : []
  if (chapters.length < 2) return slides

  const end = [...slides].reverse().find((s) => s.layout === 'end')
  const body = slides.filter((s) => s !== toc && s !== end)
  const groups = []
  let current = null
  for (const slide of body) {
    if (slide.layout === 'section') {
      current = { section: slide, contents: [] }
      groups.push(current)
    } else if (slide.layout === 'content') {
      if (!current) {
        current = { section: null, contents: [] }
        groups.push(current)
      }
      current.contents.push(slide)
    }
  }

  const contents = groups.flatMap((g) => g.contents)
  if (contents.length < chapters.length) {
    throw Object.assign(new Error(`目录有 ${chapters.length} 章，但内页只有 ${contents.length} 页；至少每章要有一页内容。`), {
      status: 400,
    })
  }

  const valid =
    groups.length === chapters.length && groups.every((g) => g.section && g.contents.length > 0)
  if (valid) {
    groups.forEach((group, index) => {
      group.section.title = chapters[index]
      if (typeof group.section.subtitle !== 'string') group.section.subtitle = ''
    })
    return [toc, ...groups.flatMap((g) => [g.section, ...g.contents]), ...(end ? [end] : [])]
  }

  // 模型漏写/多写过渡页时，按目录重建：每章一张 section，内页按顺序尽量平均分给各章。
  const sections = groups.map((g) => g.section).filter(Boolean)
  const base = Math.floor(contents.length / chapters.length)
  const extra = contents.length % chapters.length
  const out = [toc]
  let cursor = 0
  chapters.forEach((title, index) => {
    const take = base + (index < extra ? 1 : 0)
    const section = sections[index] || { layout: 'section', title, subtitle: '' }
    section.layout = 'section'
    section.title = title
    if (typeof section.subtitle !== 'string') section.subtitle = ''
    out.push(section, ...contents.slice(cursor, cursor + take))
    cursor += take
  })
  if (end) out.push(end)
  return out
}

function trimSlides(slides, max) {
  if (!Number.isInteger(max) || max < 3 || slides.length <= max) return slides
  const toc = slides.find((s) => s.layout === 'toc')
  const end = [...slides].reverse().find((s) => s.layout === 'end')
  const body = slides.filter((s) => s !== toc && s !== end)
  const groups = []
  let current = null
  for (const slide of body) {
    if (slide.layout === 'section') {
      current = { section: slide, contents: [] }
      groups.push(current)
    } else if (slide.layout === 'content') {
      if (!current) {
        current = { section: null, contents: [] }
        groups.push(current)
      }
      current.contents.push(slide)
    }
  }

  const chapters = groups.filter((g) => g.section)
  if (!chapters.length) return slides.slice(0, max)

  const fixed = (toc ? 1 : 0) + (end ? 1 : 0) + chapters.reduce((n, g) => n + 1 + Math.min(1, g.contents.length), 0)
  if (max < fixed) {
    throw Object.assign(
      new Error(`页数不够：目录的每个章节都要有过渡页和内页，至少需要 ${fixed + 1} 页（含封面）。请增加页数，或减少目录章节。`),
      { status: 400 },
    )
  }

  const kept = chapters.map((g) => ({ section: g.section, contents: g.contents.slice(0, 1) }))
  let room = max - fixed
  let cursor = 0
  while (room > 0 && cursor < 1000) {
    const group = kept[cursor % kept.length]
    const source = chapters[cursor % chapters.length]
    if (group.contents.length < source.contents.length) {
      group.contents.push(source.contents[group.contents.length])
      room -= 1
    }
    cursor += 1
    if (kept.every((g, index) => g.contents.length >= chapters[index].contents.length)) break
  }

  const out = []
  if (toc) out.push(toc)
  for (const group of kept) out.push(group.section, ...group.contents)
  if (end) out.push(end)
  return out
}

/**
 * 一键生成：材料 → 模型结构化 → 套模板 → .pptx。
 * @param {import('node:http').IncomingMessage['socket']} _unused
 */
export async function quickGenerate(ctx, { templateId, brief = '', materialIds, pages = null } = {}) {
  const template = templateById(String(templateId || ''))
  if (!template) throw Object.assign(new Error('模板不存在'), { status: 400 })
  const asked = Number(pages)
  const explicit = Number.isFinite(asked) && asked > 0
  const wanted = explicit ? Math.max(7, Math.min(20, Math.round(asked))) : null
  const maxSlides = explicit ? wanted - 1 : 14
  const materials = pickMaterials(materialIds)
  const textMats = materials.filter((m) => m.chars > 0)
  const note = String(brief || '').trim().slice(0, 1500)
  if (!textMats.length && !note) {
    throw Object.assign(new Error('先上传能读出文字的材料，或者写一句补充要求。'), { status: 400 })
  }

  const context = materialContext(materials)
  const system = [
    '你是上海交通大学 PPT 的内容编辑，擅长把材料压成结构清楚、可直接排版的汇报大纲。',
    '只输出一个 JSON 对象，不要 markdown 代码块，不要解释，不要前后缀。',
  ].join('\n')

  const chapterGuide = explicit
    ? wanted <= 9
      ? '目录建议 2 章'
      : wanted <= 12
        ? '目录建议 3 章'
        : '目录建议 3–4 章'
    : '目录通常 2–4 章，按材料信息量判断'
  const pageGoal = explicit
    ? `目标：整份 PPT 约 ${wanted} 页（含封面，正文约 ${wanted - 1} 个页面），不要超过 ${wanted} 页。页数已由用户指定，${chapterGuide}；每个章节都必须有过渡页。`
    : `目标：先根据材料的信息量判断一个合理页数（含封面，通常 7–12 页，最多 15 页），再按这个页数组织内容；${chapterGuide}；每个章节都必须有过渡页。不要为了凑页数重复。`

  const prompt = [
    `模板：${template.display || `${template.label} ${template.name}`}`,
    `模板特点：${template.description}`,
    pageGoal,
    note ? `补充要求：\n${note}` : '补充要求：无',
    '',
    context.text ? `材料：\n${context.text}` : '材料：没有可读文字，请主要依据补充要求写。',
    context.images.length ? `\n图片素材（仅供了解主题，不要写进正文）：${context.images.map((m) => m.name).join('、')}` : '',
    '',
    '输出 JSON，结构如下：',
    '{"title":"主标题（≤30字）","subtitle":"副标题（≤40字，可空）","slides":[',
    '  {"layout":"toc","title":"目录","content":["第一部分","第二部分"]},',
    '  {"layout":"section","title":"第一部分","subtitle":"一句过渡"},',
    '  {"layout":"content","title":"这一页的结论","content":["要点一","要点二","要点三"]},',
    '  {"layout":"section","title":"第二部分","subtitle":"一句过渡"},',
    '  {"layout":"content","title":"这一页的结论","content":["要点一","要点二","要点三"]},',
    '  {"layout":"end","title":"谢谢","subtitle":"Q&A · 欢迎交流"}',
    ']}',
    '',
    '规则：',
    '- 只使用材料里出现的事实和数据；材料没写的具体数字、人名、时间不要编。',
    '- 如果材料很少或没有文字材料，可以依据主题补充可靠的通用背景，但不要编造具体数据、人名、时间、机构。',
    '- 每页 title ≤ 24 字；content 3–5 条，每条 ≤ 40 字，不要写序号或 bullet 符号。',
    '- 一页一个观点；目录 2–4 项；内页 3–10 个；1 个 end。',
    '- 目录每一项都必须有一张同名 section 过渡页，紧接在该章第一张内页之前；section 数必须等于目录项数。',
    '- 禁止只写一张 section 覆盖多个章节；每个 section 后至少要有 1 张内页。',
    '- 用中文，正式、具体，不要「赋能」「闭环」这类空话。',
  ].join('\n')

  const text = await llmText(ctx, { system, prompt, maxTokens: 6000, timeoutMs: 180_000 })
  const shaped = shapeContent(parseJsonLoose(text), maxSlides)

  const now = new Date()
  const content = {
    title: shaped.title || template.label,
    subtitle: shaped.subtitle,
    author: '',
    date: `${now.getFullYear()}年${now.getMonth() + 1}月`,
    page_numbers: true,
    slides: shaped.slides,
  }

  // origin 模板有封面/过渡页图位，把上传的图片按顺序放进去。
  if (template.id === 'origin' && context.images.length) {
    content.cover_image = context.images[0].filePath
    let cursor = 1
    for (const slide of content.slides) {
      if (slide.layout === 'section' && cursor < context.images.length) {
        slide.image = context.images[cursor].filePath
        cursor += 1
      }
    }
  }

  // 用现有的校验兜底，避免模型输出越界。
  normalizeContent(content, { allowImages: true })

  const deck = await generateDeck({
    templateId: template.id,
    content,
    source: 'web',
    allowImages: true,
  })
  return {
    ...deck,
    content,
    preview: {
      subtitle: content.subtitle,
      author: content.author,
      date: content.date,
    },
  }
}
