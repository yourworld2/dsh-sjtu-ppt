// 材料台：把用户上传的 Word / PDF / 表格 / 图片落到 $DSH_HOME/sjtu-ppt/materials/，
// 顺手把文字抽出来；AI 写稿时带摘录和全文路径。文件只在本机，不上传云端。
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, isAbsolute, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { dataDir, newId } from './store.js'
import { resolvePython, runProcess } from './python.js'

const run = promisify(execFile)
const HERE = dirname(fileURLToPath(import.meta.url))
const BASE = '/sjtu-ppt'
const MAX_BYTES = 25 * 1024 * 1024
const MAX_TEXT = 1_500_000

const EXT_KIND = {
  doc: 'document',
  docx: 'document',
  rtf: 'document',
  pdf: 'pdf',
  md: 'text',
  markdown: 'text',
  txt: 'text',
  csv: 'text',
  json: 'text',
  html: 'text',
  htm: 'text',
  ppt: 'slides',
  pptx: 'slides',
  xls: 'sheet',
  xlsx: 'sheet',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  webp: 'image',
  gif: 'image',
  mp4: 'video',
  mov: 'video',
  webm: 'video',
  m4v: 'video',
  mp3: 'audio',
  wav: 'audio',
  m4a: 'audio',
  aac: 'audio',
  ogg: 'audio',
}

const MIME = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  md: 'text/markdown; charset=utf-8',
  markdown: 'text/markdown; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  json: 'application/json; charset=utf-8',
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  rtf: 'application/rtf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  m4v: 'video/x-m4v',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
}

export const materialsDir = () => join(dataDir(), 'materials')
export const maxMaterialBytes = MAX_BYTES
export const allowedExtensions = Object.keys(EXT_KIND)

function safeName(raw, ext) {
  const base = String(raw || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 120)
  return base || `材料.${ext || 'bin'}`
}

function normalizeText(value) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_TEXT)
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
}

async function pdfText(file) {
  const script = `
ObjC.import('Foundation');
ObjC.import('PDFKit');
function run(argv) {
  const doc = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(argv[0]));
  if (!doc || doc.isNil()) return '';
  return doc.string.js;
}`
  const { stdout } = await runProcess('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script, file], {
    timeout: 30_000,
    maxBuffer: 8 << 20,
  })
  return stdout
}

async function textOf(file, ext) {
  if (ext === 'docx' || ext === 'pptx' || ext === 'xlsx') {
    const py = await resolvePython()
    const script = join(HERE, 'extract_text.py')
    const { stdout } = await runProcess(py.path, [script, file], { timeout: 90_000, maxBuffer: 8 << 20 })
    const line = stdout.trim().split('\n').pop()
    const result = JSON.parse(line)
    if (!result.ok) throw new Error(result.error || '解析失败')
    return result.text || ''
  }
  if (ext === 'pdf') {
    const text = await pdfText(file)
    if (!text.trim()) throw new Error('没有提取到文字（可能是扫描件）')
    return text
  }
  if (ext === 'doc' || ext === 'rtf') {
    const { stdout } = await run('/usr/bin/textutil', ['-convert', 'txt', '-stdout', file], {
      timeout: 30_000,
      maxBuffer: 8 << 20,
    })
    return stdout
  }
  if (ext === 'ppt' || ext === 'xls') {
    throw new Error('旧版 .ppt / .xls 暂不支持取字，请另存为 .pptx / .xlsx')
  }
  if (ext === 'html' || ext === 'htm') {
    return stripHtml(readFileSync(file, 'utf8'))
  }
  return readFileSync(file, 'utf8')
}

function publicMaterial(meta, dir) {
  return {
    id: meta.id,
    name: meta.name,
    ext: meta.ext,
    kind: meta.kind,
    mime: meta.mime,
    bytes: meta.bytes,
    chars: meta.chars || 0,
    excerpt: meta.excerpt || '',
    error: meta.error || null,
    createdAt: meta.createdAt,
    scope: meta.scope || 'desk',
    slideId: meta.slideId || null,
    width: meta.width || null,
    height: meta.height || null,
    textPath: meta.chars ? join(dir, 'text.txt') : null,
    filePath: join(dir, meta.file),
    fileUrl: `${BASE}/api/materials/${meta.id}/file`,
    textUrl: `${BASE}/api/materials/${meta.id}/text`,
  }
}

export function listMaterials(scope = 'desk') {
  const root = materialsDir()
  if (!existsSync(root)) return []
  const out = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    try {
      const dir = join(root, entry.name)
      const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'))
      if (scope === 'desk' && meta.scope === 'slide') continue
      if (scope === 'slide' && meta.scope !== 'slide') continue
      out.push(publicMaterial(meta, dir))
    } catch {
      /* 半截目录直接跳过 */
    }
  }
  return out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
}

export function readMaterial(id) {
  if (!/^[a-z0-9-]+$/i.test(id)) return null
  const dir = join(materialsDir(), id)
  try {
    const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'))
    return { meta, dir }
  } catch {
    return null
  }
}

export function readMaterialText(id) {
  const found = readMaterial(id)
  if (!found) return null
  try {
    return { meta: found.meta, text: readFileSync(join(found.dir, 'text.txt'), 'utf8') }
  } catch {
    return { meta: found.meta, text: '' }
  }
}

export function materialFile(id) {
  const found = readMaterial(id)
  if (!found) return null
  const file = join(found.dir, found.meta.file)
  try {
    return statSync(file).isFile() ? { file, meta: found.meta } : null
  } catch {
    return null
  }
}

export function deleteMaterial(id) {
  if (!/^[a-z0-9-]+$/i.test(id)) return false
  const dir = join(materialsDir(), id)
  if (!existsSync(dir)) return false
  rmSync(dir, { recursive: true, force: true })
  return true
}

/**
 * 保存一份材料并抽字。抽字失败不影响上传，错误会挂到 meta 上。
 * @param {{name?: string, mime?: string, body: Buffer}} input
 */
export async function saveMaterial({ name, mime, body, scope = 'desk', slideId = null, width = null, height = null }) {
  if (!Buffer.isBuffer(body) || body.length === 0) {
    throw Object.assign(new Error('文件是空的'), { status: 400 })
  }
  if (body.length > MAX_BYTES) {
    throw Object.assign(new Error('单个文件不能超过 25 MB'), { status: 413 })
  }
  const ext = extname(String(name || '')).slice(1).toLowerCase()
  if (!EXT_KIND[ext]) {
    throw Object.assign(new Error(`不支持 .${ext || '?'} 格式`), { status: 415 })
  }
  const fileName = safeName(name, ext)
  const id = `m-${newId()}`
  const dir = join(materialsDir(), id)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, fileName)
  writeFileSync(file, body)

  const kind = EXT_KIND[ext]
  let text = ''
  let error = null
  if (kind !== 'image' && kind !== 'video' && kind !== 'audio') {
    try {
      text = normalizeText(await textOf(file, ext))
      if (!text) error = '没有提取到文字'
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }
  }

  if (text) writeFileSync(join(dir, 'text.txt'), text, 'utf8')
  const meta = {
    id,
    name: fileName,
    file: fileName,
    ext,
    kind,
    mime: mime || MIME[ext] || 'application/octet-stream',
    bytes: body.length,
    chars: text.length,
    excerpt: text.slice(0, 1200),
    error,
    scope: scope === 'slide' ? 'slide' : 'desk',
    slideId: scope === 'slide' && slideId ? String(slideId) : null,
    width: Number.isFinite(Number(width)) && Number(width) > 0 ? Number(width) : null,
    height: Number.isFinite(Number(height)) && Number(height) > 0 ? Number(height) : null,
    createdAt: new Date().toISOString(),
  }
  const metaPath = join(dir, 'meta.json')
  const tmp = `${metaPath}.${process.pid}`
  writeFileSync(tmp, JSON.stringify(meta, null, 2) + '\n', 'utf8')
  renameSync(tmp, metaPath)

  return publicMaterial(meta, dir)
}

export function materialMime(meta) {
  return MIME[meta.ext] || meta.mime || 'application/octet-stream'
}


/** 网页端只允许把材料库里的图片交给生成器，避免浏览器传任意主机路径。 */
export function imagePathAllowed(candidate) {
  if (typeof candidate !== 'string' || !isAbsolute(candidate)) return false
  const root = materialsDir()
  const normalized = resolve(candidate)
  return normalized === root || normalized.startsWith(root + sep)
}

/** 去掉 content 里不在材料库中的 image / cover_image。 */
export function sanitizeContentImages(content) {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return content
  const clone = JSON.parse(JSON.stringify(content))
  if (clone.cover_image && !imagePathAllowed(clone.cover_image)) delete clone.cover_image
  for (const slide of Array.isArray(clone.slides) ? clone.slides : []) {
    if (slide && typeof slide === 'object' && slide.image && !imagePathAllowed(slide.image)) delete slide.image
  }
  return clone
}
