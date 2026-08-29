'use strict';

/**
 * 求职星计划 — 北森微招聘 wecruit.hotjob.cn / career.honor.com 适配器（适配器 #3）
 * 覆盖：荣耀（career.honor.com）、南方基金、广发证券、华泰证券等（同一套系统，各自一个 suiteId）
 *
 * 岗位接口：POST {base}/wecruit/positionInfo/listPosition/{suiteId}?iSaJAx=isAjax&request_locale=zh_CN&t={ms}
 *   body（form-urlencoded）：isFrompb=true&recruitType=1&pageSize=15&currentPage=N&postName=关键词
 * 响应：{ data: { pageForm: { pageData:[...], totalPage }, positonNum } }
 * 签名 iSaJAx/t 在页面上下文 fetch 时自动由 cookie 会话携带，故在页面内调用。
 */

let puppeteer;
try {
  puppeteer = require('puppeteer-core');
} catch {
  puppeteer = require('../job-hunter/node_modules/puppeteer-core');
}

const EDGE_PATH = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = 'https://wecruit.hotjob.cn';

// 版块 → 页面文件 + recruitType（校招=1；社招/实习沿用系统默认，暂按 1 处理）
const SECTION_PAGE = { campus: 'school.html', social: 'social.html', intern: 'interns.html' };

// API 岗位记录 → 统一岗位结构
function mapHotjobPost(p, suiteId, section, base) {
  return {
    id: p.postCode || p.postId || '',
    title: String(p.postName || '').trim(),
    team: p.company || p.department || '',
    location: p.workPlaceStr || '',
    type: p.postTypeName || '',
    category: '',
    program: p.projectName || '',
    date: String(p.publishDate || '').slice(0, 10),
    endDate: String(p.endDate || '').slice(0, 10),
    education: p.educationStr || '',
    detailUrl: p.postUrl || p.positionUrl || `${base}/${suiteId}/pb/detail.html?postId=${p.postId || p.postCode || ''}`,
    jd: '',
  };
}

/**
 * 抓取 hotjob 平台的岗位
 * @param {string} suiteId 机构套件 ID
 * @param {string} section campus | social | intern
 * @param {string} keyword 可选关键词（岗位名 postName 搜索）
 * @param {string} base    站点基地址（荣耀 career.honor.com，默认 wecruit.hotjob.cn）
 */
async function scrapeHotjob({ suiteId, section = 'campus', keyword = '', base = BASE, maxJobs = 200, fallbackName = '' } = {}) {
  if (!suiteId) throw new Error('缺少 hotjob 机构 ID（suiteId）');
  const pageFile = SECTION_PAGE[section] || SECTION_PAGE.campus;
  const baseUrl = String(base || BASE).replace(/\/+$/, '');
  const url = `${baseUrl}/${suiteId}/pb/${pageFile}`;
  const cap = Math.min(Math.max(Number(maxJobs) || 200, 10), 500);
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
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise((r) => setTimeout(r, 6000)); // 等会话 cookie 就绪

    // 页面上下文循环关键词 + 翻页拉取（自动带 cookie 会话，签名 iSaJAx/t 无需重放）
    const items = await page.evaluate(async ({ baseUrl, suiteId, keywords, cap }) => {
      const all = [];
      const seen = new Set();
      const pageSize = 15;
      for (const kw of keywords) {
        for (let currentPage = 1; currentPage <= 80 && all.length < cap; currentPage++) {
          const t = Date.now();
          const apiUrl = `${baseUrl}/wecruit/positionInfo/listPosition/${suiteId}?iSaJAx=isAjax&request_locale=zh_CN&t=${t}`;
          const params = new URLSearchParams({
            isFrompb: 'true', recruitType: '1', pageSize: String(pageSize), currentPage: String(currentPage),
          });
          if (kw) params.append('postName', kw);
          const res = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
            body: params.toString(),
          });
          const j = await res.json();
          if (!j || !j.data || !j.data.pageForm) break;
          const pf = j.data.pageForm;
          const list = pf.pageData || [];
          if (!list.length) break;
          for (const p of list) {
            const key = p.postId || p.postCode;
            if (!key || seen.has(key)) continue;
            seen.add(key);
            all.push(p);
          }
          if (currentPage >= (Number(pf.totalPage) || 1)) break;
        }
      }
      return all;
    }, { baseUrl, suiteId, keywords, cap });

    const seen = new Set();
    const jobs = [];
    for (const p of items) {
      const key = p.postId || p.postCode;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      jobs.push(mapHotjobPost(p, suiteId, section, baseUrl));
    }

    const company = fallbackName || (jobs.length ? jobs[0].team : '');
    return {
      company,
      url,
      section,
      keyword,
      totalOnSite: jobs.length,
      count: jobs.length,
      jobs,
    };
  } finally {
    await browser.close();
  }
}

// hotjob 岗位 → 看板投递记录
function hotjobToApplication(job, { company, url }) {
  const notes = [
    job.id ? `编号 ${job.id}` : '',
    job.team ? `部门 ${job.team}` : '',
    job.education ? `学历 ${job.education}` : '',
    job.program || '',
    job.location ? `地点 ${job.location}` : '',
    job.date ? `发布 ${job.date}` : '',
    job.endDate ? `截止 ${job.endDate}` : '',
  ].filter(Boolean).join(' | ');
  return {
    company,
    title: job.title,
    channel: '官网',
    url: job.detailUrl || url,
    status: 'pending',
    source: 'hotjob.cn',
    degree: job.education || '',
    industry: '',
    jd: '',
    notes,
  };
}

module.exports = { scrapeHotjob, hotjobToApplication, mapHotjobPost };
