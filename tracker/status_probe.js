'use strict';
/**
 * 投递状态自动逆向：puppeteer 打开「我的投递」页面，拦截投递记录接口。
 * 用法：node status_probe.js <投递记录页URL> [关键词过滤]
 *   - 复用 browser-profile 登录态（之前登录过的公司无需重新登录）
 *   - 拦截所有 XHR/fetch 响应，打印疑似「投递记录/状态」的接口 URL + 响应字段
 * 例：node status_probe.js "https://campus.jd.com/#/myApply"
 */

const path = require('node:path');
let puppeteer;
try { puppeteer = require('puppeteer-core'); } catch { puppeteer = require('../job-hunter/node_modules/puppeteer-core'); }

const EDGE_PATH = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const USER_DATA_DIR = path.join(__dirname, 'data', 'browser-profile');

const url = process.argv[2];
if (!url) { console.error('用法：node status_probe.js <投递记录页URL>'); process.exit(1); }

async function main() {
  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: false,
    userDataDir: USER_DATA_DIR,
    defaultViewport: null,
    args: ['--no-sandbox', '--disable-gpu', '--start-maximized'],
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36');

  // 拦截疑似「投递记录/状态」的接口
  const seen = new Set();
  page.on('response', (res) => {
    const u = res.url();
    if (!/api|apply|delivery|record|myApply|status|flow|process|application/i.test(u)) return;
    if (/\.(js|css|png|jpg|svg|woff|ico)/i.test(u)) return;
    if (seen.has(u)) return;
    seen.add(u);
    res.text().then((t) => {
      let preview = t;
      try { const j = JSON.parse(t); preview = JSON.stringify(j).slice(0, 600); } catch {}
      console.log(`\n[接口] ${res.request().method()} ${u}`);
      console.log(`[响应] ${preview}`);
    }).catch(() => {});
  });

  console.log(`打开 ${url}（如未登录请在浏览器窗口登录）…`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  console.log('已打开，观察上方拦截到的接口。等待 120 秒（期间可登录/翻页/切换投递状态筛选，触发更多接口）…');
  await new Promise((r) => setTimeout(r, 120000));
  await browser.close();
  console.log('\n完成。把上面拦截到的接口发给我，我来逆向字段 + 生成状态同步代码。');
}

main().catch((e) => { console.error('失败:', e.message); process.exit(1); });
