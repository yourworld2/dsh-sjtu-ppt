---
name: sjtu-ppt
description: 用上海交通大学（SJTU）8 套内置模板把大纲或结构化 JSON 排成可编辑的 .pptx；用户要做交大风格的汇报、答辩、校庆、学术报告、典礼或课程分享 PPT 时使用。
author: liyi@sjtu.edu.cn
dependency:
  python:
    - python-pptx==0.6.23
---

# PPTX 自动生成器

## 任务目标
- 本 Skill 用于：根据用户提供的 PPT 模板和结构化内容数据，自动生成排版完成的 `.pptx` 文件。
- 能力包含：模板加载与布局识别、JSON 内容解析、占位符自动填充、多层级要点排版、双栏排版、主题样式保留、页码控制、图片占位符填充。
- 触发条件：用户要求"生成PPT""按模板做演示文稿""把大纲转成PPT"或提供标题/要点需要自动排版时。

## 前置准备
- 依赖说明：`python-pptx==0.6.23`
- 模板文件：用户可上传自己的 `.pptx` 模板；若未提供，则默认使用内置的 SJTU-basic 模板。也可选择内置的 SJTU-wine、SJTU-130、SJTU-crimson、SJTU-origin、SJTU-star、SJTU-blue 或 SJTU-global 模板。
- 图片填充：SJTU-origin 模板支持在封面和过渡页填充自定义图片（需图片占位符）。JSON 中封面通过 `cover_image` 字段、过渡页通过 `image` 字段指定图片路径。
- 页码控制：顶层 JSON 的 `page_numbers` 字段（默认 `true`）控制是否启用页码；单个 slide 可通过 `page_numbers: false` 覆盖。默认隐藏封面/目录/封底/过渡页的页码，仅显示内页页码。仅当模板含 SLIDE_NUMBER 占位符时生效（当前 8 个内置模板均支持：SJTU-basic / SJTU-130 / SJTU-blue / SJTU-crimson / SJTU-global / SJTU-origin / SJTU-star / SJTU-wine）。
- 内置模板获取：所有内置模板均位于 `assets/` 目录下，是标准 `.pptx` 文件。用户可直接复制到本地工作区，在 PowerPoint 中打开编辑或另存为 `.potx` 模板文件使用。
- 内容文件：用户需提供符合规范的 JSON 文件，定义标题和各页幻灯片内容。

## 操作步骤
1. **确认模板** — 询问用户是否上传模板；如无，先调用模板索引脚本查看当前可用内置模板列表，再让用户选择。
   - 查看可用模板：`python scripts/list_templates.py --assets-dir assets`
   - 当前内置模板：SJTU-basic（默认）、SJTU-wine、SJTU-130、SJTU-crimson、SJTU-origin、SJTU-star、SJTU-blue、SJTU-global。
2. **确认内容** — 引导用户提供或编写 JSON 内容定义。
   - 内容格式规范见 [references/content-format.md](references/content-format.md)。
   - 若用户仅提供文字大纲，由智能体将其转换为合规 JSON。
3. **执行生成** — 调用脚本自动生成 PPTX。
   - 脚本调用示例：`python scripts/generate_pptx.py --template ./template.pptx --content ./content.json --output ./output.pptx`
   - 若用户未提供模板，可省略 `--template`：脚本将自动使用内置 SJTU-basic 模板。
4. **交付结果** — 将生成的 `.pptx` 文件路径返回给用户，提示可进一步编辑。

## 可选分支
- 当用户需要查看可用模板时：执行 `python scripts/list_templates.py --assets-dir assets`，获取所有内置模板的布局、占位符等详细信息。
- 当用户需要预设模板时：执行 `python scripts/generate_pptx.py --create-template ./my-template.pptx`，获得一个基础模板后再填充内容。
- 当用户想下载内置模板自行使用时：将 `assets/` 目录下的 `.pptx` 文件复制到用户工作区即可。这些文件是标准 PowerPoint 演示文稿，可直接打开编辑，也可另存为 `.potx` 模板格式。当前内置模板包括：SJTU-basic、SJTU-wine、SJTU-130、SJTU-crimson、SJTU-origin、SJTU-star、SJTU-blue、SJTU-global。
- 当用户上传新模板到 assets/ 目录时：先执行 `list_templates.py` 刷新索引，确认新模板被识别后，再将其纳入用户可选项，并同步更新 SKILL.md 中模板列表描述。
- 当用户内容超长时：建议拆分多个 JSON 或合并要点，确保单页不溢出。
- 当用户使用内置模板时：JSON 中的 `layout` 字段支持 `cover`（封面）、`toc`（目录）、`content`（内页）、`section`（过渡页）、`end`（封底）五种类型。
- 当用户需要双栏排版时：JSON 中使用 `left` / `right` 字段替代 `content`；仅当模板含"左/右"命名的正文占位符时生效，否则静默跳过不报错。
- 当用户提供了 `cover_image` 或 `image` 但模板没有图片占位符时，脚本会向 stderr 打印 warning（不失败），告知「该 slide 没有 PICTURE 占位符」。这是预期行为，便于诊断。
- 当用户提供了不存在的图片路径时，同样会向 stderr 打印 warning 并跳过该图片。

## 使用示例
- 示例1：
  - 场景/输入：用户提供标题"年度总结"、3个要点页的大纲文本。
  - 预期产出：一个包含标题页和3页内容页的 `.pptx` 文件。
  - 关键要点：智能体需先将大纲转为 JSON，再调用脚本生成。
- 示例2：
  - 场景/输入：用户上传自有 `.pptx` 模板，并提供包含多页内容的 JSON。
  - 预期产出：基于用户品牌模板的完整演示文稿。
  - 关键要点：模板中需包含"标题"和"内容"占位符；脚本会按名称匹配。
- 示例3：
  - 场景/输入：用户无模板，仅有一页标题和多页 bullet points。
  - 预期产出：使用内置 SJTU-basic 模板生成的标准演示文稿（含封面、目录、内容页、封底）。
  - 关键要点：省略 `--template` 参数即可使用内置模板；布局字段使用 `cover` / `toc` / `content` / `section` / `end`。

## 资源索引
- 脚本：见 [scripts/generate_pptx.py](scripts/generate_pptx.py)（用途：加载模板、解析 JSON、按布局生成 PPTX；参数：`--template`, `--content`, `--output`, `--create-template`）
- 脚本：见 [scripts/list_templates.py](scripts/list_templates.py)（用途：扫描 assets/ 目录，自动索引所有 .pptx 模板，输出包含布局名称、类型、占位符等信息的 JSON；参数：`--assets-dir`）
- 脚本：见 [scripts/smoke_test.py](scripts/smoke_test.py)（用途：smoke 回归测试，对每个内置模板跑 4 类检查：基础生成 / 双栏回归 / 页码 / 嵌套 bullet，外加 1 个全局检查（图片缺失给 warning 不崩溃）。运行：`python scripts/smoke_test.py`，exit 0 = 全部通过，1 = 有失败）
- 参考：见 [references/content-format.md](references/content-format.md)（何时读取：编写或校验内容 JSON 时）
- 资产：见 [assets/SJTU-basic.pptx](assets/SJTU-basic.pptx)（默认内置模板：SJTU-basic 蓝灰主题，含封面/目录/内页/过渡页/封底五种布局；内页支持页码）
- 资产：见 [assets/SJTU-wine.pptx](assets/SJTU-wine.pptx)（可选内置模板：SJTU-wine 酒红主题，配色为红 RGB(166,32,56)、浅金 RGB(224,207,189)、灰 RGB(191,191,191)，含封面/目录/过渡页/正文页/封底五种布局；目录/内页/过渡页支持页码）
- 资产：见 [assets/SJTU-130.pptx](assets/SJTU-130.pptx)（可选内置模板：SJTU-130 红色主题，含封面/目录/内页/过渡页/封底五种布局；内页支持页码）
- 资产：见 [assets/SJTU-crimson.pptx](assets/SJTU-crimson.pptx)（可选内置模板：SJTU-crimson 深红主题，含封面/目录/过渡页/正文页/封底五种布局；目录/内页/过渡页支持页码）
- 资产：见 [assets/SJTU-origin.pptx](assets/SJTU-origin.pptx)（可选内置模板：SJTU-origin 经典主题，封面与过渡页支持自定义图片占位符，含封面/目录/过渡页/正文页/封底五种布局；内页支持页码）
- 资产：见 [assets/SJTU-star.pptx](assets/SJTU-star.pptx)（可选内置模板：SJTU-star 星图主题，含封面/目录/过渡页/正文页/封底五种布局；内页/过渡页/封底支持页码）
- 资产：见 [assets/SJTU-blue.pptx](assets/SJTU-blue.pptx)（可选内置模板：SJTU-blue 蓝色主题，含封面/目录/过渡页/正文页/封底五种布局；目录/内页支持页码）
- 资产：见 [assets/SJTU-global.pptx](assets/SJTU-global.pptx)（可选内置模板：SJTU-global 蓝色商务主题，含封面/目录/过渡页/正文页/封底五种布局；内页/过渡页/封底支持页码）

> 模板作者备注：basic、origin、130 模板作者：李一；wine、crimson 模板作者：徐臻；star 模板作者：迮佳；blue 模板作者：沈小丹；global 模板：国际处。

## 注意事项
- 仅在需要时读取参考，保持上下文简洁。
- 操作脆弱时优先调用脚本并校验结果（建议至少运行一次 `smoke_test.py` 确认环境）。
- 充分利用智能体能力，避免为简单任务编写脚本。
- 脚本通过占位符类型（TITLE/BODY/OBJECT）和名称关键词匹配填充位置；若用户模板占位符命名特殊，可能需手动调整模板。
- 脚本会自动清除模板中的示例幻灯片，仅保留母版样式用于生成新幻灯片。
- 主题样式（字体、颜色、大小）完全继承自模板母版，脚本不做覆盖，确保输出与模板设计风格一致。
- 图片填充仅在模板含 PICTURE placeholder 时生效；SJTU-origin 模板支持封面与过渡页填图，其他 7 个模板忽略 image 字段（脚本会向 stderr 输出 warning 告知）。
- 解析内容 JSON 前，脚本会将常见中文全角标点（引号、冒号、逗号、括号等）自动转换为半角，提升手写 JSON 的容错率；注意正文中的全角标点也会被一并转换。
