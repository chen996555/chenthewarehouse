'use strict';

/**
 * 求职星计划 — 阿里巴巴 campus-talent.alibaba.com 适配器（适配器 #7，纯 HTTP）
 *
 * 岗位 API 需要会话 cookie + CSRF token（从首页 cookie 获取）：
 *   POST https://campus-talent.alibaba.com/position/search?_csrf={token}
 *   body: { batchId, pageIndex, pageSize, customDeptCode, channel, language }
 * 响应: { success, content: { datas: [...] } }
 */

const BASE = 'https://campus-talent.alibaba.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function fmtDate(epochMs) {
  if (!epochMs) return '';
  const d = new Date(Number(epochMs));
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 建立会话：GET 首页拿 cookie（含 csrf token）
async function initSession() {
  const res = await fetch(`${BASE}/campus/position`, { headers: { 'User-Agent': UA } });
  const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  let csrf = '';
  const cookies = [];
  for (const c of setCookies) {
    const kv = c.split(';')[0];
    if (!kv) continue;
    cookies.push(kv);
    const m = kv.match(/^([^=]+)=(.*)$/);
    if (m && /csrf|token/i.test(m[1])) csrf = m[2];
  }
  if (!csrf) throw new Error('未获取到阿里 CSRF token');
  return { csrf, cookie: cookies.join('; ') };
}

async function fetchAliPage({ csrf, cookie, pageIndex, pageSize, keyword }) {
  const body = JSON.stringify({
    batchId: 100000760001,
    pageIndex,
    pageSize,
    customDeptCode: '',
    channel: 'campus_group_official_site',
    language: 'zh',
    key: keyword || '',
  });
  const res = await fetch(`${BASE}/position/search?_csrf=${encodeURIComponent(csrf)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA, Cookie: cookie },
    body,
  });
  if (!res.ok) throw new Error(`阿里 API HTTP ${res.status}`);
  const j = await res.json();
  if (!j || !j.success) throw new Error(`阿里 API 返回失败: ${(j && j.errorMsg) || ''}`);
  return j.content || {};
}

function mapAliJob(item) {
  const locations = Array.isArray(item.workLocations) ? item.workLocations : [];
  return {
    id: String(item.id || ''),
    title: item.name || '',
    team: '',
    location: locations.join('、'),
    type: '',
    category: '',
    program: '',
    date: fmtDate(item.modifyTime || item.publishTime),
    detailUrl: item.positionUrl || `${BASE}/campus/position/${item.id}?deptCodes=`,
    jd: item.requirement || '',
  };
}

async function scrapeAli({ keyword = '', maxJobs = 100, fallbackName = '阿里巴巴' } = {}) {
  const cap = Math.min(Math.max(Number(maxJobs) || 100, 10), 300);
  const { csrf, cookie } = await initSession();
  const pageSize = 20;
  const seen = new Set();
  const jobs = [];
  let total = 0;

  for (let pageIndex = 1; jobs.length < cap; pageIndex++) {
    const content = await fetchAliPage({ csrf, cookie, pageIndex, pageSize, keyword });
    if (pageIndex === 1) {
      // 总数字段名可能为 total/totalCount/count，逐层探测
      total = Number(content.total ?? content.totalCount ?? content.count ?? 0);
    }
    const items = content.datas || [];
    if (!items.length) break;
    for (const it of items) {
      const id = String(it.id);
      if (seen.has(id)) continue;
      seen.add(id);
      jobs.push(mapAliJob(it));
    }
    if (items.length < pageSize) break;
  }

  return {
    company: fallbackName,
    url: `${BASE}/campus/position`,
    section: 'campus',
    keyword,
    totalOnSite: total,
    count: jobs.length,
    jobs,
  };
}

function aliToApplication(job, { company, url }) {
  const notes = [job.location ? `地点 ${job.location}` : '', job.date ? `更新 ${job.date}` : '']
    .filter(Boolean)
    .join(' | ');
  return {
    company,
    title: job.title,
    channel: '官网',
    url: job.detailUrl || url,
    status: 'pending',
    source: 'alibaba.com',
    degree: '',
    industry: '',
    jd: job.jd || '',
    notes,
  };
}

module.exports = { scrapeAli, aliToApplication, mapAliJob };
