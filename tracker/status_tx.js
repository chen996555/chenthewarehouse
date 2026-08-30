'use strict';
/**
 * 腾讯投递状态同步
 *
 * 抓 getApplyProcess（明文）→ 原始状态存 raw_status（原样 JSON）+ 映射 standard_status + 记录同步时间。
 * 用法：node status_tx.js
 */

const path = require('node:path');
let puppeteer;
try { puppeteer = require('puppeteer-core'); } catch { puppeteer = require('../job-hunter/node_modules/puppeteer-core'); }

const EDGE_PATH = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const USER_DATA_DIR = path.join(__dirname, 'data', 'browser-profile');
const db = require('./db');

// 腾讯状态码 → 标准状态（简单映射，状态码精确含义待前端 JS 逆向/多观察后精确化）
function mapTxStatus(data) {
  const assessment = data.assessmentInfo || {};
  const written = data.writtenTestInfo || {};
  const cur = data.currentStatus || {};
  // 有测评邀请 → 已投递（进入测评环节）
  if (assessment.testAddress) return 'applied';
  // 有笔试地址 → 已投递（进入笔试环节）
  if (written.linkAddr) return 'applied';
  // 其他 → 保持已投（至少已投递）
  return 'applied';
}

async function syncTxStatus() {
  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: false,
    userDataDir: USER_DATA_DIR,
    defaultViewport: null,
    args: ['--no-sandbox', '--disable-gpu', '--start-maximized'],
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36');
  await page.goto('https://join.qq.com/', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await new Promise((r) => setTimeout(r, 3000));

  // 检查登录态（未登录则等用户登录；getUserInfo 未登录返回非 JSON、登录跳转导致导航，都要兜底）
  const checkLogin = () => page.evaluate(async () => {
    try {
      const res = await fetch('/api/v1/user/getUserInfo');
      const text = await res.text();
      return text ? JSON.parse(text) : null;
    } catch { return null; }
  }).catch(() => null);
  let userInfo = await checkLogin();
  let loggedIn = userInfo && userInfo.status === 0 && ((userInfo.data || {}).nickName || (userInfo.data || {}).userId);
  if (!loggedIn) {
    console.log('⚠ 未登录，请在 Edge 窗口登录腾讯（最多等 3 分钟）…');
    for (let i = 0; i < 180; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      userInfo = await checkLogin();
      loggedIn = userInfo && userInfo.status === 0 && ((userInfo.data || {}).nickName || (userInfo.data || {}).userId);
      if (loggedIn) break;
    }
    if (!loggedIn) {
      console.log('仍未登录，请登录后重跑。');
      await browser.close();
      return null;
    }
  }

  // 抓投递状态（getApplyProcess，明文）
  const result = await page.evaluate(async () => {
    const res = await fetch('/api/v1/apply/getApplyProcess');
    return await res.json();
  });
  await browser.close();

  const data = (result && result.data) || null;
  if (!data || !data.positionInfo || !data.positionInfo.applyPositionTxt) {
    console.log('未找到投递记录（getApplyProcess 返回空）。');
    return null;
  }

  const title = data.positionInfo.applyPositionTxt;
  const standard = mapTxStatus(data);
  const syncedAt = new Date().toISOString();

  // 更新数据库：腾讯 + 该岗位
  const dbc = db.getDb();
  const row = dbc.prepare("SELECT id FROM applications WHERE company = '腾讯' AND title = ? LIMIT 1").get(title);
  let updated = false;
  if (row) {
    db.updateApplication(dbc, row.id, {
      raw_status: JSON.stringify(data),
      status: standard,
      status_synced_at: syncedAt,
    });
    updated = true;
  }
  dbc.close();

  console.log('===== 腾讯投递状态同步 =====');
  console.log('投递岗位:', title);
  console.log('标准状态:', standard);
  console.log('原始状态字段:');
  console.log('  currentStatus.status:', data.currentStatus && data.currentStatus.status);
  console.log('  assessmentInfo.status:', data.assessmentInfo && data.assessmentInfo.status, data.assessmentInfo && data.assessmentInfo.testAddress ? '（有测评地址）' : '');
  console.log('  writtenTestInfo.status:', data.writtenTestInfo && data.writtenTestInfo.status);
  console.log('同步时间:', syncedAt);
  console.log(updated ? '已更新数据库' : '⚠ 数据库未找到该岗位（需先导入「待投」）');

  return { title, standard, data, updated };
}

module.exports = { syncTxStatus, mapTxStatus };

if (require.main === module) {
  syncTxStatus().catch((e) => { console.error('失败:', e.message); process.exit(1); });
}
