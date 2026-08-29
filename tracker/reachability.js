'use strict';
/**
 * 求职星计划 — 可达性抽样（验证 URL 模板是否失效）
 *
 * 对 direct 型岗位，抽样打开 url，判断是否是「正常岗位详情页」（而非 404 / 列表页 / 空数据）。
 * 作为「确定档（URL 模板）」变化的验证信号：可达率骤降 = 官网改版导致模板失效。
 */

const db = require('./db');
const companies = require('./companies');

let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = require('../job-hunter/node_modules/puppeteer-core'); }

const EDGE_PATH = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

// 判断一个 url 打开后是否是「正常岗位详情页」
async function probeUrl(page, url) {
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
  } catch {
    return { ok: false, reason: '加载失败/超时' };
  }
  await new Promise((r) => setTimeout(r, 8000));
  return await page.evaluate(() => {
    const body = document.body ? document.body.innerText : '';
    // 失败特征：404 / 页面不存在 / 空数据
    if (/页面不存在|404|Not Found|找不到|您正在寻找/.test(body)) return { ok: false, reason: '404/页面不存在' };
    const hasApply = Array.from(document.querySelectorAll('button, a')).some((b) => /投递|申请|apply/i.test(b.innerText || ''));
    const hasDesc = /职位描述|岗位描述|职位要求|任职要求|工作职责|工作内容|岗位职责|岗位要求/.test(body) && body.length > 200;
    if (hasApply) return { ok: true, reason: '有投递按钮' };
    if (hasDesc) return { ok: true, reason: '有职位描述' };
    return { ok: false, reason: '无投递/描述（疑似列表页或空数据）' };
  }).catch(() => ({ ok: false, reason: '页面解析失败' }));
}

// 抽样验证：每家公司抽 sample 个 direct 型 url，返回可达率 + 失败明细
async function sampleReachability({ sample = 3, companyFilter } = {}) {
  const dbc = db.getDb();
  // direct 型：公司 reach.type 为 direct（或无 reach 默认 direct），且 url 非空
  const companyMap = new Map(companies.COMPANIES.map((c) => [c.name, c]));
  const rows = dbc.prepare("SELECT company, title, url, job_id FROM applications WHERE url != '' AND status != 'rejected'").all();
  dbc.close();

  const byCompany = {};
  for (const r of rows) {
    const c = companyMap.get(r.company);
    if (!c) continue;
    const reach = c.reach || {};
    if (reach.type === 'navigate') continue; // navigate 型本就列表页，跳过
    if (companyFilter && r.company !== companyFilter) continue;
    (byCompany[r.company] ||= []).push(r);
  }

  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH, headless: 'new', args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36');

  const results = []; // {company, ok, fail, detail:[]}
  for (const [company, list] of Object.entries(byCompany)) {
    const picks = list.slice(0, sample);
    let ok = 0;
    const detail = [];
    for (const r of picks) {
      const probe = await probeUrl(page, r.url);
      if (probe.ok) ok++;
      detail.push({ title: r.title, url: r.url, ...probe });
    }
    results.push({ company, ok, total: picks.length, detail });
  }

  await browser.close();
  return results;
}

module.exports = { sampleReachability, probeUrl };

// 命令行：node reachability.js [公司名]
if (require.main === module) {
  const filter = process.argv[2] || '';
  sampleReachability({ companyFilter: filter })
    .then((results) => {
      console.log('===== 可达性抽样结果 =====');
      let totalOk = 0; let totalN = 0;
      for (const r of results) {
        totalOk += r.ok; totalN += r.total;
        const rate = r.total ? Math.round((r.ok / r.total) * 100) : 0;
        console.log(`\n${r.company}: ${r.ok}/${r.total} (${rate}%)`);
        for (const d of r.detail) {
          if (!d.ok) console.log(`  ✗ ${d.title.slice(0, 24)} | ${d.reason} | ${d.url.slice(0, 70)}`);
        }
      }
      console.log(`\n总计可达率: ${totalOk}/${totalN} (${totalN ? Math.round((totalOk / totalN) * 100) : 0}%)`);
    })
    .catch((e) => { console.error('ERR:', e.message); process.exit(1); });
}
