'use strict';

/**
 * 求职星计划 — 定时全量预抓（提效 · 面向大众）
 * 每天凌晨跑一次，把全部公司的「全量岗位」抓进缓存（jobs-cache.json，TTL 24h）。
 * 用户点「推荐」时命中缓存，按自己的画像关键词本地召回（不调官网），秒出结果。
 *
 * 关键：抓「全量」（不带任何行业关键词），产品面向大众，不同画像用户各取所需，
 *       而不是只预抓某个方向（采购/供应链）的关键词结果。
 *
 * 用法：node prefetch.js（crontab 每天凌晨跑）
 */

const scan = require('./scan');

async function prefetch() {
  const t0 = Date.now();
  const targets = scan.targetCompanies();
  const maxJobs = 200; // 全量抓取上限（覆盖多数公司的在招岗位）
  console.log(`全量预抓开始：${targets.length} 家公司，每家中上限 ${maxJobs} 岗`);

  let ok = 0;
  let fail = 0;
  const concurrency = 20;
  for (let i = 0; i < targets.length; i += concurrency) {
    const group = targets.slice(i, i + concurrency);
    const rs = await Promise.all(group.map(async (c) => {
      try {
        // 不带 keyword = 全量抓；scrapeCompanyCached 会自动写缓存（key 含空 keyword）
        const result = await scan.scrapeCompanyCached(c, { section: 'campus', maxJobs });
        const n = (result && result.jobs && result.jobs.length) || 0;
        return { name: c.name, ok: n > 0, count: n };
      } catch {
        return { name: c.name, ok: false };
      }
    }));
    for (const r of rs) { if (r.ok) ok++; else fail++; }
    console.log(`  进度 ${Math.min(i + concurrency, targets.length)}/${targets.length}（有岗 ${ok} 失败/空 ${fail}）`);
  }

  console.log(`全量预抓完成：有岗 ${ok}/${targets.length}，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

prefetch().catch((e) => { console.error('预抓失败：', e.message); process.exit(1); });
