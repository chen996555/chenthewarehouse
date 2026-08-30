'use strict';

/**
 * 求职星计划 — 语义召回（embedding 向量相似度）
 *
 * 用途：关键词搜索「无命中」的公司兜底——用 embedding 语义召回「语义相关但关键词不匹配」的岗位，
 *      防止漏掉「title 不含『采购』但 JD 是『供应链运营』」这类岗（如携程「业务运营」）。
 *
 * 复用硅基流动 API（与 reranker 同一家），model 默认 BAAI/bge-m3（多语言）。
 */

const fs = require('node:fs');
const path = require('node:path');

const CONFIG_PATH = path.join(__dirname, 'data', 'scorer-config.json');

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { return {}; }
}

// 单批 embedding
async function embed(texts) {
  const cfg = loadConfig();
  const apiKey = (cfg.reranker && cfg.reranker.apiKey) || process.env.SILICONFLOW_API_KEY || '';
  if (!apiKey) throw new Error('未配置硅基流动 API key（SILICONFLOW_API_KEY 或 reranker.apiKey）');
  const baseUrl = (cfg.reranker && cfg.reranker.baseUrl) || 'https://api.siliconflow.cn';
  const model = (cfg.embedding && cfg.embedding.model) || 'BAAI/bge-m3';

  const res = await fetch(`${baseUrl}/v1/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, input: texts }),
  });
  if (!res.ok) throw new Error(`embedding API HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  return (j.data || []).map((d) => d.embedding);
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

// 岗位 → 文本（复用 reranker 的 doc 格式）
function buildDoc(job) {
  return [job.title || '', job.jd || ''].join(' ').replace(/\s+/g, ' ').slice(0, 1000);
}

/**
 * 语义召回：query（画像方向）vs 岗位列表，返回按相似度降序的 Top-K
 * @param {string} query 画像方向文本
 * @param {Array} jobs 岗位列表（全量抓取的结果）
 * @param {number} topK 召回数量
 * @param {number} minScore 相似度下限（低于此值视为无关，过滤）
 */
async function semanticRecall(query, jobs, { topK = 30, minScore = 0.4 } = {}) {
  if (!jobs.length || !query.trim()) return [];
  const docs = jobs.map(buildDoc);
  let vecs;
  try {
    vecs = await embed([query, ...docs]);
  } catch (e) {
    throw new Error(`语义召回 embedding 失败：${e.message}`);
  }
  const qvec = vecs[0];
  const dvecs = vecs.slice(1);
  const scored = dvecs
    .map((vec, i) => ({ job: jobs[i], score: cosine(qvec, vec) }))
    .filter((x) => x.score >= minScore)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

module.exports = { semanticRecall, embed, buildDoc, cosine };
