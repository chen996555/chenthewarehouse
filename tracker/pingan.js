'use strict';

/**
 * 求职星计划 — 中国平安 适配器（自研，POST JSON）
 * 参考 job-pro pingan.ts。
 * 两步：① POST /candidate/officialWebsite/selectGroupOfficial 拿 wecruitId（session-like token，稳定可缓存）
 *       ② POST /candidate/position/campus/positionSearch/queryPositionPage 拿岗位列表
 * 响应：{ responseCode:"10001", data:{ list, totalCount, totalPage } }（responseCode==="10001" 成功）
 * 坑：分页参数是 pageNum（不是 pageNo）；id 字段是 idPosition
 * 详情：https://campus.pingan.com/positionDetail?positionId=<id>
 */

const BASE = 'https://campus.pingan.com';
const API_ROOT = `${BASE}/zztj-recruit-talent-webserver/rctt`;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

let _wecruitId = null;

async function call(path, body) {
  const res = await fetch(`${API_ROOT}${path}`, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/json',
      Origin: BASE,
      Referer: `${BASE}/`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`平安 HTTP ${res.status}`);
  return res.json().catch(() => null);
}

async function getWecruitId() {
  if (_wecruitId) return _wecruitId;
  const j = await call('/candidate/officialWebsite/selectGroupOfficial', {
    websiteType: '3',
    officialUrl: 'campus.pingan.com',
    recruitType: '3', // 校招
  });
  if (j && j.responseCode === '10001' && typeof j.data === 'string' && j.data.length) {
    _wecruitId = j.data;
    return _wecruitId;
  }
  throw new Error(`获取平安 wecruitId 失败：${JSON.stringify(j).slice(0, 120)}`);
}

function mapPinganJob(item) {
  const id = String(item.idPosition || '');
  return {
    id,
    title: String(item.positionName || '').trim(),
    team: item.deptName || item.businessUnitName || '',
    location: String(item.workCity || '').trim(),
    type: item.positionType || '',
    section: /实习/.test(item.positionType || '') ? 'intern' : 'campus',
    program: item.positionCategoryName || '',
    date: '',
    detailUrl: id ? `${BASE}/positionDetail?positionId=${id}` : '',
    jd: '',
  };
}

async function scrapePingan({ keyword = '', maxJobs = 100, fallbackName = '中国平安' } = {}) {
  const wecruitId = await getWecruitId();
  const cap = Math.min(Math.max(Number(maxJobs) || 100, 10), 300);
  const pageSize = 20;
  const seen = new Set();
  const jobs = [];
  let total = 0;

  for (let pageNum = 1; jobs.length < cap; pageNum++) {
    const body = { wecruitId, pageNum, pageSize };
    if (keyword) body.keyWord = keyword;
    const j = await call('/candidate/position/campus/positionSearch/queryPositionPage', body);
    if (!j || j.responseCode !== '10001' || !j.data) break;
    if (pageNum === 1) total = Number(j.data.totalCount || 0);
    const list = j.data.list || [];
    if (!list.length) break;
    for (const it of list) {
      const id = String(it.idPosition || '');
      if (id && !seen.has(id)) { seen.add(id); jobs.push(mapPinganJob(it)); }
    }
    if (list.length < pageSize) break;
    if (total && pageNum * pageSize >= total) break;
  }

  return { company: fallbackName, url: BASE, section: 'campus', keyword, totalOnSite: total, count: jobs.length, jobs };
}

module.exports = { scrapePingan, mapPinganJob };
