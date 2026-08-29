'use strict';

/**
 * 求职星计划 — 网易 campus.163.com 适配器（适配器 #17，纯 HTTP）
 *
 * 岗位 API 可直接调用（GET，带时间戳）：
 *   https://campus.163.com/api/campuspc/position/getJobList
 *     ?pageSize=50&currentPage=1&projectId=103&timeStamp={ms}
 */

const API = 'https://campus.163.com/api/campuspc/position/getJobList';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// 网易互联网应届生项目 id=103（互娱/雷火是独立站点，暂不覆盖）
const PROJECT_ID = 103;

async function fetchNePage({ currentPage, pageSize }) {
  const url = `${API}?pageSize=${pageSize}&currentPage=${currentPage}&projectId=${PROJECT_ID}&timeStamp=${Date.now()}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`网易 API HTTP ${res.status}`);
  const j = await res.json();
  if (!j || j.code !== 200) throw new Error(`网易 API 返回失败: ${(j && j.msg) || ''}`);
  return j.data || {};
}

function mapNeJob(item) {
  return {
    id: String(item.id || ''),
    title: item.positionName || '',
    team: item.departmentName || '',
    location: item.workPlaceName || '',
    type: '',
    category: item.positionTypeName || '',
    program: '2027届',
    date: '',
    detailUrl: `https://campus.163.com/app/detail/index?id=${item.id}&projectId=${PROJECT_ID}`,
    jd: item.positionDescription || '',
  };
}

async function scrapeNe({ maxJobs = 100, fallbackName = '网易' } = {}) {
  const cap = Math.min(Math.max(Number(maxJobs) || 100, 10), 300);
  const pageSize = 50;
  const seen = new Set();
  const jobs = [];
  let total = 0;

  for (let currentPage = 1; jobs.length < cap; currentPage++) {
    const data = await fetchNePage({ currentPage, pageSize });
    if (currentPage === 1) total = Number(data.total ?? data.totalCount ?? data.count) || 0;
    const items = data.list || [];
    if (!items.length) break;
    for (const it of items) {
      const id = String(it.id);
      if (seen.has(id)) continue;
      seen.add(id);
      jobs.push(mapNeJob(it));
    }
    if (items.length < pageSize || jobs.length >= total) break;
  }

  return {
    company: fallbackName,
    url: `https://campus.163.com/app/job/position?id=${PROJECT_ID}`,
    section: 'campus',
    totalOnSite: total,
    count: jobs.length,
    jobs,
  };
}

function neToApplication(job, { company, url }) {
  const notes = [
    job.category ? `类别 ${job.category}` : '',
    job.location ? `地点 ${job.location}` : '',
  ].filter(Boolean).join(' | ');
  return {
    company,
    title: job.title,
    channel: '官网',
    url: job.detailUrl || url,
    status: 'pending',
    source: 'campus.163.com',
    degree: '',
    industry: '',
    jd: job.jd || '',
    notes,
  };
}

module.exports = { scrapeNe, neToApplication, mapNeJob };
