'use strict';

/**
 * 求职星计划 — 适配器冒烟自检（smoke）
 *
 * 遍历互联网组公司，每家只抓少量岗位（maxJobs=5）验证适配器是否还活着，
 * 主动发现「官方改接口/改字段」导致的失效，无需跑完整扫描、不花精排 API。
 *
 * 用法：
 *   node smoke.js            # 命令行直接跑
 *   POST /api/smoke          # 看板可加「自检」按钮
 *
 * 结果三态：
 *   ✓ alive  接口通 + 抓到岗位
 *   ○ empty  接口通但 0 岗位（可能是真实 0 岗，如爱奇艺校招未开放；需结合健康基线判断）
 *   ✗ dead   适配器抛错（明确失效）
 */

const { scrapeCompany, targetCompanies } = require('./scan');

async function smokeAll({ maxJobs = 5, concurrency = 4 } = {}) {
  const targets = targetCompanies();
  const results = [];
  for (let i = 0; i < targets.length; i += concurrency) {
    const group = targets.slice(i, i + concurrency);
    const groupResults = await Promise.all(
      group.map(async (c) => {
        try {
          const res = await scrapeCompany(c, { section: 'campus', maxJobs });
          const count = (res.jobs || []).length;
          const total = res.totalOnSite || 0;
          return { company: c.name, adapter: c.adapter, state: count > 0 || total > 0 ? 'alive' : 'empty', count, total };
        } catch (e) {
          return { company: c.name, adapter: c.adapter, state: 'dead', error: e.message };
        }
      })
    );
    results.push(...groupResults);
  }
  return results;
}

module.exports = { smokeAll };

// 命令行直接跑：node smoke.js
if (require.main === module) {
  smokeAll({})
    .then((results) => {
      console.log('\n===== 适配器冒烟自检 =====');
      const tag = { alive: '✓', empty: '○', dead: '✗' };
      for (const r of results) {
        const suffix = r.state === 'dead' ? `：${r.error}` : r.state === 'empty' ? '（0 岗位，疑似）' : `（${r.count} 个）`;
        console.log(`  ${tag[r.state]} ${r.company}${suffix}`);
      }
      const alive = results.filter((r) => r.state === 'alive').length;
      const dead = results.filter((r) => r.state === 'dead').length;
      const empty = results.filter((r) => r.state === 'empty').length;
      console.log(`\n存活 ${alive}/${results.length}，空 ${empty}，失效 ${dead}`);
      if (dead) process.exit(1);
    })
    .catch((e) => { console.error('自检失败：', e.message); process.exit(1); });
}
