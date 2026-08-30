'use strict';

/**
 * 求职星计划 — 扩展落地流水线
 * 输入候选清单 JSON（workflow 搜索结果），生成 companies.js 配置 + 验证接口真实可用。
 * 用法：node expand.js <候选清单.json> [--dry]
 * 候选清单格式：[{ name, ats, subdomain?, org?, siteId?, host?, suiteId?, pathPrefix?, section?, group? }]
 *   ats: zhiye | moka | feishu | wecruit
 */

const fs = require('node:fs');
const path = require('node:path');

function genConfig(c) {
  const group = c.group || '互联网';
  switch (c.ats) {
    case 'zhiye':
      return `  { group: '${group}', name: '${c.name}', adapter: 'zhiye', subdomain: '${c.subdomain}', path: 'campus/jobs' },`;
    case 'moka': {
      const pfx = c.pathPrefix || 'campus-recruitment';
      return `  { group: '${group}', name: '${c.name}', adapter: 'moka', moka: { org: '${c.org}', siteId: '${c.siteId}', base: 'https://app.mokahr.com', pathPrefix: '${pfx}', section: '${c.section || 'campus'}' }, url: 'https://app.mokahr.com/${pfx}/${c.org}/${c.siteId}' },`;
    }
    case 'feishu': {
      const host = c.host || `${c.subdomain}.jobs.feishu.cn`;
      const channel = c.pathPrefix || 'campus';
      const cp = `/${channel}/position/`;
      const section = c.section || 'campus';
      const pathKey = section === 'social' ? 'socialPath' : 'campusPath';
      const detail = `https://${host}/${channel}/position/{id}/detail`;
      return `  { group: '${group}', name: '${c.name}', adapter: 'byte', byte: { base: 'https://${host}', ${pathKey}: '${cp}', section: '${section}' }, url: 'https://${host}', reach: { type: 'direct', urlTemplate: '${detail}' } },`;
    }
    case 'wecruit':
      return `  { group: '${group}', name: '${c.name}', adapter: 'wecruit', suiteId: '${c.suiteId}', url: 'https://wecruit.hotjob.cn', reach: { type: 'direct', urlTemplate: 'https://wecruit.hotjob.cn/${c.suiteId}/pb/detail.html?postId={id}' } },`;
    default:
      return null;
  }
}

// 验证接口真实可用（每类调对应适配器，maxJobs=1 快速探活）
async function verify(c) {
  try {
    if (c.ats === 'zhiye') {
      const z = require('./zhiye');
      const r = await z.scrapeZhiye({ subdomain: c.subdomain, section: 'campus', path: 'campus/jobs', keyword: '', maxJobs: 1, fallbackName: c.name });
      return (r && r.jobs && r.jobs.length > 0);
    }
    if (c.ats === 'moka') {
      const m = require('./moka');
      const r = await m.scrapeMoka({ org: c.org, siteId: c.siteId, base: 'https://app.mokahr.com', pathPrefix: c.pathPrefix, section: c.section || 'campus', keyword: '', maxJobs: 1, fallbackName: c.name });
      return (r && r.jobs && r.jobs.length > 0);
    }
    if (c.ats === 'feishu') {
      const b = require('./byte');
      const host = c.host || `${c.subdomain}.jobs.feishu.cn`;
      const r = await b.scrapeByteDance({ section: c.section || 'campus', keyword: '', maxJobs: 1, base: `https://${host}`, campusPath: c.pathPrefix ? `/${c.pathPrefix}/position/` : '/campus/', socialPath: c.section === 'social' ? (c.pathPrefix ? `/${c.pathPrefix}/position/` : undefined) : undefined, fallbackName: c.name });
      return (r && r.jobs && r.jobs.length > 0);
    }
    if (c.ats === 'wecruit') {
      const w = require('./wecruit');
      const r = await w.scrapeWecruit({ suiteId: c.suiteId, section: c.section || 'campus', keyword: '', maxJobs: 1, fallbackName: c.name });
      return (r && r.jobs && r.jobs.length > 0);
    }
  } catch (e) {
    return false;
  }
  return false;
}

async function main() {
  const file = process.argv[2];
  if (!file) { console.error('用法：node expand.js <候选清单.json>'); process.exit(1); }
  const list = JSON.parse(fs.readFileSync(file, 'utf8'));

  console.log(`\n===== 验证 ${list.length} 家候选 =====`);
  const results = [];
  for (const c of list) {
    const cfg = genConfig(c);
    if (!cfg) { console.log(`  ✗ ${c.name}：未知 ATS（${c.ats}）`); continue; }
    const ok = await verify(c);
    results.push({ ...c, config: cfg, ok });
    console.log(`  ${ok ? '✓' : '✗'} ${c.name}(${c.ats})`);
  }

  const valid = results.filter((r) => r.ok);
  console.log(`\n===== 有效 ${valid.length}/${results.length} 家，companies.js 配置片段 =====`);
  for (const r of valid) console.log(r.config);
  console.log('\n===== 无效/需排查 =====');
  for (const r of results.filter((r) => !r.ok)) console.log(`  ${r.name}(${r.ats})`);

  // 有效配置写入文件，供 append 到 companies.js
  const out = valid.map((r) => r.config).join('\n');
  fs.writeFileSync('_valid_configs.txt', out, 'utf8');
  console.log(`\n已写入 _valid_configs.txt（${valid.length} 条配置）`);
}

main().catch((e) => { console.error('失败:', e.message); process.exit(1); });
