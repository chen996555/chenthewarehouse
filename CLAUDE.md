# 求职星计划（Job Star）

个人求职自动化系统：**简历画像 → 搜索（关键词+语义召回）→ 精排打分 → 导入看板「待投」**。核心代码在 `tracker/`。

## 核心流程（四层）
1. **画像**：`tracker/data/profile.json` → `portrait.js` 生成搜索画像关键词（写入 `search_portrait`）
2. **搜索**：`scan.js` 分层搜索——家族工厂适配器（zhiye/moka/byte/wecruit 等），画像关键词精准抓 + 无命中时语义召回兜底
3. **精排**：`scorer.js`——硬过滤 → reranker 语义重排 → `deepseek-chat` 判定 → 分档 A/B/C/D
4. **看板**：`db.js` 导入待投（A+B 档，按 section 校招/实习/社招 + apply_scopes 过滤）

## 关键决策（不要重做，不要走回头路）
- **判定用非推理模型 `deepseek-chat`**（`deepseek-v4-flash` 实为推理模型返回空 content；`deepseek-v4-pro` 死配置已清理）
- **家族工厂战略**：招聘 SaaS 就那几家（北森 zhiye / Moka / 飞书 ATSX / 北森 Wecruit），识别 URL 特征 → 加配置对象（~30 行），非逐家逆向。大厂自研（腾讯/阿里/美团/银行）逐个逆向。详见 `FAMILIES.md`
- **浏览器型适配器全部纯 HTTP 化**：moka/byte/ant/bili/hotjob 都能纯 HTTP（job-pro 49 家纯 HTTP，唯一 puppeteer 依赖是莉莉丝 CDP 破签名）。`BROWSER_KEYWORD_ADAPTERS` 已清空
- **section 一等公民（校招/实习/社招）**：适配器一次抓全量（飞书不带 recruitment_id_list、百度循环 recruitType），从岗位字段判断 section（jobType/hireMode/seasonType/recruit_type），scan 单 scope 不翻倍，导入按 apply_scopes 过滤（应届生不导入社招，社招用户换画像可扫）
- **语义召回兜底（防漏）**：关键词无命中的公司 → 全量抓 + embedding 召回 Top-K（`embedding.js` 硅基流动 bge-m3），防止漏「title 不含关键词但 JD 语义相关」的岗（如携程「业务运营」含「供应链运营」）。业界三阶段漏斗：embedding 召回 → reranker 精排 → LLM 判定
- **分层搜索不得静默回退全量**：关键词空→阻断；失败→报错；无命中→searchMode 标记。2026-08-29 事故：search_portrait 丢失→静默退化全量抓
- **确定性活 / 认知活分层**：硬过滤/分档算术是代码（0 token），判定是 LLM
- **缓存 key 必须含画像标识**（profileKey 隔离，不同候选人判定结果不可复用）
- **画像生成严禁硬编码方向**（严禁臆测简历没有的方向）
- **投递状态手动为主，不大规模逆向**：手动标记（去投递锚定 + 拖拽换列）成本近零；自动同步只保留已逆的京东/腾讯/大疆(Moka)，其余不再逆（登录态 + 验证码 + 加密，维护成本过高）
- **自动填充主策略 = 简历上传解析覆盖（四两拨千斤）**：多数官网有「上传简历→自动解析→覆盖字段」，扩展 `uploadResumeFile()` 用 DataTransfer 把简历文件塞进 `input[type=file]`，官网自己解析覆盖（准确率官网保证），规则匹配 `scanAndFill` 降级为兜底 + `scanUnfilled` 报告未填字段。简历原文件存后端 `data/resume-files/`（按用户），`/api/resume/file` 吐 base64。字段名位置仍因 ATS 而异（zhiye=cmp_name 动态表单 / Moka=placeholder / 飞书=data-form-field-name），见 `AUTOFILL.md`
- **简历解析用 LLM**：用户上传简历（pdf/txt）→ LLM 提取画像（`resume_parse.js`），不手动维护 profile.json。产品化硬门槛

## 工作方法论（约束，同样不要走回头路）
- **先对齐再动手（沟通节奏，最高优先级）**：收到问题/报 bug 先复述「我理解你要什么」+ 列模糊点，别急着写代码。关键假设用 AskUserQuestion 问清（每次只问 1 个最关键、带推荐答案，≤2 轮），动手前给「改哪几个文件、各改什么」清单等确认；用户可随时 Esc 打断补充。多轮短回合优于一轮埋头干完。修复计划便宜，修复错代码贵
- **先调研现成工具，别徒手造轮子**：动手前先搜网上有没有现成方案（job-pro 逆向 50 家接口、ATS 速查表、bge embedding/reranker）。复用 > 参考 > 自研
- **发现 → 验证 → 优化 → 适配**：每个现成资源/结论都要实测验证，别照抄——速查表漏了 Moka keyword 参数、IV 硬编码恰好对滴滴成立但对别的租户会错
- **不要推测，要探测**：识别 ATS 家族靠「搜索招聘官网 + 实测接口」，不靠猜英文名（猜 zhiye subdomain 准确率极低）
- **别默认「需要浏览器」**：moka/byte/ant/bili/hotjob 都被误判过「需浏览器/签名」，实测全是纯 HTTP。job-pro 唯一 puppeteer 依赖是莉莉丝 CDP 破签名
- **规模化靠「家族工厂 + workflow 并行」**：识别 URL 特征 → 加配置对象（~30 行），一次 workflow 识别几十家，不逐家手搜
- **投递限制/状态从「接口字段」自动识别，别手工标注**（limits.js 手工填 3 家是反面例子，Moka `applicantLimitCheck` 字段能自动提取）
- **投递状态/加密接口逆向优先用 HAR，别徒手拦截**：HAR 一次导出就含「接口 + 加密响应 + 前端 JS（含 key/算法）」，一条龙逆向。京东教训：我先 puppeteer 拦截（status_probe.js）+ 单独下载 JS + grep + 多次尝试解密（key 编码理解错），而用户给的 HAR 里 key/Utf8.parse/AES.decrypt 全都有，直接提取即可

## 关键文件
- `tracker/scan.js` 扫描调度 + 分层搜索 + 语义召回兜底
- `tracker/scorer.js` 精排打分 + `tracker/reranker.js` 语义重排 + `tracker/embedding.js` 语义召回
- `tracker/companies.js` 公司注册表（171 家已点亮）
- `tracker/expand.js` 扩展流水线（候选清单 → 验证接口 → 生成配置）
- `tracker/portrait.js` 画像生成
- `tracker/data/profile.json` 候选人画像（换人 = 换这份 + 重跑 portrait + scan）
- `tracker/health.js` / `smoke.js` 稳定性
- `FAMILIES.md` ATS 家族识别 + 逆向方法论
- `ADAPTERS.md` 适配器对照表
- `STATUS.md` 投递状态同步家族索引
- `AUTOFILL.md` 投递表单自动填充方案 + 各 ATS 字段名位置 + 动态/静态表单
- `tracker/resume_parse.js` 简历解析（txt/pdf → LLM 画像，对齐 profile.json）
- `DESIGN.md` 顶层设计文档

## 当前状态
**171 家公司已点亮**（互联网/游戏/半导体/制造/金融/央企/医药），全部纯 HTTP 抓取。section 区分（校招/实习/社招）+ 语义召回兜底 + 失败显式化（阻断/searchMode/keywordHash 基线）+ workflow 扩展流水线（并行搜索识别 ATS）+ 定时健康检测（每天 smoke+scan）。

**内测版已跑通**（2026-08-30）：浏览器扩展（`extension/`）+ 本地后端（server.js）。闭环：注册/登录（邀请码 JOBSTAR2027，users 表 token 鉴权，画像按用户隔离）→ 上传简历（pdf/docx/txt，resume_parse.js）→ LLM 画像 → 推荐（四段式漏斗：5 关键词召回→粗排裁 300→reranker 精排→LLM 分档 + judge 4 项理由）→ 自动填充（autofill-core.js）→ Chrome Side Panel（页面式 UI + 飞书配色 #1456F0 + SVG 线条图标 + 匹配度环卡片）。**已取消商业化用量计量（quota/usage_count 已移除），内测不限次数**。

**体验三改**（2026-08-30）：
1. **渐进式呈现**：`scanAll` 加 `onLive` 逐批推未打分岗位，`scoreJobs` 加 `onProgress` 打分段细进度；前端轮询增量渲染 live 卡片（「围观」而非「干等」，扫一家出一家）
2. **投递工作台**：结果卡升级为「匹配度环（score 0-100）+ 一句话理由（verdict）+ 4 匹配点（职责/经验/技能/方向）+ 去投递按钮」；去投递 = 开官网 + `POST /api/applications/mark-applied` 锚定已投（记 applied_at，`db.findByJobId` 按 job_id 定位）
3. **首屏三步引导**：上传简历 → 点「推荐岗位」→ 看匹配岗位（A/B 档默认 + C/D 折叠展开）
4. **导航 + 看板**：顶部步骤条「简历/推荐/投递/看板」；③投递展示投递记录、④看板画漏斗（待投→已投→回复→面试→Offer）+ 导出 CSV
5. **形态迁移 + 高级感**（2026-08-30）：悬浮球 → Chrome Side Panel（`sidepanel.html/js` 页面式，`content.js` 瘦身成纯填表执行器）；飞书配色（主色 #1456F0、灰阶 #1F2329/#646A73/#8F959E）+ SVG 线条图标；推荐分层展示（精排 A/B 高亮 + 粗筛全量折叠，可搜索展开投递）；头像自定义 + 退出登录；推荐状态全局保存（切视图不丢）
6. **架构体检 + 安全加固 + 上云准备**（2026-08-30）：数据隔离（applications 加 `user_id`，全接口按用户过滤）、未登录访问 401、写操作/资源操作鉴权、密码 scrypt 加盐（`verifyPassword` 兼容旧 sha256）、token 30 天过期、rate limit（登录/注册 10 次/分、推荐 5 次/分）、结构化日志（`logger.js` 零依赖 JSON）、LLM 成本追踪（token + 成本日志）、URL 可配置（①简历页服务器地址）、备份脚本（`backup.sh`）、部署文档（`DEPLOY.md`）

API：`/api/register` `/api/login` `/api/me` `/api/resume/parse` `/api/resume/parse-file` `/api/recommend`（复用 /api/scan/status 轮询，含 live 增量）`/api/applications/mark-applied`。

## 下一步（待做）
- **云端部署（已选型，待执行）**：阿里云 ECS 2核2G e实例 + 3Mbps 带宽 + 40G（Alibaba Cloud Linux 3）。步骤见 `DEPLOY.md`：装 Node v22（nvm，node:sqlite 需要）→ 传代码 → npm install → 配 `DEEPSEEK_API_KEY` → pm2 启动 → 安全组开 443/8630 → 改 manifest `host_permissions` + 扩展填域名 → crontab 备份（`backup.sh`）
- ~~投递限制自动识别~~（已做 wecruit/hotjob：`limits.js` 的 `deriveApplyLimit()` 从详情接口 `canDelivery`/`limitApplyNumByOrg` 提取；Moka `applicantLimitCheck` 加密、飞书 `deliver/limit_check` 需登录，待探测）
- 排查 6 家参数（极氪/北方华创/京东方/海信/九阳/阳光保险）
- 国央企/医药/能源 workflow 落地（已启动）
- 反馈闭环（投递结果回校准打分器）

## 投递状态（已完成，方向=手动为主）
- **手动标记为主**：「去投递」锚定（pending 点按钮自动→applied + 记 `applied_at`）+ 看板拖拽换列。实现于 `db.js`（applied_at 字段）+ `public/app.js`（apply-link 按钮）
- **自动同步（可选增强，仅已逆几家）**：京东 `status_jd.js`、腾讯 `status_tx.js`、大疆/Moka `status_dji.js`。详见 `STATUS.md`
