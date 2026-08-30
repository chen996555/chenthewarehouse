'use strict';

/**
 * 求职星计划 — 哔哩哔哩 适配器（纯 HTTP）
 * 参考 job-pro bilibili.ts（原误判为浏览器型，实为纯 HTTP 两步 CSRF）。
 * 步骤1：GET /api/auth/v1/csrf/token（X-AppKey: ops.ehr-api.auth, X-UserType: 2）→ { code:0, data:"<token>" }
 * 步骤2：POST /api/campus/position/positionList（X-AppKey, X-UserType:2, X-CSRF:token, Cookie: X-CSRF=token）
 *   body：{ pageNum, pageSize, positionName? }
 * 响应：{ code:0, data:{ list, pages, size, total } }
 * 字段：id/positionName/positionTypeName/postCodeName/workLocation/pushTime/positionDescription
 */

const API_ROOT = 'https://jobs.bilibili.com';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const DEFAULT_HEADERS = {
  'User-Agent': UA,
  Accept: 'application/json, text/plain, */*',
  'Content-Type': 'application/json',
  'X-AppKey': 'ops.ehr-api.auth',
  'X-UserType': '2',
  Referer: 'https://jobs.bilibili.com/',
};

let _csrf = null;

async function fetchCsrfToken() {
  if (_csrf) return _csrf;
  const res = await fetch(`${API_ROOT}/api/auth/v1/csrf/token`, { headers: DEFAULT_HEADERS });
  const j = await res.json().catch(() => null);
  if (j && j.code === 0 && j.data) { _csrf = j.data; return _csrf; }
  throw new Error(`获取 bili CSRF token 失败：${JSON.stringify(j).slice(0, 120)}`);
}

async function fetchBiliPage({ pageNum, pageSize, keyword }) {
  const token = await fetchCsrfToken();
  const body = { pageNum, pageSize };
  if (keyword) body.positionName = keyword;
  const res = await fetch(`${API_ROOT}/api/campus/position/positionList`, {
    method: 'POST',
    headers: { ...DEFAULT_HEADERS, 'X-CSRF': token, Cookie: `X-CSRF=${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`bili HTTP ${res.status}`);
  const j = await res.json().catch(() => null);
  if (!j || j.code !== 0) return { list: [], total: 0 };
  const d = j.data || {};
  return { list: d.list || [], total: Number(d.total || 0) };
}

function mapBiliJob(it) {
  const id = String(it.id || '');
  return {
    id,
    title: it.positionName || '',
    team: it.postCodeName || '',
    location: it.workLocation || '',
    type: it.positionTypeName || '',
    section: /实习/.test(it.positionTypeName || '') ? 'intern' : 'campus',
    category: '',
    program: it.campusProjectId ? `${it.campusProjectId}届` : '',
    date: it.pushTime ? String(it.pushTime).slice(0, 10) : '',
    detailUrl: `${API_ROOT}/campus/positions/${id}`,
    jd: it.positionDescription || '',
  };
}

async function scrapeBili({ keyword = '', maxJobs = 300, fallbackName = '哔哩哔哩' } = {}) {
  const cap = Math.min(Math.max(Number(maxJobs) || 300, 10), 500);
  const pageSize = 50;
  const seen = new Set();
  const jobs = [];
  let total = 0;

  for (let pageNum = 1; jobs.length < cap; pageNum++) {
    const { list, total: t } = await fetchBiliPage({ pageNum, pageSize, keyword });
    if (pageNum === 1) total = t;
    if (!list.length) break;
    for (const it of list) {
      const id = String(it.id || '');
      if (id && !seen.has(id)) { seen.add(id); jobs.push(mapBiliJob(it)); }
    }
    if (list.length < pageSize) break;
    if (total && pageNum * pageSize >= total) break;
  }

  return { company: fallbackName, url: `${API_ROOT}/campus/positions`, section: 'campus', keyword, totalOnSite: total, count: jobs.length, jobs };
}

module.exports = { scrapeBili, mapBiliJob };
