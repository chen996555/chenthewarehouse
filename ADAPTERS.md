# 求职星计划 — 适配器与维护手册

> 核心流程：**简历画像 → 关键词搜索 → 精排打分 → 导入看板**。
> 本文档是维护/二开指南：16 类招聘系统适配器的接口与搜索字段对照、稳定性机制、以及官方改版后的排查 SOP。

---

## 一、系统架构（四层）

```
profile.json（简历画像）
   └─ portrait.js  → search_portrait.keywords（15 个关键词 + 5 个方向）
        │
        ▼
scan.js（分层搜索）
   └─ 对支持关键词的适配器：画像关键词逐个搜 → 合并去重
   └─ 不支持搜索的适配器：全量抓 + reranker 筛
        │
        ▼
scorer.js（精排）
   └─ 硬过滤 → reranker 语义排序 → LLM 精排(0-2分) → 分档 A/B/C/D
        │
        ▼
db.js（看板）
   └─ A+B 档自动导入「待投」
```

关键文件：
- `tracker/scan.js` — 一键扫描 + 分层搜索调度（`scrapeCompany` 分发、`KEYWORD_ADAPTERS`）
- `tracker/companies.js` — 公司注册表（adapter + 抓取参数）
- `tracker/health.js` — 健康基线（扫描对比告警）
- `tracker/smoke.js` — 冒烟自检（主动体检）
- `tracker/scorer.js` / `reranker.js` — 精排与语义重排

---

## 二、适配器对照表（16 类）

抓取方式分四种，按「官方改版时的脆弱性」从高到低：

| 抓取方式 | 依赖什么 | 失效点 |
|---|---|---|
| DOM 抓取 | CSS class、DOM 结构、文本格式 | 前端改版 |
| 纯 HTTP 接口 | URL + 请求/响应字段名 | 字段改名、接口迁移 |
| 页面上下文 fetch | 接口字段 + 页面认证 cookie | 认证升级 |
| 浏览器拦截响应 | 接口 URL + 响应字段 | 响应字段改名（签名自动跟页面走）|

### 对照表

| 适配器 | 覆盖公司 | 接口 | 搜索字段 | 认证 | 抓取方式 |
|---|---|---|---|---|---|
| `zhiye` | 科大讯飞/360/爱奇艺 + 金融/央企/医药 20+ 家 | `POST {sub}.zhiye.com/api/Jobad/GetJobAdPageList` | `KeyWords` | 无 | 纯 HTTP + 分页；旧版门户回退 DOM |
| `byte` | 字节/小米/商汤/得物 | `POST {base}/api/v1/search/job/posts` | 搜索框（无字段名）| `_signature` | 浏览器拦截响应 + 触发搜索框 |
| `hotjob` | 荣耀/南方基金/广发证券/华泰证券 | `POST {base}/wecruit/positionInfo/listPosition/{suiteId}` | `postName` | `iSaJAx`+cookie | 页面上下文 fetch |
| `moka` | 滴滴/大疆/唯品会/新浪微博/搜狐 | `website/jobs/v2`（**响应加密**）| hash 路由 `keyword` | 加密 | DOM 抓取 + hash 路由 |
| `jd` | 京东 | `POST campus.jd.com/api/wx/position/page` | `positionName` | 无 | 纯 HTTP |
| `mt` | 美团 | `POST zhaopin.meituan.com/api/official/job/getJobList` | `keywords` | 无 | 纯 HTTP |
| `tx` | 腾讯 | `POST join.qq.com/api/v1/position/searchPosition` | `keyword` | 无 | 纯 HTTP |
| `ali` | 阿里 | `POST campus-talent.alibaba.com/position/search?_csrf` | `key` | csrf | 纯 HTTP |
| `pdd` | 拼多多 | `POST careers.pddglobalhr.com/api/careers/api/recruit/position/list` | 无（全量）| 无 | 纯 HTTP |
| `ks` | 快手 | `POST campus.kuaishou.cn/recruit/campus/e/api/v1/open/positions/simple` | `name` | 无 | 纯 HTTP |
| `xhs` | 小红书 | `POST job.xiaohongshu.com/websiterecruit/position/pageQueryPosition` | `positionName` | 无 | 纯 HTTP |
| `bili` | 哔哩哔哩 | `POST jobs.bilibili.com/api/campus/position/positionList` | `positionName` | `x-csrf` | 页面 fetch；认证失败回退 DOM |
| `ant` | 蚂蚁 | `POST hrcareersweb.antgroup.com/api/campus/position/search?ctoken` | `key` | `ctoken` | 页面上下文 fetch |
| `mhy` | 米哈游 | `POST ats.openout.mihoyo.com/ats-portal/v1/job/list` | `jobName` | 无 | 纯 HTTP |
| `ctrip` | 携程 | `POST job.ctrip.com/api/hrrecruit/getJobAd` | `condition.keyword` | 无 | 纯 HTTP |
| `ne` | 网易 | `GET campus.163.com/api/campuspc/position/getJobList` | 无（全量）| 无 | 纯 HTTP |

> ⚠️ 注意：同一 ATS 的不同公司参数可能不同。例如 byte 适配器下，字节 `portal_type=3`、得物 `portal_type=6`；hotjob 下荣耀 `base=career.honor.com`、券商 `base=wecruit.hotjob.cn`。加新公司时先抓包确认参数。

---

## 三、分层搜索机制

`scan.js` 里两个关键配置：

```js
const KEYWORD_ADAPTERS = new Set(['jd','mt','tx','byte','ali','ks','xhs','zhiye','mhy','hotjob','ant','bili','ctrip','moka']);
const KEYWORD_COUNT = { byte: 1, hotjob: 2, ant: 2, bili: 2, moka: 2 };
```

- **`KEYWORD_ADAPTERS`**：支持关键词搜索的适配器。不在集合里的（pdd/ne）走全量抓 + reranker 筛。
- **`KEYWORD_COUNT`**：浏览器型适配器单次慢，限制只搜前 N 个关键词（如 byte 只搜「采购」）。

关键词来源：`profile.json → job_search.search_portrait.keywords`（画像生成，可替换）。

```js
const WIDE_KEYWORDS = new Set(['运营', '数据分析', 'AI产品运营']); // 宽泛词单独搜会稀释精度，过滤
```

**多关键词合并逻辑**（`scrapeOne`）：
1. 对每个关键词调 `scrapeCompany` 搜索，按 `id`/`title` 去重合并
2. 命中（>0）则返回；全部 0 则回退全量抓
3. 单个关键词失败不阻断，继续下一个

---

## 四、稳定性机制（五层）

| 层 | 机制 | 文件 | 作用 |
|---|---|---|---|
| 预防 | total 字段候选链 | 各适配器 `total ?? totalCount ?? count` | 字段微调不立即失效 |
| 降级 | 接口→DOM 回退 | `zhiye.js`、`bili.js` | 接口/认证升级时降级抓 DOM |
| 检测(主动) | 冒烟自检 | `smoke.js` | `node smoke.js` 快速体检，抓 5 个验证存活 |
| 检测(对比) | 健康基线 | `health.js` | 每次扫描对比上次，暴增/骤降/归零告警 |
| 隔离 | per-adapter catch | `scan.js` | 单家失效不阻断整体 |

### 冒烟自检

```bash
node smoke.js
```

三态结果：`✓ 存活` / `○ 空（0岗位，疑似）` / `✗ 失效（报错）`。

### 健康基线

扫描自动对比上次 `data/scan-health.json`，输出「健康告警」：
- `✗ 失效`：适配器报错
- `⚠ 疑似`：岗位数归零 / 暴增(>2x) / 骤降(<50%)，绝对差 ≥5 才报（避免小数字波动误报）

---

## 五、扩展新适配器

1. **抓包确认接口**：浏览器 DevTools → Network → 搜索框搜一个词 → 看请求 URL + body 里的搜索字段名 + 响应里的岗位字段名。
2. **写 `tracker/xxx.js`**：复制一个同类型适配器改（纯 HTTP 复制 `jd.js`、页面 fetch 复制 `ant.js`、DOM 抓取复制 `moka.js`）。导出 `scrapeXxx` + `xxxToApplication`。
3. **登记公司**：`companies.js` 加一条 `{ group, name, adapter: 'xxx', ...参数 }`。
4. **接入调度**：`scan.js` 的 `scrapeCompany` 加一个 `case`，支持关键词的加入 `KEYWORD_ADAPTERS`。
5. **验证**：`node smoke.js` 看新适配器是否存活，再单独跑一次 `scrapeXxx` 确认字段映射正确。

---

## 六、官方改版排查 SOP

**症状 → 排查 → 修复**：

1. **看 `node smoke.js`**：直接告诉你哪家 `✗` 失效或 `○` 空。
2. **抓包对比**：DevTools 打开该站岗位页，搜一个词，对比真实请求和适配器代码里的接口 URL / 搜索字段 / 响应字段。
3. **常见失效与修法**：

| 失效表现 | 可能原因 | 修法 |
|---|---|---|
| 岗位数暴增（关键词失效返回全量）| 搜索字段改名 | 改适配器 body 里的字段名 |
| 岗位数归零 | 接口 URL 迁移 / 认证升级 | 抓包找新接口 / 新认证 |
| 抛错 | 站点迁移 / 反爬 | 更新 `companies.js` 参数，或加降级路径 |
| 返回 0 但页面有岗 | 响应字段改名 | 改 `mapXxxJob` 的字段映射 |

4. **总原则**：先跑 `smoke.js` 定位 → 抓包拿真实字段 → 改适配器字段名/接口 → 加候选链或降级路径 → 重新 `smoke` 验证。

---

## 附：已知限制

- **爱奇艺**：校招当前 0 岗（未开放），职位类型含「采购」，秋招开放后自动有岗，非 bug。
- **moka**：API 响应加密，只能 DOM 抓取（无完整 JD，只有标题+部门+链接）。
- **拼多多/网易**：校招岗位本就少（13/73），无搜索字段，全量抓即可。
