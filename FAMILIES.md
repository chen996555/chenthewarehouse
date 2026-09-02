# ATS 家族工厂 — 扩展索引与方法论

> 本文档是「扩展到数百家公司」的索引与模板。核心思想：**招聘 SaaS 市场就那几家，大厂自研功能结构统一**。掌握 5-7 个 SaaS 协议 + 逆向几十家大厂，即可覆盖数千家公司。
>
> 更通用的「定位 JSON API」方法论（决策树 / 难度阶梯 / 陷阱清单）见 [PROBING.md](PROBING.md)；自动识别工具 `tracker/detect-ats.js`。

## 一、核心思想（三层抽象）

所有招聘系统，无论 SaaS 还是自研，都在三层上统一：

| 层 | 统一程度 | 说明 |
|---|---|---|
| **功能契约** | 完全统一 | 搜索/列表/详情/筛选字典四件套（job-pro 用 8 verb 契约统一了 50 家） |
| **家族协议** | SaaS 内统一 | 同一 SaaS（Moka/飞书/北森）共享接口+字段+加密 |
| **字段映射** | 自研各异 | 大厂自研：功能同、字段名异，每个做映射 |

- **SaaS 公司**（数千家）：识别家族 → 加配置对象（~30 行），协议已封装在工厂里。
- **自研大厂**（几十家）：功能结构同，逆向「搜索/详情接口 + 字段名」，套模板做字段映射。

## 二、识别 ATS 家族 = 三层信号 + 接口指纹库

识别一家公司用哪套招聘系统，本质是「接口指纹匹配」，三层信号从快到准：

### 信号 1：URL 特征（一眼看出，~80% 命中）

| URL 特征 | 家族 |
|---|---|
| `xxx.zhiye.com` | 北森 iTalent |
| `mokahr.com` / `xxx.com/campus-recruitment` | Moka |
| `jobs.feishu.cn` / `jobs.f.mioffice.cn` | 飞书 ATSX |
| `wecruit.hotjob.cn` / `SUxxx` | 北森 Wecruit / 用友大易 |
| `greenhouse.io` / `lever.co` | Greenhouse / Lever |

### 信号 2：页面 HTML 特征（URL 看不出时，~15%）

- `<input id="init-data" value="...">` → Moka（SSR init-data，含 aesIv）
- `var BSGlobal = {...}` → 北森 zhiye（PortalId/tenantInfo）
- 入口 JS 搜 `baseURL` / `/api/` / `position` / `search` / `query` 定位接口

### 信号 3：接口指纹（抓一个搜索请求，最准）

| 接口指纹 | 家族 |
|---|---|
| `POST /api/v1/search/job/posts` + `portal-channel` header | 飞书 ATSX |
| `POST /api/outer/ats-apply/website/jobs/v2` + AES 加密响应 | Moka |
| `POST /api/Jobad/GetJobAdPageList` | 北森 zhiye |
| `POST /api/official/job/getJobList` | 美团（自研） |

**结论**：识别 = 抓一个搜索请求 → 对照指纹库。可做成程序自动匹配（输入 URL → 输出家族），无需人肉判断。

## 三、ATS 家族识别表（看 URL/页面特征 → 家族 → 工厂）

| 家族 | 识别特征 | 工厂 | 已覆盖租户 |
|---|---|---|---|
| Moka | `mokahr.com` / `xxx.com/campus-recruitment` | `tracker/moka.js`（纯 HTTP，v2+AES） | 滴滴/大疆/唯品会/新浪/搜狐 |
| 飞书 ATSX | `POST /api/v1/search/job/posts` + `portal-channel` header | `tracker/byte.js`（纯 HTTP） | 字节/小米/商汤/得物 |
| 北森 iTalent | `xxx.zhiye.com` | `tracker/zhiye.js` | 科大讯飞/360/爱奇艺 |
| 北森 Wecruit / 用友大易 | `wecruit` / `SUxxx` | `tracker/hotjob.js` | 荣耀/券商 |
| Greenhouse / Lever | `greenhouse.io` / `lever.co` | ❌ 缺（国际 SaaS，中文校招少） | 小鹏/文远/米哈游国际 |
| 自研 | 各异 | `jd/mt/tx/ali/ks/xhs/mhy/pdd/ne` | 腾讯/阿里/美团/京东/快手/小红书/拼多多/网易/米哈游 |

## 四、家族工厂配置模板（新增租户怎么填）

### Moka（`createAdapter` 思路，对应 `companies.js` 的 moka 配置）

```js
{ name: '月之暗面', adapter: 'moka',
  moka: { org: 'moonshot', siteId: '148506', base: 'https://app.mokahr.com', section: 'social' },
  url: 'https://app.mokahr.com/social-recruitment/moonshot/148506' }
```

关键：`org` = URL 里的 orgSlug，`siteId` = URL 数字，`base` = portal 域名。工厂自动做 init-data（aesIv）+ v2 接口 + keyword。

### 飞书 ATSX（`companies.js` 的 byte 配置）

```js
{ name: '月之暗面', adapter: 'byte',
  byte: { base: 'https://xxx.jobs.feishu.cn', campusPath: '/campus/' },
  reach: { type: 'direct', urlTemplate: 'https://xxx.jobs.feishu.cn/campus/position/{id}/detail' } }
```

关键：`campusPath` 第一个路径段 = portal-channel header 值（`/campus/`→campus、`/edu/`→edu、`/578078/position/`→578078）。

### 北森 iTalent（zhiye）

```js
{ name: 'vivo', adapter: 'zhiye', subdomain: 'vivo', path: 'campus/jobs' }
```

### 北森 Wecruit / 用友大易（hotjob / wecruit）

```js
{ name: 'xxx', adapter: 'wecruit', suiteId: 'SUxxxx', base: 'https://wecruit.hotjob.cn/SUxxxx/pb/index.html' }
```

- 搜索：`POST /wecruit/positionInfo/listPosition/{suiteId}`（纯 HTTP）
- 详情：`POST /wecruit/positionInfo/listPositionDetail/{suiteId}` body `postId=数字哈希`。**双 ID 坑：postCode 可读但会 404，详情必须用 postId**；展开式详情，无独立详情页

## 五、自研系统逆向模板（字段映射规律）

逆向一个大厂自研系统，套这个模板：

1. **搜索/列表接口**：F12 Network → 搜关键词 → 找 `POST /api/.../search|list` → 记字段名（keyword/limit/offset/page/pageSize）
2. **响应包装**：看 `code`（0 成功？还是 1 成功？美团 status===1）、`data` 里岗位列表字段名（job_post_list/positionList/list/jobs）
3. **详情接口**：点岗位 → 找 detail 接口 → 记 id 字段（长数字/uuid）
4. **校招区分**：找 recruitType/jobType/portal_type/seasonType 枚举
5. **分页**：page/pageSize 还是 offset/limit

产出 = 一个 `mapJob` 函数（上游字段 → 我们的统一 job 结构）+ 一个 `scrapeXxx` 函数（套分页模板）。

## 六、新增公司标准流程

1. **识别家族**：看官网 URL/页面特征 → 命中上表哪家工厂
2. **命中工厂**：`companies.js` 加一条配置对象（上表模板）+ `reach` 配置 → 完成
3. **自研**：按第四节逆向模板，套字段映射，加 `scrapeXxx` + `scan.js` switch 分支
4. **验证**：`node smoke.js` 或单独跑该公司的抓取，确认返回真实岗位
5. **健康基线**：首次抓取后自动落盘，后续骤降/失效会告警

## 七、扩展优先级

- **高价值**：目标公司（用户想去的）用 SaaS 的 → 加配置对象即可
- **低成本**：job-pro 已列出的 Moka/飞书租户（月之暗面/旷视/DeepSeek/NIO/爱奇艺等）→ 照它的清单批量加
- **高成本**：新自研大厂 → 逆向 + 字段映射
