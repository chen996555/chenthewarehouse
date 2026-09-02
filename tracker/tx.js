'use strict';

/**
 * 求职星计划 — 腾讯 join.qq.com 适配器（适配器 #8，纯 HTTP）
 *
 * 岗位 API 可直接调用（只需时间戳参数）：
 *   POST https://join.qq.com/api/v1/position/searchPosition?timestamp={ms}
 *   body: { projectIdList, projectMappingIdList, keyword, ..., pageIndex, pageSize }
 * 响应: { data: { positionList: [...], count } }
 */

const BASE = 'https://join.qq.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

async function fetchTxPage({ pageIndex, pageSize, keyword }) {
  const body = JSON.stringify({
    projectIdList: [],
    projectMappingIdList: [1, 2, 104, 14, 20, 9],
    keyword: keyword || '',
    bgList: [],
    workCountryType: 0,
    workCityList: [],
    recruitCityList: [],
    positionFamilyList: [],
    pageIndex,
    pageSize,
  });
  const res = await fetch(`${BASE}/api/v1/position/searchPosition?timestamp=${Date.now()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body,
  });
  if (!res.ok) throw new Error(`腾讯 API HTTP ${res.status}`);
  const j = await res.json();
  if (!j || !j.data) throw new Error(`腾讯 API 返回失败: ${(j && j.message) || ''}`);
  return j.data;
}

function mapTxJob(item) {
  return {
    id: String(item.postId || item.id || ''),
    title: item.positionTitle || '',
    team: String(item.bgs || '').trim(),
    location: String(item.workCities || '').trim(),
    type: item.recruitLabelName || '',
    category: '',
    program: item.projectName || '',
    date: '',
    detailUrl: item.position ? `${BASE}/post.html?query=p_${item.position}` : `${BASE}/post.html`,
    jd: '',
  };
}

async function scrapeTx({ keyword = '', maxJobs = 100, fallbackName = '腾讯' } = {}) {
  const cap = Math.min(Math.max(Number(maxJobs) || 100, 10), 300);
  const pageSize = 20;
  const seen = new Set();
  const jobs = [];
  let total = 0;

  for (let pageIndex = 1; jobs.length < cap; pageIndex++) {
    const data = await fetchTxPage({ pageIndex, pageSize, keyword });
    if (pageIndex === 1) total = Number(data.count ?? data.total ?? data.totalCount) || 0;
    const items = data.positionList || [];
    if (!items.length) break;
    for (const it of items) {
      const id = String(it.postId || it.id);
      if (seen.has(id)) continue;
      seen.add(id);
      jobs.push(mapTxJob(it));
    }
    if (items.length < pageSize || jobs.length >= total) break;
  }

  return {
    company: fallbackName,
    url: `${BASE}/post.html`,
    section: 'campus',
    keyword,
    totalOnSite: total,
    count: jobs.length,
    jobs,
  };
}

function txToApplication(job, { company, url }) {
  const notes = [
    job.type ? `类型 ${job.type}` : '',
    job.program ? `项目 ${job.program}` : '',
    job.team ? `部门 ${job.team}` : '',
    job.location ? `地点 ${job.location}` : '',
  ].filter(Boolean).join(' | ');
  return {
    company,
    title: job.title,
    channel: '官网',
    url: job.detailUrl || url,
    status: 'pending',
    source: 'join.qq.com',
    degree: '',
    industry: '',
    jd: '',
    notes,
  };
}

module.exports = { scrapeTx, txToApplication, mapTxJob };
