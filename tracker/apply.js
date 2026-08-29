'use strict';

/**
 * 求职星计划 — 半自动投递（apply）
 *
 * 流程：打开岗位详情页（headful 浏览器，登录态持久化）→ 读投递表单字段
 * → 按岗位方向匹配简历 → 预填资料包（姓名/电话/邮箱/学校/学历/专业）
 * → 停在「提交」前，由用户登录、过验证码、上传简历、点提交（人工复核不可逆动作）。
 *
 * 用法：
 *   node apply.js <看板岗位id或标题关键词>   # 命令行投递指定岗位
 *   或 require('./apply').applyJob(job)
 */

const fs = require('node:fs');
const path = require('node:path');

let puppeteer;
try {
  puppeteer = require('puppeteer-core');
} catch {
  puppeteer = require('../job-hunter/node_modules/puppeteer-core');
}

const EDGE_PATH = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PROFILE_PATH = path.join(__dirname, 'data', 'profile.json');
// 浏览器登录态持久化目录（登录一次，cookie 复用）
const USER_DATA_DIR = path.join(__dirname, 'data', 'browser-profile');
const companies = require('./companies');

function loadProfile() {
  return JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf8'));
}

// ---- 投递层候选链（半确定档：形态有限，候选链枚举自动适配；公司覆盖层可覆盖特例）----
// 解析按钮候选选择器（解析按钮可能是 span/div/button，字节「解析并覆盖」是 span）
const PARSE_BUTTON_SELECTORS = ['span', 'a', 'button', '[id*="parse"]', '[class*="parse"]', '[class*="analy"]', '[class*="auto-fill"]'];
// 字段名候选来源（依次读，命中即返回）
const FIELD_LABEL_ATTRS = ['data-form-field-i18n-name', 'data-form-field-name'];
// 下拉选项候选选择器（覆盖各种下拉组件的选项元素）
const DROPDOWN_OPTION_SELECTORS = '[role="option"], [class*="option"], [class*="select-item"], [class*="select-option"], [class*="selectItem"], [class*="dropdown-item"], [class*="option-item"]';

// 导航型投递：从 entryUrl 列表页搜索岗位标题 → 点击进详情页（第二类公司美团/拼多多/米哈游/快手/B站）
// 返回是否成功点击到岗位（成功则当前页已切到详情，后续走正常投递流程）
async function navigateToJob(page, job, entryUrl) {
  await page.goto(entryUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await new Promise((r) => setTimeout(r, 5000));
  // 搜索岗位：标题太长用前 8 字核心词（搜索框候选：搜索/岗位/职位 placeholder）
  const kw = String(job.title || '').slice(0, 8);
  await page.evaluate((kw) => {
    const input = document.querySelector('input[placeholder*="搜索"], input[placeholder*="岗位"], input[placeholder*="职位"], input[type="search"]');
    if (!input) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    input.focus();
    setter.call(input, kw);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, which: 13, bubbles: true }));
  }, kw);
  await new Promise((r) => setTimeout(r, 3500));
  // 点击匹配岗位的卡片（含标题的可点击元素）
  const clicked = await page.evaluate((kw) => {
    const cards = Array.from(document.querySelectorAll('a[href], [class*="card"], [class*="job-item"], [class*="position-item"], [class*="list-item"], [class*="item"]'));
    const el = cards.find((e) => {
      const t = (e.innerText || '').trim();
      return t && t.length < 200 && t.includes(kw);
    });
    if (el) { el.click(); return true; }
    return false;
  }, kw);
  if (clicked) await new Promise((r) => setTimeout(r, 4000)); // 等详情页渲染
  return clicked;
}

// 读公司投递配置（reach.type = direct 直达 / navigate 导航）
function getCompanyReach(companyName) {
  const c = companies.COMPANIES.find((x) => x.name === companyName);
  return (c && c.reach) || { type: 'direct' };
}

// 按岗位标题匹配简历：title 命中 directions 词越多越匹配
function matchResume(title, resumes) {
  if (!Array.isArray(resumes) || !resumes.length) return null;
  const t = String(title || '');
  let best = resumes[0];
  let bestScore = -1;
  for (const r of resumes) {
    let score = 0;
    for (const d of r.directions || []) {
      if (t.includes(d)) score++;
    }
    if (score > bestScore) { best = r; bestScore = score; }
  }
  return best;
}

// 读表单字段（input/select/textarea，含 label 文本）
async function readFormFields(page) {
  return page.evaluate(() => {
    const getLabel = (el) => {
      // 字节（ud__ 组件）：字段名在 data-form-field-i18n-name / data-form-field-name 属性
      const i18n = el.getAttribute('data-form-field-i18n-name');
      if (i18n) return (i18n || '').trim();
      const fname = el.getAttribute('data-form-field-name');
      if (fname) return (fname || '').trim();
      // 优先 label[for] 关联，其次就近 label / placeholder / name
      if (el.id) {
        const l = document.querySelector(`label[for="${el.id}"]`);
        if (l) return (l.innerText || '').trim();
      }
      const parent = el.closest('.form-item, .ant-form-item, [class*="form"]');
      const label = parent ? parent.querySelector('label') : null;
      if (label) return (label.innerText || '').trim();
      return '';
    };
    return Array.from(document.querySelectorAll('input, select, textarea')).map((el) => ({
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') || 'text',
      name: el.getAttribute('name') || '',
      placeholder: el.getAttribute('placeholder') || '',
      label: getLabel(el),
      value: el.value || '',
      role: el.getAttribute('role') || '',
      ariaHasPopup: el.getAttribute('aria-haspopup') || '',
      cls: (el.className || '').toString().slice(0, 60),
      parentCls: (el.parentElement ? el.parentElement.className || '' : '').toString().slice(0, 60),
    }));
  });
}

// 字段 → 资料包值（按 label/placeholder/name 关键词匹配）
function fieldToProfileValue(field, profile) {
  const key = `${field.label} ${field.placeholder} ${field.name}`.toLowerCase();
  const id = profile.identity || {};
  const contact = profile.contact || {};
  const bg = profile.background || {};
  const edu = (bg.education || [])[0] || {};

  // 排除需人工选择的字段（调剂/是否等），避免宽泛关键词误填
  if (/调剂|是否|同意|服从|期望工作地|可接受/.test(key)) return '';

  // 确定信息：性别 / 政治面貌 / 出生日期 / 籍贯
  if (/性别/.test(key)) return id.gender;
  if (/政治面貌|党团/.test(key)) return id.political_status;
  if (/出生日期|出生年月|生日/.test(key)) return id.birth_date;
  if (/籍贯|户籍|户口/.test(key)) return id.hometown;

  // 学历类型 / 学习形式 → 全日制（应届硕士确定值）
  if (/学历类型|学习形式|培养方式|学制|统招|全日制/.test(key)) return '全日制';

  // 时间类字段（格式因站而异，需人工或解析）
  if (/毕业时间|入学时间|入学年份|毕业年份|到岗时间|实习时长|可实习/.test(key)) return '';

  if (/姓名|真实姓名|名字/.test(key) && !/学校|公司|岗位|项目|导师|紧急联系人|用户名|家长/.test(key)) return id.legal_name;
  if (/手机|电话|联系方式|联系电话/.test(key) && !/紧急/.test(key)) return contact.phone;
  if (/邮箱|email|mail/.test(key) && !/紧急/.test(key)) return contact.email;
  if (/学校名称|学校|院校|毕业院校/.test(key) && !/专业/.test(key)) return edu.school;
  if (/^学历$|学历$/.test(key) && !/学历类型|最高学历类型/.test(key)) return edu.degree;
  if (/专业/.test(key) && !/学校|院校|学历/.test(key)) return edu.major;
  if (/意向城市|工作城市|期望城市|工作地|现居|所在地/.test(key)) return contact.province_city;
  return '';
}

// React/Vue 兼容设值（React 用 native setter + input 事件）
// 分两类：
//   1) 自定义下拉（role=combobox / aria-haspopup=listbox）：点击展开 → 从选项精确匹配点击
//   2) 原生 select：读 options 精确/包含匹配；input/textarea：填文本
async function setFieldValue(page, el, value) {
  const idx = el.index;
  // 判断自定义下拉（role/aria 或 class 含 select-search/select 的特征，如 atsx/antd Select）
  const isCombobox = await page.evaluate((i) => {
    const e = document.querySelectorAll('input, select, textarea')[i];
    if (!e) return false;
    const cls = (e.className || '').toString();
    return e.getAttribute('role') === 'combobox'
      || e.getAttribute('aria-haspopup') === 'listbox'
      || /select-search|select/.test(cls);
  }, idx);

  if (isCombobox) {
    await page.evaluate((i) => { document.querySelectorAll('input, select, textarea')[i].click(); }, idx);
    await new Promise((r) => setTimeout(r, 1000)); // 等下拉展开
    const clicked = await page.evaluate(({ val, optSel }) => {
      const opts = Array.from(document.querySelectorAll(optSel))
        .filter((o) => { const t = (o.innerText || '').trim(); return t && (t === val || t.includes(val)); });
      if (opts.length) { opts[0].click(); return opts[0].innerText.trim(); }
      return '';
    }, { val: value, optSel: DROPDOWN_OPTION_SELECTORS });
    return clicked ? '已选「' + clicked + '」' : '未匹配自定义下拉';
  }

  return await page.evaluate(({ idx, value }) => {
    const els = document.querySelectorAll('input, select, textarea');
    const el = els[idx];
    if (!el) return '元素不存在';
    const tag = el.tagName.toLowerCase();
    if (tag === 'select') {
      const opts = Array.from(el.options).map((o) => (o.text || '').trim()).filter(Boolean);
      let matched = opts.find((t) => t === value); // 精确匹配优先
      if (!matched) matched = opts.find((t) => t.includes(value) || value.includes(t)); // 包含匹配
      if (matched) {
        const opt = Array.from(el.options).find((o) => (o.text || '').trim() === matched);
        if (opt) {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
          setter.call(el, opt.value);
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return '已选「' + matched + '」';
        }
      }
      return '未匹配，选项=[' + opts.join('、') + ']';
    }
    const proto = tag === 'textarea' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return '已填文本';
  }, { idx, value });
}

// 半自动投递主流程
async function applyJob(job, opts = {}) {
  const profile = opts.profile || loadProfile();
  const reach = getCompanyReach(job.company);
  const url = job.detailUrl || job.url;

  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: false, // 可见窗口：用户要登录、过验证码、点提交
    userDataDir: USER_DATA_DIR, // 登录态持久化
    defaultViewport: null,
    args: ['--no-sandbox', '--disable-gpu', '--no-proxy-server', '--start-maximized'],
  });
  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
  );

  if (reach.type === 'navigate') {
    // 导航型：从 entryUrl 列表页搜岗位 → 点击进详情（第二类公司美团/拼多多/米哈游/快手/B站）
    const entryUrl = reach.entryUrl || url;
    if (!entryUrl) throw new Error('导航型岗位缺少 entryUrl');
    const navigated = await navigateToJob(page, job, entryUrl);
    if (!navigated) console.log('→ 导航型：未能自动定位岗位，请人工在列表页搜岗位后继续…');
  } else {
    if (!url) throw new Error('岗位缺少投递链接（detailUrl/url）');
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await new Promise((r) => setTimeout(r, 5000));
  }

  // 匹配简历
  const resume = matchResume(job.title, profile.files && profile.files.resumes);

  // 投递页有两种打开方式：字节=新开 tab（登录页），商汤等=当前页跳转。统一跟踪 applyPage。
  let applyPage = page;

  // 点击「投递」按钮（详情页 → 跳投递表单，未登录先跳登录页）
  // 注意：投递按钮不一定是 button（京东「投递简历」是 div），用「短文本含投递/申请」的任意元素匹配
  const clickedApply = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button, a, span, div')).find((b) => {
      const t = (b.innerText || '').trim();
      return t && t.length <= 20 && /投递|申请/.test(t);
    });
    if (btn) { btn.click(); return true; }
    return false;
  });
  let loginMode = 'none'; // 命中信号：登录/投递页打开方式
  let parseButtonTag = 'none'; // 命中信号：解析按钮形态
  if (clickedApply) {
    await new Promise((r) => setTimeout(r, 3000));
    // 情况 A：当前页自身跳转到投递/登录页（商汤等）
    if (page.url().includes('/apply') || page.url().includes('/login')) {
      applyPage = page;
      loginMode = 'same-page';
    } else {
      // 情况 B：新开 tab（字节），轮询等待 apply/login tab（不 fallback 到首页/残留 tab）
      for (let i = 0; i < 15; i++) {
        const pages = await browser.pages();
        const tab = pages.find((p) => p.url().includes('/apply')) || pages.find((p) => p.url().includes('/login'));
        if (tab) { applyPage = tab; break; }
        await new Promise((r) => setTimeout(r, 1000));
      }
      if (applyPage !== page) {
        loginMode = 'new-tab';
        await applyPage.bringToFront();
        console.log('→ 检测到投递/登录页：' + applyPage.url());
        await new Promise((r) => setTimeout(r, 2000));
      } else {
        loginMode = 'popup'; // 既没跳转也没新 tab，可能是弹窗
      }
    }
  }

  // 未登录：填手机号，再等用户输验证码登录（URL 从 /login 变化）
  let loggedIn = false;
  if (applyPage.url().includes('/login')) {
    console.log('→ 已跳转登录页，请去 Edge 窗口输验证码登录…');
    const loginFields = await readFormFields(applyPage);
    for (let i = 0; i < loginFields.length; i++) {
      const f = loginFields[i];
      if (/手机|电话/.test(f.placeholder + f.name + f.label)) {
        await setFieldValue(applyPage, { index: i, ...f }, profile.contact.phone);
        console.log('  已填手机号：' + profile.contact.phone);
      }
    }
    console.log('  等待登录（最多 5 分钟）…');
    for (let i = 0; i < 300; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      if (!applyPage.url().includes('/login')) break;
    }
    loggedIn = true;
    await new Promise((r) => setTimeout(r, 3000)); // 等投递表单渲染
  }

  // 字节：登录后回到职位详情页，需再点一次投递（此时已登录，直接进投递申请页）
  if (loggedIn && applyPage.url().includes('/detail')) {
    console.log('→ 登录后回到职位页，再次点击投递…');
    const clickedAgain = await applyPage.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find((b) => (b.innerText || '').includes('投递'));
      if (btn) { btn.click(); return true; }
      return false;
    });
    if (clickedAgain) {
      await new Promise((r) => setTimeout(r, 3000));
      const newPages = (await browser.pages()).filter((p) => p !== applyPage && !p.url().startsWith('about:blank'));
      const newTab = newPages.find((p) => p.url().includes('/apply')) || newPages[newPages.length - 1];
      if (newTab) {
        applyPage = newTab;
        await applyPage.bringToFront();
        console.log('→ 进入投递申请页：' + applyPage.url());
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  // 登录后到达投递表单：优先「上传简历 → 点解析」让系统自动填充（比 AI 逐字段预填更准更全）
  let resumeUploaded = false;
  let parseTriggered = false;
  if (resume) {
    const fileInput = await applyPage.$('input[type=file]').catch(() => null);
    if (fileInput) {
      try {
        await fileInput.uploadFile(resume.path);
        resumeUploaded = true;
        console.log('→ 已上传简历：' + resume.path.split('\\').pop());
        await new Promise((r) => setTimeout(r, 3000)); // 等上传完成
      } catch { /* 上传失败则退回手动预填 */ }
    }
    // 点「解析」按钮（如有，让系统用简历自动填充）
    // 注意：解析按钮可能是 span/div（如字节「解析并覆盖」），不是 button；用短文本叶子元素定位
    const parseBtnInfo = await applyPage.evaluate((selectors) => {
      const el = Array.from(document.querySelectorAll(selectors))
        .find((e) => {
          const t = (e.innerText || '').trim();
          return t && t.length <= 10 && /解析|识别|自动填充/.test(t);
        });
      if (el) { el.click(); return { text: (el.innerText || '').trim(), tag: el.tagName.toLowerCase() }; }
      return null;
    }, PARSE_BUTTON_SELECTORS.join(', '));
    const parseBtn = parseBtnInfo ? parseBtnInfo.text : '';
    if (parseBtnInfo) parseButtonTag = parseBtnInfo.tag;
    if (parseBtn) {
      parseTriggered = true;
      console.log('→ 已点击「' + parseBtn + '」，等系统解析填充…');
      // 等解析完成：字节解析后「解析并覆盖」文案会消失（变为已上传简历卡片）；最多等 40 秒
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const stillParsing = await applyPage.evaluate(() => {
          const el = Array.from(document.querySelectorAll('span, a, button, [id*="parse"], [class*="parse"]'))
            .find((e) => { const t = (e.innerText || '').trim(); return t && t.length <= 10 && /解析中|解析|取消/.test(t); });
          return !!el;
        }).catch(() => false);
        if (!stillParsing) break;
      }
      await new Promise((r) => setTimeout(r, 2500)); // 解析完成后等表单填充渲染
    }
  }

  // 读表单字段（登录后是投递表单；未登录则可能还是登录页）
  const fields = await readFormFields(applyPage);

  // 预填（能匹配到资料包的字段）
  let filled = 0;
  const filledFields = [];
  const unmatchedSelects = [];
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    const val = fieldToProfileValue(f, profile);
    if (val && !f.value) {
      const result = await setFieldValue(applyPage, { index: i, ...f }, val);
      filled++;
      filledFields.push({ label: f.label || f.placeholder || f.name, value: val, result });
      if (result && result.startsWith('未匹配')) {
        unmatchedSelects.push({ label: f.label || f.placeholder || f.name, value: val, options: result });
      }
    }
  }

  // 结果（不 close，保持浏览器打开让用户继续登录/上传/提交）
  return {
    company: job.company,
    title: job.title,
    url,
    recommendedResume: resume ? resume.label : '（无简历库）',
    resumePath: resume ? resume.path : '',
    resumeUploaded,
    parseTriggered,
    formFieldCount: fields.length,
    filledCount: filled,
    filledFields,
    unmatchedSelects,
    // 命中信号：验证「半确定档」候选链命中哪个形态，作为基线对比官网改版
    hitSignals: { loginMode, parseButtonTag },
    note: '请在打开的浏览器窗口：核对系统解析/预填的信息，补填遗漏项（尤其「未匹配」的下拉框），点提交。',
  };
}

module.exports = { applyJob, matchResume, readFormFields, fieldToProfileValue, navigateToJob, getCompanyReach };

// 命令行：node apply.js <标题关键词>
if (require.main === module) {
  const db = require('./db');
  const kw = process.argv[2] || '';
  const d = db.getDb();
  const rows = d.prepare('SELECT * FROM applications WHERE status = ? ORDER BY rowid DESC').all('pending');
  d.close();
  const job = rows.find((r) => !kw || r.title.includes(kw) || (r.company || '').includes(kw));
  if (!job) { console.error('未找到匹配的待投岗位，可传标题关键词'); process.exit(1); }
  applyJob(job)
    .then((r) => {
      console.log('\n===== 半自动投递（已预填）=====');
      console.log(`岗位：${r.company}｜${r.title}`);
      console.log(`推荐简历：${r.recommendedResume}`);
      console.log(`表单字段 ${r.formFieldCount} 个，已预填 ${r.filledCount} 个：`);
      for (const f of r.filledFields) console.log(`  · ${f.label} = ${f.value}`);
      console.log(`\n命中信号：登录方式=${r.hitSignals.loginMode} | 解析按钮=${r.hitSignals.parseButtonTag}`);
      console.log(`\n${r.note}`);
    })
    .catch((e) => { console.error('投递失败：', e.message); process.exit(1); });
}
