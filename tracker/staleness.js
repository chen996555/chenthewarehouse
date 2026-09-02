'use strict';
/**
 * 求职星计划 — 下架识别（staleness）
 *
 * 定期全量抓取一家公司，对比数据库的 job_id 集合，识别「数据库有、官网已没有」的下架岗位。
 * 注意：必须用「全量抓」（无关键词）才能判定下架；日常分层搜索（关键词精准）抓不全，不能判下架。
 */

const db = require('./db');
const companies = require('./companies');
const { scrapeCompany } = require('./scan');

// 检测一家公司的下架岗位
async function detectStale({ companyName, section = 'campus', keyword = '' } = {}) {
  const company = companies.COMPANIES.find((c) => c.name === companyName);
  if (!company) throw new Error(`未找到公司 ${companyName}`);

  const res = await scrapeCompany(company, { section, keyword });
  const onlineIds = new Set((res.jobs || []).map((j) => String(j.id || '')).filter(Boolean));

  const dbc = db.getDb();
  const dbRows = dbc.prepare('SELECT id, title, job_id, status FROM applications WHERE company = ? AND job_id != ?').all(companyName, '');
  dbc.close();

  const stale = dbRows.filter((r) => !onlineIds.has(r.job_id));
  return { company: companyName, onlineCount: onlineIds.size, dbCount: dbRows.length, stale };
}

// 检测所有已点亮公司（全量抓，耗时；按 group 过滤是分类重构前的历史遗留，会漏掉非互联网组）
async function detectAllStale({ section = 'campus' } = {}) {
  const results = [];
  const targets = companies.COMPANIES.filter((c) => c.adapter);
  for (const c of targets) {
    try {
      const r = await detectStale({ companyName: c.name, section });
      results.push({ company: c.name, ...r });
    } catch (e) {
      results.push({ company: c.name, error: e.message });
    }
  }
  return results;
}

module.exports = { detectStale, detectAllStale };

// 命令行：node staleness.js [公司名]  不传则检测所有已点亮公司
if (require.main === module) {
  const name = process.argv[2] || '';
  const run = name ? detectStale({ companyName: name }) : detectAllStale({});
  Promise.resolve(run)
    .then((results) => {
      const list = Array.isArray(results) ? results : [results];
      console.log('===== 下架识别 =====');
      for (const r of list) {
        if (r.error) { console.log(`\n${r.company}: ✗ ${r.error}`); continue; }
        console.log(`\n${r.company}: 官网 ${r.onlineCount} 个 | 库中 ${r.dbCount} 个 | 下架 ${r.stale.length} 个`);
        for (const s of r.stale) {
          console.log(`  ✗ [${s.status}] ${s.title} (job_id=${s.job_id})`);
        }
      }
    })
    .catch((e) => { console.error('ERR:', e.message); process.exit(1); });
}
