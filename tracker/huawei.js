'use strict';

/**
 * 求职星计划 — 华为 适配器（自研，GET 接口）
 * 参考 job-pro huawei.ts。
 * 先 GET /reccampportal/ 拿 JSESSIONID（set-cookie），再 GET
 *   /reccampportal/services/portal/portalpub/getJob/newHr/page/{pageSize}/{page}
 *   ?jobType=0&jobTypes=2&searchText=关键词&language=zh_CN
 * 响应：{ pageVO:{ totalRows,... }, result:[...] }
 * 字段：jobId（post_id）、jobname（title）、jobFamilyName（职族）、jobArea/jobAddress（城市）、dataSource
 * jobType/jobTypes：应届生=0/2、实习生=0/0、博士生=2/null
 */

const PORTAL = 'https://career.huawei.com/reccampportal';
const API = `${PORTAL}/services/portal/portalpub`;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Accept: 'application/json, text/plain, */*', Referer: `${PORTAL}/portal5/campus-recruitment.html` };

let _session = null;

async function getSession() {
  if (_session) return _session;
  const resp = await fetch(`${PORTAL}/`, { method: 'GET', headers: HEADERS, redirect: 'follow' });
  const setCookie = resp.headers.get('set-cookie') || '';
  const m = setCookie.match(/JSESSIONID=([^;]+)/);
  if (m) { _session = m[1]; return _session; }
  return '';
}

async function fetchHuaweiPage({ page, pageSize, keyword, jobType, jobTypes }) {
  const session = await getSession();
  const qs = new URLSearchParams({
    jobType,
    language: 'zh_CN',
    reqTime: String(Date.now()),
    orderBy: 'ISS_STARTDATE_DESC_AND_IS_HOT_JOB',
    pageSize: String(pageSize),
    curPage: String(page),
  });
  if (jobTypes !== undefined && jobTypes !== null) qs.set('jobTypes', jobTypes);
  if (keyword) qs.set('searchText', keyword);
  const res = await fetch(`${API}/getJob/newHr/page/${pageSize}/${page}?${qs.toString()}`, {
    method: 'GET',
    headers: { ...HEADERS, ...(session ? { Cookie: `JSESSIONID=${session}` } : {}) },
  });
  if (!res.ok) throw new Error(`华为 HTTP ${res.status}`);
  return res.json().catch(() => null);
}

function mapHuaweiJob(item, jobTypes) {
  const id = String(item.jobId ?? '');
  return {
    id,
    title: String(item.jobname || item.jobName || '').trim(),
    team: item.jobFamilyName || '',
    location: item.jobArea || item.jobAddress || '',
    type: jobTypes === '0' ? '实习生' : jobTypes === '2' ? '应届生' : '',
    section: jobTypes === '0' ? 'intern' : 'campus',
    program: '',
    date: '',
    detailUrl: id ? `${PORTAL}/portal5/campus-recruitment-detail.html?jobId=${id}&dataSource=${item.dataSource || ''}` : '',
    jd: '',
  };
}

async function scrapeHuawei({ keyword = '', maxJobs = 100, fallbackName = '华为' } = {}) {
  const jobType = '3'; // all campus types（应届生秋招季结束后岗位少，用 all 兜底）
  const jobTypes = undefined;
  const cap = Math.min(Math.max(Number(maxJobs) || 100, 10), 300);
  const pageSize = 50;
  const seen = new Set();
  const jobs = [];
  let total = 0;

  for (let page = 1; jobs.length < cap; page++) {
    const j = await fetchHuaweiPage({ page, pageSize, keyword, jobType, jobTypes });
    const pv = (j && j.pageVO) || {};
    if (page === 1) total = Number(pv.totalRows || 0);
    const result = (j && j.result) || [];
    if (!result.length) break;
    for (const it of result) {
      const id = String(it.jobId ?? '');
      if (id && !seen.has(id)) { seen.add(id); jobs.push(mapHuaweiJob(it, jobTypes)); }
    }
    const totalPages = Number(pv.totalPages || 0);
    if (totalPages && page >= totalPages) break;
    if (result.length < pageSize) break;
  }

  return { company: fallbackName, url: `${PORTAL}/portal5/campus-recruitment.html`, section: 'campus', keyword, totalOnSite: total, count: jobs.length, jobs };
}

module.exports = { scrapeHuawei, mapHuaweiJob };
