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

// 公司 → 抓取（与 server.js /api/scrape 的分发一致，保持同步）
// maxJobs 供冒烟自检传小值只抓少量；不传则各适配器用默认全量
async function scrapeCompany(company, { section = 'campus', keyword = '', maxJobs } = {}) {
  switch (company.adapter) {
    case 'zhiye': return zhiye.scrapeZhiye({ subdomain: company.subdomain, section, path: company.path, keyword, maxJobs, fallbackName: company.name });
    case 'byte': { const c = company.byte || {}; return byte.scrapeByteDance({ section, keyword, maxJobs, base: c.base, campusPath: c.campusPath, socialPath: c.socialPath }); }
    case 'hotjob': return hotjob.scrapeHotjob({ suiteId: company.suiteId, section, keyword, maxJobs, base: company.base, fallbackName: company.name });
    case 'moka': { const c = company.moka || {}; return moka.scrapeMoka({ org: c.org, siteId: c.siteId, section: c.section || section, base: c.base, pathPrefix: c.pathPrefix, keyword, maxJobs, fallbackName: company.name }); }
    case 'jd': return jd.scrapeJd({ keyword, maxJobs, fallbackName: company.name });
    case 'mt': return mt.scrapeMt({ keyword, maxJobs, fallbackName: company.name });
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
    default: throw new Error(`「${company.name}」无可用适配器（adapter=${company.adapter || 'null'}）`);
  }
}

// 分层搜索：API 支持 keyword 的适配器，用画像关键词精准抓取
// byte 浏览器关键词搜索已修好，但单次较慢（~30s），只搜最宽泛的首个关键词「采购」即可覆盖采购+供应链+招标
const KEYWORD_ADAPTERS = new Set(['jd', 'mt', 'tx', 'byte', 'ali', 'ks', 'xhs', 'zhiye', 'mhy', 'hotjob', 'ant', 'bili', 'ctrip', 'moka']);
const KEYWORD_COUNT = { byte: 2, hotjob: 2, ant: 2, bili: 2, moka: 2 };
// 浏览器型适配器：单次抓取慢（开浏览器），支持一次会话循环多关键词，避免多次开浏览器
const BROWSER_KEYWORD_ADAPTERS = new Set(['byte', 'hotjob', 'moka', 'bili', 'ant']);

// 读画像关键词，供分层搜索用。宽泛词（运营/数据分析/AI产品运营）单独搜会返回大量
// 无关岗位稀释精度，改用「采购/供应链/品类」等精准词覆盖运营方向，故过滤掉。
const WIDE_KEYWORDS = new Set(['运营', '数据分析', 'AI产品运营']);

function loadSearchKeywords() {
  try {
    const p = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'profile.json'), 'utf8'));
    const portrait = p.job_search && p.job_search.search_portrait;
    const kws = (portrait && portrait.keywords) || [];
    return kws.filter((k) => !WIDE_KEYWORDS.has(k)).slice(0, 8);
  } catch { return []; }
}

// 候选人标识（换人 = 换 profile.owner，岗位按此隔离）
function loadProfileKey() {
  try {
    const p = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'profile.json'), 'utf8'));
    return (p.meta && p.meta.owner) || (p.identity && p.identity.legal_name) || 'default';
  } catch { return 'default'; }
}

// 抓一家：支持 keyword 的适配器多关键词搜索合并；否则全量抓
async function scrapeOne(company, { section, keywords = [] } = {}) {
  if (KEYWORD_ADAPTERS.has(company.adapter) && keywords.length) {
    const kws = keywords.slice(0, KEYWORD_COUNT[company.adapter] || keywords.length);
    if (BROWSER_KEYWORD_ADAPTERS.has(company.adapter)) {
      // 浏览器型：一次会话循环搜多关键词（适配器内部合并去重，省去多次开浏览器）
      try {
        const res = await scrapeCompany(company, { section, keyword: kws });
        if (res.jobs && res.jobs.length) return res.jobs;
      } catch { /* 失败则回退全量 */ }
    } else {
      // 纯 HTTP：逐个关键词搜（快，无需合并优化）
      const seen = new Set();
      const jobs = [];
      for (const kw of kws) {
        try {
          const res = await scrapeCompany(company, { section, keyword: kw });
          for (const j of (res.jobs || [])) {
            const key = j.id || j.title;
            if (key && !seen.has(key)) { seen.add(key); jobs.push(j); }
          }
        } catch { /* 单个关键词失败，继续下一个 */ }
      }
      if (jobs.length) return jobs; // 关键词命中则返回；否则回退全量
    }
  }
  const res = await scrapeCompany(company, { section });
  return res.jobs || [];
}

// 目标公司：互联网组 + 已点亮适配器
function targetCompanies() {
  return companies.COMPANIES.filter((c) => c.group === '互联网' && c.adapter);
}

// 一键扫描
async function scanAll({ section = 'campus', importToBoard = true, onProgress, concurrency = 6 } = {}) {
  const progress = (msg) => { if (onProgress) onProgress(msg); };
  const targets = targetCompanies();
  const keywords = loadSearchKeywords();
  const profileKey = loadProfileKey();
  const prevHealth = health.loadHealth();
  const allJobs = [];
  const perCompany = [];

  // 并发抓取（浏览器抓官网是主要耗时，4 家并行把总时间压到 ~1/4）
  for (let i = 0; i < targets.length; i += concurrency) {
    const group = targets.slice(i, i + concurrency);
    const groupResults = await Promise.all(
      group.map(async (c) => {
        try {
          const rawJobs = await scrapeOne(c, { section, keywords });
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
            return { ...j, company: c.name, sourceAdapter: c.adapter, job_id: jobId, detailUrl };
          });
          return { company: c, ok: true, jobs };
        } catch (e) {
          return { company: c, ok: false, error: e.message };
        }
      })
    );
    for (const r of groupResults) {
      if (r.ok) {
        allJobs.push(...r.jobs);
        perCompany.push({ company: r.company.name, adapter: r.company.adapter, ok: true, count: r.jobs.length });
      } else {
        perCompany.push({ company: r.company.name, adapter: r.company.adapter, ok: false, error: r.error });
      }
    }
    progress(`已扫 ${perCompany.length}/${targets.length} 家…`);
  }

  // 健康基线：对比上次检测静默失效，并落盘本次抓取结果（含画像 owner，换人重置）
  const healthCheck = health.checkHealth(prevHealth, perCompany, profileKey);
  const healthIssues = healthCheck.issues || [];
  if (healthCheck.ownerChanged) {
    progress(`画像切换（${healthCheck.from} → ${healthCheck.to}），健康基线已重置`);
  }
  health.saveHealth(perCompany, allJobs.length, profileKey);

  // 精排打分（含 on-demand 补抓 JD）
  let scored = null;
  if (allJobs.length) {
    progress(`精排打分中…（共 ${allJobs.length} 个岗位）`);
    scored = await scorer.scoreJobs(allJobs, {});
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
          score: j.score || 0,
          tier: j.tier || '',
          gate: j.gate || '',
          judge_reason: j.verdict || '',
          gate_reasons: JSON.stringify(j.gateReasons || []),
          notes: j.tier === 'A' ? '强推' : '建议投',
        });
        if (r.sync === 'created') imported++;
        else if (r.sync === 'updated') updated++;
      }
    } finally {
      dbc.close();
    }
  }

  return {
    totalCompanies: targets.length,
    okCompanies: perCompany.filter((x) => x.ok).length,
    totalJobs: allJobs.length,
    perCompany,
    scored,
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
      for (const c of r.perCompany) console.log(`  ${c.ok ? '✓' : '✗'} ${c.company}${c.ok ? `（${c.count}）` : '：' + c.error}`);
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
