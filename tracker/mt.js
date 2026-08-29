'use strict';

/**
 * 求职星计划 — 美团 zhaopin.meituan.com 适配器（适配器 #6，纯 HTTP）
 *
 * 岗位 API 可直接调用：
 *   POST https://zhaopin.meituan.com/api/official/job/getJobList
 *   body: { page: { pageNo, pageSize }, jobShareType: "1", keywords, cityList: [], ... }
 * 响应: { data: { list: [...], page: { totalPage, ... } } }
 */

const BASE = 'https://zhaopin.meituan.com';

async function fetchMtPage({ pageNo, pageSize, keyword }) {
  const body = JSON.stringify({
    page: { pageNo, pageSize },
    jobShareType: '1',
    keywords: keyword || '',
    cityList: [],
    department: [],
    jfJgList: [],
    jobType: [{ code: '1', subCode: [] }, { code: '2', subCode: [] }],
    typeCode: [],
    specialCode: [],
  });
  const res = await fetch(`${BASE}/api/official/job/getJobList`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      'Referer': `${BASE}/web/campus`,
    },
    body,
  });
  if (!res.ok) throw new Error(`美团 API HTTP ${res.status}`);
  const j = await res.json();
  if (!j || j.status !== 1) throw new Error('美团 API 返回失败');
  return j.data || {};
}

function fmtDate(epochMs) {
  if (!epochMs) return '';
  const d = new Date(Number(epochMs));
  if (Number.isNaN(d.getTime())) return String(epochMs).slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function mapMtJob(item) {
  const deptArr = Array.isArray(item.department) ? item.department : [];
  const cityArr = Array.isArray(item.cityList) ? item.cityList : [];
  const TYPE_MAP = { '1': '应届', '2': '转正实习', '3': '日常实习' };
  return {
    id: String(item.jobUnionId || ''),
    title: item.name || '',
    team: deptArr.map((d) => d.name).filter(Boolean).join('/'),
    location: cityArr.map((c) => c.name).filter(Boolean).join('、'),
    type: TYPE_MAP[String(item.jobType)] || item.jobType || '',
    category: [item.jobFamilyGroup, item.jobFamily].filter(Boolean).join('·'),
    program: item.projectName || '',
    date: fmtDate(item.refreshTime || item.firstPostTime),
    detailUrl: `${BASE}/web/campus`,
    jd: [item.jobDuty, item.jobRequirement].filter(Boolean).join('\n'),
  };
}

async function scrapeMt({ keyword = '', maxJobs = 100, fallbackName = '美团' } = {}) {
  const cap = Math.min(Math.max(Number(maxJobs) || 100, 10), 300);
  const pageSize = 50;
  const seen = new Set();
  const jobs = [];
  let total = 0;

  for (let pageNo = 1; jobs.length < cap; pageNo++) {
    const data = await fetchMtPage({ pageNo, pageSize, keyword });
    const pageInfo = data.page || {};
    if (pageNo === 1) total = Number(pageInfo.totalCount || pageInfo.total || 0);
    const items = data.list || [];
    if (!items.length) break;
    for (const it of items) {
      const id = String(it.jobUnionId);
      if (seen.has(id)) continue;
      seen.add(id);
      jobs.push(mapMtJob(it));
    }
    const totalPage = Number(pageInfo.totalPage || 0);
    if (pageNo >= totalPage || items.length < pageSize) break;
  }

  return {
    company: fallbackName,
    url: `${BASE}/web/campus`,
    section: 'campus',
    keyword,
    totalOnSite: total,
    count: jobs.length,
    jobs,
  };
}

function mtToApplication(job, { company, url }) {
  const notes = [
    job.category ? `方向 ${job.category}` : '',
    job.program ? `项目 ${job.program}` : '',
    job.location ? `地点 ${job.location}` : '',
    job.date ? `更新 ${job.date}` : '',
  ].filter(Boolean).join(' | ');
  return {
    company,
    title: job.title,
    channel: '官网',
    url: job.detailUrl || url,
    status: 'pending',
    source: 'meituan.com',
    degree: '',
    industry: '',
    jd: job.jd || '',
    notes,
  };
}

module.exports = { scrapeMt, mtToApplication, mapMtJob };
