'use strict';

/**
 * 求职星计划 — 岗位搜索画像生成器
 *
 * 用 LLM 从简历（实习经历 + 教育 + 证书 + 技能）生成「搜索画像」：
 *   keywords  搜索关键词集（覆盖简历能匹配的岗位方向）
 *   directions 目标方向描述（比 keywords 更具体）
 * 写回 data/profile.json 的 job_search.search_portrait，供 reranker 与关键词粗排使用。
 *
 * 用法：node portrait.js（需已设 DEEPSEEK_API_KEY）
 */

const fs = require('node:fs');
const path = require('node:path');

const PROFILE_PATH = path.join(__dirname, 'data', 'profile.json');
const CONFIG_PATH = path.join(__dirname, 'data', 'scorer-config.json');

function loadLlmConfig() {
  let fileCfg = {};
  try { fileCfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch {}
  return {
    apiKey: String(fileCfg.apiKey || process.env.DEEPSEEK_API_KEY || ''),
    baseUrl: String(fileCfg.baseUrl || process.env.SCORER_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, ''),
    model: 'deepseek-chat',
  };
}

function loadProfile(profilePath = PROFILE_PATH) {
  return JSON.parse(fs.readFileSync(profilePath, 'utf8'));
}

function buildPrompt(profile) {
  const bg = profile.background || {};
  const work = (bg.work_experience || [])
    .map((w) => `${w.company}｜${w.title}（${w.start}~${w.end}）：${(w.highlights || '').slice(0, 100)}`)
    .join('\n');
  const edu = (bg.education || []).map((e) => `${e.school} ${e.degree} ${e.major}`).join('；');
  return `你是校招求职搜索画像生成器。根据候选人简历，生成一份「岗位搜索画像」，用于在校招官网搜索并匹配岗位。

## 候选人
- 教育：${edu}
- 实习经历：
${work}
- 证书：${(bg.certificates || []).join('、')}
- 技能：${(bg.skills || []).join('、')}
- 经历摘要：${bg.experience_summary}
- 核心目标方向（keywords 必须围绕这些方向展开）：${(profile.job_search && profile.job_search.target_roles || []).join('、')}

## 任务：输出严格 JSON（不要 Markdown 代码块，不要解释）
{"keywords":["岗位方向关键词A","岗位方向关键词B","岗位方向关键词C"],"directions":["具体目标方向A","具体目标方向B"]}

要求：
- keywords：12-18 个搜索关键词，**必须围绕上面的「核心目标方向」展开**（这是「想投的方向」，对应过往岗位的职能）；**不要从工作内容里的技能推断关键词**——过往岗位里用到的技能（如采购工作里的「数据分析」「AI」、市场工作里的「短视频」）是技能不是岗位方向，不要据此生成这类技能词；只提取与核心方向（岗位职能）直接相关的具体岗位方向词，严禁生成泛化能力词。
- keywords 只用「岗位方向词」（如：Java、前端、产品、财务、供应链、采购等，据核心目标方向而定），严禁用「方向+职位」复合词（如：Java 实习生、前端助理）——复合词会被招聘系统拆词，导致「实习生/助理」单独命中大量无关岗位稀释精度。
- 禁止「泛化能力词」：①动词（优化、管理、支持、提升、负责、跟进）②几乎所有岗位都通用的能力词——它们没有区分度，会导致推荐泛化到无关岗位；只保留能精准定位岗位方向的具体名词（职能/行业方向词）。
- directions：3-5 个目标方向描述，比 keywords 更具体，**同样围绕核心目标方向**。
- 严禁臆测：简历中没有经历支撑的方向一律不要输出，不要因专业名称就推断无关岗位方向。`;
}

function parseJsonLoose(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

// 画像生成逻辑版本：改 buildPrompt 的规则时 +1，旧画像（version 不匹配）自动失效重新生成
const SEARCH_PORTRAIT_VERSION = 'v2';

// 核心：从 profile 对象生成 search_portrait（不读写文件，多用户隔离用）
async function generatePortrait(profile) {
  const cfg = loadLlmConfig();
  if (!cfg.apiKey) throw new Error('缺少 DEEPSEEK_API_KEY（环境变量或 scorer-config.json）');

  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      messages: [{ role: 'user', content: buildPrompt(profile) }],
      temperature: 0.2,
      max_tokens: 2000,
    }),
  });
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  const content = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
  const portrait = parseJsonLoose(content);
  if (!portrait || !Array.isArray(portrait.keywords)) {
    throw new Error(`画像解析失败：${content.slice(0, 200)}`);
  }

  return {
    keywords: portrait.keywords.map((k) => String(k).trim()).filter(Boolean),
    directions: (portrait.directions || []).map((d) => String(d).trim()).filter(Boolean),
    generated_at: new Date().toISOString(),
    version: SEARCH_PORTRAIT_VERSION,
  };
}

// CLI 用：读文件 → 生成 → 写回文件
async function generate(profilePath = PROFILE_PATH) {
  const profile = loadProfile(profilePath);
  const portrait = await generatePortrait(profile);

  profile.job_search = profile.job_search || {};
  profile.job_search.search_portrait = portrait;
  fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2), 'utf8');

  console.log('搜索画像已生成，写入 job_search.search_portrait：');
  console.log(JSON.stringify(portrait, null, 2));
  return portrait;
}

// 多用户 API 用：从 profile 对象直接生成（不读写文件，避免全局文件污染）
async function generateFromProfile(profile) {
  return generatePortrait(profile);
}

if (require.main === module) {
  generate().catch((e) => { console.error('失败:', e.message); process.exit(1); });
}

module.exports = { generate, generateFromProfile, loadProfile, SEARCH_PORTRAIT_VERSION };
