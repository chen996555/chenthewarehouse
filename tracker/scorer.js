'use strict';

/**
 * 求职星计划 — 打分器（精排 · 非推理模型版）
 *
 * 设计目标（结合 2027 届应届 + 秋招海投的实际需求）：
 *   - 用非推理模型替代推理模型，因此把「打连续总分」改成「结构化抽取 + 低分辨率判定」，
 *     让模型只做它擅长的两件事：抽硬性要求（extraction）、做 0-2 三档判断（classification）。
 *   - 相关度排序交给 reranker（bge-reranker-v2-m3 交叉编码器，可复现、便宜），LLM 只管否决/加减。
 *   - 硬门槛用代码复核，不靠 LLM 猜，杜绝「投了个学历/届次根本不符的岗位」这类硬伤。
 *   - 分档输出（A 强推 / B 建议投 / C 备选 / D 不投），推荐量放宽到 50-60，符合秋招多投。
 *
 * 流水线：
 *   阶段0 类型筛选（formal/intern/all）
 *   阶段1 硬过滤（代码，0 token）：城市 / 学历 / 社招 / 排除词 / 薪资
 *   阶段2 语义重排（reranker 全量排序；失败回退关键词粗排）
 *   阶段3 取 top rrCap + 公司多样性（diversityPick）
 *   阶段4 判定（LLM 非推理模型，缓存优先）：JD 结构化抽取 + 硬门槛复核 + 4 项 0-2 判定（证据锚定）
 *   阶段5 分档 + 公司预算
 *
 * LLM 配置（环境变量 / data/scorer-config.json）：
 *   DEEPSEEK_API_KEY  主模型 key
 *   judgeModel        判定模型（默认 fastModel，非推理）
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const reranker = require('./reranker');
const detail = require('./detail');

// ---- 打分缓存（确定性层：同一岗位不重复打分） ----------------------------------

const CACHE_PATH = path.join(__dirname, 'data', 'score-cache.json');
let cacheStore = null;

function loadCache() {
  if (cacheStore) return cacheStore;
  try {
    cacheStore = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  } catch {
    cacheStore = {};
  }
  return cacheStore;
}

function saveCache() {
  if (!cacheStore) return;
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cacheStore), 'utf8');
}

function cacheKey(job, profileKey = '') {
  const raw = `${profileKey}|${job.company || ''}|${job.title || ''}`;
  return crypto.createHash('md5').update(raw).digest('hex').slice(0, 16);
}

const PROFILE_PATH = path.join(__dirname, 'data', 'profile.json');
const CONFIG_PATH = path.join(__dirname, 'data', 'scorer-config.json');

// LLM 配置优先级：本地 config 文件 > 环境变量 > 默认值
// （API key 只存本机文件/环境变量，不在聊天中传输）
function loadLlmConfig() {
  let fileCfg = {};
  try {
    if (fs.existsSync(CONFIG_PATH)) fileCfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch { /* 忽略损坏的配置 */ }
  return {
    apiKey: String(fileCfg.apiKey || process.env.DEEPSEEK_API_KEY || ''),
    baseUrl: String(fileCfg.baseUrl || process.env.SCORER_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, ''),
    model: String(fileCfg.model || process.env.SCORER_MODEL || 'deepseek-v4-pro'),
    fastModel: String(fileCfg.fastModel || process.env.SCORER_FAST_MODEL || 'deepseek-v4-flash'),
    // 判定模型（精排用）：真正的非推理模型是 deepseek-chat（v4-flash 实为推理模型、会返回空 content）
    judgeModel: String(fileCfg.judgeModel || process.env.SCORER_JUDGE_MODEL || 'deepseek-chat'),
  };
}

const LLM_CONFIG = loadLlmConfig();

function loadProfile() {
  const raw = fs.readFileSync(PROFILE_PATH, 'utf8');
  return JSON.parse(raw);
}

// ---- 阶段一：确定性硬过滤 ----------------------------------------------------

// 岗位分类：实习 / 校招正式 / 社招 / 其他
function jobCategory(job) {
  const t = String(job.type || job.employmentType || job.program || '');
  if (/实习/.test(t)) return 'intern';
  if (/正式|全职/.test(t)) return 'formal';
  if (/社招|社会招聘/.test(t)) return 'social';
  return 'other';
}

// 投递类型筛选：formal 只留校招正式，intern 只留实习，all 不过滤
function typeMatch(job, typeFilter) {
  if (!typeFilter || typeFilter === 'all') return true;
  const cat = jobCategory(job);
  if (typeFilter === 'formal') return cat === 'formal';
  if (typeFilter === 'intern') return cat === 'intern';
  return true;
}

// 城市硬过滤：岗位地点需命中目标城市之一；地点未知则保留（交给后续判断）
function cityMatch(job, profile) {
  const cities = profile.job_search.cities || [];
  if (!cities.length) return { keep: true };
  const loc = String(job.location || '');
  if (!loc.trim()) return { keep: true, note: '地点未知' };
  const hit = cities.find((c) => loc.includes(c.replace(/市$/, '')) || loc.includes(c));
  return hit
    ? { keep: true }
    : { keep: false, reason: `地点不符：${loc}（目标 ${cities.join('/')}）` };
}

// 学历硬伤：岗位要求博士而候选人是硕士 → 排除
function degreeMatch(job) {
  const deg = String(job.degree || job.education || '');
  if (/博士/.test(deg) && !/硕士|本科|大专|不限/.test(deg)) {
    return { keep: false, reason: `学历不符：要求 ${deg}` };
  }
  return { keep: true };
}

function hardFilter(job, profile) {
  const checks = [
    cityMatch(job, profile),
    degreeMatch(job),
  ];

  // 社招岗位（应届生默认排除：社招通常要求 1 年以上全职经验）
  if (jobCategory(job) === 'social') {
    checks.push({ keep: false, reason: '社招岗位（应届生按默认排除，可用 typeFilter 覆盖）' });
  }

  // 排除词（岗位名 + JD）
  const excludes = profile.job_search.exclude_keywords || [];
  for (const kw of excludes) {
    if (String(job.title + ' ' + (job.jd || '')).includes(kw)) {
      checks.push({ keep: false, reason: `命中排除词：${kw}` });
    }
  }

  // 薪资底线（null = 不限，跳过）
  const floor = profile.job_search.salary_floor;
  if (floor) {
    // 粗略解析「15-20K」中的最大值与底线比较（单位千）
    const m = String(job.salary || '').match(/(\d+(?:\.\d+)?)\s*[kK]/);
    if (m && Number(m[1]) < Number(floor)) {
      checks.push({ keep: false, reason: `薪资低于底线：${job.salary}` });
    }
  }

  const failed = checks.filter((c) => !c.keep);
  return { keep: failed.length === 0, reasons: failed.map((f) => f.reason), notes: checks.filter((c) => c.note).map((c) => c.note) };
}

// ---- LLM 工具 ---------------------------------------------------------------

async function callLLM(messages, { temperature = 0.2, maxTokens = 20000, model = LLM_CONFIG.model } = {}) {
  if (!LLM_CONFIG.apiKey) {
    throw new Error('AI 打分需要设置环境变量 DEEPSEEK_API_KEY（不要发在聊天里，请自行写入系统环境变量或 config）');
  }
  const res = await fetch(`${LLM_CONFIG.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${LLM_CONFIG.apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`LLM 调用失败 HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const content = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
  if (!content.trim()) {
    throw new Error('模型返回空内容（输出被截断），已自动缩小批次重试');
  }
  return content;
}

function parseJsonLoose(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

// ---- 候选人画像 → system 消息（固定前缀：命中 DeepSeek prompt 缓存，降本） ------

function buildProfileSystem(profile) {
  const bg = profile.background;
  return `你是严谨的校招匹配评估员。只依据候选人简历与岗位 JD 中明确的事实评估，不编造、不脑补。

## 候选人（2027 届应届，硕士）
- 教育：${bg.education.map((e) => `${e.school} ${e.degree} ${e.major}（${e.start}~${e.end}）`).join('；')}
- 证书：${(bg.certificates || []).join('、')}
- 技能：${(bg.skills || []).join('、')}
- 经历摘要：${bg.experience_summary}
- 目标方向：${profile.job_search.target_roles.join('、')}
- 期望城市：${profile.job_search.cities.join('/')}`;
}

// 岗位列表 → user 消息（判定版：抽取硬要求 + 4 项低分辨率判定）
function buildJudgeUser(jobs) {
  const jobLines = jobs.map((j, i) => {
    const jd = String(j.jd || '').replace(/\s+/g, ' ').slice(0, 800);
    const meta = [
      j.location ? `地点:${j.location}` : '',
      j.type ? `类型:${j.type}` : '',
      j.program ? `项目:${j.program}` : '',
      j.degree ? `学历要求:${j.degree}` : '',
      j.date ? `发布:${j.date}` : '',
    ].filter(Boolean).join('；');
    return `【岗位${i}】id:${j.id} | ${j.company}｜${j.title}｜${meta}｜JD:${jd || '(无JD)'}`;
  }).join('\n\n');

  return `## 岗位列表（共 ${jobs.length} 个）
${jobLines}

## 对每个岗位打 4 个整数分（每项 0-2，据标题/JD 与候选人画像比对）：
- duty_match 职责相关度：0 无关 / 1 部分相关 / 2 高度相关
- transferable 成果可迁移：0 不能 / 1 部分 / 2 充分
- skill_gap 硬技能缺口：0 无缺口 / 1 有缺口 / 2 严重缺口（越大越不匹配）
- direction 方向命中：0 否 / 1 相邻 / 2 是

## 并抽取每个岗位的「硬性要求」hard_reqs（仅 JD 明确写出的必须满足项，宁缺毋滥）：
- field 取值：degree(学历) / graduation(届次) / experience(工作经验) / cert(证书) / major(专业)
- value：原文要求（如「硕士」「2027届」「1年以上」「CET-6」）
- req：must（明确必须）或 preferred（优先，非硬性）
若 JD 未明确写出，则 hard_reqs 为空数组 []

## 输出（严格 JSON，不要 Markdown 代码块，不要输出任何推理/解释文字）
{"results":[{"idx":0,"hard_reqs":[{"field":"degree","value":"硕士","req":"must"}],"judge":{"duty_match":2,"transferable":1,"skill_gap":0,"direction":2}}]}
按 idx 升序输出，共 ${jobs.length} 条，不得遗漏、不得改变 idx。`;
}

// 判定调用（非推理模型）：返回 [{idx(全局), hard_reqs, judge}]
async function judgeJobs(jobs, profile, model = LLM_CONFIG.judgeModel) {
  const chunkSize = 8;    // 8 岗一批：既不截断，又不让非推理模型偷懒打 0 分
  const concurrency = 3;  // 并行批次（触发限流时降到 2）

  const chunks = [];
  for (let i = 0; i < jobs.length; i += chunkSize) {
    chunks.push({ offset: i, jobs: jobs.slice(i, i + chunkSize) });
  }

  const system = buildProfileSystem(profile);
  const judgeChunk = async ({ offset, jobs: chunk }) => {
    const user = buildJudgeUser(chunk);
    const raw = await callLLM([{ role: 'system', content: system }, { role: 'user', content: user }], { model });
    const parsed = parseJsonLoose(raw);
    if (!parsed || !Array.isArray(parsed.results)) {
      throw new Error(`判定返回格式无效（前 200 字）：${raw.slice(0, 200)}`);
    }
    return parsed.results.map((r) => ({ ...r, idx: Number(r.idx) + offset }));
  };

  const results = [];
  for (let i = 0; i < chunks.length; i += concurrency) {
    const group = chunks.slice(i, i + concurrency);
    const groupResults = await Promise.all(group.map(async (c) => {
      try {
        return await judgeChunk(c);
      } catch (e) {
        console.error('[打分] 单批失败（该批岗位降级）:', e.message.slice(0, 150));
        return [];
      }
    }));
    results.push(...groupResults.flat());
  }
  return results;
}

// ---- 阶段四补：硬门槛代码复核 -------------------------------------------------

// 用 LLM 抽取出的 hard_reqs 与 profile 精确比对，产出 gate 状态（pass/maybe/fail）
// 只对高置信度字段（学历/工作经验/届次）做硬否决，其余一律降为「存疑」，宁保守不误杀。
function gateCheck(hardReqs, profile) {
  const bg = profile.background || {};
  const certs = ((bg.certificates || []).join(' '));
  const degrees = (bg.education || []).map((e) => String(e.degree || '')).join(' ');
  const hasMaster = /硕士|博士/.test(degrees);
  const hasDoctor = /博士/.test(degrees);
  const gradYear = String(profile.job_search.graduation_year || '2027届').replace('届', '');

  const reqs = Array.isArray(hardReqs) ? hardReqs : [];
  if (!reqs.length) return { status: 'maybe', reasons: ['JD 未提供硬性要求，默认存疑（人工看详情页）'] };

  const fails = [];
  const maybes = [];
  for (const r of reqs) {
    const field = String(r.field || '').toLowerCase();
    const value = String(r.value || '');
    const isMust = String(r.req || 'must') !== 'preferred';
    if (!isMust) continue; // preferred 不否决

    if (field === 'degree' || field === '学历') {
      if (/博士/.test(value) && !hasDoctor) fails.push(`学历硬性要求博士：${value}`);
      else if (/博士/.test(value)) maybes.push(`学历要求博士（简历为硕士）：${value}`);
      else if (/硕士/.test(value) && !hasMaster) maybes.push(`学历要求：${value}`);
    } else if (field === 'experience' || field === '工作经验' || field === '工作年限') {
      const years = value.match(/(\d+(?:\.\d+)?)\s*年/);
      if (years && Number(years[1]) >= 1) fails.push(`要求 ${value} 全职经验（应届不符）`);
      else if (/经验|年限|年以/.test(value)) maybes.push(`经验要求：${value}`);
    } else if (field === 'graduation' || field === '届次') {
      if (/(\d{4})届/.test(value)) {
        const y = value.match(/(\d{4})届/)[1];
        if (y !== gradYear) fails.push(`届次要求 ${value}（候选 ${gradYear} 届）`);
      } else if (/应届/.test(value)) {
        maybes.push(`届次要求：${value}`);
      }
    } else if (field === 'cert' || field === '证书') {
      const need = value.replace(/[，,、\s和及或]/g, '');
      if (need && !certs.includes(need)) maybes.push(`证书要求：${value}（简历未见）`);
    } else if (field === 'major' || field === '专业') {
      maybes.push(`专业要求：${value}`);
    } else {
      maybes.push(`硬性要求：${value}`);
    }
  }

  if (fails.length) return { status: 'fail', reasons: fails };
  if (maybes.length) return { status: 'maybe', reasons: maybes };
  return { status: 'pass', reasons: [] };
}

// 计算 gate 状态：JD 缺失存疑；抽取到硬性要求则代码精确比对；否则通过
function computeGate(r, jdMissing, profile) {
  if (jdMissing) return { status: 'maybe', reasons: ['JD 缺失，仅据标题判定'] };
  const reqs = Array.isArray(r.hard_reqs) ? r.hard_reqs.filter((x) => x && x.field) : [];
  if (!reqs.length) return { status: 'pass', reasons: [] };
  const g = gateCheck(reqs, profile);
  return { status: g.status, reasons: g.reasons };
}

// ---- 阶段五：分档 + 公司预算 --------------------------------------------------

const TIER_LABEL = { A: '强烈推荐', B: '建议投递', C: '备选', D: '不投' };
const SUGGESTION = {
  A: '优先投，精读 JD 后投递',
  B: '纳入海投池，批量投',
  C: '视精力投或不投',
  D: '跳过（硬门槛不满足或匹配不足）',
};

// 由 gate + judge 计算分数（0-100）与档位
//   pos  = duty_match + transferable + direction ∈ [0,6]
//   gap  = skill_gap ∈ [0,2]（反向）
//   total = pos - gap ∈ [-2,6] → 映射到 0-100
function tierJob(gate, judge) {
  const g = judge || {};
  const num = (k) => Number(g[k]) || 0;
  const duty = num('duty_match');
  const trans = num('transferable');
  const gap = num('skill_gap');
  const dir = num('direction');
  const pos = duty + trans + dir;
  const total = pos - gap;
  const score = Math.round((Math.max(0, total) / 6) * 100);

  let tier;
  if (gate === 'fail') tier = 'D';
  else if (gate === 'pass' && pos >= 5 && gap === 0) tier = 'A';
  else if (pos >= 4 && gap <= 1) tier = 'B';
  else if (pos >= 2) tier = 'C';
  else tier = 'D';

  return { score, tier, pos, gap, total };
}

function makeVerdict(tier, gate, gateReasons) {
  const g = { pass: '硬门槛通过', maybe: '硬门槛存疑', fail: '硬门槛不满足' }[gate] || '硬门槛未知';
  if (gateReasons && gateReasons.length) return `${g}：${gateReasons.join('；')}`;
  return g;
}

// 公司预算：只对 A/B 档（可投）按公司限额，超额标记 overflow
function applyCompanyBudget(items, limit) {
  const ab = items
    .filter((j) => j.tier === 'A' || j.tier === 'B')
    .sort((a, b) => b.score - a.score);
  const companyCount = {};
  const recommended = [];
  const overflow = [];
  for (const j of ab) {
    const key = j.company || '未知';
    const used = companyCount[key] || 0;
    if (used < limit) {
      companyCount[key] = used + 1;
      recommended.push(j);
    } else {
      overflow.push({ ...j, overflow: true });
    }
  }
  return { recommended, overflow };
}

// ---- 粗排 fallback：目标方向关键词重合（reranker 不可用时） --------------------

function keywordPreRank(jobs, profile) {
  const js = profile.job_search || {};
  const portrait = js.search_portrait;
  const kws = (portrait && Array.isArray(portrait.keywords) && portrait.keywords.length)
    ? portrait.keywords.filter((k) => String(k).length >= 2)
    : (js.target_roles || []).join(' ')
        .split(/[（()、/，,\s]+/)
        .map((s) => s.trim())
        .filter((s) => s.length >= 2 && /采购|供应链|招标|寻源|降本|供应商|履约|品类/.test(s));
  const scored = jobs.map((job) => {
    const title = String(job.title || '');
    const jd = String(job.jd || '').slice(0, 2000);
    let score = 0;
    for (const kw of kws) {
      if (title.includes(kw)) score += 3;
      if (jd.includes(kw)) score += 1;
    }
    return { job, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

// 多样性选取（保底+竞争）：先每公司保底 1 个，剩余名额按全局排序竞争，每公司上限 maxPerCompany
function diversityPick(ranked, cap, maxPerCompany) {
  const picked = [];
  const companyCount = {};
  const seen = new Set();

  for (const item of ranked) {
    const key = item.job.company || '未知';
    if (companyCount[key] === undefined) {
      companyCount[key] = 1;
      picked.push(item);
      seen.add(item);
    }
  }
  for (const item of ranked) {
    if (picked.length >= cap) break;
    if (seen.has(item)) continue;
    const key = item.job.company || '未知';
    const used = companyCount[key] || 0;
    if (used < maxPerCompany) {
      companyCount[key] = used + 1;
      picked.push(item);
      seen.add(item);
    }
  }
  return picked.slice(0, cap);
}

// ---- 主入口 ------------------------------------------------------------------

async function scoreJobs(jobs, opts = {}) {
  const profile = opts.profile || loadProfile();
  const companyLimit = Number(profile.job_search.company_limit || 3);
  const rrCap = Number(opts.rrCap || 150); // 进 LLM 判定的岗位数上限（语义重排 top N）
  // 缓存命名空间：不同候选人的判定结果不可复用（打分依赖画像），用 owner 隔离
  const profileKey = String(profile.meta && profile.meta.owner || profile.identity && profile.identity.legal_name || 'default');

  // 阶段 0：投递类型筛选（formal/intern/all，默认不过滤）
  const typeFilter = opts.typeFilter || null;
  const filteredOut = [];
  const typeKept = [];
  for (const job of jobs) {
    if (typeMatch(job, typeFilter)) typeKept.push(job);
    else filteredOut.push({ ...job, filterReasons: [`类型不符：${jobCategory(job)}（筛选 ${typeFilter}）`] });
  }

  // 阶段 1：硬过滤（确定性）
  const kept = [];
  for (const job of typeKept) {
    const r = hardFilter(job, profile);
    if (r.keep) kept.push({ ...job, hardNotes: r.notes });
    else filteredOut.push({ ...job, filterReasons: r.reasons });
  }

  // 阶段 2：语义重排（reranker 全量排序；失败回退关键词粗排）
  let ranked; // [{job, score}] 降序
  let rerankerMode = 'api';
  try {
    const rr = await reranker.rerank(kept, profile);
    if (rr && rr.length) ranked = rr.map((x) => ({ job: x.job, score: x.score }));
    else throw new Error('reranker 返回空');
  } catch {
    rerankerMode = 'keyword';
    ranked = keywordPreRank(kept, profile).map((x) => ({ job: x.job, score: x.score }));
  }

  // 阶段 3：取 top rrCap + 公司多样性（避免单一公司占满判定池）
  const picked = diversityPick(ranked, rrCap, 8);
  const llmPool = picked.map((x) => x.job);
  const poolIds = new Set(llmPool.map((j) => j.id));
  const skipped = ranked
    .filter((x) => !poolIds.has(x.job.id))
    .map((x) => ({ ...x.job, skipReason: '语义重排淘汰（超出判定上限）' }));

  // 阶段 4：判定（缓存优先 + JD 抽取 + 硬门槛 + 轻量判定）
  const cache = loadCache();
  const results = new Array(llmPool.length).fill(null);
  const uncached = [];
  let cacheHits = 0;
  for (let gi = 0; gi < llmPool.length; gi++) {
    const key = cacheKey(llmPool[gi], profileKey);
    const hit = cache[key];
    if (hit && hit.judge && typeof hit.judge.duty_match === 'number' && Array.isArray(hit.hard_reqs)) {
      cacheHits++;
      results[gi] = hit;
    } else {
      uncached.push({ job: llmPool[gi], gi });
    }
  }

  let llmDegraded = false;
  if (uncached.length) {
    try {
      const judged = await judgeJobs(uncached.map((e) => e.job), profile, LLM_CONFIG.judgeModel);
      const byIdx = new Map(judged.map((r) => [r.idx, r]));
      for (let u = 0; u < uncached.length; u++) {
        const r = byIdx.get(u);
        if (r) {
          const e = uncached[u];
          cache[cacheKey(e.job, profileKey)] = r;
          results[e.gi] = r;
        }
      }
      saveCache();
    } catch (e) {
      // 判定不可用：降级为「仅语义排序，人工复核」，不阻断流程
      console.error('[打分] 判定失败：', e.message);
      llmDegraded = true;
    }
  }

  // 阶段 5：初判分档（仅据列表页标题/已有 JD）
  const rankedAll = [];
  for (let i = 0; i < llmPool.length; i++) {
    const job = llmPool[i];
    const r = results[i];
    const jdMissing = !String(job.jd || '').trim();
    let item;
    if (r && r.judge) {
      const g = computeGate(r, jdMissing, profile);
      const t = tierJob(g.status, r.judge);
      item = {
        ...job,
        score: t.score,
        tier: t.tier,
        gate: g.status,
        gateReasons: g.reasons,
        judge: r.judge,
        verdict: makeVerdict(t.tier, g.status, g.reasons),
        suggestion: SUGGESTION[t.tier],
        jdMissing,
      };
    } else {
      // 降级项：无 LLM 判定，占位档 C，人工复核
      item = {
        ...job,
        score: 0,
        tier: 'C',
        gate: 'maybe',
        gateReasons: ['LLM 判定降级（不可用），仅语义排序，需人工复核'],
        hard_reqs: [],
        judge: null,
        verdict: '判定降级：LLM 不可用，仅语义排序',
        suggestion: SUGGESTION.C,
        jdMissing,
      };
    }
    rankedAll.push(item);
  }

  // 阶段 6：on-demand 详情抓取（A/B 档中缺 JD 的岗位，补抓详情页 JD 后重判定）
  let detailFetched = 0;
  let detailDegraded = false;
  if (!opts.noDetailFetch) {
    const need = rankedAll.filter((j) => (j.tier === 'A' || j.tier === 'B') && j.jdMissing && (j.detailUrl || j.url));
    const toFetch = need.slice(0, Number(opts.maxDetailFetch || 20));
    if (toFetch.length) {
      try {
        const fetched = await detail.fetchJobDetails(toFetch, { concurrency: 3 });
        const merged = [];
        for (const f of fetched) {
          if (f.ok && f.jd) {
            const job = toFetch.find((j) => j.id === f.id);
            if (job) merged.push({ ...job, jd: f.jd });
          }
        }
        if (merged.length) {
          const rejudged = await judgeJobs(merged, profile, LLM_CONFIG.judgeModel);
          const byIdx = new Map(rejudged.map((r) => [r.idx, r]));
          for (let u = 0; u < merged.length; u++) {
            const r = byIdx.get(u);
            if (!r) continue;
            const job = merged[u];
            const idx = rankedAll.findIndex((x) => x.id === job.id);
            if (idx < 0) continue;
            const g = computeGate(r, false, profile); // 已补到 JD，校验硬性要求
            const t = tierJob(g.status, r.judge);
            rankedAll[idx] = {
              ...rankedAll[idx],
              jd: job.jd,
              jdMissing: false,
              score: t.score,
              tier: t.tier,
              gate: g.status,
              gateReasons: g.reasons,
              judge: r.judge,
              verdict: makeVerdict(t.tier, g.status, g.reasons),
              suggestion: SUGGESTION[t.tier],
            };
            detailFetched++;
          }
        }
      } catch {
        detailDegraded = true;
      }
    }
  }

  // 阶段 7：重建分档 + 公司预算
  rankedAll.sort((a, b) => b.score - a.score);
  const tiers = { A: [], B: [], C: [], D: [] };
  for (const item of rankedAll) tiers[item.tier].push(item);
  const { recommended, overflow } = applyCompanyBudget(rankedAll, companyLimit);

  return {
    total: jobs.length,
    hardFiltered: filteredOut.length,
    kept: kept.length,
    reranked: ranked.length,
    llmPool: llmPool.length,
    judged: results.filter(Boolean).length,
    cacheHits,
    filteredOut,
    recommended,   // A+B 档，公司预算后
    overflow,      // A+B 档但公司超限
    tiers,         // { A:[], B:[], C:[], D:[] }
    ranked: rankedAll, // 全部判定项按分数排序（含 C/D）
    skipped,       // 未进判定池的岗位
    companyLimit,
    llmModel: LLM_CONFIG.model,
    fastModel: LLM_CONFIG.fastModel,
    judgeModel: LLM_CONFIG.judgeModel,
    rerankerMode,
    llmDegraded,
    detailFetched,
    detailDegraded,
  };
}

module.exports = { scoreJobs, hardFilter, loadProfile, LLM_CONFIG };
