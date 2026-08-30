'use strict';
// popup：简历 → 画像 → 推荐 → 自动填充（调云端后端）
const CLOUD_URL = 'http://localhost:8630';

const $ = (id) => document.getElementById(id);

function refreshStatus() {
  chrome.storage.local.get('profile', ({ profile }) => {
    const name = profile && profile.identity && profile.identity.legal_name;
    $('status').textContent = name ? `已导入画像：${name}` : '未导入画像';
    $('status').style.color = name ? '#16a34a' : '#9ca3af';
    $('recommend-btn').disabled = !name;
  });
}
refreshStatus();

// 上传简历文件 → 云端解析（pdf/txt）
function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(binary);
}
async function saveProfile(profile) { await chrome.storage.local.set({ profile }); refreshStatus(); }

$('resume-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  $('parse-btn').disabled = true; $('parse-btn').textContent = '上传解析中…';
  try {
    const buf = await file.arrayBuffer();
    const base64 = arrayBufferToBase64(buf);
    const res = await fetch(`${CLOUD_URL}/api/resume/parse-file`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: file.name, fileData: base64 }),
    });
    const j = await res.json();
    if (!j.profile) throw new Error(j.error || '解析失败');
    await saveProfile(j.profile);
    alert('简历已解析，画像已生成');
  } catch (err) { alert('上传解析失败：' + err.message); }
  $('parse-btn').disabled = false; $('parse-btn').textContent = '① 解析画像';
});

// 解析简历 → 画像（调云端）
$('parse-btn').addEventListener('click', async () => {
  const text = $('resume-input').value.trim();
  if (!text) { alert('请先粘贴简历文本'); return; }
  $('parse-btn').disabled = true;
  $('parse-btn').textContent = '解析中…';
  try {
    const res = await fetch(`${CLOUD_URL}/api/resume/parse`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resumeText: text }),
    });
    const j = await res.json();
    if (!j.profile) throw new Error(j.error || '解析失败');
    await chrome.storage.local.set({ profile: j.profile });
    $('resume-input').value = '';
    refreshStatus();
    alert('画像已生成');
  } catch (e) { alert('解析失败：' + e.message); }
  $('parse-btn').disabled = false;
  $('parse-btn').textContent = '解析画像';
});

// 推荐岗位（调云端，异步轮询）
$('recommend-btn').addEventListener('click', async () => {
  const { profile } = await chrome.storage.local.get('profile');
  if (!profile) { alert('请先解析简历'); return; }
  $('recommend-btn').disabled = true;
  $('progress').textContent = '提交推荐任务…';
  $('recommend-list').innerHTML = '';
  try {
    const res = await fetch(`${CLOUD_URL}/api/recommend`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profile }),
    });
    const { jobId } = await res.json();
    if (!jobId) throw new Error('未返回任务 ID');
    // 轮询（扫描 171 家可能几分钟）
    let task = { status: 'running' };
    for (let i = 0; i < 300 && task.status === 'running'; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const sr = await fetch(`${CLOUD_URL}/api/scan/status?id=${jobId}`);
      task = await sr.json();
      $('progress').textContent = task.progress || '扫描中…';
    }
    if (task.status === 'done') renderRecommend(task.result);
    else if (task.status === 'error') alert('推荐失败：' + task.error);
  } catch (e) { alert('推荐失败：' + e.message); }
  $('recommend-btn').disabled = false;
});

function renderRecommend(result) {
  const recs = (result.scored && result.scored.recommended) || [];
  $('progress').textContent = '';
  if (!recs.length) { $('recommend-list').innerHTML = '<div class="empty">无推荐岗位</div>'; return; }
  const html = recs.slice(0, 30).map((j) => {
    const score = j.score || j.tierScore || '';
    const tier = j.tier ? `<span class="tier">${j.tier}档</span>` : '';
    const company = String(j.company || '').replace(/[<>]/g, '');
    const title = String(j.title || '').replace(/[<>]/g, '');
    const url = String(j.detailUrl || j.url || '').replace(/"/g, '&quot;');
    return `<a class="job" href="${url}" target="_blank" rel="noopener">
      <div class="job-company">${company} ${tier} ${score ? '<span class="score">' + score + '分</span>' : ''}</div>
      <div class="job-title">${title}</div>
    </a>`;
  }).join('');
  $('recommend-list').innerHTML = html;
}

// 填充当前表单（发消息给 content script）
$('fill-btn').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) { alert('无法获取当前标签页'); return; }
  chrome.tabs.sendMessage(tab.id, { action: 'fill' }, (res) => {
    if (chrome.runtime.lastError) { alert('当前页面无投递表单。请打开招聘官网的投递表单页再试。'); return; }
    if (res && res.ok) window.close();
    else if (res && res.error) alert(res.error);
  });
});
