# 待收公司清单（已识别线索但未落地）

> 记录所有「已知招聘官网/ATS 线索、但还没收进 companies.js」的公司，含原因和下次怎么收。
> 下次扩展从这里接着做，不用重新调研。

## 一、校招未开 / 停招（subdomain 对，等校招季或复用）

| 公司 | 行业 | 线索 | 状态 |
|---|---|---|---|
| 金地集团 | 地产 | zhiye `gemdale` | 三 section 均空，疑似停招 |
| 三棵树 | 化工 | wecruit `SU623c3e59bef57c080bddade0` | 校招 0，社招待查 |
| 汇添富基金 | 基金 | zhiye `htffund` | 停招 |
| 中欧基金 | 基金 | zhiye `zofund` | 停招 |
| 洋河股份 | 酒类 | zhiye `chinayanghe` | 三 section 均空，校招未发布 |

## 二、zhiye subdomain 猜错（需重新搜正确域名）

| 公司 | 行业 | 当前（错） | 备注 |
|---|---|---|---|
| 中国三峡 | 能源 | `ctg` → Not Found | 搜索真实 subdomain |
| 华润置地 | 地产 | `crc` → Not Found | |
| 中通快递 | 物流 | `zto` → Not Found | |
| 中国能建 | 能源 | `ceec` → 空 | |
| 石药集团 | 医药 | `cspc` → alljob 空 | 页面有 alljob 但无数据 |

## 三、hotjob.cn 域名：多数是北森 Wecruit（getSLD 提 suiteId 能加），少数是 chinahr wt 系统

> 关键区分（2026-08-31 HAR 实测修正）：`wecruit/common/getSLD` 能返回 SUxxx 的是**北森 Wecruit**（用 hotjob.js 直接加，接口 `wecruit/positionInfo/listPosition/{suiteId}`）；返回 `/wt/xxx/web/` 路径、getSLD 无 SUxxx 的是**中华英才网 chinahr**（需 HAR 逆向，高成本）。

### 已确认北森 Wecruit（已加或 getSLD 可提 suiteId）

| 公司 | 行业 | suiteId | 状态 |
|---|---|---|---|
| 中国五矿 | 央企 | SU62f37858bef57c29ead8adab | ✅ 已加 |
| 海天味业 | 食品 | SU6322dfb70dcad46a862da4c5 | ✅ 已加 |
| 万华化学 | 化工 | SU6a7ad69c43154813049755d7 | ✅ 已加 |
| 歌尔股份 | 消费电子 | SU65dd9ebd1c240e4b11c4f491 | ✅ 已加 |
| 中国金茂 | 地产 | SU64f689866202cc040145b4b5 | ✅ 已加 |
| 博时基金 | 基金 | SU65f940241c240e0a2275bda8 | ✅ 已加 |
| 中国中车 | 机械 | SU64d47c466202cc36e27a52d4 | ✅ 已加 |
| 隆基绿能 | 新能源 | SU649d2f9c0dcad4644b43df7e | ✅ 已加 |

### 中华英才网 chinahr（/wt/xxx/web/，需 HAR 逆向，高成本）

| 公司 | 行业 | 线索 |
|---|---|---|
| 中广核 | 能源 | cgn.hotjob.cn（/wt/CGN/web/，已确认 chinahr） |
| 伊利 | 食品 | yili.hotjob.cn（getSLD 无 SUxxx，待 HAR 确认） |
| 立讯精密 | 消费电子 | luxshare.hotjob.cn（getSLD 无 SUxxx，待 HAR 确认） |
| 中国中化 | 化工 | sinochem.hotjob.cn（待确认） |
| 以岭药业 | 医药 | yiling.hotjob.cn（域名失效） |

## 四、moka siteId 失效 / 缺参数（需重新搜 org/siteId）

| 公司 | 行业 | 线索 | 问题 |
|---|---|---|---|
| 盒马 | 零售 | freshhema/4122 | init-data 缺失 |
| 微众银行 | 银行 | webankhr/70 | 404 |
| 度小满 | 金融科技 | duxiaoman/74050 | init-data 缺失 |
| 昭衍新药 | 医药 | joinn-lab/26887 | init-data 缺失 |
| 大北农 | 农业 | dbn/38288 | init-data 缺失 |
| 海大集团 | 农业 | haid/101909 | init-data 缺失 |
| 正大集团 | 农业 | cpgroup/41200 | init-data 缺失 |
| 极氪汽车 | 车企 | geely/98147 | 无岗 |
| 药明生物 | 医药 | wuxibiologics/94664 | 无岗 |
| 万泰生物 | 医药 | ystwt/97881 | 无岗 |
| 大疆创新 | 消费电子 | dji/170070 | init-data 缺失 |
| 中兴通讯 | 消费电子 | zte/47588 | init-data 缺失 |
| 逸仙电商 | 美妆 | su/esoqmb（短链） | 需解析 org/siteId |
| 富国基金 | 基金 | su/idpzbj（短链） | 需解析 org/siteId |

## 五、feishu host 失效（需重新搜 host）

| 公司 | 行业 | 当前（失效） |
|---|---|---|
| 元气森林 | 食品 | k11pnjpvz1.jobs.feishu.cn |
| 丽珠集团 | 医药 | j0eukrlohu.jobs.feishu.cn |
| 安克创新 | 消费电子 | anker-in.jobs.feishu.cn |
| 海信 | 家电 | hisense.jobs.feishu.cn |
| 龙旗科技 | 消费电子 | longcheer.jobs.feishu.cn |

## 六、其他（zhiye 无岗，可能停招或 subdomain 错）

| 公司 | 行业 | 线索 |
|---|---|---|
| 新希望集团 | 农业 | zhiye `newhope` 无岗 |
| 闻泰科技 | 消费电子 | zhiye `wingtech` 无岗 |
| 心动网络 | 游戏 | moka xd/99361 无岗 |
| 叠纸游戏 | 游戏 | moka papergames 无岗 |

---

## 下次收的优先级建议

1. **低难度**（重搜域名即可）：三、五里的 zhiye/feishu subdomain 猜错的（三峡/华润/中通/能建/石药）→ WebSearch 重搜正确 subdomain
2. **中难度**（重搜 moka org/siteId）：四里 init-data 失效的 → WebSearch 重搜正确 siteId
3. **高难度**（chinahr HAR 逆向）：三里的 hotjob.cn → 用 `batch_har.js` 抓 HAR 识别真实系统
4. **等待**：一里的校招未开 → 9 月校招季开启后直接复用现有 subdomain/suiteId

---

## 七、第三方招聘平台：合规边界（2026-08-31 调研 + HAR 实测定论）

> 智联、无忧、中华英才网的「校招门户」都有**验证码/登录态门槛**，绕过就是「绕过访问控制」，违反《网络安全法》《数据安全法》，**放弃**。正确目标永远是「公司自有 ATS」（zhiye/moka/飞书/tupu360/北森 Wecruit）——这些是公司官网给求职者看的公开只读接口。

| 平台 | 岗位数据门槛 | 结论 |
|---|---|---|
| 智联 zhaopin.com | 极验验证码 + token | ⛔ 放弃 |
| 无忧 51job.com 校招门户 | 手机验证码（`applystatus.ashx?sendType=getdatabyverifymobile`） | ⛔ 放弃 |
| 中华英才网 chinahr | SSR + operational 加密（`/wt/xxx/web/`） | ⚠️ 可逆但成本高 |

- 注：掘金文章「无忧反爬较少」指**社招主站**，非校招门户；校招门户因网申防刷需手机验证。
- 「买数据」方案（Apify Zhaopin Scraper $1.12/千条、TheirStack $59/月）都是社招数据、无校招，不适合。

## 八、真自研央企 / 家电 / 外企自研（长期任务，逐个 HAR 逆向）

> 这些是「真自研招聘系统」（HTML 无 bstatics/mokahr 痕迹），需逐个 HAR 抓接口、判断加密、写适配器。**单个几十分钟到几小时**，按战略价值排序逐个做，不适合一次做完。

| 类别 | 公司（域名） |
|---|---|
| 央企自研 | 国家电网 zhaopin.sgcc.com.cn、南方电网 zhaopin.csg.cn、中石油 zhaopin.cnpc.com.cn、中石化 job.sinopec.com、中国移动 job.10086.cn（有 encrypt）、中国电信 job.chinatelecom.com.cn、中国邮政 zhaopin.chinapost.com.cn、中国电建 zhaopin.powerchina.cn、中国国新 zp.crhc.cn、航天科技 spacetalent.com.cn、中国核电 hr.cnnc.com.cn、华电 rencaishichang.chd.com.cn、中国铁路/中铁 rczp.china-railway.com.cn、中国黄金 hjzp.chinagoldgroup.com、中国建材 hr.cnbm.com.cn、中国电科 ai-hr.cetc.com.cn、中国电子 campus.cec.com.cn、中航工业 avic.com.cn、中国商飞 zhaopin.comac.cc、国家电投 zhaopin.spic.com.cn、华能 zhaopin.chng.com.cn、大唐 zhaopin.china-cdt.com |
| 家电自研 | 美的 careers.midea.com、海尔 maker.haier.net、格力 m-zhaopin.greeyun.com |
| 汽车/软件自研 | 一汽 zhaopin.faw.com.cn、福耀 job.fuyaogroup.com、金山办公 join.wps.cn、用友 career.yonyou.com、深信服 hr.sangfor.com（有 sign）、中兴 job.zte.com.cn |
| 外企自研 | 苹果/微软/英特尔/特斯拉/宝洁/联合利华/强生/雀巢/玛氏/欧莱雅/IBM/SAP/罗氏/达能/耐克（多为国际 ATS：Workday/SuccessFactors，成本最高） |

- **逆向方法**：`har_capture_cdp.js` 抓 Network → 找岗位列表接口 → 判断纯 HTTP vs 加密/签名 → 纯 HTTP 写适配器，加密/签名暂缓。
- **优先顺序**：先「纯 HTTP 能逆」的（curl 首页 grep `api/`/`position`/`list` 能看出线索），加密的（移动 encrypt、深信服 sign）暂缓。

## 九、国际 ATS 外企（公开 JSON API，高价值，2026-08-31 实测突破）

> 外企的「自研」招聘系统，其实很多是国际 ATS，且有公开 JSON API（比国内真自研好逆得多）。workday.js 已写。

| 外企 | ATS | 状态 |
|---|---|---|
| 英特尔 | Workday（intel.wd1, site=External） | ✅ 已加 607 岗 |
| 丰田 | Workday（toyota.wd503, site 待查） | ⚠️ siteId 不是 External，404 |
| 耐克 | Workday（nike.wd1 404）+ Avature（niketalentcommunity） | ⚠️ tenant/site 待查 |
| SAP | SmartRecruiters + SuccessFactors | 待逆 SmartRecruiters（公开 API `api.smartrecruiters.com/v1/companies/{token}/postings`）|
| 微软 | Eightfold | 待探测 |
| AMD | iCIMS | 待探测 |
| 达能/百事/欧莱雅 | Avature | 待探测 |

- **Workday**：适配器已写 `workday.js`，接口 `POST {tenant}.{dc}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs`（dc 默认 wd1，site 默认 External）。丰田 dc=wd503 site 待查、耐克 tenant 待查。
- **SmartRecruiters**：公开 API，待写适配器。
- **Avature/Eightfold/iCIMS**：待 curl 探测接口（grep `api/`/`avature`/`eightfold`）。

## 十、知识库未开发线索（发散测试待办）

| 线索 | 来源（知识库） | 价值 | 测试方向 |
|---|---|---|---|
| SSR hydration 提取 | nuxt-data-parser / NEXT_DATA 文章 | 真自研央企可能用 Next.js/Nuxt，岗位数据 SSR 在 `__NEXT_DATA__`/`__NUXT__` 里，不用逆接口 | curl 国家电网/中石油首页 grep `__NEXT_DATA__`/`__NUXT__` |
| API 自动发现 | ApiGen/Unbrowse/ExecEndpoints | 自动发现「真自研」接口 | 测试 ApiGen 抓流量生成 OpenAPI |
| Greenhouse/Lever/Ashby | Six ATS open JSON 文章 | 海外 ATS 公开 API，找用它们的中国外企 | 搜中国外企用 Greenhouse/Lever |
| 投递自动化业界方案 | Auto-JobHunter/boss-watch-agent | 参考 BOSS/猎聘抓取 + RPA 投递 | 评估（BOSS/猎聘是求职平台，合规边界同智联）|

## 十一、产品功能升级待办（2026-08-31 知识库发散收获）

> 从 Auto-JobHunter 发散出的「产品功能」升级方向，与「抓取/扩展」是两条线，指向求职星的质量上限。

1. **简历定制升级**：`llmTailorResume` 从单次 LLM 调用 → 多阶段 agent（Splitter→Architect→Critic→Formatter + 80 分放行），质量提升明显
2. **判定报告升级**：4 匹配点 → 加「致命硬伤」反向下钻（硬规则一票否决 + LLM 深度体检「高杠杆匹配点/致命硬伤」）
3. **不采用**：RPA 静默投递（自动登录/投递有风控风险，坚持手动兜底）

## 十二、算法/成本优化升级路线图（2026-08-31 算法模型 + 产品环节发散收获）

> 对标业界前沿（ConFit v3、LLM 语义字段匹配、prompt caching 等），按性价比排序的升级方向。

**算法层**：
1. ~~判定 listwise re-ranking~~（**不适用**：judgeJobs 已批量判定，ConFit v3 的 listwise RL 需训练数据，不适合小规模）
2. ✅ **简历解析实体规范化**（已做：`resume_parse.js` normalizeEntities，PROFILE_VERSION v5）
3. ✅ **Cross-Encoder 精排**（已做：`reranker.js` 早就是 bge-reranker-v2-m3 交叉编码器，此条过时）

**产品层**：
4. ✅ **autofill LLM 语义字段匹配**（已做：`collectUnmatched` + `/api/autofill/map-fields` + `applyMapping`，AI 只给映射不给值）
5. ✅ **简历定制多阶段**（已做：`tailorOnce` Architect → `criticTailor` Critic → 80 分放行打回）
6. ✅ **判定报告「致命硬伤」**（已做：`scorer.js` scanRedFlags 毒点扫描 + 硬毒点降档）

**成本层**：
7. ~~Prompt caching~~（**不适用**：DeepSeek 自动缓存相同前缀，无需实现，保持 prompt 结构稳定即可）
8. ~~模型路由~~（**不适用**：deepseek-chat 已是最便宜的非推理模型，「硬过滤 0 token」已是路由雏形）
9. ~~Batch API~~（**不适用**：判定是实时，不适合离线 batch）

**已验证正确（不改）**：内容过滤（冷启动正确）、Human-in-the-Loop（人工兜底）、硬过滤 0 token、embedding→reranker→LLM 三段式

## 十三、投递状态跟踪（邮件解析，✅ 已实现 2026-09-02）

> 核心洞察：**不用登录数百家招聘系统**——企业通知主要走邮件，一套邮箱解析覆盖所有公司，零逆袭成本。已完整落地 `tracker/email.js` + `/api/email/sync`。

**已实现架构**（`tracker/email.js`）：
1. 邮箱接入：QQ/163 IMAP + 授权码（授权码生成一次长期有效，前端本地 chrome.storage 记住，不上传服务器）
2. 邮件拉取：imapflow + **mailparser（simpleParser）**正确解析 MIME/中文/base64 附件（正文不含附件乱码）
3. 预过滤：`isJobCandidate` 强信号（面试/offer/拒信/测评）滤订阅/广告/验证码，省 LLM token
4. 状态识别：**统一 LLM 结构化提取**（status + 公司 + 职位 + 面试时间，公司名中文优先），并发 5 路（mapLimit）+ 单封容错
5. 匹配：`resolveMatch` 两级匹配（公司 blocking → 岗位归一化 `normalizeTitle` + embedding 语义打分）→ 三档置信度（high 自动确认 / medium 候选人工点选 / none orphan 不静默链接）；messageId 去重
6. 增量同步：lastSync 持久化 `data/email-sync.json`（日期粒度 + 往回拨 1 天，避开 IMAP WITHIN「YOUNGER 小秒数」边界 BAD）
7. 隐私：授权码本地存储不上传，邮件只存元数据不存正文

**同公司多岗位区分**（用户痛点）：投同一公司多个岗位时，只用公司名会匹配错岗（break 遇第一个同公司就停）。方案 = 岗位名归一化（去「实习生/工程师/专员/岗」等通用前后缀）+ embedding 余弦相似 + 三档置信度分层，不静默猜。

**暂缓**：短信解析（合规隐私问题大，用户明确暂缓）。

## 十四、聚合平台（校招聚合：官方可抓 vs 商业反爬）

> 关键认知（2026-09-01 发散突破）：区分「公开可抓」和「反爬」，不是看「是不是招聘网站」，而是看「**官方 vs 商业**」。

**公开可抓（已突破）**：
- **国聘网**（iguopin.com）：央国企校招官方聚合。`POST gp-api.iguopin.com/api/jobs/v1/recom-job`，nature 校招=`115xW5oQ`/社招=`113Fc6wc`/实习=`11bTac9`，列表直接带完整 JD。已写 `iguopin.js` 适配器（支持 `allCities` 按省枚举）。
  - ⚠️ **注意：`recom-job` 是「推荐接口」，不是「全量搜索」**——单次上限 400（热门岗位，翻页钳制到 20 页）。按省枚举（allCities）去重后约 393 岗 / 59 城市，本质仍是「推荐热门」。
  - **全量搜索需登录态**：关键词搜索参数是 `search.keyword`，但未登录（无 cookie）返回 total:0。登录国聘网属「登录态」，合规边界同智联/无忧。**待解决**：找国聘网的公开全量搜索接口，或接受 400 热门岗位（对校招用户，热门岗位恰是最相关的）。

**商业平台反爬（放弃，合规边界）**：
- Boss 直聘：`code 37 环境异常` + 设备指纹 seed
- 智联：返回空（反爬）
- 无忧：阿里云 WAF
- 猎聘/拉勾：招聘平台，同类
- **应届生求职网**（yingjiesheng.com）：`youngapi.yingjiesheng.com/open/noauth/job/...` 接口叫 noauth 但返回 `110011 鉴权失败，签名错误`（需 timestamp+api_key+sign 签名）
- **牛客网/实习僧**：岗位接口未抓到（热榜/反爬）
- 教育部就业网：HTML 片段（SSR，待解析，价值待评估）

**渠道全景总结（2026-09-01 全面发散定论）**：
```
公开可抓：公司自有 ATS（286 家）+ 国聘网（央国企官方聚合，热门 400）
反爬/签名/登录（合规放弃）：商业平台（Boss/智联/无忧/猎聘/拉勾）+ 聚合网站（应届生/牛客/实习僧）+ 真自研央企（加密自研系统）
待解析：教育部就业网（HTML 片段）
```
核心规律：**「公开可抓」= 公司官网给求职者看的 ATS + 官方免费聚合（国聘网）；其余「商业平台/聚合网站」都有签名/反爬保护数据资产，属合规边界不该碰。**

**意义**：真自研央企（国家电网/中石油/三大运营商）的自研系统是加密/签名，但它们的子公司校招岗位在国聘网公开可抓——一套 API 覆盖央国企校招，不用逐个逆自研。
