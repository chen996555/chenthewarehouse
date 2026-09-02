'use strict';
/**
 * 求职星计划 — 国聘网（iguopin.com）适配器（纯 HTTP 公开 JSON）
 * 覆盖：央国企校招聚合平台（中核/中铁/三大运营商等央企子公司的校招岗位都在这）
 *
 * 机制（实测验证）：
 *   POST https://gp-api.iguopin.com/api/jobs/v1/recom-job
 *   body：{ search: { page, page_size, nature:[校招代码], keyword }, recom: {} }
 *   nature 代码：校招="115xW5oQ"（社招/实习代码待从 category 接口确认）
 *   响应：{ code:200, data:{ total, list:[{ job_id, job_name, company_name, nature_cn,
 *          district_list, contents(完整JD), education_cn, experience_cn, min_wage, max_wage }] } }
 *
 * 意义：不用逐个逆真自研央企（国家电网/中石油等自研系统加密），一套国聘网 API 覆盖所有央国企校招。
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const BASE = 'https://gp-api.iguopin.com';

// nature 代码 → section（从 /api/base/category/v1/by-alias 的 job_nature 实测）
const SECTION_BY_NATURE = {
  '115xW5oQ': 'campus', // 校招
  '113Fc6wc': 'social', // 社招
  '11bTac9': 'intern', // 实习
};

function mapJob(it) {
  const districts = Array.isArray(it.district_list) ? it.district_list.map((d) => d.area_cn || '').filter(Boolean) : [];
  const city = districts.length ? districts[districts.length - 1].split('-')[0] : '';
  return {
    id: String(it.job_id || ''),
    title: it.job_name || '',
    company: it.company_name || '',
    location: [...new Set(districts)].join('、'),
    city,
    date: String(it.start_time || '').slice(0, 10),
    section: SECTION_BY_NATURE[it.nature] || 'campus',
    nature: it.nature_cn || '',
    department: it.department_cn || '',
    education: it.education_cn || '',
    experience: it.experience_cn || '',
    salary: it.min_wage && it.max_wage ? `${it.min_wage}-${it.max_wage}${it.wage_unit_cn || ''}` : (it.is_negotiable ? '面议' : ''),
    detailUrl: `https://www.iguopin.com/job/detail?id=${it.job_id}`,
    jd: String(it.contents || ''), // 列表直接带完整 JD（职责+要求）
  };
}

async function fetchPage({ page, pageSize, nature, keyword, city }) {
  const body = {
    search: { page, page_size: pageSize, nature: [nature] },
    recom: {},
  };
  if (keyword) body.search.keyword = keyword;
  if (city) body.search.city = city;
  const res = await fetch(`${BASE}/api/jobs/v1/recom-job`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA, Referer: 'https://www.iguopin.com/' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`国聘网 HTTP ${res.status}`);
  const j = await res.json();
  if (j.code !== 200) throw new Error(`国聘网返回 ${j.msg || j.code}`);
  return j.data || {};
}

// 拿省级列表（district tree 第一层），用于按省份枚举抓全量（突破单次 400 上限）
async function fetchProvinces() {
  const res = await fetch(`${BASE}/api/base/districts/v1/tree`, {
    headers: { 'User-Agent': UA, Referer: 'https://www.iguopin.com/' },
  });
  const j = await res.json();
  const root = (j.data && j.data[0]) || {};
  return (root.children || []).map((p) => ({ value: p.value, name: p.name })).filter((p) => p.value);
}

/**
 * 抓取国聘网岗位
 * @param {string} nature 校招="115xW5oQ"（社招/实习代码待确认）
 * @param {string} keyword 关键词（可选）
 */
async function scrapeIguopin({ nature = '115xW5oQ', keyword = '', maxJobs = 100, fallbackName = '国聘网', allCities = false } = {}) {
  const cap = allCities ? Math.min(Math.max(Number(maxJobs) || 500, 10), 3000) : Math.min(Math.max(Number(maxJobs) || 100, 10), 400);
  const pageSize = 20;
  const seen = new Set();
  const jobs = [];
  let total = 0;

  const collect = (items) => {
    let added = 0;
    for (const it of items) {
      const id = String(it.job_id || '');
      if (seen.has(id)) continue;
      seen.add(id);
      jobs.push(mapJob(it));
      added++;
      if (jobs.length >= cap) break;
    }
    return added;
  };

  if (allCities) {
    // 按省份枚举抓全量（突破单次 400 上限）：每省 city 筛选，跨省去重
    const provinces = await fetchProvinces();
    for (const p of provinces) {
      if (jobs.length >= cap) break;
      for (let page = 1; jobs.length < cap; page++) {
        const data = await fetchPage({ page, pageSize, nature, keyword, city: p.value });
        const items = data.list || [];
        if (!items.length) break;
        const added = collect(items);
        if (added === 0 || items.length < pageSize) break;
      }
    }
    total = jobs.length;
  } else {
    // 默认：只抓热门（单次上限约 400）
    for (let page = 1; jobs.length < cap; page++) {
      const data = await fetchPage({ page, pageSize, nature, keyword });
      if (page === 1) total = Number(data.total || 0);
      const items = data.list || [];
      if (!items.length) break;
      collect(items);
      if (items.length < pageSize || jobs.length >= total) break;
    }
  }

  return {
    company: fallbackName,
    url: 'https://www.iguopin.com/',
    section: 'campus',
    totalOnSite: total,
    count: jobs.length,
    jobs,
  };
}

module.exports = { scrapeIguopin, mapJob, SECTION_BY_NATURE, fetchProvinces };
