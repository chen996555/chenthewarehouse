'use strict';
// 分析字节投递表单 57 字段的完整构成
const path = require('node:path');
let puppeteer;
try { puppeteer = require('puppeteer-core'); } catch { puppeteer = require('../job-hunter/node_modules/puppeteer-core'); }
const EDGE_PATH = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PROFILE = path.join(__dirname, 'data', 'edge-debug');
const JOB_ID = '7678582526983194885';

async function main() {
  const browser = await puppeteer.launch({ executablePath: EDGE_PATH, headless: false, userDataDir: PROFILE, defaultViewport: null, args: ['--no-sandbox', '--disable-gpu'] });
  const page = (await browser.pages())[0] || (await browser.newPage());
  await page.goto(`https://jobs.bytedance.com/campus/resume/${JOB_ID}/apply`, { waitUntil: 'networkidle2', timeout: 90000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 6000));

  const result = await page.evaluate(() => {
    const af = window.JobStarAutofill;
    if (!af) return { err: '页面无 JobStarAutofill（扩展未注入，改用内置逻辑）' };
    // 扩展没注入就用内置逻辑：这里直接内联 signalOf/matchField 简化版
    return null;
  });

  // 用 tracker/autofill.js 的逻辑在页面里跑（fill:false）
  const af = require('./autofill');
  const profile = JSON.parse(require('node:fs').readFileSync(path.join(__dirname, 'data', 'profile.json'), 'utf8'));
  const values = af.profileToValues(profile);
  const r = await af.scanAndFill(page, values, { fill: false });

  console.log(`字段总数 ${r.detected.length} | 命中 ${r.detected.filter(d => d.key).length} | 未命中 ${r.unmatched.length} | 日期 ${r.dateFields.length}\n`);
  console.log('===== 未识别字段（unmatched）=====');
  for (const u of r.unmatched) console.log(`  [${u.tag}/${u.type}] ${u.signal}`);
  console.log('\n===== 日期字段（跳过）=====');
  for (const d of r.dateFields) console.log(`  ${d.key}: ${d.signal}`);
  await browser.disconnect();
}
main().catch((e) => { console.error('失败:', e.message); process.exit(1); });
