'use strict';

/**
 * 求职星计划 — 投递看板数据层
 * SQLite（node:sqlite 内置模块）+ status/history 两表状态机模型。
 * 状态机范式借鉴 BossHunter（tracker/status.py + db.py），按「投递到官网」场景精简。
 */

const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DB_PATH = path.join(__dirname, 'data', 'tracker.db');

// ---- 状态机定义 -------------------------------------------------------------

const STATUSES = {
  pending:   { label: '待投',   color: '#64748b' },
  applied:   { label: '已投',   color: '#3b82f6' },
  replied:   { label: '有回复', color: '#eab308' },
  interview: { label: '面试',   color: '#8b5cf6' },
  offer:     { label: 'Offer',  color: '#22c55e' },
  rejected:  { label: '拒信',   color: '#ef4444' },
};

const STATUS_ORDER = ['pending', 'applied', 'replied', 'interview', 'offer', 'rejected'];

// 每个状态的「推荐下一步」（供前端展示推进按钮；拖拽/下拉仍可任意设置）
const TRANSITIONS = {
  pending:   ['applied'],
  applied:   ['replied', 'rejected'],
  replied:   ['interview', 'rejected'],
  interview: ['offer', 'rejected'],
  offer:     [],
  rejected:  [],
};

const CHANNELS = ['官网', 'Boss直聘', '猎聘', '智联', '前程无忧', '内推', '邮件', '其他'];

// ---- 数据库 ---------------------------------------------------------------

function getDb() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  initTables(db);
  return db;
}

function initTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS applications (
      id             TEXT PRIMARY KEY,
      company        TEXT NOT NULL,
      title          TEXT NOT NULL,
      channel        TEXT NOT NULL DEFAULT '官网',
      url            TEXT,
      city           TEXT,
      salary         TEXT,
      status         TEXT NOT NULL DEFAULT 'pending',
      notes          TEXT,
      follow_up_date TEXT,
      created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS history (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      application_id TEXT NOT NULL,
      action         TEXT NOT NULL,
      detail         TEXT,
      created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      token         TEXT NOT NULL DEFAULT '',
      profile       TEXT NOT NULL DEFAULT '{}',
      created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_app_status ON applications(status);
    CREATE INDEX IF NOT EXISTS idx_history_app ON history(application_id);
  `);
  _migrateColumns(db);
  _migrateUserColumns(db);
}

// users 表追加列（幂等）：token_expires_at token 过期时间
function _migrateUserColumns(db) {
  const cols = new Set(db.prepare('PRAGMA table_info(users)').all().map((r) => r.name));
  if (!cols.has('token_expires_at')) db.exec("ALTER TABLE users ADD COLUMN token_expires_at TEXT DEFAULT ''");
}

// 追加列（ALTER TABLE，幂等）——阶段 2 起为「找岗位导入」所需字段
function _migrateColumns(db) {
  const cols = new Set(
    db.prepare('PRAGMA table_info(applications)').all().map((r) => r.name)
  );
  const additions = {
    source: "TEXT DEFAULT ''",
    degree: "TEXT DEFAULT ''",
    industry: "TEXT DEFAULT ''",
    jd: "TEXT DEFAULT ''",
    job_id: "TEXT DEFAULT ''",
    profile_key: "TEXT DEFAULT ''",
    score: "INTEGER DEFAULT 0",
    tier: "TEXT DEFAULT ''",
    gate: "TEXT DEFAULT ''",
    judge_reason: "TEXT DEFAULT ''",
    gate_reasons: "TEXT DEFAULT ''",
    raw_status: "TEXT DEFAULT ''",
    status_synced_at: "TEXT DEFAULT ''",
    section: "TEXT DEFAULT 'campus'",
    applied_at: "TEXT DEFAULT ''",
    user_id: "TEXT DEFAULT ''",
  };
  for (const [name, def] of Object.entries(additions)) {
    if (!cols.has(name)) {
      db.exec(`ALTER TABLE applications ADD COLUMN ${name} ${def}`);
    }
  }
}

// ---- 工具 -------------------------------------------------------------------

function newId() {
  return crypto.randomUUID();
}

function nowLocal() {
  // SQLite datetime('now','localtime') 生成；此处保留字符串即可
  return new Date().toISOString();
}

function sanitizeApplication(input) {
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const company = str(input.company);
  const title = str(input.title);
  if (!company || !title) {
    throw new Error('公司和岗位不能为空');
  }
  let status = str(input.status) || 'pending';
  if (!STATUSES[status]) status = 'pending';
  return {
    company,
    title,
    channel: str(input.channel) || '官网',
    url: str(input.url),
    city: str(input.city),
    salary: str(input.salary),
    status,
    notes: str(input.notes),
    follow_up_date: str(input.follow_up_date) || null,
    source: str(input.source),
    degree: str(input.degree),
    industry: str(input.industry),
    jd: str(input.jd),
    job_id: str(input.job_id),
    profile_key: str(input.profile_key),
    score: Number(input.score) || 0,
    tier: str(input.tier),
    gate: str(input.gate),
    judge_reason: str(input.judge_reason),
    gate_reasons: str(input.gate_reasons),
    raw_status: str(input.raw_status),
    status_synced_at: str(input.status_synced_at),
    section: str(input.section) || 'campus',
    applied_at: str(input.applied_at),
    user_id: str(input.user_id),
  };
}

// ---- 数据访问 ---------------------------------------------------------------

function listApplications(db, userId) {
  const rows = userId
    ? db.prepare('SELECT * FROM applications WHERE user_id = ? ORDER BY updated_at DESC, created_at DESC').all(String(userId))
    : db.prepare('SELECT * FROM applications ORDER BY updated_at DESC, created_at DESC').all();
  return rows.map(normalizeRow);
}

function getApplication(db, id) {
  const row = db.prepare('SELECT * FROM applications WHERE id = ?').get(id);
  return row ? normalizeRow(row) : null;
}

function createApplication(db, input) {
  const data = sanitizeApplication(input);
  const id = newId();
  db.prepare(`
    INSERT INTO applications
      (id, company, title, channel, url, city, salary, status, notes, follow_up_date, source, degree, industry, jd, job_id, profile_key, score, tier, gate, judge_reason, gate_reasons, raw_status, status_synced_at, section, applied_at, user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, data.company, data.title, data.channel, data.url, data.city, data.salary, data.status, data.notes, data.follow_up_date, data.source, data.degree, data.industry, data.jd, data.job_id, data.profile_key, data.score, data.tier, data.gate, data.judge_reason, data.gate_reasons, data.raw_status, data.status_synced_at, data.section, data.applied_at, data.user_id);

  // 记录创建动作
  db.prepare('INSERT INTO history (application_id, action, detail) VALUES (?, ?, ?)')
    .run(id, 'created', `创建投递记录：${data.company}｜${data.title}`);

  return getApplication(db, id);
}

// 导入岗位：去重键 = company + job_id（ID 稳定，标题会变）；job_id 缺失时回退 company + title
function importApplication(db, input) {
  const data = sanitizeApplication(input);
  const existing = data.job_id
    ? db.prepare('SELECT id FROM applications WHERE company = ? AND job_id = ? AND user_id = ? LIMIT 1').get(data.company, data.job_id, data.user_id)
    : db.prepare('SELECT id FROM applications WHERE company = ? AND title = ? AND user_id = ? LIMIT 1').get(data.company, data.title, data.user_id);
  if (existing) {
    // 已存在：补回 job_id/url（旧数据缺锚点），保留投递状态
    updateApplication(db, existing.id, { job_id: data.job_id, url: data.url });
    return { created: false, application: getApplication(db, existing.id) };
  }
  return { created: true, application: createApplication(db, data) };
}

// 增量同步（搜索层 ↔ 数据层联动）：以 job_id 为锚点做 upsert + 字段变化检测。
// 与 importApplication 的区别：字段（title/jd/url/打分）变了就更新，而不是只补 job_id/url。
// 只对比/更新 input 显式提供的字段，避免「未传字段」被空值覆盖已有数据。
function syncApplication(db, input) {
  const data = sanitizeApplication(input);
  const existing = data.job_id
    ? db.prepare('SELECT id, title, jd, url, score, tier, gate, judge_reason, gate_reasons FROM applications WHERE company = ? AND job_id = ? AND user_id = ? LIMIT 1').get(data.company, data.job_id, data.user_id)
    : db.prepare('SELECT id, title, jd, url, score, tier, gate, judge_reason, gate_reasons FROM applications WHERE company = ? AND title = ? AND user_id = ? LIMIT 1').get(data.company, data.title, data.user_id);
  if (!existing) return { sync: 'created', application: createApplication(db, data) };

  const provided = new Set(Object.keys(input || {}));
  const syncableFields = ['title', 'jd', 'url', 'score', 'tier', 'gate', 'judge_reason', 'gate_reasons', 'job_id'];
  const patch = {};
  for (const k of syncableFields) {
    if (!provided.has(k)) continue;
    if (String(existing[k] ?? '') !== String(data[k] ?? '')) patch[k] = data[k];
  }
  if (!Object.keys(patch).length) return { sync: 'unchanged', application: getApplication(db, existing.id) };

  updateApplication(db, existing.id, patch);
  return { sync: 'updated', application: getApplication(db, existing.id) };
}

function updateApplication(db, id, input) {
  const existing = getApplication(db, id);
  if (!existing) return null;

  const data = sanitizeApplication({ ...existing, ...input });
  // 状态变为「已投」时自动记录投递时间（未手动指定 applied_at 时）
  if (data.status === 'applied' && existing.status !== 'applied' && !data.applied_at) {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    data.applied_at = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }
  db.prepare(`
    UPDATE applications SET
      company = ?, title = ?, channel = ?, url = ?, city = ?, salary = ?,
      status = ?, notes = ?, follow_up_date = ?,
      source = ?, degree = ?, industry = ?, jd = ?, job_id = ?, profile_key = ?,
      score = ?, tier = ?, gate = ?, judge_reason = ?, gate_reasons = ?,
      raw_status = ?, status_synced_at = ?, section = ?, applied_at = ?,
      updated_at = datetime('now','localtime')
    WHERE id = ?
  `).run(data.company, data.title, data.channel, data.url, data.city, data.salary, data.status, data.notes, data.follow_up_date, data.source, data.degree, data.industry, data.jd, data.job_id, data.profile_key, data.score, data.tier, data.gate, data.judge_reason, data.gate_reasons, data.raw_status, data.status_synced_at, data.section, data.applied_at, id);

  // 状态发生变化时写入审计日志
  if (data.status !== existing.status) {
    const detail = `${STATUSES[existing.status].label} → ${STATUSES[data.status].label}`;
    db.prepare('INSERT INTO history (application_id, action, detail) VALUES (?, ?, ?)')
      .run(id, data.status, detail);
  }

  return getApplication(db, id);
}

// 状态机推进：推进到「推荐下一步」（TRANSITIONS 首项），或指定 nextStatus
function advanceStatus(db, id, nextStatus) {
  const app = getApplication(db, id);
  if (!app) return null;
  const target = nextStatus || ((TRANSITIONS[app.status] || [])[0]) || app.status;
  if (target === app.status) return app;
  return updateApplication(db, id, { status: target });
}

function deleteApplication(db, id) {
  const existing = getApplication(db, id);
  if (!existing) return false;
  db.prepare('DELETE FROM applications WHERE id = ?').run(id);
  return true;
}

function getHistory(db, id) {
  return db.prepare(
    'SELECT * FROM history WHERE application_id = ? ORDER BY id DESC'
  ).all(id).map(normalizeRow);
}

function getActivity(db, limit = 20) {
  const rows = db.prepare(`
    SELECT h.id, h.application_id, h.action, h.detail, h.created_at,
           a.company, a.title, a.status
    FROM history h
    LEFT JOIN applications a ON a.id = h.application_id
    ORDER BY h.id DESC
    LIMIT ?
  `).all(limit);
  return rows.map(normalizeRow);
}

function getStats(db, userId) {
  const rows = userId
    ? db.prepare('SELECT status, COUNT(*) AS cnt FROM applications WHERE user_id = ? GROUP BY status').all(String(userId))
    : db.prepare('SELECT status, COUNT(*) AS cnt FROM applications GROUP BY status').all();
  const counts = {};
  for (const s of STATUS_ORDER) counts[s] = 0;
  for (const row of rows) counts[row.status] = row.cnt;

  const total = STATUS_ORDER.reduce((sum, s) => sum + counts[s], 0);
  const applied = counts.applied + counts.replied + counts.interview + counts.offer + counts.rejected;
  const replied = counts.replied + counts.interview + counts.offer;
  return {
    total,
    counts,
    applied,
    replyRate: applied > 0 ? Math.round((replied / applied) * 100) : 0,
  };
}

// node:sqlite 返回 null-prototype 对象，转成普通对象方便前端序列化
function normalizeRow(row) {
  return row ? { ...row } : row;
}

// ---- 用户（多用户鉴权）--------------------------------------------------------

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(pw, stored) {
  const s = String(stored || '');
  if (s.includes(':')) {
    const [salt, hash] = s.split(':');
    return crypto.scryptSync(String(pw), salt, 64).toString('hex') === hash;
  }
  // 兼容旧 sha256 无盐
  return crypto.createHash('sha256').update(String(pw)).digest('hex') === s;
}

function newToken() {
  return crypto.randomBytes(24).toString('hex');
}
function tokenExpiresAt() {
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 天过期
}

function createUser(db, { username, password }) {
  const uname = String(username || '').trim();
  const pw = String(password || '');
  if (!uname || !pw) throw new Error('用户名和密码不能为空');
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(uname)) throw new Error('用户名已存在');
  const token = newToken();
  db.prepare('INSERT INTO users (username, password_hash, token, token_expires_at) VALUES (?, ?, ?, ?)').run(uname, hashPassword(pw), token, tokenExpiresAt());
  const row = db.prepare('SELECT id FROM users WHERE username = ?').get(uname);
  return { id: row.id, username: uname, token };
}

function loginUser(db, { username, password }) {
  const uname = String(username || '').trim();
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(uname);
  if (!row || !verifyPassword(String(password || ''), row.password_hash)) throw new Error('用户名或密码错误');
  const token = newToken();
  db.prepare('UPDATE users SET token = ?, token_expires_at = ? WHERE id = ?').run(token, tokenExpiresAt(), row.id);
  return { id: row.id, username: uname, token };
}

function getUserByToken(db, token) {
  if (!token) return null;
  const row = db.prepare('SELECT * FROM users WHERE token = ?').get(token);
  if (!row) return null;
  if (row.token_expires_at && row.token_expires_at < new Date().toISOString()) return null; // token 过期
  return normalizeRow(row);
}

function updateUserProfile(db, userId, profile) {
  db.prepare('UPDATE users SET profile = ? WHERE id = ?').run(JSON.stringify(profile), userId);
  return true;
}

function getUserProfile(db, userId) {
  const row = db.prepare('SELECT profile FROM users WHERE id = ?').get(userId);
  if (!row) return null;
  try { return JSON.parse(row.profile); } catch { return null; }
}

// 按 job_id（+ 可选公司）定位投递记录（「去投递锚定」用）
function findByJobId(db, jobId, company, userId) {
  const jid = String(jobId || '').trim();
  if (!jid) return null;
  const row = company
    ? db.prepare('SELECT * FROM applications WHERE job_id = ? AND company = ? AND user_id = ? LIMIT 1').get(jid, String(company).trim(), String(userId || ''))
    : db.prepare('SELECT * FROM applications WHERE job_id = ? AND user_id = ? LIMIT 1').get(jid, String(userId || ''));
  return row ? normalizeRow(row) : null;
}

module.exports = {
  getDb,
  STATUSES,
  STATUS_ORDER,
  TRANSITIONS,
  CHANNELS,
  listApplications,
  getApplication,
  createApplication,
  importApplication,
  syncApplication,
  updateApplication,
  advanceStatus,
  deleteApplication,
  getHistory,
  getActivity,
  getStats,
  createUser,
  loginUser,
  getUserByToken,
  updateUserProfile,
  getUserProfile,
  findByJobId,
  hashPassword,
};
