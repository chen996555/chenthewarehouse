'use strict';

/**
 * 求职星计划 — 一键全自动扫描（scan）
 *
 * 读 profile → 遍历目标公司（互联网组、已点亮适配器）自动抓校招岗位
 * → 汇总精排打分（硬过滤 + 语义重排 + 判定 + 补抓JD）→ A+B 档自动导入看板「待投」。
 * 坏的适配器单独报出来，不阻断整体。
 *
 * 用法：
 *   node scan.js            # 命令行直接跑
 *   POST /api/scan          # 看板「一键扫描」按钮走这里（异步任务）
 */

const companies = require('./companies');
const scorer = require('./scorer');
const db = require('./db');
const health = require('./health');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const zhiye = require('./zhiye');
const byte = require('./byte');
const hotjob = require('./hotjob');
const moka = require('./moka');
const jd = require('./jd');
const mt = require('./mt');
const ali = require('./ali');
const tx = require('./tx');
const pdd = require('./pdd');
const ks = require('./ks');
const xhs = require('./xhs');
const bili = require('./bili');
const ant = require('./ant');
const mhy = require('./mhy');
const ctrip = require('./ctrip');
const ne = require('./ne');
const sf = require('./sf');
const liauto = require('./liauto');
const baidu = require('./baidu');
const oppo = require('./oppo');
const byd = require('./byd');
const pingan = require('./pingan');
const wecruit = require('./wecruit');
const huawei = require('./huawei');
const vivo = require('./vivo');
const embedding = require('./embedding');

// 扫描结果缓存（公司+关键词 → 岗位列表）：第二次扫描命中缓存秒级复用，不重复抓取
const JOBS_CACHE_PATH = path.join(__dirname, 'data', 'jobs-cache.json');
const JOBS_CACHE_TTL = 2 * 60 * 60 * 1000; // 2 小时有效期（岗位数据短时间内不变）
let jobsCache = null;
function loadJobsCache() {
  if (jobsCache) return jobsCache;
  try { jobsCache = JSON.parse(fs.readFileSync(JOBS_CACHE_PATH, 'utf8')); } catch { jobsCache = {}; }
  return jobsCache;
}
function saveJobsCache() {
  if (!jobsCache) return;
  try { fs.writeFileSync(JOBS_CACHE_PATH, JSON.stringify(jobsCache), 'utf8'); } catch {}
}
async function scrapeCompanyCached(company, opts) {
  const key = `${company.adapter}|${company.name}|${opts.section || 'campus'}|${opts.keyword || ''}|${opts.maxJobs || ''}`;
  const cache = loadJobsCache();
  const hit = cache[key];
  if (hit && hit.ts && Date.now() - hit.ts < JOBS_CACHE_TTL) return hit.result;
  const result = await scrapeCompany(company, opts);
  cache[key] = { ts: Date.now(), result };
  saveJobsCache();
  return result;
}

// 公司 → 抓取（与 server.js /api/scrape 的分发一致，保持同步）
// maxJobs 供冒烟自检传小值只抓少量；不传则各适配器用默认全量
async function scrapeCompany(company, { section = 'campus', keyword = '', maxJobs } = {}) {
  switch (company.adapter) {
    case 'zhiye': return zhiye.scrapeZhiye({ subdomain: company.subdomain, section, path: company.path, keyword, maxJobs, fallbackName: company.name });
    case 'byte': { const c = company.byte || {}; return byte.scrapeByteDance({ section: c.section || section, keyword, maxJobs, base: c.base, campusPath: c.campusPath, socialPath: c.socialPath, fallbackName: company.name }); }
    case 'hotjob': return hotjob.scrapeHotjob({ suiteId: company.suiteId, section, keyword, maxJobs, base: company.base, fallbackName: company.name });
    case 'moka': { const c = company.moka || {}; return moka.scrapeMoka({ org: c.org, siteId: c.siteId, section: c.section || section, base: c.base, pathPrefix: c.pathPrefix, keyword, maxJobs, fallbackName: company.name }); }
    case 'jd': return jd.scrapeJd({ keyword, maxJobs, fallbackName: company.name });
    case 'mt': return mt.scrapeMt({ section, keyword, maxJobs, fallbackName: company.name });
    case 'ali': return ali.scrapeAli({ keyword, maxJobs, fallbackName: company.name });
    case 'tx': return tx.scrapeTx({ keyword, maxJobs, fallbackName: company.name });
    case 'pdd': return pdd.scrapePdd({ maxJobs, fallbackName: company.name });
    case 'ks': return ks.scrapeKs({ keyword, maxJobs, fallbackName: company.name });
    case 'xhs': return xhs.scrapeXhs({ section, keyword, maxJobs, fallbackName: company.name });
    case 'bili': return bili.scrapeBili({ keyword, maxJobs, fallbackName: company.name });
    case 'ant': return ant.scrapeAnt({ keyword, maxJobs, fallbackName: company.name });
    case 'mhy': return mhy.scrapeMhy({ keyword, maxJobs, fallbackName: company.name });
    case 'ctrip': return ctrip.scrapeCtrip({ keyword, maxJobs, fallbackName: company.name });
    case 'ne': return ne.scrapeNe({ maxJobs, fallbackName: company.name });
    case 'sf': return sf.scrapeSf({ keyword, maxJobs, fallbackName: company.name });
    case 'liauto': return liauto.scrapeLiauto({ section, keyword, maxJobs, fallbackName: company.name });
    case 'baidu': return baidu.scrapeBaidu({ section, keyword, maxJobs, fallbackName: company.name });
    case 'oppo': return oppo.scrapeOppo({ section, keyword, maxJobs, fallbackName: company.name });
    case 'byd': return byd.scrapeByd({ keyword, maxJobs, fallbackName: company.name });
    case 'pingan': return pingan.scrapePingan({ keyword, maxJobs, fallbackName: company.name });
    case 'wecruit': return wecruit.scrapeWecruit({ suiteId: company.suiteId, section, keyword, maxJobs, fallbackName: company.name });
    case 'huawei': return huawei.scrapeHuawei({ keyword, maxJobs, fallbackName: company.name });
    case 'vivo': return vivo.scrapeVivo({ keyword, maxJobs, fallbackName: company.name });
    default: throw new Error(`「${company.name}」无可用适配器（adapter=${company.adapter || 'null'}）`);
  }
}

// 分层搜索：API 支持 keyword 的适配器，用画像关键词精准抓取
// byte 浏览器关键词搜索已修好，但单次较慢（~30s），只搜最宽泛的首个关键词「采购」即可覆盖采购+供应链+招标
const KEYWORD_ADAPTERS = new Set(['jd', 'mt', 'tx', 'byte', 'ali', 'ks', 'xhs', 'zhiye', 'mhy', 'hotjob', 'ant', 'bili', 'ctrip', 'moka']);
const KEYWORD_COUNT = { byte: 2, hotjob: 2, ant: 2, bili: 2, moka: 2 };
// 浏览器型适配器：单次抓取慢（开浏览器），支持一次会话循环多关键词，避免多次开浏览器
// 浏览器型适配器已全部纯 HTTP 化（moka/byte/ant/bili/hotjob），此集合为空；保留占位以便未来某家需回退浏览器
const BROWSER_KEYWORD_ADAPTERS = new Set([]);

// 读画像关键词，供分层搜索用。宽泛词（运营/数据分析/AI产品运营）单独搜会返回大量
// 无关岗位稀释精度，改用「采购/供应链/品类」等精准词覆盖运营方向，故过滤掉。
const WIDE_KEYWORDS = new Set(['运营', '数据分析', 'AI产品运营']);

function loadSearchKeywords() {
  let p;
  try {
    p = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'profile.json'), 'utf8'));
  } catch (e) {
    throw new Error(`读取画像 profile.json 失败：${e.message}`);
  }
  const portrait = p.job_search && p.job_search.search_portrait;
  const kws = (portrait && Array.isArray(portrait.keywords) && portrait.keywords) || [];
  if (!kws.length) {
    throw new Error('画像关键词 search_portrait 缺失或为空：请先运行 node portrait.js 生成（分层搜索禁止静默回退全量）');
  }
  const filtered = kws.filter((k) => !WIDE_KEYWORDS.has(k)).slice(0, 8);
  if (!filtered.length) {
    throw new Error('画像关键词全被 WIDE_KEYWORDS 过滤（只剩宽泛词），请运行 node portrait.js 重新生成');
  }
  return filtered;
}

// 候选人标识（换人 = 换 profile.owner，岗位按此隔离）
function loadProfileKey() {
  try {
    const p = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'profile.json'), 'utf8'));
    return (p.meta && p.meta.owner) || (p.identity && p.identity.legal_name) || 'default';
  } catch { return 'default'; }
}

// 读画像投递范围（apply_scopes）：应届生默认 ['campus','intern']；社招用户配 ['social']
function loadApplyScopes() {
  try {
    const p = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'profile.json'), 'utf8'));
    const scopes = (p.job_search && p.job_search.apply_scopes) || ['campus'];
    return Array.isArray(scopes) && scopes.length ? scopes : ['campus'];
  } catch { return ['campus']; }
}

// 抓一家：支持 keyword 的适配器多关键词搜索合并；否则全量抓
const SCRAPE_TIMEOUT_MS = 10000; // 单家抓取超时（防止个别公司接口卡住拖慢整批）

async function scrapeOne(company, opts = {}) {
  return Promise.race([
    scrapeOneInner(company, opts),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`抓取超时（${SCRAPE_TIMEOUT_MS / 1000}s）`)), SCRAPE_TIMEOUT_MS)),
  ]);
}

async function scrapeOneInner(company, { section, keywords = [], keywordLimit = 1 } = {}) {
  // 返回 { jobs, searchMode }：searchMode = 'keyword'（关键词精准）/ 'fallback'（回退全量）。
  // 关键：关键词搜索「全部失败」≠「无命中」——全部失败说明接口/认证坏了，抛错阻断，禁止静默回退全量掩盖失效。
  if (KEYWORD_ADAPTERS.has(company.adapter) && keywords.length) {
    const kws = keywords.slice(0, KEYWORD_COUNT[company.adapter] || keywordLimit); // 多关键词召回
    let hit = 0;      // 关键词搜索成功（接口正常返回）的次数
    let failed = 0;   // 关键词搜索失败（抛错）的次数
    if (BROWSER_KEYWORD_ADAPTERS.has(company.adapter)) {
      // 浏览器型：一次会话循环搜多关键词（适配器内部合并去重，省去多次开浏览器）
      try {
        const res = await scrapeCompanyCached(company, { section, keyword: kws });
        hit++;
        if (res.jobs && res.jobs.length) return { jobs: res.jobs, searchMode: 'keyword' };
      } catch { failed++; }
    } else {
      // 纯 HTTP：逐个关键词搜（快，无需合并优化）
      const seen = new Set();
      const jobs = [];
      for (const kw of kws) {
        try {
          const res = await scrapeCompanyCached(company, { section, keyword: kw });
          hit++;
          for (const j of (res.jobs || [])) {
            const key = j.id || j.title;
            if (key && !seen.has(key)) { seen.add(key); jobs.push(j); }
          }
        } catch { failed++; }
      }
      if (jobs.length) return { jobs, searchMode: 'keyword' }; // 关键词命中
      // 纯 HTTP server-side 精确匹配：全部关键词成功但无命中 = 真无岗，返回空（不回退全量兜底，省 token）
      if (failed === 0) return { jobs: [], searchMode: 'keyword' };
    }
    // 关键词搜索「全部失败」→ 接口/认证失效，抛错阻断（全量抓同样会失败，静默回退只会掩盖问题）
    if (failed > 0 && hit === 0) {
      throw new Error(`关键词搜索全部失败（${failed}/${kws.length} 个关键词），疑似接口/认证失效，请先跑 smoke.js 排查`);
    }
    // 「成功但无命中」→ 回退全量，searchMode 标记为 fallback 供健康基线关注
  }
  const res = await scrapeCompanyCached(company, { section, maxJobs: 30 });
  return { jobs: res.jobs || [], searchMode: 'fallback' };
}

// 目标公司：所有组 + 已点亮适配器（不限组，互联网/金融/制造/央企/医药/半导体等全纳入）
function targetCompanies() {
  return companies.COMPANIES.filter((c) => c.adapter);
}

// 一键扫描
async function scanAll({ section, importToBoard = true, onProgress, onLive, concurrency = 30, userId = '' } = {}) {
  const progress = (msg) => { if (onProgress) onProgress(msg); };
  const t0 = Date.now();
  const targets = targetCompanies();
  const keywords = loadSearchKeywords();
  const keywordHash = crypto.createHash('md5').update(keywords.join('|')).digest('hex').slice(0, 8);
  const profileKey = loadProfileKey();
  // 单 scope 抓取（默认画像 apply_scopes 首项，通常 campus）。section 区分靠岗位字段判断（jobType/hireMode/seasonType），不翻倍抓取
  const applyScopes = loadApplyScopes();
  const scope = section || (applyScopes[0] || 'campus');
  const prevHealth = health.loadHealth();
  const allJobs = [];
  const perCompany = [];
  const pendingRecall = []; // 关键词无命中的公司，待语义召回兜底（防漏）
  const recalledJobs = []; // 兜底召回的岗位（单独判定，不挤占主池）

  // 并发抓取（浏览器抓官网是主要耗时，4 家并行把总时间压到 ~1/4）
  for (let i = 0; i < targets.length; i += concurrency) {
    const group = targets.slice(i, i + concurrency);
    const groupResults = await Promise.all(
      group.map(async (c) => {
        try {
          const { jobs: rawJobs, searchMode } = await scrapeOne(c, { section: scope, keywords, keywordLimit: 5 });
          // 统一数据层：job_id 为唯一身份，detailUrl 由公司 reach 配置生成（direct=模板+ID，navigate=entryUrl）
          const jobs = (rawJobs || []).map((j) => {
            const jobId = String(j.id || j.job_id || '');
            const reach = c.reach || {};
            let detailUrl = j.detailUrl || j.url || '';
            if (reach.type === 'direct' && reach.urlTemplate && jobId) {
              detailUrl = reach.urlTemplate.replace('{id}', jobId);
            } else if (reach.type === 'navigate') {
              detailUrl = reach.entryUrl || detailUrl;
            }
            // section 优先用适配器从岗位字段判断的结果（jobType/hireMode/seasonType），否则用抓取 scope
            return { ...j, company: c.name, sourceAdapter: c.adapter, job_id: jobId, detailUrl, section: j.section || scope };
          });
          return { company: c, ok: true, jobs, searchMode };
        } catch (e) {
          return { company: c, ok: false, error: e.message };
        }
      })
    );
    const batchJobs = [];
    for (const r of groupResults) {
      if (r.ok) {
        allJobs.push(...r.jobs);
        batchJobs.push(...r.jobs);
        perCompany.push({ company: r.company.name, adapter: r.company.adapter, ok: true, count: r.jobs.length, searchMode: r.searchMode });
        if (r.searchMode === 'keyword' && r.jobs.length === 0) pendingRecall.push(r.company);
      } else {
        perCompany.push({ company: r.company.name, adapter: r.company.adapter, ok: false, error: r.error });
      }
    }
    if (onLive && batchJobs.length) onLive(batchJobs);
    progress(`已扫 ${perCompany.length}/${targets.length} 家…`);
  }
  progress(`扫描完成，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // 语义召回兜底：关键词无命中的公司，全量抓 + embedding 召回语义相关的岗位（防漏），并发处理
  // 已关闭（2026-08-29 用户要求提速）：全量抓 36 家太慢，防漏价值不抵耗时。保留代码可随时开
  if (false && pendingRecall.length) {
    progress(`语义召回兜底 ${pendingRecall.length} 家关键词无命中的公司…`);
    const query = keywords.join(' ');
    const recallConcurrency = 10;
    for (let i = 0; i < pendingRecall.length; i += recallConcurrency) {
      const group = pendingRecall.slice(i, i + recallConcurrency);
      const groupResults = await Promise.all(group.map(async (c) => {
        try {
          const full = await scrapeCompany(c, { section: scope, maxJobs: 100 });
          const fullJobs = (full && full.jobs) || [];
          if (!fullJobs.length) return [];
          const recalled = await embedding.semanticRecall(query, fullJobs, { topK: 20 });
          return recalled.map((x) => {
            const j = x.job;
            const jobId = String(j.id || j.job_id || '');
            if (!jobId) return null;
            const reach = c.reach || {};
            let detailUrl = j.detailUrl || j.url || '';
            if (reach.type === 'direct' && reach.urlTemplate) detailUrl = reach.urlTemplate.replace('{id}', jobId);
            else if (reach.type === 'navigate') detailUrl = reach.entryUrl || detailUrl;
            return { ...j, company: c.name, sourceAdapter: c.adapter, job_id: jobId, detailUrl, section: scope, recalled: true, recallScore: x.score };
          }).filter(Boolean);
        } catch (e) {
          progress(`  ⚠ ${c.name} 语义召回失败：${e.message.slice(0, 100)}`);
          return [];
        }
      }));
      for (const rs of groupResults) recalledJobs.push(...rs);
    }
  }
  if (pendingRecall.length) progress(`语义召回完成，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // 健康基线：对比上次检测静默失效，并落盘本次抓取结果（含画像 owner，换人重置）
  const healthCheck = health.checkHealth(prevHealth, perCompany, profileKey, keywordHash);
  const healthIssues = healthCheck.issues || [];
  if (healthCheck.ownerChanged) {
    progress(`画像切换（${healthCheck.from} → ${healthCheck.to}），健康基线已重置`);
  }
  health.saveHealth(perCompany, allJobs.length, profileKey, keywordHash);

  // 精排打分（含 on-demand 补抓 JD）
  let scored = null;
  if (allJobs.length) {
    progress(`精排打分中…（共 ${allJobs.length} 个岗位，粗排裁剪）`);
    scored = await scorer.scoreJobs(allJobs, { preFilter: true, onProgress: progress }); // 粗排裁剪到 300 再精排
    progress(`打分完成，总耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }

  // 语义召回兜底岗位单独判定（弱信号，不挤占主池 rrCap，用较小池）
  if (recalledJobs.length) {
    progress(`兜底岗位单独判定…（共 ${recalledJobs.length} 个语义召回岗位）`);
    try {
      const recalledScored = await scorer.scoreJobs(recalledJobs, { rrCap: 30 });
      if (recalledScored && recalledScored.recommended.length) {
        scored = scored || { recommended: [], overflow: [], tiers: { A: [], B: [], C: [], D: [] } };
        scored.recommended = scored.recommended.concat(recalledScored.recommended);
        for (const t of ['A', 'B', 'C', 'D']) {
          scored.tiers[t] = (scored.tiers[t] || []).concat(recalledScored.tiers[t] || []);
        }
      }
    } catch (e) {
      progress(`  ⚠ 兜底判定失败：${e.message.slice(0, 100)}`);
    }
  }

  // A+B 档自动导入看板「待投」（以 job_id 为锚点做增量同步 + 结构化打分）
  let imported = 0;
  let updated = 0;
  let skippedNoJobId = 0;
  if (importToBoard && scored && scored.recommended.length) {
    progress('导入 A+B 档到「待投」…');
    const dbc = db.getDb();
    try {
      for (const j of scored.recommended) {
        const jobId = String(j.id || j.job_id || '');
        // 源头校验：无唯一 ID 的岗位不进库（脏数据在抓取层被拦截）
        if (!jobId) { skippedNoJobId++; continue; }
        // 投递范围过滤：不在 apply_scopes 的 section（如应届生不导入社招）跳过
        if (!applyScopes.includes(j.section || scope)) continue;
        const r = db.syncApplication(dbc, {
          company: j.company,
          title: j.title,
          channel: '官网',
          url: j.detailUrl || j.url || '',
          status: 'pending',
          source: '官网扫描',
          degree: j.degree || j.education || '',
          industry: j.industry || '',
          jd: j.jd || '',
          job_id: jobId,
          profile_key: profileKey,
          user_id: userId,
          score: j.score || 0,
          tier: j.tier || '',
          gate: j.gate || '',
          judge_reason: j.verdict || '',
          gate_reasons: JSON.stringify(j.gateReasons || []),
          section: j.section || 'campus',
          notes: j.tier === 'A' ? '强推' : '建议投',
        });
        if (r.sync === 'created') imported++;
        else if (r.sync === 'updated') updated++;
      }
    } finally {
      dbc.close();
    }
  }

  // 反馈闭环：历史投递结果校准（公司回复率作为轻量信号，高回复率公司加分/升档）
  const companyReplyStats = {};
  try {
    const dbc = db.getDb();
    const rows = dbc.prepare(`
      SELECT company,
        SUM(CASE WHEN status IN ('replied','interview','offer') THEN 1 ELSE 0 END) AS replied,
        COUNT(*) AS total
      FROM applications
      WHERE status IN ('applied','replied','interview','offer')
      GROUP BY company
    `).all();
    for (const r of rows) companyReplyStats[r.company] = { replied: r.replied, total: r.total, rate: r.total > 0 ? Math.round((r.replied / r.total) * 100) : 0 };
    dbc.close();
  } catch {}
  if (scored && scored.recommended) {
    for (const j of scored.recommended) {
      const st = companyReplyStats[j.company];
      if (st && st.total > 0) {
        j.replyRate = st.rate;
        if (st.rate >= 30) { j.score = Math.min(100, (j.score || 0) + 5); if (j.tier === 'C') j.tier = 'B'; }
      }
    }
    scored.recommended.sort((a, b) => (b.score || 0) - (a.score || 0));
  }

  // 召回全量（精简版，供前端分层展示：精排推荐 + 粗筛其余）
  const allJobsSummary = allJobs.map((j) => ({
    company: j.company,
    title: j.title,
    detailUrl: j.detailUrl || j.url || '',
    job_id: j.job_id,
    city: j.city || '',
    section: j.section || scope,
  }));

  return {
    totalCompanies: targets.length,
    okCompanies: perCompany.filter((x) => x.ok).length,
    totalJobs: allJobs.length,
    perCompany,
    scored,
    allJobs: allJobsSummary,
    imported,
    updated,
    skippedNoJobId,
    health: { issues: healthIssues },
  };
}

module.exports = { scanAll, targetCompanies, scrapeCompany, scrapeOne };

// 命令行直接跑：node scan.js
if (require.main === module) {
  scanAll({})
    .then((r) => {
      console.log('\n===== 一键扫描完成 =====');
      console.log(`公司：成功 ${r.okCompanies}/${r.totalCompanies}，岗位 ${r.totalJobs} 个，导入待投 ${r.imported} 个`);
      for (const c of r.perCompany) {
        const mode = c.ok && c.searchMode === 'fallback' ? ' ⚠全量' : '';
        console.log(`  ${c.ok ? '✓' : '✗'} ${c.company}${c.ok ? `（${c.count}${mode}）` : '：' + c.error}`);
      }
      if (r.scored && r.scored.tiers) {
        console.log(`分档：A强推 ${r.scored.tiers.A.length} / B建议投 ${r.scored.tiers.B.length} / C备选 ${r.scored.tiers.C.length} / D不投 ${r.scored.tiers.D.length}`);
      }
      if (r.health && r.health.issues.length) {
        console.log('\n===== 健康告警 =====');
        for (const it of r.health.issues) {
          console.log(`  ${it.level === 'error' ? '✗ 失效' : '⚠ 疑似'} ${it.company}：${it.msg}`);
        }
      } else {
        console.log('\n健康检查：全部正常');
      }
    })
    .catch((e) => { console.error('扫描失败：', e.message); process.exit(1); });
}
