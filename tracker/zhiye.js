'use strict';

/**
 * 求职星计划 — 北森 zhiye.com 官网真实岗位抓取（适配器 #1）
 *
 * 新版门户（styled-components，如 iflytek/360campus/beisen）岗位列表走纯 HTTP 接口：
 *   POST https://{sub}.zhiye.com/api/Jobad/GetJobAdPageList
 *   body: { PageIndex, PageSize, Category:["2"](校招), KeyWords(关键词), ... }
 * 响应含完整 JD（Duty + Require）、分页 Count，支持关键词搜索 —— 无需浏览器，真全量。
 *
 * 旧版门户（表格布局，如 chinalife）接口返回 0，回退 Puppeteer DOM 抓取首页。
 */

let puppeteer;
try {
  puppeteer = require('puppeteer-core');
} catch {
  puppeteer = require('../job-hunter/node_modules/puppeteer-core');
}

const EDGE_PATH = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// 招聘版块 → 路径
const SECTION_PATH = { campus: 'campus', social: 'social', intern: 'intern' };
// 招聘版块 → 新版接口 Category 值（校招 = 2；社招/实习未确认，暂走回退）
const CATEGORY_BY_SECTION = { campus: ['2'] };

// 新版接口岗位记录 → 统一岗位结构
function mapApiJob(it, subdomain, listUrl) {
  const name = String(it.JobAdName || '');
  const tm = name.match(/^(.+?)\s*\(J(\d+)\)\s*$/);
  return {
    id: String(it.JobAdId || ''),
    title: (tm ? tm[1] : name).trim(),
    category: it.Category || '',
    employmentType: '',
    location: (Array.isArray(it.LocNames) ? it.LocNames : []).join('、'),
    date: String(it.PostDate || '').slice(0, 10),
    detailUrl: `https://${subdomain}.zhiye.com/zpdetail/${it.JobAdId}`,
    jd: [it.Duty, it.Require].filter(Boolean).join('\n'),
  };
}

// 纯 HTTP 拉取新版门户岗位（支持关键词 + 分页真全量）
async function scrapeViaApi({ subdomain, category, keyword, maxJobs, listUrl }) {
  const pageSize = 20;
  const cap = Math.min(Math.max(Number(maxJobs) || 300, 10), 1000);
  const jobs = [];
  let total = 0;

  for (let pageIndex = 0; jobs.length < cap; pageIndex++) {
    const body = JSON.stringify({
      PageIndex: pageIndex,
      PageSize: pageSize,
      Category: category,
      KeyWords: keyword || '',
      SpecialType: 0,
      PortalId: '',
      DisplayFields: ['Category', 'Kind', 'LocId', 'PostDate', 'ClassificationOne', 'WorkWeChatQrCode'],
    });
    const res = await fetch(`https://${subdomain}.zhiye.com/api/Jobad/GetJobAdPageList`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      body,
    });
    if (!res.ok) break;
    const j = await res.json();
    if (!j || j.Code !== 200) break;
    if (pageIndex === 0) total = Number(j.Count ?? j.Total ?? j.total ?? j.count) || 0;
    const items = j.Data || [];
    if (!items.length) break;
    for (const it of items) jobs.push(mapApiJob(it, subdomain, listUrl));
    if (items.length < pageSize || jobs.length >= (total || cap)) break;
  }
  return { jobs, total };
}

// 旧版门户（表格布局）DOM 解析（保留原逻辑作回退）
function parseNewJob(input) {
  const text = String(typeof input === 'string' ? input : (input && input.text) || '');
  const href = typeof input === 'string' ? '' : (input && input.href) || '';
  const m = text.match(/^(.+?)\(J(\d{4,})\)(.*)$/);
  if (!m) return null;
  const rest = m[3] || '';
  return {
    id: m[2],
    title: m[1].trim(),
    category: (rest.match(/(校园招聘|社会招聘|实习生招聘)/) || [])[1] || '',
    employmentType: (rest.match(/(全职|实习|兼职|其他)/) || [])[1] || '',
    location: rest.replace(/(校园招聘|社会招聘|实习生招聘|全职|实习|兼职|其他|\d{4}-\d{2}-\d{2}|\s*发布|总部职位|子公司职位|分公司职位|营业部职位)/g, '').trim(),
    date: (rest.match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || '',
    detailUrl: href,
  };
}

function parseLinkJob(row) {
  const m = String(row.title || '').match(/^(.+?)\(J(\d{4,})\)$/);
  if (!m) return null;
  return { id: m[2], title: m[1].trim(), category: '', employmentType: '', location: '', date: '', detailUrl: row.href || '' };
}

function parseOldJob(row) {
  const title = String(row.title || '').trim();
  if (!title || title === '职位名称') return null;
  const jid = title.match(/\(J(\d{5,})\)/);
  const href = String(row.href || '');
  const hrefId = href.match(/zpdetail\/(\d+)/) || href.match(/jobAdId=([\w-]+)/);
  return {
    id: (jid && jid[1]) || (hrefId && hrefId[1]) || '',
    title: title.replace(/\s*\(J\d{5,}\)$/, '').trim(),
    category: String(row.category || ''),
    employmentType: '',
    location: String(row.location || ''),
    date: String(row.date || '').replace(/\s*发布$/, '').trim(),
    detailUrl: href || '',
  };
}

// Puppeteer DOM 抓取（旧版门户回退）
async function scrapeViaPuppeteer({ subdomain, url, fallbackName }) {
  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--no-proxy-server'],
  });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise((r) => setTimeout(r, 3500));

    const company = fallbackName || (await page.title()).replace(/(校园|社会|实习生)?招聘官网$/, '').replace(/(校园|社会|实习生)?招聘$/, '').replace(/官网$/, '').trim();

    const raw = await page.evaluate(() => {
      const items = [];
      document.querySelectorAll('[class*="STListItem"]').forEach((el) => {
        if (el.parentElement && el.parentElement.closest('[class*="STListItem"]')) return;
        const text = (el.innerText || '').trim().replace(/\s+/g, ' ');
        if (text && text.length > 5) {
          const a = el.matches('a[href]') ? el : (el.querySelector('a[href]') || el.closest('a[href]'));
          items.push({ text, href: a ? (a.getAttribute('href') || '') : '' });
        }
      });
      if (items.length) return { version: 'new', items };
      const rows = [];
      document.querySelectorAll('[class*="content-position"] tr').forEach((tr) => {
        const cells = Array.from(tr.querySelectorAll('td, th')).map((td) => (td.innerText || '').trim().replace(/\s+/g, ' '));
        if (!cells.length || !cells[0]) return;
        const link = tr.querySelector('a[href]');
        rows.push({ title: cells[0], entity: cells[1] || '', category: cells[2] || '', location: cells[3] || '', count: cells[4] || '', date: cells[5] || '', href: link ? link.getAttribute('href') : '' });
      });
      if (rows.length) return { version: 'old', items: rows };
      const links = [];
      document.querySelectorAll('a[href]').forEach((a) => {
        const t = (a.innerText || '').trim().replace(/\s+/g, ' ');
        if (/\(J\d{4,}\)/.test(t) && !/立即投递|投递简历/.test(t)) links.push({ title: t, href: a.getAttribute('href') || '' });
      });
      return { version: 'link', items: links };
    });

    const parseMap = { new: parseNewJob, old: parseOldJob, link: parseLinkJob };
    const jobs = [];
    const seenKeys = new Set();
    for (const j of raw.items.map(parseMap[raw.version]).filter(Boolean)) {
      const key = j.id || j.title;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      jobs.push(j);
    }
    for (const j of jobs) {
      if (j.detailUrl && j.detailUrl.startsWith('/')) j.detailUrl = `https://${subdomain}.zhiye.com${j.detailUrl}`;
    }
    return { company, count: jobs.length, portalVersion: raw.version, jobs };
  } finally {
    await browser.close();
  }
}

/**
 * 抓取某公司 zhiye.com 的真实在招岗位
 * @param {string} subdomain 子域名，如 beisen
 * @param {string} section  campus | social | intern
 * @param {string} path    可选自定义路径
 * @param {string} keyword 可选关键词（新版门户接口支持）
 */
async function scrapeZhiye({ subdomain, section = 'campus', path, keyword = '', maxJobs = 300, fallbackName = '' } = {}) {
  subdomain = String(subdomain || '').trim().replace(/^https?:\/\//, '').replace(/\.zhiye\.com.*/, '');
  if (!subdomain) throw new Error('请提供 zhiye.com 子域名，如 beisen');

  const resolvedPath = path || `${SECTION_PATH[section] || section}/jobs`;
  const url = `https://${subdomain}.zhiye.com/${resolvedPath}`.replace(/\/+$/, '');
  const category = CATEGORY_BY_SECTION[section];

  // 新版门户：纯 HTTP 接口优先（完整 JD + 关键词 + 分页）
  if (category) {
    try {
      const { jobs, total } = await scrapeViaApi({ subdomain, category, keyword, maxJobs, listUrl: url });
      if (jobs.length) {
        return { subdomain, company: fallbackName || subdomain, url, section, keyword, totalOnSite: total, count: jobs.length, jobs };
      }
    } catch { /* 接口失败，回退 DOM */ }
  }

  // 旧版门户 / 接口返回 0：回退 Puppeteer DOM
  const r = await scrapeViaPuppeteer({ subdomain, url, fallbackName });
  return { subdomain, company: fallbackName || r.company, url, section, count: r.count, portalVersion: r.portalVersion, jobs: r.jobs };
}

// zhiye 岗位 → 看板投递记录
function zhiyeToApplication(job, { company, url }) {
  const notes = [
    job.id ? `编号 ${job.id}` : '',
    job.employmentType || '',
    job.location ? `地点 ${job.location}` : '',
    job.date ? `发布 ${job.date}` : '',
  ].filter(Boolean).join(' | ');
  return {
    company,
    title: job.title,
    channel: '官网',
    url: job.detailUrl || url,
    status: 'pending',
    source: 'zhiye.com',
    degree: '',
    industry: '',
    jd: job.jd || '',
    notes,
  };
}

module.exports = { scrapeZhiye, zhiyeToApplication, parseNewJob, parseOldJob };
