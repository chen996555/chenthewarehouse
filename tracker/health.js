'use strict';

/**
 * 求职星计划 — 适配器健康基线（health）
 *
 * 每次扫描把「每家公司岗位数 / 成功与否」落盘到 data/scan-health.json，
 * 下次扫描与之对比，检测适配器「静默失效」：
 *   - error：适配器报错（ok=false）
 *   - warn ：岗位数归零 / 暴增(>3x) / 骤降(<20%)，需人工确认是官方变更还是代码调整
 *
 * 首扫无基线，只报 error；从第二次起才有对比告警。
 */

const fs = require('node:fs');
const path = require('node:path');

const HEALTH_PATH = path.join(__dirname, 'data', 'scan-health.json');

// 读上次健康基线
function loadHealth() {
  try {
    return JSON.parse(fs.readFileSync(HEALTH_PATH, 'utf8'));
  } catch {
    return null;
  }
}

// 对比本次 perCompany vs 上次基线，返回 { issues, ownerChanged }
function checkHealth(prev, perCompany, owner, keywordHash) {
  // 画像切换（换人）：旧基线不适用，不对比（避免换人岗位数变化误报「疑似」）
  if (prev && prev.owner && owner && prev.owner !== owner) {
    return { issues: [], ownerChanged: true, from: prev.owner, to: owner };
  }
  // 画像关键词变了（去复合词/换关键词策略）→ 岗位数变化是预期重校准，不对比
  if (prev && prev.keywordHash && keywordHash && prev.keywordHash !== keywordHash) {
    return { issues: [], keywordChanged: true, from: prev.keywordHash, to: keywordHash };
  }
  const issues = [];
  const prevMap = (prev && prev.companies) || {};

  for (const c of perCompany) {
    if (!c.ok) {
      issues.push({ company: c.company, level: 'error', msg: `适配器报错：${c.error}` });
      continue;
    }
    const prevC = prevMap[c.company];
    if (!prevC || !prevC.count) continue; // 无基线或上次本身为 0，不做对比

    // 搜索模式降级：上次关键词精准、本次回退全量 → 关键词搜索失效（比岗位数对比更直接的失效信号）
    if (prevC.searchMode === 'keyword' && c.searchMode === 'fallback') {
      issues.push({ company: c.company, level: 'warn', msg: `关键词搜索失效/未命中（上次 keyword，本次 fallback 全量抓，请排查适配器或画像关键词）` });
      continue; // 降级导致的岗位数暴增是表象，跳过数量对比避免误报「官方变化」
    }

    const ratio = c.count / prevC.count;
    const diff = Math.abs(c.count - prevC.count);
    // 绝对差 >= 5 才告警，避免岗位数少的公司（如快手 2→1）正常波动误报
    if (c.count === 0) {
      issues.push({ company: c.company, level: 'warn', msg: `岗位数归零（上次 ${prevC.count} 个）` });
    } else if (ratio > 2 && diff >= 5) {
      issues.push({ company: c.company, level: 'warn', msg: `岗位数暴增 ${prevC.count} → ${c.count}（${ratio.toFixed(1)}x）` });
    } else if (ratio < 0.5 && diff >= 5) {
      issues.push({ company: c.company, level: 'warn', msg: `岗位数骤降 ${prevC.count} → ${c.count}（${(ratio * 100).toFixed(0)}%）` });
    }
  }
  return { issues, ownerChanged: false };
}

// 保存本次健康基线（只落抓取结果，不落精排；记录 owner 供换人检测）
function saveHealth(perCompany, totalJobs, owner, keywordHash) {
  const companies = {};
  for (const c of perCompany) {
    companies[c.company] = { count: c.count || 0, ok: c.ok, error: c.error || '', searchMode: c.searchMode || '' };
  }
  const data = {
    updated: new Date().toISOString(),
    owner: owner || '',
    keywordHash: keywordHash || '',
    totalJobs,
    companies,
  };
  fs.writeFileSync(HEALTH_PATH, JSON.stringify(data, null, 2), 'utf8');
  return data;
}

module.exports = { loadHealth, checkHealth, saveHealth, HEALTH_PATH };
