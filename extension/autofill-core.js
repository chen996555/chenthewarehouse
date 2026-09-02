'use strict';
// 求职星 · 自动填充核心（浏览器扩展版）
// 从 tracker/autofill.js 提炼的纯浏览器逻辑：字段检测 → 语义匹配 → React 安全写值

(function () {
  // ---- 归一化 ----
  function normalizeText(s) {
    return String(s || '')
      .trim().toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[()（）[\]【】{}<>]/g, '')
      .replace(/[.,，/\\\-_:：;+*"'`“”‘’]/g, '');
  }

  // ---- 字段语义规则（key + section + 关键词）----
  const FIELD_RULES = [
    { key: 'name', section: 'personal', kw: ['姓名', '名字', 'name', '真实姓名', '中文姓名'] },
    { key: 'phone', section: 'personal', kw: ['手机号', '手机', '电话', 'phone', 'mobile', '联系电话', '联系方式', '手机号码'] },
    { key: 'email', section: 'personal', kw: ['邮箱', '邮件', 'email', 'mail', '电子邮箱', '邮箱地址'] },
    { key: 'gender', section: 'personal', kw: ['性别', 'gender'] },
    { key: 'birth', section: 'personal', kw: ['出生日期', '出生年月', '出生', 'birth'] },
    { key: 'hometown', section: 'personal', kw: ['籍贯', '户籍', '户口', '生源地', 'hometown'] },
    { key: 'location', section: 'personal', kw: ['所在地', '所在城市', '现居', '居住地'] },
    { key: 'city', section: 'personal', kw: ['期望城市', '意向城市', '工作城市', '城市'] },
    { key: 'salary', section: 'personal', kw: ['当前薪资', '期望薪资', '薪资', '薪酬', 'salary'] },
    { key: 'degree', section: 'education', kw: ['最高学历', '学历', 'degree', '学位', '学历类型'] },
    { key: 'school', section: 'education', kw: ['毕业院校', '学校', '院校', '学院', 'university', 'school', 'college', '学校名称', '就读学校'] },
    { key: 'major', section: 'education', kw: ['专业', 'major', '所学专业', '专业名称', '领域方向', '研究方向'] },
    { key: 'grad', section: 'education', kw: ['毕业时间', '毕业年份', '毕业日期', 'graduat', '毕业年月', '预计毕业'] },
    { key: 'eduStart', section: 'education', kw: ['入学时间', '入学年份', '在校时间'] },
    { key: 'lab', section: 'education', kw: ['实验室', 'lab', '研究所'] },
    { key: 'advisor', section: 'education', kw: ['导师', 'advisor', '指导教师'] },
    { key: 'exp', section: 'work', kw: ['工作经历', '实习经历', '项目经历', '经历', 'experience', '实习', '项目', '内容', '工作内容', '职责描述', 'desc', 'description', '描述'] },
    { key: 'company', section: 'work', kw: ['公司名称', '实习公司', '工作单位', 'company', 'employer', '单位名称'] },
    { key: 'title', section: 'work', kw: ['职位名称', '职位', '岗位名称', '岗位', 'title', 'jobTitle', '职务'] },
    { key: 'role', section: 'work', kw: ['职责', '角色', 'role', '项目中职责'] },
    { key: 'skill', section: 'work', kw: ['技能', 'skill', '特长', '专业技能'] },
    { key: 'cert', section: 'certificate', kw: ['证书', 'certificate', '英语等级', '四六级', 'cet', '语言能力', '认证', '语言类型', '语言'] },
    { key: 'award', section: 'certificate', kw: ['奖项名称', '奖项', '获奖', 'award'] },
    { key: 'summary', section: 'personal', kw: ['简介', '个人简介', '自我介绍', 'summary'] },
    { key: 'year', section: 'date', kw: ['年'] },
    { key: 'month', section: 'date', kw: ['月'] },
  ];

  // ---- 字段信号提取（多信号源，跨 ATS）----
  function signalOf(el) {
    let label = '';
    const l = el.closest('label');
    if (l) label = l.innerText || '';
    const nearby = [];
    const parent = el.parentElement;
    if (parent) { const prev = parent.querySelector('label, .label, [class*="label"]'); if (prev) nearby.push(prev.innerText || ''); }
    let ancestor = '';
    let p = el.parentElement;
    for (let k = 0; k < 4 && p; k++) {
      if (/form-item|field-item|form-label|item-label/.test(p.className || '')) {
        ancestor = (p.innerText || '').replace(/\d+\/\d+/g, '').trim();
        break;
      }
      p = p.parentElement;
    }
    const dfName = el.getAttribute('data-form-field-name') || '';
    const dfI18n = el.getAttribute('data-form-field-i18n-name') || '';
    const aria = el.getAttribute('aria-label') || '';
    return [dfName, dfI18n, aria, label, ancestor, el.placeholder || '', el.name || '', el.id || '', ...nearby].join(' ');
  }

  // ---- 匹配：归一化后打分 ----
  function matchField(signal) {
    const norm = normalizeText(signal);
    if (!norm) return null;
    let best = null, bestScore = 0;
    for (const rule of FIELD_RULES) {
      for (const k of rule.kw) {
        const nk = normalizeText(k);
        if (!nk) continue;
        let score = 0;
        if (norm === nk) score = 8;
        else if (norm.includes(nk)) score = 4;
        if (score > bestScore) { bestScore = score; best = rule; }
      }
    }
    return best;
  }

  // ---- 日期字段检测 ----
  function isDateField(el, signal) {
    const isReadonly = el.readOnly || el.hasAttribute('readonly') || el.disabled;
    const dateKw = /入学|毕业|开始|结束|时间|日期|出生|年月|date|month|calendar/.test(normalizeText(signal));
    const hasPicker = el.closest('[class*="date"],[class*="picker"],[class*="calendar"],[class*="time"]') !== null;
    return dateKw && (isReadonly || hasPicker);
  }

  // ---- React 安全写值 ----
  function setNativeValue(el, v) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function setSelectValue(el, v) {
    const opt = [...el.options].find((o) => o.text === v || o.value === v || normalizeText(o.text) === normalizeText(v));
    if (!opt) return false;
    el.value = opt.value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  // ---- 扫描 + 填充 ----
  function scanAndFill(profileValues, { fill = true } = {}) {
    const els = [...document.querySelectorAll('input, select, textarea')].filter((el) => el.type !== 'file' && el.type !== 'hidden');
    const detected = [], written = [], unmatched = [], dateFields = [];
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      const signal = signalOf(el);
      const rule = matchField(signal);
      detected.push({ tag: el.tagName, type: el.type, signal: signal.trim().slice(0, 40), key: rule ? rule.key : null, section: rule ? rule.section : null });
      if (!rule) { if (signal.trim()) unmatched.push({ index: i, tag: el.tagName, type: el.type, signal: signal.trim().slice(0, 40) }); continue; }
      if (isDateField(el, signal)) { dateFields.push({ key: rule.key, signal: signal.trim().slice(0, 40), tag: el.tagName }); continue; }
      const val = profileValues[rule.key];
      if (val === undefined || val === '') continue;
      if (!fill) continue;
      if (el.tagName === 'SELECT') { if (setSelectValue(el, val)) written.push({ key: rule.key, value: val, tag: 'SELECT' }); }
      else { setNativeValue(el, val); written.push({ key: rule.key, value: val, tag: el.tagName }); }
    }
    return { detected, written, unmatched, dateFields };
  }

  // 上传简历文件到 input[type=file]（DataTransfer，四两拨千斤：让官网自己解析覆盖）
  function uploadResumeFile(fileData, fileName, mimeType) {
    const all = [...document.querySelectorAll('input[type="file"]')];
    if (!all.length) return { ok: false, error: '页面没有找到 file 上传框（input[type=file]）' };
    // 优先可见的，否则用第一个非 disabled（很多上传组件的 file input 是隐藏的）
    const input = all.find((el) => el.offsetParent !== null && !el.disabled) || all.find((el) => !el.disabled) || all[0];
    try {
      const bin = atob(fileData);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const file = new File([bytes], fileName, { type: mimeType || 'application/pdf' });
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, fileName, foundInputs: all.length };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // ---- 收集「规则未匹配」的字段（供 LLM 语义映射兜底，只发描述符，不发简历值）----
  function collectUnmatched() {
    const els = [...document.querySelectorAll('input, select, textarea')].filter((el) => el.type !== 'file' && el.type !== 'hidden');
    const unmatched = [];
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      const signal = signalOf(el).trim();
      if (!signal) continue;
      if (matchField(signal)) continue; // 规则已匹配，跳过
      unmatched.push({ index: i, signal: signal.slice(0, 60), tag: el.tagName, type: el.type });
    }
    return unmatched;
  }

  // ---- 用 LLM 映射结果（index → key）写值：本地确定性写，AI 只给映射 ----
  function applyMapping(profileValues, mapping) {
    const els = [...document.querySelectorAll('input, select, textarea')].filter((el) => el.type !== 'file' && el.type !== 'hidden');
    const written = [];
    for (const m of mapping || []) {
      const el = els[m.index];
      if (!el) continue;
      const val = profileValues[m.key];
      if (val === undefined || val === '') continue;
      if (el.tagName === 'SELECT') { if (setSelectValue(el, val)) written.push({ key: m.key, value: val, tag: 'SELECT' }); }
      else { setNativeValue(el, val); written.push({ key: m.key, value: val, tag: el.tagName }); }
    }
    return written;
  }

  window.JobStarAutofill = { scanAndFill, matchField, normalizeText, FIELD_RULES, isDateField, uploadResumeFile, collectUnmatched, applyMapping, signalOf };
})();
