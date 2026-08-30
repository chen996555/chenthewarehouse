'use strict';
/**
 * HAR 解析器：读浏览器导出的 HAR → 提取「适配器情报」
 *
 * 从 HAR 里自动分类 + 提取各层接口信息：
 *   search  — 岗位搜索/列表接口（URL + 搜索字段 + 响应字段）
 *   detail  — 岗位详情接口（URL + 岗位 ID 字段）
 *   apply   — 投递提交接口（URL + 投递参数）
 *   resume  — 简历上传/解析接口
 *   auth    — 登录/认证接口
 *   limit   — 投递限制检查接口
 *
 * 用法：node har_parser.js <har文件路径>
 * 输出：适配器情报 JSON（作为适配器/数据层/投递层配置的逆向数据源）
 */

const fs = require('node:fs');

// 判断是否第三方/静态/埋点请求（排除）
function isNoise(url) {
  if (/\.(png|jpg|jpeg|gif|svg|css|js|woff2?|mp4|ico|webp|ttf|map)(\?|$)/i.test(url)) return true;
  if (/hm\.baidu|google|doubleclick|aliyuncs|cloudauth|captcha|gt\.cn|cnzz|tongji|beacon/.test(url)) return true;
  return false;
}

// 启发式分类接口（后续有问题再调阈值）
function classify(url, method, body) {
  const u = url.toLowerCase();
  if (/delivery|submit|save.*application|application.*(save|submit)|flow.*(save|submit)/.test(u) && method === 'POST') return 'apply';
  if (/resume.*(upload|parse|save)|upload.*resume|attachment.*(upload|save)/.test(u)) return 'resume';
  if (/limit|applicant.*check|check.*applicant|canApply/.test(u)) return 'limit';
  // detail：单数 job（/job 结尾或 /job?），且 body 含精确 "jobId":（非 jobIdTopList）
  if (/\/job($|\?)/.test(u) && /"jobId"\s*:/.test(body)) return 'detail';
  // search：复数 jobs / 分组 / 部门 / 列表
  if (/\/jobs(\/|\?)|group-by-job|departments|position.*(page|search|list)/.test(u)) return 'search';
  if (/login|auth|oauth|sso|token/.test(u)) return 'auth';
  return null;
}

// 从请求体 JSON 里提取「搜索字段」（keyword/positionName/key/name 等）
function findKeywordField(body) {
  try {
    const j = JSON.parse(body);
    const keys = Object.keys(j);
    const hit = keys.find((k) => /keyword|positionname|positionName|^key$|^name$|search/.test(k));
    return hit ? { field: hit, value: j[hit] } : null;
  } catch { return null; }
}

function parseHar(filePath) {
  const har = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const entries = (har.log && har.log.entries) || [];

  const apis = entries.filter((e) => {
    const url = (e.request && e.request.url) || '';
    return /^https?:\/\//.test(url) && !isNoise(url);
  });

  // host 取出现最多的（排除 sso/oauth 等认证跳转域）
  const hostCount = {};
  for (const e of apis) {
    try { const h = new URL(e.request.url).host; if (!/account\.|oauth|mokahr\.com\/eco/.test(e.request.url)) hostCount[h] = (hostCount[h] || 0) + 1; } catch {}
  }
  const host = (Object.entries(hostCount).sort((a, b) => b[1] - a[1])[0] || [''])[0];

  const intel = { host, totalRequests: entries.length, apiCount: apis.length, search: [], detail: [], apply: [], resume: [], auth: [], limit: [] };

  for (const e of apis) {
    const req = e.request || {};
    const url = req.url || '';
    const method = req.method || '';
    const body = (req.postData && req.postData.text) || '';
    const resText = (e.response && e.response.content && e.response.content.text) || '';

    const category = classify(url, method, body);
    if (!category) continue;

    const item = { method, url: url.split('?')[0], status: (e.response || {}).status };
    if (body) item.body = body.slice(0, 800);
    if (resText && resText.length < 800) item.resSample = resText.slice(0, 500);

    if (category === 'search') {
      const kw = findKeywordField(body);
      if (kw) item.keywordField = kw.field;
    }
    intel[category].push(item);
  }

  return intel;
}

module.exports = { parseHar };

if (require.main === module) {
  const file = process.argv[2];
  if (!file) { console.error('用法: node har_parser.js <har文件路径>'); process.exit(1); }
  const intel = parseHar(file);
  console.log('===== 适配器情报 =====');
  console.log(`host: ${intel.host} | 总请求 ${intel.totalRequests} | API ${intel.apiCount}`);
  for (const [cat, list] of Object.entries(intel)) {
    if (cat === 'host' || cat === 'totalRequests' || cat === 'apiCount') continue;
    if (!list.length) continue;
    console.log(`\n【${cat}】${list.length} 个`);
    for (const it of list.slice(0, 5)) {
      console.log(`  ${it.method} ${it.url}${it.keywordField ? `  [搜索字段=${it.keywordField}]` : ''}`);
      if (it.body) console.log(`    请求体: ${it.body.slice(0, 200)}`);
      if (it.resSample) console.log(`    响应: ${it.resSample.slice(0, 200)}`);
    }
  }
}
