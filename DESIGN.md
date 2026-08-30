# 求职星计划（Job Star）— 顶层设计文档

> 本文档是项目的「记录 + 引导」层：记录架构、决策 why、开发历程、踩坑、优化、特别之处。
> 每次重要改动后追加到「更新日志」和对应章节。配合 `CLAUDE.md`（约束层，每次会话加载）使用。

## 更新日志

| 日期 | 改动 |
|---|---|
| 2026-08-28 | 16 类适配器全部支持关键词搜索；稳定性机制五层；缓存画像隔离；画像污染修复；三份简历验证通用性 |
| 2026-08-28 | 半自动投递闭环跑通：apply.js + 简历库 + 上传简历/点解析/补漏 + 自定义下拉精确选；修 byte detailUrl bug |
| 2026-08-28 | 字节投递打通（URL id 格式、新 tab 投递、解析 span 定位、data 属性字段名）；确立通用引擎方案（非逐家适配）|
| 2026-08-29 | 统一数据层落地：job_id 唯一身份 + reach 配置（direct/navigate）+ 源头校验；携程 MJ 编号修复；数据层脏数据清零（43 核心岗 job_id/url 全干净）|
| 2026-08-29 | 数据层打通：打分结构化（score/tier/gate/judge_reason 独立字段）+ 增量同步 syncApplication（job_id 锚点 upsert + 字段变化检测，只更新显式字段）|
| 2026-08-29 | 验证机制：可达性抽样 reachability.js（抓 4 个 URL 问题）+ 命中信号 + 两遍定版流程；8 项待办落地（byte补漏/候选人维度/健康基线owner/投递候选链/navigateToJob/advanceStatus/staleness.js/feedback.js）；探测修复京东/荣耀/科大讯飞/阿里 4 家 URL；删 28 噪音岗，核心岗 43 全绿 |
| 2026-08-29 | 事故修复：定位「画像关键词 search_portrait 丢失 → 分层搜索静默退化全量抓」根因，重跑 portrait.js 恢复；确立「分层搜索不得静默降级」决策（待代码落地） |
| 2026-08-29 | 失败显式化落地：loadSearchKeywords 空则阻断 + scrapeOne 区分失败/无命中 + searchMode 标记 + keywordHash 基线（画像关键词变了重置） |
| 2026-08-29 | 画像关键词去复合词（方向词，禁用「方向+职位」复合词，防搜索接口拆词稀释） |
| 2026-08-29 | 调研 job-pro（50 家接口开源）+ 参考重构：moka 纯 HTTP 化（v2+keyword+AES，IV 从 init-data 读）、byte 纯 HTTP 化（飞书 ATSX 直连，3 header）；确立家族工厂战略 |
| 2026-08-29 | 扩展 25→129 家：SaaS 家族（Moka/飞书/北森）+ 自研逆向（顺丰/理想/百度/OPPO/比亚迪/平安/华为/vivo/地平线）+ workflow 并行搜索识别 ATS（141 家→41 落地）+ 自研逆向 workflow（60 家→7 落地）；浏览器型全部纯 HTTP 化（ant/bili/hotjob 误判纠正） |
| 2026-08-29 | section 一等公民（校招/实习/社招）：适配器一次抓全量 + 岗位字段判断 section + apply_scopes 导入过滤 + 数据层 section 字段 |
| 2026-08-29 | 语义召回兜底：embedding.js（硅基流动 bge-m3 余弦相似度）+ scan 无命中兜底；expand.js 扩展流水线 + 定时健康检测 |
| 2026-08-29 | 投递状态自动记录（方法验证 + 京东跑通）：完整链路「拦截/HAR → 逆向前端 JS 加密 → 解密 → 状态映射 → 入库」。京东 status_jd.js（delivery/officialInfo/list AES-256-CBC 解密，key=63ca0d3f... + IV 全零，applyStatus=ACTIVE_APPLY/NOT_CONSIDER + nodeList 8 环节）；har_capture.js 自动捕获 HAR（接口+JS 含 key 一条龙）；腾讯 status_tx.js（getApplyProcess 明文）+ 平安 deliveryRecord 已找到。教训：投递状态/加密接口逆向优先用 HAR，别 puppeteer 拦截 + 单独下载 JS |

---

## 一、项目定位

个人求职自动化系统。核心链路：**简历画像 → 关键词搜索 → 精排打分 → 导入看板「待投」**。

目标：几分钟内扫完全部目标公司官网，精准推荐「该投的岗位」，替代人工逐家翻官网。零依赖（`node:http` + `node:sqlite`），本地运行。

---

## 二、系统架构（四层流水线）

```
profile.json（简历画像）
   └─ portrait.js  → search_portrait.keywords（画像关键词）
        │
        ▼
scan.js（搜索层：分层搜索）
   └─ 支持关键词的适配器：画像关键词逐个搜 → 合并去重
   └─ 不支持搜索的适配器：全量抓 + reranker 筛
        │
        ▼
scorer.js（精排层）
   └─ 硬过滤(代码) → reranker 语义重排 → deepseek-chat 判定 → 分档 A/B/C/D
        │
        ▼
db.js（看板层）
   └─ A+B 档自动导入「待投」
```

### 各层职责

| 层 | 文件 | 职责 | 成本 |
|---|---|---|---|
| 画像 | `portrait.js` | LLM 从简历生成搜索关键词 + 方向 | chat，一次性 |
| 搜索 | `scan.js` + 16 类适配器 | 按画像关键词精准抓官网岗位 | 0（接口）+ 浏览器时间 |
| 精排 | `scorer.js` + `reranker.js` | 硬过滤 + 语义重排 + 判定 + 分档 | chat（判定）+ bge（重排）|
| 看板 | `db.js` + `server.js` | 待投→已投→面试→Offer 状态机 | 0 |

---

## 三、关键设计决策（含 why，防止走回头路）

### 1. 分层搜索，而非全量抓
**决策**：对支持关键词的适配器，用画像关键词精准抓；不支持的全量抓 + reranker 筛。
**why**：大厂的「全量」是假全量——zhiye 只抓首页 20 个（实际 112 个）、moka/bili 有 100 上限、大厂一年岗位远不止一千多个。全量抓的是「最新发布」而非「相关岗位」，大量噪音。关键词搜索又准又省成本。

### 2. 非推理模型（deepseek-chat）做判定，而非推理模型
**决策**：精排判定用 `deepseek-chat`（真非推理），不用 `deepseek-v4-pro`/`deepseek-v4-flash`。
**why**：`deepseek-v4-flash` 实为推理模型，会返回 `reasoning_content`，有时 `content` 为空 → 全 C 档、JSON 解析失败。判定是「低分辨率分类」（0-2 三档），不需要推理，非推理模型又快又便宜又稳。

### 3. 确定性活 / 认知活分层
**决策**：硬过滤（城市/学历/社招/排除词）、分档算术、reranker 排序 → 代码（0 token）；JD 匹配判定 → LLM。
**why**：确定性活用 LLM 是浪费且不可靠（幻觉）。LLM 只做它擅长的「理解 + 判定」，可复现的活交给代码。

### 4. 适配器四种抓取方式（按脆弱性从高到低）
| 方式 | 依赖 | 失效点 | 代表 |
|---|---|---|---|
| 纯 HTTP 接口 | URL + 字段名 | 字段改名 / 接口迁移 | 全部适配器 |
| ~~DOM 抓取~~（已废弃）| CSS class / DOM 结构 | 前端改版 | — |
| ~~页面上下文 fetch~~（已废弃）| 接口字段 + 页面 cookie | 认证升级 | — |
| ~~浏览器拦截响应~~（已废弃）| 接口 URL + 响应字段 | 响应字段改名 | — |

### 5.（已废弃）浏览器型适配器多关键词单会话
**现状**：全部适配器已纯 HTTP 化（2026-08-29），此节为历史记录。byte/hotjob/moka/bili/ant 都曾误判「需浏览器」，实测全是纯 HTTP。

### 6. 打分缓存按画像隔离
**决策**：缓存 key = `md5(profileKey | company | title)`，不同候选人判定结果不可复用。
**why**：判定依赖画像（同一岗位，采购画像和海外商务画像的打分完全不同）。不隔离会导致换人后命中错误缓存。

### 7. 稳定性机制五层
预防（字段候选链）→ 降级（bili 接口→DOM）→ 主动检测（smoke.js）→ 对比检测（health.js）→ 隔离（per-adapter catch）。详见第六章。

### 8. 分层搜索不得静默降级为全量抓
**决策**：关键词搜索空/失败时，不允许静默回退全量抓——画像关键词缺失则阻断（提示先跑 portrait.js），接口异常则报错；确需回退全量时显式标记 `searchMode: 'fallback'` 供健康基线对比。
**why**：2026-08-29 事故——profile.json 的 search_portrait 丢失，loadSearchKeywords() catch 静默返回空数组，scrapeOne 判 keywords.length 为假 → 静默回退全量抓，25 家公司「成功」但岗位数暴增到 100 上限，分层搜索完全退化却无人察觉。health.js 把「暴增」报「疑似官方岗位变化」，方向反了。教训：降级路径必须显式可观测，否则失效被「成功」掩盖。

---

## 四、开发历程（时间线 + 踩坑）

### 阶段 1：基础框架（四层 + 看板 + 适配器基础）
- 四层架构、零依赖看板、首批适配器
- **坑**：API key 明文写在 config → 移到环境变量；得物公司重名；UI source 未区分

### 阶段 2：打分算法重构（推理 → 非推理）
- 从「推理模型连续打分」改成「结构化抽取 + 0-2 低分辨率判定」
- **坑**：`deepseek-v4-flash` 实为推理模型返回空 content → 换 `deepseek-chat`；缓存污染（旧嵌套格式被新 flat 代码读成 0 分）；批量截断（chunkSize 15→8→5→3 反复，根因是缓存污染）

### 阶段 3：搜索画像 + 分层搜索
- portrait.js 生成画像关键词；scan.js 分层搜索
- **坑**：字节关键词搜索签名 + 搜索触发机制难破

### 阶段 4：字节搜索修复（关键突破，已随纯 HTTP 化废弃）
- **坑**：IME 中文输入不进框（`page.keyboard.type` 失效）；React setter 设值成功但 Enter 不触发搜索
- **突破**：合成 `KeyboardEvent('keydown', {keyCode:13})` 触发 onPressEnter；发现 `_signature` 是确定性的（同 URL 同签名）
- **现状**：byte 已纯 HTTP 化（`portal-channel`+`website-path` header 直连，无需签名），以上浏览器拦截/签名方案已废弃

### 阶段 5：全部适配器关键词搜索（逐个逆向）
- 找到各 ATS 搜索字段：阿里 `key`、快手 `name`、小红书 `positionName`、米哈游 `jobName`、携程 `condition.keyword`、bili `positionName`、moka hash `keyword`、ant `key`、zhiye `KeyWords`、荣耀 `postName`
- **坑**：美团 `jobTypeList`→`jobType`（body 结构错导致 keywords 静默失效）；bili 认证 `ajSessionId`→ 复用 `x-csrf`；荣耀 suiteId 迁移（旧的是社招）；得物 `portal_type=6`（字节是 3）；新浪/搜狐 moka section 被默认 campus 覆盖

### 阶段 6：稳定性机制（应对官方改版）
- 健康基线（health.js）、冒烟自检（smoke.js）、total 字段候选链、bili 接口→DOM 降级

### 阶段 7：提效提质降本
- **提效**：浏览器型全部纯 HTTP 化（原「多关键词单会话」已随纯 HTTP 化废弃）
- **提质**：恢复硬门槛复核（LLM 抽 hard_reqs + gateCheck 代码比对，之前退化成「JD 缺失就 maybe」的死代码）
- **降本**：清理死配置，明确「判=chat、重排=bge」的成本地板

### 阶段 8：多简历验证通用性
- 换画像跑流程：候选人A（采购）→ 候选人B（海外商务）→ 候选人C（广告投放/数据运营）
- **坑**：缓存画像隔离 bug（换人命中旧缓存）；画像污染 bug（portrait.js prompt 硬编码「采购/供应链」示例诱导）

### 阶段 9：半自动投递（最少人工）
- 简历库 `files.resumes`（多简历按岗位方向匹配）；apply.js（headful 浏览器 + 登录态持久化）
- 流程：详情页 → 点投递 → 填手机号 → 人工验证码 → 上传简历 → 点解析 → 等解析完成 → AI 补漏 → 人工核对提交
- **坑**：byte.js detailUrl 双重 bug（jp.code→jp.id + 硬编码 /campus→campusPath，详情页 Not Found）；profile 缺 gender/出生日期/籍贯；字段映射过度保守（学历类型该填「全日制」却排除了）；自定义下拉（atsx Select，无 role/aria）填文本不生效 → 需 class 识别 + 点击展开选选项

### 阶段 10：字节投递打通 + 确立通用引擎方案
- 字节投递四条坑（通用引擎候选链依据）：① detail URL 用长数字 id（旧 code 格式打开数据空、投递无效）② 点投递=新开 tab `/resume/{id}/apply`（非当前页跳转）③ 「解析并覆盖」是 span（短文本叶子元素定位，非 button/外层容器）④ 字段 label 在 `data-form-field-i18n-name`
- **决策**：投递不做逐家适配，改通用引擎——简历解析优先（ATS 标准功能，字节解析填 95%）+ 通用字段识别候选链 + 通用下拉填充候选链 + 明确人工边界（机器做确定性字段，人做验证码/同意协议/主观问卷/提交）；每家只配 5-10 行，不写独立适配器

### 阶段 11：统一数据层（脏数据源头治理）
- **核心**：把「岗位是谁」（身份）和「怎么打开岗位」（可达性）解耦。脏数据根因 = 两者耦合在 detailUrl 一个字段里，且 16 个适配器各自手拼 URL。
- **落地四层**：① `applications.job_id` 字段（唯一身份，去重键 company+job_id，标题会变 ID 稳定）② `companies.js` 每家 `reach` 配置（direct=urlTemplate+ID 构造 / navigate=entryUrl 列表页导航）③ `scan.js` 统一生成 detailUrl + 源头校验（无 job_id 不进库）④ 适配器只提取 ID，不再手拼 URL
- **关键发现**：① 唯一 ID 判定标准 = 详情 URL 可达（携程用 MJ 编号而非接口 jobId uuid）② title 不是稳定锚点（美团/小米改标题致匹配失败）③ detailUrl 分两类：直达型（约 10 家，URL 含 ID）vs 导航型（美团/拼多多/米哈游/快手/B站，JS 路由无稳定 URL，投递需列表页导航）④ byte KEYWORD_COUNT=1 只搜「采购」漏「供应链」岗（搜索层问题，非数据层）
- **成果**：43 个采购/供应链核心岗 job_id 空 0、url 空 0、旧 code 0；删 5 个下架/噪音岗

### 阶段 12：验证机制（三类变化信号 + 两遍定版）

- **核心**：「验证变化」不是事后发现，而是每次运行记录信号 + 对比基线。三类信号：
  - **数量信号**（health.js 已有）：抓取岗位数骤降/归零 = 适配器失效
  - **可达性信号**（reachability.js 新增）：抽样打开 url 判断是否「详情页」，可达率骤降 = URL 模板失效
  - **命中信号**（apply.js 记录）：投递时记录「登录方式/解析按钮/字段名/下拉」命中哪个形态，形态变化 = 官网改版
- **可达性抽样首跑成果**：发现 4 个 URL 问题（京东 `#/jobs?positionId=` 是列表页、荣耀 `pb/detail.html?postId=` 404、科大讯飞 zhiye 列表页、阿里 positionUrl 空）
- **两遍定版流程（新增公司标准流程）**：第一遍「抓取建档」（配置 adapter/reach → 抓取 → 打分结构化 → 可达性抽样，记录基线：数量 N1/可达率 R1/job_id 集合 S1）；第二遍「稳定性验证」（再跑一次，对比基线，变化小 = 定版，变化大 = 排查）。目标：新增一家公司最多两遍就确定，不反复返工

### 阶段 13：画像关键词丢失事故（失败显式化）
- **现象**：欠费后重扫，25/25 公司「成功」，但岗位数暴增（腾讯 12→100、阿里 2→100、快手 2→100、得物 3→100…），健康告警一片「暴增」
- **根因**：`profile.json` 的 `job_search.search_portrait` 字段丢失（手动编辑 profile 覆盖时丢失），`loadSearchKeywords()` catch 静默返回空数组 → `scrapeOne` 判 `keywords.length` 假 → 静默回退全量抓（scan.js:117），分层搜索完全退化。精排硬过滤兜底，最终精准岗位数（93）与正常（88）接近，故「结果没崩」掩盖了「流程退化」
- **教训**：① 分层搜索→全量抓 是「降级」，降级不能静默，必须显式（阻断或标记 searchMode）② health 对比「岗位数」会把「关键词丢失」误报为「官方岗位变化」，信号方向反了 ③ 「暴增」「骤降」是同一失效的两种表象（丢→暴增、恢复→骤降），不能只看变化方向
- **修复**：重跑 portrait.js 恢复 search_portrait（18 关键词）；确立「分层搜索不得静默降级」决策（见第三章第 8 条），待代码落地：loadSearchKeywords 空则阻断 + searchMode 标记 + 画像完整性断言

---

## 五、优化记录

| 维度 | 优化 | 效果 |
|---|---|---|
| 提效 | 浏览器型全部纯 HTTP 化 | 扫描 4-6 分钟 → 秒级 |
| 提质 | 恢复硬门槛复核（hard_reqs 抽取 + gateCheck）| 硬伤岗显式否决，不再靠 reranker 兜底 |
| 提质 | 画像污染修复（严禁臆测）| 换画像后关键词不再混入无关方向 |
| 降本 | 清理死配置（pro/flash）| 明确成本地板：chat + bge reranker |
| 降本 | 模型分层（想=Pro / 判=chat / 写=flash）| 开发过程按任务难度选模型 |

---

## 六、稳定性机制（应对官方改版）

| 层 | 机制 | 文件 | 作用 |
|---|---|---|---|
| 预防 | total 字段候选链 | 各适配器 `total ?? totalCount ?? count` | 字段微调不立即失效 |
| 降级 | 接口→DOM 回退 | `zhiye.js`、`bili.js` | 接口/认证升级时降级抓 DOM |
| 主动检测 | 冒烟自检 | `smoke.js` | `node smoke.js` 抓 5 个验证存活，三态：✓存活/○空/✗失效 |
| 对比检测 | 健康基线 | `health.js` | 每次扫描对比上次，暴增/骤降/归零告警 |
| 隔离 | per-adapter catch | `scan.js` | 单家失效不阻断整体 |
| 搜索模式校验 | searchMode 标记 + 画像完整性断言 | `scan.js` + `health.js` | 关键词搜索失效/画像缺失时阻断或告警，不静默回退全量（待落地） |

**已知局限**：
1. 健康基线对比「上次扫描」没意识到画像换人，换人后岗位数变化会误报「疑似」。待改进：基线记画像 owner，换人时重置。
2. 健康基线只对比「岗位数」，不对比「搜索模式」。2026-08-29 事故：画像关键词丢失 → 静默回退全量抓 → 岗位数「暴增」被误报为「官方变化」，分层搜索退化无人察觉。待改进：scan 结果记录 searchMode，health 对比搜索模式而非只看数量。

---

## 七、特别之处

1. **画像驱动通用性**：换简历 → 换画像 → 换搜索结果 → 换精排，全程自动，不改代码。已用三份不同方向简历验证。
2. **家族工厂 + 自研逆向**：171 家公司，用「家族工厂」（北森 zhiye/Moka/飞书 ATSX/北森 Wecruit 复用配置，识别 URL 特征→加配置对象）+ 自研逐个逆向（腾讯/美团/字节/银行等）。详见 `FAMILIES.md`。
3. **稳定性工程**：不是「抓一次能用就行」，而是五层机制应对官方改版的静默失效。
4. **确定性/认知分层 + 模型分层**：把「确定性活、判定活、生成活」分开，用「代码、chat、pro/flash」分别应对，成本地板清晰。
5. **踩坑即资产**：每个坑（flash 空 content、美团字段改名、画像污染）都是真金白银换来的，记录在案防重蹈。

---

## 八、当前状态 + 下一步

**当前**：171 家公司已点亮（互联网/游戏/半导体/制造/金融/央企/医药），全部纯 HTTP 抓取。家族工厂 + 自研逆向；section 区分（校招/实习/社招）；语义召回兜底（embedding）；失败显式化（阻断/searchMode/keywordHash 基线）；workflow 扩展流水线 + 定时健康检测。

**下一步**（按优先级）：
1. 投递限制自动识别（岗位字段 applicantLimitCheck 提取，替代 limits.js 手工标注）
2. 投递记录 + 状态跟踪（待投→已投→有回复→面试→Offer 状态机 + 官网投递记录同步）
3. 排查 6 家参数（极氪/北方华创/京东方/海信/九阳/阳光保险）
4. 国央企/医药/能源 workflow 落地（已启动）
5. 反馈闭环（投递结果回校准打分器）
