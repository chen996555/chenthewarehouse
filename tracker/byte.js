'use strict';

/**
 * 求职星计划 — 字节跳动 jobs.bytedance.com 抓取（适配器 #2）
 *
 * 岗位列表 API（/api/v1/search/job/posts）有签名/CSRF 校验，直连 405。
 * 方案：Puppeteer 加载页面，**拦截页面自身发出的 API 响应**（自带合法签名），
 * 通过滚动触发翻页，累积所有批次数据。每条含完整 JD/要求/城市/发布日期。
 */

let puppeteer;
try {
  puppeteer = require('puppeteer-core');
} catch {
  puppeteer = require('../job-hunter/node_modules/puppeteer-core');
}

const EDGE_PATH = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = 'https://jobs.bytedance.com';

// 版块 → 页面路径（默认字节；同 ATS 的其他公司可传 base/campusPath/socialPath 覆盖）
function sectionUrl(base, section, { campusPath, socialPath } = {}) {
  const b = String(base || BASE).replace(/\/+$/, '');
  if (section === 'social') return socialPath ? b + socialPath : `${b}/experienced/position`;
  return campusPath ? b + campusPath : `${b}/campus/position`;
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
  const b = String(base || BASE).replace(/\/+$/, '');
  const title = String(jp.title || '');
  // 只有「标题 - 团队」这种带空格的才拆；「中国区-研发工程师」不拆
  const tm = title.match(/^(.+?)\s+-\s+(.+)$/);
  const cities = (jp.city_list || []).map((c) => c.name).filter(Boolean);
  const campusBase = campusPath ? String(campusPath).replace(/\/+$/, '') : '/campus';
  const detailBase = section === 'social' ? `${b}/experienced/position` : `${b}${campusBase}/position`;
  const jobId = String(jp.id || jp.code || '');
  return {
    id: jobId,
    title: tm ? tm[1].trim() : title,
    team: tm ? tm[2].trim() : '',
    location: cities.join('、'),
    type: (jp.recruit_type && jp.recruit_type.name) || '',
    category: (jp.job_category && jp.job_category.name) || '',
    program: (jp.job_subject && jp.job_subject.name && jp.job_subject.name.zh_cn) || '',
    date: fmtDate(jp.publish_time),
    detailUrl: jobId ? `${detailBase}/${jobId}/detail` : '',
    jd: [jp.description, jp.requirement].filter(Boolean).join('\n'),
  };
}

/**
 * 抓取字节招聘岗位
 * @param {string} section campus | social | intern
 * @param {string} keyword 可选关键词
 * @param {number} maxJobs 目标条数上限（滚动翻页累积，默认 100）
 */
async function scrapeByteDance({ section = 'campus', keyword = '', maxJobs = 100, base, campusPath, socialPath } = {}) {
  const url = sectionUrl(base, section, { campusPath, socialPath });
  const cap = Math.min(Math.max(Number(maxJobs) || 100, 10), 500);
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

    // 拦截页面自身发出的岗位搜索响应（无需重放 API）
    let currentEnc = ''; // 当前搜索关键词（URL 编码），只收该关键词的响应
    const batches = [];
    page.on('response', (res) => {
      const u = res.url();
      if (!u.includes('/api/v1/search/job/posts')) return;
      // 关键词模式下只收命中当前关键词的响应，避免混入未过滤的首屏数据
      if (currentEnc && !u.includes(`keyword=${currentEnc}`)) return;
      if (res.status() !== 200) return;
      res
        .text()
        .then((text) => {
          try {
            const j = JSON.parse(text);
            if (j && j.data && Array.isArray(j.data.job_post_list)) batches.push(j.data);
          } catch { /* 跳过无法解析的响应 */ }
        })
        .catch(() => {});
    });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await new Promise((r) => setTimeout(r, 8000)); // 等首屏与首次 API 完成

    const seen = new Set();
    const jobs = [];
    let totalOnSite = 0;

    for (const kw of keywords) {
      currentEnc = kw ? encodeURIComponent(kw) : '';
      batches.length = 0; // 每个关键词重置响应缓存

      if (kw) {
        // 搜索框可能渲染较慢（得物等站点并发抓取时尤甚），用 waitForSelector 兜底等待
        try {
          await page.waitForSelector('input[placeholder*="搜索"]', { timeout: 12000 });
        } catch {
          throw new Error('关键词搜索未能生效（搜索框未找到）');
        }
        const ok = await page.evaluate(async (kw) => {
          const input = document.querySelector('input[placeholder*="搜索"]');
          if (!input) return false;
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          input.focus();
          setter.call(input, kw);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          const opts = { key: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
          input.dispatchEvent(new KeyboardEvent('keydown', opts));
          input.dispatchEvent(new KeyboardEvent('keyup', opts));
          await new Promise((r) => setTimeout(r, 3000));
          return true;
        }, kw);
        if (!ok) throw new Error('关键词搜索未能生效（搜索框未找到）');

        // 等命中关键词的搜索结果被拦截（0 结果也会 push 一个空列表）
        let applied = false;
        for (let i = 0; i < 8 && !applied; i++) {
          await new Promise((r) => setTimeout(r, 1000));
          applied = batches.length > 0;
        }
        if (!applied) continue; // 该关键词无结果，跳下一个
      }

      // 逐页点击「下一页」，累积拦截到的 API 响应（每页 10 条）
      let idleRounds = 0;
      const maxRounds = Math.ceil(cap / 10) + 5;
      for (let i = 0; i < maxRounds; i++) {
        const before = jobs.length;
        for (const b of batches) {
          for (const jp of b.job_post_list || []) {
            if (seen.has(jp.id)) continue;
            seen.add(jp.id);
            jobs.push(mapJobPost(jp, section, base, campusPath));
          }
        }
        if (jobs.length >= cap) break;

        const clicked = await page.evaluate(() => {
          const next = document.querySelector('[class*="pagination-next"], [title="下一页"], [aria-label="下一页"]');
          if (next && !/disabled/i.test(next.className || '')) {
            next.click();
            return true;
          }
          return false;
        });
        if (!clicked) break;
        await new Promise((r) => setTimeout(r, 2000));

        if (jobs.length === before) {
          idleRounds++;
          if (idleRounds >= 3) break;
        } else {
          idleRounds = 0;
        }
      }

      if (totalOnSite === 0 && batches.length) totalOnSite = batches[0].count || 0;
      if (jobs.length >= cap) break;
    }

    return {
      company: '字节跳动',
      url,
      section,
      keyword,
      totalOnSite,
      count: jobs.length,
      jobs,
    };
  } finally {
    await browser.close();
  }
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
