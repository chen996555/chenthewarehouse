'use strict';

// ---- 全局状态 ---------------------------------------------------------------

const state = {
  statuses: {},
  statusOrder: [],
  transitions: {},
  channels: [],
  applications: [],
  editingId: null,      // null = 新建
  searchResults: [],    // 最近一次搜索结果（供「加入待投」按 id 定位）
  scrapeResult: null,   // 最近一次官网抓取结果
  scrapeFilter: 'all',  // 官网抓取结果的筛选：all | formal | intern
  companies: [],        // 目标公司注册表（来自 /api/companies）
};

// ---- DOM 引用 ---------------------------------------------------------------

const $ = (sel) => document.querySelector(sel);
const boardViewEl = $('#board-view');
const searchViewEl = $('#search-view');
const scrapeViewEl = $('#scrape-view');
const scrapeResultsEl = $('#scrape-results');
const boardEl = $('#board');
const statsEl = $('#stats');
const activityEl = $('#activity');
const maskEl = $('#modal-mask');
const formEl = $('#app-form');
const modalTitleEl = $('#modal-title');
const statusSelectEl = $('#status-select');
const channelListEl = $('#channel-list');
const searchResultsEl = $('#search-results');

// ---- API 封装 ---------------------------------------------------------------

async function api(path, options) {
  const res = await fetch(path, options);
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || `请求失败 (${res.status})`);
  return data;
}

const loadMeta = () => api('/api/meta');
const loadApps = () => api('/api/applications');
const loadStats = () => api('/api/stats');
const loadActivity = () => api('/api/activity');
const loadSearchOptions = () => api('/api/search-options');
const createApp = (b) => api('/api/applications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
const updateApp = (id, b) => api(`/api/applications/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
const deleteApp = (id) => api(`/api/applications/${id}`, { method: 'DELETE' });
const importJob = (job) => api('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(job) });
const scrapeZhiye = (b) => api('/api/scrape-zhiye', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
const importZhiyeJob = (b) => api('/api/import-zhiye', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
const scrapeCompany = (b) => api('/api/scrape', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
const importJobGeneric = (b) => api('/api/import-job', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
const scoreJobs = (b) => api('/api/score', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
const scoreStatus = (id) => api(`/api/score/status?id=${encodeURIComponent(id)}`);
const loadCompanies = () => api('/api/companies');
const scanAll = (b) => api('/api/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
const scanStatus = (id) => api(`/api/scan/status?id=${encodeURIComponent(id)}`);

function searchJobs(params) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  return api(`/api/search?${qs.toString()}`);
}

// ---- 渲染 -------------------------------------------------------------------

function renderStats(stats) {
  const items = [['总计', stats.total], ['已投', stats.applied], ['回复率', stats.replyRate + '%']];
  statsEl.innerHTML = items.map(([l, v]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');
}

function renderBoard() {
  boardEl.innerHTML = '';
  for (const key of state.statusOrder) {
    const col = state.statuses[key];
    const apps = state.applications.filter((a) => a.status === key);
    const colEl = document.createElement('div');
    colEl.className = 'column';
    colEl.dataset.status = key;
    colEl.innerHTML = `
      <div class="col-head">
        <span class="col-dot" style="background:${col.color}"></span>
        ${col.label}
        <span class="col-count">${apps.length}</span>
      </div>
      <div class="col-body"></div>
    `;
    const body = colEl.querySelector('.col-body');
    for (const app of apps) body.appendChild(renderCard(app));
    boardEl.appendChild(colEl);
  }
}

function renderCard(app) {
  const card = document.createElement('div');
  card.className = 'card';
  card.draggable = true;
  card.dataset.id = app.id;

  const meta = [];
  if (app.channel) meta.push(`<span class="badge">${esc(app.channel)}</span>`);
  if (app.source === 'job-hunter') meta.push(`<span class="badge synthetic" title="岗位库合成岗位，非实时在招，投递前到官网核实">合成</span>`);
  else if (app.source) meta.push(`<span class="badge src" title="官网实时抓取">官网</span>`);
  if (app.city) meta.push(`<span class="badge">${esc(app.city)}</span>`);
  if (app.salary) meta.push(`<span class="badge">${esc(app.salary)}</span>`);
  if (app.degree) meta.push(`<span class="badge">${esc(app.degree)}</span>`);
  if (app.industry) meta.push(`<span class="badge">${esc(app.industry)}</span>`);
  if (app.follow_up_date) {
    const overdue = app.follow_up_date < todayStr() && !['offer', 'rejected'].includes(app.status);
    meta.push(`<span class="badge ${overdue ? 'overdue' : ''}">⏰ ${esc(app.follow_up_date)}</span>`);
  }

  const link = app.url ? `<a class="card-link" href="${esc(app.url)}" target="_blank" rel="noopener" title="打开官网投递页">↗</a>` : '';

  card.innerHTML = `
    <button class="del" title="删除" data-del="${app.id}">✕</button>
    ${link}
    <div class="card-top">
      <div class="company">${esc(app.company)}</div>
    </div>
    <div class="title">${esc(app.title)}</div>
    <div class="meta">${meta.join('')}</div>
  `;

  card.addEventListener('click', (e) => {
    if (e.target.closest('[data-del], .card-link')) return;
    openModal(app);
  });
  card.querySelector('[data-del]').addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm(`删除「${app.company}｜${app.title}」这条投递记录？`)) return;
    try { await deleteApp(app.id); await refresh(); } catch (err) { alert(err.message); }
  });
  card.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', app.id);
    e.dataTransfer.effectAllowed = 'move';
  });
  return card;
}

function setupDropTargets() {
  document.querySelectorAll('.column').forEach((col) => {
    col.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; col.classList.add('drag-over'); });
    col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
    col.addEventListener('drop', async (e) => {
      e.preventDefault();
      col.classList.remove('drag-over');
      const id = e.dataTransfer.getData('text/plain');
      const status = col.dataset.status;
      const app = state.applications.find((a) => a.id === id);
      if (!app || app.status === status) return;
      try { await updateApp(id, { status }); await refresh(); } catch (err) { alert(err.message); }
    });
  });
}

function renderActivity(list) {
  if (!list.length) { activityEl.innerHTML = '<h3>最近动态</h3><div class="empty">暂无记录</div>'; return; }
  const items = list.map((h) => {
    const time = (h.created_at || '').slice(11, 16);
    const label = h.action === 'created' ? '新建' : (state.statuses[h.action] ? `状态：${state.statuses[h.action].label}` : h.action);
    const who = h.company ? `${h.company}｜${h.title}` : h.detail || '';
    return `<li><span class="act-time">${esc(time)}</span><span class="act-detail">${esc(label)} · ${esc(who)}</span></li>`;
  }).join('');
  activityEl.innerHTML = `<h3>最近动态</h3><ul>${items}</ul>`;
}

async function refresh() {
  const [apps, stats, activity] = await Promise.all([loadApps(), loadStats(), loadActivity()]);
  state.applications = apps;
  renderStats(stats);
  renderBoard();
  setupDropTargets();
  renderActivity(activity);
}

// ---- 标签页 -----------------------------------------------------------------

function switchTab(tab) {
  boardViewEl.hidden = tab !== 'board';
  searchViewEl.hidden = tab !== 'search';
  scrapeViewEl.hidden = tab !== 'scrape';
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
}

// ---- 找岗位 -----------------------------------------------------------------

async function doSearch() {
  const params = {
    kw: $('#search-kw').value,
    city: $('#search-city').value,
    type: $('#search-type').value,
    degree: $('#search-degree').value,
    industry: $('#search-industry').value,
    tier: $('#search-tier').value,
  };
  searchResultsEl.innerHTML = '<div class="empty">搜索中…</div>';
  const results = await searchJobs(params);
  state.searchResults = results;
  renderSearchResults(results);
}

function renderSearchResults(results) {
  if (!results.length) { searchResultsEl.innerHTML = '<div class="empty">无匹配岗位，换个关键词试试</div>'; return; }
  searchResultsEl.innerHTML = results.map((job) => {
    const badges = [job.tier, job.industry, job.degree, job.type]
      .filter(Boolean).map((x) => `<span class="badge">${esc(x)}</span>`).join('');
    const jd = job.desc || '';
    const jdText = jd.length > 120 ? jd.slice(0, 120) + '…' : jd;
    return `
      <div class="job-result" data-id="${esc(job.id)}">
        <div class="jr-head">
          <div>
            <div class="jr-company">${esc(job.company)}</div>
            <div class="jr-title">${esc(job.title)}</div>
          </div>
          <div class="jr-actions">
            ${job.url ? `<a class="btn ghost" href="${esc(job.url)}" target="_blank" rel="noopener" title="打开官网（门户首页，需搜索具体岗位）">官网 ↗</a>` : ''}
            <button class="btn primary import-btn" data-id="${esc(job.id)}">加入待投</button>
          </div>
        </div>
        <div class="jr-meta">
          <span>📍 ${esc(job.city || '-')}</span>
          <span>💰 ${esc(job.salary || '-')}</span>
          ${job.score ? `<span>匹配 ${job.score}</span>` : ''}
        </div>
        <div class="jr-badges">${badges}</div>
        ${jdText ? `<div class="jr-jd">${esc(jdText)}</div>` : ''}
      </div>
    `;
  }).join('');

  searchResultsEl.querySelectorAll('.import-btn').forEach((btn) =>
    btn.addEventListener('click', () => handleImport(btn.dataset.id))
  );
}

async function handleImport(id) {
  const job = state.searchResults.find((j) => j.id === id);
  if (!job) return;
  const btn = searchResultsEl.querySelector(`.import-btn[data-id="${id}"]`);
  btn.disabled = true; btn.textContent = '导入中…';
  try {
    const res = await importJob(job);
    btn.textContent = res.created ? '已加入' : '已存在';
    btn.classList.remove('primary'); btn.classList.add('ghost');
    await refresh();
  } catch (err) { alert(err.message); btn.disabled = false; btn.textContent = '加入待投'; }
}

// ---- 官网真实岗位抓取 -------------------------------------------------------

// 公司列表由服务端 /api/companies 提供（见 companies.js 注册表）
function populateCompanySelect() {
  const sel = $('#scrape-company');
  let html = '';
  for (const g of state.companies) {
    html += `<optgroup label="${esc(g.group)}">`;
    for (const c of g.companies) {
      if (c.adapter) {
        html += `<option value="${esc(c.name)}">${esc(c.name)}</option>`;
      } else {
        html += `<option disabled>${esc(c.name)}（待适配）</option>`;
      }
    }
    html += '</optgroup>';
  }
  html += '<option value="custom">自定义 zhiye 子域名…</option>';
  sel.innerHTML = html;
}

function updateScrapeInput() {
  const isCustom = $('#scrape-company').value === 'custom';
  $('#scrape-subdomain').style.display = isCustom ? '' : 'none';
}

async function doScrape() {
  const name = $('#scrape-company').value;
  const section = $('#scrape-section').value;
  const keyword = $('#scrape-keyword').value.trim();
  if (name === 'custom' && !$('#scrape-subdomain').value.trim()) { alert('请输入 zhiye.com 子域名'); return; }
  scrapeResultsEl.innerHTML = '<div class="empty">抓取中…（约 10-20 秒，需启动浏览器）</div>';
  const btn = $('#scrape-btn');
  btn.disabled = true;
  try {
    const result = name === 'custom'
      ? await scrapeZhiye({ subdomain: $('#scrape-subdomain').value.trim(), section })
      : await scrapeCompany({ name, section, keyword });
    state.scrapeResult = result;
    renderScrapeResults(result);
    localStorage.setItem('scrape-company', name);
    localStorage.setItem('scrape-subdomain', $('#scrape-subdomain').value);
    localStorage.setItem('scrape-section', section);
  } catch (err) {
    scrapeResultsEl.innerHTML = `<div class="empty">抓取失败：${esc(err.message)}</div>`;
  } finally {
    btn.disabled = false;
  }
}

// 岗位分类：实习 / 校招正式 / 其他（兼容各适配器的字段差异）
function jobCategory(job) {
  const t = String(job.type || job.employmentType || '');
  if (/实习/.test(t)) return 'intern';
  if (/正式|全职/.test(t)) return 'formal';
  return 'other';
}

function scrapeFilteredJobs() {
  const result = state.scrapeResult;
  if (!result) return [];
  if (state.scrapeFilter === 'all') return result.jobs;
  return result.jobs.filter((j) => jobCategory(j) === state.scrapeFilter);
}

function renderScrapeResults(result) {
  if (!result.jobs.length) {
    scrapeResultsEl.innerHTML = '<div class="empty">该公司当前没有在招岗位，或页面结构已变化</div>';
    return;
  }
  state.scrapeResult = result;
  state.scrapeFilter = 'all';
  renderScrapeList();
}

function renderScrapeList() {
  const result = state.scrapeResult;
  const all = result.jobs;
  const formalN = all.filter((j) => jobCategory(j) === 'formal').length;
  const internN = all.filter((j) => jobCategory(j) === 'intern').length;
  const jobs = scrapeFilteredJobs();

  const header = `<div class="data-note" style="margin-bottom:8px">${esc(result.company)} · ${all.length} 个在招岗位（校招正式 ${formalN} / 实习 ${internN}）· <a href="${esc(result.url)}" target="_blank" rel="noopener">打开官网 ↗</a> · <select id="scrape-filter" style="padding:2px 6px;margin-left:6px;font-size:12px">
    <option value="all"${state.scrapeFilter === 'all' ? ' selected' : ''}>全部</option>
    <option value="formal"${state.scrapeFilter === 'formal' ? ' selected' : ''}>校招正式</option>
    <option value="intern"${state.scrapeFilter === 'intern' ? ' selected' : ''}>实习</option>
  </select> · <button class="btn ghost" id="score-btn" style="padding:2px 10px;margin-left:6px">✨ 智能打分</button></div>`;

  const items = jobs.map((job) => `
    <div class="job-result">
      <div class="jr-head">
        <div>
          <div class="jr-company">${esc(job.title)}</div>
          <div class="jr-title">编号 ${esc(job.id)}${job.team ? ' · ' + esc(job.team) : ''}</div>
        </div>
        <div class="jr-actions">
          <button class="btn primary import-zhiye-btn" data-id="${esc(job.id)}">加入待投</button>
        </div>
      </div>
      <div class="jr-meta">
        ${jobCategory(job) === 'intern' ? '<span class="badge">实习</span>' : jobCategory(job) === 'formal' ? '<span class="badge">校招正式</span>' : ''}
        ${job.type ? `<span>${esc(job.type)}</span>` : ''}
        ${job.program ? `<span>${esc(job.program)}</span>` : ''}
        ${job.location ? `<span>📍 ${esc(job.location)}</span>` : ''}
        ${job.date ? `<span>🕒 ${esc(job.date)} 发布</span>` : ''}
        ${job.endDate ? `<span>⏰ 截止 ${esc(job.endDate)}</span>` : ''}
      </div>
    </div>
  `).join('');

  scrapeResultsEl.innerHTML = header + (items || '<div class="empty">该筛选下无岗位</div>');
  scrapeResultsEl.querySelectorAll('.import-zhiye-btn').forEach((btn) =>
    btn.addEventListener('click', () => handleScrapeImport(btn.dataset.id))
  );
  const f = $('#scrape-filter');
  if (f) f.addEventListener('change', () => { state.scrapeFilter = f.value; renderScrapeList(); });
  const sb = $('#score-btn');
  if (sb) sb.addEventListener('click', doScore);
}

// ---- 智能打分 ---------------------------------------------------------------

async function doScore() {
  const filtered = scrapeFilteredJobs();
  if (!filtered.length) return;
  scrapeResultsEl.innerHTML = '<div class="empty">智能打分中…（硬过滤 + 语义重排 + 判定，非推理模型约 1-2 分钟，请稍候）</div>';
  try {
    // 只打当前筛选（全部/校招正式/实习）下的岗位，并补上公司名
    const jobs = filtered.map((j) => ({ ...j, company: j.company || state.scrapeResult.company }));
    const { jobId } = await scoreJobs({ jobs });
    // 轮询直到完成
    let task = { status: 'running' };
    let waited = 0;
    while (task.status === 'running' && waited < 600) {
      await new Promise((r) => setTimeout(r, 4000));
      waited += 4;
      task = await scoreStatus(jobId);
      if (task.status === 'running') {
        scrapeResultsEl.innerHTML = `<div class="empty">打分中…已等待 ${waited} 秒（批量判定中，耐心点）</div>`;
      }
    }
    if (task.status === 'done') renderScoreResults(task.result);
    else if (task.status === 'error') scrapeResultsEl.innerHTML = `<div class="empty">打分失败：${esc(task.error || '')}</div>`;
    else scrapeResultsEl.innerHTML = '<div class="empty">打分超时（10 分钟未完成），请重试或减少岗位数</div>';
  } catch (err) {
    scrapeResultsEl.innerHTML = `<div class="empty">打分失败：${esc(err.message)}</div>`;
  }
}

function renderScoreResults(r) {
  const T = r.tiers || { A: [], B: [], C: [], D: [] };
  const stats = `共 ${r.total} 个 → 硬过滤 ${r.hardFiltered} → 语义重排取 ${r.llmPool} → 判定 ${r.judged}${r.detailFetched ? ` → 补抓JD ${r.detailFetched}` : ''} → 🟢A ${T.A.length} / 🔵B ${T.B.length} / 🟡C ${T.C.length} / ⚪D ${T.D.length}（同公司限 ${r.companyLimit}）`;

  const notes = [];
  if (r.llmDegraded) notes.push('<div class="data-note" style="color:#b45309">⚠ 判定模型不可用，已降级为纯语义排序，档位仅供参考</div>');
  if (r.rerankerMode === 'keyword') notes.push('<div class="data-note" style="color:#b45309">⚠ 语义重排不可用，已回退关键词粗排</div>');
  if (r.detailDegraded) notes.push('<div class="data-note" style="color:#b45309">⚠ 详情页抓取部分失败，相关岗位仍按标题判定</div>');
  if (r.overflow.length) notes.push(`<div class="data-note">⚠ 同公司限投 ${r.companyLimit} 个，${r.overflow.length} 个岗位超出限额</div>`);

  const section = (label, color, jobs) => jobs.length
    ? `<div class="data-note" style="margin-top:12px;font-weight:600;color:${color}">${label}（${jobs.length}）</div>` + jobs.map(renderScoreJob).join('')
    : '';

  const collapsed = (summary, jobs) => jobs.length
    ? `<details style="margin-top:6px"><summary class="data-note">${summary}</summary>${jobs.map(renderScoreJob).join('')}</details>`
    : '';

  const dropped = r.filteredOut.length
    ? `<details style="margin-top:10px"><summary class="data-note">✂ 硬过滤淘汰 ${r.filteredOut.length} 个（点开看原因）</summary>${r.filteredOut.map((j) => `<div class="data-note">${esc(j.company)}｜${esc(j.title)}：${esc((j.filterReasons || []).join('；'))}</div>`).join('')}</details>`
    : '';

  scrapeResultsEl.innerHTML =
    `<div class="data-note" style="margin-bottom:8px">${stats}</div>${notes.join('')}` +
    section('🟢 A 强烈推荐', '#047857', T.A) +
    section('🔵 B 建议投递', '#2563eb', T.B) +
    collapsed(`🟡 C 备选 ${T.C.length} 个（点开查看）`, T.C) +
    collapsed(`⚪ D 不投 ${T.D.length} 个（点开查看原因）`, T.D) +
    dropped;
  scrapeResultsEl.querySelectorAll('.import-zhiye-btn').forEach((btn) =>
    btn.addEventListener('click', () => handleScrapeImport(btn.dataset.id))
  );
}

function renderScoreJob(job) {
  const badgeCls = job.tier === 'A' ? 'src' : job.tier === 'D' ? 'overdue' : '';
  const jdFlag = job.jdMissing ? ' <span class="badge overdue" title="未抓取JD详情，判定仅据标题，投递前点官网核实">无JD</span>' : '';
  const evidence = job.judge
    ? `<div class="data-note" style="margin-top:6px">📋 职责${job.judge.duty_match} · 可迁移${job.judge.transferable} · 缺口${job.judge.skill_gap} · 方向${job.judge.direction}</div>`
    : '';
  return `
    <div class="job-result">
      <div class="jr-head">
        <div>
          <div class="jr-company">${esc(job.company)}｜${esc(job.title)} <span class="badge ${badgeCls}">${job.score} 分</span>${jdFlag}</div>
          <div class="jr-title">${esc(job.verdict || '')}</div>
        </div>
        <div class="jr-actions">
          <button class="btn primary import-zhiye-btn" data-id="${esc(job.id)}">加入待投</button>
        </div>
      </div>
      ${job.suggestion ? `<div class="jr-jd">💡 ${esc(job.suggestion)}</div>` : ''}
      ${evidence}
    </div>
  `;
}

// ---- 一键扫描 ---------------------------------------------------------------

async function doScan() {
  const section = $('#scrape-section').value;
  scrapeResultsEl.innerHTML = '<div class="empty">一键扫描中…（自动遍历互联网公司抓岗位 → 打分 → 补JD → 导入，约 5-10 分钟，请稍候）</div>';
  const btn = $('#scan-btn');
  btn.disabled = true;
  try {
    const { jobId } = await scanAll({ section });
    let task = { status: 'running' };
    let waited = 0;
    while (task.status === 'running' && waited < 1200) {
      await new Promise((r) => setTimeout(r, 5000));
      waited += 5;
      task = await scanStatus(jobId);
      if (task.status === 'running') {
        scrapeResultsEl.innerHTML = `<div class="empty">扫描中…已等待 ${waited} 秒${task.progress ? ' · ' + esc(task.progress) : ''}</div>`;
      }
    }
    if (task.status === 'done') renderScanResults(task.result);
    else if (task.status === 'error') scrapeResultsEl.innerHTML = `<div class="empty">扫描失败：${esc(task.error || '')}</div>`;
    else scrapeResultsEl.innerHTML = '<div class="empty">扫描超时（20 分钟未完成），请重试或减少公司数</div>';
  } catch (err) {
    scrapeResultsEl.innerHTML = `<div class="empty">扫描失败：${esc(err.message)}</div>`;
  } finally {
    btn.disabled = false;
  }
}

function renderScanResults(r) {
  const T = (r.scored && r.scored.tiers) || { A: [], B: [], C: [], D: [] };
  const summary = `<div class="data-note" style="margin-bottom:8px">扫描 ${r.totalCompanies} 家 → 成功 ${r.okCompanies} 家，岗位 ${r.totalJobs} 个 → 🟢A ${T.A.length} / 🔵B ${T.B.length} / 🟡C ${T.C.length} / ⚪D ${T.D.length} → 已导入待投 ${r.imported} 个</div>`;
  const companies = r.perCompany.map((c) => `<div class="data-note">${c.ok ? '✓' : '✗'} ${esc(c.company)}${c.ok ? `（${c.count}）` : `：${esc(c.error || '')}`}</div>`).join('');
  const section = (label, color, jobs) => jobs.length
    ? `<div class="data-note" style="margin-top:12px;font-weight:600;color:${color}">${label}（${jobs.length}）</div>` + jobs.map(renderScanJob).join('')
    : '';
  scrapeResultsEl.innerHTML =
    summary +
    `<details style="margin-top:8px"><summary class="data-note">📡 各公司抓取情况</summary>${companies}</details>` +
    section('🟢 A 强烈推荐（已导入待投）', '#047857', T.A) +
    section('🔵 B 建议投递（已导入待投）', '#2563eb', T.B) +
    (T.C.length ? `<details style="margin-top:6px"><summary class="data-note">🟡 C 备选 ${T.C.length} 个（点开）</summary>${T.C.map(renderScanJob).join('')}</details>` : '') +
    (T.D.length ? `<details style="margin-top:6px"><summary class="data-note">⚪ D 不投 ${T.D.length} 个（点开）</summary>${T.D.map(renderScanJob).join('')}</details>` : '');
}

function renderScanJob(job) {
  const badgeCls = job.tier === 'A' ? 'src' : job.tier === 'D' ? 'overdue' : '';
  const jdFlag = job.jdMissing ? ' <span class="badge overdue" title="未抓取JD详情">无JD</span>' : '';
  const evidence = job.judge
    ? `<div class="data-note" style="margin-top:6px">📋 职责${job.judge.duty_match} · 可迁移${job.judge.transferable} · 缺口${job.judge.skill_gap} · 方向${job.judge.direction}</div>`
    : '';
  return `
    <div class="job-result">
      <div class="jr-head">
        <div>
          <div class="jr-company">${esc(job.company)}｜${esc(job.title)} <span class="badge ${badgeCls}">${job.score} 分</span>${jdFlag}</div>
          <div class="jr-title">${esc(job.verdict || '')}</div>
        </div>
      </div>
      ${job.suggestion ? `<div class="jr-jd">💡 ${esc(job.suggestion)}</div>` : ''}
      ${evidence}
    </div>
  `;
}

async function handleScrapeImport(id) {
  const result = state.scrapeResult;
  const job = result && result.jobs.find((j) => j.id === id);
  if (!job) return;
  const btn = scrapeResultsEl.querySelector(`.import-zhiye-btn[data-id="${id}"]`);
  btn.disabled = true; btn.textContent = '导入中…';
  try {
    const res = await importJobGeneric({ job, company: result.company, url: result.url, adapter: result.adapter || 'zhiye' });
    btn.textContent = res.created ? '已加入' : '已存在';
    btn.classList.remove('primary'); btn.classList.add('ghost');
    await refresh();
  } catch (err) { alert(err.message); btn.disabled = false; btn.textContent = '加入待投'; }
}

// ---- 弹窗 -------------------------------------------------------------------

function openModal(app) {
  state.editingId = app ? app.id : null;
  modalTitleEl.textContent = app ? '编辑投递' : '新建投递';
  formEl.reset();
  formEl.elements.company.value = app ? app.company : '';
  formEl.elements.title.value = app ? app.title : '';
  formEl.elements.channel.value = app ? app.channel : '';
  formEl.elements.status.value = app ? app.status : 'pending';
  formEl.elements.city.value = app ? app.city : '';
  formEl.elements.salary.value = app ? app.salary : '';
  formEl.elements.url.value = app ? app.url : '';
  formEl.elements.follow_up_date.value = app ? app.follow_up_date : '';
  formEl.elements.notes.value = app ? app.notes : '';
  maskEl.hidden = false;
  formEl.elements.company.focus();
}

function closeModal() { maskEl.hidden = true; state.editingId = null; }

formEl.addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    company: formEl.elements.company.value,
    title: formEl.elements.title.value,
    channel: formEl.elements.channel.value,
    status: formEl.elements.status.value,
    city: formEl.elements.city.value,
    salary: formEl.elements.salary.value,
    url: formEl.elements.url.value,
    follow_up_date: formEl.elements.follow_up_date.value,
    notes: formEl.elements.notes.value,
  };
  try {
    if (state.editingId) await updateApp(state.editingId, body);
    else await createApp(body);
    closeModal();
    await refresh();
  } catch (err) { alert(err.message); }
});

// ---- 事件绑定 ---------------------------------------------------------------

document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
$('#search-btn').addEventListener('click', doSearch);
$('#search-kw').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
$('#scrape-btn').addEventListener('click', doScrape);
$('#scan-btn').addEventListener('click', doScan);
$('#scrape-subdomain').addEventListener('keydown', (e) => { if (e.key === 'Enter') doScrape(); });
$('#scrape-company').addEventListener('change', updateScrapeInput);
$('#close-btn').addEventListener('click', closeModal);
$('#cancel-btn').addEventListener('click', closeModal);
$('#new-btn').addEventListener('click', () => openModal(null));
maskEl.addEventListener('click', (e) => { if (e.target === maskEl) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !maskEl.hidden) closeModal(); });

// ---- 工具 -------------------------------------------------------------------

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---- 初始化 -----------------------------------------------------------------

async function init() {
  const meta = await loadMeta();
  state.statuses = meta.statuses;
  state.statusOrder = meta.statusOrder;
  state.transitions = meta.transitions;
  state.channels = meta.channels;

  statusSelectEl.innerHTML = state.statusOrder.map((k) => `<option value="${k}">${state.statuses[k].label}</option>`).join('');
  channelListEl.innerHTML = state.channels.map((c) => `<option value="${esc(c)}"></option>`).join('');

  // 加载公司注册表并填充下拉
  try {
    state.companies = await loadCompanies();
  } catch (e) { /* 公司列表加载失败不阻断 */ }
  populateCompanySelect();
  // 恢复上次的官网抓取选择
  const savedCompany = localStorage.getItem('scrape-company');
  if (savedCompany) $('#scrape-company').value = savedCompany;
  const savedSubdomain = localStorage.getItem('scrape-subdomain');
  if (savedSubdomain) $('#scrape-subdomain').value = savedSubdomain;
  const savedSection = localStorage.getItem('scrape-section');
  if (savedSection) $('#scrape-section').value = savedSection;
  updateScrapeInput();

  // 填充搜索筛选项
  try {
    const opts = await loadSearchOptions();
    const fill = (id, values) => { $(id).insertAdjacentHTML('beforeend', values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('')); };
    fill('#search-type', opts.type);
    fill('#search-degree', opts.degree);
    fill('#search-industry', opts.industry);
    fill('#search-tier', opts.tier);
    if (opts.dataInfo) {
      $('#data-note').textContent = `数据来源：${opts.dataInfo.source}（${opts.dataInfo.updated} 更新）· ${opts.dataInfo.note}`;
    }
  } catch (e) { /* 筛选项加载失败不阻断 */ }

  await refresh();
}

init().catch((err) => {
  document.body.innerHTML = `<div style="padding:40px;color:#ef4444">加载失败：${esc(err.message)}</div>`;
});
