'use strict';

/**
 * 求职星计划 — ATS 家族自动识别（URL 指纹判家族 + 参数提取 + 生成配置）
 *
 * 目标：把「拿到新公司 → 判它用哪套招聘系统」这个 88.5% 命中的环节自动化。
 * 用法：
 *   node detect-ats.js <公司名> <域名或URL>
 *   node detect-ats.js <完整URL>                        # 自动从 URL 提取参数
 *   node detect-ats.js --verify <公司名> <URL>          # 判家族 + 调适配器探测验证（200 有岗 = 铁证）
 *
 * 输出：判出的 ATS 家族 + 置信度 + 提取的参数 + companies.js 配置片段；
 *       未命中家族 → 输出标准化「下一步探测清单」（对应 PROBING.md Step 2 三招）。
 *
 * 详见 ../PROBING.md（方法论文档）。
 */

const { classifyGroup } = require('./classify');

// ---- URL 指纹规则表（PROBING.md Step 0）-----------------------------------
// test(host) 判家族；extract(url) 从 URL 提取适配器参数
const FINGERPRINTS = [
  {
    family: 'zhiye',
    label: '北森 zhiye',
    api: 'POST {base}/api/Jobad/GetJobAdPageList',
    test: (host) => /\.zhiye\.com$/i.test(host) || /bstatics\.com/i.test(host),
    extract: (url) => {
      const u = new URL(url);
      const sub = u.hostname.replace(/\.zhiye\.com$/i, '');
      // 形如 iflytek.zhiye.com → subdomain；多级如 a.b.zhiye.com 取最右一段
      const subdomain = sub.split('.').pop();
      return { subdomain: subdomain || '' };
    },
    config: (p, name, group) =>
      `  { group: '${group}', name: '${name}', adapter: 'zhiye', subdomain: '${p.subdomain}', path: 'campus/jobs' },`,
  },
  {
    family: 'moka',
    label: 'Moka',
    api: 'POST {base}/api/outer/ats-apply/website/jobs/v2?orgId={org}（AES 加密响应）',
    test: (host) => /mokahr\.com/i.test(host),
    extract: (url) => {
      // app.mokahr.com/campus-recruitment/{org}/{siteId}
      const m = url.match(/mokahr\.com\/([^/]+)\/([^/]+)\/([^/?#]+)/i);
      if (!m) return { org: '', siteId: '', pathPrefix: 'campus-recruitment', base: 'https://app.mokahr.com' };
      return { pathPrefix: m[1], org: m[2], siteId: m[3], base: 'https://app.mokahr.com' };
    },
    config: (p, name, group) =>
      `  { group: '${group}', name: '${name}', adapter: 'moka', moka: { org: '${p.org}', siteId: '${p.siteId}', base: '${p.base}', pathPrefix: '${p.pathPrefix}', section: 'campus' }, url: '${p.base}/${p.pathPrefix}/${p.org}/${p.siteId}' },`,
  },
  {
    family: 'byte',
    label: '飞书 ATSX',
    api: 'POST {base}/api/v1/search/job/posts（需 portal-channel header）',
    test: (host) => /jobs\.feishu\.cn/i.test(host) || /jobs\.f\.mioffice\.cn/i.test(host) || /jobs\.bytedance\.com/i.test(host),
    extract: (url) => {
      const u = new URL(url);
      const base = `${u.protocol}//${u.host}`;
      // channel 从路径提取：/campus/ → campus，/edu/ → edu，/578078/ → 578078
      const m = u.pathname.match(/^\/([^/]+)\/position\//);
      const channel = m ? m[1] : (/\/edu\//.test(u.pathname) ? 'edu' : 'campus');
      return { base, channel };
    },
    config: (p, name, group) => {
      const pathKey = 'campusPath';
      const cp = `/${p.channel}/position/`;
      return `  { group: '${group}', name: '${name}', adapter: 'byte', byte: { base: '${p.base}', ${pathKey}: '${cp}', section: 'campus' }, url: '${p.base}', reach: { type: 'direct', urlTemplate: '${p.base}/${p.channel}/position/{id}/detail' } },`;
    },
  },
  {
    family: 'wecruit',
    label: '北森 Wecruit',
    api: 'POST {base}/wecruit/positionInfo/listPosition/{suiteId}',
    test: (host) => /hotjob\.cn/i.test(host),
    extract: (url) => {
      const m = url.match(/hotjob\.cn\/(SU[0-9a-f]+)/i);
      const suiteId = m ? m[1] : '';
      return { suiteId, base: 'https://wecruit.hotjob.cn' };
    },
    config: (p, name, group) =>
      `  { group: '${group}', name: '${name}', adapter: 'wecruit', suiteId: '${p.suiteId}', url: 'https://wecruit.hotjob.cn', reach: { type: 'direct', urlTemplate: 'https://wecruit.hotjob.cn/${p.suiteId}/pb/detail.html?postId={id}' } },`,
  },
];

// ---- 自研适配器清单（用于提示「已逆过的自研」，避免重复逆）------------------
const SELF_BUILT = [
  'ali', 'ant', 'baidu', 'bili', 'byd', 'ctrip', 'huawei', 'jd', 'ks', 'liauto',
  'mhy', 'mt', 'ne', 'oppo', 'pdd', 'pingan', 'sf', 'tx', 'vivo', 'xhs',
];

// ---- 主识别 ----------------------------------------------------------------

/**
 * 识别一家公司的 ATS 家族
 * @param {string} url 域名或完整 URL
 * @returns {{ family, label, api, params, matched, config } | null}
 */
function detect(url) {
  if (!url) return null;
  const raw = String(url).trim();
  if (!/^https?:\/\//i.test(raw)) url = `https://${raw}`;
  let host;
  try { host = new URL(url).hostname; } catch { host = raw.replace(/^https?:\/\//i, '').split('/')[0]; }

  for (const f of FINGERPRINTS) {
    if (f.test(host)) {
      return {
        family: f.family,
        label: f.label,
        api: f.api,
        params: f.extract(url),
        config: f.config,
        matched: true,
      };
    }
  }
  return { family: null, matched: false };
}

// 输出「未命中」时的标准化下一步探测清单（PROBING.md Step 2）
function nextSteps(name) {
  return [
    `「${name}」未命中 5 套 SaaS 指纹，大概率自研。按成本从低到高试：`,
    '  ① SSR hydration：抓首页 HTML，找 __NEXT_DATA__ / __NUXT__ / __NUXT_DATA__ / __INITIAL_STATE__ / <script type="application/ld+json">（schema.org JobPosting）',
    '  ② JS bundle 静态分析：找 <script src> 下载 JS，grep baseURL / /api/ /position /list /search /query；纯前端路由页解析 webpack loader（c.u=function）映射 chunk',
    '  ③ 开浏览器抓 HAR（node har_capture_cdp.js）→ Network 过滤 Fetch/XHR/JSON，找列表接口 + 详情接口',
    '  判难度阶梯：L0 公开 → L1 cookie → L2 页面参数 → L3 AES → L4 国密（L4 直接暂缓，参考用友大易教训）',
  ];
}

// ---- 验证（--verify）------------------------------------------------------
async function verify(family, params, name) {
  const maxJobs = 1;
  try {
    if (family === 'zhiye') {
      const z = require('./zhiye');
      const r = await z.scrapeZhiye({ subdomain: params.subdomain, section: 'campus', keyword: '', maxJobs, fallbackName: name });
      return (r && r.jobs && r.jobs.length > 0);
    }
    if (family === 'moka') {
      const m = require('./moka');
      const r = await m.scrapeMoka({ org: params.org, siteId: params.siteId, base: params.base, pathPrefix: params.pathPrefix, section: 'campus', keyword: '', maxJobs, fallbackName: name });
      return (r && r.jobs && r.jobs.length > 0);
    }
    if (family === 'byte') {
      const b = require('./byte');
      const r = await b.scrapeByteDance({ section: 'campus', keyword: '', maxJobs, base: params.base, campusPath: `/${params.channel}/position/`, fallbackName: name });
      return (r && r.jobs && r.jobs.length > 0);
    }
    if (family === 'wecruit') {
      const w = require('./wecruit');
      const r = await w.scrapeWecruit({ suiteId: params.suiteId, section: 'campus', keyword: '', maxJobs, fallbackName: name });
      return (r && r.jobs && r.jobs.length > 0);
    }
  } catch (e) {
    return false;
  }
  return false;
}

// ---- CLI -------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const doVerify = args.includes('--verify');
  const rest = args.filter((a) => !a.startsWith('--'));

  let name, url;
  if (rest.length >= 2) { name = rest[0]; url = rest[1]; }
  else if (rest.length === 1) { url = rest[0]; name = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname; }
  else {
    console.log('用法：');
    console.log('  node detect-ats.js <公司名> <域名或URL>');
    console.log('  node detect-ats.js <完整URL>');
    console.log('  node detect-ats.js --verify <公司名> <URL>   # 判家族 + 探测验证');
    process.exit(1);
  }

  const r = detect(url);
  if (!r.matched) {
    console.log(`✗ 未命中 5 套 SaaS 指纹：${url}`);
    console.log('');
    nextSteps(name).forEach((s) => console.log(s));
    if (SELF_BUILT.length) {
      console.log('');
      console.log(`提示：以下自研已逆过（别重复逆）：${SELF_BUILT.join(', ')}`);
    }
    process.exit(0);
  }

  console.log(`✓ 判出 ATS 家族：${r.label}（${r.family}）`);
  console.log(`  接口：${r.api}`);
  console.log(`  提取参数：${JSON.stringify(r.params)}`);
  console.log('');
  console.log('  companies.js 配置片段：');
  console.log(r.config(r.params, name, classifyGroup(name)));

  if (doVerify) {
    console.log('');
    console.log('  探测验证中（maxJobs=1）…');
    const ok = await verify(r.family, r.params, name);
    console.log(ok
      ? `  ✓ 验证通过：端点返回有岗（200），确认是 ${r.label}`
      : `  ✗ 验证失败：端点无岗或参数不对（可能是 subdomain/org/siteId 提取错，或该司还没开对应 section 岗位）`);
  } else {
    console.log('');
    console.log('  提示：加 --verify 可探测验证（200 有岗 = 铁证）。验证通过后用 expand.js 或直接 append 进 companies.js');
  }
}

if (require.main === module) { main().catch((e) => { console.error('失败:', e.message); process.exit(1); }); }

module.exports = { detect, FINGERPRINTS, SELF_BUILT };
