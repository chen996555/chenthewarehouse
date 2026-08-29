'use strict';

/**
 * 求职星计划 — 语义重排器（bge-reranker-v2-m3 交叉编码器）
 *
 * 三档可插拔（scorer-config.json 的 reranker.mode 切换）：
 *   'api'   云端硅基流动 BAAI/bge-reranker-v2-m3（默认，分享版零安装，极便宜）
 *   'local' 本地模型（免费毫秒级，需本机装 Python + FlagEmbedding）
 *   'flash' 降级回退（用快模型粗打分，无额外依赖）
 *
 * 用途：替代 flash 粗排——语义级精排 100 个候选 → 只留 top N 给 LLM 逐条核对。
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const CONFIG_PATH = path.join(__dirname, 'data', 'scorer-config.json');

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return {};
  }
}

// 简历画像 + 岗位 → 重排查询文本（简历侧固定前缀）
function buildQuery(profile) {
  const bg = profile.background || {};
  const js = profile.job_search || {};
  const portrait = js.search_portrait;
  const roles = (portrait && Array.isArray(portrait.keywords) && portrait.keywords.join(' ')) || (js.target_roles || []).join(' ');
  return [bg.experience_summary || '', roles].filter(Boolean).join(' ').slice(0, 1500);
}

// 岗位 → 文档文本
function buildDoc(job) {
  return [job.title || '', job.jd || ''].join(' ').replace(/\s+/g, ' ').slice(0, 1000);
}

// ---- 档位 1：云端 API（硅基流动） --------------------------------------------

async function rerankApi(jobs, query, cfg) {
  const apiKey = (cfg.reranker && cfg.reranker.apiKey) || process.env.SILICONFLOW_API_KEY || '';
  if (!apiKey) throw new Error('未配置硅基流动 API key（reranker.apiKey 或环境变量 SILICONFLOW_API_KEY）');
  const baseUrl = (cfg.reranker && cfg.reranker.baseUrl) || 'https://api.siliconflow.cn';
  const model = (cfg.reranker && cfg.reranker.model) || 'BAAI/bge-reranker-v2-m3';

  const docs = jobs.map(buildDoc);
  const res = await fetch(`${baseUrl}/v1/rerank`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, query, documents: docs, return_documents: false }),
  });
  if (!res.ok) throw new Error(`重排 API HTTP ${res.status}: ${await res.text().then((t) => t.slice(0, 200))}`);
  const j = await res.json();
  const list = (j && j.results) || [];
  return list.map((r) => ({ index: Number(r.index), score: Number(r.relevance_score) || 0 }));
}

// ---- 档位 2：本地模型（Python + FlagEmbedding 子进程，stdin 传数据） ------------

async function rerankLocal(jobs, query) {
  const { spawn } = require('node:child_process');
  const script = path.join(__dirname, 'rerank_local.py');
  const payload = JSON.stringify({ query, docs: jobs.map(buildDoc) });

  return new Promise((resolve, reject) => {
    const child = spawn(process.env.PYTHON || 'python', [script], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`本地重排失败(${code}): ${stderr.slice(0, 300)}`));
      try {
        const scores = JSON.parse(stdout);
        resolve(scores.map((s, index) => ({ index, score: Number(s) || 0 })));
      } catch (e) {
        reject(new Error(`本地重排输出解析失败: ${stdout.slice(0, 200)}`));
      }
    });
    child.stdin.write(payload);
    child.stdin.end();
  });
}

// ---- 统一入口 ---------------------------------------------------------------

// 返回按相关性降序的 { job, score } 列表
async function rerank(jobs, profile) {
  const cfg = loadConfig();
  const mode = (cfg.reranker && cfg.reranker.mode) || 'api';
  const query = buildQuery(profile);

  let scored;
  if (mode === 'local') {
    scored = await rerankLocal(jobs, query);
  } else if (mode === 'flash') {
    // flash 降级由调用方处理（此档位返回 null 表示未重排）
    return null;
  } else {
    scored = await rerankApi(jobs, query, cfg);
  }

  return scored
    .filter((s) => s.index >= 0 && s.index < jobs.length)
    .map((s) => ({ job: jobs[s.index], score: s.score }))
    .sort((a, b) => b.score - a.score);
}

module.exports = { rerank, buildQuery, buildDoc };
