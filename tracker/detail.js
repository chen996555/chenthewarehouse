'use strict';

/**
 * 求职星计划 — 岗位详情页 JD 抓取（on-demand 按需抓）
 *
 * 只对「进了 A/B 档、缺 JD、且有详情链接」的岗位点开详情页补抓 JD，避免全量抓。
 * 通用启发式：加载详情页 → 在正文里定位「职责/要求/描述」关键词 → 取一段文本返回给 LLM 判定。
 * 若正文不含 JD 特征（说明点开的是列表页/非详情页），返回空，保留标题级判定。
 */

let puppeteer;
try {
  puppeteer = require('puppeteer-core');
} catch {
  puppeteer = require('../job-hunter/node_modules/puppeteer-core');
}

const EDGE_PATH = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

// 从详情页正文里提取 JD 文本（定位职责/要求关键词；无特征则返回空字符串）
function extractJd(bodyText) {
  const text = String(bodyText || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const markers = [
    '岗位职责', '工作职责', '职责描述', '职位描述', '岗位描述', '工作内容',
    '任职要求', '任职资格', '岗位要求', '职位要求', '岗位要求',
    'Responsibilities', 'Requirements', 'Job Description',
  ];
  let idx = -1;
  for (const m of markers) {
    const i = text.indexOf(m);
    if (i >= 0 && (idx < 0 || i < idx)) idx = i;
  }
  if (idx < 0) return ''; // 无 JD 特征，可能不是详情页
  return text.slice(idx, idx + 2500);
}

async function fetchJobDetail(job) {
  const url = String(job.detailUrl || job.url || '');
  if (!url) return { id: job.id, jd: '', ok: false, reason: '无详情链接' };

  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--no-proxy-server'],
  });
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36');
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise((r) => setTimeout(r, 3000)); // 等 SPA 渲染
    const body = await page.evaluate(() => (document.body ? document.body.innerText : ''));
    const jd = extractJd(body);
    return { id: job.id, jd, ok: !!jd, reason: jd ? '' : '详情页无 JD 正文' };
  } catch (e) {
    return { id: job.id, jd: '', ok: false, reason: e.message };
  } finally {
    await browser.close();
  }
}

// 批量抓取（并发受限；单个失败不阻断整体）
async function fetchJobDetails(jobs, { concurrency = 3 } = {}) {
  const out = [];
  for (let i = 0; i < jobs.length; i += concurrency) {
    const group = jobs.slice(i, i + concurrency);
    const groupResults = await Promise.all(group.map((j) => fetchJobDetail(j)));
    out.push(...groupResults);
  }
  return out;
}

module.exports = { fetchJobDetail, fetchJobDetails, extractJd };
