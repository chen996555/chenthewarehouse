'use strict';

/**
 * 求职星计划 — 小红书 job.xiaohongshu.com 适配器（适配器 #11，纯 HTTP）
 *
 * 岗位 API 可直接调用：
 *   POST https://job.xiaohongshu.com/websiterecruit/position/pageQueryPosition
 *   body: { label: "hot", pageNum, pageSize, recruitType: "campus" | "social" }
 */

const BASE = 'https://job.xiaohongshu.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

async function fetchXhsPage({ pageNum, pageSize, recruitType, keyword }) {
  const body = JSON.stringify({ label: 'hot', pageNum, pageSize, recruitType, positionName: keyword || '' });
  const res = await fetch(`${BASE}/websiterecruit/position/pageQueryPosition`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body,
  });
  if (!res.ok) throw new Error(`小红书 API HTTP ${res.status}`);
  const j = await res.json();
  if (!j || !j.data) throw new Error(`小红书 API 返回失败: ${(j && j.alertMsg) || ''}`);
  return j.data;
}

function mapXhsJob(item) {
  return {
    id: String(item.positionId || ''),
    title: item.positionName || '',
    team: '',
    location: item.workplace || '',
    type: '',
    category: '',
    program: '',
    date: String(item.publishTime || '').slice(0, 10),
    detailUrl: `${BASE}/social/position/${item.positionId}`,
    jd: item.duty || '',
  };
}

async function scrapeXhs({ section = 'campus', keyword = '', maxJobs = 100, fallbackName = '小红书' } = {}) {
  const cap = Math.min(Math.max(Number(maxJobs) || 100, 10), 300);
  const recruitType = section === 'social' ? 'social' : 'campus';
  const pageSize = 20;
  const seen = new Set();
  const jobs = [];
  let total = 0;

  for (let pageNum = 1; jobs.length < cap; pageNum++) {
    const data = await fetchXhsPage({ pageNum, pageSize, recruitType, keyword });
    if (pageNum === 1) total = Number(data.total ?? data.totalCount ?? data.count) || 0;
    const items = data.list || [];
    if (!items.length) break;
    for (const it of items) {
      const id = String(it.positionId);
      if (seen.has(id)) continue;
      seen.add(id);
      jobs.push(mapXhsJob(it));
    }
    if (items.length < pageSize || jobs.length >= total) break;
  }

  return {
    company: fallbackName,
    url: `${BASE}/${recruitType === 'social' ? 'social/position' : 'campus'}`,
    section: recruitType,
    keyword,
    totalOnSite: total,
    count: jobs.length,
    jobs,
  };
}

function xhsToApplication(job, { company, url }) {
  const notes = [job.location ? `地点 ${job.location}` : '', job.date ? `发布 ${job.date}` : '']
    .filter(Boolean)
    .join(' | ');
  return {
    company,
    title: job.title,
    channel: '官网',
    url: job.detailUrl || url,
    status: 'pending',
    source: 'xiaohongshu.com',
    degree: '',
    industry: '',
    jd: job.jd || '',
    notes,
  };
}

module.exports = { scrapeXhs, xhsToApplication, mapXhsJob };
