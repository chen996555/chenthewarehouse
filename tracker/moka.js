'use strict';

/**
 * 求职星计划 — Moka（mokahr.com）适配器（纯 HTTP 接口版）
 * 覆盖：滴滴、大疆、唯品会、新浪微博、搜狐等使用 Moka 招聘系统的公司。
 *
 * 机制（参考 job-pro 的 moka.ts，已实测验证）：
 *   1. GET portal 页面（base/kind/org/siteId）→ 从 <input id="init-data"> 解析 aesIv + cookie
 *   2. POST /api/outer/ats-apply/website/jobs/v2?orgId=<org>，body 带 keyword（server-side 匹配）
 *   3. 响应是 AES-CBC 加密（{data, necromancer}）：key=necromancer(utf8)，iv=aesIv(utf8)，aes-128-cbc
 *   4. 解密取 dec.data.jobs[] + dec.data.jobStats.total（带 keyword 时 total 是过滤后计数）
 *
 * 相比旧 DOM 抓取（#/jobs?keyword= 哈希搜索）的改进：
 *   - 纯 HTTP，不依赖浏览器、不受前端改版影响
 *   - keyword 是后端匹配（server-side），而非前端哈希路由（部分租户不支持）
 *   - limit 上限 50（100 会返回 code 102 参数错误）
 */

const crypto = require('node:crypto');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';
const SECTION_TYPE = { campus: 'campus-recruitment', social: 'social-recruitment', intern: 'campus-recruitment' };
const MAX_LIMIT = 50; // 上游 limit 上限，100 会返回 code 102

// ---- HTML 解码 + init-data 解析 --------------------------------------------

function htmlDecode(s) {
  return s
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#x27;/g, "'").replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

function parseInitData(html) {
  const m = html.match(/<input[^>]*id="init-data"[^>]*value="([^"]+)"/);
  if (!m) return null;
  try { return JSON.parse(htmlDecode(m[1])); } catch { return null; }
}

function decryptMoka(envelope, aesIv) {
  if (!envelope || !envelope.data || !envelope.necromancer || !aesIv) return null;
  try {
    const key = Buffer.from(envelope.necromancer, 'utf8');
    const iv = Buffer.from(aesIv, 'utf8');
    const d = crypto.createDecipheriv('aes-128-cbc', key, iv);
    return JSON.parse(Buffer.concat([d.update(Buffer.from(envelope.data, 'base64')), d.final()]).toString('utf8'));
  } catch { return null; }
}

function htmlToText(html) {
  if (!html) return '';
  return String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|td|th|ul|ol|section)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---- 抓取 -------------------------------------------------------------------

// 第一步：GET portal 拿 cookie（Moka 有 locale-cookie 302 跳转）再拿 HTML
async function fetchPortalHtml(url) {
  const r1 = await fetch(url, { method: 'GET', headers: { 'User-Agent': UA }, redirect: 'manual' });
  const cookies = [];
  const setCookie = r1.headers.get('set-cookie');
  if (setCookie) cookies.push(...setCookie.split(/,(?=[^;]+=)/).map((c) => c.split(';')[0].trim()));
  const r2 = await fetch(url, { method: 'GET', headers: { 'User-Agent': UA, Cookie: cookies.join('; ') }, redirect: 'follow' });
  const html = await r2.text();
  return { html, cookieHeader: cookies.join('; ') };
}

// 第二步：POST jobs/v2（带 keyword），解密返回一页岗位
async function fetchPage({ org, siteId, pageNum, pageSize, aesIv, cookieHeader, baseUrl, portalUrl, keyword }) {
  const limit = Math.min(Math.max(Number(pageSize) || 20, 1), MAX_LIMIT);
  const body = { orgId: org, siteId: String(siteId), limit, offset: (Math.max(1, pageNum) - 1) * limit, needStat: true, locale: 'zh-CN' };
  if (keyword) body.keyword = keyword;
  const res = await fetch(`${baseUrl}/api/outer/ats-apply/website/jobs/v2?orgId=${encodeURIComponent(org)}`, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      Accept: 'application/json,*/*',
      'Content-Type': 'application/json',
      Origin: baseUrl,
      Referer: portalUrl,
      Cookie: cookieHeader,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) return { jobs: [], total: 0 };
  const envelope = await res.json().catch(() => null);
  const dec = decryptMoka(envelope, aesIv);
  if (!dec || dec.code !== 0 || !dec.data) return { jobs: [], total: 0 };
  return { jobs: dec.data.jobs || [], total: (dec.data.jobStats && dec.data.jobStats.total) || 0 };
}

// Moka 岗位 → 统一 job 结构
function mapMokaJob(j, baseUrl, kind, org, siteId) {
  const id = String(j.id || '');
  const cities = (j.locations || []).map((l) => l.cityName || l.country || '').filter(Boolean);
  const uniq = [...new Set(cities)];
  return {
    id,
    title: j.title || '',
    team: (j.department && j.department.name) || '',
    location: uniq.join(' / '),
    date: j.publishedAt || j.openedAt || '',
    type: j.commitment || (j.hireMode === 1 ? '全职' : j.hireMode === 2 ? '实习' : ''),
    section: j.hireMode === 2 ? 'intern' : (/social/.test(kind) ? 'social' : 'campus'),
    program: (j.zhineng && j.zhineng.name) || '',
    detailUrl: `${baseUrl}/${kind}/${org}/${siteId}#/job/${id}`,
    jd: htmlToText(j.jobDescription || ''),
  };
}

/**
 * 抓取 Moka 系统岗位（纯 HTTP）
 * @param {string} org        机构标识（如 didiglobal）
 * @param {string} siteId     站点 ID（如 96064）
 * @param {string} section    campus | social | intern
 * @param {string} base       站点基地址（如 https://campus.didiglobal.com）
 * @param {string} pathPrefix 路径类型（如 campus_apply，缺省按 section 推断）
 * @param {string|string[]} keyword 关键词（字符串或数组，数组时逐个搜合并去重）
 * @param {number} maxJobs    目标条数上限
 */
async function scrapeMoka({ org, siteId, section = 'social', base, pathPrefix, keyword = '', maxJobs = 200, fallbackName = '' } = {}) {
  if (!org || !siteId) throw new Error('缺少 Moka 机构参数（org/siteId）');
  const kind = pathPrefix || SECTION_TYPE[section] || 'social-recruitment';
  const baseUrl = String(base || 'https://app.mokahr.com').replace(/\/+$/, '');
  const portalUrl = `${baseUrl}/${kind}/${org}/${siteId}`;
  const cap = Math.min(Math.max(Number(maxJobs) || 200, 10), 300);

  // 1. GET portal → aesIv + cookie
  const { html, cookieHeader } = await fetchPortalHtml(portalUrl);
  const init = parseInitData(html);
  if (!init || !init.aesIv) throw new Error('Moka init-data 缺失 aesIv（portal 地址或页面结构可能已变）');

  // 2. 关键词循环搜 + 分页累积
  const keywords = Array.isArray(keyword) ? keyword : (keyword ? [keyword] : ['']);
  const seen = new Set();
  const jobs = [];

  for (const kw of keywords) {
    let total = 0;
    for (let p = 1; ; p++) {
      const { jobs: pageJobs, total: t } = await fetchPage({ org, siteId, pageNum: p, pageSize: MAX_LIMIT, aesIv: init.aesIv, cookieHeader, baseUrl, portalUrl, keyword: kw });
      if (p === 1) total = t || 0;
      for (const j of pageJobs) {
        const id = String(j.id || '');
        if (id && !seen.has(id)) { seen.add(id); jobs.push(mapMokaJob(j, baseUrl, kind, org, siteId)); }
      }
      if (pageJobs.length < MAX_LIMIT) break;         // 本页不满 → 到底
      if (jobs.length >= cap) break;                   // 到上限
      if (total && p * MAX_LIMIT >= total) break;      // 已拉满
    }
    if (jobs.length >= cap) break;
  }

  return {
    company: fallbackName || org,
    url: portalUrl,
    section,
    keyword,
    count: jobs.length,
    jobs,
  };
}

module.exports = { scrapeMoka, parseInitData, decryptMoka };
