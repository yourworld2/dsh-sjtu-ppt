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

function isNewer(latest, current) {
  const a = versionParts(latest)
  const b = versionParts(current)
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i]
  }
  return false
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

  // 先走 GitHub API（国内通常比 raw 稳），失败再回退 raw。
  const sources = [
    { url: `https://api.github.com/repos/${REPO}/contents/package.json?ref=main`, api: true },
    { url: `https://raw.githubusercontent.com/${REPO}/main/package.json?t=${now}`, api: false },
  ]

  let latest = ''
  let error = ''
  for (const source of sources) {
    try {
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
