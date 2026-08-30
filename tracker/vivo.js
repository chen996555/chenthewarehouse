'use strict';

/**
 * 求职星计划 — vivo 校招适配器（北森 2022 版，hr-campus.vivo.com）
 * 参考 job-pro vivo.ts。接口与 zhiye.js 相同（GetJobAdPageList），但域名 + PortalId 不同。
 * POST https://hr-campus.vivo.com/api/Jobad/GetJobAdPageList
 *   body：{ PageIndex(0-based), PageSize, Category:["2"], KeyWords, SpecialType:0, PortalId:"612022" }
 * 响应：{ Code:200, Count, Data:[...] }，字段 JobAdId/JobAdName/LocNames/Duty/Require/PostDate
 * （Count=169 total，KeyWords=工程师 → 114，job-pro 2026-07-11 实测）
 */

const BASE = 'https://hr-campus.vivo.com';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function mapVivoJob(it) {
  const name = String(it.JobAdName || '');
  const tm = name.match(/^(.+?)\s*\(J(\d+)\)\s*$/);
  return {
    id: String(it.JobAdId || ''),
    title: (tm ? tm[1] : name).trim(),
    team: '',
    location: (Array.isArray(it.LocNames) ? it.LocNames : []).join('、'),
    type: it.Kind || '',
    section: 'campus',
    program: '',
    date: String(it.PostDate || '').slice(0, 10),
    detailUrl: `${BASE}/zpdetail/${it.JobAdId}`,
    jd: [it.Duty, it.Require].filter(Boolean).join('\n'),
  };
}

async function scrapeVivo({ keyword = '', maxJobs = 100, fallbackName = 'vivo' } = {}) {
  const pageSize = 20;
  const cap = Math.min(Math.max(Number(maxJobs) || 100, 10), 300);
  const jobs = [];
  let total = 0;

  for (let pageIndex = 0; jobs.length < cap; pageIndex++) {
    const body = JSON.stringify({
      PageIndex: pageIndex,
      PageSize: pageSize,
      Category: ['2'],
      KeyWords: keyword || '',
      SpecialType: 0,
      PortalId: '612022',
    });
    const res = await fetch(`${BASE}/api/Jobad/GetJobAdPageList`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA, Referer: `${BASE}/jobs` },
      body,
    });
    if (!res.ok) break;
    const j = await res.json().catch(() => null);
    if (!j || j.Code !== 200) break;
    if (pageIndex === 0) total = Number(j.Count ?? j.Total ?? 0) || 0;
    const list = j.Data || j.JobAdList || j.list || [];
    if (!list.length) break;
    for (const it of list) {
      const id = String(it.JobAdId || '');
      if (id) jobs.push(mapVivoJob(it));
    }
    if (list.length < pageSize) break;
  }

  return { company: fallbackName, url: `${BASE}/jobs`, section: 'campus', keyword, totalOnSite: total, count: jobs.length, jobs };
}

module.exports = { scrapeVivo, mapVivoJob };
