'use strict';
// 求职星计划 — 全流程批量跑（v2：并发抓取 + 投递类型筛选）
// 用法: node batch-search.js [formal|intern|all] [fineCap]
//   例: node batch-search.js formal     # 只打校招正式岗
//       node batch-search.js all 10     # 全量，精排上限 10

const BASE = 'http://127.0.0.1:8630';

async function api(path, options) {
  const res = await fetch(BASE + path, options);
  if (!res.ok) throw new Error(`${path} HTTP ${res.status}: ${await res.text()}`);
  if (res.status === 204) return null;
  return res.json();
}

const post = (path, body) =>
  api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// 目标公司（Puppeteer 适配器的标注 slow:true，限制并发数）
const TARGETS = [
  { name: '美团', keyword: '采购', slow: false },
  { name: '字节跳动', keyword: '采购', slow: true },
  { name: '小米', keyword: '采购', slow: true },
  { name: '腾讯', keyword: '采购', slow: false },
  { name: '京东', keyword: '采购', slow: false },
  { name: '商汤', keyword: '采购', slow: true },
  { name: '得物', keyword: '采购', slow: true },
  { name: '网易', keyword: '', slow: false },
  { name: '阿里巴巴', keyword: '', slow: false },
  { name: '米哈游', keyword: '', slow: false },
];

const PROC_KW = /采购|供应链|寻源|供应商|招标|商务|履约|品类/;

async function scrapeOne(t) {
  try {
    const r = await post('/api/scrape', { name: t.name, section: 'campus', keyword: t.keyword });
    let jobs = r.jobs || [];
    if (!t.keyword) jobs = jobs.filter((j) => PROC_KW.test(j.title));
    console.log(`  ${t.name}: 抓取 ${r.count} → 采购相关 ${jobs.length}`);
    return jobs.map((j) => ({ ...j, company: t.name }));
  } catch (e) {
    console.log(`  ${t.name}: 失败 ${e.message}`);
    return [];
  }
}

// 并发池：最多 N 个同时跑
async function pool(items, limit, fn) {
  const out = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

(async () => {
  const typeFilter = process.argv[2] || 'all';
  const fineCap = Number(process.argv[3] || 20);

  console.log(`=== 阶段① 搜索（并发：HTTP 全并行 + Puppeteer 2 并发）类型筛选=${typeFilter} ===`);
  const fast = TARGETS.filter((t) => !t.slow);
  const slow = TARGETS.filter((t) => t.slow);
  const [fastResults, slowResults] = await Promise.all([
    pool(fast, fast.length, scrapeOne),     // HTTP 全并行
    pool(slow, 2, scrapeOne),               // Puppeteer 2 并发
  ]);
  const all = [...fastResults, ...slowResults].flat();
  console.log(`  聚合: ${all.length} 个候选`);

  console.log(`\n=== 阶段② 级联打分（fineCap=${fineCap}）===`);
  const { jobId } = await post('/api/score', { jobs: all, typeFilter, fineCap });
  let task = { status: 'running' };
  for (let i = 0; i < 150 && task.status === 'running'; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    task = await api(`/api/score/status?id=${jobId}`);
    if (task.status === 'running' && i % 3 === 0) console.log(`  打分中… ${i * 5}s`);
  }
  if (task.status !== 'done') { console.log('打分未完成:', JSON.stringify(task).slice(0, 300)); process.exit(1); }
  const s = task.result;

  const strong = s.ranked.filter((j) => j.tier === 'strong');
  const maybe = s.ranked.filter((j) => j.tier === 'maybe');
  const weak = s.ranked.filter((j) => j.tier === 'weak');
  console.log(`\n=== 阶段③ 精投清单（硬过滤淘汰 ${s.hardFiltered}，精排 ${s.aiScored}，另有 ${s.aiSkipped} 个候选未进精排池）===`);
  console.log(`\n💪 建议投（≥70分，${strong.length} 个）:`);
  strong.forEach((j, i) => {
    console.log(`  #${i + 1} [${j.score}分] ${j.company}｜${j.title}`);
    console.log(`     ${j.verdict || ''}${j.suggestion ? ' 💡' + j.suggestion : ''}`);
  });
  console.log(`\n🤔 备选（55-69分，${maybe.length} 个）:`);
  maybe.forEach((j) => console.log(`  [${j.score}分] ${j.company}｜${j.title}`));
  console.log(`\n❌ 不建议（<55分，${weak.length} 个）:`);
  weak.forEach((j) => console.log(`  [${j.score}分] ${j.company}｜${j.title}`));

  console.log('\n=== 阶段④ 导入看板（仅建议投）===');
  let imported = 0;
  for (const j of strong) {
    try {
      await post('/api/applications', {
        company: j.company,
        title: j.title,
        channel: '官网',
        url: j.detailUrl || '',
        city: j.location || '',
        salary: '',
        status: 'pending',
        notes: `打分 ${j.score} | ${j.verdict || ''}`,
        source: '批量搜索',
        jd: j.jd || '',
      });
      imported++;
    } catch {}
  }
  console.log(`已导入 ${imported} 个建议投岗位到看板「待投」列 ✓`);
  console.log('\n全流程完成。');
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
