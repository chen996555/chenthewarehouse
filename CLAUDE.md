# 求职星计划（Job Star）

个人求职自动化系统：**简历画像 → 关键词搜索 → 精排打分 → 导入看板「待投」**。核心代码在 `tracker/`。

## 核心流程（四层）
1. **画像**：`tracker/data/profile.json` → `portrait.js` 生成搜索画像关键词（写入 `search_portrait`）
2. **搜索**：`scan.js` 分层搜索——16 类适配器，画像关键词精准抓（非全量抓）
3. **精排**：`scorer.js`——硬过滤 → reranker 语义重排 → `deepseek-chat` 判定 → 分档 A/B/C/D
4. **看板**：`db.js` 导入待投（A+B 档）

## 关键决策（不要重做，不要走回头路）
- **判定用非推理模型 `deepseek-chat`**（`deepseek-v4-flash` 实为推理模型，会返回空 content；`deepseek-v4-pro` 是死配置已清理）
- **分层搜索**：画像关键词精准抓，不是全量抓——大厂"全量"是假全量（zhiye 只抓首页、moka/bili 100 上限）
- **缓存 key 必须含画像标识**（`profileKey` 隔离，不同候选人判定结果不可复用）
- **画像生成严禁硬编码方向**（严禁臆测简历没有的方向，如采购/供应链）
- **浏览器型适配器一次会话循环多关键词**（不重复开浏览器）
- **稳定性机制**：健康基线（health.js）+ 冒烟自检（smoke.js）+ total 字段候选链 + bili 接口→DOM 降级
- **确定性活 / 认知活分层**：硬过滤/分档算术是代码（0 token），判定是 LLM；别用 LLM 做确定性活

## 关键文件
- `tracker/scan.js` 扫描调度 + 分层搜索（`scrapeCompany` 分发、`KEYWORD_ADAPTERS`）
- `tracker/scorer.js` 精排打分（判定 + 分档 + 缓存）
- `tracker/portrait.js` 画像生成
- `tracker/companies.js` 公司注册表
- `tracker/data/profile.json` 候选人画像（换人 = 换这份 + 重跑 portrait + scan）
- `tracker/health.js` / `smoke.js` 稳定性
- `ADAPTERS.md` 适配器对照表（16 类，接口/搜索字段/认证）
- `DESIGN.md` 顶层设计文档（架构/决策/踩坑/优化全记录）

## 当前状态
16 类适配器全部支持关键词搜索；稳定性机制齐（健康基线/冒烟自检/字段候选/降级）；缓存画像隔离；画像污染已修；三份简历验证通用性。**半自动投递闭环已跑通**：`apply.js`（headful 浏览器 + 上传简历 + 点解析 + 补漏，含自定义下拉读选项精确选），简历库 `files.resumes`（多简历按岗位方向匹配）。byte.js detailUrl bug 已修（用 jp.id + campusPath）。

## 下一步（待做）
- 投递状态记录：待投→已投→有回复→面试→Offer 状态机（确定性，非 LLM）
- 看板加「候选人」维度（当前换人后待投岗位混在一起）
- 健康基线识别画像切换（换人时重置基线）
- 反馈闭环（投递结果回校准打分器）
