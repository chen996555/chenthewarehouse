'use strict';

/**
 * 求职星计划 — 百度 适配器（自研，POST form urlencoded）
 * 参考 job-pro baidu.ts。
 * POST https://talent.baidu.com/httservice/getPostListNew
 *   参数（form）：recruitType, keyWord, curPage（注意不是 pageNum！）, pageSize（硬 cap 20）
 *   响应：{ status:"ok", data:{ total, pages, pageNum, pageSize, list:[...], hasNextPage } }
 * 详情：https://talent.baidu.com/jobs/detail/<recruitType>/<postId>
 */

const BASE = 'https://talent.baidu.com';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function fetchBaiduPage({ recruitType, keyword, curPage, pageSize }) {
  const form = new URLSearchParams({
    recruitType,
    keyWord: keyword || '',
    curPage: String(curPage),
    pageSize: String(Math.min(pageSize, 20)), // 硬 cap 20，超出返回 fail
  });
  const res = await fetch(`${BASE}/httservice/getPostListNew`, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/x-www-form-urlencoded', // JSON 会 400
      Referer: `${BASE}/jobs/list`,
    },
    body: form.toString(),
  });
  if (!res.ok) throw new Error(`百度 HTTP ${res.status}`);
  const j = await res.json().catch(() => null);
  if (!j || j.status !== 'ok') throw new Error(`百度 status ${j && j.status}: ${j && j.message}`);
  return j.data || { total: 0, list: [] };
}

function mapBaiduJob(item, recruitType) {
  const postId = String(item.postId || item.id || '');
  return {
    id: postId,
    title: String(item.name || item.title || '').trim(),
    team: '',
    location: String(item.workPlace || '').replace(/,/g, '、'),
    type: recruitType === 'GRADUATE' ? '校招' : recruitType === 'INTERN' ? '实习' : '社招',
    section: recruitType === 'GRADUATE' ? 'campus' : recruitType === 'INTERN' ? 'intern' : 'social',
    program: '',
    date: '',
    detailUrl: postId ? `${BASE}/jobs/detail/${recruitType}/${postId}` : '',
    jd: [item.workContent, item.serviceCondition].filter(Boolean).join('\n'),
  };
}

async function scrapeBaidu({ keyword = '', maxJobs = 100, fallbackName = '百度', section = 'campus' } = {}) {
  // 按 scope：校招=应届(GRADUATE)+实习(INTERN)，社招=SOCIAL（应届生不抓社招，避免浪费）
  const recruitTypes = section === 'social' ? ['SOCIAL'] : ['GRADUATE', 'INTERN'];
  const cap = Math.min(Math.max(Number(maxJobs) || 100, 10), 300);
  const pageSize = 20; // 硬 cap 20
  const seen = new Set();
  const jobs = [];
  let total = 0;

  for (const recruitType of recruitTypes) {
    if (jobs.length >= cap) break;
    for (let curPage = 1; jobs.length < cap; curPage++) {
      const data = await fetchBaiduPage({ recruitType, keyword, curPage, pageSize });
      if (curPage === 1) total += Number(data.total || 0);
      const list = data.list || [];
      if (!list.length) break;
      for (const it of list) {
        const id = String(it.postId || it.id || '');
        if (id && !seen.has(id)) { seen.add(id); jobs.push(mapBaiduJob(it, recruitType)); }
      }
      if (list.length < pageSize || !data.hasNextPage) break;
    }
  }

  return { company: fallbackName, url: `${BASE}/jobs/list`, section: 'campus', keyword, totalOnSite: total, count: jobs.length, jobs };
}

module.exports = { scrapeBaidu, mapBaiduJob };
