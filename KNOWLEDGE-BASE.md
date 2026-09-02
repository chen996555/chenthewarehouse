# 知识库（Knowledge Base）

> 求职星**参考、调研、搜索、借用过的一切外部资源**（项目 / 文档 / 文章 / API / 服务）。这是我们的外部知识沉淀，**每调研一次就追加一条，永不丢**。
>
> 维护规则：每条记「资源名 + 链接 + 给了我们什么/借用了什么」；已落地的写清落到了哪个文件；还没用上的也记，标记「待采用」，以后可能用得上。

## 一、开源项目（直接借用代码 / 架构）

| 项目 | 链接 | 给了我们什么 | 落地 |
|---|---|---|---|
| **job-pro** | （本地 `_oss_ref/` + 对话引用） | ATS 逆向核心参考：moka.ts（AES-CBC 解密）、feishu.ts（portal-channel header）、wecruit.ts（listPosition 接口）、zhiye 速查表；「49 家纯 HTTP」结论 | `tracker/moka.js` `byte.js` `wecruit.js` `hotjob.js` `zhiye.js` 全部适配器 |
| **job-application-copilot** | （对话引用） | resume_import 的 LLM 提取 + FIELD_GUIDE，简历解析结构化范式 | `tracker/resume_parse.js`（对齐它的 profile 结构）|
| **Auto-JobHunter**（jolie-z） | https://github.com/jolie-z/Auto-JobHunter | 工业级 AI 求职系统（BOSS/51job/猎聘）。**深入收获**：①多 agent 简历重写（LangGraph Splitter→Architect→Critic→Formatter + 80 分放行）②双漏斗清洗（硬规则一票否决 + LLM 深度体检「高杠杆匹配点/致命硬伤」）③RPA 静默投递（DrissionPage+Stealth 抹 WebDriver）④飞书 Bitable 看板。**借鉴**：①多阶段简历重写可提升 llmTailorResume ②「致命硬伤」报告形式；**不采用**：RPA 投递（自动登录/投递有风控风险，坚持手动兜底）|
| **boss-watch-agent**（ZeroMadLife） | https://github.com/ZeroMadLife/boss-watch-agent | approval-gated 本地求职 agent。**深入收获**：①审批门控（登录/验证码/风控/提交交用户）②SQLite 本地事实账本（岗位/JD/简历版本/匹配/审批/进度时间线）③**简历原文不写入 transcript、不上传外部模型**（隐私设计）④ATS 单页预填（多页逐页）| 人工兜底理念（已吸收）+ 隐私设计可参考 |
| **nuxt-data-parser**（heyitswit） | https://github.com/heyitswit/nuxt-data-parser | Nuxt3 `__NUXT_DATA__` 解析（devalue 格式、负索引 -1~-7）| PROBING.md Step 2（SSR hydration）|
| **ApiGen / auto-api-discovery** | https://www.npmjs.com/package/auto-api-discovery | Playwright 抓流量 → 自动生成 OpenAPI 3.0 + 折叠动态 ID | 评估：本质和我们的 HAR 抓取（batch_har.js）重复，只多「自动生成 OpenAPI」，价值有限，暂不采用 |
| **Unbrowse** | https://www.unbrowse.ai/blog/shadow-api-discovery-tutorial | API-native 智能体浏览器：「浏览一次、缓存 API、之后复用」+ shared route graph（跨代理共享路由 + embedding 语义匹配）+ workflow DAG | 理念参考：把逆向成果沉淀成「可复用路由图 + 语义匹配」，比 URL 指纹更进一层；但家族工厂已够用（命中 88.5%），暂不采用 |
| **ExecEndpoints**（execiq） | https://github.com/execiq/ExecEndpoints | Chrome 扩展 + JS 静态分析。**深入收获**：静态分析挖「从未执行过的 JS 里的隐藏端点」（模板字符串 API 路径、fetch/axios 调用点、webpack/Vite/Next chunk 追踪、跨域 API 重组）——**是 HAR 抓取的补充**（HAR 只抓「执行过的请求」）| 真自研逆向可借鉴：JS 静态分析挖未执行端点 |
| **Apify multi-ats-jobs-scraper** | https://apify.com/devilscrapes/multi-ats-jobs-scraper | 多 ATS 从 slug/URL 自动识别 + 指纹/代理轮换 | 参考（识别策略）|
| **ats-scrapers**（kalil0321） | https://github.com/kalil0321/ats-scrapers | **50+ ATS 适配器 + 420万职位数据集**，`get_scraper_for_url()` 自动识别 ATS，`pip install ats-scrapers` | 现成的「ATS 全谱适配器」，可借鉴扩展我们的家族工厂（我们只有 6 套）|

## 二、技术文章 / 文档（方法论来源）

| 文章 | 链接 | 给了我们什么 |
|---|---|---|
| **ATS 逆向方法论**（job-fit-research） | https://github.com/Chanban-hub/job-fit-research/blob/main/references/ats-reverse-engineering.md | **核心增量**：token 猜测验证（bogus 404 / valid 200）、端点速查表（Greenhouse/Lever/Ashby/Workable/Recruitee/SmartRecruiters/Workday）、陷阱清单（stale 岗位漂移、多 ATS、N+1、日期格式）。落地 PROBING.md |
| Most company job boards are just a public JSON API | https://dev.to/votiakov/most-company-job-boards-are-just-a-public-json-api-you-can-get-55g3 | 「招聘官网=公开 JSON API」核心认知 |
| Six ATS platforms publish open JSON endpoints | https://dev.to/udaninn/six-ats-platforms-publish-their-job-boards-as-open-json-here-are-the-endpoints-2d3k | 各 ATS 端点形状。**已实测 Workday**（`POST {tenant}.wd1.myworkdayjobs.com/wday/cxs/{tenant}/External/jobs`），写 `workday.js` 加英特尔 607 岗。外企 ATS 分布：Workday（英特尔/丰田/耐克）、Eightfold（微软）、Avature（达能/百事/欧莱雅）、SmartRecruiters（SAP）、iCIMS（AMD）、SuccessFactors（SAP）|
| How to Scrape Job Postings (13 ATS) | https://crawlora.net/blog/how-to-scrape-job-postings | ATS 平台全景。**公开端点补全**：Greenhouse `boards-api.greenhouse.io/v1/boards/{token}/jobs`、Lever `api.lever.co/v0/postings/{slug}`、Ashby `api.ashbyhq.com/posting-api/job-board/{name}`、SmartRecruiters `api.smartrecruiters.com/v1/companies/{id}/postings`、Workable `apply.workable.com/api/v1/widget/accounts/{acct}`、Recruitee `{co}.recruitee.com/api/offers/`、Personio `{co}.jobs.personio.de/xml`、BambooHR `{co}.bamboohr.com/careers/list`、Workday。都是公开无需登录（公司招聘页就是接口客户端）|
| How to reverse engineer a JSON API on a SPA | https://serpapi.com/blog/how-to-reverse-engineer-a-json-api-spa/ | SPA JSON API 逆向步骤。**新技巧**：①GraphQL introspection（`__schema` 查询直接拿所有字段，不用猜）②React fiber 树提取（`__reactFiber$` 遍历组件树 + `fiber.memoizedState` 提取 hooks 状态）③mitmproxy `--view-filter '~bs 关键词'`（DevTools 搜不到时）|
| How to Scrape Hidden APIs | https://decodo.com/blog/scraping-hidden-apis | DevTools「Copy as cURL → 逐个删 header 到最小可用」|
| Parsing NEXT_DATA and JSON-LD | https://evomi.com/blog/parsing-next-data-and-json-ld-the-clean-way-to-extract-structured-data | SSR hydration 提取（`__NEXT_DATA__`/`__NUXT__`/JSON-LD），jmespath 查嵌套 |
| How to find a job board from just its domain | https://dev.to/glitchbound/how-to-find-any-companys-job-board-from-just-its-domain-without-a-list-5aja | 从域名反查招聘站 |
| Greenhouse/Lever/Ashby 抓取教程 | https://dev.to/benthepythondev/how-to-scrape-jobs-from-greenhouse-lever-ashby-free-python-no-code-4n56 | 海外 ATS 具体抓法 |
| How to Find Hidden API Endpoints | https://dev.to/ellebanna/how-to-find-hidden-api-endpoints-before-scraping-a-website-25b1 | 子域名/路径枚举（api. /v1/ /graphql/ 等）|
| **阿里 SmartResume** | （对话引用） | 源文本验证（LLM 提取的关键字段回原文验证防编造）→ `resume_parse.js` 的 `validateAgainstSource` |
| 行业分类标准（GICS/申万/济安金信） | https://finance.cnr.cn/rdzt/jdzk/20260824/t20260824_527789661.shtml | 业界分类都是「层级体系」（一级/二级/三级）；济安金信「实质重于形式、单一归属、动态维护」原则。求职星用一级平铺 25 类即可 |
| 工商数据 API（天眼查/企查查/爱企查/国家公示） | https://developer.baidu.com/article/detail.html?id=3760335 | 返回国民经济行业分类四级（`industry` + `industryAll`），最准的「查」法；但工商行业≠求职行业，需映射，且免费限流 |
| LLM 行业分类研究（EDINET-Bench 等） | https://www.mdpi.com/2078-2489/15/2/77 | LLM 分类准确率 0.4-0.75+（看输入丰富度）；专门模型 RoBERTa F1 0.81 优于 ChatGPT；量小场景 LLM 够用 |
| 人岗匹配前沿（ConFit v3 等） | https://ui.adsabs.harvard.edu/abs/2026arXiv260509760Y/abstract | **LLM listwise re-ranking**（multi-pass + listwise RL + 噪声清洗 + 蒸馏）超越 GPT-5/Claude；Synapse 用进化式简历优化；多阶段共识=embedding 召回 + cross-encoder/LLM 精排（我们已符合） |
| 简历解析三代 | https://www.mokahr.com/academy/hrbaike/202606/09/ | 规则 65% → NER 85% → **LLM 97%**（我们已用 LLM 第三代）。混合流水线：OCR → LLM 抽取 + JSON Schema → 知识图谱增强（「北大」→「北京大学」）—— 我们缺「实体规范化」 |
| reranker 对比（BGE vs Cohere） | https://futureagi.com/blog/best-rerankers-for-rag-2026/ | BGE-Reranker-v2-m3 中文 NDCG@5 0.821 > Cohere 0.763，本地 GPU 延迟更低；Cross-Encoder 精排比 Bi-Encoder 精 10-100 倍 |
| 表单自动填充业界（LLM 语义字段匹配） | https://github.com/torontodeveloper/job-application-agent | **LLM 语义字段匹配取代规则匹配**（DOM 提取字段 → LLM 映射到档案）；Human-in-the-Loop 是业界标准；PII 脱敏后再送 LLM。我们的 autofill 可升级「规则匹配 → LLM 语义匹配」 |
| 智能填表深入（Fillsnap/KAFA/AI-Resume-Form-Filling） | https://github.com/1lck/AI-Resume-Form-Filling-Assistant | **核心解法**：①AI 只做「字段映射」（判断页面字段→简历路径），本地脚本确定性写值 ②Fillsnap 6 策略（Direct/Select/Split/Combine/Derive/Skip）处理字段差异 ③级联下拉=可搜索 select+打分匹配+LLM 裁决 ④多页表单=自动点 Next 逐页填（ApplyAgent）⑤**隐私：AI 只发字段描述符（label/placeholder/选项），不发简历值** ⑥**parser repair**（简历上传解析后修复错误字段）⑦量化：字段级 96%×8 字段=整表无错仅 72%，需填充后人工核验 |
| LLM 成本优化 | https://atlan.com/know/ai-agent/llm-cost-optimization-strategies/ | Prompt caching（省 90% 输入）、Batch API（省 50%，DeepSeek off-peak）、模型路由（简单任务小模型省 50-70%）、Prompt 压缩（28%）、输出限制。我们的「硬过滤 0 token」已有雏形，可加 caching + 路由 |
| 推荐算法（冷启动/协同过滤/bandit） | https://ar5iv.labs.arxiv.org/html/2209.05112 | 冷启动是求职推荐核心挑战，协同过滤需历史交互（我们用不了）；**我们「内容过滤（匹配度打分）」是冷启动正确选择**；混合推荐是主流；bandit 价值条件性。dismiss 负反馈已是轻量协同信号雏形 |
| 投递状态跟踪（邮件解析，免登录） | https://github.com/athulmurali/ai-job-application-manager | **核心方案=邮件解析**（企业通知主要走邮件，不用登录招聘系统）：①求职专用邮箱接收所有通知 ②AI 分类邮件（面试邀约/拒信/offer，90%+ vs 规则 30%）③Match Key（公司+职位）去重更新 ④人工审批闸门（状态变更需确认）⑤置信度阈值+关键词兜底（unfortunately→rejected）。**邮件转发模式**（JobShinobi）：转发到专属地址，免授权整箱。**短信（SMS）是业界空白**——国内企业短信通知多，是差异化机会 |
| 投递状态跟踪落地细节（邮箱接入+识别+匹配） | https://github.com/henry200803/mailbridge | **邮箱接入**：QQ邮箱 imap.qq.com:993 / 163 imap.163.com:993，**授权码≠登录密码**（开启 IMAP/SMTP 生成），Python imaplib 或 mailbridge MCP；中文编码 GBK/GB2312。**识别**：先规则（rejection 短语 "unfortunately"/"not moving forward" 过滤）后 LLM（本地 Ollama 分类+实体提取，数据不出本机）；状态枚举 applied/rejected/interview/offer。**匹配去重**：公司名归一化（去 Inc/LLC/Ltd 后缀）+ 双闸门（发件人含公司名+主题含招聘关键词）+ Message-ID 去重 + 同一公司岗位合并（后续状态覆盖早期）。**隐私**：只存元数据不存正文 |
| Company-Names-Corpus | https://github.com/wainshine/Company-Names-Corpus | 480 万中文公司名语料（NER 用），但 NER 解决「找公司名」不是「判行业」|
| 招聘数据 API 服务（Apify Zhaopin/TheirStack/Coresignal） | https://brightdata.com/blog/web-data/best-job-apis | 可「买」招聘数据：Apify 智联 $1.12/千条、TheirStack 聚合 31.5万 ATS 来源 $59/月。但都是「社招为主」，无专门校招 API，且海外服务 |
| geekbyter/get_jobs | https://github.com/geekbyter/get_jobs | 开源爬虫，覆盖中华英才网/智联/无忧，破验证码+代理池（仅供学习，逆向方法可参考）|
| 掘金《各大企业招聘数据抓取思路》 | https://juejin.cn/post/6844903966837309454 | 结论：前程无忧「数据丰富、准确、反爬较少」，中华英才网数据少不准，智联海量抓取触发验证码 |
| 极验验证码识别合规 | https://cloud.baidu.com/article/3637462 | 第三方打码绕过风控违反《网络安全法》《数据安全法》，不合规，放弃 |
| **mailparser（Node 邮件解析库）** | https://github.com/nodemailer/mailparser | 邮件解析事实标准：simpleParser 正确解析 MIME multipart / base64 / quoted-printable / 中文 GBK 编码 / HTML 实体，`parsed.text` 只含纯文本正文（附件单独在 `parsed.attachments`）。替代手写 extractText（旧版只去 HTML 标签，base64 附件混进正文污染 LLM）| `tracker/email.js` 已落地 |
| ImapFlow + MailParser 最佳实践 | https://code-garage.com/blog/interagir-avec-une%20boite-mail-en-nodejs-avec-imapflow-et-mailparser | ImapFlow 拉邮件 + simpleParser 解析的标准范式：bodyStructure 区分正文/附件、mailbox lock 防并发、download 按 part 拉、skipAttachments 省内存 | `tracker/email.js` 已落地（getMailboxLock + simpleParser skipAttachments）|
| **Simplify Email Integration（唯一原生邮件集成的求职工具）** | https://help.simplify.jobs/help/articles/0236686-email-integration | 连 Gmail → 自动 Smart Matching 到已投岗位 → 检测到面试/拒信时「推荐状态更新」→ 用户 Approve/Decline。验证了「人工确认」交互正确性；Smart Matching 比「公司名归一化+包含」更智能 | 已吸收（三档置信度人工确认）|
| Gmail API historyId 增量同步 | https://developers.google.com/workspace/gmail/api/guides/sync | 官方增量同步：首次全量 + 之后 historyId 只拉变化（配额低 60%）；historyId 过期 404 需回退全量。IMAP 无此机制只能时间戳增量 | 已吸收（IMAP lastSync 时间戳增量）|
| **career-ops reply-matcher（邮件匹配投递记录）** | https://github.com/santifer/career-ops/blob/main/reply-matcher.mjs | 加权评分匹配：公司 +2 / 岗位 +1.5 / 域名额外；同公司多岗位时「岗位名匹配」破局；匹配不上返回 `ambiguous-match` 标记交人工；**状态消歧**（active 优先于 rejected）| `tracker/email.js` resolveMatch 已落地 |
| JobShinobi（邮件自动记录投递） | https://www.jobshinobi.com/landing/ats-resume-tracker-that-logs-applications-from-email | fuzzy matching（公司+岗位名加权相似度）决定「新建 or 更新」；邮件自动记录投递 + 状态更新 | 参考 |
| **Entity Matching with Embeddings** | https://www.credibledata.com/blog/posts/entity-matching | 实体匹配五步：特征工程 → embedding（持久化）→ blocking 候选过滤 → 余弦相似打分 → 阈值+评估。**blocking 先缩小候选集避免 O(n²)** | 已吸收（resolveMatch 公司 blocking）|
| Prompt Engineering for Fuzzy Matching & Entity Resolution | https://oorbyte.com/prompt-engineering-for-fuzzy-matching-and-entity-resolution | **先确定性 gate 缩小候选集（admissibility gate，F1 0.08→0.66）再 LLM 精判**；阈值放代码不靠 prompt；结构化 JSON + 理由 | 已吸收（先 blocking 再 embedding/LLM，阈值在代码）|
| Data Matching Methods & Guide 2026 | https://prospeo.io/s/what-is-data-matching | 概率匹配 + 阈值分层（95%+ 自动 / 50-94% 审核 / <50% orphan）+ blocking + 人工 review。业界共识：**不静默匹配错** | 已吸收（三档置信度分层）|

## 三、API / 服务

| 服务 | 链接 | 用途 |
|---|---|---|
| DeepSeek API | https://api.deepseek.com | 判定模型 `deepseek-chat`（**勿用 `deepseek-v4-flash`**：实为推理模型返回空 content，已踩坑）|
| 硅基流动 bge-m3 | （硅基流动开放平台）| embedding 语义召回（`tracker/embedding.js`）|

## 四、方法论沉淀（我们自己的，已写成文档）

- [PROBING.md](PROBING.md) —— 招聘 JSON API 定位方法论（决策树 + 难度阶梯 + 陷阱清单）
- [FAMILIES.md](FAMILIES.md) —— ATS 家族识别 + 逆向方法论
- [ADAPTERS.md](ADAPTERS.md) —— 适配器对照表
- [AUTOFILL.md](AUTOFILL.md) —— 投递表单自动填充方案
