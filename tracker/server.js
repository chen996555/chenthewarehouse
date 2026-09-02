'use strict';

/**
 * 求职星计划 — 投递看板服务
 * 零依赖：node:http + node:sqlite。启动后打开 http://localhost:8630
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const dbApi = require('./db');
const search = require('./search');
const zhiye = require('./zhiye');
const byte = require('./byte');
const hotjob = require('./hotjob');
const moka = require('./moka');
const jd = require('./jd');
const mt = require('./mt');
const ali = require('./ali');
const tx = require('./tx');
const pdd = require('./pdd');
const ks = require('./ks');
const xhs = require('./xhs');
const bili = require('./bili');
const ant = require('./ant');
const mhy = require('./mhy');
const ctrip = require('./ctrip');
const ne = require('./ne');
const scorer = require('./scorer');
const companies = require('./companies');
const scan = require('./scan');
const resumeParse = require('./resume_parse');
const portrait = require('./portrait');
const encrypt = require('./encrypt');

const PORT = process.env.PORT || 8630;
const PUBLIC_DIR = path.join(__dirname, 'public');
const INVITE_CODE = process.env.INVITE_CODE || 'JOBSTAR2027'; // 邀请码（内测用，环境变量可覆盖）

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// ---- 基础响应 ---------------------------------------------------------------

function send(res, code, data) {
  const isText = typeof data === 'string';
  const body = isText ? data : JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type': isText ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        reject(new Error('请求体不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

// ---- 限流（简单固定窗口，内存；上云后可换 Redis 滑动窗口）----------------------
const rateBuckets = new Map();
function checkRateLimit(key, limit, windowMs) {
  const now = Date.now();
  const b = rateBuckets.get(key) || { count: 0, resetAt: now + windowMs };
  if (now > b.resetAt) { b.count = 0; b.resetAt = now + windowMs; }
  b.count++;
  rateBuckets.set(key, b);
  return b.count <= limit;
}
function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
}

// ---- 静态文件 ---------------------------------------------------------------

function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const resolved = path.resolve(PUBLIC_DIR, rel);
  if (!resolved.startsWith(PUBLIC_DIR + path.sep)) {
    return send(res, 403, 'Forbidden');
  }
  fs.readFile(resolved, (err, data) => {
    if (err) return send(res, 404, 'Not Found');
    const ext = path.extname(resolved).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}

// ---- API 路由 ---------------------------------------------------------------

// 打分异步任务表（内存态；重启后丢失，任务短命可接受）
const scoreTasks = new Map();

// 一键扫描异步任务表
const scanTasks = new Map();

async function handleApi(req, res, pathname, searchParams = new URLSearchParams()) {
  const db = dbApi.getDb();
  const _start = Date.now();
  let _currentUser = null; // 鉴权结果，catch/finally 的审计日志也要用，必须在 try 块外声明
  try {
    const authUser = () => {
      const token = String(req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
      _currentUser = token ? dbApi.getUserByToken(db, token) : null;
      return _currentUser;
    };

    // POST /api/register —— 注册（需邀请码）
    if (req.method === 'POST' && pathname === '/api/register') {
      if (!checkRateLimit('register:' + clientIp(req), 10, 60000)) return send(res, 429, { error: '请求过于频繁，请稍后再试' });
      const body = await readBody(req);
      if (String(body.inviteCode || '') !== INVITE_CODE) return send(res, 403, { error: '邀请码错误' });
      const user = dbApi.createUser(db, { username: body.username, password: body.password });
      require('./logger').audit('注册', { userId: user.id, username: user.username });
      return send(res, 201, user);
    }

    // POST /api/login —— 登录
    if (req.method === 'POST' && pathname === '/api/login') {
      if (!checkRateLimit('login:' + clientIp(req), 10, 60000)) return send(res, 429, { error: '请求过于频繁，请稍后再试' });
      const body = await readBody(req);
      const user = dbApi.loginUser(db, { username: body.username, password: body.password });
      require('./logger').audit('登录', { userId: user.id, username: user.username });
      return send(res, 200, user);
    }

    // POST /api/resume/parse —— 简历文本 → LLM 结构化画像（带 token 则存用户画像）
    if (req.method === 'POST' && pathname === '/api/resume/parse') {
      const body = await readBody(req);
      const text = String(body.resumeText || body.text || '').trim();
      if (!text) return send(res, 400, { error: '缺少 resumeText（简历文本）' });
      const parsed = await resumeParse.llmParseProfile(text);
      const profile = { meta: { owner: (parsed.identity && parsed.identity.legal_name) || '', updated: new Date().toISOString().slice(0, 10) }, ...parsed };
      const user = authUser();
      if (user) dbApi.updateUserProfile(db, user.id, profile);
      return send(res, 200, { profile });
    }

    // POST /api/resume/parse-file —— 上传简历文件（pdf/txt，base64）→ LLM 画像 + 存原始文件（供官网简历上传）
    if (req.method === 'POST' && pathname === '/api/resume/parse-file') {
      const body = await readBody(req);
      const fileName = String(body.fileName || 'resume.pdf');
      const fileData = body.fileData;
      if (!fileData) return send(res, 400, { error: '缺少 fileData（base64）' });
      const ext = (path.extname(fileName) || '.pdf').toLowerCase();
      const tmpFile = path.join(__dirname, 'data', `upload-${Date.now()}${ext}`);
      fs.writeFileSync(tmpFile, Buffer.from(fileData, 'base64'));
      try {
        const text = await resumeParse.extractText(tmpFile);
        const parsed = await resumeParse.llmParseProfile(text);
        const profile = { meta: { owner: (parsed.identity && parsed.identity.legal_name) || '', updated: new Date().toISOString().slice(0, 10), profile_version: resumeParse.PROFILE_VERSION }, ...parsed };
        // 一条龙：上传简历即生成搜索画像（search_portrait），存进 profile，点推荐时直接用
        try {
          const searchPortrait = await portrait.generateFromProfile(profile);
          profile.job_search = profile.job_search || {};
          profile.job_search.search_portrait = searchPortrait;
        } catch (e) { console.error('[画像生成] 上传时生成 search_portrait 失败（推荐时兜底重生成）：', e.message.slice(0, 150)); }
        const user = authUser();
        if (user) dbApi.updateUserProfile(db, user.id, profile);
        // 保存原始简历文件（供「上传简历到官网」四两拨千斤），按用户隔离
        const uid = user ? user.id : 'anonymous';
        const resumeDir = path.join(__dirname, 'data', 'resume-files');
        fs.mkdirSync(resumeDir, { recursive: true });
        fs.writeFileSync(path.join(resumeDir, `${uid}${ext}`), encrypt.encrypt(fs.readFileSync(tmpFile)));
        return send(res, 200, { profile, textLength: text.length, resumeFileName: `${uid}${ext}` });
      } finally {
        try { fs.unlinkSync(tmpFile); } catch {}
      }
    }

    // GET /api/resume/file —— 返回用户简历文件 base64（扩展「上传简历到官网」用）
    if (req.method === 'GET' && pathname === '/api/resume/file') {
      const user = authUser();
      if (!user) return send(res, 401, { error: '未登录' });
      const resumeDir = path.join(__dirname, 'data', 'resume-files');
      let file = null;
      try {
        const files = fs.readdirSync(resumeDir).filter((f) => f.startsWith(String(user.id) + '.'));
        if (files.length) file = files[0];
      } catch {}
      if (!file) return send(res, 404, { error: '没有保存的简历文件，请先上传简历' });
      const ext = path.extname(file).toLowerCase();
      const mimeType = { '.pdf': 'application/pdf', '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.txt': 'text/plain' }[ext] || 'application/octet-stream';
      return send(res, 200, { fileName: file, fileData: encrypt.decrypt(fs.readFileSync(path.join(resumeDir, file))).toString('base64'), mimeType });
    }

    // POST /api/resume/tailor —— 简历针对性优化（JD ↔ 简历匹配 + 定制建议）
    if (req.method === 'POST' && pathname === '/api/resume/tailor') {
      const body = await readBody(req);
      const jd = String(body.jd || '').trim();
      if (!jd) return send(res, 400, { error: '缺少 jd（岗位描述）' });
      const user = authUser();
      const savedProfile = user ? dbApi.getUserProfile(db, user.id) : null;
      const profile = (savedProfile && savedProfile.identity) ? savedProfile : body.profile;
      if (!profile || !profile.identity) return send(res, 400, { error: '缺少 profile（画像）' });
      const tailored = await resumeParse.llmTailorResume(jd, profile);
      return send(res, 200, tailored);
    }

    // GET /api/me —— 查询当前用户信息
    if (req.method === 'GET' && pathname === '/api/me') {
      const user = authUser();
      if (!user) return send(res, 401, { error: '未登录' });
      return send(res, 200, { username: user.username });
    }

    // GET /api/account/export —— 导出我的全部数据（画像 + 投递记录，数据可携带权）
    if (req.method === 'GET' && pathname === '/api/account/export') {
      const user = authUser();
      if (!user) return send(res, 401, { error: '未登录' });
      const data = dbApi.getUserData(db, user.id);
      require('./logger').audit('导出数据', { userId: user.id });
      return send(res, 200, data);
    }

    // DELETE /api/account —— 删除账号 + 关联数据（被遗忘权，不可恢复）
    if (req.method === 'DELETE' && pathname === '/api/account') {
      const user = authUser();
      if (!user) return send(res, 401, { error: '未登录' });
      const data = dbApi.getUserData(db, user.id);
      const ok = dbApi.deleteUser(db, user.id);
      // 顺带删除该用户的简历文件（如有）
      try {
        const resumeDir = path.join(__dirname, 'data', 'resume-files');
        const files = fs.readdirSync(resumeDir).filter((f) => f.startsWith(String(user.id) + '.'));
        for (const f of files) fs.unlinkSync(path.join(resumeDir, f));
      } catch {}
      require('./logger').audit('删除账号', { userId: user.id, username: data ? data.username : '', deletedApplications: data ? data.applications.length : 0 });
      return send(res, 200, { ok, deletedApplications: data ? data.applications.length : 0 });
    }

    // POST /api/recommend —— 画像 → 扫描+打分 → 推荐清单（异步任务，轮询 /api/scan/status）
    if (req.method === 'POST' && pathname === '/api/recommend') {
      if (!checkRateLimit('recommend:' + clientIp(req), 5, 60000)) return send(res, 429, { error: '推荐请求过于频繁，请稍后再试' });
      const body = await readBody(req);
      const user = authUser();
      const savedProfile = user ? dbApi.getUserProfile(db, user.id) : null;
      const profile = (savedProfile && savedProfile.identity) ? savedProfile : body.profile;
      if (!profile || !profile.identity) return send(res, 400, { error: '缺少 profile（画像）' });
      const jobId = String(Date.now()).slice(-8) + Math.floor(Math.random() * 1000);
      require('./logger').audit('发起推荐', { userId: user ? user.id : '', section: body.section || 'campus', mode: body.mode || 'precise', jobId });
      scanTasks.set(jobId, { status: 'running', progress: '生成搜索画像…', live: [] });
      (async () => {
        try {
          // profile 版本检查：llmParseProfile 逻辑改过（加 projects 字段、三级区分）→ 旧 profile 从简历文件自动重新解析，无需重新上传
          let currentProfile = profile;
          if (user && (!currentProfile.meta || currentProfile.meta.profile_version !== resumeParse.PROFILE_VERSION)) {
            try {
              const resumeDir = path.join(__dirname, 'data', 'resume-files');
              const files = fs.readdirSync(resumeDir).filter((f) => f.startsWith(String(user.id) + '.'));
              if (files.length) {
                const ext = path.extname(files[0]).toLowerCase();
                const plain = encrypt.decrypt(fs.readFileSync(path.join(resumeDir, files[0])));
                const tmpFile = path.join(__dirname, 'data', `reparse-${Date.now()}${ext}`);
                fs.writeFileSync(tmpFile, plain);
                const text = await resumeParse.extractText(tmpFile);
                const parsed = await resumeParse.llmParseProfile(text);
                currentProfile = { meta: { owner: (parsed.identity && parsed.identity.legal_name) || '', updated: new Date().toISOString().slice(0, 10), profile_version: resumeParse.PROFILE_VERSION }, ...parsed };
                try { fs.unlinkSync(tmpFile); } catch {}
                scanTasks.set(jobId, { status: 'running', progress: '画像逻辑已升级，自动重新解析简历…', live: [] });
              }
            } catch (e) { console.error('[画像] profile 版本升级重新解析失败：', e.message.slice(0, 150)); }
          }
          // 多用户隔离：优先用 profile 里已生成的 search_portrait（上传简历时一条龙生成）；
          // 画像版本号不匹配（改过生成逻辑）→ 自动失效重新生成，无需重新上传简历
          const existingSp = currentProfile.job_search && currentProfile.job_search.search_portrait;
          const spFresh = existingSp && Array.isArray(existingSp.keywords) && existingSp.keywords.length
            && existingSp.version === portrait.SEARCH_PORTRAIT_VERSION;
          const searchPortrait = spFresh ? existingSp : await portrait.generateFromProfile(currentProfile);
          // 重新生成时，把新画像存回 profile（下次推荐直接复用，不用再生成）
          if ((!spFresh || currentProfile !== profile) && user) {
            try {
              currentProfile.job_search = currentProfile.job_search || {};
              currentProfile.job_search.search_portrait = searchPortrait;
              dbApi.updateUserProfile(db, user.id, currentProfile);
            } catch {}
          }
          scanTasks.set(jobId, { status: 'running', progress: '扫描岗位并打分…', live: [] });
          const result = await scan.scanAll({
            section: body.section || 'campus',
            importToBoard: false, // 推荐不再自动导入待投：由用户在推荐卡片上手动「加入待投」
            userId: user ? String(user.id) : '',
            mode: body.mode || 'precise', // broad 海投 / precise 精投
            profile: currentProfile,
            searchPortrait,
            onProgress: (msg) => {
              const t = scanTasks.get(jobId) || { live: [] };
              scanTasks.set(jobId, { status: 'running', progress: msg, live: t.live || [] });
            },
            onLive: (jobs) => {
              const t = scanTasks.get(jobId) || { live: [] };
              scanTasks.set(jobId, { status: 'running', progress: t.progress, live: (t.live || []).concat(jobs) });
            },
          });
          const t = scanTasks.get(jobId) || { live: [] };
          scanTasks.set(jobId, { status: 'done', result, live: t.live || [] });
        } catch (e) {
          scanTasks.set(jobId, { status: 'error', error: e.message });
        }
      })();
      return send(res, 202, { jobId });
    }

    // POST /api/email/sync —— 邮箱同步：IMAP 拉取 + 分类 + 匹配投递记录（人工确认后才更新状态）
    if (req.method === 'POST' && pathname === '/api/email/sync') {
      const user = authUser();
      if (!user) return send(res, 401, { error: '未登录' });
      const body = await readBody(req);
      const { email, authCode, imapHost, imapPort } = body || {};
      try {
        const emailMod = require('./email');
        // 每次拉最近 30 天全量（不增量）：邮件数量不多（预过滤后几十封），全量最简单可靠，
        // 避免增量游标导致「历史邮件变少」的体验问题（曾踩坑：增量游标 + 前端覆盖 → 9封变2封）
        const results = await emailMod.syncEmails({ email, authCode, imapHost, imapPort });
        // 匹配投递记录：公司级 blocking → 岗位级打分 → 三档置信度（resolveMatch）
        const apps = dbApi.listApplications(db, user.id);
        const matched = await Promise.all(results.map(async (r) => {
          const m = await emailMod.resolveMatch(r, apps);
          return {
            subject: r.subject, from: r.from, status: r.status, company: r.company,
            title: r.title, interviewTime: r.interviewTime, matchedBy: r.matchedBy,
            confidence: m.confidence,
            matchedApp: m.matchedApp ? { id: m.matchedApp.id, company: m.matchedApp.company, title: m.matchedApp.title, status: m.matchedApp.status } : null,
            candidates: m.candidates.map((c) => ({ id: c.id, company: c.company, title: c.title, status: c.status })),
          };
        }));
        return send(res, 200, { count: results.length, results: matched });
      } catch (e) {
        // imapflow 错误带 responseStatus/responseText/executedCommand，带上便于定位是哪个 IMAP 命令失败
        const detail = [e.responseStatus, e.responseText, e.executedCommand].filter(Boolean).join(' | ');
        require('./logger').error('邮箱同步失败', { userId: user.id, email, msg: e.message, detail: detail || '' });
        return send(res, 500, { error: '邮箱同步失败：' + e.message + (detail ? '（' + String(detail).slice(0, 300) + '）' : '') });
      }
    }

    // POST /api/email/apply —— 应用邮件识别结果（更新投递状态，人工确认后调用）
    if (req.method === 'POST' && pathname === '/api/email/apply') {
      const user = authUser();
      if (!user) return send(res, 401, { error: '未登录' });
      const body = await readBody(req);
      const { appId, status } = body || {};
      const STATUS_MAP = { interview: 'interview', offer: 'offer', rejected: 'rejected', assessment: 'replied' };
      const newStatus = STATUS_MAP[status];
      if (!appId || !newStatus) return send(res, 400, { error: '参数错误' });
      const updated = dbApi.updateApplication(db, String(appId), { status: newStatus }, user.id);
      if (!updated) return send(res, 404, { error: '投递记录不存在' });
      return send(res, 200, { ok: true, status: newStatus });
    }

    // POST /api/autofill/map-fields —— LLM 语义字段映射（只收字段描述符，不收简历值，隐私设计）
    if (req.method === 'POST' && pathname === '/api/autofill/map-fields') {
      const body = await readBody(req);
      const { signals, keys } = body || {};
      if (!Array.isArray(signals) || !signals.length || !Array.isArray(keys)) return send(res, 400, { error: '参数错误' });
      try {
        const fs = require('node:fs');
        const path = require('node:path');
        let cfg = {};
        try { cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'scorer-config.json'), 'utf8')); } catch {}
        const apiKey = String(cfg.apiKey || process.env.DEEPSEEK_API_KEY || '');
        const baseUrl = String(cfg.baseUrl || process.env.SCORER_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
        const model = String(cfg.judgeModel || process.env.SCORER_JUDGE_MODEL || 'deepseek-chat');
        if (!apiKey) return send(res, 500, { error: '未配置 LLM' });
        const prompt = `你是表单字段语义匹配助手。把每个表单字段映射到候选人档案的一个字段。

档案字段 keys：${JSON.stringify(keys)}
表单字段（index + 描述符，只含标签/占位符，不含简历值）：${JSON.stringify(signals.map((s) => ({ index: s.index, signal: s.signal, tag: s.tag })))}

输出严格 JSON：{"mapping": [{"index": 0, "key": "name"}]}
规则：只映射能确定对应的字段（如「中文姓名」→name、「联系方式」→phone、「最高学历」→degree）；无法确定的不放进 mapping。只返回 JSON，不要其他文字。`;
        const lr = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: 0.1, max_tokens: 500 }),
        });
        const j = await lr.json();
        const content = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
        const start = content.indexOf('{');
        const end = content.lastIndexOf('}') + 1;
        let mapping = [];
        if (start >= 0 && end > start) {
          try { mapping = (JSON.parse(content.slice(start, end)).mapping || []).filter((m) => keys.includes(m.key)); } catch {}
        }
        return send(res, 200, { mapping });
      } catch (e) {
        return send(res, 500, { error: '字段映射失败：' + e.message });
      }
    }

    // GET /api/meta —— 状态机与渠道定义
    if (req.method === 'GET' && pathname === '/api/meta') {
      return send(res, 200, {
        statuses: dbApi.STATUSES,
        statusOrder: dbApi.STATUS_ORDER,
        transitions: dbApi.TRANSITIONS,
        channels: dbApi.CHANNELS,
      });
    }

    // GET /healthz —— 健康检查 + 基础监控指标（探活/监控用，无需鉴权）
    if (req.method === 'GET' && pathname === '/healthz') {
      const mem = process.memoryUsage();
      let dbStatus = 'ok';
      try { dbApi.getDb().prepare('SELECT 1').get(); } catch { dbStatus = 'error'; }
      return send(res, 200, {
        status: dbStatus === 'ok' ? 'ok' : 'degraded',
        uptime: Math.round(process.uptime()),
        memory: { rssMB: Math.round(mem.rss / 1024 / 1024), heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024) },
        db: dbStatus,
        activeScanTasks: scanTasks.size,
        activeScoreTasks: scoreTasks.size,
        version: '0.2.0',
        time: new Date().toISOString(),
      });
    }

    // GET /api/search-options —— 筛选项可选值
    if (req.method === 'GET' && pathname === '/api/search-options') {
      return send(res, 200, search.getFilterOptions());
    }

    // GET /api/search —— 关键词找岗位
    if (req.method === 'GET' && pathname === '/api/search') {
      const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '50', 10) || 50, 1), 200);
      return send(res, 200, search.searchJobs({
        kw: searchParams.get('kw') || '',
        city: searchParams.get('city') || '',
        type: searchParams.get('type') || '',
        degree: searchParams.get('degree') || '',
        industry: searchParams.get('industry') || '',
        tier: searchParams.get('tier') || '',
        limit,
      }));
    }

    // POST /api/import —— 把搜索到的岗位导入「待投」列（去重）
    if (req.method === 'POST' && pathname === '/api/import') {
      const user = authUser();
      if (!user) return send(res, 401, { error: '未登录' });
      const body = await readBody(req);
      const result = dbApi.importApplication(db, { ...search.jobToApplication(body), user_id: String(user.id) });
      return send(res, result.created ? 201 : 200, result);
    }

    // POST /api/scrape-zhiye —— 抓取某公司官网真实在招岗位（耗时约 10-20 秒）
    if (req.method === 'POST' && pathname === '/api/scrape-zhiye') {
      const user = authUser();
      if (!user) return send(res, 401, { error: '未登录' });
      const body = await readBody(req);
      const result = await zhiye.scrapeZhiye(body);
      return send(res, 200, result);
    }

    // POST /api/import-zhiye —— 把官网抓到的岗位导入「待投」列（去重）
    if (req.method === 'POST' && pathname === '/api/import-zhiye') {
      const user = authUser();
      if (!user) return send(res, 401, { error: '未登录' });
      const body = await readBody(req);
      const input = zhiye.zhiyeToApplication(body.job, { company: body.company, url: body.url });
      const result = dbApi.importApplication(db, { ...input, user_id: String(user.id) });
      return send(res, result.created ? 201 : 200, result);
    }

    // GET /api/companies —— 目标公司注册表
    if (req.method === 'GET' && pathname === '/api/companies') {
      return send(res, 200, companies.getCompanies());
    }

    // POST /api/score —— 智能打分（异步任务）：返回 jobId，用 /api/score/status 轮询
    if (req.method === 'POST' && pathname === '/api/score') {
      const user = authUser();
      if (!user) return send(res, 401, { error: '未登录' });
      const body = await readBody(req);
      const jobId = String(Date.now()).slice(-8) + Math.floor(Math.random() * 1000);
      scoreTasks.set(jobId, { status: 'running' });
      scorer
        .scoreJobs(body.jobs || [], { typeFilter: body.typeFilter, fineCap: body.fineCap })
        .then((result) => scoreTasks.set(jobId, { status: 'done', result }))
        .catch((e) => scoreTasks.set(jobId, { status: 'error', error: e.message }));
      return send(res, 202, { jobId });
    }

    // GET /api/score/status?id=xxx —— 轮询打分进度
    if (req.method === 'GET' && pathname === '/api/score/status') {
      const jobId = searchParams.get('id') || '';
      const task = scoreTasks.get(jobId);
      if (!task) return send(res, 404, { error: '任务不存在或已过期' });
      return send(res, 200, task.status === 'running' ? { status: 'running' } : task);
    }

    // POST /api/scan —— 一键扫描全部目标公司（异步任务），用 /api/scan/status 轮询
    if (req.method === 'POST' && pathname === '/api/scan') {
      const user = authUser();
      if (!user) return send(res, 401, { error: '未登录' });
      const body = await readBody(req);
      const jobId = String(Date.now()).slice(-8) + Math.floor(Math.random() * 1000);
      scanTasks.set(jobId, { status: 'running', progress: '准备中…' });
      scan
        .scanAll({
          section: body.section || 'campus',
          importToBoard: body.importToBoard !== false,
          onProgress: (msg) => scanTasks.set(jobId, { status: 'running', progress: msg }),
        })
        .then((result) => scanTasks.set(jobId, { status: 'done', result }))
        .catch((e) => scanTasks.set(jobId, { status: 'error', error: e.message }));
      return send(res, 202, { jobId });
    }

    // GET /api/scan/status?id=xxx —— 轮询扫描进度
    if (req.method === 'GET' && pathname === '/api/scan/status') {
      const jobId = searchParams.get('id') || '';
      const task = scanTasks.get(jobId);
      if (!task) return send(res, 404, { error: '任务不存在或已过期' });
      return send(res, 200, task.status === 'running'
        ? { status: 'running', progress: task.progress, live: task.live || [] }
        : task);
    }

    // POST /api/scrape —— 通用抓取：按公司名查注册表，分发到对应适配器
    if (req.method === 'POST' && pathname === '/api/scrape') {
      const user = authUser();
      if (!user) return send(res, 401, { error: '未登录' });
      const body = await readBody(req);
      const company = companies.findCompany(body.name);
      if (!company) return send(res, 404, { error: '公司不在注册表中' });
      if (company.adapter === 'zhiye') {
        const result = await zhiye.scrapeZhiye({ subdomain: company.subdomain, section: body.section, path: company.path, fallbackName: company.name });
        result.adapter = 'zhiye';
        return send(res, 200, result);
      }
      if (company.adapter === 'byte') {
        const cfg = company.byte || {};
        const result = await byte.scrapeByteDance({ section: body.section, keyword: body.keyword || '', base: cfg.base, campusPath: cfg.campusPath, socialPath: cfg.socialPath });
        result.adapter = 'byte';
        return send(res, 200, result);
      }
      if (company.adapter === 'hotjob') {
        const result = await hotjob.scrapeHotjob({ suiteId: company.suiteId, section: body.section, fallbackName: company.name });
        result.adapter = 'hotjob';
        return send(res, 200, result);
      }
      if (company.adapter === 'moka') {
        const cfg = company.moka || {};
        const result = await moka.scrapeMoka({ org: cfg.org, siteId: cfg.siteId, section: body.section || cfg.section, base: cfg.base, pathPrefix: cfg.pathPrefix, fallbackName: company.name });
        result.adapter = 'moka';
        return send(res, 200, result);
      }
      if (company.adapter === 'jd') {
        const result = await jd.scrapeJd({ keyword: body.keyword || '', fallbackName: company.name });
        result.adapter = 'jd';
        return send(res, 200, result);
      }
      if (company.adapter === 'mt') {
        const result = await mt.scrapeMt({ keyword: body.keyword || '', fallbackName: company.name });
        result.adapter = 'mt';
        return send(res, 200, result);
      }
      if (company.adapter === 'ali') {
        const result = await ali.scrapeAli({ fallbackName: company.name });
        result.adapter = 'ali';
        return send(res, 200, result);
      }
      if (company.adapter === 'tx') {
        const result = await tx.scrapeTx({ keyword: body.keyword || '', fallbackName: company.name });
        result.adapter = 'tx';
        return send(res, 200, result);
      }
      if (company.adapter === 'pdd') {
        const result = await pdd.scrapePdd({ fallbackName: company.name });
        result.adapter = 'pdd';
        return send(res, 200, result);
      }
      if (company.adapter === 'ks') {
        const result = await ks.scrapeKs({ fallbackName: company.name });
        result.adapter = 'ks';
        return send(res, 200, result);
      }
      if (company.adapter === 'xhs') {
        const result = await xhs.scrapeXhs({ section: body.section, fallbackName: company.name });
        result.adapter = 'xhs';
        return send(res, 200, result);
      }
      if (company.adapter === 'bili') {
        const result = await bili.scrapeBili({ fallbackName: company.name });
        result.adapter = 'bili';
        return send(res, 200, result);
      }
      if (company.adapter === 'ant') {
        const result = await ant.scrapeAnt({ fallbackName: company.name });
        result.adapter = 'ant';
        return send(res, 200, result);
      }
      if (company.adapter === 'mhy') {
        const result = await mhy.scrapeMhy({ fallbackName: company.name });
        result.adapter = 'mhy';
        return send(res, 200, result);
      }
      if (company.adapter === 'ctrip') {
        const result = await ctrip.scrapeCtrip({ fallbackName: company.name });
        result.adapter = 'ctrip';
        return send(res, 200, result);
      }
      if (company.adapter === 'ne') {
        const result = await ne.scrapeNe({ fallbackName: company.name });
        result.adapter = 'ne';
        return send(res, 200, result);
      }
      return send(res, 400, { error: `「${company.name}」使用自研招聘系统（${company.url}），适配器待开发` });
    }

    // POST /api/import-job —— 通用导入：按 adapter 把岗位映射为投递记录（去重）
    if (req.method === 'POST' && pathname === '/api/import-job') {
      const user = authUser();
      if (!user) return send(res, 401, { error: '未登录' });
      const body = await readBody(req);
      const input = body.adapter === 'byte'
        ? byte.byteToApplication(body.job, { company: body.company, url: body.url })
        : body.adapter === 'hotjob'
          ? hotjob.hotjobToApplication(body.job, { company: body.company, url: body.url })
          : body.adapter === 'moka'
            ? moka.mokaToApplication(body.job, { company: body.company, url: body.url })
            : body.adapter === 'jd'
              ? jd.jdToApplication(body.job, { company: body.company, url: body.url })
              : body.adapter === 'mt'
                ? mt.mtToApplication(body.job, { company: body.company, url: body.url })
                : body.adapter === 'ali'
                  ? ali.aliToApplication(body.job, { company: body.company, url: body.url })
                  : body.adapter === 'tx'
                    ? tx.txToApplication(body.job, { company: body.company, url: body.url })
                    : body.adapter === 'pdd'
                      ? pdd.pddToApplication(body.job, { company: body.company, url: body.url })
                      : body.adapter === 'ks'
                        ? ks.ksToApplication(body.job, { company: body.company, url: body.url })
                        : body.adapter === 'xhs'
                          ? xhs.xhsToApplication(body.job, { company: body.company, url: body.url })
                          : body.adapter === 'bili'
                            ? bili.biliToApplication(body.job, { company: body.company, url: body.url })
                            : body.adapter === 'ant'
                              ? ant.antToApplication(body.job, { company: body.company, url: body.url })
                              : body.adapter === 'mhy'
                                ? mhy.mhyToApplication(body.job, { company: body.company, url: body.url })
                                : body.adapter === 'ctrip'
                                  ? ctrip.ctripToApplication(body.job, { company: body.company, url: body.url })
                                  : body.adapter === 'ne'
                                    ? ne.neToApplication(body.job, { company: body.company, url: body.url })
                                    : zhiye.zhiyeToApplication(body.job, { company: body.company, url: body.url });
      const result = dbApi.importApplication(db, { ...input, user_id: String(user.id) });
      return send(res, result.created ? 201 : 200, result);
    }

    // GET /api/stats —— 漏斗统计（需登录，按用户隔离）
    if (req.method === 'GET' && pathname === '/api/stats') {
      const user = authUser();
      if (!user) return send(res, 401, { error: '未登录' });
      return send(res, 200, dbApi.getStats(db, user.id));
    }

    // GET /api/activity —— 最近动态
    if (req.method === 'GET' && pathname === '/api/activity') {
      const user = authUser();
      if (!user) return send(res, 401, { error: '未登录' });
      return send(res, 200, dbApi.getActivity(db, user.id));
    }

    // GET /api/applications —— 列表（附投递限制预警）
    if (req.method === 'GET' && pathname === '/api/applications') {
      const limits = require('./limits');
      const user = authUser();
      if (!user) return send(res, 401, { error: '未登录' });
      const apps = dbApi.listApplications(db, user.id).map((a) => ({
        ...a,
        applyLimit: limits.getApplyLimit(a.company),
      }));
      return send(res, 200, apps);
    }

    // POST /api/applications/mark-applied —— 「去投递」锚定：按 job_id 定位并标记已投（记 applied_at）
    if (req.method === 'POST' && pathname === '/api/applications/mark-applied') {
      const body = await readBody(req);
      const user = authUser();
      if (!user) return send(res, 401, { error: '未登录' });
      const app = dbApi.findByJobId(db, body.job_id, body.company, user.id);
      if (!app) return send(res, 404, { error: '岗位不在待投看板中（可能未导入或已投）' });
      const updated = dbApi.updateApplication(db, app.id, { status: 'applied' }, user.id);
      require('./logger').audit('标记已投递', { userId: user.id, appId: app.id, company: app.company || '', title: app.title || '' });
      return send(res, 200, updated);
    }

    // POST /api/applications —— 加入待投（幂等：company+job_id 去重，重复加入不产生重复记录）
    if (req.method === 'POST' && pathname === '/api/applications') {
      const user = authUser();
      if (!user) return send(res, 401, { error: '未登录' });
      const body = await readBody(req);
      // 关键：user_id 必须转成字符串。sanitizeApplication 的 str() 只接受字符串，
      // 传数字会被转成空字符串 ""，导致记录「不属于任何用户」在投递看板查不到。
      const result = dbApi.importApplication(db, { ...body, user_id: String(user.id) });
      return send(res, result.created ? 201 : 200, result);
    }

    // /api/applications/:id —— 查 / 改 / 删（需登录，且只能操作自己的记录）
    const match = pathname.match(/^\/api\/applications\/([^/]+)(?:\/history)?$/);
    if (match) {
      const id = decodeURIComponent(match[1]);
      const isHistory = pathname.endsWith('/history');
      const user = authUser();
      if (!user) return send(res, 401, { error: '未登录' });

      if (isHistory && req.method === 'GET') {
        return send(res, 200, dbApi.getHistory(db, id, user.id));
      }
      if (!isHistory && req.method === 'GET') {
        const app = dbApi.getApplication(db, id, user.id);
        return app ? send(res, 200, app) : send(res, 404, { error: '记录不存在' });
      }
      if (!isHistory && req.method === 'PATCH') {
        const body = await readBody(req);
        const before = dbApi.getApplication(db, id, user.id);
        const updated = dbApi.updateApplication(db, id, body, user.id);
        if (updated) require('./logger').audit('修改投递记录', { userId: user.id, appId: id, company: updated.company || '', status: `${before ? before.status : '?'}→${updated.status}` });
        return updated ? send(res, 200, updated) : send(res, 404, { error: '记录不存在' });
      }
      if (!isHistory && req.method === 'DELETE') {
        const target = dbApi.getApplication(db, id, user.id);
        const ok = dbApi.deleteApplication(db, id, user.id);
        if (ok) require('./logger').audit('删除投递记录', { userId: user.id, appId: id, company: target ? target.company : '', title: target ? target.title : '' });
        return ok ? send(res, 204, '') : send(res, 404, { error: '记录不存在' });
      }
    }

    send(res, 404, { error: '接口不存在' });
  } catch (e) {
    require('./logger').error('API 错误', { method: req.method, path: pathname, userId: _currentUser ? _currentUser.id : '', error: e.message });
    send(res, 400, { error: e.message });
  } finally {
    require('./logger').info('API 请求', { method: req.method, path: pathname, userId: _currentUser ? _currentUser.id : '', ms: Date.now() - _start });
    db.close();
  }
}

// ---- 启动 -------------------------------------------------------------------

const server = http.createServer((req, res) => {
  // CORS 预检：OPTIONS 请求直接返回，不带 body（扩展跨域调用必需）
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    });
    return res.end();
  }
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/') || url.pathname === '/healthz') {
    handleApi(req, res, url.pathname, url.searchParams).catch((e) => send(res, 500, { error: e.message }));
  } else {
    serveStatic(res, url.pathname);
  }
});

server.listen(PORT, () => {
  console.log('──────────────────────────────────────────────');
  console.log('  求职星计划 · 投递看板已启动');
  console.log(`  打开: http://localhost:${PORT}`);
  console.log('  数据文件: tracker/data/tracker.db');
  console.log('──────────────────────────────────────────────');
});
