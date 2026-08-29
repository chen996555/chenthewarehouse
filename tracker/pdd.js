'use strict';

/**
 * 求职星计划 — 拼多多 careers.pddglobalhr.com 适配器（适配器 #9，纯 HTTP）
 *
 * 岗位 API 可直接调用：
 *   POST https://careers.pddglobalhr.com/api/careers/api/recruit/position/list
 *   body: { page, pageSize, t: null }  （t=null 为应届生；实习生待确认参数）
 * 响应: { success, result: { list: [...], total } }
 */

const BASE = 'https://careers.pddglobalhr.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function fmtDate(epochMs) {
  if (!epochMs) return '';
  const d = new Date(Number(epochMs));
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function fetchPddPage({ page, pageSize, t }) {
  const body = JSON.stringify({ page, pageSize, t: t || null });
  const res = await fetch(`${BASE}/api/careers/api/recruit/position/list`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body,
  });
  if (!res.ok) throw new Error(`拼多多 API HTTP ${res.status}`);
  const j = await res.json();
  if (!j || !j.success) throw new Error(`拼多多 API 返回失败: ${(j && j.errorMsg) || ''}`);
  return j.result || {};
}

function mapPddJob(item) {
  return {
    id: String(item.id || item.code || ''),
    title: item.name || '',
    team: '',
    location: item.workLocationName || item.workLocation || '',
    type: item.recruitTypeName || '',
    category: item.jobName || '',
    program: item.graduationYear ? `${item.graduationYear}届` : '',
    date: fmtDate(item.releaseTime),
    detailUrl: `${BASE}/campus/grad/detail?positionId=${item.id || item.code}`,
    jd: item.jobDuty || '',
  };
}

async function scrapePdd({ maxJobs = 100, fallbackName = '拼多多' } = {}) {
  const cap = Math.min(Math.max(Number(maxJobs) || 100, 10), 300);
  const pageSize = 20;
  const seen = new Set();
  const jobs = [];
  let total = 0;

  for (let page = 1; jobs.length < cap; page++) {
    const result = await fetchPddPage({ page, pageSize, t: null });
    if (page === 1) total = Number(result.total ?? result.totalCount ?? result.count) || 0;
    const items = result.list || [];
    if (!items.length) break;
    for (const it of items) {
      const id = String(it.id || it.code);
      if (seen.has(id)) continue;
      seen.add(id);
      jobs.push(mapPddJob(it));
    }
    if (items.length < pageSize || jobs.length >= total) break;
  }

  return {
    company: fallbackName,
    url: `${BASE}/campus/grad`,
    section: 'campus',
    totalOnSite: total,
    count: jobs.length,
    jobs,
  };
}

function pddToApplication(job, { company, url }) {
  const notes = [
    job.program ? `${job.program}` : '',
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
    source: 'pddglobalhr.com',
    degree: '',
    industry: '',
    jd: job.jd || '',
    notes,
  };
}

module.exports = { scrapePdd, pddToApplication, mapPddJob };
