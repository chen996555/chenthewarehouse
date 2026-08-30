# 自动填充（投递表单）— 技术方案与逆向成果

> 与 `STATUS.md`（投递状态）平行的第三条线：**投递动作的自动化辅助**。
> 核心模块 `tracker/autofill.js`，真实 Moka 表单结构数据存 `tracker/dji_dom.json`。

## 〇、主策略：简历上传解析覆盖（四两拨千斤）

多数官网（zhiye/moka/飞书）投递表单都有「上传简历 → 自动解析 → 一键覆盖字段」的能力。与其逐字段匹配填充（命中率受字段名位置影响，Moka 88%/飞书 75%），不如**直接把简历文件上传到官网的 `input[type=file]`，让官网自己的解析引擎覆盖字段**——准确率官网保证，且不用维护字段规则。字段匹配 `scanAndFill` 降级为兜底。

实现（扩展 `extension/` + 后端）：
- 用户上传简历时，原始文件存后端 `data/resume-files/{userId}.{ext}`（`parse-file` 不再删临时文件），`GET /api/resume/file` 吐 base64
- 填表时 `uploadResumeFile()`（`autofill-core.js`）用 `DataTransfer` 把简历塞进 `input[type=file]` + 触发 change，等 6 秒官网解析
- 规则匹配 `scanAndFill` 兜底 + `scanUnfilled` 报告「还有 N 个未填」提醒用户（也暴露字段识别短板）

边界：官网解析是异步的；简历里没有的信息（身份证/政治面貌/身高体重）官网也填不了，需 profile 补充。

## 零、核心认知：动态表单 vs 静态表单（字段名来源）

| 家族 | 字段名来源 | 表单类型 | 最优方式 | 命中率 |
|---|---|---|---|---|
| 北森 zhiye（67家）| 接口 `cmp_name` | **动态表单**（接口下发字段定义）| 抓 `/api/Submission/FormWithFillData`（纯 HTTP）| ~100% |
| Moka（42家）| `placeholder` | 静态表单（JS 硬编码）| DOM 识别 | 88% |
| 飞书 ATSX（14家）| `data-form-field-name` | 静态表单 | DOM 识别 | 75% |

**关键**：只有北森是动态表单——字段定义通过接口下发，`cmp_name` 是英文语义名（`RecruitmentPersonProfile_Mobile`、`RecruitmentApplicantEducation_SchoolName`…）直接映射 profile，纯 HTTP + cookie 秒级拿 58 字段。Moka/飞书是静态表单，字段名写死在前端 JS（藏在 placeholder / data 属性），只能 DOM 识别。→ 印证 [[probe-dont-guess]]：每家 ATS 的字段名来源不同，必须实测，不能猜。

## 一、核心方案（三步）

```
字段检测 → 语义匹配 → React 安全写值
```

1. **字段检测**：扫描 `input/select/textarea`，提取信号——**placeholder 为主**，label/name/id/aria-label 兜底。
2. **语义匹配**：归一化（去空格/标点/小写，消除「最高 学历」变体）+ 分节（基本信息/教育/工作/证书）+ 关键词表评分（精确=8 分、包含=4 分）。
3. **React 安全写值**：`Object.getOwnPropertyDescriptor(原型, 'value')` 拿原生 setter 绕过框架的 value 覆盖，再 `dispatchEvent('input'/'change')` 让 React 状态同步。**普通 `el.value = x` 在 React/Vue 上会失效**。

## 二、真实表单结构（各 ATS 字段名位置不同，实测）

核心发现——**不同 ATS 的字段名藏在不同的地方**，必须逐个家族实测，不能拿一个家族的经验套另一个：

| ATS 家族 | 字段名位置 | 代表 |
|---|---|---|
| Moka | `placeholder`（中文） | 大疆 |
| 飞书 ATSX | `data-form-field-name`（英文）+ `data-form-field-i18n-name`（中文） | 字节 |

**Moka 细节**：文本输入框字段名在 placeholder；下拉框（`sd-Select`）字段名在 DOM 深层（多为预填）；年月分拆（placeholder=年/月）；重复块（多段经历）。

**飞书 ATSX 细节**：字段名在 `data-form-field-name`（如 `name`/`mobile`/`email`/`school`/`field_of_study`）+ `data-form-field-i18n-name`（「姓名」「手机号码」），placeholder 为空；投递表单 URL 是 `/campus/resume/{id}/apply`；简历上传是 `type=file`。

**教训**：最初以为是「label 值污染」，实测 Moka 是「字段名在 placeholder 不在 label」；换飞书 ATSX 又变成「字段名在 data 属性」。→ 印证 [[probe-dont-guess]]：真实 DOM 结构必须实测，不能靠构造模拟表单推测，也不能跨家族套经验。

## 三、命中率演进

| 家族 | 命中率 | 说明 |
|---|---|---|
| Moka（大疆）| 30/34 = **88%** | 剩余 `请选择` 下拉框（政治面貌/语言/证书），非核心 |
| 飞书 ATSX（字节）| 9/12 = **75%** | 剩余内推码/个人证件/调查问题，本就该跳过 |

`autofill.js` 的 signalOf 已改成多信号源：`data-form-field-name` → `data-form-field-i18n-name` → `aria-label` → `label` → `placeholder` → `name` → `id`，可跨 ATS 通用。

## 四、开源参考（已调研）+ 提炼的提效点

- **FormFilla**（闭源）：匈牙利算法全局最优匹配 + 重复块检测 + 原生 setter 写值
- **AI-Resume-Form-Filling-Assistant**（开源）：归一化 + SECTION_RULES 分节 + 日期字段 readonly 检测 + DeepSeek LLM 兜底
- **Job Application Copilot**（开源，Python，架构跟本项目几乎一样）：LLM 规划填表（字段清单→LLM→`{CSS选择器:值}`）、`reveal_edit_forms`（点「编辑」按钮让隐藏字段出现）、LLM 简历解析（docx/pdf→画像）
- **塔塔网申**（闭源博客）：模糊匹配（编辑距离/Jaccard/同义词）+ XPath/CSS selector 规则库 + 下拉「点击→搜索→确认」模拟人类操作 + 事件差异化（Chrome input / Edge change）+ Shadow DOM 稳健处理；实测北森/Moka 90-91%、自研 78%

**提炼的提效点**：① LLM 兜底字段匹配（规则匹配不上→LLM，冲 90%+）；② 下拉模拟人类操作（学历/学校下拉不能直接 value 赋值）；③ 简历解析 LLM（✅ 已落地 `resume_parse.js`）。

## 五、边界（重要）

**只做「自动填充 + 用户手动点提交」，不做「自动投递」**。业界 Teal/Huntr 明确定位为人工管理工具、不做自动投递机器人（触发风控、简历造假、企业反感）。自动填充是安全的共识做法（Simplify 免费扩展即此定位）。

## 六、与整体架构的关系

自动填充将来落地为**浏览器扩展的 content script**，遵循「前端不直接调大模型」原则：扩展只做字段识别 + 写值，简历字段值来自用户本地 `profile.json`（或后端画像），不暴露 key/商业逻辑。详见 `CLAUDE.md` 数据安全相关决策。

## 七、简历解析 LLM（`resume_parse.js`）

用户上传简历（txt/pdf）→ `pdf-parse` 提取文本 → DeepSeek（deepseek-chat）提取结构化画像 → 对齐 `profile.json` 结构（identity/contact/background/job_search）。真实 PDF 简历验证通过，硬信息（姓名/电话/邮箱/学校/专业/经历）全部准确，还提取出 profile 里没有的技能。

- 产品化硬门槛：用户不可能手动维护 `profile.json`，必须「上传简历 → 自动生成画像」
- 后续整合：生成的 profile 需跑 `portrait.js` 生成 `search_portrait`（搜索画像关键词）
- PDF 解析用 pdf-parse 2.x（`new PDFParse({data}).getText()`，非旧版 `require('pdf-parse')(buffer)`）
