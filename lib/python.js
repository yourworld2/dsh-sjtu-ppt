// 找一台带 python-pptx 的 Python。DSH 桌面版自带 primary-runtime，优先用它；
// 用户也可以在环境变量里指定解释器。
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const PROBE = 'import sys, json, pptx; print(json.dumps({"version": pptx.__version__, "python": "%s.%s.%s" % sys.version_info[:3], "executable": sys.executable}))'

let pending

function pythonBin(root) {
  return [
    join(root, 'python', 'bin', 'python3'),
    join(root, 'python', 'bin', 'python'),
    join(root, 'python', 'python.exe'),
    join(root, 'python3'),
    join(root, 'python'),
  ]
}

export function pythonCandidates() {
  const out = []
  if (process.env.DSH_SJTU_PPT_PYTHON) out.push(process.env.DSH_SJTU_PPT_PYTHON)
  const resources = process.resourcesPath
  if (resources) {
    const runtime = join(resources, 'runtime', 'primary-runtime', 'dependencies')
    out.push(...pythonBin(runtime))
  }
  const exe = process.execPath
  if (exe) {
    const near = dirname(exe)
    out.push(...pythonBin(join(near, 'resources', 'runtime', 'primary-runtime', 'dependencies')))
    out.push(...pythonBin(join(dirname(near), 'Resources', 'runtime', 'primary-runtime', 'dependencies')))
    out.push(...pythonBin(join(dirname(near), 'resources', 'runtime', 'primary-runtime', 'dependencies')))
  }
  out.push(join(homedir(), '.dsh', 'runtime', 'python', 'bin', 'python3'))
  out.push('python3', 'python')
  return [...new Set(out)]
}

async function probe(candidate) {
  if (candidate.includes('/') && !existsSync(candidate)) return null
  try {
    const { stdout } = await run(candidate, ['-c', PROBE], { timeout: 10_000, maxBuffer: 1 << 20 })
    const info = JSON.parse(stdout.trim().split('\n').pop())
    if (!info.version) return null
    return { path: candidate, version: info.version, python: info.python, executable: info.executable }
  } catch {
    return null
  }
}

export function resolvePython() {
  if (!pending) {
    pending = (async () => {
      const tried = []
      for (const candidate of pythonCandidates()) {
        tried.push(candidate)
        const found = await probe(candidate)
        if (found) return found
      }
      const err = new Error(
        '没有找到带 python-pptx 的 Python。交大演示需要 DSH 自带的 Python 运行时（primary-runtime/dependencies/python）。' +
          '如果用的是自定义安装，可以用环境变量 DSH_SJTU_PPT_PYTHON 指定解释器。',
      )
      err.tried = tried
      throw err
    })()
  }
  return pending
}

export async function pythonHealth() {
  try {
    const py = await resolvePython()
    return { ok: true, ...py }
  } catch (error) {
    return { ok: false, error: error.message, tried: error.tried || [] }
  }
}

export { run as runProcess }
