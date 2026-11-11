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
    slides: trimSlides(clean, maxSlides),
  }
}

function trimSlides(slides, max) {
  if (!Number.isInteger(max) || max < 3 || slides.length <= max) return slides
  const toc = slides.find((s) => s.layout === 'toc')
  const section = slides.find((s) => s.layout === 'section')
  const end = [...slides].reverse().find((s) => s.layout === 'end')
  const contents = slides.filter((s) => s.layout === 'content')
  const head = []
  if (toc) head.push(toc)
  if (section) head.push(section)
  const room = max - head.length - (end ? 1 : 0)
  const out = [...head, ...contents.slice(0, Math.max(1, room))]
  if (end) out.push(end)
  return out.slice(0, max)
}

/**
 * 一键生成：材料 → 模型结构化 → 套模板 → .pptx。
 * @param {import('node:http').IncomingMessage['socket']} _unused
 */
export async function quickGenerate(ctx, { templateId, brief = '', materialIds, pages = 8 } = {}) {
  const template = templateById(String(templateId || ''))
  if (!template) throw Object.assign(new Error('模板不存在'), { status: 400 })
  const wanted = Math.max(4, Math.min(20, Number(pages) || 8))
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

  const prompt = [
    `模板：${template.display || `${template.label} ${template.name}`}`,
    `模板特点：${template.description}`,
    `目标：整份 PPT 约 ${wanted} 页（含封面，正文约 ${wanted - 1} 个页面），不要超过 ${wanted} 页。`,
    note ? `补充要求：\n${note}` : '补充要求：无',
    '',
    context.text ? `材料：\n${context.text}` : '材料：没有可读文字，请主要依据补充要求写。',
    context.images.length ? `\n图片素材（仅供了解主题，不要写进正文）：${context.images.map((m) => m.name).join('、')}` : '',
    '',
    '输出 JSON，结构如下：',
    '{"title":"主标题（≤30字）","subtitle":"副标题（≤40字，可空）","slides":[',
    '  {"layout":"toc","title":"目录","content":["第一部分","第二部分","第三部分"]},',
    '  {"layout":"section","title":"第一部分","subtitle":"一句过渡"},',
    '  {"layout":"content","title":"这一页的结论","content":["要点一","要点二","要点三"]},',
    '  {"layout":"end","title":"谢谢","subtitle":"Q&A · 欢迎交流"}',
    ']}',
    '',
    '规则：',
    '- 只使用材料里出现的事实和数据；材料没写的数字不要编。',
    '- 每页 title ≤ 24 字；content 3–5 条，每条 ≤ 40 字，不要写序号或 bullet 符号。',
    '- 一页一个观点；目录 3–4 项；内页 2–5 个；1 个 section；1 个 end。',
    '- 用中文，正式、具体，不要「赋能」「闭环」这类空话。',
  ].join('\n')

  const text = await llmText(ctx, { system, prompt, maxTokens: 6000, timeoutMs: 180_000 })
  const shaped = shapeContent(parseJsonLoose(text), Math.max(3, wanted - 1))

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
