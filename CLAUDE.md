# 求职星计划（Job Star）

个人求职自动化系统：**简历画像 → 搜索（关键词+语义召回）→ 精排打分 → 导入看板「待投」**。核心代码在 `tracker/`。

## 核心流程（四层）
1. **画像**：`tracker/data/profile.json` → `portrait.js` 生成搜索画像关键词（写入 `search_portrait`）
2. **搜索**：`scan.js` 分层搜索——家族工厂适配器（zhiye/moka/byte/wecruit 等），画像关键词精准抓 + 无命中时语义召回兜底
3. **精排**：`scorer.js`——硬过滤 → reranker 语义重排 → `deepseek-chat` 判定 → 分档 A/B/C/D
4. **看板**：`db.js` 导入待投（A+B 档，按 section 校招/实习/社招 + apply_scopes 过滤）

## 关键决策（不要重做，不要走回头路）
- **判定用非推理模型 `deepseek-chat`**（`deepseek-v4-flash` 实为推理模型返回空 content；`deepseek-v4-pro` 死配置已清理）
- **家族工厂战略**：招聘 SaaS 就那几家（北森 zhiye / Moka / 飞书 ATSX / 北森 Wecruit / 图聘 tupu360），识别 URL 特征 → 加配置对象（~30 行），非逐家逆向。大厂自研（腾讯/阿里/美团/银行）逐个逆向。详见 `FAMILIES.md`
- **国际 ATS（Workday 等）公开 JSON API（外企不是「自研」）**：外企的「自研」招聘系统，很多其实是国际 ATS，且公开 JSON（比国内真自研好逆）。Workday `POST {tenant}.{dc}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs`（dc 默认 wd1、site 默认 External，丰田是 wd503 且 site 特殊）。外企 ATS 分布：Workday（英特尔/丰田/耐克）、Eightfold（微软）、Avature（达能/百事/欧莱雅）、SmartRecruiters+iCIMS（SAP/AMD）、SuccessFactors（SAP）。详见 `PENDING.md` 第九节
- **第三方招聘平台（智联/无忧/中华英才网）校招门户合规放弃**：这些平台的校招门户有验证码/登录态门槛（智联极验、无忧手机验证 `getdatabyverifymobile`、chinahr operational 加密），绕过 = 绕过访问控制，违反《网络安全法》《数据安全法》，放弃。正确目标永远是「公司自有 ATS」（公司官网公开只读接口，无门槛）。详见 `PENDING.md` 第七节
- **国聘网 = 央国企校招聚合，公开可抓（真自研央企的替代方案）**：真自研央企（国家电网/中石油/三大运营商）的自研系统是加密/签名（digest/反爬盾），但它们的子公司校招岗位在国聘网（iguopin.com）公开可抓。`iguopin.js` 适配器：`POST gp-api.iguopin.com/api/jobs/v1/recom-job`（nature 校招=`115xW5oQ`/社招=`113Fc6wc`/实习=`11bTac9`，列表直接带完整 JD contents）。**不用逐个逆央企自研**。⚠️ **注意：`recom-job` 是「推荐接口」非「全量搜索」**——单次上限 400（热门岗位，翻页钳制 20 页），按省枚举（allCities）去重约 393 岗/59 城市；全量搜索（`search.keyword`）需登录态（未登录 total:0），合规边界同智联/无忧，待解决
- **浏览器型适配器全部纯 HTTP 化**：moka/byte/ant/bili/hotjob 都能纯 HTTP（含莉莉丝，现走飞书 byte 纯 HTTP，非 CDP 破签名）。`BROWSER_KEYWORD_ADAPTERS` 已清空
- **section 一等公民（校招/实习/社招）**：适配器一次抓全量（飞书不带 recruitment_id_list、百度循环 recruitType），从岗位字段判断 section（jobType/hireMode/seasonType/recruit_type），scan 单 scope 不翻倍，导入按 apply_scopes 过滤（应届生不导入社招，社招用户换画像可扫）
- **语义召回兜底（防漏）**：关键词无命中的公司 → 全量抓 + embedding 召回 Top-K（`embedding.js` 硅基流动 bge-m3），防止漏「title 不含关键词但 JD 语义相关」的岗（如携程「业务运营」含「供应链运营」）。业界三阶段漏斗：embedding 召回 → reranker 精排 → LLM 判定
- **分层搜索不得静默回退全量**：关键词空→阻断；失败→报错；无命中→searchMode 标记。2026-08-29 事故：search_portrait 丢失→静默退化全量抓
- **确定性活 / 认知活分层**：硬过滤/分档算术是代码（0 token），判定是 LLM
- **缓存 key 必须含画像标识**（profileKey 隔离，不同候选人判定结果不可复用）
- **画像生成严禁硬编码方向**（严禁臆测简历没有的方向）
- **投递状态跟踪 = 邮件解析为主（零逆向）+ 手动兜底**：企业通知主要走邮件，一套邮箱解析（IMAP + mailparser + LLM 分类 + 公司名归一化 + 两级匹配/三档置信度）覆盖所有公司，不用登录任何招聘系统。手动标记（去投递锚定）保留为兜底。自动同步不再逐个逆向（京东/腾讯/大疆已逆的保留但非主路径）。详见 `PENDING.md` 第十三节
- **投递跳转 detailUrl：适配器优先，reach 兜底 + 详情页 URL 必须实测**：scan.js 里 detailUrl 优先用适配器返回的（j.detailUrl），reach 配置（urlTemplate/entryUrl）只在适配器没返回时兜底。曾因 reach 覆盖适配器 detailUrl，导致 navigate 类型（美团/B站）跳不到详情页只到首页。详情页 URL 字段要实测/搜索确认，不能靠猜：腾讯用 position（`post.html?query=p_{position}`，不是 postId）、快手用数字 id（`job-info/{数字id}`，不是 hash code）。搜索「XX公司 2027校招」能确认校招开启时间 + 详情页 URL 格式，但字段从接口返回实测
- **自动填充主策略 = 简历上传解析覆盖（四两拨千斤）**：多数官网有「上传简历→自动解析→覆盖字段」，扩展 `uploadResumeFile()` 用 DataTransfer 把简历文件塞进 `input[type=file]`，官网自己解析覆盖（准确率官网保证），规则匹配 `scanAndFill` 降级为兜底 + `scanUnfilled` 报告未填字段。简历原文件存后端 `data/resume-files/`（按用户），`/api/resume/file` 吐 base64。字段名位置仍因 ATS 而异（zhiye=cmp_name 动态表单 / Moka=placeholder / 飞书=data-form-field-name），见 `AUTOFILL.md`
- **简历解析用 LLM**：用户上传简历（pdf/txt）→ LLM 提取画像（`resume_parse.js`），不手动维护 profile.json。产品化硬门槛
- **北森 Wecruit 校招有隐藏参数（projectCode + 独立 suiteId）**：校招门户用独立 suiteId（`school.html` URL 里），`listPosition` body 藏 `projectCode`（如 `202701`=2027届）。易方达社招 suiteId `SU67ac...` / 校招 suiteId `SU6a8fb...` + `projectCode=202701`。`wecruit.js` 已支持 `projectCode` 参数。金融公司多为「北森 Wecruit 伪装自研」，HAR 一抓就露出 suiteId/projectCode
- **zhiye base 参数（北森自定义域名）**：如贝壳 `campus.ke.com`（非 `xxx.zhiye.com`），`zhiye.js` 加 `base` 参数支持。JS 特征 `bstatics.com`=北森 CDN
- **zhiye Category 枚举（实测中金/东鹏/良品铺子确认）**：`Category=["1"]`=社招、`["2"]`=校招、`["3"]`=实习。之前 `CATEGORY_BY_SECTION` 只配了 campus，社招/实习走不到新版 API——已补全 `{ campus:['2'], social:['1'], intern:['3'] }`。**关键认知：8月底校招 Category=["2"] 普遍为 0（2027届秋招9月才开），社招/实习常年有岗**，所以候选验证不能只看校招，要三 section 都试
- **HAR 自动抓取流程**：Edge `--remote-debugging-port=9222` 启动 + `har_capture_cdp.js`（单家抓 HAR）+ `batch_har.js`（批量识别 ATS）。依赖 `../job-hunter/node_modules/puppeteer-core`。自研/加密接口逆向优先 HAR（比徒手 curl 猜 API 快）
- **ATS 逆向参考（job-pro 速查表）**：Moka 有 AES-CBC 加密接口 `POST /api/outer/ats-apply/website/jobs/v2`（data=base64、necromancer=密钥、IV 固定 `de7c21ed8d6f50fe`）；北森 zhiye 校招参数 `BusinessType=2`、`Category=["2"]`
- **金融「自研」识别结论（用户洞察验证）**：基金/券商几乎全是北森——易方达=Wecruit（suiteId+projectCode）、广发基金/广发证券/南方基金/华泰证券=Wecruit（`gf.hotjob.cn`→`wecruit.hotjob.cn/SUxxx`）、华夏基金=北森 iTalent 旧版（`chinaamc.zhiye.com`）。**大行（工行/建行/农行/招行）才是真自研**。识别方法：域名跳转（gf.hotjob.cn→wecruit）+ 搜索真实招聘官网（华夏基金官方=chinaamc.zhiye.com，非 job.chinaamc.com）
- **用友大易 Dayee（国密加密，重）**：中信银行 `job.citicbank.com`（zpmhys+aes+rsa）、兴业银行 `job.cib.com.cn`（`ersApi` 前缀 + `jupui`/`X-JUP-*` 头 = 用友 JUP 网关）。兴业银行加密链：`/api/authPrehandler`（拿 SM2 pubKey+salt）→ `/api/cfn/sysToken` → SM4 加密 body + SM3-HMAC 签名 + `X-VALID-TOKEN`/`Authorization` 头。岗位接口 `POST /ersApi/recruitposition/portalPage`（需握手，裸测 500）。国密 SM2+SM4+SM3 全套，逆向成本远高于北森/Moka，**暂缓**，优先级低于批量扩展
- **旧版北森 zhiye 纯 HTTP 解析（jobsTable 表格）**：旧版门户（如华夏基金、中国人寿）无新版 `GetJobAdPageList` API，岗位在 `<table class="jobsTable">` 服务端渲染。`zhiye.js` 加 `scrapeOldHtml`（纯 HTTP 解析 + 分页），列表 `/social/jobs`（第1页）+ `/social/?PageIndex=N`（后续页），总页数从 `_MvcPager_GoToPage(...,N)` 提取。**替代 Puppeteer 回退，纯 HTTP 更快**（用户明确要求）
- **纯 HTTP 铁律**：所有适配器优先纯 HTTP（快），Puppeteer 仅作最后兜底。旧版 zhiye 也纯 HTTP 化。`scan.js` zhiye 分支已补 `base` 参数（此前贝壳 `campus.ke.com` 会漏传报错）
- **两阶段 JD 判定（硬门槛不漏判）**：判定拆成 4a「JD 结构化抽取」（全量 JD 不截断，抽 hard_reqs+skills+duty_summary，跨用户缓存 `jd-cache.json`，key 不含画像）+ 4b「匹配判定」（用结构化摘要，读短 JD）。根治「JD 截 400 字漏硬门槛（经验/证书/专业写在末尾漏判）」。JD 抽取用 `judgeModel`（deepseek-chat），勿用 `fastModel`（v4-flash 是推理模型返回空 content）
- **缓存版本号 CACHE_VERSION（'v3'）**：scan.js 和 scorer.js 的缓存 key 都加版本号前缀，改岗位字段/判定逻辑时 +1，旧缓存自动失效，无需手动清。改 mapJob 逻辑（section/location/清洗）记得清缓存或 +1 版本
- **招聘类型多信号推断（section.js）**：业界用结构化枚举（recruitType/jobType/hireMode/recruitment_id_list），但 wecruit/hotjob 只有 recruitType=1（校园混校招+实习）。`section.js` 的 `inferSection(adapterSection, {title,type,program})`：结构化字段优先 + 多信号关键词兜底（实习=实习|暑期|夏令营|日常实习|Intern；社招=社招|资深|Senior；校招=校招|应届|管培|秋招|Campus|202X届）。比单靠 title 含「实习」更全，防漏判「暑期生/夏令营」
- **城市规范化（splitCities）**：`scan.js` 的 `splitCities` 处理「北京、上海」「广东省·深圳市」「BeiJing」「上海市嘉定区」等格式：拆分（、,，/;·）+ 英文拼音转中文（39 个主要城市映射）+ 区县归属市 + 去后缀。让「北京」=「北京市」=「BeiJing」=「北京市朝阳区」，避免城市列表爆炸
- **面向大众（非采购/供应链专属）**：产品面向大众求职者，不能硬编码行业词。关键词停用词只保留**动词类**通用词（优化/管理/支持/提升/负责/跟进/执行/协调/推动/协助/维护/分析），不硬编码「运营/数据分析」这类有行业歧义的词。画像 prompt 用通用语言规则（关键词=具体职能方向名词，排除动词+泛化能力词）。判定 prompt 的 `direction` 严格化（泛化能力重叠不算方向命中）。详见 [[job-star-audience]]
- **负反馈闭环（dismiss 移除）**：待投递加「移除」按钮（选原因：公司不感兴趣/岗位方向不符/薪资低/地点不符/其他），标记 `dismissed` 状态（非物理删除）。`feedback.js` 把 dismissed 作为**强负反馈**：①档位级（computeTierAdjustment 里 dismissed≥2 额外-2分）②公司级（computeDismissSignals 收集「公司不感兴趣」的公司 → scorer 阶段7 降15分+掉出A/B档）。业界共识：用户主动移除比「没回复」更强，是校准金信号
- **⚠️ 数据流 profile 必须传到底（终极 bug 教训）**：多用户改造后，`profile` 必须一路传：`/api/recommend` → `scan.scanAll({profile})` → `scorer.scoreJobs({profile})`。**任何一环漏传，scoreJobs 会回退 `loadProfile()` 读全局旧文件 `data/profile.json`**（含旧画像的「市场营销」方向），导致判定用错画像、推错岗位。曾因此反复排查多轮（画像/判定/缓存都对，就是漏传 profile）。改多用户相关代码时，务必检查整条链路 profile 是否传到底
- **画像解析：三级区分 + 核心/次要经历（面向大众通用）**：简历解析要区分 ①岗位职能（work_experience.title 专有名词）②具体技能（Python/SQL）③领域标签（数据分析/运营这类宽泛词，既不是岗位也不是技能）④项目经历（projects，≠目标方向）。`target_roles` 只从「核心经历的岗位职能」推断：核心=时长长（3个月+）或同方向多次出现，次要经历（时长短且只出现1次，如1个月的市场营销实习）的方向不算目标。这些是业界 NER 标准实体分类，通用不硬编码行业词
- **三个版本号体系**：改逻辑时 +1 让旧数据自动失效，无需手动清缓存/重新上传简历。①`resume_parse.js` 的 `PROFILE_VERSION`（v4，简历解析逻辑，recommend 里检查 profile.meta.profile_version 不匹配就从简历文件自动重新 llmParseProfile）②`portrait.js` 的 `SEARCH_PORTRAIT_VERSION`（v2，画像生成逻辑）③`scan.js`/`scorer.js` 的 `CACHE_VERSION`（v4，岗位/判定缓存）。改对应逻辑时记得 +1
- **待投递手动化**：推荐不再自动导入待投（recommend 传 `importToBoard:false`），由用户在推荐卡片点「加入待投」手动加入；待投列表卡片点「去投递」跳官网。流程=推荐→挑→加待投→有空→去投递

## 工作方法论（约束，同样不要走回头路）
- **先对齐再动手（沟通节奏，最高优先级）**：收到问题/报 bug 先复述「我理解你要什么」+ 列模糊点，别急着写代码。关键假设用 AskUserQuestion 问清（每次只问 1 个最关键、带推荐答案，≤2 轮），动手前给「改哪几个文件、各改什么」清单等确认；用户可随时 Esc 打断补充。多轮短回合优于一轮埋头干完。修复计划便宜，修复错代码贵
- **先调研现成工具，别徒手造轮子**：动手前先搜网上有没有现成方案（job-pro 逆向 50 家接口、ATS 速查表、bge embedding/reranker）。复用 > 参考 > 自研
- **调研必记录到知识库**：每次参考/调研/搜索的外部资源（项目/文档/文章/API），无论用没用上，都追加到 `KNOWLEDGE-BASE.md`（记「资源名 + 链接 + 给了我们什么」）。这是知识沉淀，防重复调研、防丢
- **公司→行业分类：精确匹配 + 关键词规则够用，勿上 LLM/工商 API**：`classify.js` 两层（已收录精确匹配 + 关键词规则）实测 29/29 已收录 + 强信号新公司。调研结论（2026-08-31）：LLM 分类准确率仅 0.4-0.75 且对冷门公司有偏差（正是「推荐不准」教训）；工商 API 最准但「工商行业→求职行业」要映射 + 付费限流。量小场景不值得升级，品牌名盲区靠「workflow 调研候选清单带 group」覆盖（比 LLM 猜可靠）。升级路径已调研清楚（LLM 兜底 / 工商 API），扩展到大几百家且候选清单覆盖不过来时再上
- **发现 → 验证 → 优化 → 适配**：每个现成资源/结论都要实测验证，别照抄——速查表漏了 Moka keyword 参数、IV 硬编码恰好对滴滴成立但对别的租户会错
- **不要推测，要探测**：识别 ATS 家族靠「搜索招聘官网 + 实测接口」，不靠猜英文名（猜 zhiye subdomain 准确率极低）
- **别默认「需要浏览器」**：moka/byte/ant/bili/hotjob 都被误判过「需浏览器/签名」，实测全是纯 HTTP。job-pro 唯一 puppeteer 依赖是莉莉丝 CDP 破签名
- **规模化靠「家族工厂 + workflow 并行」**：识别 URL 特征 → 加配置对象（~30 行），一次 workflow 识别几十家，不逐家手搜
- **投递限制/状态从「接口字段」自动识别，别手工标注**（limits.js 手工填 3 家是反面例子，Moka `applicantLimitCheck` 字段能自动提取）
- **投递状态/加密接口逆向优先用 HAR，别徒手拦截**：HAR 一次导出就含「接口 + 加密响应 + 前端 JS（含 key/算法）」，一条龙逆向。京东教训：我先 puppeteer 拦截（status_probe.js）+ 单独下载 JS + grep + 多次尝试解密（key 编码理解错），而用户给的 HAR 里 key/Utf8.parse/AES.decrypt 全都有，直接提取即可

## 关键文件
- `tracker/scan.js` 扫描调度 + 分层搜索 + 语义召回兜底（含 `splitCities` 城市规范化 + `localKeywordFilter` 本地过滤）
- `tracker/scorer.js` 精排打分（两阶段 JD 抽取+判定）+ `tracker/reranker.js` 语义重排 + `tracker/embedding.js` 语义召回
- `tracker/section.js` 招聘类型多信号推断（校招/实习/社招，结构化字段 + 关键词兜底）
- `tracker/encrypt.js` 简历文件 AES-256-GCM 加密
- `tracker/feedback.js` 反馈闭环（analyzeFeedback + computeTierAdjustment 档位校准 + computeDismissSignals 公司黑名单）
- `tracker/companies.js` 公司注册表（288 家已点亮）
- `tracker/expand.js` 扩展流水线（候选清单 → 验证接口 → 生成配置）
- `tracker/detect-ats.js` ATS 家族自动识别（URL 指纹判家族 + 参数提取 + 生成配置，`--verify` 探测验证）
- `tracker/classify.js` 公司名 → 行业自动分类（已收录精确匹配 + 关键词规则，expand/detect-ats 生成配置时自动归 25 类）
- `tracker/tupu360.js` 图聘360 招聘 SaaS 适配器（辉瑞/宝马，纯 HTTP，兼容两种租户模板）
- `tracker/workday.js` Workday（国际 ATS）适配器（英特尔，纯 HTTP 公开 JSON，支持 dc/site 参数）
- `tracker/iguopin.js` 国聘网适配器（央国企校招聚合，纯 HTTP 公开 JSON，列表直接带完整 JD）
- `tracker/email.js` 邮件跟踪（IMAP + mailparser 解析 + 预过滤 + 并发 LLM 分类 + 公司名归一化 + `resolveMatch` 两级匹配/三档置信度 + 增量同步）
- `tracker/prefetch.js` 定时全量预抓（每天凌晨 cron，面向大众抓全量）
- `tracker/portrait.js` 画像生成
- `tracker/data/profile.json` 候选人画像（换人 = 换这份 + 重跑 portrait + scan）
- `tracker/health.js` / `smoke.js` 稳定性
- `monitor.sh` 监控告警（每5分钟探活 /healthz，异常自动重启）
- `FAMILIES.md` ATS 家族识别 + 逆向方法论
- `PROBING.md` 招聘 JSON API 定位方法论（决策树 + 难度阶梯 + 陷阱清单，通用）
- `KNOWLEDGE-BASE.md` 知识库（所有参考/调研/借用过的外部资源索引，调研后必追加）
- `PENDING.md` 待收公司清单（已识别线索未落地，含原因+下次怎么收）
- `ADAPTERS.md` 适配器对照表
- `STATUS.md` 投递状态同步家族索引
- `AUTOFILL.md` 投递表单自动填充方案 + 各 ATS 字段名位置 + 动态/静态表单
- `tracker/resume_parse.js` 简历解析（txt/pdf → LLM 画像，对齐 profile.json）
- `DESIGN.md` 顶层设计文档

## 当前状态
**288 家公司已点亮**（互联网/游戏/科技/半导体/消费电子/汽车/新能源/机械装备/银行/券商/基金/保险/金融科技/制药/生物医药/医疗器械/化工/食品饮料/零售消费/物流/地产建筑/教育/农业/软件/央企国企，共 25 类 + 国聘网聚合源），全部纯 HTTP 抓取。section 区分（校招/实习/社招，section.js 多信号推断）+ 语义召回兜底 + 失败显式化（阻断/searchMode/keywordHash 基线）+ workflow 扩展流水线（并行搜索识别 ATS）+ 定时健康检测（每天 smoke+scan）+ 定时全量预抓（prefetch.js 每天凌晨，缓存版本号 v3）。

**内测版已跑通**（2026-08-30）：浏览器扩展（`extension/`）+ 本地后端（server.js）。闭环：注册/登录（邀请码 JOBSTAR2027，users 表 token 鉴权，画像按用户隔离）→ 上传简历（pdf/docx/txt，resume_parse.js）→ LLM 画像 → 推荐（四段式漏斗：5 关键词召回→粗排裁 300→reranker 精排→LLM 分档 + judge 4 项理由）→ 自动填充（autofill-core.js）→ Chrome Side Panel（页面式 UI + 飞书配色 #1456F0 + SVG 线条图标 + 匹配度环卡片）。**已取消商业化用量计量（quota/usage_count 已移除），内测不限次数**。

**体验三改**（2026-08-30）：
1. **渐进式呈现**：`scanAll` 加 `onLive` 逐批推未打分岗位，`scoreJobs` 加 `onProgress` 打分段细进度；前端轮询增量渲染 live 卡片（「围观」而非「干等」，扫一家出一家）
2. **投递工作台**：结果卡升级为「匹配度环（score 0-100）+ 一句话理由（verdict）+ 4 匹配点（职责/经验/技能/方向）+ 去投递按钮」；去投递 = 开官网 + `POST /api/applications/mark-applied` 锚定已投（记 applied_at，`db.findByJobId` 按 job_id 定位）
3. **首屏三步引导**：上传简历 → 点「推荐岗位」→ 看匹配岗位（A/B 档默认 + C/D 折叠展开）
4. **导航 + 看板**：顶部步骤条「简历/推荐/投递/看板」；③投递展示投递记录、④看板画漏斗（待投→已投→回复→面试→Offer）+ 导出 CSV
5. **形态迁移 + 高级感**（2026-08-30）：悬浮球 → Chrome Side Panel（`sidepanel.html/js` 页面式，`content.js` 瘦身成纯填表执行器）；飞书配色（主色 #1456F0、灰阶 #1F2329/#646A73/#8F959E）+ SVG 线条图标；推荐分层展示（精排 A/B 高亮 + 粗筛全量折叠，可搜索展开投递）；头像自定义 + 退出登录；推荐状态全局保存（切视图不丢）
6. **架构体检 + 安全加固 + 上云准备**（2026-08-30）：数据隔离（applications 加 `user_id`，全接口按用户过滤）、未登录访问 401、写操作/资源操作鉴权、密码 scrypt 加盐（`verifyPassword` 兼容旧 sha256）、token 30 天过期、rate limit（登录/注册 10 次/分、推荐 5 次/分）、结构化日志（`logger.js` 零依赖 JSON）、LLM 成本追踪（token + 成本日志）、URL 可配置（①简历页服务器地址）、备份脚本（`backup.sh`）、部署文档（`DEPLOY.md`）
7. **已上云**（2026-08-30）：部署阿里云 ECS（182.92.156.235，2核2G e实例 + 3Mbps），Node v22 + pm2（开机自启）+ 安全组 8630；数据备份（`backup.sh` + crontab 每天 3 点）；代码同步（`sync.sh` 一键：打包排除 data/node_modules/.git → scp → pm2 restart）；HTTPS 暂缓，内测用 http+IP。**SSH 免密已配好**（本地 `~/.ssh/id_ed25519` → 服务器 authorized_keys），`bash sync.sh` 可直接自动同步，改完代码记得同步云端
8. **安全合规加固 + 反馈闭环 + 面向大众**（2026-08-30）：①简历文件 AES-256-GCM 加密（`encrypt.js`，密钥环境变量 RESUME_ENC_KEY）②数据删除/导出权（`/api/account` DELETE 删号 + `/api/account/export` 导出，个保法被遗忘权/可携带权）③操作审计日志（`logger.js` audit 方法落盘 data/audit.log，登录/删除/修改/推荐都埋点）④监控告警（`monitor.sh` 每5分钟探活 /healthz，异常自动重启，crontab 配好）⑤反馈闭环（dismiss 移除=强负反馈，档位校准 + 公司黑名单降权）⑥面向大众（清理采购/供应链硬编码，城市中英文规范化，招聘类型多信号推断）⑦隐私政策/用户协议（`PRIVACY.md`/`TERMS.md`）
9. **推荐准确性根治 + 待投递手动化**（2026-08-30）：①画像解析三级区分（岗位职能/技能/领域标签/项目经历）+ 核心/次要经历加权（时长/频率），根治「推荐泛化到运营/营销岗」②推荐链路 profile 传递到底（scanAll→scoreJobs 漏传 profile 是终极 bug）③待投递手动化（推荐卡片「加入待投」+ 待投卡片「去投递」）④三个版本号体系（profile/search_portrait/cache），改逻辑自动失效。**完整链路已云端验证：精排前15个全是采购岗**

10. **分组分类修正 + 知识库 + 方法论沉淀**（2026-08-31）：①数据治理 `companies.js`——「互联网」组 95 家错分归位 + 删 3 家重复（阳光电源/晶科能源/中国太平洋保险），再统一分类体系：39 类收敛 25 类（半导体/存储→半导体、车企 4 类→汽车、医药 5 类→制药/生物医药/医疗器械、金融组拆银行/券商/基金/保险），删 2 家跨组重复（中国建筑/中国人寿），总 259→254 家②新建 `PROBING.md`（招聘 JSON API 定位方法论：决策树+难度阶梯+陷阱清单）③新建 `KNOWLEDGE-BASE.md` 知识库（所有参考/调研/借用过的外部资源索引，调研后必追加）④新建 `tracker/detect-ats.js`（URL 指纹判 ATS 家族 + 参数提取 + `--verify` 探测验证）⑤修复连带 bug：`staleness.js` 下架检测原来只 filter「互联网」组（分类重构前默认组），重构后漏检 233 家，改为检测所有已点亮公司⑥新增 `classify.js` 公司名→行业自动分类（已收录 288 家精确匹配 + 关键词规则），`expand.js`/`detect-ats.js` 生成配置时自动归 25 类，不再默认「互联网」手动改

11. **扩展高价值公司（第 1 批）+ 详情页 URL 方法论**（2026-08-31）：①4 个限搜索 agent 调研世界500强外企/央国企/传统高市值/高科技金融的校招官网，识别「家族 SaaS 可直接加」14 家，实测验证后加 5 家（韦尔股份 zhiye/三星 zhiye/紫金矿业 moka/GE医疗 moka/松下 moka），254→259 家②沉淀 PROBING.md「详情页 URL 定位」方法论③修复详情页跳转 bug（scan.js 适配器 detailUrl 优先 + 腾讯 position + 快手数字 id）④新逆 **tupu360（图聘360）招聘 SaaS 适配器**（纯 HTTP，列表 POST position/list 返回 HTML + 兼容辉瑞/宝马两种租户模板），加辉瑞/宝马 2 家，259→261 家⑤hotjob 自定义域名 suiteId 提取法：POST `{base}/wecruit/common/getSLD`（body `sld={完整域名}`）返回 link 含 SUxxx，加博时基金/中国中车 2 家，261→263 家⑥**仔细复查「自研」清单，发现「自研域名套壳 zhiye/moka」规律**（看 HTML 的 bstatics/mokahr 痕迹，别只看域名）：加北方华创 zhiye/闻泰科技 zhiye/博世 moka/恒生电子 zhiye + 东风汽车 moka + 紫光国微 zhiye/潍柴 zhiye/隆基 hotjob，263→271 家⑦HAR 实测修正「hotjob=chinahr」误判：hotjob.cn 大部分是**北森 Wecruit**（getSLD 提 suiteId 能加），加五矿/海天/万华/歌尔/金茂 5 家，271→278 家⑧**知识库发散突破**：实测外企「自研」其实是国际 ATS 公开 JSON，新写 `workday.js` 适配器 + 加英特尔（607 岗），278→279 家。**待补全**：chinahr（中广核/伊利/立讯）、zhiye 旧版门户 4 家、tupu360 西门子、国际 ATS（丰田 siteId/耐克 tenant/SmartRecruiters/Avature/Eightfold）、真自研央企/家电（逐个 HAR 逆）。**合规放弃**：智联（极验）、无忧（手机验证）

12. **邮件跟踪（投递状态自动更新）+ 待办收尾**（2026-09-01）：①新增 `email.js`（IMAP 拉取 QQ/163 邮箱 + 规则/LLM 分类 + 公司名归一化 + 包含匹配），`/api/email/sync` + `/api/email/apply` API，扩展「③投递」页加邮件同步界面——**不用登录任何招聘系统，一套邮箱解析覆盖所有公司**②待办收尾：重搜失效参数加 5 家（丽珠 feishu/龙旗 zhiye/大疆 moka/中兴 moka/富国 moka），279→284 家③判定报告加「毒点」扫描（外包/单休/996/派遣，`scorer.js` 的 `scanRedFlags`），硬毒点降一档、软毒点标注，前端卡片红色 ⚠ 标签④简历解析实体规范化（`resume_parse.js` 的 `normalizeEntities`，学校/公司简称→全称，如「北大」→「北京大学」「字节」→「字节跳动」，PROFILE_VERSION v5）⑤简历定制多阶段（业界 Auto-JobHunter 范式：`tailorOnce` Architect → `criticTailor` Critic 打分 → 80 分放行，最多打回 2 次，替代原单次 LLM 调用）⑥autofill LLM 语义兜底：规则 miss 的字段收集「字段描述符」（不含简历值）→ `/api/autofill/map-fields` LLM 映射 → 本地 `applyMapping` 确定性写值（AI 只给映射不给值，隐私设计）⑦**国聘网突破（央国企校招聚合）**：真自研央企难逆（自研系统加密/签名），但其子公司校招岗位在国聘网公开可抓。`iguopin.js` 适配器（`POST gp-api.iguopin.com/api/jobs/v1/recom-job`，nature 校招/社招/实习，列表带完整 JD，allCities 按省枚举），279→288 家。⚠️ **recom-job 是推荐接口非全量**（单次上限 400，全量搜索需登录态）⑧**渠道全景摸清**：公开可抓 = 公司自有 ATS（286）+ 国聘网（官方聚合）；反爬/签名/登录 = 商业平台（Boss/智联/无忧/猎聘/拉勾）+ 聚合网站（应届生/牛客/实习僧）+ 教育部就业网（HTML 待解析）。**暂缓**：短信解析（合规）、国聘网全量搜索（需登录）、教育部就业网 HTML 解析。

13. **邮箱同步重构 + 同公司多岗位匹配 + 体验优化 + 关键 bug 修复**（2026-09-02）：
①**邮箱同步重构**：`email.js` 换 mailparser（simpleParser）替代手写 extractText（正确解析 MIME/base64 附件/中文编码，正文不再混入附件乱码）；统一 LLM 结构化提取公司名（修「规则命中没 company」导致匹配不到投递记录）；并发 LLM（mapLimit 5 并发）+ 预过滤（isJobCandidate 强信号滤订阅/广告/验证码）+ messageId 去重 + 单封容错；增量同步（lastSync 持久化 `data/email-sync.json`，日期粒度 + 往回拨 1 天，避开 IMAP WITHIN「YOUNGER 小秒数」边界 BAD——精确时间戳会触发「Command failed」）
②**同公司多岗位匹配**：`resolveMatch` 两级匹配（公司 blocking → 岗位归一化 `normalizeTitle` + embedding 语义打分）→ 三档置信度（high 自动确认 / medium 候选人工点选 / none orphan 不静默链接），不再「break 遇第一个同公司就停」匹配错岗
③**体验优化 8 项**：画像确认（简历视图展示 AI 解析的完整画像摘要 + 可编辑方向/行业/城市/毕业年份）、推荐进度阶段展示、加入待投一步到位（按钮变「去投递→」再点直接开官网标记已投）、AI 判定四维可视化（职责/经验/技能/方向进度条）、「粗筛」改「更多相关岗位」、邮件降级提示（不配置也能手动跟踪）、导出改标题右侧小链接、窄屏媒体查询、版本更新提醒（manifest version vs 后端 version 对比落后弹「请重新加载」，自动识别 edge/chrome 地址）
④**关键 bug 修复**：`_currentUser` 作用域（try 块内声明，finally 引用抛 ReferenceError → 日志刷 ERR_HTTP_HEADERS_SENT + `db.close()` 永不执行）；**加入待投 user_id 传数字被 `sanitizeApplication` 的 str() 转空字符串**（投递看板按 user_id 查不到，改 `String(user.id)` + 去重改 `importApplication`）；email/apply `Number(appId)` 把 UUID 转 NaN（确认更新一直 404）；`api()` 非 2xx 不抛错（假成功）；SiliconFlow key 缺失（语义召回失败）
⑤**版本号 0.1.0 → 0.2.0**（manifest + healthz）

API：`/api/register` `/api/login` `/api/me` `/api/resume/parse` `/api/resume/parse-file` `/api/recommend`（复用 /api/scan/status 轮询，含 live 增量）`/api/applications/mark-applied` `/api/email/sync`（邮箱同步）`/api/email/apply`（应用识别结果）`/api/autofill/map-fields`（LLM 字段映射）`/healthz` `/api/account/export` `/api/account`（DELETE 删号）。

## 下一步（待做）
- ~~云端部署~~（✅ 已部署 2026-08-30 阿里云 ECS 182.92.156.235，见上）
- **上 HTTPS（进行中，域名已定 jobaistar.ltd）**：域名在阿里云（NS=hichina，与服务器同家），已选**走 ICP 备案**（个人备案，约7-20工作日，用户本人实名操作）。备案通过后执行：DNS 解析 → 安全组开80/443 → 装 nginx + 阿里云免费SSL（或 Let's Encrypt）→ 反代 127.0.0.1:8630 → 扩展 manifest host_permissions 改 `https://jobaistar.ltd/*` + 服务器地址填 `https://jobaistar.ltd`。**备案期间继续 http+IP+8630 内测**。详见 `DEPLOY.md` 第四节
- ~~投递限制自动识别~~（已做 wecruit/hotjob：`limits.js` 的 `deriveApplyLimit()` 从详情接口 `canDelivery`/`limitApplyNumByOrg` 提取；Moka `applicantLimitCheck` 加密、飞书 `deliver/limit_check` 需登录，待探测）
- 排查 6 家参数（极氪/北方华创/京东方/海信/九阳/阳光保险）
- 国央企/医药/能源 workflow 落地（已启动）
- ~~反馈闭环~~（✅ 已做：dismiss 移除=强负反馈，档位校准 computeTierAdjustment + 公司黑名单 computeDismissSignals；协同冷启动等数据积累再做）
- **拓展公司到四五百家（进行中，已 288 家）**：主攻「家族型批量」（zhiye/moka/byte/wecruit/hotjob 加配置即可，workflow 并行调研候选 + `expand.js` 验证 + `batch_har.js` 抓 HAR 识别 ATS）；自研逆向优先 HAR。待办：① ~~40 家无效候选~~（✅ 已收）② ~~workflow 调研能源/物流/地产/教育/游戏~~（✅ 捞回 11 家）③ ~~4 个限次 agent 调研半导体/机械农业/化工/消费电子~~（✅ 收 17 家）④ 继续调研更多行业 ⑤ 金融：大行真自研 + 用友大易国密暂缓 ⑥ **算法/产品升级已全部落地**（见「当前状态」item 12：邮件跟踪/毒点扫描/实体规范化/简历定制多阶段/autofill 语义兜底）⑦ **长期储备（逐个 HAR 逆，边际价值递减）**：chinahr（中广核/伊利/立讯，SSR+operational 加密）、真自研央企 24 家（国家电网/中石油/三大运营商等）、需认证的国际 ATS（微软 Eightfold 需 OAuth、AMD iCIMS 需 Basic Auth，非公开放弃）。**教训：workflow 多 agent 无限联网搜索易死锁，改用「单 agent 限搜索次数」后台跑，稳**

## 投递状态（已完成，方向=手动为主）
- **手动标记为主**：「去投递」锚定（pending 点按钮自动→applied + 记 `applied_at`）+ 看板拖拽换列。实现于 `db.js`（applied_at 字段）+ `public/app.js`（apply-link 按钮）
- **自动同步（可选增强，仅已逆几家）**：京东 `status_jd.js`、腾讯 `status_tx.js`、大疆/Moka `status_dji.js`。详见 `STATUS.md`
