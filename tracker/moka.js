'use strict';

/**
 * 求职星计划 — Moka（mokahr.com）适配器（适配器 #4）
 * 覆盖：搜狐、新浪微博、携程、唯品会等使用 Moka 招聘系统的公司。
 *
 * Moka 的 API 响应是加密的（data 为密文），无法直连；
 * 但岗位列表在页面渲染后是明文 DOM：`#/jobs` 哈希路由 + 卡片链接 a[href^="#/job/"]。
 * 卡片文本格式：`[急 ]{标题} 发布于 {日期} {部门} {部门}`
 */

let puppeteer;
try {
  puppeteer = require('puppeteer-core');
} catch {
  puppeteer = require('../job-hunter/node_modules/puppeteer-core');
}

const EDGE_PATH = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

// 版块 → Moka 路径类型
const SECTION_TYPE = { campus: 'campus-recruitment', social: 'social-recruitment', intern: 'campus-recruitment' };

// 解析岗位卡片文本（两种格式）
function parseMokaCard(text, href) {
  const t = String(text || '').replace(/\s+/g, ' ');
  const hrefId = (String(href || '').match(/\/job\/([0-9a-f-]+)/) || [])[1] || '';

  // 标准格式：[急 ]{标题} 发布于 {日期} {部门}
  const m = t.match(/^(?:急\s*)?(.+?)\s*发布于\s*(\d{4}-\d{2}-\d{2})\s*(.+)$/);
  if (m) {
    const dept = m[3].trim().split(/\s+/)[0] || '';
    return { id: hrefId, title: m[1].trim(), date: m[2], team: dept, location: '', type: '', program: '', detailUrl: href || '', jd: '' };
  }

  // 兜底格式（无发布日期，如大疆）：热招 {标题} {部门} {部门} | {地点} {地点} 职位简介…
  const clean = t.replace(/热招|急\s*/g, '').replace(/职位简介.*$/, '').trim();
  const segs = clean.split('|').map((s) => s.trim()).filter(Boolean);
  const head = (segs[0] || '').split(/\s+/);
  const locDedup = (segs[1] || '').match(/^(\S+)\s+\1/);
  return {
    id: hrefId,
    title: head[0] || '',
    team: head[1] || '',
    location: locDedup ? locDedup[1] : '',
    date: '',
    type: '',
    program: '',
    detailUrl: href || '',
    jd: '',
  };
}

/**
 * 抓取 Moka 系统的岗位
 * @param {string} org     机构标识（如搜狐 sohu）
 * @param {string} siteId  站点 ID（如 43256）
 * @param {string} section campus | social | intern
 * @param {string} base    Moka 站点基地址（如 https://hr.sohu.com）
 * @param {number} maxJobs 目标条数上限
 */
async function scrapeMoka({ org, siteId, section = 'social', base, pathPrefix, keyword = '', maxJobs = 200, fallbackName = '' } = {}) {
  if (!org || !siteId) throw new Error('缺少 Moka 机构参数（org/siteId）');
  const pathType = pathPrefix || SECTION_TYPE[section] || 'social-recruitment';
  const baseUrl = String(base || 'https://app.mokahr.com').replace(/\/+$/, '');
  const listUrl = `${baseUrl}/${pathType}/${org}/${siteId}#/jobs`;
  const cap = Math.min(Math.max(Number(maxJobs) || 200, 10), 300);
  const keywords = Array.isArray(keyword) ? keyword : (keyword ? [keyword] : ['']);

  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--no-proxy-server'],
  });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
    );
    await page.goto(listUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise((r) => setTimeout(r, 9000)); // 等 SPA 渲染岗位列表

    // 循环关键词搜索 + 翻页累积（哈希路由 #/jobs?keyword=xxx&page=N）
    const seen = new Set();
    const jobs = [];
    const maxPages = Math.ceil(cap / 10) + 5;
    for (const kw of keywords) {
      await page.evaluate((kw) => {
        location.hash = `#/jobs${kw ? `?keyword=${encodeURIComponent(kw)}` : ''}`;
      }, kw);
      await new Promise((r) => setTimeout(r, 5000));

      for (let p = 1; p <= maxPages; p++) {
        if (p > 1) {
          await page.evaluate(({ n, kw }) => {
            location.hash = `#/jobs?${kw ? `keyword=${encodeURIComponent(kw)}&` : ''}page=${n}`;
          }, { n: p, kw });
          await new Promise((r) => setTimeout(r, 5000));
        }
        const before = jobs.length;
        const cards = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('a[href^="#/job/"]')).map((a) => ({
            text: a.innerText || '',
            href: a.getAttribute('href') || '',
          }));
        });
        for (const c of cards) {
          const job = parseMokaCard(c.text, c.href);
          if (!job || !job.id || seen.has(job.id)) continue;
          seen.add(job.id);
          jobs.push({ ...job, detailUrl: `${baseUrl}/${pathType}/${org}/${siteId}${job.detailUrl}` });
        }
        if (jobs.length >= cap) break;
        if (jobs.length === before) break; // 本页无新增，视为到底
      }
      if (jobs.length >= cap) break;
    }

    const company = fallbackName || org;
    return {
      company,
      url: listUrl,
      section,
      keyword,
      count: jobs.length,
      jobs,
    };
  } finally {
    await browser.close();
  }
}

// Moka 岗位 → 看板投递记录
function mokaToApplication(job, { company, url }) {
  const notes = [job.team ? `部门 ${job.team}` : '', job.date ? `发布 ${job.date}` : '']
    .filter(Boolean)
    .join(' | ');
  return {
    company,
    title: job.title,
    channel: '官网',
    url: job.detailUrl || url,
    status: 'pending',
    source: 'mokahr.com',
    degree: '',
    industry: '',
    jd: '',
    notes,
  };
}

module.exports = { scrapeMoka, mokaToApplication, parseMokaCard };
