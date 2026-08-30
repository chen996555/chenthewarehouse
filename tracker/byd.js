'use strict';

/**
 * 求职星计划 — 比亚迪 适配器（自研，POST JSON）
 * 参考 job-pro byd.ts。
 * POST https://job.byd.com/portal/api/portal-api/position/queryList
 *   body：{ pageNum（行偏移，不是页码！page N → pageNum=(N-1)*size）, pageSize, vagueCondition（keyword）, searchType:1, zpType:"00251" }
 *   响应：{ code:0, data:{ data:[...], total:<int> } }  ← 注意双层 data
 * 详情：https://job.byd.com/portal/pc/#/social/detail?positionCode=<id>
 */

const BASE = 'https://job.byd.com';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function fetchBydPage({ offset, pageSize, keyword }) {
  const body = {
    pageNum: offset, // 行偏移，不是页码
    pageSize,
    vagueCondition: keyword || '',
    searchType: 1,
    zpType: '00251',
    positionCityArr: [],
  };
  const res = await fetch(`${BASE}/portal/api/portal-api/position/queryList`, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Content-Type': 'application/json;charset=UTF-8',
      Origin: BASE,
      Referer: `${BASE}/portal/pc/`,
      lang: 'zh_CN',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`比亚迪 HTTP ${res.status}`);
  const j = await res.json().catch(() => null);
  if (!j || j.code !== 0) throw new Error(`比亚迪 code ${j && j.code}: ${j && j.msg}`);
  return j.data || { data: [], total: 0 };
}

function mapBydJob(item) {
  const id = String(item.id || item.positionCode || '');
  const city = [item.province, item.city].filter(Boolean).join('·');
  return {
    id,
    title: String(item.positionName || '').trim(),
    team: item.department || item.deptName || '',
    location: city,
    type: item.zpTypeName || item.jobType || '',
    program: '',
    date: '',
    detailUrl: id ? `${BASE}/portal/pc/#/social/detail?positionCode=${id}` : '',
    jd: [item.jobDuty, item.jobRequirement, item.jobDescription].filter(Boolean).join('\n'),
  };
}

async function scrapeByd({ keyword = '', maxJobs = 100, fallbackName = '比亚迪' } = {}) {
  const cap = Math.min(Math.max(Number(maxJobs) || 100, 10), 300);
  const pageSize = 20;
  const seen = new Set();
  const jobs = [];
  let total = 0;

  for (let n = 0; jobs.length < cap; n++) {
    const offset = n * pageSize; // 行偏移
    const data = await fetchBydPage({ offset, pageSize, keyword });
    if (n === 0) total = Number(data.total || 0);
    const list = data.data || [];
    if (!list.length) break;
    for (const it of list) {
      const id = String(it.id || it.positionCode || '');
      if (id && !seen.has(id)) { seen.add(id); jobs.push(mapBydJob(it)); }
    }
    if (list.length < pageSize) break;
    if (total && offset + pageSize >= total) break;
  }

  return { company: fallbackName, url: `${BASE}/portal/pc/`, section: 'social', keyword, totalOnSite: total, count: jobs.length, jobs };
}

module.exports = { scrapeByd, mapBydJob };
