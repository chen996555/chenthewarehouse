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

const PORT = process.env.PORT || 8630;
const PUBLIC_DIR = path.join(__dirname, 'public');

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
  try {
    // GET /api/meta —— 状态机与渠道定义
    if (req.method === 'GET' && pathname === '/api/meta') {
      return send(res, 200, {
        statuses: dbApi.STATUSES,
        statusOrder: dbApi.STATUS_ORDER,
        transitions: dbApi.TRANSITIONS,
        channels: dbApi.CHANNELS,
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
      const body = await readBody(req);
      const result = dbApi.importApplication(db, search.jobToApplication(body));
      return send(res, result.created ? 201 : 200, result);
    }

    // POST /api/scrape-zhiye —— 抓取某公司官网真实在招岗位（耗时约 10-20 秒）
    if (req.method === 'POST' && pathname === '/api/scrape-zhiye') {
      const body = await readBody(req);
      const result = await zhiye.scrapeZhiye(body);
      return send(res, 200, result);
    }

    // POST /api/import-zhiye —— 把官网抓到的岗位导入「待投」列（去重）
    if (req.method === 'POST' && pathname === '/api/import-zhiye') {
      const body = await readBody(req);
      const input = zhiye.zhiyeToApplication(body.job, { company: body.company, url: body.url });
      const result = dbApi.importApplication(db, input);
      return send(res, result.created ? 201 : 200, result);
    }

    // GET /api/companies —— 目标公司注册表
    if (req.method === 'GET' && pathname === '/api/companies') {
      return send(res, 200, companies.getCompanies());
    }

    // POST /api/score —— 智能打分（异步任务）：返回 jobId，用 /api/score/status 轮询
    if (req.method === 'POST' && pathname === '/api/score') {
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
      return send(res, 200, task.status === 'running' ? { status: 'running', progress: task.progress } : task);
    }

    // POST /api/scrape —— 通用抓取：按公司名查注册表，分发到对应适配器
    if (req.method === 'POST' && pathname === '/api/scrape') {
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
      const result = dbApi.importApplication(db, input);
      return send(res, result.created ? 201 : 200, result);
    }

    // GET /api/stats —— 漏斗统计
    if (req.method === 'GET' && pathname === '/api/stats') {
      return send(res, 200, dbApi.getStats(db));
    }

    // GET /api/activity —— 最近动态
    if (req.method === 'GET' && pathname === '/api/activity') {
      return send(res, 200, dbApi.getActivity(db));
    }

    // GET /api/applications —— 列表
    if (req.method === 'GET' && pathname === '/api/applications') {
      return send(res, 200, dbApi.listApplications(db));
    }

    // POST /api/applications —— 新建
    if (req.method === 'POST' && pathname === '/api/applications') {
      const body = await readBody(req);
      return send(res, 201, dbApi.createApplication(db, body));
    }

    // /api/applications/:id —— 查 / 改 / 删
    const match = pathname.match(/^\/api\/applications\/([^/]+)(?:\/history)?$/);
    if (match) {
      const id = decodeURIComponent(match[1]);
      const isHistory = pathname.endsWith('/history');

      if (isHistory && req.method === 'GET') {
        return send(res, 200, dbApi.getHistory(db, id));
      }
      if (!isHistory && req.method === 'GET') {
        const app = dbApi.getApplication(db, id);
        return app ? send(res, 200, app) : send(res, 404, { error: '记录不存在' });
      }
      if (!isHistory && req.method === 'PATCH') {
        const body = await readBody(req);
        const updated = dbApi.updateApplication(db, id, body);
        return updated ? send(res, 200, updated) : send(res, 404, { error: '记录不存在' });
      }
      if (!isHistory && req.method === 'DELETE') {
        const ok = dbApi.deleteApplication(db, id);
        return ok ? send(res, 204, '') : send(res, 404, { error: '记录不存在' });
      }
    }

    send(res, 404, { error: '接口不存在' });
  } catch (e) {
    send(res, 400, { error: e.message });
  } finally {
    db.close();
  }
}

// ---- 启动 -------------------------------------------------------------------

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
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
