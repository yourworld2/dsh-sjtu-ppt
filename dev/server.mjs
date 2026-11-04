// 本地预览：不启动 DSH，也能把侧栏页面和生成接口跑起来。
// 用法：DSH_HOME=/tmp/sjtu-ppt-preview node dev/server.mjs
import { createReadStream, existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateDeck } from '../lib/generate.js'
import { pythonHealth } from '../lib/python.js'
import { listDecks, outDir, readMeta } from '../lib/store.js'
import { LAYOUTS, TEMPLATES, templateById } from '../lib/templates.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const WEB = join(ROOT, 'web')
const BASE = '/sjtu-ppt'
const PORT = Number(process.env.PORT || 5321)
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

function safeFile(dir, rel) {
  if (!rel || rel.split('/').some((p) => p.startsWith('.') || p === '')) return null
  const base = realpathSync(dir)
  const file = normalize(join(base, rel))
  if (!file.startsWith(base + sep) || !existsSync(file)) return null
  const real = realpathSync(file)
  return real.startsWith(base + sep) && statSync(real).isFile() ? real : null
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > 2 * 1024 * 1024) req.destroy()
      else chunks.push(c)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch (e) {
        reject(e)
      }
    })
  })
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://x')
  const rest = decodeURIComponent(url.pathname.slice(BASE.length)) || '/'

  if (rest === '/api/templates') {
    return sendJson(res, 200, {
      version: VERSION,
      templates: TEMPLATES.map((t) => ({
        ...t,
        cover: ['wine', 'star', 'global'].includes(t.art) ? `${BASE}/assets/covers/${t.art}.jpg` : null,
        coverArt: ['gate', 'gate130', 'origin'].includes(t.art) ? `${BASE}/assets/covers/gate-red.png` : t.art === 'blue' ? `${BASE}/assets/covers/gate-blue.png` : null,
        download: `${BASE}/template/${t.id}`,
      })),
      layouts: LAYOUTS,
    })
  }
  if (rest === '/api/health') return sendJson(res, 200, { ok: true, version: VERSION, python: await pythonHealth() })
  if (rest === '/api/recent') return sendJson(res, 200, { decks: listDecks() })
  const outMatch = rest.match(/^\/out\/([a-z0-9-]+)\/(.+)$/)
  if (outMatch) {
    const meta = readMeta(outMatch[1])
    if (!meta) {
      res.writeHead(404)
      return res.end('not found')
    }
    const name = decodeURIComponent(outMatch[2])
    if (name !== meta.file && name !== 'content.json') {
      res.writeHead(404)
      return res.end('not found')
    }
    const file = safeFile(join(outDir(), meta.id), name)
    if (!file) {
      res.writeHead(404)
      return res.end('not found')
    }
    res.writeHead(200, {
      'content-type': name === 'content.json' ? MIME['.json'] : MIME['.pptx'],
      'content-length': statSync(file).size,
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
    })
    return createReadStream(file).pipe(res)
  }

  const templateMatch = rest.match(/^\/template\/([a-z0-9]+)$/)
  if (templateMatch) {
    const t = templateById(templateMatch[1])
    const file = t && safeFile(join(ROOT, 'skills', 'sjtu-ppt', 'assets'), t.file)
    if (!file) {
      res.writeHead(404)
      return res.end('not found')
    }
    res.writeHead(200, { 'content-type': MIME['.pptx'], 'content-length': statSync(file).size })
    return createReadStream(file).pipe(res)
  }

  if (rest === '/api/generate' && req.method === 'POST') {
    try {
      const body = await readJson(req)
      const deck = await generateDeck({ templateId: String(body.template || ''), content: body.content, source: 'web' })
      return sendJson(res, 200, { ok: true, deck })
    } catch (e) {
      return sendJson(res, 500, { ok: false, error: e.message })
    }
  }

  const file = safeFile(WEB, rest === '/' ? 'index.html' : rest.slice(1))
  if (!file) {
    res.writeHead(404)
    return res.end('not found')
  }
  res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' })
  createReadStream(file).pipe(res)
})

server.listen(PORT, '127.0.0.1', () => console.log(`http://127.0.0.1:${PORT}${BASE}/`))
