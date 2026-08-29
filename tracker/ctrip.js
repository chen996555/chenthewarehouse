'use strict';

/**
 * 求职星计划 — 携程 job.ctrip.com 适配器（适配器 #16，纯 HTTP）
 *
 * 岗位接口：POST https://job.ctrip.com/api/hrrecruit/getJobAd
 *   body: { condition: { keyword, category:2(校招), ... }, pager: { index, size } }
 * 响应: { retCode:"201", retValue: { total, recruitJobAdList:[...] } }
 * 每条含完整 JD（duty + requirements），支持关键词 + 分页真全量。
 */

const BASE = 'https://job.ctrip.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// 校招 category=2；社招/实习未确认，先固定校招
const CATEGORY = 2;

function mapCtripJob(it) {
  const rawTitle = String(it.jobTitle || '');
  // 详情 URL 用 MJ 编号（如 MJ036717），而非 jobId uuid——提取 MJ 编号作为唯一 ID
  const mj = rawTitle.match(/\((MJ\d+)\)\s*$/);
  const mjId = mj ? mj[1] : String(it.jobId || it.id || '');
  return {
    id: mjId,
    title: rawTitle.replace(/\s*\(MJ\d+\)\s*$/, '').trim(),
    team: it.buName || '',
    location: it.cityName || '',
    type: it.kindName || '',
    category: it.jobFamilyGroupName || '',
    program: '',
    date: String(it.publishDate || '').slice(0, 10),
    detailUrl: `${BASE}/campus-recruitment/trip/37757#/campus/job-detail/${mjId}`,
    jd: [it.duty, it.requirements].filter(Boolean).map((s) => String(s).replace(/<[^>]+>/g, ' ')).join('\n'),
  };
}

async function scrapeCtrip({ keyword = '', maxJobs = 300, fallbackName = '携程' } = {}) {
  const pageSize = 20;
  const cap = Math.min(Math.max(Number(maxJobs) || 300, 10), 1000);
  const jobs = [];
  let total = 0;

  for (let index = 1; jobs.length < cap; index++) {
    const body = JSON.stringify({
      condition: {
        fromId: [], keyword: keyword || '', kind: [], country: [], city: [],
        bucode: [], jobFamilyCode: [], jobFamilyGroupCode: [], category: CATEGORY,
      },
      pager: { index: String(index), size: String(pageSize) },
      head: { language: 'zh_CN', version: '1' },
    });
    const res = await fetch(`${BASE}/api/hrrecruit/getJobAd`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      body,
    });
    if (!res.ok) break;
    const j = await res.json();
    if (!j || j.retCode !== '201') break;
    const rv = j.retValue || {};
    if (index === 1) total = Number(rv.total ?? rv.totalCount ?? rv.count) || 0;
    const list = rv.recruitJobAdList || [];
    if (!list.length) break;
    for (const it of list) jobs.push(mapCtripJob(it));
    if (list.length < pageSize || jobs.length >= (total || cap)) break;
  }

  return {
    company: fallbackName,
    url: `${BASE}/campus-recruitment/trip/37757#/campus/jobList`,
    section: 'campus',
    keyword,
    totalOnSite: total,
    count: jobs.length,
    jobs,
  };
}

function ctripToApplication(job, { company, url }) {
  const notes = [
    job.program || '',
    job.type || '',
    job.location ? `地点 ${job.location}` : '',
    job.date ? `发布 ${job.date}` : '',
  ].filter(Boolean).join(' | ');
  return {
    company,
    title: job.title,
    channel: '官网',
    url: job.detailUrl || url,
    status: 'pending',
    source: 'ctrip.com',
    degree: '',
    industry: '',
    jd: job.jd || '',
    notes,
  };
}

module.exports = { scrapeCtrip, ctripToApplication };
