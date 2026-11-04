// 把插件随附的 skills/sjtu-ppt 注册进 DSH 的 skill 目录。
// 用户自己在 ~/.dsh/skills 或项目里装了同名 skill 时，那一份优先（本提供方按「随包提供」的 rank 600 排在最后）。
// 加载正文时：把命令里的 python 换成实际解释器，并补上「在交大演示插件里使用」的说明。
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { resolvePython } from './python.js'

const RANK = 600
const INVOCATION = { modelInvocable: true, userInvocable: true }

function parse(file) {
  const text = readFileSync(file, 'utf8')
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!m) return null
  const field = (k) => (m[1].match(new RegExp(`^${k}:\\s*(.+)$`, 'm')) || [])[1]?.trim().replace(/^(["'])(.*)\1$/, '$2')
  const name = field('name')
  const description = field('description')
  return name && description ? { name, description, body: text.slice(m[0].length) } : null
}

export function readSkills(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, 'SKILL.md')))
    .map((d) => ({ dir: join(dir, d.name), file: join(dir, d.name, 'SKILL.md'), ...parse(join(dir, d.name, 'SKILL.md')) }))
    .filter((s) => s.name)
}

function addendum(skill, py) {
  const interpreter = py ? JSON.stringify(py.path) : 'python3'
  const version = py ? py.version : '未知'
  return [
    '',
    '---',
    '',
    '## 在 DSH「交大演示」插件里使用',
    '',
    `- 本 skill 的目录是 \`${skill.dir}\`，上文的 \`scripts/\`、\`assets/\`、\`references/\` 都相对这个目录。`,
    `- 依赖已随插件安装。上文命令里的 \`python\` 已替换为这个解释器：\`${interpreter}\`（python-pptx ${version}），不需要再 pip install。`,
    '- 生成时优先调用 `sjtu_ppt_generate` 工具：`template` 填 basic / 130 / wine / crimson / origin / star / blue / global，`content` 就是上文格式的内容 JSON，`output` 可给工作区里的绝对路径。工具会调用同一套脚本，并把文件登记到侧栏「交大演示」的最近生成里。',
    `- 内置模板：basic（交大红，默认）、130（校门红）、wine（酒红）、crimson（深红）、origin（经典，封面/过渡可换图）、star（星图）、blue（交大蓝）、global（国际）。`,
    '- 内置模板都没有「左 / 右」占位符，`left` / `right` 双栏字段只对用户自带模板生效；内置模板请用 `content`。',
    '- 网页端「交大演示」侧栏可以可视化填封面、目录、内页、过渡页和封底，也能直接下载；生成的草稿在 `$DSH_HOME/sjtu-ppt/out/`。',
    '- 交付时把生成的 `.pptx` 绝对路径交给 `present` 工具。',
    '',
  ].join('\n')
}

export function createSkillProvider(dir, pluginRoot) {
  const candidate = (s) => ({
    name: s.name,
    description: s.description,
    path: s.file,
    invocation: INVOCATION,
    source: 'bundled',
    provider: 'sjtu-ppt',
    rank: RANK,
    locator: s.dir,
    resourceBase: { kind: 'directory', path: s.dir },
  })
  return {
    name: 'sjtu-ppt',
    async list() {
      return readSkills(dir).map(candidate)
    },
    async get(c) {
      const s = readSkills(dir).find((x) => x.dir === c.locator && x.name === c.name)
      if (!s) return undefined
      const py = await resolvePython().catch(() => null)
      const interpreter = py ? JSON.stringify(py.path) : 'python3'
      let content = s.body.replaceAll('python scripts/', `${interpreter} scripts/`)
      content = content.replaceAll('<SKILL_ROOT>', s.dir).replaceAll('<PLUGIN_ROOT>', pluginRoot)
      content += addendum(s, py)
      const { rank, locator, ...summary } = candidate(s)
      return { ...summary, content }
    },
  }
}
