'use strict';
/**
 * 京东接口投递（HAR 逆向）
 *
 * 京东投递 = 两个独立接口：
 *   1. POST /api/wx/resume/v2/uploadParse   multipart 上传 PDF → 解析简历进库
 *   2. POST /api/wx/delivery                publishId + 意向城市/业务 → 投递（不可逆）
 *
 * 本文件是「验证版」：只上传简历（uploadParse），不调 delivery 投递。
 * 用法：node jd_apply.js <岗位标题关键词>
 */

const fs = require('node:fs');
const path = require('node:path');
let puppeteer;
try { puppeteer = require('puppeteer-core'); } catch { puppeteer = require('../job-hunter/node_modules/puppeteer-core'); }

const EDGE_PATH = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PROFILE_PATH = path.join(__dirname, 'data', 'profile.json');
const USER_DATA_DIR = path.join(__dirname, 'data', 'browser-profile');

function loadProfile() {
  return JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf8'));
}

// 复用 apply.js 的简历匹配逻辑
function matchResume(title, resumes) {
  if (!Array.isArray(resumes) || !resumes.length) return null;
  const t = String(title || '');
  let best = resumes[0];
  let bestScore = -1;
  for (const r of resumes) {
    let score = 0;
    for (const d of r.directions || []) if (t.includes(d)) score++;
    if (score > bestScore) { best = r; bestScore = score; }
  }
  return best;
}

// 打开京东（登录态）→ 上传简历（uploadParse）→ 可选投递（delivery）
// opts.dryRun 默认 true（只上传不投）；opts.hopeCity/intentionalBusiness 等可覆盖投递参数
async function jdApplyVerify(job, opts = {}) {
  const dryRun = opts.dryRun !== false;
  const profile = opts.profile || loadProfile();
  const resume = matchResume(job.title, profile.files && profile.files.resumes);
  if (!resume) throw new Error('无简历库可匹配');
  if (!fs.existsSync(resume.path)) throw new Error('简历文件不存在：' + resume.path);

  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: false,
    userDataDir: USER_DATA_DIR,
    defaultViewport: null,
    args: ['--no-sandbox', '--disable-gpu', '--start-maximized'],
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36');
  await page.goto('https://campus.jd.com/', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await new Promise((r) => setTimeout(r, 3000));

  // 1. 检查登录态（isLogin 接口，未登录返回空）
  const checkLogin = () => page.evaluate(async () => {
    const res = await fetch('/api/wx/position/isLogin').catch(() => null);
    return res ? await res.text() : '';
  });
  let isLogin = await checkLogin();
  if (!isLogin || isLogin.length < 5) {
    console.log('⚠ 未登录，请在 Edge 窗口登录京东（最多等 3 分钟）…');
    for (let i = 0; i < 180; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      isLogin = await checkLogin();
      if (isLogin && isLogin.length >= 5) break;
    }
    if (!isLogin || isLogin.length < 5) {
      console.log('仍未登录，请登录后重跑。');
      return { login: false };
    }
  }
  console.log('登录态标识:', `「${isLogin}」`);

  // 2. 上传简历（uploadParse，multipart）
  const pdfBase64 = fs.readFileSync(resume.path).toString('base64');
  const filename = resume.path.split('\\').pop();
  const result = await page.evaluate(async ({ pdfBase64, filename }) => {
    const binary = atob(pdfBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const formData = new FormData();
    formData.append('file', blob, filename);
    const res = await fetch('/api/wx/resume/v2/uploadParse', { method: 'POST', body: formData });
    return await res.json();
  }, { pdfBase64, filename });

  console.log('\n===== uploadParse 响应 =====');
  console.log('success:', result.success);
  if (result.body) {
    const b = result.body;
    console.log('解析字段:');
    console.log('  姓名:', b.name, '| 手机:', b.mobile, '| 邮箱:', b.email);
    console.log('  证件:', b.idTypeName, b.idNo);
    console.log('  毕业时间:', b.birthdayString);
  }

  // 3. 查岗位数据，提取投递默认参数（positionBg/workCity/interviewCityCode）
  let reqInfo = null;
  if (!dryRun) {
    reqInfo = await page.evaluate(async (jobId) => {
      const res = await fetch('/api/wx/position/page?type=present', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageSize: 50, pageIndex: 0, parameter: { positionName: '', planIdList: [56], jobDirectionCodeList: [], workCityCodeList: [], positionDeptList: [] } }),
      });
      const j = await res.json();
      const items = (j.body && j.body.items) || [];
      const it = items.find((x) => String(x.publishId) === String(jobId));
      if (!it) return null;
      const reqs = it.requirementVoList || [];
      const bgs = [...new Set(reqs.map((r) => r.positionBg).filter(Boolean))];
      const first = reqs[0] || {};
      return { bgs, first: { workCity: first.workCity, workCityCode: first.workCityCode, interviewCityCode: first.interviewCityCode, positionBg: first.positionBg } };
    }, String(job.job_id || job.id || ''));
  }

  // 4. 投递（delivery，dryRun=true 时跳过）
  let deliveryResult = null;
  if (!dryRun && result.success) {
    const jobId = String(job.job_id || job.id || '');
    if (!jobId) {
      console.log('⚠ 岗位缺 job_id，无法投递');
    } else {
      const first = (reqInfo && reqInfo.first) || {};
      if (reqInfo && reqInfo.bgs) console.log(`\n岗位业务板块可选: ${reqInfo.bgs.join(' / ')}`);
      const params = {
        publishId: Number(jobId),
        hopeCity: opts.hopeCity || first.workCity || '北京市-北京市',
        hopeCityCode: opts.hopeCityCode || first.workCityCode || '00001',
        secondHopeCity: opts.secondHopeCity || '',
        secondHopeCityCode: opts.secondHopeCityCode || '',
        thirdHopeCity: opts.thirdHopeCity || '',
        thirdHopeCityCode: opts.thirdHopeCityCode || '',
        intentionalBusiness: opts.intentionalBusiness || first.positionBg || '京东零售',
        introductionCode: opts.introductionCode || '',
        secondReqId: opts.secondReqId || '',
        interviewPlace: opts.interviewPlace || first.interviewCityCode || '01',
        deliverySource: 'CAMPUS',
        firstChoiceTagCodeList: opts.firstChoiceTagCodeList || ['UNLIMIT'],
        secondChoiceTagCodeList: opts.secondChoiceTagCodeList || [],
      };
      console.log('\n===== delivery 投递 =====');
      console.log('参数:', JSON.stringify(params));
      deliveryResult = await page.evaluate(async (params) => {
        const res = await fetch('/api/wx/delivery', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params),
        });
        return await res.json();
      }, params);
      console.log('响应:', JSON.stringify(deliveryResult));
    }
  }

  await browser.close();
  return { login: true, result, delivery: deliveryResult };
}

module.exports = { jdApplyVerify };

if (require.main === module) {
  const db = require('./db');
  const apply = process.argv.includes('--apply'); // --apply = 真投递
  const kw = process.argv.slice(2).find((a) => !a.startsWith('--')) || '';
  const d = db.getDb();
  const rows = d.prepare('SELECT * FROM applications WHERE status = ? ORDER BY rowid DESC').all('pending');
  d.close();
  const job = rows.find((r) => !kw || r.title.includes(kw) || (r.company || '').includes(kw));
  if (!job) { console.error('未找到匹配的待投岗位'); process.exit(1); }
  jdApplyVerify(job, { dryRun: !apply }).then((r) => {
    if (!r.login) console.log('\n未登录，请登录后重跑。');
    else if (apply && r.delivery && r.delivery.success) console.log('\n✅ 投递成功！');
    else if (apply) console.log('\n投递失败，见上面响应。');
    else console.log('\n验证完成：简历已上传解析（未投递）。加 --apply 参数可真投递。');
  }).catch((e) => { console.error('失败:', e.message); process.exit(1); });
}
