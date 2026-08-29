'use strict';
// 通用探测脚本：加载招聘站点，抓 API + 渲染结构 + 岗位线索
// 用法: node probe.js <url> [等待秒数]
const puppeteer = require('C:/Users/chenduanfa/job-star/job-hunter/node_modules/puppeteer-core');

(async () => {
  const url = process.argv[2];
  const waitSec = Number(process.argv[3] || 9);
  if (!url) { console.error('用法: node probe.js <url> [wait秒]'); process.exit(1); }

  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: 'new', args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36');

  const apiCalls = [];
  page.on('request', (req) => {
    const u = req.url();
    if (/position|job|list|recruit|campus|school/i.test(u) && !/\.(js|css|png|jpg|svg|ico)/.test(u)) {
      apiCalls.push({ m: req.method(), url: u.slice(0, 200), body: (req.postData() || '').slice(0, 200) });
    }
  });
  // 拦截响应：找出哪个请求返回了岗位数据
  page.on('response', async (res) => {
    try {
      const ct = res.headers()['content-type'] || '';
      if (!/json|text/i.test(ct)) return;
      const text = await res.text();
      if (text.length > 500 && /position_list_item|positionName|jobTitle|岗位职责/.test(text)) {
        console.log(`>>> 岗位数据响应: [${res.status()}] ${res.url().slice(0, 180)}`);
        console.log(`    内容前 300 字: ${text.slice(0, 300).replace(/\s+/g, ' ')}`);
      }
    } catch {}
  });

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await new Promise(r => setTimeout(r, waitSec * 1000));

  const info = await page.evaluate(() => {
    const bt = document.body.innerText || '';
    return {
      finalUrl: location.href.slice(0, 150),
      title: document.title,
      textLen: bt.length,
      text: bt.slice(0, 1500),
      jobLinks: Array.from(document.querySelectorAll('a[href]'))
        .map(a => ({ t: (a.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40), h: a.getAttribute('href') || '' }))
        .filter(l => /position|job|detail|campus|school/i.test(l.h + l.t))
        .slice(0, 12),
      classes: [...new Set(Array.from(document.querySelectorAll('[class]')).map(el => (el.className || '').toString().split(/\s+/)[0]).filter(c => /position|job|list|item/i.test(c)))].slice(0, 20),
    };
  });

  console.log('URL:', info.finalUrl);
  console.log('title:', info.title, '| 正文长度:', info.textLen);
  console.log('正文:', info.text.replace(/\n+/g, ' | ').slice(0, 1200));
  console.log('\n岗位链接:');
  info.jobLinks.forEach(l => console.log(`  [${l.t}] -> ${l.h}`));
  console.log('\n相关 class:', info.classes.join(', '));
  console.log('\nAPI 调用:');
  const seen = new Set();
  apiCalls.forEach(c => {
    const key = c.m + c.url + c.body;
    if (seen.has(key)) return;
    seen.add(key);
    console.log(`[${c.m}] ${c.url}${c.body ? '\n  body: ' + c.body : ''}`);
  });
  await browser.close();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
