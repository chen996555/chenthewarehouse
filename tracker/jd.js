'use strict';

/**
 * 求职星计划 — 京东 campus.jd.com 适配器（适配器 #5，纯 HTTP，无需浏览器）
 *
 * 岗位 API 无签名/加密，可直接调用：
 *   POST https://campus.jd.com/api/wx/position/page?type=present
 *   body: { pageSize, pageIndex, parameter: { positionName(关键词), ... } }
 * 响应: { success, body: { totalNumber, items: [...] } }
 */

const BASE = 'https://campus.jd.com';

function fmtDate(epochMs) {
  if (!epochMs) return '';
  const d = new Date(Number(epochMs));
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function fetchJdPage({ pageIndex, pageSize, keyword }) {
  const body = JSON.stringify({
    pageSize,
    pageIndex,
    parameter: {
      positionName: keyword || '',
      planIdList: [],
      jobDirectionCodeList: [],
      workCityCodeList: [],
      positionDeptList: [],
    },
  });
  const res = await fetch(`${BASE}/api/wx/position/page?type=present`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    },
    body,
  });
  if (!res.ok) throw new Error(`京东 API HTTP ${res.status}`);
  const j = await res.json();
  if (!j || !j.success) throw new Error('京东 API 返回失败');
  return j.body || {};
}

// API 岗位记录 → 统一岗位结构
function mapJdJob(item) {
  return {
    id: String(item.publishId),
    title: item.positionName || '',
    team: item.positionDept || '',
    location: item.workCity || '',
    type: '',
    category: item.jobDirection || '',
    program: '',
    date: fmtDate(item.publishTime),
    detailUrl: `${BASE}/#/jobs?positionId=${item.publishId}`,
    jd: [item.workContent, item.qualification].filter(Boolean).join('\n'),
  };
}

/**
 * 抓取京东校招岗位
 * @param {string} keyword 可选关键词（岗位名搜索）
 * @param {number} maxJobs 目标条数上限
 */
async function scrapeJd({ keyword = '', maxJobs = 100, fallbackName = '京东' } = {}) {
  const cap = Math.min(Math.max(Number(maxJobs) || 100, 10), 300);
  const pageSize = 50;
  const seen = new Set();
  const jobs = [];
  let total = 0;

  for (let pageIndex = 0; jobs.length < cap; pageIndex++) {
    const body = await fetchJdPage({ pageIndex, pageSize, keyword });
    if (pageIndex === 0) total = Number(body.totalNumber ?? body.total ?? body.totalCount ?? body.count) || 0;
    const items = body.items || [];
    if (!items.length) break;
    for (const it of items) {
      const id = String(it.publishId);
      if (seen.has(id)) continue;
      seen.add(id);
      jobs.push(mapJdJob(it));
    }
    if (jobs.length >= total || items.length < pageSize) break;
  }

  return {
    company: fallbackName,
    url: `${BASE}/#/jobs`,
    section: 'campus',
    keyword,
    totalOnSite: total,
    count: jobs.length,
    jobs,
  };
}

// 京东岗位 → 看板投递记录
function jdToApplication(job, { company, url }) {
  const notes = [job.category ? `方向 ${job.category}` : '', job.date ? `发布 ${job.date}` : '']
    .filter(Boolean)
    .join(' | ');
  return {
    company,
    title: job.title,
    channel: '官网',
    url: job.detailUrl || url,
    status: 'pending',
    source: 'campus.jd.com',
    degree: '',
    industry: '',
    jd: job.jd || '',
    notes,
  };
}

module.exports = { scrapeJd, jdToApplication, mapJdJob };
