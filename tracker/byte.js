'use strict';

/**
 * 求职星计划 — 飞书 ATSX 招聘后端适配器（纯 HTTP 直连版）
 * 覆盖：字节跳动、小米、商汤、得物（同一飞书 ATSX 后端，仅 host + portal-channel 不同）
 *
 * 机制（参考 job-pro 的 feishu.ts，已实测验证）：
 *   POST https://<host>/api/v1/search/job/posts
 *   必须 header：portal-channel + website-path（= channel）+ portal-platform: pc
 *   body：keyword/limit/offset/portal_type:3/portal_entrance:1/language:zh + recruitment_id_list
 *   recruitment_id_list：["201"]=校招应届、["202"]=实习
 *   响应：{code:0, data:{job_post_list, count}}（code===0 成功）
 *
 * 相比旧浏览器拦截（签名/CSRF 405）的改进：直连无需签名破解、无需浏览器、秒级返回。
 */

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const DEFAULT_BASE = 'https://jobs.bytedance.com';

function hostOf(base) {
  return String(base || DEFAULT_BASE).replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

// 从 campusPath/socialPath 提取 portal-channel 值（如 /campus/ → campus，/578078/position/ → 578078，/edu/ → edu）
function channelOf(path, fallback) {
  if (!path) return fallback;
  const m = String(path).match(/^\/([^/]+)/);
  return m ? m[1] : fallback;
}

function fmtDate(epochMs) {
  if (!epochMs) return '';
  const d = new Date(Number(epochMs));
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// API 岗位记录 → 统一岗位结构
// 注意：detail 链接用 jp.id（长数字），不是 jp.code；路径用 campusPath（如商汤 /edu），不是硬编码 /campus
function mapJobPost(jp, section, base, campusPath) {
  const b = String(base || DEFAULT_BASE).replace(/\/+$/, '');
  const title = String(jp.title || '');
  // 只有「标题 - 团队」这种带空格的才拆；「中国区-研发工程师」不拆
  const tm = title.match(/^(.+?)\s+-\s+(.+)$/);
  const cities = (jp.city_list || []).map((c) => c.name).filter(Boolean);
  const campusBase = campusPath ? String(campusPath).replace(/\/+$/, '') : '/campus';
  // campusPath 已含 /position（如得物 /578078/position/）则不再补，否则补 /position
  const detailBase = section === 'social'
    ? `${b}/experienced/position`
    : (campusBase.endsWith('/position') ? `${b}${campusBase}` : `${b}${campusBase}/position`);
  const jobId = String(jp.id || jp.code || '');
  return {
    id: jobId,
    title: tm ? tm[1].trim() : title,
    team: tm ? tm[2].trim() : '',
    location: cities.join('、'),
    type: (jp.recruit_type && jp.recruit_type.name) || '',
    section: (() => { const n = (jp.recruit_type && jp.recruit_type.name) || ''; return /实习/.test(n) ? 'intern' : /社招/.test(n) ? 'social' : 'campus'; })(),
    category: (jp.job_category && jp.job_category.name) || '',
    program: (jp.job_subject && jp.job_subject.name && jp.job_subject.name.zh_cn) || '',
    date: fmtDate(jp.publish_time),
    detailUrl: jobId ? `${detailBase}/${jobId}/detail` : '',
    jd: [jp.description, jp.requirement].filter(Boolean).join('\n'),
  };
}

// 单页搜索（直连飞书 ATSX）
async function searchPage(host, channel, { keyword, limit, offset, recruitmentIdList }) {
  const body = { keyword: keyword || '', limit, offset, portal_type: 3, portal_entrance: 1, language: 'zh' };
  if (recruitmentIdList && recruitmentIdList.length) body.recruitment_id_list = recruitmentIdList;
  const res = await fetch(`https://${host}/api/v1/search/job/posts`, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      Accept: 'application/json, text/plain, */*',
      'Content-Type': 'application/json',
      'portal-channel': channel,
      'portal-platform': 'pc',
      'website-path': channel,
      Referer: `https://${host}/${channel}/position`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json().catch(() => null);
  if (!j || j.code !== 0) throw new Error(`上游 code ${j && j.code}: ${j && j.message}`);
  return j.data || { job_post_list: [], count: 0 };
}

/**
 * 抓取飞书 ATSX 招聘岗位（纯 HTTP）
 * @param {string} section campus | social | intern
 * @param {string|string[]} keyword 关键词（字符串或数组）
 * @param {number} maxJobs 目标条数上限
 * @param {string} base 站点基地址（如 https://jobs.bytedance.com）
 * @param {string} campusPath 校招路径（如 /campus/、/edu/、/578078/position/）
 * @param {string} socialPath 社招路径
 */
async function scrapeByteDance({ section = 'campus', keyword = '', maxJobs = 100, base, campusPath, socialPath, fallbackName = '字节跳动' } = {}) {
  const b = String(base || DEFAULT_BASE).replace(/\/+$/, '');
  const host = hostOf(b);
  const cap = Math.min(Math.max(Number(maxJobs) || 100, 10), 500);

  // 确定 channel（portal-channel header 值）。section 只决定校招/社招路径，不带 recruitment_id_list（一次抓全量，section 从岗位 recruit_type 字段判断）
  const channel = section === 'social' ? channelOf(socialPath, 'experienced') : channelOf(campusPath, 'campus');

  const keywords = Array.isArray(keyword) ? keyword : (keyword ? [keyword] : ['']);
  const seen = new Set();
  const jobs = [];
  const pageSize = 100;
  let totalOnSite = 0;

  for (const kw of keywords) {
    let total = 0;
    for (let offset = 0; ; offset += pageSize) {
      const data = await searchPage(host, channel, { keyword: kw, limit: pageSize, offset });
      if (offset === 0) { total = data.count || 0; if (!totalOnSite) totalOnSite = total; }
      const list = data.job_post_list || [];
      for (const jp of list) {
        const id = String(jp.id || '');
        if (id && !seen.has(id)) { seen.add(id); jobs.push(mapJobPost(jp, section, b, campusPath)); }
      }
      if (list.length < pageSize) break;      // 本页不满 → 到底
      if (jobs.length >= cap) break;          // 到上限
      if (total && offset + pageSize >= total) break; // 已拉满
    }
    if (jobs.length >= cap) break;
  }

  const url = section === 'social'
    ? `${b}${socialPath || '/experienced/position'}`
    : `${b}${campusPath || '/campus/position'}`;
  return {
    company: fallbackName,
    url,
    section,
    keyword,
    totalOnSite,
    count: jobs.length,
    jobs,
  };
}

// 字节岗位 → 看板投递记录
function byteToApplication(job, { company, url }) {
  const notes = [
    job.id ? `ID ${job.id}` : '',
    job.team ? `团队 ${job.team}` : '',
    job.type || '',
    job.program || '',
    job.location ? `地点 ${job.location}` : '',
    job.category || '',
    job.date ? `发布 ${job.date}` : '',
  ]
    .filter(Boolean)
    .join(' | ');
  return {
    company,
    title: job.title,
    channel: '官网',
    url: job.detailUrl || url,
    status: 'pending',
    source: 'bytedance.com',
    degree: '',
    industry: '',
    jd: job.jd || '',
    notes,
  };
}

module.exports = { scrapeByteDance, byteToApplication, mapJobPost };
