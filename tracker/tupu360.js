'use strict';
/**
 * 求职星计划 — tupu360（图聘360）招聘 SaaS 适配器（纯 HTTP）
 * 覆盖：辉瑞（careersite.tupu360.com/pfizercampus）、西门子（siemens-china.tupu360.com）、
 *       宝马（careersite.tupu360.com/bmw-brilliance），及未来更多用 tupu360 的公司。
 *
 * 机制（实测验证）：
 *   列表接口：POST {base}/{tenant}/position/list（form-urlencoded，type/pageNo/pageSize）
 *             返回 **HTML**（非 JSON），岗位项 <div class="position-item" pid="xxx" recruitment="yyy">
 *   岗位项字段：pid=岗位ID、recruitment=类型、position-name 里 <span class="txt">职位名</span>、
 *              position-extend 里 e-city <span class="txt">工作城市：上海</span> + time 发布于: 日期
 *   详情页：{base}/{tenant}/position/detail?positionId={pid}&recruitmentType={recruitment}（含 position-description JD）
 *
 * recruitment 类型 → section：INTERNSHIPRECRUITMENT=实习、GROUPMANAGEMENTRUITMENT=管培(校招)、OTHERS=社招
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// section 多信号推断：recruitment 字段 + 标题关键词（OTHERS 里也混了实习/校招岗）
function inferSection(recruitment, title) {
  if (recruitment === 'INTERNSHIPRECRUITMENT') return 'intern';
  if (recruitment === 'GROUPMANAGEMENTRUITMENT') return 'campus'; // 管培生属校招
  const t = String(title || '');
  if (/intern|实习/i.test(t)) return 'intern';
  if (/应届|管培|校招|campus/i.test(t)) return 'campus';
  return 'social'; // OTHERS 默认社招
}

function htmlToText(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

// 解析岗位列表 HTML → 岗位数组（兼容 tupu360 两种租户模板）
// 模板 A（辉瑞等，两层嵌套）：外层 <div class="position-item event-vertical" pid="xxx">，职位名在内层 container 的 <span class="txt">
// 模板 B（宝马等，单层）：<div class="position-item"> + <a href="...positionId=xxx">职位名</a>
function parseJobItems(html, base, tenant) {
  const items = [];
  const tenantPath = tenant ? `/${tenant}` : '';

  // 从一段岗位项 HTML 里提取字段（两种模板）
  const extract = (buf) => {
    let pid = '';
    let recruitment = 'OTHERS';
    let title = '';
    let city = '';
    let date = '';
    let detailUrl = '';
    // 模板 A：pid 属性 + span.txt
    const pidAttr = buf.match(/pid="([^"]+)"/);
    if (pidAttr) {
      pid = pidAttr[1];
      recruitment = (buf.match(/recruitment="([^"]+)"/) || [])[1] || 'OTHERS';
      title = htmlToText(((buf.match(/<span class="txt">([^<]+)<\/span>/) || [])[1] || ''));
      city = ((buf.match(/工作城市[：:]\s*([^<\n]+)/) || [])[1] || '').trim();
      date = ((buf.match(/发布于\s*[：:]?\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/) || [])[1] || '');
      detailUrl = `${base}${tenantPath}/position/detail?positionId=${pid}&recruitmentType=${recruitment}`;
    } else {
      // 模板 B：href 里 positionId + a 标签职位名
      const hrefM = buf.match(/href=['"]([^'"]*positionId=([^&'"]+)[^'"]*)['"]/);
      if (hrefM) {
        pid = hrefM[2];
        recruitment = (buf.match(/recruitmentType=([^&'"]+)/) || [])[1] || 'OTHERS';
        title = htmlToText(((buf.match(/<a[^>]*>([^<]+)<\/a>/) || [])[1] || ''));
        city = htmlToText(((buf.match(/class="ele e-city"[^>]*>([^<]+)<\/div>/) || [])[1] || ''));
        detailUrl = hrefM[1].startsWith('http') ? hrefM[1] : base + hrefM[1];
      }
    }
    if (pid && title) {
      items.push({ id: pid, title, location: city, date, section: inferSection(recruitment, title), recruitment, detailUrl, jd: '' });
    }
  };

  // 累积法：遇到「带 pid/positionId 的 block」= 岗位项起点，后续嵌套 block（container）累积进去，直到下一个岗位项
  const blocks = String(html || '').split(/<div class="position-item/).slice(1);
  let buf = '';
  for (const b of blocks) {
    if (/pid="/.test(b) || /positionId=/.test(b)) {
      extract(buf); // 上一个岗位项收尾
      buf = b;
    } else if (buf) {
      buf += b; // 嵌套内容（position-item-container 等）累积到当前岗位项
    }
  }
  extract(buf);
  return items;
}

// 抓一页岗位列表
async function fetchList({ base, tenant, pageNo, pageSize }) {
  const tenantPath = tenant ? `/${tenant}` : '';
  const res = await fetch(`${base}${tenantPath}/position/list`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'User-Agent': UA },
    body: new URLSearchParams({ type: '2', pageNo: String(pageNo), pageSize: String(pageSize) }).toString(),
  });
  if (!res.ok) throw new Error(`tupu360 HTTP ${res.status}`);
  return res.text();
}

// 抓岗位详情（含 JD），供 on-demand 补抓
async function fetchDetail({ base, tenant, pid, recruitment }) {
  const tenantPath = tenant ? `/${tenant}` : '';
  const res = await fetch(`${base}${tenantPath}/position/detail?positionId=${pid}&recruitmentType=${recruitment || 'OTHERS'}`, {
    headers: { 'User-Agent': UA },
  });
  if (!res.ok) return '';
  const html = await res.text();
  const m = html.match(/<div[^>]*position-description[^>]*>([\s\S]*?)<\/div>/);
  return m ? htmlToText(m[1]) : '';
}

/**
 * 抓取 tupu360 岗位
 * @param {string} base   站点基地址（如 https://careersite.tupu360.com 或 https://siemens-china.tupu360.com）
 * @param {string} tenant 租户路径（如 pfizercampus / bmw-brilliance；西门子等自定义域名填空）
 */
async function scrapeTupu360({ base, tenant = '', section = 'campus', maxJobs = 100, fallbackName = '' } = {}) {
  if (!base) throw new Error('缺少 tupu360 base 参数');
  base = String(base).replace(/\/+$/, '');
  tenant = String(tenant || '').replace(/^\/+|\/+$/g, '');
  const cap = Math.min(Math.max(Number(maxJobs) || 100, 10), 300);
  const pageSize = 20;
  const seen = new Set();
  const jobs = [];
  let total = 0;

  for (let pageNo = 1; jobs.length < cap; pageNo++) {
    const html = await fetchList({ base, tenant, pageNo, pageSize });
    // 总数从 positionCount 属性提取
    const countM = html.match(/positionCount="(\d+)"/);
    if (pageNo === 1) total = countM ? Number(countM[1]) : 0;
    const items = parseJobItems(html, base, tenant);
    if (!items.length) break;
    let added = 0;
    for (const it of items) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      jobs.push(it);
      added++;
      if (jobs.length >= cap) break; // 到上限截断
    }
    if (added === 0 || items.length < pageSize || jobs.length >= total) break;
  }

  return {
    company: fallbackName || tenant || base,
    url: `${base}${tenant ? '/' + tenant : ''}/position/index`,
    section,
    totalOnSite: total,
    count: jobs.length,
    jobs,
  };
}

module.exports = { scrapeTupu360, parseJobItems, fetchDetail, inferSection };
