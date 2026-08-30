'use strict';
// content script：纯填表执行器（无 UI）
// 接收 Side Panel 的 fill 命令，执行：上传简历 → 官网解析 → 规则兜底 → 报告未填字段
(function () {
  const { scanAndFill, uploadResumeFile } = window.JobStarAutofill;

  function detectApplyForm() {
    const els = [...document.querySelectorAll('input, select, textarea')].filter((el) => el.type !== 'hidden' && el.offsetParent !== null);
    const text = els.map((el) => [el.closest('label') ? el.closest('label').innerText : '', el.placeholder || '', el.name || ''].join(' ')).join(' ');
    return /姓名|手机号|邮箱|电子邮箱/.test(text);
  }

  function profileToValues(profile) {
    const edu0 = (profile.background && profile.background.education && profile.background.education[0]) || {};
    return {
      name: profile.identity.legal_name, phone: profile.contact.phone, email: profile.contact.email,
      gender: profile.identity.gender, birth: profile.identity.birth_date, hometown: profile.identity.hometown,
      degree: edu0.degree, school: edu0.school, major: edu0.major,
      grad: profile.job_search.graduation_year, eduStart: edu0.start,
      exp: profile.background.experience_summary, skill: (profile.background.skills || []).join('、'),
    };
  }

  // 扫描表单里还是空的字段（提醒用户手动补 + 检测字段识别准不准）
  function scanUnfilled() {
    const els = [...document.querySelectorAll('input, select, textarea')].filter((el) => el.type !== 'file' && el.type !== 'hidden' && el.type !== 'button' && el.type !== 'submit' && el.offsetParent !== null && !el.disabled && !el.readOnly);
    const unfilled = [];
    for (const el of els) {
      if ((el.value || '').trim()) continue;
      let label = '';
      const l = el.closest('label');
      if (l) label = l.innerText;
      if (!label) {
        let p = el.parentElement;
        for (let k = 0; k < 3 && p; k++) {
          if (/form-item|field-item|form-label|item-label/.test(p.className || '')) { label = (p.innerText || '').replace(/\d+\/\d+/g, '').trim(); break; }
          p = p.parentElement;
        }
      }
      if (!label) label = el.placeholder || el.name || el.id || el.getAttribute('data-form-field-name') || el.getAttribute('aria-label') || '';
      if (!label.trim()) continue;
      const sig = [el.getAttribute('data-form-field-name'), el.getAttribute('data-form-field-i18n-name'), el.placeholder, el.name].filter(Boolean).join('|');
      unfilled.push({ label: label.trim().slice(0, 20), sig: sig.slice(0, 40) });
    }
    return unfilled;
  }

  // 完整填表流程：① 上传简历让官网解析覆盖 → ② 规则匹配兜底 → ③ 报告未填字段
  async function doFill(profile, resumeFile) {
    let uploadStatus = '';
    if (resumeFile && resumeFile.fileData) {
      const up = uploadResumeFile(resumeFile.fileData, resumeFile.fileName, resumeFile.mimeType);
      if (up.ok) {
        uploadStatus = '简历已上传，官网解析覆盖中';
        await new Promise((r) => setTimeout(r, 6000)); // 等官网解析（异步）
      } else {
        uploadStatus = '简历上传失败：' + up.error;
      }
    }
    const result = scanAndFill(profileToValues(profile));
    const unfilled = scanUnfilled();
    return { written: result.written, unfilled, uploadStatus };
  }

  // 去投递自动填表：检测到投递表单 + pendingFill 标记 → 自动填
  let autoFillDone = false;
  async function tryAutoFill() {
    if (autoFillDone) return;
    try {
      const { pendingFill } = await chrome.storage.local.get('pendingFill');
      if (!pendingFill) return;
      if (!detectApplyForm()) return;
      const { profile } = await chrome.storage.local.get('profile');
      if (!profile) return;
      autoFillDone = true;
      await chrome.storage.local.remove('pendingFill');
      await doFill(profile, pendingFill.resumeFile);
    } catch (e) {}
  }

  // 监听 DOM 变化，检测到投递表单时触发自动填（去投递跳转后）
  const obs = new MutationObserver(() => {
    if (detectApplyForm()) tryAutoFill();
  });
  obs.observe(document.body || document.documentElement, { childList: true, subtree: true });
  if (detectApplyForm()) tryAutoFill();

  // 接收 Side Panel 的「填当前表单」命令
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'fill') {
      doFill(msg.profile, msg.resumeFile)
        .then((result) => sendResponse({ ok: true, result }))
        .catch((e) => sendResponse({ ok: false, error: e.message }));
      return true; // 异步 sendResponse
    }
  });
})();
