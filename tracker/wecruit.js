'use strict';

/**
 * 求职星计划 — 北森 Wecruit（wecruit.hotjob.cn）纯 HTTP 适配器
 * 覆盖：地平线（及未来纯 HTTP 的 wecruit 公司）。区别于 hotjob.js（浏览器型，荣耀需签名）。
 *
 * 接口：POST https://wecruit.hotjob.cn/wecruit/positionInfo/listPosition/{suiteId}?iSaJAx=isAjax&request_locale=zh_CN&t={ms}
 *   body（urlencoded）：isFrompb=true&recruitType=<1|2>&pageSize=15&currentPage=N&postName=关键词
 *   recruitType：1=校园（校招+实习）、2=社招
 * 响应：{ data:{ pageForm:{ pageData:[...], totalPage, dataCount } }, state:"200" }（state==="200" 成功）
 * 匿名无签名（job-pro 地平线已验证）
 */

const BASE = 'https://wecruit.hotjob.cn';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const { inferSection } = require('./section');

async function fetchWecruitPage({ suiteId, recruitType, currentPage, pageSize, keyword, projectCode }) {
  const url = `${BASE}/wecruit/positionInfo/listPosition/${suiteId}?iSaJAx=isAjax&request_locale=zh_CN&t=${Date.now()}`;
  const form = new URLSearchParams({
    isFrompb: 'true',
    recruitType: String(recruitType),
    pageSize: String(pageSize),
    currentPage: String(currentPage),
  });
  if (keyword) form.set('postName', keyword);
  if (projectCode) form.set('projectCode', projectCode);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      Origin: BASE,
      Referer: `${BASE}/${suiteId}/pb/school.html`,
    },
    body: form.toString(),
  });
  if (!res.ok) throw new Error(`wecruit HTTP ${res.status}`);
  return res.json().catch(() => null);
}

function mapWecruitJob(p, suiteId, recruitType) {
  const postId = String(p.postId || '');
  const postCode = String(p.postCode || '');
  // 去重用可读的 postCode；详情是「展开式」（无独立详情页），详情 URL 指向列表页，JD 走 listPositionDetail 接口
  const id = postCode || postId;
  const title = String(p.postName || '').trim();
  const type = String(p.postTypeName || '').trim();
  // section：recruitType=2 明确社招；recruitType=1 校园招聘（可能混实习）用多信号推断（覆盖「暑期/夏令营/日常实习」等）
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
    date: '',
    detailUrl: `${BASE}/${suiteId}/pb/school.html`,
    canDelivery: p.canDelivery !== false, // 可投递（false=已满/不可投）
    jd: '',
  };
}

// 岗位详情（JD）：纯 HTTP，POST listPositionDetail，body postId=数字哈希
async function fetchWecruitDetail({ suiteId, postId }) {
  const url = `${BASE}/wecruit/positionInfo/listPositionDetail/${suiteId}?iSaJAx=isAjax&request_locale=zh_CN&t=${Date.now()}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      Origin: BASE,
      Referer: `${BASE}/${suiteId}/pb/school.html`,
    },
    body: new URLSearchParams({ postId }).toString(),
  });
  if (!res.ok) throw new Error(`wecruit detail HTTP ${res.status}`);
  const j = await res.json().catch(() => null);
  if (!j || j.state !== '200' || !j.data) return null;
  const d = j.data;
  return {
    jd: [d.workContent, d.serviceCondition].filter(Boolean).join('\n'),
    postId: d.postId,
    postCode: d.postCode,
    canDelivery: d.canDelivery,
    resumeTemplateId: d.resumeTemplateId,
    // 投递限制信号（明文）：组织限制投递数 / 志愿数按项目拆分 / 是否有志愿
    limitApplyNumByOrg: d.limitApplyNumByOrg,
    wishNumSplitByProject: d.wishNumSplitByProject,
    isHaveVolunteer: d.isHaveVolunteer,
  };
}

async function scrapeWecruit({ suiteId, section = 'campus', keyword = '', maxJobs = 100, fallbackName = '', projectCode = '' } = {}) {
  if (!suiteId) throw new Error('缺少 wecruit 机构 ID（suiteId）');
  const recruitType = section === 'social' ? 2 : 1;
  const cap = Math.min(Math.max(Number(maxJobs) || 100, 10), 300);
  const pageSize = 50;
  const seen = new Set();
  const jobs = [];
  let total = 0;

  for (let currentPage = 1; jobs.length < cap; currentPage++) {
    const j = await fetchWecruitPage({ suiteId, recruitType, currentPage, pageSize, keyword, projectCode });
    if (!j || j.state !== '200' || !j.data || !j.data.pageForm) break;
    const pageForm = j.data.pageForm;
    if (currentPage === 1) total = Number(pageForm.dataCount || (pageForm.totalPage || 0) * pageSize || 0);
    const list = pageForm.pageData || [];
    if (!list.length) break;
    for (const p of list) {
      const id = String(p.postCode || p.postId || '');
      if (id && !seen.has(id)) { seen.add(id); jobs.push(mapWecruitJob(p, suiteId, recruitType)); }
    }
    const totalPage = Number(pageForm.totalPage || 0);
    if (totalPage && currentPage >= totalPage) break;
    if (list.length < pageSize) break;
  }

  return { company: fallbackName, url: `${BASE}/${suiteId}/pb/school.html`, section, keyword, totalOnSite: total, count: jobs.length, jobs };
}

module.exports = { scrapeWecruit, mapWecruitJob, fetchWecruitDetail };
