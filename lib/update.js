// 检查 GitHub main 上的 package.json 版本，给首页「更新」按钮做红点提示。
// 只读检查，不修改任何文件；真正的更新由用户在新对话里让 AI 完成。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const REPO = 'yourworld2/dsh-sjtu-ppt'
const SUCCESS_TTL = 5 * 60 * 1000
const FAILURE_TTL = 60 * 1000

let cache = { at: 0, data: null }

function currentVersion() {
  return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version
}

function versionParts(value) {
  return String(value || '')
    .replace(/^v/i, '')
    .split(/[.+-]/)
    .slice(0, 3)
    .map((part) => {
      const n = Number.parseInt(part, 10)
      return Number.isFinite(n) ? n : 0
    })
}

function compareVersions(a, b) {
  const left = versionParts(a)
  const right = versionParts(b)
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] - right[i]
  }
  return 0
}

function isNewer(latest, current) {
  return compareVersions(latest, current) > 0
}

async function readJson(url, api = false) {
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'dsh-sjtu-ppt-update-check',
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(7000),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const data = await response.json()
  if (!api) return data
  return JSON.parse(Buffer.from(String(data.content || ''), 'base64').toString('utf8'))
}

/** 读取 main 分支的版本；成功缓存 5 分钟，失败缓存 1 分钟，避免频繁打 GitHub。 */
export async function checkUpdate(force = false) {
  const now = Date.now()
  const current = currentVersion()
  if (!force && cache.data && now - cache.at < (cache.data.ok ? SUCCESS_TTL : FAILURE_TTL)) {
    return cache.data
  }

  // 先读 tags（新版本 tag 立即出现，且不受 raw CDN 缓存影响）；再用 jsDelivr
  // 读 main 的 package.json；最后才回退 GitHub raw / contents。
  const sources = [
    { kind: 'tags', url: `https://api.github.com/repos/${REPO}/tags?per_page=20&t=${now}` },
    { kind: 'pkg', url: `https://cdn.jsdelivr.net/gh/${REPO}@main/package.json?t=${now}`, api: false },
    { kind: 'pkg', url: `https://github.com/${REPO}/raw/main/package.json?t=${now}`, api: false },
    { kind: 'pkg', url: `https://api.github.com/repos/${REPO}/contents/package.json?ref=main&t=${now}`, api: true },
    { kind: 'pkg', url: `https://raw.githubusercontent.com/${REPO}/main/package.json?t=${now}`, api: false },
  ]

  let latest = ''
  let error = ''
  for (const source of sources) {
    try {
      if (source.kind === 'tags') {
        const tags = await readJson(source.url, false)
        const versions = (Array.isArray(tags) ? tags : [])
          .map((tag) => String(tag?.name || '').replace(/^v/i, ''))
          .filter((version) => /^\d+\.\d+\.\d+/.test(version))
          .sort(compareVersions)
        if (versions.length) {
          latest = versions[versions.length - 1]
          break
        }
        error = 'tags 里没有版本号'
        continue
      }
      const pkg = await readJson(source.url, source.api)
      if (pkg && typeof pkg.version === 'string' && /^\d+\.\d+\.\d+/.test(pkg.version)) {
        latest = pkg.version
        break
      }
      error = '版本号格式不对'
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }
  }

  const data = latest
    ? {
        ok: true,
        current,
        latest,
        updateAvailable: isNewer(latest, current),
        checkedAt: new Date().toISOString(),
      }
    : {
        ok: false,
        current,
        error: error || '无法读取 GitHub 版本',
        checkedAt: new Date().toISOString(),
      }

  cache = { at: now, data }
  return data
}
