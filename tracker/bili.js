'use strict';

/**
 * 求职星计划 — 哔哩哔哩 jobs.bilibili.com 适配器（适配器 #12）
 *
 * 岗位接口：POST /api/campus/position/positionList 有认证（需 x-csrf 等 header）。
 * 方案：拦截页面自身发出的请求拿到 x-csrf，再在页面上下文里复用该 header
 * 直接 fetch positionList，支持 positionName 关键词 + 分页 + 完整 JD。
 */

let puppeteer;
try {
  puppeteer = require('puppeteer-core');
} catch {
  puppeteer = require('../job-hunter/node_modules/puppeteer-core');
}

const EDGE_PATH = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = 'https://jobs.bilibili.com';

function mapBiliApiJob(it) {
  return {
    id: String(it.id || ''),
    title: it.positionName || '',
    team: it.postCodeName || '',
    location: it.workLocation || '',
    type: it.positionTypeName || '',
    category: '',
    program: it.campusProjectId ? `${it.campusProjectId}届` : '',
    date: it.pushTime ? String(it.pushTime).slice(0, 10) : '',
    detailUrl: `${BASE}/campus/positions`,
    jd: it.positionDescription || '',
  };
}

// DOM 卡片解析（回退路径：接口认证升级时降级为抓页面卡片，无 JD）
function parseBiliCard(input) {
  const href = typeof input === 'string' ? '' : (input && input.href) || '';
  const t = String(typeof input === 'string' ? input : (input && input.text) || '')
    .replace(/查看职位|申请|收藏/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const m = t.match(/^(.*?)【?(\d{4})?届】?\s*(.+?)(全职|实习)\s*(\d{4}-\d{2}-\d{2})\s*发布$/);
  if (!m) return null;
  const meta = m[3] || '';
  const city = (meta.match(/^(上海|北京|深圳|广州|杭州|成都|武汉|南京|苏州|新加坡|海外)/) || [])[1] || '';
  const category = meta.replace(/^(上海|北京|深圳|广州|杭州|成都|武汉|南京|苏州|新加坡|海外)/, '').replace(/(全职|实习)/, '').trim();
  return {
    id: '',
    title: m[1].trim(),
    team: '',
    location: city,
    type: m[4],
    category,
    program: m[2] ? `${m[2]}届` : '',
    date: m[5],
    detailUrl: href
      ? (/^https?:\/\//.test(href) ? href : `${BASE}${href.startsWith('/') ? href : '/' + href}`)
      : `${BASE}/campus/positions`,
    jd: '',
  };
}

// DOM 抓取回退（翻页抓 [class*="bili-item-card"] 卡片，无完整 JD）
async function scrapeBiliViaDom({ page, cap }) {
  const seen = new Set();
  const jobs = [];
  const maxPages = Math.ceil(cap / 10) + 5;
  for (let p = 1; p <= maxPages; p++) {
    if (p > 1) {
      const clicked = await page.evaluate(() => {
        const next = document.querySelector('[class*="pagination-next"], [title="下一页"]');
        if (next && !/disabled/i.test(next.className || '')) { next.click(); return true; }
        return false;
      });
      if (!clicked) break;
      await new Promise((r) => setTimeout(r, 5000));
    }
    const before = jobs.length;
    const cards = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('[class*="bili-item-card"]')).map((el) => {
        const a = el.matches('a[href]') ? el : (el.querySelector('a[href]') || el.closest('a[href]'));
        return { text: (el.innerText || '').trim(), href: a ? (a.getAttribute('href') || '') : '' };
      });
    });
    for (const c of cards) {
      const job = parseBiliCard(c);
      if (!job || !job.title || seen.has(job.title)) continue;
      seen.add(job.title);
      jobs.push(job);
    }
    if (jobs.length >= cap) break;
    if (jobs.length === before) break;
  }
  return jobs;
}

async function scrapeBili({ keyword = '', maxJobs = 300, fallbackName = '哔哩哔哩' } = {}) {
  const cap = Math.min(Math.max(Number(maxJobs) || 300, 10), 500);
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

    // 拦截页面自己发的 positionList 请求，拿认证 header（x-csrf 等）
    let captured = null;
    page.on('request', (r) => {
      if (r.url().includes('/positionList') && !captured) captured = r.headers();
    });

    await page.goto(`${BASE}/campus/positions`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise((r) => setTimeout(r, 9000));

    // 回退：x-csrf 拦截失败（认证升级/接口改名）时，降级为 DOM 抓取
    if (!captured) {
      const jobs = await scrapeBiliViaDom({ page, cap });
      return {
        company: fallbackName,
        url: `${BASE}/campus/positions`,
        section: 'campus',
        keyword,
        totalOnSite: 0,
        count: jobs.length,
        jobs,
      };
    }

    // 页面上下文复用 header 循环关键词 + 翻页拉取（positionName 搜索 + 分页）
    const items = await page.evaluate(async ({ h, keywords, cap }) => {
      const all = [];
      const seen = new Set();
      const pageSize = 50;
      for (const kw of keywords) {
        for (let pageNum = 1; pageNum <= 40 && all.length < cap; pageNum++) {
          const body = JSON.stringify({
            pageSize, pageNum, positionName: kw || '',
            postCode: [], postCodeList: [], workLocationList: [],
            workTypeList: ['3'], positionTypeList: ['3'], deptCodeList: [],
            recruitType: null, practiceTypes: [], onlyHotRecruit: 0,
          });
          const r = await fetch('/api/campus/position/positionList', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-appkey': h['x-appkey'] || 'ops.ehr.api-auth',
              'x-usertype': h['x-usertype'] || '2',
              'x-channel': h['x-channel'] || 'campus',
              'x-csrf': h['x-csrf'],
              'lunar-id': h['lunar-id'] || '',
            },
            body,
          });
          const j = await r.json();
          if (!j || j.code !== 0) break;
          const d = j.data || {};
          const list = d.list || d.positionList || [];
          if (!list.length) break;
          for (const it of list) {
            const id = String(it.id);
            if (!id || seen.has(id)) continue;
            seen.add(id);
            all.push(it);
          }
          if (list.length < pageSize) break;
        }
      }
      return all;
    }, { h: captured, keywords, cap });

    const seen = new Set();
    const jobs = [];
    for (const it of items) {
      const id = String(it.id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      jobs.push(mapBiliApiJob(it));
    }

    return {
      company: fallbackName,
      url: `${BASE}/campus/positions`,
      section: 'campus',
      keyword,
      totalOnSite: jobs.length,
      count: jobs.length,
      jobs,
    };
  } finally {
    await browser.close();
  }
}

function biliToApplication(job, { company, url }) {
  const notes = [
    job.program || '',
    job.category ? `类别 ${job.category}` : '',
    job.location ? `地点 ${job.location}` : '',
    job.date ? `发布 ${job.date}` : '',
  ].filter(Boolean).join(' | ');
  return {
    company,
    title: job.title,
    channel: '官网',
    url: job.detailUrl || url,
    status: 'pending',
    source: 'bilibili.com',
    degree: '',
    industry: '',
    jd: job.jd || '',
    notes,
  };
}

module.exports = { scrapeBili, biliToApplication };
