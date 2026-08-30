'use strict';
/**
 * 大疆投递状态同步（从 HAR 解析）
 *
 * 大疆投递查询依赖「手机短信验证码 code + 网易易盾行为验证 YDValidate」，无法全自动。
 * 落地方式：用户在浏览器「投递查询」页完成验证 → F12 导出 HAR → 本脚本解析。
 *
 * 核心接口：POST https://apply.careers.dji.com/api/deliver-query
 *   请求体：{ orgId:"dji", phone, code(短信验证码), YDValidate(易盾行为验证 token), language:"zh-CN" }
 *   响应（明文，无需解密）：data.data.applications = [{ id, jobTitle, location, applied_at, deliverTime, stage }]
 *   stage 取值：评估中 / 笔试 / 面试 / Offer 等（中文描述）
 *
 * 用法：node status_dji.js <har文件路径>
 * 例：node status_dji.js "C:/Users/chenduanfa/Downloads/大疆5apply.careers.dji.com.har"
 */

const fs = require('node:fs');
const db = require('./db');

// stage（中文阶段描述）→ 统一标准状态
function mapStage(stage) {
  const s = String(stage || '');
  if (/offer|录用|待入职|入职/i.test(s)) return 'offer';
  if (/结束|淘汰|拒|不合适|暂不考虑|已过期|失效/i.test(s)) return 'rejected';
  if (/面试/i.test(s)) return 'interview';
  if (/笔试|测评|测试/i.test(s)) return 'replied'; // 有回复（进入测评/笔试环节）
  // 评估中 / 筛选 / 简历 / 待安排 / 其他 → 已投递（在流程中）
  return 'applied';
}

function parseHar(harPath) {
  const har = JSON.parse(fs.readFileSync(harPath, 'utf8'));
  // 找最后一次成功的 deliver-query 响应（含 applications 的）
  const entries = har.log.entries.filter((e) => /api\/deliver-query$/.test(e.request.url));
  let apps = null;
  for (const e of entries) {
    try {
      const j = JSON.parse(e.response.content.text);
      const inner = j && j.data && j.data.data;
      if (inner && Array.isArray(inner.applications)) {
        apps = inner.applications;
        break; // 取第一个成功含 applications 的响应
      }
    } catch {}
  }
  if (!apps) {
    console.log('未在 HAR 中找到投递记录（deliver-query 响应里无 applications，可能验证未通过）。');
    return null;
  }
  return apps;
}

function syncDjiStatus(harPath) {
  const apps = parseHar(harPath);
  if (!apps) return null;

  console.log(`===== 大疆投递状态同步 =====`);
  console.log(`投递记录 ${apps.length} 条`);
  const syncedAt = new Date().toISOString();
  const dbc = db.getDb();
  let updated = 0;

  for (const a of apps) {
    const title = String(a.jobTitle || '').trim();
    const stage = String(a.stage || '');
    const standard = mapStage(stage);
    console.log(`  - ${title || '(无岗位名)'} | ${a.location || ''} | stage=${stage} | 投递=${a.deliverTime || a.applied_at || ''}`);

    if (!title) continue;
    // 匹配数据库岗位（公司=大疆 + 标题），先精确后模糊（去掉括号城市后缀）
    let row = dbc.prepare("SELECT id FROM applications WHERE company = '大疆' AND title = ? LIMIT 1").get(title);
    if (!row) {
      const prefix = title.replace(/[（(][^）)]*[）)]$/, '').trim();
      if (prefix && prefix !== title) {
        row = dbc.prepare("SELECT id FROM applications WHERE company = '大疆' AND title LIKE ? LIMIT 1").get(prefix + '%');
      }
    }
    if (row) {
      db.updateApplication(dbc, row.id, {
        raw_status: JSON.stringify(a),
        status: standard,
        status_synced_at: syncedAt,
      });
      updated++;
    } else {
      console.log('    ↳ 未匹配到数据库岗位（跳过）');
    }
  }
  dbc.close();
  console.log(`已更新 ${updated} 条数据库记录`);
  return { apps, updated };
}

module.exports = { syncDjiStatus, parseHar, mapStage };

if (require.main === module) {
  const harPath = process.argv[2];
  if (!harPath) { console.error('用法：node status_dji.js <har文件路径>'); process.exit(1); }
  syncDjiStatus(harPath);
}
