'use strict';
// 轻量结构化日志（零依赖）：JSON 格式，含时间戳/级别/消息/字段
// 用法：const log = require('./logger'); log.info('推荐完成', { userId: 3, jobs: 100 });
// 上云后可被 Pino/winston 替换，或直接采集 JSON 日志进 ELK/Loki

function write(level, msg, fields) {
  const entry = { time: new Date().toISOString(), level, msg, ...(fields || {}) };
  const line = JSON.stringify(entry);
  if (level === 'error') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

module.exports = {
  info: (msg, fields) => write('info', msg, fields),
  warn: (msg, fields) => write('warn', msg, fields),
  error: (msg, fields) => write('error', msg, fields),
  // LLM 调用成本追踪（model + token 用量，成本按 deepseek 价目估算）
  llm: (msg, fields) => write('llm', msg, fields),
};
