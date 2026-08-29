'use strict';
let puppeteer;
try { puppeteer = require('puppeteer-core'); } catch { puppeteer = require('../job-hunter/node_modules/puppeteer-core'); }

(async () => {
  const b = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--no-proxy-server'] });
  const page = await b.newPage();
  const keywords = [];
  const posts = [];
  page.on('response', (res) => {
    if (res.url().includes('search/job/posts')) {
      keywords.push(res.url().match(/keyword=([^&]*)/)?.[1] || '');
      res.text().then((t) => {
        try { const j = JSON.parse(t); const list = (j.data && j.data.job_post_list) || []; list.forEach((p) => posts.push(p.title || p.position_name || p.name)); } catch {}
      });
    }
  });
  await page.goto('https://jobs.bytedance.com/campus/position', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 8000));

  const input = await page.$('input[placeholder*="搜索"]');
  await input.focus();
  await page.evaluate((kw) => {
    const el = document.querySelector('input[placeholder*="搜索"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, kw);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, '采购经营');
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 8000));

  console.log('请求的 keyword 值:', JSON.stringify(keywords));
  console.log('返回的岗位标题（含「采购」）:', JSON.stringify([...new Set(posts)].filter((t) => /采购/.test(t))));
  await b.close();
})().catch((e) => console.log('错误:', e.message));
