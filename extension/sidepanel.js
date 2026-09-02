'use strict';
// Side Panel：求职星主工作台（页面式）
// 登录 / 上传简历 / 推荐 / 投递记录 / 看板漏斗 / 导出 / 卡片
// 填表动作通过 chrome.tabs.sendMessage 交给 content script 执行
let CLOUD_URL = 'http://182.92.156.235:8630'; // 默认云端，可在①简历页配置（本地开发改 localhost）
const $ = (id) => document.getElementById(id);

// ---- token / 画像管理 ----
async function getToken() { const { token } = await chrome.storage.local.get('token'); return token || ''; }
async function setToken(t) { await chrome.storage.local.set({ token: t }); }
function getProfile() { return new Promise((r) => chrome.storage.local.get('profile', ({ profile }) => r(profile || null))); }
async function setProfile(p) { await chrome.storage.local.set({ profile: p }); }

async function api(path, body, method = 'POST') {
  const token = await getToken();
  const res = await fetch(`${CLOUD_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((j && j.error) || `请求失败(${res.status})`);
  return j;
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
  filter: S + '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>',
};

// ---- 导航 + 视图切换 ----
const navItems = [...document.querySelectorAll('.nav-item[data-step]')];
function setNav(step) { navItems.forEach((x) => x.classList.toggle('active', x.dataset.step === step)); }
navItems.forEach((item) => {
  item.addEventListener('click', () => switchView(item.dataset.step));
});
// 「在新窗口打开」：Side Panel 太窄时，开独立窗口获得更大界面
document.getElementById('act-expand')?.addEventListener('click', () => {
  chrome.windows.create({ url: chrome.runtime.getURL('sidepanel.html'), type: 'popup', width: 480, height: 800 });
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
        const js = (profile && profile.job_search) || {};
        const bg = (profile && profile.background) || {};
        const edu = (bg.education && bg.education[0]) || {};
        const roles = Array.isArray(js.target_roles) ? js.target_roles.join('、') : '';
        const industries = Array.isArray(js.target_industries) ? js.target_industries.join('、') : '';
        const cities = Array.isArray(js.cities) ? js.cities.join('、') : '';
        const grad = js.graduation_year || '';
        const skills = Array.isArray(bg.skills) ? bg.skills.join('、') : '';
        const expSummary = bg.experience_summary || '';
        const work = Array.isArray(bg.work_experience) ? bg.work_experience.map((w) => `${w.company || ''}${w.title ? '·' + w.title : ''}`).filter(Boolean).join('；') : '';
        const summary = name
          ? `<div class="apply-item" style="margin-bottom:8px"><div class="a-top">👤 ${escapeHtml(name)}${edu.school ? ' · ' + escapeHtml(edu.school) : ''}${edu.degree ? ' · ' + escapeHtml(edu.degree) : ''}</div>${edu.major ? '<div class="a-meta">专业：' + escapeHtml(edu.major) + '</div>' : ''}</div>`
          : '<div class="hint">还没上传简历，先上传一份生成画像</div>';
        // AI 解析出的画像摘要（经历摘要 + 技能 + 经历），让用户能看到 AI 到底解析出了什么
        const aiSummary = (expSummary || skills || work)
          ? `<div class="glass-card" style="margin-bottom:8px;padding:10px 12px">${expSummary ? '<div class="a-meta" style="font-weight:700;color:#1F2329;margin-bottom:2px">经历摘要</div><div class="hint" style="margin:0 0 8px">' + escapeHtml(expSummary) + '</div>' : ''}${skills ? '<div class="a-meta" style="font-weight:700;color:#1F2329;margin-bottom:2px">技能</div><div class="hint" style="margin:0 0 8px">' + escapeHtml(skills) + '</div>' : ''}${work ? '<div class="a-meta" style="font-weight:700;color:#1F2329;margin-bottom:2px">经历</div><div class="hint" style="margin:0">' + escapeHtml(work) + '</div>' : ''}</div>`
          : '';
        $('resume-box').innerHTML = `
          <div class="section-title">简历画像</div>
          ${summary}
          ${aiSummary}
          <label class="btn btn-primary btn-block upload-btn">${ICONS.file}上传简历<input type="file" id="file" accept=".pdf,.txt,.doc,.docx" style="display:none" /></label>
          <div class="hint" style="margin-top:10px">下面是推荐会用到的求职意向，解析不准就改一下：</div>
          <label class="field-label" for="pf-roles">目标方向</label>
          <input type="text" id="pf-roles" class="search-input" placeholder="如：采购、供应链" value="${escapeHtml(roles)}" />
          <label class="field-label" for="pf-industries">目标行业</label>
          <input type="text" id="pf-industries" class="search-input" placeholder="如：互联网、制造业" value="${escapeHtml(industries)}" />
          <label class="field-label" for="pf-cities">目标城市</label>
          <input type="text" id="pf-cities" class="search-input" placeholder="如：北京、上海、深圳" value="${escapeHtml(cities)}" />
          <label class="field-label" for="pf-grad">毕业年份</label>
          <input type="text" id="pf-grad" class="search-input" placeholder="如：2027届" value="${escapeHtml(grad)}" />
          <button class="btn btn-primary btn-block" id="act-pf-save">${ICONS.star}保存画像</button>
          <div class="section-title" style="margin-top:14px">昵称</div>
          <input type="text" class="search-input" id="nickname-input" placeholder="输入昵称" />
          <button class="btn btn-ghost btn-block" id="act-nickname-save">保存昵称</button>
          <div class="section-title" style="margin-top:14px">头像</div>
          <label class="btn btn-ghost btn-block upload-btn">${ICONS.image}上传头像<input type="file" id="avatar-file" accept="image/*" style="display:none" /></label>
          <div class="section-title" style="margin-top:14px">服务器地址（上云改这里）</div>
          <input type="text" class="search-input" id="server-url-input" placeholder="http://182.92.156.235:8630" />
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
      await chrome.storage.local.remove(['profile', 'avatar', 'nickname']); // 清旧账号用户态，防跨账号残留
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
      await chrome.storage.local.remove(['profile', 'avatar', 'nickname']); // 清旧账号用户态，防跨账号残留
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
  const pfSave = $('act-pf-save');
  if (pfSave) pfSave.addEventListener('click', async () => {
    const profile = await getProfile();
    if (!profile) { toast('先上传简历生成画像', 'error'); return; }
    profile.job_search = profile.job_search || {};
    profile.job_search.target_roles = ($('pf-roles').value || '').split(/[、,，\s]+/).filter(Boolean);
    profile.job_search.target_industries = ($('pf-industries').value || '').split(/[、,，\s]+/).filter(Boolean);
    profile.job_search.cities = ($('pf-cities').value || '').split(/[、,，\s]+/).filter(Boolean);
    profile.job_search.graduation_year = ($('pf-grad').value || '').trim();
    await setProfile(profile);
    toast('画像已保存，去「推荐」找岗位吧', 'success');
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
    await chrome.storage.local.remove(['token', 'profile', 'avatar', 'nickname']);
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
      if (task.progress) { recState.progress = task.progress; $('progress').textContent = '⏳ ' + task.progress; }
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
  const stage = recState.progress ? `<div class="live-title" style="color:#1456F0;font-weight:600;margin-top:2px">⏳ ${escapeHtml(recState.progress)}</div>` : '';
  box.innerHTML = `<div class="glass-card"><div class="live-title">正在扫描… 已发现 ${recState.liveJobs.length} 个岗位（首次约 1-2 分钟，可切走后台跑）</div>${stage}<div class="live-list"></div></div>`;
  const list = box.querySelector('.live-list');
  recState.liveJobs.forEach((j) => list.appendChild(liveCard(j)));
}

function renderRecommendDone(result) {
  const box = $('rec-result');
  if (!box) return;
  const recs = (result.scored && result.scored.recommended) || [];
  const allJobs = result.allJobs || [];
  if (!recs.length && !allJobs.length) { box.innerHTML = '<div class="empty">没找到匹配的岗位，换个画像试试</div>'; return; }

  const recommendedIds = new Set(recs.map((j) => String(j.job_id)));
  const others = allJobs.filter((j) => !recommendedIds.has(String(j.job_id)));
  const filter = { city: '', industry: '', section: '', company: '' };
  let companyTimer = null; // 公司搜索 debounce（避免每输入一个字就重建 DOM 导致失焦）

  // 筛选选项（去重排序）：城市用拆分后的 cities 数组（修「200 多个城市」bug）
  const uniqSorted = (list, key) => [...new Set(list.map((j) => String(j[key] || '').trim()).filter(Boolean))].sort();
  const cities = [...new Set([...recs, ...others].flatMap((j) => (j.cities && j.cities.length) ? j.cities : [j.city]).filter(Boolean))].sort();
  const industries = uniqSorted([...recs, ...others], 'industry');
  const SECTION_LABEL = { campus: '校招', intern: '实习', social: '社招' };
  const sections = [...new Set([...recs, ...others].map((j) => String(j.section || '').trim()).filter(Boolean))];
  const match = (j) =>
    (!filter.company || String(j.company || '').toLowerCase().includes(filter.company.toLowerCase()) || String(j.title || '').toLowerCase().includes(filter.company.toLowerCase())) &&
    (!filter.city || ((j.cities && j.cities.length) ? j.cities : [j.city]).some((c) => String(c || '') === filter.city)) &&
    (!filter.industry || String(j.industry || '') === filter.industry) &&
    (!filter.section || String(j.section || '') === filter.section);

  function render() {
    const fRecs = recs.filter(match);
    const fOthers = others.filter(match);
    const sel = (key, vals, label, labelMap) => `<select class="filter-select" id="f-${key}"><option value="">${label}${vals.length ? '（' + vals.length + '）' : ''}</option>${vals.map((v) => `<option value="${escapeHtml(v)}"${filter[key] === v ? ' selected' : ''}>${escapeHtml(labelMap ? (labelMap[v] || v) : v)}</option>`).join('')}</select>`;
    const hasFilter = filter.city || filter.industry || filter.section || filter.company;
    const filterBar = `<div class="filter-bar">${ICONS.filter}${sel('section', sections, '类型', SECTION_LABEL)}${sel('industry', industries, '行业')}${sel('city', cities, '城市')}<input type="text" class="search-input" id="f-company" placeholder="搜索公司/岗位…" style="flex:1;min-width:110px;margin:0" value="${escapeHtml(filter.company)}" />${hasFilter ? '<button class="mini-btn" id="f-clear">清除</button>' : ''}</div>`;

    // 精排推荐区（A/B 档，高亮卡片）
    box.innerHTML = `<div class="glass-card">${filterBar}<div class="section-title">${ICONS.star}精排推荐 ${fRecs.length} 个（按匹配度排序）</div><div class="rec-list" id="rec-list"></div></div>`;
    const recList = box.querySelector('#rec-list');
    const PAGE = 20;
    let shown = Math.min(PAGE, fRecs.length);
    for (let i = 0; i < shown; i++) recList.appendChild(workbenchCard(fRecs[i]));
    if (fRecs.length > PAGE) {
      const more = document.createElement('button');
      more.className = 'more-btn';
      more.textContent = `展开全部 ${fRecs.length} 个 ↓`;
      more.addEventListener('click', () => {
        for (let i = shown; i < fRecs.length; i++) recList.appendChild(workbenchCard(fRecs[i]));
        shown = fRecs.length;
        more.remove();
      });
      recList.appendChild(more);
    }

    // 更多相关岗位区（召回全量里未进精排推荐的，折叠可展开投递）
    if (fOthers.length) {
      const moreCard = document.createElement('div');
      moreCard.className = 'glass-card';
      moreCard.innerHTML = `<div class="section-title">${ICONS.list}更多相关岗位 ${fOthers.length} 个</div><div class="hint">跟你的画像沾边、但匹配度没进前几名的岗位，展开看看有没有漏网的。</div><input type="text" class="search-input" id="others-search" placeholder="搜索公司 / 岗位 / 城市…" /><button class="more-btn" id="show-others">展开全部 ${fOthers.length} 个 ↓</button><div id="others-list" style="display:none"></div>`;
      box.appendChild(moreCard);
      const searchInput = moreCard.querySelector('#others-search');
      const showBtn = moreCard.querySelector('#show-others');
      const othersList = moreCard.querySelector('#others-list');
      let filtered = fOthers;
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
        filtered = kw ? fOthers.filter((j) => String(j.company || '').toLowerCase().includes(kw) || String(j.title || '').toLowerCase().includes(kw) || String(j.city || '').toLowerCase().includes(kw)) : fOthers;
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

    // 筛选器事件（重渲染）
    box.querySelector('#f-section')?.addEventListener('change', (e) => { filter.section = e.target.value; render(); });
    box.querySelector('#f-industry')?.addEventListener('change', (e) => { filter.industry = e.target.value; render(); });
    box.querySelector('#f-city')?.addEventListener('change', (e) => { filter.city = e.target.value; render(); });
    box.querySelector('#f-company')?.addEventListener('input', (e) => { filter.company = e.target.value; clearTimeout(companyTimer); companyTimer = setTimeout(() => render(), 300); });
    box.querySelector('#f-clear')?.addEventListener('click', () => { filter.city = ''; filter.industry = ''; filter.section = ''; filter.company = ''; render(); });
  }
  render();
}

// 粗筛岗位简化卡片（公司 + 岗位 + 去投递）
function simpleCard(j) {
  const url = String(j.detailUrl || j.url || '').replace(/"/g, '&quot;');
  const secLabel = { campus: '校招', intern: '实习', social: '社招' }[j.section] || '';
  const secColor = { campus: '#16a34a', intern: '#f59e0b', social: '#3b82f6' }[j.section] || '#94a3b8';
  const sectionTag = secLabel ? `<span class="sec-tag" style="color:${secColor};border-color:${secColor}">${secLabel}</span>` : '';
  const el = document.createElement('div');
  el.className = 'apply-item';
  el.innerHTML = `<div class="a-top">${escapeHtml(j.company || '')} · ${escapeHtml(j.title || '')}</div><div class="a-meta">${escapeHtml(j.city || '')}${sectionTag}</div><div class="wb-actions"><button class="add-board-btn" data-jobid="${escapeHtml(j.job_id || '')}" data-company="${escapeHtml(j.company || '')}" data-title="${escapeHtml(j.title || '')}" data-url="${url}" data-city="${escapeHtml(j.city || '')}" data-section="${escapeHtml(j.section || 'campus')}">加入待投</button><a class="wb-link" href="${url}" target="_blank" rel="noopener">查看官网 ↗</a></div>`;
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
  const redFlags = Array.isArray(j.redFlags) && j.redFlags.length ? j.redFlags : [];
  const flagHtml = redFlags.length ? `<div class="wb-flags">${redFlags.map((f) => `<span class="flag-tag">⚠ ${escapeHtml(f)}</span>`).join('')}</div>` : '';
  const secLabel = { campus: '校招', intern: '实习', social: '社招' }[j.section] || '';
  const secColor = { campus: '#16a34a', intern: '#f59e0b', social: '#3b82f6' }[j.section] || '#94a3b8';
  const sectionTag = secLabel ? `<span class="sec-tag" style="color:${secColor};border-color:${secColor}">${secLabel}</span>` : '';
  const el = document.createElement('div');
  el.className = 'wb-card';
  el.innerHTML = `
    <div class="wb-head">
      <div class="ring" style="background: conic-gradient(${ringColor} 0 ${score}%, #eef1f5 ${score}% 100%)"><div class="ring-in"></div><div class="val">${score}</div></div>
      <div class="wb-info">
        <div class="wb-tt">${escapeHtml(j.title || '')} <span class="tier" style="background:${ringColor}1a;color:${ringColor}">${tierLabel}</span></div>
        <div class="wb-c">${escapeHtml(j.company || '')}${city ? ' · ' + city : ''}${replyRate}${sectionTag}</div>
        <div class="wb-reason">${reason}</div>
        ${flagHtml}
      </div>
    </div>
    <div class="wb-points">${matchPoints(j.judge)}</div>
    <div class="wb-actions">
      <button class="add-board-btn" data-jobid="${escapeHtml(j.job_id || j.id || '')}" data-company="${escapeHtml(j.company || '')}" data-title="${escapeHtml(j.title || '')}" data-url="${url}" data-city="${escapeHtml(j.city || '')}" data-section="${escapeHtml(j.section || 'campus')}">加入待投</button>
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
  // 四维可视化条：职责(0-2)、经验(0-1)、技能(差距越小越满)、方向(0-2)
  const dims = [
    { label: '职责', pct: Math.round(duty / 2 * 100), good: duty >= 2 },
    { label: '经验', pct: Math.round(Math.min(trans, 1) * 100), good: trans >= 1 },
    { label: '技能', pct: gap === 0 ? 100 : Math.max(0, Math.round((1 - gap / 3) * 100)), good: gap === 0 },
    { label: '方向', pct: Math.round(dir / 2 * 100), good: dir >= 2 },
  ];
  const bar = (d) => `<div class="dim" title="${d.label} ${d.pct}%"><span class="dim-label">${d.label}</span><div class="dim-bar"><div class="dim-fill ${d.good ? 'good' : 'bad'}" style="width:${Math.max(4, d.pct)}%"></div></div></div>`;
  return `<div class="match-dims">${dims.map(bar).join('')}</div>`;
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

// 事件委托：处理「加入待投」（推荐卡片）+「去投递」（待投卡片）
document.addEventListener('click', async (e) => {
  // 加入待投：推荐卡片 → 手动加入待投列表（不自动投递）
  const addBtn = e.target.closest('.add-board-btn');
  if (addBtn && !addBtn.disabled) {
    const { url, jobid, company, title, city, section } = addBtn.dataset;
    // 已加入 → 再点直接去投递（打开官网 + 标记已投），一步到位不切视图
    if (addBtn.dataset.added === '1') {
      addBtn.disabled = true; addBtn.textContent = '去投递中…';
      await goApply(jobid, company, url);
      addBtn.disabled = false; addBtn.textContent = '已投 ✓';
      toast('已打开官网并标记已投，表单填好记得点提交', 'success', 4000);
      return;
    }
    addBtn.disabled = true;
    addBtn.textContent = '去投递 →';
    try {
      await api('/api/applications', { company, title, url, city, job_id: jobid, section, status: 'pending' });
      addBtn.dataset.added = '1';
      addBtn.disabled = false;
      toast('已加入待投 ✓ 再点一下「去投递」打开官网', 'success', 3500);
    } catch (err) {
      addBtn.disabled = false;
      addBtn.textContent = '加入待投';
      toast('加入失败，请重试', 'error');
    }
    return;
  }
  // 去投递：待投卡片 → 打开官网 + 标记已投（乐观 UI）
  const btn = e.target.closest('.apply-btn');
  if (!btn || btn.disabled) return;
  const { url, jobid, company } = btn.dataset;
  btn.disabled = true;
  btn.textContent = '已投 ✓';
  btn.classList.add('done');
  const ok = await goApply(jobid, company, url);
  if (ok) {
    toast('已标记已投，官网表单填好后记得点提交', 'success', 4000);
    const applyBox = $('apply-box');
    if (applyBox) renderApplyList(applyBox);  // 刷新投递列表，立即显示「已投 + 投递时间」
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
  v.innerHTML = `<div class="glass-card" id="email-box">
      <div class="section-title">${ICONS.list}邮件同步（自动更新投递状态）</div>
      <div class="hint">配置求职邮箱（QQ/163），自动识别面试邀约 / 拒信 / Offer，更新投递状态——不用登录任何招聘系统。授权码只保存在本地浏览器，不上传服务器。<b>不配置也能用：</b>在下方投递记录里手动更新状态即可。</div>
      <label class="field-label" for="email-addr">求职邮箱</label>
      <input type="text" id="email-addr" class="search-input" placeholder="如 xxx@qq.com" />
      <label class="field-label" for="email-auth">IMAP 授权码</label>
      <input type="password" id="email-auth" class="search-input" placeholder="授权码（非登录密码，生成一次长期有效）" />
      <div class="hint" style="margin:-2px 2px 0">去哪找：邮箱「设置 → 账户」开启 IMAP/SMTP 服务后生成授权码；生成一次即可，不用每次重新生成。</div>
      <button class="btn btn-primary" id="email-sync-btn" style="width:100%;margin-top:10px">同步邮件</button>
      <div id="email-result"></div>
    </div>
    <div class="glass-card" id="apply-box"><div class="hint">加载中…</div></div>`;
  // 记住的邮箱 + 授权码（本地 chrome.storage，切换视图/重开不丢，不上传后端）
  chrome.storage.local.get('emailCfg', ({ emailCfg }) => {
    if (emailCfg) {
      const ea = $('email-addr'), au = $('email-auth');
      if (ea && emailCfg.email) ea.value = emailCfg.email;
      if (au && emailCfg.authCode) au.value = emailCfg.authCode;
    }
  });
  // 恢复上次同步结果（切换视图不丢，直接显示上次识别结果）
  chrome.storage.local.get('emailResults', ({ emailResults }) => {
    if (emailResults && Array.isArray(emailResults.results)) {
      renderEmailResults($('email-result'), emailResults.results, emailResults.at);
    }
  });
  renderApplyList($('apply-box'));
  const syncBtn = $('email-sync-btn');
  if (syncBtn) syncBtn.addEventListener('click', async () => {
    const email = $('email-addr').value.trim();
    const authCode = $('email-auth').value.trim();
    if (!email || !authCode) { toast('请填写邮箱和授权码', 'error'); return; }
    syncBtn.disabled = true; syncBtn.textContent = '同步中…';
    const resultBox = $('email-result');
    resultBox.innerHTML = '<div class="hint">正在拉取邮件并识别…（约 30 秒）</div>';
    try {
      const data = await api('/api/email/sync', { email, authCode });
      if (data.error) throw new Error(data.error);
      chrome.storage.local.set({ emailCfg: { email, authCode } });  // 记住，下次不用重新输入
      // 合并新旧结果（增量同步只拉新邮件，合并历史避免「9封变2封」）
      const { emailResults: old } = await chrome.storage.local.get('emailResults');
      const merged = mergeEmailResults(data.results, (old && old.results) || []);
      chrome.storage.local.set({ emailResults: { results: merged, at: Date.now() } });
      renderEmailResults(resultBox, merged, Date.now());
    } catch (e) {
      resultBox.innerHTML = '<div class="hint">同步失败：' + escapeHtml(e.message) + '</div>';
    } finally {
      syncBtn.disabled = false; syncBtn.textContent = '同步邮件';
    }
  });
}

// 合并新旧邮件结果（按 messageId 去重，新的在前）——增量同步只拉新邮件，合并历史避免「9封变2封」
function mergeEmailResults(newResults, oldResults) {
  const seen = new Set();
  const out = [];
  for (const r of [...(newResults || []), ...(oldResults || [])]) {
    const key = r.messageId || (r.subject + '|' + r.from + '|' + r.status);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  const sameDay = d.toDateString() === new Date().toDateString();
  const hm = p(d.getHours()) + ':' + p(d.getMinutes());
  return sameDay ? hm : p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + hm;
}

function renderEmailResults(container, results, at) {
  const timeTag = at ? ' · 同步于 ' + fmtTime(at) : '';
  if (!results || !results.length) {
    container.innerHTML = '<div class="hint">没有识别到求职相关邮件（面试/拒信/Offer）' + timeTag + '。提示：企业通知可能发短信，邮箱没消息不代表没进展。</div>';
    return;
  }
  const LBL = { interview: '面试邀约', offer: 'Offer', rejected: '拒信', assessment: '笔试测评' };
  const COL = { interview: '#8b5cf6', offer: '#22c55e', rejected: '#ef4444', assessment: '#eab308' };
  const list = document.createElement('div');
  list.style.maxHeight = '320px';   // 邮件多时可滚动看全量，不被压缩成 2 条
  list.style.overflowY = 'auto';
  list.style.paddingRight = '2px';
  results.forEach((r) => {
    const el = document.createElement('div');
    el.className = 'apply-item';
    const label = LBL[r.status] || r.status;
    const color = COL[r.status] || '#64748b';
    const matched = r.matchedApp;
    const candidates = r.candidates || [];

    let actionHtml;
    if (r.confidence === 'high' && matched) {
      // 唯一强匹配 → 确认更新
      actionHtml = `<div class="a-meta" style="margin-top:4px">匹配：${escapeHtml(matched.company)} · ${escapeHtml(matched.title)}（当前 ${escapeHtml(STATUS_LABEL[matched.status] || matched.status)}）<button class="email-confirm-btn" data-appid="${escapeHtml(matched.id)}" data-status="${escapeHtml(r.status)}" style="margin-left:8px">确认更新</button></div>`;
    } else if (r.confidence === 'medium' && candidates.length) {
      // 公司命中、岗位存疑 → 候选点选
      const candHtml = candidates.map((c) => `<button class="email-confirm-btn" data-appid="${escapeHtml(c.id)}" data-status="${escapeHtml(r.status)}" style="margin:3px 4px 0 0">${escapeHtml(c.title || c.company)}${matched && matched.id === c.id ? ' ·推荐' : ''}</button>`).join('');
      actionHtml = `<div class="a-meta" style="margin-top:4px">同公司 ${candidates.length} 个岗位，请点选对应岗位：</div><div style="margin-top:2px">${candHtml}</div>`;
    } else {
      // 无匹配 → orphan
      actionHtml = '<div class="a-meta" style="margin-top:4px;color:#94a3b8">未匹配到投递记录（公司名可能不同，可手动去投递列表改状态）</div>';
    }

    el.innerHTML = `<div class="a-top"><span class="st-pill" style="background:${color}1a;color:${color}">${label}</span> ${escapeHtml(r.company || '未知公司')}${r.title ? ' · ' + escapeHtml(r.title) : ''}</div>
      <div class="a-meta">${escapeHtml(r.subject || '')}${r.interviewTime ? ' · ' + escapeHtml(r.interviewTime) : ''}${r.matchedBy === 'llm' ? ' · AI 识别' : ''}</div>
      ${actionHtml}`;
    list.appendChild(el);
  });
  container.innerHTML = '<div class="section-title">识别到 ' + results.length + ' 封求职邮件' + timeTag + '</div>';
  container.appendChild(list);
  container.querySelectorAll('.email-confirm-btn').forEach((btn) => btn.addEventListener('click', async () => {
    // appid 是 UUID 字符串，不能 Number()（会变 NaN 导致查不到记录）
    await api('/api/email/apply', { appId: btn.dataset.appid, status: btn.dataset.status });
    toast('已更新投递状态', 'success');
    btn.textContent = '已更新'; btn.disabled = true;
  }));
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
    const DISMISS_REASONS = ['公司不感兴趣', '岗位方向不符', '薪资低', '地点不符', '其他'];
    apps.slice(0, 50).forEach((a) => {
      const st = STATUS_LABEL[a.status] || a.status;
      const color = STATUS_COLOR[a.status] || '#64748b';
      const el = document.createElement('div');
      el.className = 'apply-item';
      const canDismiss = a.status !== 'dismissed';
      const canApply = a.status === 'pending';
      el.innerHTML = `<div class="a-top">${escapeHtml(a.company || '')} · ${escapeHtml(a.title || '')}<span class="st-pill" style="background:${color}1a;color:${color}">${st}</span></div><div class="a-meta">${escapeHtml(a.city || '')}${a.applied_at ? ' · 投递于 ' + escapeHtml(a.applied_at) : ''}${canDismiss ? '<button class="dismiss-btn" style="margin-left:8px">移除</button>' : ''}</div>${canApply ? `<button class="apply-btn" data-jobid="${escapeHtml(a.job_id || '')}" data-company="${escapeHtml(a.company || '')}" data-url="${escapeHtml(a.url || '')}" style="margin-top:6px">去投递</button>` : ''}`;
      const dismissBtn = el.querySelector('.dismiss-btn');
      if (dismissBtn) dismissBtn.addEventListener('click', () => {
        // 展开原因选择（Boss 直聘式：标记原因 → 精准降权）
        const reasonBox = document.createElement('div');
        reasonBox.className = 'dismiss-reasons';
        reasonBox.innerHTML = DISMISS_REASONS.map((r) => `<button class="reason-btn" data-reason="${escapeHtml(r)}">${escapeHtml(r)}</button>`).join('') + '<button class="reason-btn reason-cancel">取消</button>';
        dismissBtn.replaceWith(reasonBox);
        reasonBox.querySelectorAll('.reason-btn').forEach((btn) => btn.addEventListener('click', async () => {
          if (btn.classList.contains('reason-cancel')) { reasonBox.replaceWith(dismissBtn); return; }
          await api('/api/applications/' + encodeURIComponent(a.id), { status: 'dismissed', dismiss_reason: btn.dataset.reason }, 'PATCH');
          toast('已移除（' + btn.dataset.reason + '），将减少相似推荐', 'success');
          renderApplyList(container);
        }));
      });
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
    container.innerHTML = `<div class="section-title">${ICONS.chart}投递漏斗（共 ${stats.total} 个岗位 · 已投 ${stats.applied} · 回复率 ${stats.replyRate}%）<a class="export-link" id="export-link">${ICONS.download}导出 CSV</a></div>`;
    container.querySelector('#export-link').addEventListener('click', exportCSV);
    const funnel = document.createElement('div');
    order.forEach((s) => {
      const n = counts[s] || 0;
      const row = document.createElement('div');
      row.className = 'funnel-row';
      if (n) row.style.cursor = 'pointer';
      row.title = n ? '点击展开该状态的具体岗位' : '';
      row.innerHTML = `<span style="width:44px;color:${STATUS_COLOR[s]}">${STATUS_LABEL[s]}</span><div class="funnel-bar"><div class="funnel-fill" style="width:${Math.round((n / max) * 100)}%;background:${STATUS_COLOR[s]}"></div></div><span style="width:30px;text-align:right">${n}</span>`;
      if (n) row.addEventListener('click', () => toggleStatusDetail(row, s));
      funnel.appendChild(row);
    });
    container.appendChild(funnel);
  } catch (e) { container.innerHTML = '<div class="hint">获取看板失败：' + e.message + '</div>'; }
}

// 漏斗下钻：点击某状态，展开该状态下的具体岗位（懒加载 applications）
async function toggleStatusDetail(row, status) {
  const existing = row.nextElementSibling;
  if (existing && existing.classList.contains('status-detail')) { existing.remove(); return; }
  const detail = document.createElement('div');
  detail.className = 'status-detail';
  detail.style.margin = '0 0 8px 24px';
  detail.innerHTML = '<div class="hint">加载中…</div>';
  row.after(detail);
  try {
    const r = await apiGet('/api/applications');
    const apps = await r.json();
    const list = (Array.isArray(apps) ? apps : []).filter((a) => a.status === status);
    if (!list.length) { detail.innerHTML = '<div class="hint" style="color:#94a3b8">无</div>'; return; }
    detail.innerHTML = list.map((a) => {
      const url = String(a.url || '').replace(/"/g, '&quot;');
      const link = url ? `<a class="wb-link" href="${url}" target="_blank" rel="noopener" style="margin-left:8px">去官网 ↗</a>` : '';
      return `<div class="apply-item" style="margin-bottom:6px"><div class="a-top">${escapeHtml(a.company || '')} · ${escapeHtml(a.title || '')}${link}</div><div class="a-meta">${escapeHtml(a.city || '')}${a.applied_at ? ' · 投递于 ' + escapeHtml(a.applied_at) : ''}</div></div>`;
    }).join('');
  } catch (e) {
    detail.innerHTML = '<div class="hint">加载失败：' + escapeHtml(e.message) + '</div>';
  }
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

// 检测浏览器，返回对应的扩展管理页地址（Edge/Chrome/Opera/Brave/Firefox）
function getExtensionsUrl() {
  const ua = navigator.userAgent || '';
  if (ua.includes('Edg/')) return 'edge://extensions';
  if (ua.includes('Firefox/')) return 'about:addons';
  if (ua.includes('OPR/')) return 'opera://extensions';
  if (ua.includes('Brave')) return 'brave://extensions';
  return 'chrome://extensions';
}

// ---- 版本更新提醒：扩展版本落后于后端 → 提示重新加载扩展 ----
async function checkUpdate() {
  try {
    const manifestVer = chrome.runtime.getManifest().version;
    const res = await fetch(`${CLOUD_URL}/healthz`);
    const h = await res.json();
    const serverVer = h.version || '';
    if (!serverVer) return;
    const cmp = (a, b) => {
      const x = String(a).split('.').map(Number);
      const y = String(b).split('.').map(Number);
      for (let i = 0; i < Math.max(x.length, y.length); i++) {
        const d = (x[i] || 0) - (y[i] || 0);
        if (d) return d;
      }
      return 0;
    };
    if (cmp(manifestVer, serverVer) < 0) {
      toast('求职星有新版本 v' + serverVer + '，请在 ' + getExtensionsUrl() + ' 重新加载扩展（否则新功能不生效）', 'info', 7000);
    }
  } catch {}
}

// ---- 初始化 ----
chrome.storage.local.get('serverUrl', ({ serverUrl }) => {
  if (serverUrl) CLOUD_URL = serverUrl;
});
getToken().then(async (token) => {
  const { nickname } = await chrome.storage.local.get('nickname');
  if (nickname) nickName = nickname;
  renderSub(token ? '已登录' : '请登录');
  switchView('resume');
  checkUpdate();
});
// 恢复自定义头像
chrome.storage.local.get('avatar', ({ avatar }) => {
  if (avatar) { const img = $('avatar-img'); if (img) img.src = avatar; }
});

// content script 请求：LLM 字段语义映射（只转字段描述符，不含简历值，隐私设计）
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'map-fields') {
    api('/api/autofill/map-fields', { signals: msg.signals, keys: msg.keys })
      .then((data) => sendResponse({ mapping: (data && data.mapping) || [] }))
      .catch(() => sendResponse({ mapping: [] }));
    return true; // 异步 sendResponse
  }
});
