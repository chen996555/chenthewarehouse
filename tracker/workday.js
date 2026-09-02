'use strict';
/**
 * 求职星计划 — Workday（国际 ATS）适配器（纯 HTTP 公开 JSON）
 * 覆盖：英特尔（intel）、耐克（nike）等用 Workday 招聘系统的外企。
 *
 * 机制（实测验证）：
 *   列表接口：POST https://{tenant}.wd1.myworkdayjobs.com/wday/cxs/{tenant}/External/jobs
 *   body：{ limit, offset, searchText }
 *   响应：{ total, jobPostings: [{ title, externalPath, locationsText, postedOn, bulletFields }] }
 *   详情页：https://{tenant}.wd1.myworkdayjobs.com{externalPath}
 *
 * 注意：Workday 返回的是「全球岗位」（校招/社招混在一起，全球各地），
 *       校招用 searchText 或标题「Early Careers/Intern/Graduate」判断 section。
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// 标题关键词 → section（Workday 无 section 字段，靠标题）
function inferSection(title) {
  const t = String(title || '');
  if (/intern|实习/i.test(t)) return 'intern';
  if (/early careers|graduate|campus|应届|校招|entry level/i.test(t)) return 'campus';
  return 'social';
}

async function fetchPage({ tenant, dc, site, limit, offset, searchText }) {
  const res = await fetch(`https://${tenant}.${dc}.myworkdayjobs.com/wday/cxs/${tenant}/${site}/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ limit, offset, searchText: searchText || '', appliedFacets: {} }),
  });
  if (!res.ok) throw new Error(`Workday HTTP ${res.status}`);
  return res.json();
}

/**
 * 抓取 Workday 岗位
 * @param {string} tenant 租户标识（如 intel、nike）
 * @param {string} keyword 关键词（可选，如 China 过滤中国岗位）
 */
async function scrapeWorkday({ tenant, dc = 'wd1', site = 'External', keyword = '', maxJobs = 100, fallbackName = '' } = {}) {
  if (!tenant) throw new Error('缺少 Workday tenant 参数');
  tenant = String(tenant).toLowerCase();
  const cap = Math.min(Math.max(Number(maxJobs) || 100, 10), 300);
  const pageSize = 20;
  const base = `https://${tenant}.${dc}.myworkdayjobs.com`;
  const seen = new Set();
  const jobs = [];
  let total = 0;

  for (let offset = 0; jobs.length < cap; offset += pageSize) {
    const data = await fetchPage({ tenant, dc, site, limit: pageSize, offset, searchText: keyword });
    if (offset === 0) total = Number(data.total || 0);
    const items = data.jobPostings || [];
    if (!items.length) break;
    for (const it of items) {
      const ext = String(it.externalPath || '');
      const id = (ext.match(/([A-Z]{2,}[0-9]+)$/) || (it.bulletFields || []).find((b) => /^[A-Z]{2,}[0-9]+$/.test(b)) || [])[0] || ext;
      const key = id || it.title;
      if (seen.has(key)) continue;
      seen.add(key);
      jobs.push({
        id,
        title: it.title || '',
        location: it.locationsText || '',
        date: String(it.postedOn || '').replace(/^Posted\s*/i, ''),
        section: inferSection(it.title),
        detailUrl: `${base}${ext}`,
        jd: '', // 列表不带 JD，详情页才有（on-demand）
      });
      if (jobs.length >= cap) break;
    }
    if (offset + pageSize >= total || items.length < pageSize) break;
  }

  return {
    company: fallbackName || tenant,
    url: `${base}/en-US`,
    section: 'social',
    totalOnSite: total,
    count: jobs.length,
    jobs,
  };
}

module.exports = { scrapeWorkday, inferSection };
