'use strict';
/**
 * 批量抓招聘官网 HAR，识别 ATS 家族 + 提取参数（suiteId/org/siteId）。
 * 用法：node batch_har.js <域名列表文件>
 * 域名列表文件格式：每行一个"名称|域名"（如 华夏基金|job.chinaamc.com）
 * 前提：Edge 已 --remote-debugging-port=9222 启动。
 */
const fs = require('node:fs');
let puppeteer;
try { puppeteer = require('puppeteer-core'); } catch { puppeteer = require('../job-hunter/node_modules/puppeteer-core'); }

const file = process.argv[2];
if (!file) { console.error('用法：node batch_har.js <域名列表文件>'); process.exit(1); }

async function probe(page, name, domain) {
  const found = [];
  const onReq = (req) => {
    const rt = req.resourceType();
    if (!['xhr', 'fetch'].includes(rt)) return;
    const url = req.url();
    if (url.includes('wecruit.hotjob.cn/wecruit/') && /SU[a-f0-9]{20,}/.test(url)) {
      const suiteId = url.match(/SU[a-f0-9]{20,}/)[0];
      if (!found.some((f) => f.suiteId === suiteId)) found.push({ ats: 'wecruit', suiteId });
    }
    if (url.includes('mokahr.com') && /app\.mokahr\.com\/[^/]+\/([^/]+)\/(\d+)/.test(url)) {
      const m = url.match(/app\.mokahr\.com\/([^/]+)\/([^/]+)\/(\d+)/);
      if (!found.some((f) => f.org === m[1])) found.push({ ats: 'moka', org: m[1], siteId: m[3] });
    }
    if (url.includes('jobs.feishu.cn')) {
      const host = url.match(/https?:\/\/([^/]+\.jobs\.feishu\.cn)/);
      if (host && !found.some((f) => f.host === host[1])) found.push({ ats: 'feishu', host: host[1] });
    }
  };
  page.on('request', onReq);
  try {
    await page.goto(`https://${domain}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 8000));
  } catch (e) {
    // 超时/错误也继续
  }
  page.off('request', onReq);
  return found;
}

async function main() {
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim());
  const browser = await puppeteer.connect({ browserURL: 'http://localhost:9222', defaultViewport: null });
  const results = [];
  for (const line of lines) {
    const [name, domain] = line.split('|').map((s) => s.trim());
    if (!name || !domain) continue;
    const page = await browser.newPage();
    try {
      const found = await probe(page, name, domain);
      results.push({ name, domain, found });
      console.log(`${name} (${domain}): ${found.length ? JSON.stringify(found) : '未识别（自研/其他）'}`);
    } catch (e) {
      console.log(`${name} (${domain}): 抓取失败 ${e.message.slice(0, 40)}`);
    } finally {
      await page.close();
    }
  }
  await browser.disconnect();
  fs.writeFileSync('_batch_results.json', JSON.stringify(results, null, 2), 'utf8');
  console.log(`\n已写入 _batch_results.json（${results.length} 家）`);
}
main().catch((e) => { console.error('失败:', e.message); process.exit(1); });
