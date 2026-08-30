'use strict';
/**
 * 京东投递状态同步
 *
 * 投递记录接口：GET /api/wx/delivery/officialInfo/list（登录态 + 响应加密）
 * 加密：AES-256-CBC + Pkcs7，key="63ca0d3f90f844928d236e132a1fee45"（UTF-8 32 字节），IV=16 字节 0x00
 * 解密后：投递记录数组 [{ applyStatus, nodeList:[{name,status}], id, positionName?, ... }]
 *   applyStatus：ACTIVE_APPLY=积极应聘 / NOT_CONSIDER=暂不考虑
 * 用法：node status_jd.js
 */

const crypto = require('node:crypto');
const path = require('node:path');
let puppeteer;
try { puppeteer = require('puppeteer-core'); } catch { puppeteer = require('../job-hunter/node_modules/puppeteer-core'); }

const EDGE_PATH = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const USER_DATA_DIR = path.join(__dirname, 'data', 'browser-profile');
const db = require('./db');

const JD_KEY = Buffer.from('63ca0d3f90f844928d236e132a1fee45', 'utf8'); // 32 字节 → AES-256
const JD_IV = Buffer.alloc(16, 0);

function decrypt(body) {
  const enc = Buffer.from(body, 'base64');
  const d = crypto.createDecipheriv('aes-256-cbc', JD_KEY, JD_IV);
  d.setAutoPadding(false);
  const dec = Buffer.concat([d.update(enc), d.final()]);
  // 明文通常无 padding（16 字节对齐）；若有 Pkcs7 尾则去掉
  const last = dec[dec.length - 1];
  const plain = (last >= 1 && last <= 16) ? dec.slice(0, dec.length - last) : dec;
  return JSON.parse(plain.toString('utf8'));
}

// 京东投递记录 → 统一标准状态
// applyStatus（积极应聘/暂不考虑）是用户态度；statusCode（ASSESSMENT/EXAM/STAGE_1/OFFER/ENTRY）才是真实流程进度
function mapStatus(r) {
  if (r.applyStatus === 'NOT_CONSIDER') return 'rejected'; // 暂不考虑（用户主动放弃该志愿）
  const code = String(r.statusCode || '');
  if (code === 'ENTRY' || code === 'OFFER') return 'offer';
  if (code === 'STAGE_1' || code === 'STAGE_2' || code === 'STAGE_3' || code === 'INTERVIEW') return 'interview';
  if (code === 'ASSESSMENT' || code === 'EXAM' || code === 'AI_INTERVIEW') return 'replied'; // 有回复（进入测评/笔试环节）
  // HIGH_SEAS_POOL / INTERVIEW_HIGH_SEAS_POOL / 其他 → 已投递（在流程中）
  return 'applied';
}

async function syncJdStatus() {
  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: false,
    userDataDir: USER_DATA_DIR,
    defaultViewport: null,
    args: ['--no-sandbox', '--disable-gpu', '--start-maximized'],
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36');
  await page.goto('https://campus.jd.com/#/myApply', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await new Promise((r) => setTimeout(r, 3000));

  // 页面上下文 fetch 投递记录（自动带登录态 cookie）
  const result = await page.evaluate(async () => {
    try {
      const res = await fetch('/api/wx/delivery/officialInfo/list', { credentials: 'include' });
      const j = await res.json();
      return { ok: res.status === 200, body: j && j.body, http: res.status };
    } catch (e) { return { ok: false, err: String(e) }; }
  }).catch(() => null);
  await browser.close();

  if (!result || !result.ok) {
    console.log('未获取到投递记录（可能未登录，请先在京东登录后重跑）。');
    return null;
  }
  if (!result.body) {
    console.log('投递记录为空（尚未投递）。');
    return null;
  }

  const records = decrypt(result.body);
  if (!Array.isArray(records)) {
    console.log('解密结果非数组（可能加密 key 已变）：', JSON.stringify(records).slice(0, 200));
    return null;
  }

  console.log(`===== 京东投递状态同步 =====`);
  console.log(`投递记录 ${records.length} 条`);
  const syncedAt = new Date().toISOString();
  const dbc = db.getDb();
  let updated = 0;
  for (const r of records) {
    const p = r.positionDetailVo || {};
    const title = String(p.positionName || r.positionName || r.jobName || r.title || '').trim();
    const standard = mapStatus(r);
    const nodeDesc = (r.nodeList || []).map((n) => `${n.name}:${n.status}`).join(' → ');
    console.log(`  - ${title || '(无岗位名)'} | applyStatus=${r.applyStatus} | 进度=${r.status}(${r.statusCode}) | 节点: ${nodeDesc}`);
    // 匹配数据库岗位（公司=京东 + 标题），更新状态
    if (title) {
      const row = dbc.prepare("SELECT id FROM applications WHERE company = '京东' AND title = ? LIMIT 1").get(title);
      if (row) {
        db.updateApplication(dbc, row.id, {
          raw_status: JSON.stringify(r),
          status: standard,
          status_synced_at: syncedAt,
        });
        updated++;
      }
    }
  }
  dbc.close();
  console.log(`已更新 ${updated} 条数据库记录`);
  return { records, updated };
}

module.exports = { syncJdStatus, decrypt, mapStatus };

if (require.main === module) {
  syncJdStatus().catch((e) => { console.error('失败:', e.message); process.exit(1); });
}
