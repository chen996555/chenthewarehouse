'use strict';

/**
 * 求职星计划 — 岗位搜索模块（阶段 2）
 * 数据源：job-hunter 内置岗位库 db/jobs.json（21111 条，url/city/salary 全覆盖）。
 * 第一阶段：确定性过滤 + 关键词打分（第二阶段 LLM 深评分后续再接，见 DESIGN-NOTES 第 2 节）。
 */

const fs = require('node:fs');
const path = require('node:path');

const JOBS_PATH = path.join(__dirname, '..', 'job-hunter', 'db', 'jobs.json');

// 数据来源与时效说明（本地这份来自 job-hunter，静态快照、非实时）
const DATA_INFO = {
  source: 'job-hunter 岗位库',
  updated: '2026-08-26',
  note: '静态快照（非实时），投递前请点「官网 ↗」核实岗位是否在招',
};

let cache = null;
let optionsCache = null;

function loadJobs() {
  if (!cache) cache = JSON.parse(fs.readFileSync(JOBS_PATH, 'utf8'));
  return cache;
}

// 关键词切分（按空白/逗号/顿号/斜杠），中文做子串匹配
function tokenize(q) {
  return String(q || '')
    .split(/[\s,，、/]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

// 命中打分：岗位名 > 关键词 > 标签 > 公司 > JD
function scoreJob(job, tokens) {
  const title = (job.title || '').toLowerCase();
  const company = (job.company || '').toLowerCase();
  const kw = (job.kw || []).join(' ').toLowerCase();
  const tags = (job.tags || []).join(' ').toLowerCase();
  const jd = [job.desc, (job.resp || []).join(' '), (job.req || []).join(' ')]
    .filter(Boolean).join(' ').toLowerCase();

  let score = 0;
  const matchOn = [];
  for (const t of tokens) {
    if (title.includes(t)) { score += 40; matchOn.push('岗位'); }
    if (kw.includes(t)) { score += 20; matchOn.push('关键词'); }
    if (tags.includes(t)) { score += 15; matchOn.push('标签'); }
    if (company.includes(t)) { score += 10; matchOn.push('公司'); }
    if (jd.includes(t)) { score += 4; matchOn.push('JD'); }
  }
  return { score, matchOn: [...new Set(matchOn)] };
}

function searchJobs({ kw = '', city = '', type = '', degree = '', industry = '', tier = '', limit = 50 } = {}) {
  const jobs = loadJobs();
  const tokens = tokenize(kw);
  const out = [];

  for (const job of jobs) {
    if (city && job.city !== city && job.prov !== city) continue;
    if (type && job.type !== type) continue;
    if (degree && job.degree !== degree) continue;
    if (industry && job.industry !== industry) continue;
    if (tier && job.tier !== tier) continue;

    if (tokens.length) {
      const { score, matchOn } = scoreJob(job, tokens);
      if (score === 0) continue;
      out.push({ ...job, score, matchOn });
    } else {
      out.push({ ...job, score: 0, matchOn: [] });
    }
  }

  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

// 筛选项可选值（供前端下拉），惰性计算
function getFilterOptions() {
  if (!optionsCache) {
    const jobs = loadJobs();
    const uniq = (k) => [...new Set(jobs.map((j) => j[k]).filter(Boolean))];
    optionsCache = {
      type: uniq('type'),
      degree: uniq('degree'),
      industry: uniq('industry'),
      tier: uniq('tier'),
    };
  }
  return { ...optionsCache, dataInfo: DATA_INFO };
}

// 岗位 → 投递记录映射（导入看板用）
function jobToApplication(job) {
  const jd = [job.desc, (job.resp || []).join('\n'), (job.req || []).join('\n')]
    .filter(Boolean).join('\n');
  return {
    company: job.company,
    title: job.title,
    channel: '官网',
    url: job.url || '',
    city: job.city || '',
    salary: job.salary || '',
    status: 'pending',
    source: 'job-hunter',
    degree: job.degree || '',
    industry: job.industry || '',
    jd,
    notes: '',
  };
}

module.exports = { loadJobs, searchJobs, getFilterOptions, jobToApplication };
