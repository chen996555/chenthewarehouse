'use strict';

/**
 * 求职星计划 — 蚂蚁集团 talent.antgroup.com 适配器（适配器 #13，Puppeteer 页面上下文调用）
 *
 * 岗位 API：POST hrcareersweb.antgroup.com/api/campus/position/search?ctoken={token}
 * ctoken 由页面生成，需在浏览器页面上下文里调用（自动带 cookie + token）。
 */

let puppeteer;
try {
  puppeteer = require('puppeteer-core');
} catch {
  puppeteer = require('../job-hunter/node_modules/puppeteer-core');
}

const EDGE_PATH = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = 'https://talent.antgroup.com';

function fmtDate(iso) {
  return String(iso || '').slice(0, 10);
}

function mapAntJob(item) {
  const grad = item.graduationTime || {};
  return {
    id: String(item.id || ''),
    title: item.name || '',
    team: '',
    location: '',
    type: '',
    category: item.categories || '',
    program: grad.from ? `${fmtDate(grad.from).slice(0, 4)}-${fmtDate(grad.to).slice(0, 4)}届` : '',
    date: fmtDate(item.publishTime),
    detailUrl: item.positionUrl || `${BASE}/campus-full-list`,
    jd: '',
  };
}

async function scrapeAnt({ keyword = '', maxJobs = 100, fallbackName = '蚂蚁集团' } = {}) {
  const cap = Math.min(Math.max(Number(maxJobs) || 100, 10), 300);
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

    // 捕获页面生成的 ctoken
    let token = '';
    page.on('request', (req) => {
      const m = req.url().match(/ctoken=([A-Za-z0-9_]+)/);
      if (m && !token) token = m[1];
    });

    await page.goto(`${BASE}/campus-full-list`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise((r) => setTimeout(r, 9000));
    if (!token) throw new Error('未捕获到蚂蚁 ctoken');

    // 页面上下文循环关键词 + 翻页拉取（自动携带 cookie）；key = 关键词搜索字段（阿里系同款）
    const items = await page.evaluate(async (token, keywords) => {
      const all = [];
      const seen = new Set();
      for (const kw of keywords) {
        for (let i = 1; i <= 30; i++) {
          const res = await fetch(`https://hrcareersweb.antgroup.com/api/campus/position/search?ctoken=${token}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              channel: 'campus_group_official_site', language: 'zh', regions: '', subCategories: '',
              bgCode: '', pageIndex: i, pageSize: 20, recruitType: [], batchIds: [], key: kw || '',
            }),
          });
          const j = await res.json();
          if (!j || !j.success || !Array.isArray(j.content) || !j.content.length) break;
          for (const it of j.content) {
            const id = String(it.id);
            if (seen.has(id)) continue;
            seen.add(id);
            all.push(it);
          }
          if (j.content.length < 20) break;
        }
      }
      return all;
    }, token, keywords);

    const seen = new Set();
    const jobs = [];
    for (const it of items) {
      const id = String(it.id);
      if (seen.has(id)) continue;
      seen.add(id);
      jobs.push(mapAntJob(it));
      if (jobs.length >= cap) break;
    }

    return {
      company: fallbackName,
      url: `${BASE}/campus-full-list`,
      section: 'campus',
      keyword,
      totalOnSite: items.length,
      count: jobs.length,
      jobs,
    };
  } finally {
    await browser.close();
  }
}

function antToApplication(job, { company, url }) {
  const notes = [
    job.program || '',
    job.category ? `类别 ${job.category}` : '',
    job.date ? `发布 ${job.date}` : '',
  ].filter(Boolean).join(' | ');
  return {
    company,
    title: job.title,
    channel: '官网',
    url: job.detailUrl || url,
    status: 'pending',
    source: 'antgroup.com',
    degree: '',
    industry: '',
    jd: '',
    notes,
  };
}

module.exports = { scrapeAnt, antToApplication, mapAntJob };
