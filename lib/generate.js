// 把网页 / 智能体交来的内容 JSON 变成一份 .pptx：校验、落盘、调用随附的 Python 生成器。
import { execFile } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, extname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { resolvePython } from './python.js'
import { newId, prepareDeck, removeDeck, writeMeta } from './store.js'
import { templateById, TEMPLATE_IDS } from './templates.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SCRIPT = join(ROOT, 'skills', 'sjtu-ppt', 'scripts', 'generate_pptx.py')
const ASSETS = join(ROOT, 'skills', 'sjtu-ppt', 'assets')
const run = promisify(execFile)

const LAYOUT_IDS = new Set(['toc', 'content', 'section', 'end'])

function text(value, field, max = 300) {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new Error(`${field} 应该是字符串`)
  if (value.length > max) throw new Error(`${field} 太长了（最多 ${max} 字）`)
  return value
}

function bulletList(value, field) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error(`${field} 应该是数组`)
  if (value.length > 40) throw new Error(`${field} 最多 40 条`)
  return value.map((item, i) => {
    if (typeof item === 'string') {
      if (item.length > 600) throw new Error(`${field}[${i}] 太长了`)
      return item
    }
    if (!item || typeof item !== 'object') throw new Error(`${field}[${i}] 应该是字符串或 {text, level}`)
    const level = item.level === undefined ? 0 : Number(item.level)
    if (!Number.isInteger(level) || level < 0 || level > 4) throw new Error(`${field}[${i}].level 应该是 0–4 的整数`)
    const body = text(item.text, `${field}[${i}].text`, 600)
    if (!body) throw new Error(`${field}[${i}] 缺少 text`)
    return { text: body, level }
  })
}

// 只留下生成器认识的字段；网页端不接受主机图片路径，工具端可以。
export function normalizeContent(raw, { allowImages = false } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('content 应该是一个对象')
  if (!Array.isArray(raw.slides)) throw new Error('content.slides 应该是数组')
  if (raw.slides.length > 80) throw new Error('一页一份，最多 80 个页面')

  const out = {
    title: text(raw.title, 'title'),
    subtitle: text(raw.subtitle, 'subtitle'),
    date: text(raw.date, 'date'),
    author: text(raw.author, 'author'),
    page_numbers: raw.page_numbers !== false,
    slides: [],
  }
  if (typeof raw.page_numbers !== 'boolean' && raw.page_numbers !== undefined) throw new Error('page_numbers 应该是布尔值')

  for (const [i, s] of raw.slides.entries()) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) throw new Error(`slides[${i}] 应该是一个对象`)
    const layout = s.layout === undefined ? 'content' : String(s.layout)
    if (!LAYOUT_IDS.has(layout)) throw new Error(`slides[${i}].layout 只能是 ${[...LAYOUT_IDS].join(' / ')}`)
    const slide = {
      layout,
      title: text(s.title, `slides[${i}].title`),
    }
    const subtitle = text(s.subtitle, `slides[${i}].subtitle`)
    if (subtitle) slide.subtitle = subtitle
    const content = bulletList(s.content, `slides[${i}].content`)
    if (content.length) slide.content = content
    const left = bulletList(s.left, `slides[${i}].left`)
    const right = bulletList(s.right, `slides[${i}].right`)
    if (left.length) slide.left = left
    if (right.length) slide.right = right
    if (s.page_numbers === false) slide.page_numbers = false
    if (allowImages) {
      for (const key of ['image', 'cover_image']) {
        if (typeof s[key] === 'string' && isAbsolute(s[key])) slide[key] = s[key]
      }
    }
    out.slides.push(slide)
  }

  if (!out.title && !out.slides.length) throw new Error('至少给一个标题或一页内容')
  if (allowImages && typeof raw.cover_image === 'string' && isAbsolute(raw.cover_image)) out.cover_image = raw.cover_image
  return out
}

function warningsFrom(stderr) {
  return String(stderr || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && /warn/i.test(line) && line.length < 400)
    .slice(0, 12)
}

/**
 * @param {object} input
 * @param {string} input.templateId
 * @param {object} input.content 已校验或原始内容
 * @param {string} [input.outputPath] 额外复制到的主机路径（工具用）
 * @param {'web'|'tool'} [input.source]
 * @param {boolean} [input.allowImages]
 */
export async function generateDeck({ templateId, content, outputPath, source = 'web', allowImages = false }) {
  const template = templateById(templateId)
  if (!template) throw new Error(`没有这套模板：${templateId}。可选 ${TEMPLATE_IDS.join(' / ')}`)
  const templatePath = join(ASSETS, template.file)
  if (!existsSync(templatePath)) throw new Error(`模板文件缺失：${template.file}`)
  if (!existsSync(SCRIPT)) throw new Error('生成脚本缺失，请重新安装插件')

  const normalized = normalizeContent(content, { allowImages })
  if (outputPath !== undefined) {
    if (typeof outputPath !== 'string' || !isAbsolute(outputPath)) throw new Error('output 要用绝对路径')
    if (extname(outputPath).toLowerCase() !== '.pptx') throw new Error('output 要以 .pptx 结尾')
  }

  const py = await resolvePython()
  const id = newId()
  const title = normalized.title || '未命名演示'
  const deck = prepareDeck({ id, title, template: template.id, content: normalized, source })

  try {
    const { stdout, stderr } = await run(py.path, [SCRIPT, '--template', templatePath, '--content', deck.contentPath, '--output', deck.deckPath], {
      timeout: 180_000,
      maxBuffer: 8 * 1024 * 1024,
      cwd: ROOT,
    })
    const last = String(stdout || '').trim().split('\n').pop()
    let result = null
    try {
      result = JSON.parse(last)
    } catch {
      // 生成器偶尔只打印普通文本；下面用文件是否落盘来判断
    }
    if (result && result.status === 'error') throw new Error(result.message || '生成器返回错误')
    if (!existsSync(deck.deckPath)) throw new Error('生成器没有写出文件')
    const size = statSync(deck.deckPath).size
    if (size < 10_000) throw new Error('生成的 PPT 文件异常（太小）')

    let savedPath = null
    if (outputPath) {
      mkdirSync(dirname(outputPath), { recursive: true })
      copyFileSync(deck.deckPath, outputPath)
      savedPath = outputPath
    }

    const meta = writeMeta(id, {
      id,
      status: 'ready',
      title,
      template: template.id,
      templateLabel: template.label,
      file: deck.file,
      slides: normalized.slides.length + (normalized.title ? 1 : 0),
      bytes: size,
      source,
      createdAt: new Date().toISOString(),
      warnings: warningsFrom(stderr),
      python: py.version,
    })
    return {
      ...meta,
      path: savedPath || deck.deckPath,
      deckPath: deck.deckPath,
      savedPath,
      url: `/sjtu-ppt/out/${id}/${encodeURIComponent(meta.file)}`,
      jsonUrl: `/sjtu-ppt/out/${id}/content.json`,
    }
  } catch (error) {
    removeDeck(id)
    const detail = String(error.stderr || '').trim().split('\n').slice(-4).join('\n')
    const message = error.killed ? '生成超时（超过 3 分钟）' : error.message
    throw new Error(detail ? `${message}\n${detail}` : message)
  }
}
