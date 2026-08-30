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
- 手写目标方向（参考）：${(profile.job_search && profile.job_search.target_roles || []).join('、')}

## 任务：输出严格 JSON（不要 Markdown 代码块，不要解释）
{"keywords":["岗位方向关键词A","岗位方向关键词B","岗位方向关键词C"],"directions":["具体目标方向A","具体目标方向B"]}

要求：
- keywords：12-18 个搜索关键词，严格依据简历中的实习经历、教育背景、技能生成，仅覆盖简历能匹配的岗位方向，按相关度排序，宁多勿漏。
- keywords 只用「岗位方向词」（如：采购、招标、供应链、寻源、品类、采销、履约、降本），严禁用「方向+职位」复合词（如：采购实习生、供应链实习生、采购助理）——复合词会被招聘系统拆词，导致「实习生/助理」单独命中大量无关岗位稀释精度。
- directions：3-5 个目标方向描述，比 keywords 更具体（体现行业/岗位方向）。
- 严禁臆测：简历中没有经历支撑的方向（如采购、供应链、招投标）一律不要输出，不要因专业名称（如国际商务）就推断无关岗位方向。`;
}

function parseJsonLoose(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

async function generate(profilePath = PROFILE_PATH) {
  const cfg = loadLlmConfig();
  if (!cfg.apiKey) throw new Error('缺少 DEEPSEEK_API_KEY（环境变量或 scorer-config.json）');
  const profile = loadProfile(profilePath);

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

  profile.job_search = profile.job_search || {};
  profile.job_search.search_portrait = {
    keywords: portrait.keywords.map((k) => String(k).trim()).filter(Boolean),
    directions: (portrait.directions || []).map((d) => String(d).trim()).filter(Boolean),
    generated_at: new Date().toISOString(),
  };
  fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2), 'utf8');

  console.log('搜索画像已生成，写入 job_search.search_portrait：');
  console.log(JSON.stringify(profile.job_search.search_portrait, null, 2));
  return profile.job_search.search_portrait;
}

if (require.main === module) {
  generate().catch((e) => { console.error('失败:', e.message); process.exit(1); });
}

module.exports = { generate, loadProfile };
