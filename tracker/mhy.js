'use strict';

/**
 * 求职星计划 — 米哈游 jobs.mihoyo.com 适配器（适配器 #14，纯 HTTP）
 *
 * 岗位 API 可直接调用：
 *   POST https://ats.openout.mihoyo.com/ats-portal/v1/job/list
 *   body: { channelDetailIds: [1], hireType: 1, pageNo, pageSize }
 */

const API = 'https://ats.openout.mihoyo.com/ats-portal/v1/job/list';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

async function fetchMhyPage({ pageNo, pageSize, keyword }) {
  const body = JSON.stringify({ channelDetailIds: [1], hireType: 1, pageNo, pageSize, jobName: keyword || '' });
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body,
  });
  if (!res.ok) throw new Error(`米哈游 API HTTP ${res.status}`);
  const j = await res.json();
  if (!j || j.code !== 0) throw new Error(`米哈游 API 返回失败: ${(j && j.message) || ''}`);
  return j.data || {};
}

function mapMhyJob(item) {
  const cities = Array.isArray(item.addressDetailList) ? item.addressDetailList.map((a) => a.addressDetail).filter(Boolean) : [];
  return {
    id: String(item.id || ''),
    title: item.title || '',
    team: '',
    location: cities.join('、'),
    type: item.jobNature || '',
    category: item.competencyType || '',
    program: item.projectName || '',
    date: '',
    detailUrl: `https://jobs.mihoyo.com/#/campus/position/${item.id}`,
    jd: item.jobSummary || '',
  };
}

async function scrapeMhy({ keyword = '', maxJobs = 100, fallbackName = '米哈游' } = {}) {
  const cap = Math.min(Math.max(Number(maxJobs) || 100, 10), 300);
  const pageSize = 20;
  const seen = new Set();
  const jobs = [];
  let total = 0;

  for (let pageNo = 1; jobs.length < cap; pageNo++) {
    const data = await fetchMhyPage({ pageNo, pageSize, keyword });
    if (pageNo === 1) total = Number(data.total ?? data.totalCount ?? data.count) || 0;
    const items = data.list || [];
    if (!items.length) break;
    for (const it of items) {
      const id = String(it.id);
      if (seen.has(id)) continue;
      seen.add(id);
      jobs.push(mapMhyJob(it));
    }
    if (items.length < pageSize || jobs.length >= total) break;
  }

  return {
    company: fallbackName,
    url: 'https://jobs.mihoyo.com/#/campus',
    section: 'campus',
    keyword,
    totalOnSite: total,
    count: jobs.length,
    jobs,
  };
}

function mhyToApplication(job, { company, url }) {
  const notes = [
    job.program || '',
    job.category ? `类别 ${job.category}` : '',
    job.location ? `地点 ${job.location}` : '',
  ].filter(Boolean).join(' | ');
  return {
    company,
    title: job.title,
    channel: '官网',
    url: job.detailUrl || url,
    status: 'pending',
    source: 'mihoyo.com',
    degree: '',
    industry: '',
    jd: job.jd || '',
    notes,
  };
}

module.exports = { scrapeMhy, mhyToApplication, mapMhyJob };
