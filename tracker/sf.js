'use strict';

/**
 * 求职星计划 — 顺丰科技 campus.sf-express.com 适配器（自研，GET 接口）
 * 参考 job-pro sf.ts + ATS 逆向速查表。
 *
 * 接口：GET /api/web/position/query?pageNum=&pageSize=&positionName=<keyword>
 * 必须 header：cr-service（URL 编码的站点地址，否则 401/无数据）
 * 响应：{ list: [...], total: N }（PageHelper 分页形状）
 * 字段：id/positionName/demandCity/educationName/seasonType(2=应届)/postDuty/jobRequirement/createDate/orgSource
 */

const BASE = 'https://campus.sf-express.com';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const CR_SERVICE = encodeURIComponent(BASE + '/');

async function fetchSfPage({ pageNum, pageSize, keyword }) {
  const qs = new URLSearchParams({ pageNum: String(pageNum), pageSize: String(pageSize) });
  if (keyword) qs.set('positionName', keyword);
  const res = await fetch(`${BASE}/api/web/position/query?${qs.toString()}`, {
    method: 'GET',
    headers: {
      'User-Agent': UA,
      'cr-service': CR_SERVICE,
      Referer: `${BASE}/positionList`,
      Origin: BASE,
    },
  });
  if (!res.ok) throw new Error(`顺丰 HTTP ${res.status}`);
  return res.json().catch(() => ({ list: [], total: 0 }));
}

function mapSfJob(item) {
  const season = Number(item.seasonType);
  return {
    id: String(item.id || ''),
    title: String(item.positionName || '').trim(),
    team: item.orgSource || '',
    location: item.demandCity || '',
    type: season === 2 ? '应届' : season === 1 ? '实习' : '',
    section: season === 2 ? 'campus' : season === 1 ? 'intern' : '',
    program: '',
    date: item.createDate ? String(item.createDate).slice(0, 10) : '',
    detailUrl: `${BASE}/#/postDetail/${item.id}`,
    jd: [item.postDuty, item.jobRequirement].filter(Boolean).join('\n'),
  };
}

async function scrapeSf({ keyword = '', maxJobs = 100, fallbackName = '顺丰' } = {}) {
  const cap = Math.min(Math.max(Number(maxJobs) || 100, 10), 300);
  const pageSize = 50;
  const seen = new Set();
  const jobs = [];
  let total = 0;

  for (let pageNum = 1; jobs.length < cap; pageNum++) {
    const data = await fetchSfPage({ pageNum, pageSize, keyword });
    if (pageNum === 1) total = Number(data.total || 0);
    const list = data.list || [];
    if (!list.length) break;
    for (const it of list) {
      const id = String(it.id || '');
      if (id && !seen.has(id)) { seen.add(id); jobs.push(mapSfJob(it)); }
    }
    if (list.length < pageSize) break;
    if (total && pageNum * pageSize >= total) break;
  }

  return { company: fallbackName, url: BASE, section: 'campus', keyword, totalOnSite: total, count: jobs.length, jobs };
}

module.exports = { scrapeSf, mapSfJob };
