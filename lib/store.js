// 生成出来的 PPT 放在 $DSH_HOME/sjtu-ppt/out/<id>/，只记元信息，不复制模板。
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const dataDir = () => join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'sjtu-ppt')
export const outDir = () => join(dataDir(), 'out')

export function newId() {
  const stamp = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 7)
  return `${stamp}-${rand}`
}

export function slugify(value, fallback = 'deck') {
  const s = String(value || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, 60)
  return s || fallback
}

export function prepareDeck({ id, title, template, content, source }) {
  const dir = join(outDir(), id)
  mkdirSync(dir, { recursive: true })
  const file = `${slugify(title)}.pptx`
  const contentPath = join(dir, 'content.json')
  writeFileSync(contentPath, JSON.stringify(content, null, 2) + '\n', 'utf8')
  return { id, dir, file, deckPath: join(dir, file), contentPath }
}

export function writeMeta(id, meta) {
  const dir = join(outDir(), id)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'meta.json')
  const tmp = `${file}.${process.pid}`
  writeFileSync(tmp, JSON.stringify(meta, null, 2) + '\n', 'utf8')
  renameSync(tmp, file)
  return meta
}

export function readMeta(id) {
  try {
    return JSON.parse(readFileSync(join(outDir(), id, 'meta.json'), 'utf8'))
  } catch {
    return null
  }
}

export function removeDeck(id) {
  const dir = join(outDir(), id)
  if (!/^[a-z0-9-]+$/i.test(id) || !existsSync(dir)) return false
  rmSync(dir, { recursive: true, force: true })
  return true
}

export function listDecks(limit = 24) {
  let names = []
  try {
    names = readdirSync(outDir(), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  } catch {
    return []
  }
  const decks = []
  for (const id of names) {
    const meta = readMeta(id)
    if (!meta || meta.status !== 'ready') continue
    if (!existsSync(join(outDir(), id, meta.file || ''))) continue
    decks.push(meta)
  }
  return decks.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, limit)
}
