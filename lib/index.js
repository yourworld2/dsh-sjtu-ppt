// 交大演示 · DeepSeek Harness 插件：Host 半边
// 1. 把随附的 sjtu-ppt skill 注册进 ctx.skills，模型和 /sjtu-ppt 命令都能用
//    再给模型一个生成工具 sjtu_ppt_generate（lib/tool.js）
// 2. /sjtu-ppt/                    侧栏页面（web/）
//    /sjtu-ppt/api/templates        8 套模板的展示信息
//    /sjtu-ppt/api/generate         填好的内容 → .pptx
//    /sjtu-ppt/api/recent           最近生成
//    /sjtu-ppt/api/reveal           在 Finder 里显示
//    /sjtu-ppt/out/<id>/<file>      生成的文件（只放行 meta 里登记过的）
//    /sjtu-ppt/template/<id>        下载内置模板
import { createReadStream, existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateDeck } from './generate.js'
import { pythonHealth } from './python.js'
import { createSkillProvider } from './skills.js'
import { listDecks, outDir, readMeta } from './store.js'
import { LAYOUTS, templateById, TEMPLATES } from './templates.js'
import { generateTool } from './tool.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const WEB = join(ROOT, 'web')
const SKILLS = join(ROOT, 'skills')
const BASE = '/sjtu-ppt'
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

export const name = 'sjtu-ppt'
export const inject = ['webServer', 'skills', 'tools']

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

function notFound(res) {
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
  res.end('not found')
}

// 只在 dir 里面找文件：拒绝 ..、点文件和目录外的符号链接
function safeFile(dir, rel) {
  if (!dir || !rel || rel.split('/').some((p) => p.startsWith('.') || p === '')) return null
  let base
  try {
    base = realpathSync(dir)
  } catch {
    return null
  }
  const file = normalize(join(base, rel))
  if (!file.startsWith(base + sep) || !existsSync(file)) return null
  const real = realpathSync(file)
  return real.startsWith(base + sep) && statSync(real).isFile() ? real : null
}

function serveFile(req, res, file, { download = null, cache = 'no-cache' } = {}) {
  const type = MIME[extname(file).toLowerCase()] || 'application/octet-stream'
  const head = {
    'content-type': type,
    'content-length': statSync(file).size,
    'cache-control': cache,
  }
  if (download) head['content-disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(download)}`
  res.writeHead(200, head)
  if (req.method === 'HEAD') return res.end()
  createReadStream(file).pipe(res)
}

// 只接受同源页面发来的 JSON
function readJson(req, max = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    if (req.method !== 'POST') return reject(Object.assign(new Error('method'), { status: 405 }))
    if (!/^application\/json\b/.test(req.headers['content-type'] || '')) return reject(Object.assign(new Error('type'), { status: 415 }))
    const origin = req.headers.origin
    if (origin && origin.replace(/^https?:\/\//, '') !== req.headers.host) return reject(Object.assign(new Error('origin'), { status: 403 }))
    let size = 0
    let tooLarge = false
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > max) tooLarge = true
      else chunks.push(c)
    })
    req.on('end', () => {
      if (tooLarge) return reject(Object.assign(new Error('内容太大了'), { status: 413 }))
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch (e) {
        reject(Object.assign(e, { status: 400 }))
      }
    })
    req.on('error', reject)
  })
}

function catalog() {
  return {
    version: VERSION,
    templates: TEMPLATES.map((t) => ({
      ...t,
      cover: t.art === 'wine' || t.art === 'star' || t.art === 'global' ? `${BASE}/assets/covers/${t.art}.jpg` : null,
      coverArt: t.art === 'gate' || t.art === 'gate130' || t.art === 'origin' ? `${BASE}/assets/covers/gate-red.png` : t.art === 'blue' ? `${BASE}/assets/covers/gate-blue.png` : null,
      download: `${BASE}/template/${t.id}`,
    })),
    layouts: LAYOUTS,
  }
}

function recent() {
  return listDecks().map((d) => ({
    id: d.id,
    title: d.title,
    template: d.template,
    templateLabel: d.templateLabel || templateById(d.template)?.label || d.template,
    slides: d.slides,
    bytes: d.bytes,
    source: d.source,
    createdAt: d.createdAt,
    warnings: d.warnings || [],
    url: `${BASE}/out/${d.id}/${encodeURIComponent(d.file)}`,
    jsonUrl: `${BASE}/out/${d.id}/content.json`,
  }))
}

function reveal(path) {
  let child
  if (process.platform === 'darwin') child = spawn('open', ['-R', path], { detached: true, stdio: 'ignore' })
  else if (process.platform === 'win32') child = spawn('explorer.exe', [`/select,${path}`], { detached: true, stdio: 'ignore' })
  else child = spawn('xdg-open', [dirname(path)], { detached: true, stdio: 'ignore' })
  child.on('error', () => {})
  child.unref()
}

export function apply(ctx) {
  ctx.effect(() => ctx.skills.registerProvider(() => createSkillProvider(join(SKILLS), ROOT)))
  ctx.tools.register(generateTool)

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'prefix',
      path: BASE,
      async handler(req, res) {
        const url = new URL(req.url || '/', 'http://x')
        const rest = decodeURIComponent(url.pathname.slice(BASE.length)) || '/'

        if (rest === '/api/templates') return sendJson(res, 200, catalog())
        if (rest === '/api/health') return sendJson(res, 200, { ok: true, version: VERSION, python: await pythonHealth() })
        if (rest === '/api/recent') return sendJson(res, 200, { decks: recent() })

        if (rest === '/api/generate') {
          try {
            const body = await readJson(req)
            const result = await generateDeck({
              templateId: String(body.template || ''),
              content: body.content,
              source: 'web',
              allowImages: false,
            })
            return sendJson(res, 200, { ok: true, deck: { ...result, deckPath: undefined } })
          } catch (e) {
            return sendJson(res, e.status || 500, { ok: false, error: e.message })
          }
        }

        if (rest === '/api/reveal') {
          try {
            const body = await readJson(req, 16 * 1024)
            const meta = readMeta(String(body.id || ''))
            if (!meta) return sendJson(res, 404, { ok: false, error: '找不到这份演示' })
            const file = safeFile(join(outDir(), meta.id), meta.file)
            if (!file) return sendJson(res, 404, { ok: false, error: '文件不在了' })
            reveal(file)
            return sendJson(res, 200, { ok: true })
          } catch (e) {
            return sendJson(res, e.status || 400, { ok: false, error: e.message })
          }
        }

        let m
        if ((m = rest.match(/^\/template\/([a-z0-9]+)$/))) {
          const t = templateById(m[1])
          const file = t && safeFile(join(SKILLS, 'sjtu-ppt', 'assets'), t.file)
          if (!file) return notFound(res)
          return serveFile(req, res, file, { download: t.file, cache: 'public, max-age=3600' })
        }

        if ((m = rest.match(/^\/out\/([a-z0-9-]+)\/(.+)$/))) {
          const meta = readMeta(m[1])
          if (!meta) return notFound(res)
          const name = decodeURIComponent(m[2])
          if (name !== meta.file && name !== 'content.json') return notFound(res)
          const file = safeFile(join(outDir(), meta.id), name)
          if (!file) return notFound(res)
          return serveFile(req, res, file, { download: name === meta.file ? meta.file : 'content.json' })
        }

        if (req.method !== 'GET' && req.method !== 'HEAD') return notFound(res)

        if (rest.startsWith('/assets/')) {
          const file = safeFile(join(WEB, 'assets'), rest.slice('/assets/'.length))
          return file ? serveFile(req, res, file, { cache: 'public, max-age=3600' }) : notFound(res)
        }

        const file = safeFile(WEB, rest === '/' ? 'index.html' : rest.slice(1))
        return file ? serveFile(req, res, file) : notFound(res)
      },
    }),
  )
}
