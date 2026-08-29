'use strict';
// 重扫 url 有问题的公司，用统一数据层（job_id + reach 生成 detailUrl）更新数据库
const { scrapeOne } = require('./scan');
const companies = require('./companies');
const db = require('./db');

// 待更新公司：列表页/无 url 的（navigate 型 + 部分 direct 型重扫）
const TARGETS = [
  { name: '米哈游', keywords: ['采购', '商务'] },
];

function applyReach(job, company) {
  const jobId = String(job.id || job.job_id || '');
  const reach = company.reach || {};
  let detailUrl = job.detailUrl || job.url || '';
  if (reach.type === 'direct' && reach.urlTemplate && jobId) {
    detailUrl = reach.urlTemplate.replace('{id}', jobId);
  } else if (reach.type === 'navigate') {
    detailUrl = reach.entryUrl || detailUrl;
  }
  return { ...job, job_id: jobId, detailUrl };
}

async function updateCompany({ name, keywords }) {
  const c = companies.findCompany(name);
  if (!c) { console.log(`✗ 未找到公司 ${name}`); return; }
  console.log(`\n===== 重扫 ${name} (reach=${(c.reach && c.reach.type) || '未配'}) =====`);
  const jobs = await scrapeOne(c, { section: 'campus', keywords });

  const dbc = db.getDb();
  let updated = 0;
  const matched = new Set();
  for (const raw of jobs) {
    const j = applyReach(raw, c);
    if (!j.job_id) continue; // 无 ID 的跳过（脏数据不进库）
    if (!/采购|供应链|商务|采销|履约|寻源|降本|品类|招标/.test(j.title)) continue;
    // 精确 title 匹配优先
    let r = dbc.prepare('UPDATE applications SET url = ?, job_id = ? WHERE company = ? AND title = ?')
      .run(j.detailUrl, j.job_id, name, j.title);
    // 模糊匹配兜底：核心词（去括号）被数据库标题包含（处理标题加前缀/后缀/括号的变化）
    if (r.changes === 0) {
      const core = j.title.replace(/[（(【\[].*?[)）】\]]/g, '').trim();
      if (core && core.length >= 3) {
        const hit = dbc.prepare('SELECT id FROM applications WHERE company = ? AND status = ? AND title LIKE ?')
          .get(name, 'pending', `%${core}%`);
        if (hit) r = dbc.prepare('UPDATE applications SET url = ?, job_id = ? WHERE id = ?')
          .run(j.detailUrl, j.job_id, hit.id);
      }
    }
    if (r.changes > 0) { updated++; matched.add(j.title); }
  }
  // 输出未匹配到的 pending 岗位（可能标题变了）
  const pending = dbc.prepare('SELECT title, url FROM applications WHERE company = ? AND status = ?').all(name, 'pending');
  const unmatched = pending.filter((p) => !matched.has(p.title) && /采购|供应链|商务|采销|履约|寻源|降本|品类|招标/.test(p.title));
  dbc.close();

  console.log(`  → 更新 ${updated} 个 url + job_id`);
  if (unmatched.length) {
    console.log(`  ⚠ 未匹配到（标题可能已变）：`);
    for (const u of unmatched) console.log(`      ${u.title} | 当前url=${u.url}`);
  }
}

(async () => {
  for (const t of TARGETS) {
    try { await updateCompany(t); } catch (e) { console.error(`✗ ${t.name} 失败：`, e.message); }
  }
})().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
