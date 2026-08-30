'use strict';
/**
 * 各公司投递限制（投递前预警用）
 *
 * 数据来源：ADAPTERS.md 的「投递限制表」+ 逐家 HAR 逆向。
 * 每投一家前，先读这里的限制提示用户（如「只能投 1 次」）。
 */

const APPLY_LIMITS = {
  京东: {
    maxApplications: 1,
    note: '校招「应届生项目」只能投 1 次（1 个岗位），投后即使取消（NOT_CONSIDER）也不释放额度——想好投哪个再投',
  },
  大疆: {
    maxApplications: null,
    note: '限制待确认（applicant-limit-check 响应加密，project-delivery-limit-prompt 为空=无提示）',
  },
  腾讯: {
    maxApplications: null,
    note: '待逆向确认（状态接口 getApplyProcess 已找到，限制未确认）',
  },
};

// 查某公司的投递限制，无记录返回 null
function getApplyLimit(company) {
  return APPLY_LIMITS[company] || null;
}

// 生成投递前预警文案
function limitWarning(company) {
  const limit = getApplyLimit(company);
  if (!limit) return '';
  if (limit.maxApplications) return `⚠️ ${company}：${limit.note}`;
  return `⚠️ ${company}：${limit.note}`;
}

// ---- 投递限制自动识别（从接口字段推导，替代手工 APPLY_LIMITS）----------------

// 从岗位数据（mapJob 已带 canDelivery）+ 详情数据（fetchDetail 带 limitApplyNumByOrg 等）推导限制
// 返回 { note, limited } 或 null（无限制/无信号）
function deriveApplyLimit(job, detail) {
  const hints = [];
  const d = detail || {};
  // canDelivery 优先用详情接口（准确）；搜索接口的 canDelivery 在未登录/未开放投递时可能全 false，不可靠
  const canDeliver = d.canDelivery !== undefined ? d.canDelivery : (job && job.canDelivery);
  if (canDeliver === false) hints.push('当前不可投（未开放/已满/截止）');
  // 公司/组织级：是否有投递次数限制（详情接口字段，明文）
  if (d.limitApplyNumByOrg === true) hints.push('该组织限制投递次数');
  if (d.wishNumSplitByProject === true) hints.push('志愿数按项目拆分（各项目独立额度）');
  if (d.isHaveVolunteer === 0) hints.push('无志愿额度');
  if (!hints.length) return null;
  return { note: hints.join('；'), limited: hints.length > 0 };
}

// 综合：优先自动推导，回退手工表
function resolveApplyLimit(company, job, detail) {
  const derived = deriveApplyLimit(job, detail);
  if (derived) return { ...derived, source: 'auto' };
  const manual = getApplyLimit(company);
  return manual ? { note: manual.note, limited: !!manual.maxApplications, source: 'manual' } : null;
}

module.exports = { APPLY_LIMITS, getApplyLimit, limitWarning, deriveApplyLimit, resolveApplyLimit };
