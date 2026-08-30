'use strict';
// Side Panel：求职星主工作台（页面式）
// 登录 / 上传简历 / 推荐 / 投递记录 / 看板漏斗 / 导出 / 卡片
// 填表动作通过 chrome.tabs.sendMessage 交给 content script 执行
let CLOUD_URL = 'http://localhost:8630'; // 默认本地，可在①简历页配置（上云改公网域名）
const $ = (id) => document.getElementById(id);

// ---- token / 画像管理 ----
async function getToken() { const { token } = await chrome.storage.local.get('token'); return token || ''; }
async function setToken(t) { await chrome.storage.local.set({ token: t }); }
function getProfile() { return new Promise((r) => chrome.storage.local.get('profile', ({ profile }) => r(profile || null))); }
async function setProfile(p) { await chrome.storage.local.set({ profile: p }); }

async function api(path, body) {
  const token = await getToken();
  const res = await fetch(`${CLOUD_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return res.json();
}
async function apiGet(path) {
  const token = await getToken();
  const res = await fetch(`${CLOUD_URL}${path}`, { headers: token ? { 'Authorization': `Bearer ${token}` } : {} });
  return res;
}

// ---- 工具 ----
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
function fileToDataUrl(f) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(f);
  });
}
// 轻量 toast（成功/错误分级，不打断操作）
function toast(msg, type = 'info', duration = 2500) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.className = 'toast ' + type;
  t.style.display = 'block';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.style.display = 'none'; }, duration);
}
let nickName = '';
function renderSub(status) {
  $('sub').textContent = nickName ? `${nickName} · ${status}` : status;
}
function judgeText(judge) {
  if (!judge) return '（判定降级）';
  const parts = [];
  if (judge.duty_match >= 2) parts.push('✅ 职责匹配');
  else if (judge.duty_match >= 1) parts.push('🟡 职责部分匹配');
  if (judge.transferable >= 1) parts.push('✅ 经验可迁移');
  if (judge.skill_gap <= 0) parts.push('✅ 技能无差距');
  else parts.push('⚠️ 技能有差距');
  if (judge.direction >= 2) parts.push('✅ 方向匹配');
  else if (judge.direction >= 1) parts.push('🟡 方向部分匹配');
  return parts.join(' · ');
}

const STATUS_LABEL = { pending: '待投', applied: '已投', replied: '有回复', interview: '面试', offer: 'Offer', rejected: '拒信' };
const STATUS_COLOR = { pending: '#646A73', applied: '#1456F0', replied: '#eab308', interview: '#8b5cf6', offer: '#22c55e', rejected: '#ef4444' };

// SVG 线条图标（Lucide 风格，stroke=currentColor 跟随文字色）
const S = '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
const ICONS = {
  search: S + '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
  file: S + '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
  image: S + '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
  download: S + '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  star: S + '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
  list: S + '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
  chart: S + '<line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>',
};

// ---- 导航 + 视图切换 ----
const navItems = [...document.querySelectorAll('.nav-item[data-step]')];
function setNav(step) { navItems.forEach((x) => x.classList.toggle('active', x.dataset.step === step)); }
navItems.forEach((item) => {
  item.addEventListener('click', () => switchView(item.dataset.step));
});
let currentView = 'resume';
let recState = { status: 'idle', liveJobs: [], result: null, error: '' };
function switchView(step) {
  setNav(step);
  currentView = step;
  const v = $('view');
  v.innerHTML = '';
  if (step === 'resume') renderResumeView();
  else if (step === 'recommend') renderRecommendView();
  else if (step === 'apply') renderApplyView();
  else if (step === 'board') renderBoardView();
}

// ---- ① 简历视图（登录 / 上传简历）----
function renderResumeView() {
  const v = $('view');
  v.innerHTML = '<div class="glass-card" id="resume-box">加载中…</div>';
  getToken().then((token) => {
    if (!token) {
      $('resume-box').innerHTML = `
        <div class="section-title">登录 / 注册（内测邀请码 JOBSTAR2027）</div>
        <div class="login-row">
          <input type="text" id="username" placeholder="用户名" />
          <input type="password" id="password" placeholder="密码" />
          <input type="text" id="invite" placeholder="邀请码（内测）" />
          <button class="btn btn-primary btn-block" id="act-login">登录</button>
          <button class="btn btn-ghost btn-block" id="act-register">注册</button>
        </div>`;
      bindLogin();
    } else {
      getProfile().then((profile) => {
        const name = profile && profile.identity && profile.identity.legal_name;
        $('resume-box').innerHTML = `
          <div class="section-title">简历画像</div>
          <div class="hint">${name ? '已导入画像：<b>' + escapeHtml(name) + '</b>' : '还没上传简历，先上传一份生成画像'}</div>
          <label class="btn btn-primary btn-block upload-btn">${ICONS.file}上传简历<input type="file" id="file" accept=".pdf,.txt,.doc,.docx" style="display:none" /></label>
          <div class="hint" style="margin-top:10px">上传后去「推荐」帮你找岗位</div>
          <div class="section-title" style="margin-top:14px">昵称</div>
          <input type="text" class="search-input" id="nickname-input" placeholder="输入昵称" />
          <button class="btn btn-ghost btn-block" id="act-nickname-save">保存昵称</button>
          <div class="section-title" style="margin-top:14px">头像</div>
          <label class="btn btn-ghost btn-block upload-btn">${ICONS.image}上传头像<input type="file" id="avatar-file" accept="image/*" style="display:none" /></label>
          <div class="section-title" style="margin-top:14px">服务器地址（上云改这里）</div>
          <input type="text" class="search-input" id="server-url-input" placeholder="http://localhost:8630" />
          <button class="btn btn-ghost btn-block" id="act-server-save">保存服务器地址</button>
          <button class="btn btn-ghost btn-block" id="act-logout" style="margin-top:14px">退出登录</button>`;
        bindUpload();
      });
    }
  });
}

function bindLogin() {
  $('act-login').addEventListener('click', async () => {
    const username = $('username').value.trim(), password = $('password').value;
    if (!username || !password) { toast('请输入用户名和密码', 'error'); return; }
    try {
      const j = await api('/api/login', { username, password });
      if (!j.token) throw new Error(j.error || '登录失败');
      await setToken(j.token);
      renderSub('已登录');
      renderResumeView();
    } catch (e) { toast('登录失败：' + e.message, 'error'); }
  });
  $('act-register').addEventListener('click', async () => {
    const username = $('username').value.trim(), password = $('password').value, inviteCode = $('invite').value.trim();
    if (!username || !password) { toast('请输入用户名和密码', 'error'); return; }
    try {
      const j = await api('/api/register', { username, password, inviteCode });
      if (!j.token) throw new Error(j.error || '注册失败');
      await setToken(j.token);
      renderSub('已登录');
      renderResumeView();
    } catch (e) { toast('注册失败：' + e.message, 'error'); }
  });
}

function bindUpload() {
  $('file').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    $('progress').textContent = '解析中…';
    try {
      const base64 = arrayBufferToBase64(await f.arrayBuffer());
      const j = await api('/api/resume/parse-file', { fileName: f.name, fileData: base64 });
      if (!j.profile) throw new Error(j.error || '解析失败');
      await setProfile(j.profile);
      $('progress').textContent = '';
      const name = j.profile.identity && j.profile.identity.legal_name;
      renderSub('画像已就绪');
      renderResumeView();
      toast('简历解析好了，可以去推荐找岗位', 'success');
    } catch (err) { $('progress').textContent = ''; toast('解析失败：' + err.message, 'error'); }
  });
  const af = $('avatar-file');
  if (af) af.addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const dataUrl = await fileToDataUrl(f);
    await chrome.storage.local.set({ avatar: dataUrl });
    const img = $('avatar-img');
    if (img) img.src = dataUrl;
    toast('头像已更新', 'success');
  });
  const lo = $('act-logout');
  if (lo) lo.addEventListener('click', async () => {
    await chrome.storage.local.remove('token');
    recState = { status: 'idle', liveJobs: [], result: null, error: '' };
    renderSub('请登录');
    renderResumeView();
  });
  const ni = $('nickname-input');
  if (ni) {
    chrome.storage.local.get('nickname', ({ nickname }) => { if (nickname) ni.value = nickname; });
    const ns = $('act-nickname-save');
    if (ns) ns.addEventListener('click', async () => {
      const name = ni.value.trim();
      if (!name) { toast('请输入昵称', 'error'); return; }
      await chrome.storage.local.set({ nickname: name });
      nickName = name;
      renderSub('已登录');
      toast('昵称已更新', 'success');
    });
  }
  const si = $('server-url-input');
  if (si) {
    chrome.storage.local.get('serverUrl', ({ serverUrl }) => { si.value = serverUrl || CLOUD_URL; });
    const ss = $('act-server-save');
    if (ss) ss.addEventListener('click', async () => {
      const url = si.value.trim();
      if (!url) { toast('请输入服务器地址', 'error'); return; }
      await chrome.storage.local.set({ serverUrl: url });
      CLOUD_URL = url;
      toast('服务器地址已保存', 'success');
    });
  }
}

// ---- ② 推荐视图 ----
function renderRecommendView() {
  const v = $('view');
  v.innerHTML = `
    <div class="glass-card">
      <div class="section-title">AI 推荐岗位</div>
      <div class="hint">根据简历画像，扫描各公司官网匹配岗位并打分（四段式漏斗：多关键词召回→粗排→精排）</div>
      <button class="btn btn-primary btn-block" id="act-recommend">${ICONS.search}开始推荐</button>
    </div>
    <div id="rec-result"></div>`;
  $('act-recommend').addEventListener('click', startRecommend);
  if (recState.status === 'running') renderRecommendRunning();
  else if (recState.status === 'done') renderRecommendDone(recState.result);
  else if (recState.status === 'error') $('rec-result').innerHTML = `<div class="hint">推荐失败：${escapeHtml(recState.error)}</div>`;
}

let pendingRecommend = false;
function startRecommend() {
  getProfile().then((profile) => {
    if (!profile) {
      pendingRecommend = true;
      toast('还没上传简历，先到「简历」上传', 'error');
      return;
    }
    runRecommend(profile);
  });
}

async function runRecommend(profile) {
  const btn = $('act-recommend');
  if (btn) btn.disabled = true;
  recState = { status: 'running', liveJobs: [], result: null, error: '' };
  renderRecommendRunning();
  try {
    const { jobId } = await api('/api/recommend', { profile });
    let task = { status: 'running' };
    for (let i = 0; i < 300 && task.status === 'running'; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      task = await (await fetch(`${CLOUD_URL}/api/scan/status?id=${jobId}`)).json();
      if (task.progress) $('progress').textContent = '⏳ ' + task.progress;
      if (task.live) {
        recState.liveJobs = task.live.slice(0, 30);
        if (currentView === 'recommend') renderRecommendRunning();
      }
    }
    $('progress').textContent = '';
    if (task.status === 'done') {
      recState = { status: 'done', liveJobs: recState.liveJobs, result: task.result, error: '' };
      if (currentView === 'recommend') renderRecommendDone(task.result);
      else renderSub('推荐完成，点「推荐」查看');
    } else if (task.status === 'error') {
      recState = { status: 'error', liveJobs: recState.liveJobs, result: null, error: task.error };
      if (currentView === 'recommend') $('rec-result').innerHTML = `<div class="hint">推荐失败：${escapeHtml(task.error)}</div>`;
    }
  } catch (e) {
    $('progress').textContent = '';
    recState = { status: 'error', liveJobs: [], result: null, error: e.message };
    if (currentView === 'recommend') $('rec-result').innerHTML = `<div class="hint">推荐失败：${e.message}</div>`;
  }
  if (btn) btn.disabled = false;
}

function liveCard(j) {
  const url = String(j.detailUrl || j.url || '').replace(/"/g, '&quot;');
  const el = document.createElement('a');
  el.className = 'live-card';
  el.href = url; el.target = '_blank'; el.rel = 'noopener';
  el.innerHTML = `<span class="live-c">${escapeHtml(j.company || '')}</span><span class="live-t">${escapeHtml(j.title || '')}</span>`;
  return el;
}

function renderRecommendRunning() {
  const box = $('rec-result');
  if (!box) return;
  box.innerHTML = `<div class="glass-card"><div class="live-title">正在扫描… 已发现 ${recState.liveJobs.length} 个岗位（首次约 1-2 分钟，可切走后台跑）</div><div class="live-list"></div></div>`;
  const list = box.querySelector('.live-list');
  recState.liveJobs.forEach((j) => list.appendChild(liveCard(j)));
}

function renderRecommendDone(result) {
  const box = $('rec-result');
  if (!box) return;
  const recs = (result.scored && result.scored.recommended) || [];
  const allJobs = result.allJobs || [];
  if (!recs.length && !allJobs.length) { box.innerHTML = '<div class="empty">没找到匹配的岗位，换个画像试试</div>'; return; }
  // 精排推荐区（A/B 档，高亮卡片）
  box.innerHTML = `<div class="glass-card"><div class="section-title">${ICONS.star}精排推荐 ${recs.length} 个（按匹配度排序）</div><div class="rec-list" id="rec-list"></div></div>`;
  const recList = box.querySelector('#rec-list');
  const PAGE = 20;
  let shown = Math.min(PAGE, recs.length);
  for (let i = 0; i < shown; i++) recList.appendChild(workbenchCard(recs[i]));
  if (recs.length > PAGE) {
    const more = document.createElement('button');
    more.className = 'more-btn';
    more.textContent = `展开全部 ${recs.length} 个 ↓`;
    more.addEventListener('click', () => {
      for (let i = shown; i < recs.length; i++) recList.appendChild(workbenchCard(recs[i]));
      shown = recs.length;
      more.remove();
    });
    recList.appendChild(more);
  }
  // 粗筛岗位区（召回全量里未进精排推荐的，折叠可展开投递）
  const recommendedIds = new Set(recs.map((j) => String(j.job_id)));
  const others = allJobs.filter((j) => !recommendedIds.has(String(j.job_id)));
  if (others.length) {
    const moreCard = document.createElement('div');
    moreCard.className = 'glass-card';
    moreCard.innerHTML = `<div class="section-title">${ICONS.list}粗筛岗位 ${others.length} 个</div><div class="hint">关键词匹配但未进精排，搜索或展开后点击卡片可去官网投递</div><input type="text" class="search-input" id="others-search" placeholder="搜索公司 / 岗位 / 城市…" /><button class="more-btn" id="show-others">展开全部 ${others.length} 个 ↓</button><div id="others-list" style="display:none"></div>`;
    box.appendChild(moreCard);
    const searchInput = moreCard.querySelector('#others-search');
    const showBtn = moreCard.querySelector('#show-others');
    const othersList = moreCard.querySelector('#others-list');
    let filtered = others;
    let othersShown = 0;
    const OTHERS_PAGE = 50;
    function loadOthers() {
      const next = Math.min(othersShown + OTHERS_PAGE, filtered.length);
      for (let i = othersShown; i < next; i++) othersList.appendChild(simpleCard(filtered[i]));
      othersShown = next;
      showBtn.textContent = othersShown >= filtered.length ? '收起 ↑' : `已显示 ${othersShown} 个，再加载 ${filtered.length - othersShown} 个 ↓`;
    }
    searchInput.addEventListener('input', () => {
      const kw = searchInput.value.trim().toLowerCase();
      filtered = kw ? others.filter((j) => String(j.company || '').toLowerCase().includes(kw) || String(j.title || '').toLowerCase().includes(kw) || String(j.city || '').toLowerCase().includes(kw)) : others;
      othersShown = 0;
      othersList.innerHTML = '';
      showBtn.textContent = filtered.length ? `展开全部 ${filtered.length} 个 ↓` : '无匹配岗位';
      if (othersList.style.display !== 'none' && filtered.length) loadOthers();
    });
    showBtn.addEventListener('click', () => {
      if (!filtered.length) return;
      if (othersList.style.display === 'none') {
        othersList.style.display = '';
        loadOthers();
      } else if (othersShown < filtered.length) {
        loadOthers();
      } else {
        othersList.style.display = 'none';
        showBtn.textContent = `展开全部 ${filtered.length} 个 ↓`;
      }
    });
  }
}

// 粗筛岗位简化卡片（公司 + 岗位 + 去投递）
function simpleCard(j) {
  const url = String(j.detailUrl || j.url || '').replace(/"/g, '&quot;');
  const el = document.createElement('div');
  el.className = 'apply-item';
  el.innerHTML = `<div class="a-top">${escapeHtml(j.company || '')} · ${escapeHtml(j.title || '')}</div><div class="a-meta">${escapeHtml(j.city || '')}</div><button class="apply-btn" data-jobid="${escapeHtml(j.job_id || '')}" data-company="${escapeHtml(j.company || '')}" data-url="${url}" style="margin-top:6px">去投递</button>`;
  return el;
}

// 投递工作台卡片：匹配度环 + 理由 + 匹配点 + 去投递锚定
function workbenchCard(j) {
  const score = Math.max(0, Math.min(100, Number(j.score) || 0));
  const tier = j.tier || 'C';
  const ringColor = { A: '#22c55e', B: '#1456F0', C: '#f59e0b', D: '#ef4444' }[tier] || '#94a3b8';
  const tierLabel = { A: '强推·优先投', B: '建议投', C: '可备选', D: '不建议' }[tier] || tier;
  const url = String(j.detailUrl || j.url || '').replace(/"/g, '&quot;');
  const city = escapeHtml(j.city || '');
  const replyRate = (j.replyRate !== undefined && j.replyRate !== null) ? ' · 回复率 ' + j.replyRate + '%' : '';
  const reason = escapeHtml(String(j.verdict || '')).slice(0, 100) || '（无判定理由）';
  const el = document.createElement('div');
  el.className = 'wb-card';
  el.innerHTML = `
    <div class="wb-head">
      <div class="ring" style="background: conic-gradient(${ringColor} 0 ${score}%, #eef1f5 ${score}% 100%)"><div class="ring-in"></div><div class="val">${score}</div></div>
      <div class="wb-info">
        <div class="wb-tt">${escapeHtml(j.title || '')} <span class="tier" style="background:${ringColor}1a;color:${ringColor}">${tierLabel}</span></div>
        <div class="wb-c">${escapeHtml(j.company || '')}${city ? ' · ' + city : ''}${replyRate}</div>
        <div class="wb-reason">${reason}</div>
      </div>
    </div>
    <div class="wb-points">${matchPoints(j.judge)}</div>
    <div class="wb-actions">
      <button class="apply-btn" data-jobid="${escapeHtml(j.job_id || j.id || '')}" data-company="${escapeHtml(j.company || '')}" data-url="${url}">去投递</button>
      <button class="tailor-btn">简历优化</button>
      <a class="wb-link" href="${url}" target="_blank" rel="noopener">查看官网 ↗</a>
    </div>`;
  el.querySelector('.tailor-btn').addEventListener('click', () => tailorResume(j));
  return el;
}

// 简历针对性优化：调后端 /api/resume/tailor，展示 JD↔简历匹配 + 定制建议
async function tailorResume(j) {
  const jd = j.jd || '';
  if (!jd) { toast('该岗位没有 JD 详情', 'error'); return; }
  const profile = await getProfile();
  if (!profile) { toast('还没上传简历，先到「简历」上传', 'error'); return; }
  $('progress').textContent = '简历优化分析中…';
  try {
    const tailored = await api('/api/resume/tailor', { jd, profile });
    $('progress').textContent = '';
    renderTailor(j, tailored);
  } catch (e) { $('progress').textContent = ''; toast('优化失败：' + e.message, 'error'); }
}

function renderTailor(j, t) {
  const box = $('rec-result');
  if (!box) return;
  const old = box.querySelector('#tailor-result');
  if (old) old.remove();
  const card = document.createElement('div');
  card.className = 'glass-card';
  card.id = 'tailor-result';
  let html = `<div class="section-title">${ICONS.file}简历优化建议 · ${escapeHtml(j.company || '')} ${escapeHtml(j.title || '')}</div>`;
  if (t.atsKeywords && t.atsKeywords.length) {
    html += `<div class="hint"><b>ATS 关键词：</b>${t.atsKeywords.map((k) => '<span class="pt ok" style="margin:0 4px 0 0">' + escapeHtml(k) + '</span>').join('')}</div>`;
  }
  if (t.covered && t.covered.length) {
    html += `<div class="hint" style="margin-top:8px"><b>✅ 已有优势（可强化）：</b></div>`;
    t.covered.forEach((c) => { html += `<div class="hint" style="margin:2px 0 0 10px">· <b>${escapeHtml(c.req)}</b> ↔ ${escapeHtml(c.match)}（${escapeHtml(c.strength)}）</div>`; });
  }
  if (t.gaps && t.gaps.length) {
    html += `<div class="hint" style="margin-top:8px"><b>⚠️ 缺口（诚实面对，不编造）：</b></div>`;
    t.gaps.forEach((g) => { html += `<div class="hint" style="margin:2px 0 0 10px">· <b>${escapeHtml(g.req)}</b>：${escapeHtml(g.advice)}</div>`; });
  }
  if (t.suggestions && t.suggestions.length) {
    html += `<div class="hint" style="margin-top:8px"><b>💡 定制建议：</b></div>`;
    t.suggestions.forEach((s) => { html += `<div class="hint" style="margin:2px 0 0 10px">· ${escapeHtml(s)}</div>`; });
  }
  card.innerHTML = html;
  box.insertBefore(card, box.firstChild);
  card.scrollIntoView();
}

function matchPoints(judge) {
  if (!judge) return `<span class="pt warn">${judgeText(judge)}</span>`;
  const n = (k) => Number(judge[k]) || 0;
  const duty = n('duty_match'), trans = n('transferable'), gap = n('skill_gap'), dir = n('direction');
  const p = (ok, txt) => `<span class="pt ${ok ? 'ok' : 'warn'}">${ok ? '✅' : '⚠️'} ${txt}</span>`;
  return p(duty >= 2, `职责匹配 ${duty}/2`) + p(trans >= 1, `经验可迁移 ${trans}/1`) + p(gap === 0, gap ? `技能差距 ${gap}` : '技能无差距') + p(dir >= 2, `方向匹配 ${dir}/2`);
}

// 去投递：存 pendingFill（含简历）→ 打开官网 → 标记已投
async function goApply(jobid, company, url) {
  let resumeFile = null;
  try {
    const r = await apiGet('/api/resume/file');
    if (r.ok) resumeFile = await r.json();
  } catch (e) {}
  await chrome.storage.local.set({ pendingFill: { url, jobid, company, resumeFile } });
  if (url) window.open(url, '_blank', 'noopener');
  try { await api('/api/applications/mark-applied', { job_id: jobid, company }); return true; }
  catch (e) { return false; }
}

// 事件委托：处理「去投递」按钮（乐观 UI：先显示已投，失败回滚）
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.apply-btn');
  if (!btn || btn.disabled) return;
  const { url, jobid, company } = btn.dataset;
  btn.disabled = true;
  btn.textContent = '已投 ✓';
  btn.classList.add('done');
  const ok = await goApply(jobid, company, url);
  if (ok) {
    toast('已标记已投，官网表单填好后记得点提交', 'success', 4000);
  } else {
    btn.textContent = '去投递';
    btn.classList.remove('done');
    btn.disabled = false;
    toast('标记失败，请重试', 'error');
  }
});

// ---- ③ 投递视图 ----
function renderApplyView() {
  const v = $('view');
  v.innerHTML = '<div class="glass-card" id="apply-box"><div class="hint">加载中…</div></div>';
  renderApplyList($('apply-box'));
}

async function renderApplyList(container) {
  try {
    const r = await apiGet('/api/applications');
    const apps = await r.json();
    if (!Array.isArray(apps) || !apps.length) {
      container.innerHTML = `<div class="empty" style="padding:32px 12px">
        <div style="color:#cbd5e1;margin-bottom:10px;display:flex;justify-content:center">${ICONS.list}</div>
        <div style="font-weight:600;color:#1F2329;margin-bottom:6px">还没有投递记录</div>
        <div style="font-size:12px;color:#8F959E;margin-bottom:14px">投过的岗位会在这里追踪进度</div>
        <button class="btn btn-primary" id="empty-go-recommend">去推荐岗位</button>
      </div>`;
      const btn = container.querySelector('#empty-go-recommend');
      if (btn) btn.addEventListener('click', () => switchView('recommend'));
      return;
    }
    const list = document.createElement('div');
    apps.slice(0, 50).forEach((a) => {
      const st = STATUS_LABEL[a.status] || a.status;
      const color = STATUS_COLOR[a.status] || '#64748b';
      const el = document.createElement('div');
      el.className = 'apply-item';
      el.innerHTML = `<div class="a-top">${escapeHtml(a.company || '')} · ${escapeHtml(a.title || '')}<span class="st-pill" style="background:${color}1a;color:${color}">${st}</span></div><div class="a-meta">${escapeHtml(a.city || '')}${a.applied_at ? ' · 投递于 ' + escapeHtml(a.applied_at) : ''}</div>`;
      list.appendChild(el);
    });
    container.innerHTML = `<div class="section-title">${ICONS.list}投递记录（${apps.length} 条）</div>`;
    container.appendChild(list);
    if (apps.length > 50) {
      const tip = document.createElement('div');
      tip.className = 'hint';
      tip.textContent = `…还有 ${apps.length - 50} 条，到「④ 看板」导 CSV 看全量`;
      container.appendChild(tip);
    }
  } catch (e) { container.innerHTML = '<div class="hint">获取投递记录失败：' + e.message + '</div>'; }
}

// ---- ④ 看板视图 ----
function renderBoardView() {
  const v = $('view');
  v.innerHTML = '<div class="glass-card" id="board-box"><div class="hint">加载中…</div></div>';
  renderBoard($('board-box'));
}

async function renderBoard(container) {
  try {
    const r = await apiGet('/api/stats');
    const stats = await r.json();
    if (!stats.total) {
      container.innerHTML = `<div class="empty" style="padding:32px 12px">
        <div style="color:#cbd5e1;margin-bottom:10px;display:flex;justify-content:center">${ICONS.chart}</div>
        <div style="font-weight:600;color:#1F2329;margin-bottom:6px">还没有投递数据</div>
        <div style="font-size:12px;color:#8F959E;margin-bottom:14px">投递后漏斗会在这里展示转化率</div>
        <button class="btn btn-primary" id="empty-go-recommend">去推荐岗位</button>
      </div>`;
      const btn = container.querySelector('#empty-go-recommend');
      if (btn) btn.addEventListener('click', () => switchView('recommend'));
      return;
    }
    const order = ['pending', 'applied', 'replied', 'interview', 'offer', 'rejected'];
    const counts = stats.counts || {};
    const max = Math.max(1, ...order.map((s) => counts[s] || 0));
    container.innerHTML = `<div class="section-title">${ICONS.chart}投递漏斗（共 ${stats.total} 个岗位 · 已投 ${stats.applied} · 回复率 ${stats.replyRate}%）</div>`;
    const funnel = document.createElement('div');
    order.forEach((s) => {
      const n = counts[s] || 0;
      const row = document.createElement('div');
      row.className = 'funnel-row';
      row.innerHTML = `<span style="width:44px;color:${STATUS_COLOR[s]}">${STATUS_LABEL[s]}</span><div class="funnel-bar"><div class="funnel-fill" style="width:${Math.round((n / max) * 100)}%;background:${STATUS_COLOR[s]}"></div></div><span style="width:30px;text-align:right">${n}</span>`;
      funnel.appendChild(row);
    });
    container.appendChild(funnel);
    const exportBtn = document.createElement('button');
    exportBtn.className = 'export-btn';
    exportBtn.innerHTML = `${ICONS.download}导出投递记录 CSV`;
    exportBtn.addEventListener('click', exportCSV);
    container.appendChild(exportBtn);
  } catch (e) { container.innerHTML = '<div class="hint">获取看板失败：' + e.message + '</div>'; }
}

async function exportCSV() {
  try {
    const r = await apiGet('/api/applications');
    const apps = await r.json();
    if (!Array.isArray(apps) || !apps.length) { toast('没有可导出的投递记录', 'error'); return; }
    const head = ['公司', '岗位', '状态', '城市', '投递时间', '链接'];
    const rows = apps.map((a) => [a.company, a.title, STATUS_LABEL[a.status] || a.status, a.city, a.applied_at, a.url].map((v) => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(','));
    const csv = '﻿' + head.join(',') + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '投递记录.csv';
    a.click();
    URL.revokeObjectURL(a.href);
    toast('已导出 CSV', 'success');
  } catch (e) { toast('导出失败：' + e.message, 'error'); }
}

// ---- 填当前表单（消息给 content script）----
$('act-fill').addEventListener('click', async () => {
  const profile = await getProfile();
  if (!profile) { toast('还没上传简历，先到「简历」上传', 'error'); return; }
  $('progress').textContent = '填表中…';
  let resumeFile = null;
  try {
    const r = await apiGet('/api/resume/file');
    if (r.ok) resumeFile = await r.json();
  } catch (e) {}
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) { $('progress').textContent = ''; toast('无法获取当前标签页', 'error'); return; }
  chrome.tabs.sendMessage(tab.id, { action: 'fill', profile, resumeFile }, (res) => {
    $('progress').textContent = '';
    if (chrome.runtime.lastError) { toast('当前页面无投递表单，请打开招聘官网的投递表单页', 'error', 4000); return; }
    if (res && res.ok) {
      const r = res.result;
      const tail = r.unfilled.length ? '，还有 ' + r.unfilled.length + ' 个未填：' + r.unfilled.slice(0, 8).map((f) => f.label).join('、') : '，基本填全 ✅';
      toast('已填 ' + r.written.length + ' 个字段' + tail, 'success', 4500);
    } else {
      toast(res && res.error ? res.error : '填表失败', 'error');
    }
  });
});

// ---- 初始化 ----
chrome.storage.local.get('serverUrl', ({ serverUrl }) => {
  if (serverUrl) CLOUD_URL = serverUrl;
});
getToken().then(async (token) => {
  const { nickname } = await chrome.storage.local.get('nickname');
  if (nickname) nickName = nickname;
  renderSub(token ? '已登录' : '请登录');
  switchView('resume');
});
// 恢复自定义头像
chrome.storage.local.get('avatar', ({ avatar }) => {
  if (avatar) { const img = $('avatar-img'); if (img) img.src = avatar; }
});
