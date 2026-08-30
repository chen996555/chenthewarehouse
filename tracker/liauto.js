'use strict';

/**
 * 求职星计划 — 理想汽车 适配器（自研，GET 接口）
 * 参考 job-pro liauto.ts。
 * GET https://api-web.lixiang.com/osd-hr-recruitment-website/v1/recruit/school/job-page
 *   参数：page=<int>, page_size=<int>, 可选 search=<string>（title server-side 过滤）
 *   响应：{ code:0, data:{ items:[...], total_count:<int> } }
 * 详情：https://www.lixiang.com/job/detail/<id>.html
 */

const API = 'https://api-web.lixiang.com/osd-hr-recruitment-website/v1/recruit';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function fetchLiPage({ page, pageSize, keyword, section }) {
  const qs = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  if (keyword) qs.set('search', keyword);
  const path = section === 'social' ? '/social/job-page' : '/school/job-page';
  const res = await fetch(`${API}${path}?${qs.toString()}`, {
    method: 'GET',
    headers: { 'User-Agent': UA, Referer: 'https://www.lixiang.com/employ/campus.html' },
  });
  if (!res.ok) throw new Error(`理想 HTTP ${res.status}`);
  const j = await res.json().catch(() => null);
  if (!j || j.code !== 0) throw new Error(`理想 code ${j && j.code}: ${j && j.message}`);
  return j.data || { items: [], total_count: 0 };
}

function mapLiJob(item) {
  const id = String(item.id || item.job_id || '');
  return {
    id,
    title: String(item.title || '').trim(),
    team: item.department_title || '',
    location: item.location_title || '',
    type: item.job_mode_name || '',
    section: String(item.job_mode) === '202' ? 'intern' : 'campus',
    program: '',
    date: '',
    detailUrl: id ? `https://www.lixiang.com/job/detail/${id}.html` : '',
    jd: '',
  };
}

async function scrapeLiauto({ keyword = '', maxJobs = 100, fallbackName = '理想汽车', section = 'campus' } = {}) {
  const cap = Math.min(Math.max(Number(maxJobs) || 100, 10), 300);
  const pageSize = 100;
  const seen = new Set();
  const jobs = [];
  let total = 0;

  for (let page = 1; jobs.length < cap; page++) {
    const data = await fetchLiPage({ page, pageSize, keyword, section });
    if (page === 1) total = Number(data.total_count || 0);
    const items = data.items || [];
    if (!items.length) break;
    for (const it of items) {
      const id = String(it.id || it.job_id || '');
      if (id && !seen.has(id)) { seen.add(id); jobs.push(mapLiJob(it)); }
    }
    if (items.length < pageSize) break;
    if (total && page * pageSize >= total) break;
  }

  return { company: fallbackName, url: 'https://www.lixiang.com/employ/campus.html', section: 'campus', keyword, totalOnSite: total, count: jobs.length, jobs };
}

module.exports = { scrapeLiauto, mapLiJob };
