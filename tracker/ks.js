'use strict';

/**
 * 求职星计划 — 快手 campus.kuaishou.cn 适配器（适配器 #10，纯 HTTP）
 *
 * 岗位 API 可直接调用：
 *   POST https://campus.kuaishou.cn/recruit/campus/e/api/v1/open/positions/simple
 *   body: { recruitSubProjectCodes: ["20271779425607"], pageSize, pageNum }
 * 类别/性质名称需从字典接口映射：GET /api/v1/dictionary/batch?types=...
 */

const BASE = 'https://campus.kuaishou.cn/recruit/campus/e';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// 应届生项目代码（27届校园招聘）
const SUB_PROJECT = '20271779425607';

async function fetchDict() {
  const res = await fetch(`${BASE}/api/v1/dictionary/batch?types=workLocation,positionCategory,positionNature`, {
    headers: { 'User-Agent': UA },
  });
  if (!res.ok) throw new Error(`快手字典 API HTTP ${res.status}`);
  const j = await res.json();
  const r = (j && j.result) || {};
  const map = (arr) => {
    const m = {};
    for (const x of arr || []) m[x.code] = x.name;
    return m;
  };
  return {
    category: map(r.positionCategory),
    nature: map(r.positionNature),
  };
}

async function fetchKsPage({ pageNum, pageSize, keyword }) {
  const body = JSON.stringify({ recruitSubProjectCodes: [SUB_PROJECT], pageSize, pageNum, name: keyword || '' });
  const res = await fetch(`${BASE}/api/v1/open/positions/simple`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body,
  });
  if (!res.ok) throw new Error(`快手 API HTTP ${res.status}`);
  const j = await res.json();
  if (!j || !j.result) throw new Error(`快手 API 返回失败: ${(j && j.message) || ''}`);
  return j.result;
}

function mapKsJob(item, dict) {
  const cities = Array.isArray(item.workLocationDicts) ? item.workLocationDicts.map((d) => d.name).filter(Boolean) : [];
  return {
    id: String(item.code || item.id || ''),
    title: item.name || '',
    team: item.departmentName || '',
    location: cities.join('、'),
    type: dict.nature[item.positionNatureCode] || item.positionNatureCode || '',
    category: dict.category[item.positionCategoryCode] || '',
    program: '',
    date: String(item.releaseTime || '').slice(0, 10),
    detailUrl: `${BASE}/#/campus/job-info/${item.code || item.id}`,
    jd: [item.description, item.positionDemand].filter(Boolean).join('\n'),
  };
}

async function scrapeKs({ keyword = '', maxJobs = 100, fallbackName = '快手' } = {}) {
  const cap = Math.min(Math.max(Number(maxJobs) || 100, 10), 300);
  const pageSize = 20;
  const dict = await fetchDict();
  const seen = new Set();
  const jobs = [];
  let total = 0;

  for (let pageNum = 1; jobs.length < cap; pageNum++) {
    const result = await fetchKsPage({ pageNum, pageSize, keyword });
    if (pageNum === 1) total = Number(result.total ?? result.totalCount ?? result.count) || 0;
    const items = result.list || [];
    if (!items.length) break;
    for (const it of items) {
      const id = String(it.code || it.id);
      if (seen.has(id)) continue;
      seen.add(id);
      jobs.push(mapKsJob(it, dict));
    }
    if (items.length < pageSize || jobs.length >= total) break;
  }

  return {
    company: fallbackName,
    url: `${BASE}/#/campus/jobs`,
    section: 'campus',
    keyword,
    totalOnSite: total,
    count: jobs.length,
    jobs,
  };
}

function ksToApplication(job, { company, url }) {
  const notes = [
    job.type ? `类型 ${job.type}` : '',
    job.category ? `类别 ${job.category}` : '',
    job.location ? `地点 ${job.location}` : '',
    job.date ? `发布 ${job.date}` : '',
  ].filter(Boolean).join(' | ');
  return {
    company,
    title: job.title,
    channel: '官网',
    url: job.detailUrl || url,
    status: 'pending',
    source: 'kuaishou.cn',
    degree: '',
    industry: '',
    jd: job.jd || '',
    notes,
  };
}

module.exports = { scrapeKs, ksToApplication, mapKsJob };
