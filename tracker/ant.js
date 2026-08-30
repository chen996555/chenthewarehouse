'use strict';

/**
 * 求职星计划 — 蚂蚁集团 适配器（纯 HTTP）
 * 参考 job-pro antgroup.ts（原误判为浏览器型需 ctoken，实为纯 HTTP 匿名）。
 * POST https://hrcareersweb.antgroup.com/api/campus/position/search
 *   body：{ key, pageIndex, pageSize, language:"zh" }
 * 响应：{ success:true, errorMsg:"成功", content:[...], totalCount }
 * 字段：id/name(title)/department/description/requirement/workLocations/positionType
 * 坑：pageSize 上限 49（50 返回 success:false 系统繁忙）
 */

const API_ROOT = 'https://hrcareersweb.antgroup.com/api';
const CAMPUS_PAGE = 'https://talent.antgroup.com/campus-list';
const MAX_PAGE_SIZE = 49;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';

async function fetchAntPage({ keyword, pageIndex, pageSize }) {
  const body = { key: keyword || '', pageIndex, pageSize, language: 'zh' };
  const res = await fetch(`${API_ROOT}/campus/position/search`, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Content-Type': 'application/json;charset=UTF-8',
      Origin: 'https://talent.antgroup.com',
      Referer: CAMPUS_PAGE,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`蚂蚁 HTTP ${res.status}`);
  const j = await res.json().catch(() => null);
  if (!j || j.success !== true) return { content: [], totalCount: 0 };
  return { content: j.content || [], totalCount: Number(j.totalCount || 0) };
}

function mapAntJob(item) {
  const id = String(item.id || item.code || '');
  const locs = Array.isArray(item.workLocations) ? item.workLocations.filter(Boolean).join(' / ') : '';
  return {
    id,
    title: String(item.name || '').trim(),
    team: String(item.department || '').trim(),
    location: locs,
    type: String(item.positionType || '').trim(),
    section: /实习/.test(item.positionType || '') ? 'intern' : 'campus',
    program: item.project || item.categoryName || '',
    date: '',
    detailUrl: id ? `https://talent.antgroup.com/campus-position?positionId=${id}` : CAMPUS_PAGE,
    jd: [item.description, item.requirement].filter(Boolean).join('\n'),
  };
}

async function scrapeAnt({ keyword = '', maxJobs = 100, fallbackName = '蚂蚁集团' } = {}) {
  const cap = Math.min(Math.max(Number(maxJobs) || 100, 10), 500);
  const pageSize = MAX_PAGE_SIZE;
  const seen = new Set();
  const jobs = [];
  let total = 0;

  for (let pageIndex = 1; jobs.length < cap; pageIndex++) {
    const { content, totalCount } = await fetchAntPage({ keyword, pageIndex, pageSize });
    if (pageIndex === 1) total = totalCount;
    const list = content || [];
    if (!list.length) break;
    for (const it of list) {
      const id = String(it.id || it.code || '');
      if (id && !seen.has(id)) { seen.add(id); jobs.push(mapAntJob(it)); }
    }
    if (list.length < pageSize) break;
    if (total && pageIndex * pageSize >= total) break;
  }

  return { company: fallbackName, url: CAMPUS_PAGE, section: 'campus', keyword, totalOnSite: total, count: jobs.length, jobs };
}

module.exports = { scrapeAnt, mapAntJob };
