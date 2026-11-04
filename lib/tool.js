// 注册给模型的生成工具。它在 Host 进程里跑随附的 Python，字节和路径都不经过模型的 bash 沙箱，
// 因此模型只要给出内容 JSON 和工作区里的输出路径，就能直接得到一份可交付的 .pptx。
import { generateDeck } from './generate.js'
import { TEMPLATE_IDS } from './templates.js'

const PARAMS = {
  type: 'object',
  additionalProperties: false,
  required: ['template', 'content'],
  properties: {
    template: {
      type: 'string',
      enum: TEMPLATE_IDS,
      description: '模板：basic 蓝灰（默认）/ 130 校门红 / wine 酒红 / crimson 深红 / origin 经典（可换图）/ star 星图 / blue 交大蓝 / global 国际',
    },
    content: {
      type: 'object',
      additionalProperties: true,
      description: '内容 JSON：{title, subtitle, date, author, page_numbers, cover_image?, slides:[{layout:toc|content|section|end, title, subtitle?, content?: string[], image?}]}',
    },
    output: {
      type: 'string',
      description: '可选，生成到的绝对路径（建议放在当前工作区，并以 .pptx 结尾）。不给就放在 $DSH_HOME/sjtu-ppt/out。',
    },
  },
}

function check(args) {
  if (!args || typeof args !== 'object') throw new Error('参数应该是对象')
  if (!TEMPLATE_IDS.includes(args.template)) throw new Error(`template 只能是 ${TEMPLATE_IDS.join(' / ')}`)
  if (!args.content || typeof args.content !== 'object' || Array.isArray(args.content)) throw new Error('content 应该是对象')
  if (args.output !== undefined && typeof args.output !== 'string') throw new Error('output 应该是字符串')
  for (const key of Object.keys(args)) if (!Object.hasOwn(PARAMS.properties, key)) throw new Error(`未知参数 ${key}`)
}

export const generateTool = {
  name: 'sjtu_ppt_generate',
  description:
    '用上海交通大学 8 套内置模板把内容 JSON 排成可编辑的 .pptx（随附 sjtu-ppt skill 的同一套生成器，依赖已装好）。会登记到侧栏「交大演示」的最近生成。做交大风格 PPT 时优先用它。',
  parameters: PARAMS,
  timeoutMs: 240_000,
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['path', 'url', 'slides', 'warnings'],
      properties: {
        path: { type: 'string' },
        url: { type: 'string' },
        slides: { type: 'integer' },
        warnings: { type: 'array', items: { type: 'string' } },
      },
    },
    render: (_args, value) => [
      {
        type: 'text',
        text: `已生成 ${value.slides} 页：${value.path}${value.warnings.length ? `（${value.warnings.length} 条 warning）` : ''}。侧栏「交大演示」里也能下载。`,
      },
    ],
  },
  async execute(args) {
    check(args)
    const result = await generateDeck({
      templateId: args.template,
      content: args.content,
      outputPath: args.output,
      source: 'tool',
      allowImages: true,
    })
    return {
      path: result.path,
      url: result.url,
      slides: result.slides,
      warnings: result.warnings || [],
    }
  },
}
