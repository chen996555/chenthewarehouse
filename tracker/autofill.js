'use strict';
/**
 * 求职星计划 — 投递表单自动填充核心模块
 *
 * 三步：字段检测 → 语义匹配 → React 安全写值。
 * 参考开源实现（AI-Resume-Form-Filling-Assistant 的 field-semantics / fill-runtime、
 * FormFilla 的 Hungarian + native setter），整合：
 *   - 归一化：去空格/标点/小写，消除「最高 学历」vs「最高学历」变体
 *   - 分节：先判断字段属于 基本信息/教育/工作/证书 哪个 section，再在 section 内匹配
 *   - 日期字段检测：readonly + 日历图标 的特殊字段单独标记，不强行写值
 *   - React 安全写值：Object.getOwnPropertyDescriptor 拿原生 setter 绕过框架覆盖
 *
 * 用法：const af = require('./autofill'); await af.scanAndFill(page, profileValues);
 */

// ---- 归一化 ----------------------------------------------------------------

function normalizeText(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[()（）[\]【】{}<>]/g, '')
    .replace(/[.,，/\\\-_:：;+*"'`“”‘’]/g, '');
}

// ---- 字段语义规则（key + section + 关键词） --------------------------------

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
  { key: 'recentCompany', section: 'personal', kw: ['最近公司', '当前公司', '现公司'] },
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

// ---- 字段信号提取 + 匹配 ----------------------------------------------------

function signalOf(el) {
  let label = '';
  const l = el.closest('label');
  if (l) label = l.innerText || '';
  // 也看兄弟节点里的 label 文本（有些布局 label 不在祖先链上）
  const nearby = [];
  const parent = el.parentElement;
  if (parent) {
    const prev = parent.querySelector('label, .label, [class*="label"]');
    if (prev) nearby.push(prev.innerText || '');
  }
  // 往上找 form-item 等容器文本（zhiye 字段名在祖父容器文本里，如「姓名」「实习内容」）
  let ancestor = '';
  let p = el.parentElement;
  for (let k = 0; k < 4 && p; k++) {
    if (/form-item|field-item|form-label|item-label/.test(p.className || '')) {
      ancestor = (p.innerText || '').replace(/\d+\/\d+/g, '').trim();
      break;
    }
    p = p.parentElement;
  }
  // 各 ATS 字段名位置不同：Moka=placeholder，飞书 ATSX=data-form-field-name/i18n-name，zhiye=form-item 容器文本，通用=aria-label/name/id
  const dfName = el.getAttribute('data-form-field-name') || '';
  const dfI18n = el.getAttribute('data-form-field-i18n-name') || '';
  const aria = el.getAttribute('aria-label') || '';
  return [dfName, dfI18n, aria, label, ancestor, el.placeholder || '', el.name || '', el.id || '', ...nearby].join(' ');
}

// 匹配：归一化后打分（精确=8，包含=4），取最高分
function matchField(signal) {
  const norm = normalizeText(signal);
  if (!norm) return null;
  let best = null;
  let bestScore = 0;
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

// 日期字段检测：readonly 或 日历图标 且信号含时间关键词
function isDateField(el, signal) {
  const isReadonly = el.readOnly || el.hasAttribute('readonly') || el.disabled;
  const dateKw = /入学|毕业|开始|结束|时间|日期|出生|年月|date|month|calendar/.test(normalizeText(signal));
  const hasPicker = el.closest('[class*="date"],[class*="picker"],[class*="calendar"],[class*="time"]') !== null;
  return dateKw && (isReadonly || hasPicker);
}

// ---- React 安全写值 --------------------------------------------------------

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

// ---- LLM 兜底（规则匹配不上的字段交给 LLM 判断） ------------------------------

const fs = require('node:fs');
const path = require('node:path');
const CONFIG_PATH = path.join(__dirname, 'data', 'scorer-config.json');
function loadLlmConfig() {
  let fileCfg = {};
  try { fileCfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch {}
  return {
    apiKey: String(fileCfg.apiKey || process.env.DEEPSEEK_API_KEY || ''),
    baseUrl: String(fileCfg.baseUrl || process.env.SCORER_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, ''),
    judgeModel: String(fileCfg.judgeModel || process.env.SCORER_JUDGE_MODEL || 'deepseek-chat'),
  };
}

// 规则匹配不上的字段 → 调 LLM 判断对应哪个 profile 字段，返回 [{index, key}]
async function llmFallbackMatch(unmatched, profileValues) {
  const cfg = loadLlmConfig();
  if (!cfg.apiKey || !unmatched.length) return [];
  const fieldsDesc = unmatched.map((f) => `${f.index}(${f.tag}/${f.type}): "${f.signal}"`).join('\n');
  const profileDesc = Object.entries(profileValues).filter(([, v]) => v).map(([k, v]) => `${k}: ${String(v).slice(0, 60)}`).join('\n');
  const prompt = `你是表单字段识别助手。下面「字段」是网申表单里没识别出来的控件（index 是序号），「资料」是我的简历字段。请判断每个字段对应资料里哪个 key，输出 JSON 数组。

字段：
${fieldsDesc}

资料（key: 值）：
${profileDesc}

只输出能确定的，不确定的跳过。严格输出 JSON 数组，不要其他文字：
[{"index": 3, "key": "school"}]`;
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({ model: cfg.judgeModel, messages: [{ role: 'user', content: prompt }], temperature: 0.1, max_tokens: 2000 }),
  });
  const j = await res.json();
  const content = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
  const start = content.indexOf('[');
  const end = content.lastIndexOf(']') + 1;
  if (start < 0 || end <= start) return [];
  try {
    const arr = JSON.parse(content.slice(start, end));
    return arr.filter((m) => m.index !== undefined && m.key && profileValues[m.key] !== undefined);
  } catch { return []; }
}

// ---- 主流程：在页面里跑检测 + 匹配 + 写值 -----------------------------------

/**
 * @param {import('puppeteer-core').Page} page
 * @param {Record<string,string>} profileValues 简历字段 → 值（name/phone/email/degree/school/major/grad/exp...）
 * @param {object} [opts] { fill: boolean } fill=false 只检测不写
 */
async function scanAndFill(page, profileValues, opts = {}) {
  const doFill = opts.fill !== false;
  const llmFallback = typeof opts.llmFallback === 'function' ? opts.llmFallback : null;
  const result = await page.evaluate((rules, vals, fill) => {
    const RULES = rules.map((r) => ({ ...r, kw: r.kw }));
    const normalize = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, '').replace(/[()（）[\]【】{}<>]/g, '').replace(/[.,，/\\\-_:：;+*"'`“”‘’]/g, '');

    const signalOf = (el) => {
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
    };
    const matchField = (signal) => {
      const norm = normalize(signal);
      if (!norm) return null;
      let best = null, bestScore = 0;
      for (const rule of RULES) {
        for (const k of rule.kw) {
          const nk = normalize(k);
          if (!nk) continue;
          let score = 0;
          if (norm === nk) score = 8;
          else if (norm.includes(nk)) score = 4;
          if (score > bestScore) { bestScore = score; best = rule; }
        }
      }
      return best;
    };
    const isDateField = (el, signal) => {
      const isReadonly = el.readOnly || el.hasAttribute('readonly') || el.disabled;
      const dateKw = /入学|毕业|开始|结束|时间|日期|出生|年月|date|month|calendar/.test(normalize(signal));
      const hasPicker = el.closest('[class*="date"],[class*="picker"],[class*="calendar"],[class*="time"]') !== null;
      return dateKw && (isReadonly || hasPicker);
    };
    const setNativeValue = (el, v) => {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const setSelectValue = (el, v) => {
      const opt = [...el.options].find((o) => o.text === v || o.value === v || normalize(o.text) === normalize(v));
      if (!opt) return false;
      el.value = opt.value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    };

    const els = [...document.querySelectorAll('input, select, textarea')].filter((el) => el.type !== 'file' && el.type !== 'hidden');

    const detected = [];
    const dateFields = [];
    const written = [];
    const unmatched = [];

    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      const signal = signalOf(el);
      const rule = matchField(signal);
      detected.push({ tag: el.tagName, type: el.type, signal: signal.trim().slice(0, 40), key: rule ? rule.key : null, section: rule ? rule.section : null });
      if (!rule) {
        if (signal.trim()) unmatched.push({ index: i, tag: el.tagName, type: el.type, signal: signal.trim().slice(0, 40) });
        continue;
      }

      // 日期字段：标记但不强行写（readonly/日历选择器需要专门交互）
      if (isDateField(el, signal)) { dateFields.push({ key: rule.key, signal: signal.trim().slice(0, 40), tag: el.tagName }); continue; }

      const val = vals[rule.key];
      if (val === undefined || val === '') continue;
      if (!fill) continue;

      if (el.tagName === 'SELECT') {
        if (setSelectValue(el, val)) written.push({ key: rule.key, value: val, tag: 'SELECT' });
      } else {
        setNativeValue(el, val);
        written.push({ key: rule.key, value: val, tag: el.tagName });
      }
    }

    return { detected, dateFields, written, unmatched };
  }, FIELD_RULES, profileValues, doFill);

  // LLM 兜底：规则匹配不上的字段，交给 LLM 判断后回填
  if (llmFallback && doFill && result.unmatched && result.unmatched.length) {
    const mapping = await llmFallback(result.unmatched, profileValues);
    if (mapping && mapping.length) {
      const filled = await page.evaluate((mapping, vals) => {
        const els = [...document.querySelectorAll('input, select, textarea')].filter((el) => el.type !== 'file' && el.type !== 'hidden');
        const setNativeValue = (el, v) => {
          const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        };
        const setSelectValue = (el, v) => {
          const opt = [...el.options].find((o) => o.text === v || o.value === v);
          if (!opt) return false;
          el.value = opt.value;
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        };
        const written = [];
        for (const m of mapping) {
          const el = els[m.index];
          if (!el || vals[m.key] === undefined || vals[m.key] === '') continue;
          if (el.tagName === 'SELECT') {
            if (setSelectValue(el, vals[m.key])) written.push({ key: m.key, value: vals[m.key], tag: 'SELECT', llm: true });
          } else {
            setNativeValue(el, vals[m.key]);
            written.push({ key: m.key, value: vals[m.key], tag: el.tagName, llm: true });
          }
        }
        return written;
      }, mapping, profileValues);
      result.written.push(...filled);
    }
  }

  return result;
}

// ---- profile.json → 填充值映射 ---------------------------------------------

function profileToValues(profile) {
  const edu0 = (profile.background && profile.background.education && profile.background.education[0]) || {};
  return {
    name: profile.identity.legal_name,
    phone: profile.contact.phone,
    email: profile.contact.email,
    gender: profile.identity.gender,
    birth: profile.identity.birth_date,
    hometown: profile.identity.hometown,
    degree: edu0.degree,
    school: edu0.school,
    major: edu0.major,
    grad: profile.job_search.graduation_year,
    eduStart: edu0.start,
    exp: profile.background.experience_summary,
    skill: (profile.background.skills || []).join('、'),
  };
}

module.exports = { scanAndFill, profileToValues, matchField, normalizeText, FIELD_RULES, isDateField, llmFallbackMatch };
