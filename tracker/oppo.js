'use strict';

/**
 * 求职星计划 — OPPO 适配器（自研，POST JSON）
 * 参考 job-pro oppo.ts。
 * POST https://careers.oppo.com/openapi/position/pageNew
 *   body：{ pageNum, pageSize, positionName（server-side title 过滤，keyword/keyWord 被忽略！）, recruitmentType }
 *   响应：{ code:0, data:{ records:[...], total:<int> }, msg }
 * 详情：https://careers.oppo.com/#/campus/talent/positionDetail/<id>
 */

const BASE = 'https://careers.oppo.com';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function fetchOppoPage({ pageNum, pageSize, keyword, recruitmentType }) {
  const body = { pageNum, pageSize, recruitmentType };
  if (keyword) body.positionName = keyword;
  const res = await fetch(`${BASE}/openapi/position/pageNew`, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/json',
      Origin: BASE,
      Referer: `${BASE}/`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`OPPO HTTP ${res.status}`);
  const j = await res.json().catch(() => null);
  if (!j || j.code !== 0) throw new Error(`OPPO code ${j && j.code}: ${j && j.msg}`);
  return j.data || { records: [], total: 0 };
}

function mapOppoJob(item) {
  const id = String(item.idRecruitPosition || item.id || '');
  return {
    id,
    title: String(item.positionName || item.projectPositionName || '').trim(),
    team: '',
    location: String(item.workCityName || '').trim(),
    type: item.recruitmentTypeName || '',
    section: /实习/.test(item.recruitmentTypeName || '') ? 'intern' : 'campus',
    program: item.projectName || '',
    date: '',
    detailUrl: id ? `${BASE}/#/campus/talent/positionDetail/${id}` : '',
    jd: [item.positionDesc, item.positionRequire].filter(Boolean).join('\n'),
  };
}

async function scrapeOppo({ keyword = '', maxJobs = 100, fallbackName = 'OPPO' } = {}) {
  const recruitmentTypes = ['Graduate', 'Intern']; // 一次抓全量（校招+实习），section 由岗位字段标记
  const cap = Math.min(Math.max(Number(maxJobs) || 100, 10), 300);
  const pageSize = 20;
  const seen = new Set();
  const jobs = [];
  let total = 0;

  for (const recruitmentType of recruitmentTypes) {
    if (jobs.length >= cap) break;
    for (let pageNum = 1; jobs.length < cap; pageNum++) {
      const data = await fetchOppoPage({ pageNum, pageSize, keyword, recruitmentType });
      if (pageNum === 1) total += Number(data.total || 0);
      const records = data.records || [];
      if (!records.length) break;
      for (const it of records) {
        const id = String(it.idRecruitPosition || it.id || '');
        if (id && !seen.has(id)) { seen.add(id); jobs.push(mapOppoJob(it)); }
      }
      if (records.length < pageSize) break;
    }
  }

  return { company: fallbackName, url: BASE, section: 'campus', keyword, totalOnSite: total, count: jobs.length, jobs };
}

module.exports = { scrapeOppo, mapOppoJob };
