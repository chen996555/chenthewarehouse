'use strict';
/**
 * 简历解析：读取简历文本 → LLM（deepseek-chat）提取结构化画像 → 生成 profile 结构。
 * 用法：node resume_parse.js <简历文件.txt> [输出profile.json]
 * 参考 job-application-copilot 的 resume_import（LLM 提取 + FIELD_GUIDE），对齐本项目 profile.json 结构。
 */
const fs = require('node:fs');
const path = require('node:path');

const CONFIG_PATH = path.join(__dirname, 'data', 'scorer-config.json');
// profile 解析逻辑版本：改 SCHEMA_HINT/prompt（如加 projects 字段、三级区分）时 +1，旧 profile 自动失效重新解析
const PROFILE_VERSION = 'v5'; // v5：实体规范化（学校/公司简称→全称，旧 profile 的简称需重新解析规范化）

// LLM 配置（与 scorer.js 一致：本地 config > 环境变量 > 默认）
function loadLlmConfig() {
  let fileCfg = {};
  try { if (fs.existsSync(CONFIG_PATH)) fileCfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch {}
  return {
    apiKey: String(fileCfg.apiKey || process.env.DEEPSEEK_API_KEY || ''),
    baseUrl: String(fileCfg.baseUrl || process.env.SCORER_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, ''),
    judgeModel: String(fileCfg.judgeModel || process.env.SCORER_JUDGE_MODEL || 'deepseek-chat'),
  };
}
const LLM = loadLlmConfig();

// 读取简历文本：txt 直接读；pdf 用 pdf-parse；docx 待加 mammoth
async function extractText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.txt' || ext === '.md' || ext === '.text') {
    return fs.readFileSync(filePath, 'utf8');
  }
  if (ext === '.pdf') {
    const { PDFParse } = require('pdf-parse');
    const parser = new PDFParse({ data: fs.readFileSync(filePath) });
    const result = await parser.getText();
    return (result && result.text) || (typeof result === 'string' ? result : '');
  }
  if (ext === '.docx') {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value || '';
  }
  throw new Error(`暂不支持 ${ext} 格式（支持 .txt/.pdf/.docx）`);
}

// 提取结果的画像结构提示（对齐 profile.json）
const SCHEMA_HINT = `{
  "identity": { "legal_name": "姓名", "gender": "性别", "birth_date": "出生日期YYYY-MM-DD", "hometown": "籍贯", "political_status": "政治面貌" },
  "contact": { "phone": "手机号", "email": "邮箱", "province_city": "现居城市" },
  "background": {
    "education": [ { "school": "学校", "degree": "学历(学士/硕士/博士)", "major": "专业", "start": "入学YYYY-MM", "end": "毕业YYYY-MM" } ],
    "certificates": ["证书，如 CET-6"],
    "skills": ["具体的技术/工具技能（如 Python、SQL、Excel 等可学习的具体技术）；注意：像「数据分析」「机器学习」这类指代整个领域的宽泛词是「领域标签」，不是具体技能，不要放这里"],
    "experience_summary": "实习/工作经历摘要，一段话概括核心能力",
    "work_experience": [ { "company": "公司", "title": "岗位职能名称（专有名词，如「采购实习生」「Java工程师」，指岗位的职能方向）", "start": "YYYY-MM", "end": "YYYY-MM", "highlights": "工作内容/成果，一段话" } ],
    "projects": [ { "name": "项目名", "role": "项目中的角色", "description": "项目描述" } ]
  },
  "job_search": {
    "target_roles": ["只从「工作经历的核心岗位职能(title)」推断的目标方向（1-3 个）；核心=时长长（3个月以上）或同方向多次出现，次要经历（时长短且只出现1次）的方向不算；严禁从「项目经历 projects」「技能 skills」推断目标"],
    "target_industries": ["目标行业"],
    "cities": ["目标城市"],
    "graduation_year": "毕业届次，如 2027届"
  }
}`;

// 源文本验证：LLM 提取的关键字段回原文验证，防止编造（参考阿里 SmartResume 的源文本验证）
// 学校/公司是专有名词，编造风险最高，原文找不到就丢弃；其余字段宽松保留
function validateAgainstSource(parsed, text) {
  const src = String(text || '').replace(/\s+/g, '');
  const found = (v) => { const s = String(v || '').replace(/\s+/g, ''); return s.length >= 2 && src.includes(s); };

  const result = { ...parsed };
  const bg = { ...(result.background || {}) };

  if (Array.isArray(bg.education)) {
    bg.education = bg.education.filter((e) => found(e.school));
  }
  if (Array.isArray(bg.work_experience)) {
    bg.work_experience = bg.work_experience.filter((w) => found(w.company));
  }
  result.background = bg;

  return result;
}

// 实体规范化：学校/公司简称 → 全称（业界「知识图谱增强」，如「北大」→「北京大学」）
// 映射表确定性匹配；未覆盖的保留原样（LLM 已尽量给全称）
const ENTITY_MAP = {
  // 学校简称 → 全称
  '北大': '北京大学', '清华': '清华大学', '复旦': '复旦大学', '上交': '上海交通大学',
  '上海交大': '上海交通大学', '浙大': '浙江大学', '南大': '南京大学', '武大': '武汉大学',
  '中大': '中山大学', '北师': '北京师范大学', '北师大': '北京师范大学', '人大': '中国人民大学',
  '中科大': '中国科学技术大学', '哈工大': '哈尔滨工业大学', '西交': '西安交通大学',
  '同济': '同济大学', '南开': '南开大学', '天大': '天津大学', '东南': '东南大学',
  '厦大': '厦门大学', '川大': '四川大学', '华科': '华中科技大学', '华中科大': '华中科技大学',
  // 公司简称 → 全称
  '字节': '字节跳动', '阿里': '阿里巴巴', '抖音': '字节跳动', '蚂蚁': '蚂蚁集团',
  '哔哩哔哩': '哔哩哔哩', 'B站': '哔哩哔哩',
};

function normalizeEntity(name) {
  const s = String(name || '').trim();
  if (!s) return s;
  if (ENTITY_MAP[s]) return ENTITY_MAP[s]; // 精确简称 → 全称
  return s; // 其他保留原样
}

// 对画像做实体规范化（education.school + work_experience.company）
function normalizeEntities(parsed) {
  const result = { ...parsed };
  const bg = { ...(result.background || {}) };
  if (Array.isArray(bg.education)) {
    bg.education = bg.education.map((e) => ({ ...e, school: normalizeEntity(e.school) }));
  }
  if (Array.isArray(bg.work_experience)) {
    bg.work_experience = bg.work_experience.map((w) => ({ ...w, company: normalizeEntity(w.company) }));
  }
  result.background = bg;
  return result;
}

async function llmParseProfile(text) {
  if (!LLM.apiKey) throw new Error('需要设置 DEEPSEEK_API_KEY 或 data/scorer-config.json');
  const prompt = `你是简历解析助手。请从下面的简历文本中提取结构化信息，输出一个 JSON 对象，结构如下（找不到的字段省略或给空数组）：

${SCHEMA_HINT}

要求：
1. 只提取简历中能确认的信息，不要臆造
2. 教育/工作经历按时间倒序（最近的在前）
3. 目标岗位/行业/城市：只从「工作经历 work_experience 的岗位职能(title)」推断，且要区分「核心经历」和「次要经历」：**核心经历 = 时长长（3个月以上）或同一方向多次出现**（如2段采购实习 → 采购是核心）；**次要经历 = 时长短（如1个月）且只出现1次的方向**（如1个月的市场营销实习）。**target_roles 只从「核心经历的岗位职能」推断，不要把次要经历的方向列进去**（做过1个月的市场营销不代表目标是市场营销）。同时严禁从「项目经历」「技能」「领域标签」推断目标
4. 只返回 JSON 对象，不要任何其他文字

简历文本：
${text.slice(0, 8000)}`;

  const res = await fetch(`${LLM.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LLM.apiKey}` },
    body: JSON.stringify({ model: LLM.judgeModel, messages: [{ role: 'user', content: prompt }], temperature: 0.1, max_tokens: 4000 }),
  });
  const j = await res.json();
  if (j.usage) {
    const pt = j.usage.prompt_tokens || 0;
    const ct = j.usage.completion_tokens || 0;
    require('./logger').llm('简历 LLM 调用', { model: LLM.judgeModel, promptTokens: pt, completionTokens: ct, totalTokens: j.usage.total_tokens || (pt + ct) });
  }
  const content = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}') + 1;
  if (start < 0 || end <= start) throw new Error('LLM 未返回合法 JSON');
  const parsed = JSON.parse(content.slice(start, end));
  return normalizeEntities(validateAgainstSource(parsed, text)); // 源文本验证 + 实体规范化
}

async function main() {
  const file = process.argv[2];
  if (!file) { console.error('用法：node resume_parse.js <简历文件.txt> [输出profile.json]'); process.exit(1); }
  const out = process.argv[3] || path.join(__dirname, 'data', 'profile.parsed.json');

  const text = await extractText(file);
  console.log(`简历文本 ${text.length} 字，开始 LLM 提取…`);
  const parsed = await llmParseProfile(text);

  // 补 meta
  const profile = { meta: { owner: (parsed.identity && parsed.identity.legal_name) || '', updated: new Date().toISOString().slice(0, 10) }, ...parsed };
  fs.writeFileSync(out, JSON.stringify(profile, null, 2), 'utf8');
  console.log(`已生成画像 → ${out}`);
  console.log(JSON.stringify(profile, null, 2).slice(0, 1500));

  // 可选：接着跑 portrait 生成 search_portrait（搜索画像关键词）
  if (process.argv.includes('--portrait')) {
    const portrait = require('./portrait');
    await portrait.generate(out);
    console.log(`\n已生成 search_portrait，完整画像已写入 ${out}`);
  }
}
if (require.main === module) { main().catch((e) => { console.error('失败:', e.message); process.exit(1); }); }

// 简历针对性优化：JD ↔ 简历匹配分析 + 定制建议（证据优先，不编造）
// 2026 业界最先进范式：① 经验原子单元（只重组不编造）② ATS 关键词覆盖 ③ STAR 量化表达 ④ 分层定制
// 单次生成定制建议（Architect 阶段）；criticFeedback 非空时附上批判意见重写
async function tailorOnce(jd, profile, criticFeedback) {
  if (!LLM.apiKey) throw new Error('需要设置 DEEPSEEK_API_KEY 或 data/scorer-config.json');
  const profileStr = JSON.stringify(profile).slice(0, 6000);
  const feedback = criticFeedback ? `\n\n【上一版的问题，请针对性改进（仍严禁编造）】\n${criticFeedback}\n` : '';
  const prompt = `你是资深简历优化专家。根据目标岗位 JD 和候选人简历画像，给出简历定制建议。

【核心原则：证据优先，严禁编造】
简历里的经历是不可变事实，你只能"选择、重组、强调、量化表达"已有经历，绝不能编造不存在的经历/技能/数据。${feedback}
【JD 解析】
从 JD 提取：硬性门槛（学历/专业/年限/证书）、核心技能（工具/方法论/业务能力）、软性特质、Top 关键短语（ATS 会精确匹配的词，如"Java 开发""数据分析"等，据 JD 实际方向而定）。

【简历匹配分析】
对比简历，分类：
- covered：简历已有、可强化突出的点（JD 要求 ↔ 简历哪段经历对应，强度 强/中/弱）
- gaps：简历缺失的（诚实标注"缺口"并给"如何弥补"建议，绝不编造）

【定制建议】
给出具体可执行建议：
1. 已有经历如何重组/强调/量化来匹配 JD（用 STAR + 量化公式）
2. 哪些关键词应加到简历（简历有对应经历的前提下）
3. 硬缺口诚实面对，或说明如何用已有经历"近似匹配"

输出严格 JSON（不要任何其他文字）：
{
  "jdRequirements": ["硬门槛/核心技能/软性特质"],
  "atsKeywords": ["Top 关键短语"],
  "covered": [{"req": "JD要求", "match": "简历对应经历", "strength": "强/中/弱"}],
  "gaps": [{"req": "JD要求", "advice": "诚实建议"}],
  "suggestions": ["具体定制建议1", "建议2"]
}

JD：
${String(jd || '').slice(0, 4000)}

简历画像：
${profileStr}`;

  const res = await fetch(`${LLM.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LLM.apiKey}` },
    body: JSON.stringify({ model: LLM.judgeModel, messages: [{ role: 'user', content: prompt }], temperature: 0.3, max_tokens: 3000 }),
  });
  const j = await res.json();
  if (j.usage) {
    const pt = j.usage.prompt_tokens || 0;
    const ct = j.usage.completion_tokens || 0;
    require('./logger').llm('简历 LLM 调用', { model: LLM.judgeModel, promptTokens: pt, completionTokens: ct, totalTokens: j.usage.total_tokens || (pt + ct) });
  }
  const content = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}') + 1;
  if (start < 0 || end <= start) throw new Error('LLM 未返回合法 JSON');
  return JSON.parse(content.slice(start, end));
}

// Critic 阶段：批判打分（0-100）+ 挑毛病，用于「80 分放行」打回重写
async function criticTailor(jd, profile, result) {
  if (!LLM.apiKey) return { score: 100, issues: [] }; // 无 key 则不打断
  const prompt = `你是简历优化质检员。请批判打分这份简历定制建议（0-100 分），并指出问题。

目标 JD（前2000字）：${String(jd || '').slice(0, 2000)}
简历画像（前3000字）：${JSON.stringify(profile).slice(0, 3000)}
定制建议：${JSON.stringify(result)}

输出严格 JSON：{"score": 0-100, "issues": ["问题1", "问题2"]}

评分标准（编造是最严重问题，直接不及格）：
- 是否编造简历没有的经历/技能/数据
- covered 是否准确对应简历真实经历
- gaps 是否诚实（不编造弥补方案）
- suggestions 是否具体可执行（STAR + 量化）
- atsKeywords 是否来自 JD 且简历有对应经历
只返回 JSON，不要其他文字`;
  const res = await fetch(`${LLM.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LLM.apiKey}` },
    body: JSON.stringify({ model: LLM.judgeModel, messages: [{ role: 'user', content: prompt }], temperature: 0.1, max_tokens: 500 }),
  });
  const j = await res.json();
  const content = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}') + 1;
  if (start < 0 || end <= start) return { score: 100, issues: [] }; // Critic 失败则不打断
  try { return JSON.parse(content.slice(start, end)); } catch { return { score: 100, issues: [] }; }
}

// 多阶段（业界 Auto-JobHunter 范式）：Architect → Critic → 打回重写，80 分放行，最多打回 2 次
async function llmTailorResume(jd, profile) {
  let result = await tailorOnce(jd, profile, '');
  for (let i = 0; i < 2; i++) {
    const c = await criticTailor(jd, profile, result);
    if ((Number(c.score) || 100) >= 80) break; // 80 分放行
    result = await tailorOnce(jd, profile, (c.issues || []).join('；')); // 带批判意见重写
  }
  return result;
}

module.exports = { extractText, llmParseProfile, llmTailorResume, PROFILE_VERSION, normalizeEntity, normalizeEntities, ENTITY_MAP };
