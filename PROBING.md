# 招聘 JSON API 定位方法论（PROBING）

> 求职星逆向招聘 API 的标准打法。目标：拿到一家新公司，**最快判出它用哪套招聘系统、怎么直连它的 JSON API**。
> 配套工具：`tracker/detect-ats.js`（URL 指纹判家族 + 参数提取 + 生成配置）、`tracker/har_capture.js`（抓 HAR）、`tracker/expand.js`（验证 + 生成配置）。

## 0. 一句话原则

招聘数据抓取的本质是**「标准化问题」，不是「抓取问题」**。绝大多数招聘官网背后是少数几套 ATS SaaS（北森 zhiye / Moka / 飞书 / 北森 Wecruit），岗位数据本来就是**公开 JSON API**（前端 JS 拉 JSON 渲染页面）。定位 API = **判 ATS 家族 → 套现成适配器 → 加一行配置**。真正需要「逆向」的只有少数自研。

## 1. 幂律分布（实测 288 家，2026-09）

| 系统 | 家数 | 占比 |
|---|---|---|
| 北森 zhiye | 132 | 46% |
| Moka | 77 | 27% |
| 飞书 byte | 16 | 6% |
| 北森 Wecruit | 14 | 5% |
| hotjob | 13 | 5% |
| 国聘网 iguopin | 3 | 1% |
| Workday | 1 | — |
| 自研（各 1 家） | 20 | 7% |

**头 5 套 = 88%**（zhiye+moka+byte+wecruit+hotjob）。幂律长尾：逆向一次 SaaS，吃几十家；长尾自研每家一套，是探测成本的主要来源。另有 12 家 adapter=null（待适配）。

## 2. 三层收敛规律（比「ATS 家族」更本质）

- **① 数据模型收敛**：所有招聘网站（SaaS + 自研）岗位实体同构 ——
  `岗位 = { id, title, department, location/cities, date, JD(职责+要求), section(校招/社招/实习) }`，
  访问结构 = `列表接口(分页+关键词) → 详情接口`（或列表直接带 JD）。
  这就是为什么每个适配器最后都要「映射到统一 job 结构」——上游本来就长一样，只是字段命名/路径不同。
- **② 前端技术栈收敛**：招聘官网几乎都是 SPA（React/Vue）调 JSON API，只有老旧门户（旧版 zhiye）才服务端渲染 HTML 表格。所以「定位 JSON API」的手段是**唯一且通用**的：看 Network Fetch/XHR、或抓 HAR、或静态分析 JS、或提 SSR hydration 数据。
- **③ 逆向难度阶梯收敛**（分层，不随机）：

| 层 | 特征 | 例子 |
|---|---|---|
| L0 纯公开 | 直接 curl 能通 | 多数 zhiye |
| L1 要 cookie | 先 GET 门户拿 cookie | Moka 首跳 |
| L2 页面参数 | portalId/pageId/suiteId 从 HTML/URL 提 | Wecruit |
| L3 AES 对称加密 | 密钥在页面 JS/init-data | Moka |
| L4 国密 SM2/3/4 | 全套握手 | 用友大易（暂缓）|

**规律：难度和「是不是知名 SaaS」强相关**——知名 SaaS 公开资料多、有人逆过，都是 L0-L3；「伪自研」国密加密才到 L4。

## 3. 定位决策树（拿到新公司照走）

```
拿到一家新公司
  │
  ├─ Step 0【URL 指纹判家族】1 秒、0 成本、命中 88.5%
  │     .zhiye.com 子域名 / bstatics.com          → 北森 zhiye
  │     mokahr.com / app.mokahr.com / career.xxx  → Moka
  │     jobs.feishu.cn / *.jobs.feishu.cn /
  │       jobs.f.mioffice.cn / jobs.bytedance.com → 飞书 byte
  │     wecruit.hotjob.cn / *.hotjob.cn / SUxxx   → 北森 Wecruit
  │     └─ 命中 → 提取参数 → detect-ats.js 生成配置 → expand.js 验证，完事
  │
  ├─ Step 1【指纹没命中 → 先「猜 token + 验证」】
  │     从公司名/域名推导候选 token（拼音/英文 slug），
  │     逐个探测每个 ATS 的端点：bogus token 返回 404，valid 返回 200（有岗）。
  │     **200 就是铁证**，比抓官网 HTML 猜（~50% 准）可靠得多（~90% 准）。
  │     注意：公司可能挂多个 ATS，选「岗位最多」的那个 board，别取第一个（旧 board 会误导）。
  │
  ├─ Step 2【仍没命中 = 真自研，按成本从低到高试三招】
  │     ① SSR hydration：抓首页 HTML，找 __NEXT_DATA__ / __NUXT__ / __NUXT_DATA__ /
  │         __INITIAL_STATE__ / <script type="application/ld+json">（schema.org JobPosting）。
  │        Next.js/Nuxt 把页面初始状态序列化进 <script>，比 DOM 干净稳定，连 API 都不用逆。
  │     ② JS bundle 静态分析：抓 HTML 找 <script src>，下载 JS，grep
  │         baseURL / /api/ /position /list /search /query。纯前端路由页(#/xxx)
  │         解析 webpack loader（c.u=function / e.u=function）映射 chunk name→hash，
  │         拼 chunk URL 看真实 API 调用。
  │         进阶（ExecEndpoints 方法，挖「未执行」的隐藏端点）：grep 模板字符串 API 路径
  │         （`${base}/api/…` 拼接）、fetch/axios/XHR 调用点（即使没触发）、
  │         webpack/Vite/Next chunk 追踪（跟随 chunk 深挖）、跨域 API 重组。
  │         HAR 只抓「执行过的请求」，静态分析能挖「从未执行过的 JS 里的端点」——真自研尤适用。
  │     ③ 最后才开浏览器抓 HAR（har_capture.js），Network 过滤 Fetch/XHR/JSON，
  │         找「列表接口」和「详情接口」两个。
  │
  ├─ Step 3【判难度阶梯 L0-L4】决定投入：L4 国密直接暂缓（用友大易教训）。
  │
  └─ Step 4【定位列表接口的分页/关键词参数 + 确认列表是否带 JD】
        带全量 JD（zhiye GetJobAdPageList 的 Duty+Require / Moka jobs/v2）→ 翻页拉全量。
        列表 metadata-only（SmartRecruiters 类）→ 再找详情接口，on-demand N+1 补抓 JD。
        最后：字段映射到统一 job 结构（每家的固定收尾动作）→ expand.js 验证 → 进 companies.js。
```

## 4. 三个增量（2026 调研吸收，补强原方法论）

1. **「URL 指纹猜候选」→「token 猜测验证」**：指纹只是**猜候选**，真正可靠的是**探测端点返回 200/404**（bogus 404 / valid 200）。这是「从猜到证」的关键升级，detect-ats.js 的 `--verify` 就干这个。
2. **自研先静态分析，HAR 是第二选择**：SSR hydration（`__NEXT_DATA__`/`__NUXT__`/JSON-LD）+ JS bundle 静态分析，**不开浏览器**就能找到 API，比 HAR 快得多。这是「为什么每次探测一会儿」的主要优化点。
3. **「list 是否带 JD」是 ATS 分类维度**：metadata-only（列表只有 id+摘要）vs 全量（列表带 JD）。metadata-only 要 N+1 补详情，成本高一档，`scorer.js` 的 on-demand 补抓 JD 就是为此设计。

## 5. 陷阱清单（实际实现里踩过的坑）

- **stale/closed 岗位漂移**：多数厂商不硬删已关闭岗位，必须对账状态变化，不能只追加。
- **一家公司挂多个 ATS**：取岗位最多的 board，不是第一个。
- **空 board ≠ 不招人**：返回「空但有效」本身是个事实，别当成「没岗位」。
- **日期格式不一致**：Lever 用 epoch ms，Greenhouse/Ashby 用 ISO 8601，解析错会静默破坏「近 7 天」过滤。
- **字段名乐观**：读值别读名（Recruitee 的 `options_cover_letter` 是 boolean 不是雇佣类型）。
- **HTML 实体双重编码**（Greenhouse）：解码一次再渲染。
- **加密接口 IV 硬编码易错**：Moka IV 固定 `de7c21ed8d6f50fe` 恰好对某租户成立，换租户会错——密钥从页面 `init-data` 提，别硬编码。
- **「自研」域名可能是 SaaS 套壳**：很多公司用 zhiye/moka 但套自定义域名（北方华创 `career.naura.com`、闻泰 `jobs.wingtech.com`、恒生电子 `campus.hundsun.com`、博世 `www.bosch.com.cn`），一眼看不是 `xxx.zhiye.com` 就误判「自研」。**判断方法**：curl 招聘页 HTML，grep `bstatics`（北森 zhiye CDN）/`mokahr`/`tupu360`/`hotjob` 痕迹——有就是 SaaS 套壳，用对应适配器传 `base` 参数即可。**别只看域名，要看 HTML 里的 CDN/接口痕迹**。

## 6. 详情页 URL 定位（去投递跳转）

岗位抓到、JD 拿到，最后一步「去投递」要跳到官网**岗位详情页**。这个 URL（`detailUrl`）最容易过期/出错，单独讲。

**原则：适配器优先返回 detailUrl，reach 配置只兜底**（`scan.js`）：
- 优先级 = 适配器返回的 `j.detailUrl` > `reach.urlTemplate` > `reach.entryUrl`
- 踩坑：曾因 reach 覆盖适配器 detailUrl，导致 navigate 类型（美团/B站）跳不到详情页只到首页——适配器明明返回了正确 URL，被 reach 的 `entryUrl`（校招首页）顶掉。

**详情页 URL 字段要实测，不能靠猜（两步法）**：
1. **web search「XX公司 2027校招」**：确认校招是否开启 + 详情页 URL 格式实例（如腾讯 `post.html?query=p_xxx`、快手 `job-info/{数字id}`）。
2. **实测接口返回字段**：curl 列表接口，看每个岗位的字段，找出「详情页 URL 真正用的那个」——腾讯用 `position`（数字）、快手用 `id`（数字），而不是 `postId`（雪花 ID 字符串）/`code`（hash）。

**踩过的坑**：
- **腾讯**：详情页 `post.html?query=p_{position}`（position 字段），不是 `postId`（雪花 ID 字符串，那是投递 ID）。
- **快手**：详情页 `job-info/{数字 id}`，不是 `code`（hash）——用错 hash 会「查无此岗」，看起来像「校招过期」。
- **判断「过期」前先实测接口**：快手接口返回 264 岗没过期，是 URL 参数用错，不是真的过期。

**hotjob 自定义域名 suiteId 提取**（北森 Wecruit 租户参数）：
- 自定义域名（`bosera.hotjob.cn`、`crrc.hotjob.cn` 等）的 suiteId（SUxxx）不在页面 HTML 里。
- 用接口提取：`POST {base}/wecruit/common/getSLD`，body form `sld={完整域名}`，返回 `data.linkData.link`（形如 `https://bosera.hotjob.cn/SU65f940241c240e0a2275bda8/pb/index.html`），从 link 里提 SUxxx 即 suiteId。

## 7. 工具链

| 工具 | 作用 | 阶段 |
|---|---|---|
| `tracker/detect-ats.js` | URL 指纹判家族 + 参数提取 + 生成配置（可 `--verify` 探测验证）| Step 0-1 |
| `tracker/har_capture.js` / `har_capture_cdp.js` | CDP 抓 HAR（浏览器网络记录）| Step 2③ |
| `tracker/har_parser.js` | 解析 HAR 识别 ATS 家族 | Step 1 |
| `tracker/expand.js` | 候选清单 → 验证接口 → 生成 companies.js 配置 | Step 4 |
| `tracker/smoke.js` | 冒烟自检（maxJobs 小值抓少量）| 验证 |

## 8. 合规边界

这些接口是**公开、只读、为第三方消费而设计**的岗位数据（公司希望岗位出现在招聘站）。抓取公开岗位数据在合理使用范围内。**只读公开岗位信息**，不写账号 cookie/token/验证码、不绕过登录态访问非公开数据。详见 `TERMS.md` / `PRIVACY.md`。
