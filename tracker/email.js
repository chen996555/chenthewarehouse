'use strict';
/**
 * 求职星计划 — 邮件跟踪（投递状态自动更新）
 *
 * 落地链路（2026-09 重构，吸收业界最佳实践）：
 *   邮箱接入（QQ/163 IMAP + 授权码）
 *   → 拉取（imapflow envelope+source，mailparser/simpleParser 解析 MIME/中文/附件）
 *   → 预过滤（本地强信号：面试/offer/拒信/测评，滤掉订阅广告验证码）
 *   → LLM 结构化提取（并发，提取 status/公司/职位/面试时间）
 *   → messageId 去重 → 匹配投递记录
 *
 * 相比旧版的关键修复：
 *   - 旧版手写 extractText 只去 HTML 标签，base64 附件会混进正文 → 改用 simpleParser 正确解析
 *   - 旧版规则命中后 company 为空 → 无法匹配投递记录 → 现在统一 LLM 提取公司名
 *   - 旧版串行 LLM → 现在并发；旧版无去重/无容错 → 现在 messageId 去重 + 单封 try/catch
 */

const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const path = require('node:path');
const fs = require('node:fs');
const { embed, cosine } = require('./embedding');

// LLM 配置（复用 resume_parse.js：本地 config > 环境变量 > 默认）
const CONFIG_PATH = path.join(__dirname, 'data', 'scorer-config.json');
function loadLlmConfig() {
  let fileCfg = {};
  try { if (fs.existsSync(CONFIG_PATH)) fileCfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch {}
  return {
    apiKey: String(fileCfg.apiKey || process.env.DEEPSEEK_API_KEY || ''),
    baseUrl: String(fileCfg.baseUrl || process.env.SCORER_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, ''),
    judgeModel: String(fileCfg.judgeModel || process.env.SCORER_JUDGE_MODEL || 'deepseek-chat'),
  };
}
const LLM = loadLlmConfig();

// 常见邮箱 IMAP 配置（授权码 ≠ 登录密码，需先在网页邮箱开启 IMAP/SMTP 生成）
const IMAP_PRESETS = {
  'qq.com': { host: 'imap.qq.com', port: 993 },
  '163.com': { host: 'imap.163.com', port: 993 },
  '126.com': { host: 'imap.126.com', port: 993 },
  'gmail.com': { host: 'imap.gmail.com', port: 993 },
  'outlook.com': { host: 'outlook.office365.com', port: 993 },
  'hotmail.com': { host: 'outlook.office365.com', port: 993 },
};

function imapPreset(email) {
  const domain = String(email || '').split('@')[1] || '';
  return IMAP_PRESETS[domain] || null;
}

// 公司名归一化（去中英文括号/城市前缀 + 循环去法律后缀，统一 &/and，去空白转小写）
function normalizeCompany(name) {
  let s = String(name || '')
    .replace(/[（(][^)）]*[)）]/g, '')  // 去中英文括号
    .replace(/&/g, ' and ')
    .replace(/\s+/g, '')
    .toLowerCase();
  // 循环去后缀（多个后缀连续去掉，如「有限公司」→「科技」→「」）
  const suffix = /(股份|集团|有限|责任|公司|科技|技术|corporation|corp|inc|llc|ltd|gmbh|ag|co\.?|limited|holding)$/;
  let prev;
  do { prev = s; s = s.replace(suffix, ''); } while (s !== prev);
  // 去城市前缀（可能误伤「北京银行」→「银行」，但匹配用包含兜底）
  s = s.replace(/^(beijing|shanghai|shenzhen|guangzhou|hangzhou|nanjing|wuhan|chengdu|chongqing|tianjin|suzhou|xian|hongkong|china)/, '');
  return s;
}

// 岗位名归一化（去括号/空白/标点/通用前后缀），用于同公司多岗位的岗位级匹配
function normalizeTitle(title) {
  let s = String(title || '').toLowerCase();
  s = s.replace(/[（(][^)）]*[)）]/g, '');  // 去括号内容「采购（校招）」
  s = s.replace(/^(校招|社招|实习|应届|管培|202\d届|25届|26届|27届)/, '');  // 去前缀
  const suffix = /(实习生|工程师|专员|专家|经理|主管|总监|顾问|分析师|岗|岗位|职位|方向|培训生|管培生)$/;
  let prev;
  do { prev = s; s = s.replace(suffix, ''); } while (s !== prev);  // 循环去后缀
  return s.replace(/[\s\-—_·、，。,.|/\\（）()]/g, '');  // 去空白/标点
}

// 预过滤：本地强信号判断「是否可能求职相关」（只负责滤掉明显无关的订阅/广告/验证码，
// 不负责精确判定状态——精确判定交给 LLM。误命中只多花一次 LLM，漏命中会漏掉跟踪，故宁宽勿漏）
function isJobCandidate(subject, from, text) {
  const hay = `${subject} ${from} ${text}`.toLowerCase();
  const STRONG = [
    '面试', '笔试', '测评', '约面', '面谈', '一面', '二面', '三面', '复试', '群面', '终面',
    'offer', '录用', '录用通知', 'offer letter', '薪酬', '薪资', '签约', '入职',
    '拒信', '遗憾', '未通过', '不予录用', '没有通过', '不合适',
    'interview', 'assessment', 'onsite', 'unfortunately', 'regret to inform',
    'not moving forward', 'other candidates', 'after careful',
  ];
  return STRONG.some((w) => hay.includes(w));
}

// LLM 结构化提取（status + 公司 + 职位 + 面试时间）。内部 try/catch：单封失败返回 error 字段，不中断整体
async function llmClassify(subject, from, text) {
  const EMPTY = { isJobRelated: false, status: 'none', company: '', title: '', interviewTime: '' };
  if (!LLM.apiKey) return EMPTY;
  const prompt = `你是求职邮件分类助手。判断这封邮件是否「求职相关」（面试邀约/拒信/录用/笔试测评），并提取信息。

邮件主题：${subject}
发件人：${from}
正文（前2000字）：${String(text || '').slice(0, 2000)}

输出严格 JSON：
{"isJobRelated": true/false, "status": "interview/offer/rejected/assessment/none", "company": "公司名", "title": "岗位名", "interviewTime": "面试/笔试时间"}

规则：
- 求职无关（广告/订阅/个人邮件/招聘平台群发推送/投递确认回执）→ isJobRelated=false
- 面试邀约 → status=interview；录用 → offer；拒信 → rejected；笔试/测评邀请 → assessment
- 公司名：从发件人域名、发件人显示名、正文开头、落款提取；去掉「招聘」「HR」「校招组」「人力资源」等后缀，只留公司主体名。**中文公司名优先**（如「腾讯」「字节跳动」，而非「tencent」）
- title：岗位名，没有则留空
- interviewTime：面试/笔试的具体时间，没有则留空
- 只返回 JSON，不要其他文字`;
  try {
    const res = await fetch(`${LLM.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LLM.apiKey}` },
      body: JSON.stringify({ model: LLM.judgeModel, messages: [{ role: 'user', content: prompt }], temperature: 0.1, max_tokens: 500 }),
    });
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
    const j = await res.json();
    const content = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}') + 1;
    if (start < 0 || end <= start) throw new Error('无 JSON 输出');
    const p = JSON.parse(content.slice(start, end));
    return {
      isJobRelated: !!p.isJobRelated,
      status: p.status || 'none',
      company: p.company || '',
      title: p.title || '',
      interviewTime: p.interviewTime || '',
    };
  } catch (e) {
    return { ...EMPTY, error: e.message };
  }
}

// 并发映射（限制并发数，用于并发调 LLM）
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * 同步邮箱：IMAP 拉取 → 预过滤 → 并发 LLM 分类 → 返回识别结果
 * @param {object} cfg { email, authCode, imapHost?, imapPort?, sinceDate?, maxEmails?, llmConcurrency? }
 * @returns {Promise<Array>} [{ subject, from, status, company, title, interviewTime, matchedBy, messageId, error? }]
 */
async function syncEmails({ email, authCode, imapHost, imapPort, sinceDate, maxEmails = 100, llmConcurrency = 5 }) {
  if (!email || !authCode) throw new Error('缺少邮箱或授权码');
  const preset = imapPreset(email);
  const host = imapHost || (preset && preset.host);
  const port = imapPort || (preset && preset.port);
  if (!host) throw new Error('未知邮箱域名，请手动填写 IMAP 服务器地址');

  const client = new ImapFlow({
    host,
    port: Number(port) || 993,
    secure: true,
    auth: { user: email, pass: authCode },
    logger: false,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      // sinceDate 归一化到日期粒度（00:00 UTC）：兼容旧版存的精确时间戳，
      // 避免 IMAP 的 SINCE/WITHIN 对「精确到毫秒、接近 now」的时间戳触发边界 BAD
      const since = sinceDate
        ? new Date(String(sinceDate).slice(0, 10) + 'T00:00:00Z')
        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      // 第一步：拉取 envelope + source，预过滤出「求职候选」
      const candidates = [];
      const seenIds = new Set();
      for await (const msg of client.fetch({ since }, { envelope: true, source: true })) {
        const messageId = (msg.envelope && msg.envelope.messageId) || '';
        if (messageId && seenIds.has(messageId)) continue; // 去重（Gmail 多标签场景同一封会重复返回）
        if (messageId) seenIds.add(messageId);

        const subject = (msg.envelope && msg.envelope.subject) || '';
        const fromAddr = (msg.envelope && msg.envelope.from && msg.envelope.from[0] && msg.envelope.from[0].address) || '';
        const fromName = (msg.envelope && msg.envelope.from && msg.envelope.from[0] && msg.envelope.from[0].name) || '';
        const from = fromName ? `${fromName} <${fromAddr}>` : fromAddr;

        // 用 simpleParser 解析正文（正确处理 MIME/中文/base64，正文不含附件）
        let text = '';
        try {
          const parsed = await simpleParser(msg.source, { skipAttachments: true });
          text = (parsed.text || '').replace(/\s+/g, ' ').trim().slice(0, 2000);
        } catch { /* 解析失败则用空正文，仍靠 subject/from 过滤 */ }

        if (!isJobCandidate(subject, from, text)) continue; // 无关邮件，跳过
        candidates.push({ subject, from, text, messageId });
        if (candidates.length >= maxEmails) break;
      }

      // 第二步：并发 LLM 结构化提取
      const classified = await mapLimit(candidates, llmConcurrency, async (c) => {
        const r = await llmClassify(c.subject, c.from, c.text);
        if (r.error) return null; // 单封 LLM 失败，丢弃（容错，不中断整体）
        if (!r.isJobRelated || r.status === 'none') return null; // 求职无关或无状态，丢弃
        return {
          subject: c.subject,
          from: c.from,
          status: r.status,
          company: r.company,
          title: r.title,
          interviewTime: r.interviewTime,
          matchedBy: 'llm',
          messageId: c.messageId,
        };
      });

      // 过滤掉 null（无关邮件 / 单封失败）
      return classified.filter(Boolean);
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
}

// embedding 语义打分：邮件岗位名 vs 候选岗位名（返回按相似度降序）
async function scoreByTitle(email, candidates) {
  const docs = candidates.map((a) => String(a.title || a.company || ''));
  try {
    const vecs = await embed([String(email.title || email.company || ''), ...docs]);
    const q = vecs[0];
    return vecs.slice(1)
      .map((v, i) => ({ app: candidates[i], score: cosine(q, v) }))
      .sort((a, b) => b.score - a.score);
  } catch {
    // embedding 失败（无 key 等）→ 全部 0 分，落到「中置信」交人工
    return candidates.map((a) => ({ app: a, score: 0 }));
  }
}

/**
 * 匹配一封邮件到投递记录：公司级 blocking → 岗位级打分（归一化 + embedding）→ 三档置信度
 * @returns {Promise<{confidence:'high'|'medium'|'none', matchedApp:object|null, candidates:Array}>}
 *   high   = 唯一强匹配（同公司单岗位 / 岗位名精确或语义强匹配）→ 可直接建议更新
 *   medium = 公司命中但岗位存疑（同公司多岗位，语义不唯一）→ 返回候选交人工选
 *   none   = 公司都匹配不上 → orphan，不静默链接
 */
async function resolveMatch(email, apps) {
  const n = normalizeCompany(email.company);
  if (!n) return { confidence: 'none', matchedApp: null, candidates: [] };

  // ① 公司级 blocking：缩小到同公司记录
  const candidates = (apps || []).filter((a) => {
    const an = normalizeCompany(a.company);
    return an && (n === an || n.includes(an) || an.includes(n));
  });
  if (!candidates.length) return { confidence: 'none', matchedApp: null, candidates: [] };
  if (candidates.length === 1) return { confidence: 'high', matchedApp: candidates[0], candidates: [] };

  // ② 岗位级：归一化精确/包含匹配（免费、快，先走）
  const nt = normalizeTitle(email.title);
  if (nt) {
    const exact = candidates.filter((a) => {
      const at = normalizeTitle(a.title);
      return at && (nt === at || nt.includes(at) || at.includes(nt));
    });
    if (exact.length === 1) return { confidence: 'high', matchedApp: exact[0], candidates: [] };
  }

  // ③ 岗位级：embedding 语义相似（候选多或精确匹配不上时兜底）
  const scored = await scoreByTitle(email, candidates);
  const best = scored[0];
  const second = scored[1];
  // 语义强匹配 + 明显领先第二名 → 高置信；否则中置信交人工
  if (best && best.score >= 0.55 && (!second || best.score - second.score >= 0.08)) {
    return { confidence: 'high', matchedApp: best.app, candidates: [] };
  }

  // 中置信：公司命中但岗位存疑，候选按相似度排序 + 建议（best）
  return { confidence: 'medium', matchedApp: best ? best.app : null, candidates: scored.map((s) => s.app) };
}

module.exports = { syncEmails, normalizeCompany, normalizeTitle, resolveMatch, isJobCandidate, llmClassify, imapPreset };
