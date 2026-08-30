'use strict';
/**
 * 简历解析：读取简历文本 → LLM（deepseek-chat）提取结构化画像 → 生成 profile 结构。
 * 用法：node resume_parse.js <简历文件.txt> [输出profile.json]
 * 参考 job-application-copilot 的 resume_import（LLM 提取 + FIELD_GUIDE），对齐本项目 profile.json 结构。
 */
const fs = require('node:fs');
const path = require('node:path');

const CONFIG_PATH = path.join(__dirname, 'data', 'scorer-config.json');

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
    "skills": ["技能"],
    "experience_summary": "实习/工作经历摘要，一段话概括核心能力",
    "work_experience": [ { "company": "公司", "title": "岗位", "start": "YYYY-MM", "end": "YYYY-MM", "highlights": "亮点，一段话" } ]
  },
  "job_search": {
    "target_roles": ["目标岗位方向，如 采购/供应链"],
    "target_industries": ["目标行业"],
    "cities": ["目标城市"],
    "graduation_year": "毕业届次，如 2027届"
  }
}`;

async function llmParseProfile(text) {
  if (!LLM.apiKey) throw new Error('需要设置 DEEPSEEK_API_KEY 或 data/scorer-config.json');
  const prompt = `你是简历解析助手。请从下面的简历文本中提取结构化信息，输出一个 JSON 对象，结构如下（找不到的字段省略或给空数组）：

${SCHEMA_HINT}

要求：
1. 只提取简历中能确认的信息，不要臆造
2. 教育/工作经历按时间倒序（最近的在前）
3. 目标岗位/行业/城市：从简历经历和专业推断，合理即可
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
  return JSON.parse(content.slice(start, end));
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
async function llmTailorResume(jd, profile) {
  if (!LLM.apiKey) throw new Error('需要设置 DEEPSEEK_API_KEY 或 data/scorer-config.json');
  const profileStr = JSON.stringify(profile).slice(0, 6000);
  const prompt = `你是资深简历优化专家。根据目标岗位 JD 和候选人简历画像，给出简历定制建议。

【核心原则：证据优先，严禁编造】
简历里的经历是不可变事实，你只能"选择、重组、强调、量化表达"已有经历，绝不能编造不存在的经历/技能/数据。

【JD 解析】
从 JD 提取：硬性门槛（学历/专业/年限/证书）、核心技能（工具/方法论/业务能力）、软性特质、Top 关键短语（ATS 会精确匹配的词，如"供应链管理""品类规划"）。

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

module.exports = { extractText, llmParseProfile, llmTailorResume };
