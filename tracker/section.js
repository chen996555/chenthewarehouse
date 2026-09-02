'use strict';

/**
 * 招聘类型推断（校招 campus / 实习 intern / 社招 social）
 *
 * 业界方案：招聘类型是「结构化枚举字段」（ZIZAI recruitType 1社招/2校招/3实习、美团 jobType 1校招/2实习/3社招、
 * 小米 ATSX recruitment_id_list 201正式/202实习）。但不同 ATS 字段不齐，且「人才专项」类混合类型需二次判断。
 *
 * 所以这里是「结构化字段优先 + 多信号关键词兜底」的通用推断：
 *   1. 适配器已算好的 section（来自 recruitType/hireMode/recruit_type.name 等结构化字段）
 *   2. 多信号关键词兜底（title + type + program 含实习/社招/校招关键词）
 *
 * 关键词词典比单靠「实习」更全：覆盖「暑期」「夏令营」「日常实习」「管培」「校招」「社招」「资深」等。
 */

// 实习信号（比单「实习」更全，防漏判「暑期生/夏令营/日常实习」）
const INTERN_RE = /实习|暑期|夏令营|日常实习|留用实习|Intern|internship/i;
// 社招信号
const SOCIAL_RE = /社招|社会招聘|资深|高级专家|Principal|Senior/i;
// 校招信号
const CAMPUS_RE = /校招|校园招聘|应届|管培|新生|秋招|春招|Campus|202\d届/i;

/**
 * 推断招聘类型
 * @param {string} adapterSection 适配器已算好的 section（来自结构化字段，优先）
 * @param {object} fields { title, type, program, hireMode }
 * @returns {'campus'|'intern'|'social'}
 */
function inferSection(adapterSection, fields = {}) {
  const { title = '', type = '', program = '', hireMode } = fields;

  // 1. 结构化字段优先（adapter 已算好，或 hireMode 明确）
  if (adapterSection === 'social' || adapterSection === 'intern') return adapterSection;
  if (hireMode === 2) return 'intern';

  // 2. 多信号关键词兜底（title + type + program 综合判断）
  const text = `${title} ${type} ${program}`;
  if (INTERN_RE.test(text)) return 'intern';
  if (SOCIAL_RE.test(text)) return 'social';
  if (CAMPUS_RE.test(text)) return 'campus';

  // 3. 默认
  return adapterSection || 'campus';
}

module.exports = { inferSection, INTERN_RE, SOCIAL_RE, CAMPUS_RE };
