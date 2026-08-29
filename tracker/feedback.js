'use strict';
/**
 * 求职星计划 — 反馈闭环（feedback）
 *
 * 分析「打分(tier/score) vs 投递结果(status)」的对应关系，产出校准信号。
 * 正样本 = 有进展（replied/interview/offer），负样本 = 拒信（rejected）。
 * 核心价值：让打分器随投递越用越准——若某档岗位回复率异常，提示该档打分偏乐观/悲观。
 */

const db = require('./db');

// 分析打分 vs 结果，返回按 tier 分组的回复率报告
function analyzeFeedback() {
  const dbc = db.getDb();
  const rows = dbc.prepare(
    "SELECT tier, score, status FROM applications WHERE status IN ('replied','interview','offer','rejected')"
  ).all();
  dbc.close();

  const byTier = {};
  for (const r of rows) {
    const t = (byTier[r.tier] ||= { total: 0, positive: 0, negative: 0, scores: [] });
    t.total++;
    t.scores.push(r.score || 0);
    if (r.status === 'rejected') t.negative++;
    else t.positive++;
  }

  const report = {};
  for (const [tier, t] of Object.entries(byTier)) {
    report[tier] = {
      投递数: t.total,
      正样本: t.positive,
      负样本: t.negative,
      回复率: t.total ? Math.round((t.positive / t.total) * 100) : 0,
      平均分: t.scores.length ? Math.round(t.scores.reduce((a, b) => a + b, 0) / t.scores.length) : 0,
    };
  }

  // 校准信号：某档回复率异常（过高/过低）时提示
  const signals = [];
  const order = ['A', 'B', 'C', 'D'];
  for (let i = 0; i < order.length; i++) {
    const tier = order[i];
    if (!report[tier] || report[tier].投递数 < 3) continue; // 样本太少不判
    const next = report[order[i + 1]];
    // 高档回复率应 >= 低档（单调性）；违反则说明打分偏了
    if (next && report[tier].回复率 < next.回复率 - 10) {
      signals.push(`${tier} 档回复率(${report[tier].回复率}%)低于 ${order[i + 1]} 档(${next.回复率}%)，打分可能偏乐观`);
    }
  }

  return { report, signals };
}

module.exports = { analyzeFeedback };

// 命令行：node feedback.js
if (require.main === module) {
  const { report, signals } = analyzeFeedback();
  console.log('===== 反馈闭环：打分 vs 投递结果 =====');
  for (const [tier, r] of Object.entries(report)) {
    console.log(`${tier} 档：投递 ${r.投递数} | 正样本 ${r.正样本} | 负样本 ${r.负样本} | 回复率 ${r.回复率}% | 平均分 ${r.平均分}`);
  }
  if (signals.length) {
    console.log('\n校准信号：');
    for (const s of signals) console.log('  ⚠ ' + s);
  } else {
    console.log('\n（暂无校准信号：样本不足或分档单调正常）');
  }
}
