'use strict';

/**
 * 求职星计划 — 北森 Wecruit（hotjob）纯 HTTP 适配器
 * 覆盖：荣耀（career.honor.com）、南方基金/广发证券/华泰证券（wecruit.hotjob.cn）。
 * 参考 job-pro wecruit.ts（原误判为浏览器型需签名，实为匿名纯 HTTP）。
 * 接口：POST {base}/wecruit/positionInfo/listPosition/{suiteId}?iSaJAx=isAjax&request_locale=zh_CN&t={ms}
 *   body（urlencoded）：isFrompb=true&recruitType=<1|2>&pageSize=15&currentPage=N&postName=关键词
 *   recruitType：1=校园（校招+实习）、2=社招
 * 响应：{ data:{ pageForm:{ pageData:[...], totalPage, dataCount } }, state:"200" }（state==="200" 成功）
 */

const DEFAULT_BASE = 'https://wecruit.hotjob.cn';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const { inferSection } = require('./section');

async function fetchHotjobPage({ base, suiteId, recruitType, currentPage, pageSize, keyword }) {
  const url = `${base}/wecruit/positionInfo/listPosition/${suiteId}?iSaJAx=isAjax&request_locale=zh_CN&t=${Date.now()}`;
  const form = new URLSearchParams({
    isFrompb: 'true',
    recruitType: String(recruitType),
    pageSize: String(pageSize),
    currentPage: String(currentPage),
  });
  if (keyword) form.set('postName', keyword);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      Origin: base,
      Referer: `${base}/${suiteId}/pb/school.html`,
    },
    body: form.toString(),
  });
  if (!res.ok) throw new Error(`hotjob HTTP ${res.status}`);
  return res.json().catch(() => null);
}

function mapHotjobJob(p, suiteId, base, recruitType) {
  const postId = String(p.postId || '');
  const postCode = String(p.postCode || '');
  // 去重用可读 postCode；详情 URL 必须用 postId（数字哈希，postCode 会 404）
  const id = postCode || postId;
  const postType = recruitType === 2 ? 'social' : 'campus';
  const title = String(p.postName || '').trim();
  const type = String(p.postTypeName || '').trim();
  // section：recruitType=2 明确社招；recruitType=1 校园招聘（可能混实习）用多信号推断
  const section = recruitType === 2 ? 'social' : inferSection('campus', { title, type });
  return {
    id,
    postId,
    title,
    team: p.orgName || p.company || '',
    location: String(p.workPlaceStr || '').trim(),
    type: String(p.postTypeName || '').trim(),
    section,
    program: '',
    date: String(p.publishDate || '').slice(0, 10),
    detailUrl: p.postUrl || `${base}/${suiteId}/pb/posDetail.html?postId=${postId}&postType=${postType}`,
    canDelivery: p.canDelivery !== false, // 可投递（false=已满/不可投）
    jd: '',
  };
}

async function scrapeHotjob({ suiteId, section = 'campus', keyword = '', base = DEFAULT_BASE, maxJobs = 100, fallbackName = '' } = {}) {
  if (!suiteId) throw new Error('缺少 hotjob 机构 ID（suiteId）');
  const baseUrl = String(base || DEFAULT_BASE).replace(/\/+$/, '');
  const recruitType = section === 'social' ? 2 : 1;
  const cap = Math.min(Math.max(Number(maxJobs) || 100, 10), 300);
  const pageSize = 50;
  const seen = new Set();
  const jobs = [];
  let total = 0;

  for (let currentPage = 1; jobs.length < cap; currentPage++) {
    const j = await fetchHotjobPage({ base: baseUrl, suiteId, recruitType, currentPage, pageSize, keyword });
    if (!j || j.state !== '200' || !j.data || !j.data.pageForm) break;
    const pageForm = j.data.pageForm;
    if (currentPage === 1) total = Number(pageForm.dataCount || (pageForm.totalPage || 0) * pageSize || 0);
    const list = pageForm.pageData || [];
    if (!list.length) break;
    for (const p of list) {
      const id = String(p.postCode || p.postId || '');
      if (id && !seen.has(id)) { seen.add(id); jobs.push(mapHotjobJob(p, suiteId, baseUrl, recruitType)); }
    }
    const totalPage = Number(pageForm.totalPage || 0);
    if (totalPage && currentPage >= totalPage) break;
    if (list.length < pageSize) break;
  }

  return { company: fallbackName, url: `${baseUrl}/${suiteId}/pb/school.html`, section, keyword, totalOnSite: total, count: jobs.length, jobs };
}

// 岗位详情（JD）：纯 HTTP，POST listPositionDetail，body postId=数字哈希
async function fetchHotjobDetail({ base = DEFAULT_BASE, suiteId, postId }) {
  const baseUrl = String(base).replace(/\/+$/, '');
  const url = `${baseUrl}/wecruit/positionInfo/listPositionDetail/${suiteId}?iSaJAx=isAjax&request_locale=zh_CN&t=${Date.now()}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      Origin: baseUrl,
      Referer: `${baseUrl}/${suiteId}/pb/school.html`,
    },
    body: new URLSearchParams({ postId }).toString(),
  });
  if (!res.ok) throw new Error(`hotjob detail HTTP ${res.status}`);
  const j = await res.json().catch(() => null);
  if (!j || j.state !== '200' || !j.data) return null;
  const d = j.data;
  return {
    jd: [d.workContent, d.serviceCondition].filter(Boolean).join('\n'),
    postId: d.postId,
    postCode: d.postCode,
    canDelivery: d.canDelivery,
    // 投递限制信号（明文）
    limitApplyNumByOrg: d.limitApplyNumByOrg,
    wishNumSplitByProject: d.wishNumSplitByProject,
    isHaveVolunteer: d.isHaveVolunteer,
  };
}

module.exports = { scrapeHotjob, mapHotjobJob, fetchHotjobDetail };
