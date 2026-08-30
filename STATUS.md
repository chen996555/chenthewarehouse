# 投递状态同步 — 家族索引与方法论

> **方向（2026-08-29 定）**：投递状态**手动标记为主**——「去投递」锚定（点按钮自动 pending→applied + 记 applied_at）+ 看板拖拽换列手动流转。自动同步降级为「已逆几家的可选增强」，不再大规模逆向各家接口（登录态+验证码+加密，维护成本过高）。

> 与 `FAMILIES.md`（搜索/岗位抓取家族）平行的第二条线：**投递记录/状态的逆向**。
> 投递动作的自动填充（字段检测/匹配/React 写值）见 `AUTOFILL.md`。
> 核心认知：投递状态接口**同样分家族**，且与搜索家族一致（同一 ATS 既管搜索也管投递）。

## 一、核心认知

1. **投递记录接口分家族**：Moka 的投递查询接口 `/api/deliver-query` 是通用标准（大疆 `apply.careers.dji.com` 只是 Moka 定制域名，接口 + 前端资源 `static-ats.mokahr.com` 全是 Moka 通用），`orgId` 区分租户，覆盖全部 Moka 客户。
2. **鉴权分两类**：
   - **登录态自动**：京东/腾讯 —— puppeteer 复用 cookie → `fetch` 投递记录接口 → 解密/明文 → 更新 db。可全自动定时同步。
   - **验证码半自动**：大疆 —— 短信验证码 + 易盾行为验证，每次查询都要新验证码，无法持久。落地 = 用户浏览器过验证 → 导出 HAR → 脚本解析。
3. **逆向优先用 HAR**：HAR 一次导出 = 接口 + 密文 + 前端 JS（含 key/算法），一条龙。京东教训已记入 CLAUDE.md。

## 二、投递状态家族表

| 家族 | 投递记录接口 | 鉴权 | 状态 | 覆盖租户数 |
|---|---|---|---|---|
| Moka | `POST {base}/api/deliver-query`（orgId + 短信 code + 易盾 YDValidate）| 验证码 | ✅ 已逆 `status_dji.js` | 42 |
| 京东（自研）| `GET /api/wx/delivery/officialInfo/list`（AES-256-CBC，key=`63ca0d3f90f844928d236e132a1fee45`）| cookie 登录态 | ✅ 已逆 `status_jd.js` | 1 |
| 腾讯（自研）| `GET /api/v1/apply/getApplyProcess`（明文）| cookie 登录态 | ✅ 已逆 `status_tx.js`（状态映射待精确化）| 1 |
| 飞书 ATSX | 待探（`/api/v1/...` application）| 登录态 | ⏳ 待逆 | 14（字节/小米/商汤/得物…）|
| 北森 iTalent（zhiye）| 待探 | 登录态 | ⏳ 待逆 | 67 |
| 北森 Wecruit | 待探 | 登录态 | ⏳ 待逆 | 10 |
| 用友大易（hotjob）| 待探 | 登录态 | ⏳ 待逆 | 4 |
| 自研大厂（其余 18 家）| 各异 | 各异 | ⏳ 待逆 | 18（阿里/美团/华为/拼多多/快手/小红书/网易/百度/蚂蚁/OPPO/vivo/米哈游/携程/顺丰/理想/比亚迪/平安…）|

## 三、统一状态机（各家族映射目标，与 db.js STATUSES 对齐）

```
pending   待投
applied   已投（在流程中：筛选/评估/人才库）
replied   有回复（测评/笔试/AI面试环节）
interview 面试
offer     Offer/入职
rejected  拒信/淘汰/暂不考虑
```

各家族字段 → 标准状态映射（都落到上述 6 态，非法值会被 sanitize 兜底回 pending）：
- 京东：`statusCode`（ASSESSMENT/EXAM/AI_INTERVIEW→replied，STAGE_1→interview，OFFER/ENTRY→offer，HIGH_SEAS_POOL→applied）+ `applyStatus=NOT_CONSIDER`→rejected
- 大疆：`stage` 中文（含"面试"→interview，含"Offer/录用"→offer，含"淘汰/结束"→rejected，含"笔试/测评"→replied，其他→applied）
- 腾讯：`currentStatus.status` / `assessmentInfo.status` / `writtenTestInfo.status`（枚举含义待精确化，目前全映射 applied）

## 四、落地文件

| 文件 | 作用 |
|---|---|
| `status_jd.js` | 京东：puppeteer 登录态 fetch + AES 解密 + statusCode 映射（全自动）|
| `status_tx.js` | 腾讯：puppeteer 登录态 fetch + getApplyProcess 明文（全自动）|
| `status_dji.js` | 大疆/Moka：HAR 解析 `deliver-query` 明文响应（半自动）|
| `har_parser.js` | 通用 HAR 解析器：自动分类 search/detail/apply/resume/auth/limit 接口 |

## 五、推进方式（关键约束）

**投递记录接口都依赖求职者登录态，无法像搜索那样纯 HTTP 自动探测。** 推进 = 「家族代表 + HAR」：

1. **已逆家族**：Moka（大疆 HAR）覆盖 42 家，无需再操作。
2. **待逆家族**：每个家族用户登录**一个代表**求职后台 → 导出 HAR → 逆向接口 → 覆盖整个家族。
   - 飞书 ATSX：字节 `jobs.bytedance.com` 我的投递
   - 北森 iTalent：任一 `xxx.zhiye.com` 我的投递
   - 北森 Wecruit：任一 `wecruit.hotjob.cn/SUxxx` 我的投递
   - 用友大易：任一 hotjob 客户我的投递
3. **自研大厂**：逐个，用户登录 + HAR（18 家，按用户实际投递优先级排序）。

## 六、待精确化

- 腾讯 `mapTxStatus` 目前全映射 `applied`，`currentStatus.status` 等枚举含义待多观察后精确化。
- 大疆 `deliver-query` 是否 Moka 全家族通用需再验证（已确认前端资源为 Moka 通用，接口路径标准，可信度高）。
