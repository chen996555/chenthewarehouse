# 求职星计划 — 可借鉴设计笔记（阶段 0 沉淀）

> 底座：`job-star/job-hunter`（MIT，官网直达 + 五列看板 + 公司库，已跑通 `npm start` → http://localhost:8621）
> 范式参考：`job-star/BossHunter`（Non-Commercial，只学设计不拷代码）
> 本文件记录从 BossHunter 摘出的、可直接复用到「求职星计划」三模块的工程范式。

---

## 1. 投递状态机（对应「记录投递状态」模块）

来源：[src/bosshunter/tracker/status.py](BossHunter/src/bosshunter/tracker/status.py) + [src/bosshunter/db.py](BossHunter/src/bosshunter/db.py)

- **14 态状态机**：`pending → scored → (filtered | ready) → (approved | skipped) → sent → replied → resume_sent → needs_resume → follow_up_sent | rejected | error`
- **审计日志**：`history` 表记录每一次状态流转（`job_id, action, detail, created_at`），状态可回溯、可算漏斗。
- **软删除 + 删除保护**：`deleted_at` 软删除进回收站；`sent/replied/resume_sent` 等终态**禁止删除**（`DELETION_PROTECTED_STATUSES`），防止误删已投记录。
- **去重唯一索引**：`UNIQUE INDEX ON (source_platform, source_job_id)`，跨平台来源身份去重。
- 求职星计划复用点：把「待投→已投→有回复→面试→Offer→拒信」建成同样的 `status + history` 两表结构，天然支持漏斗统计和「定期记录状态」。

## 2. 两阶段评分（对应「关键词找岗位」的匹配打分）

来源：[src/bosshunter/ai/prefilter.py](BossHunter/src/bosshunter/ai/prefilter.py) + [src/bosshunter/ai/scorer.py](BossHunter/src/bosshunter/ai/scorer.py)

- **第一阶段 quick_score（确定性硬过滤，0 成本）**：公司屏蔽词 / 匿名公司 / 岗位排除词 / JD 排除词 / 实习管培岗位 / 薪资下限，命中即 0 分淘汰，**不调用 LLM**。
- **第二阶段 AI 深评分（结构化 5 维）**：
  - 核心职责匹配 40 + 可迁移证据 25 + 硬性要求 15 + 工具行业 10 + 实际条件 10 = 100
  - **封顶规则 caps**（如硬技术缺口封顶 55），防止「看起来不错但硬门槛不满足」虚高。
  - **独立二次复核**：68-79 分区间触发第二次独立评分取均值，压低边界分误差。
  - 强制结构化 JSON 输出 + 逐项整数校验，不合法即重试，最多 N 次。
- 求职星计划复用点：先做一层**免费的关键词硬过滤**（节省 AI 调用），再做**结构化多维打分**，比 JobOK 现有的纯 token 重合度脚本（`score_job_matches.py`）质量高得多。

## 3. 反爬风控（对应「半自动投递」的安全层）

来源：[src/bosshunter/throttle.py](BossHunter/src/bosshunter/throttle.py) + [src/bosshunter/platform_safety.py](BossHunter/src/bosshunter/platform_safety.py)

- **高斯随机延迟**（`RequestThrottle`）：均值 60-180s，`random.gauss` 抖动 + 5% 概率额外停顿 2-5s，模拟人类节奏。
- **突发惩罚**（`_burst_penalty`）：15s 内 ≥3 次 / 45s 内 ≥6 次追加延迟。
- **发送时间窗**（`SendWindowChecker`）：只在配置时间段（如 09:00-12:00）内投递。
- **渐进退避**（`ProgressiveBackoff`）：连续 3 次失败暂停 30 分钟。
- **随机休息日**（`should_take_day_off`）：5% 概率整天不操作，反行为模式检测。
- **每日页面预算 + 持久安全锁**（`PlatformAccessGuard` + `platform_safety_state` 表）：每日打开招聘页次数上限，超限抛 `PlatformSafetyStop`；触发风险即持久锁 10 分钟，**跨进程重启仍生效**。
- 求职星计划复用点：半自动投递也必须套这一层——低频、时间窗、预算、锁，否则官网账号照样会被风控。

## 4. 断点续跑与数据模型（工程骨架）

来源：[src/bosshunter/db.py](BossHunter/src/bosshunter/db.py)

- **SQLite + WAL**，五张核心表：`jobs / history / risk_events / platform_access_events / platform_safety_state`。
- **任务表断点续跑**：`scoring_runs` / `collection_runs` 存 `remaining_job_ids_json`，中断后下次继续处理剩余，不重跑已完成。
- **版本化迁移**：`_migrate_v1_1 ~ v1_4`，`ALTER TABLE ADD COLUMN` + 惰性回填，不重建表。
- 求职星计划复用点：`jobs(状态) + history(审计) + 任务表(断点续跑)` 三件套是「记录 + 找岗位 + 投递」三模块共用的数据骨架。

## 5. 安全边界（合规红线）

来源：BossHunter/CLAUDE.md + README

- 所有投递**必须人工确认**，不可跳过；仅个人求职自用；首次使用必须提示封号风险；不读取其他工具（Codex/Claude Code 等）的凭证/OAuth/Cookie。
- 招聘平台（智联/51job）自动发送**默认锁定**，只提供原平台链接 + 手动「已发送」回填。

---

## 阶段 0 完成清单

- [x] 环境：node v24 / npm 11 / python 3.14（**无 git**，仓库用 ZIP 下载）
- [x] job-hunter 已下载并跑通（HTTP 200，Edge 驱动自动检测）
- [x] BossHunter 已下载，核心文件已通读（状态机/评分/风控/数据模型/安全边界）
- [x] 可借鉴设计已摘出（本文件）

## 6. 集成契约（各阶段连接点，改看板前必读）

三阶段共享的稳定契约只有三样，其余（前端三件套、REST 路由）都可随时重写：

1. **`applications` 表**（`tracker/db.js`）——数据契约。阶段 2 往里面灌 `status=pending` 的候选岗位，阶段 3 读 pending 用 `url` 投递。
2. **状态机 6 个 key**：`pending/applied/replied/interview/offer/rejected`。
3. **`db.js` 是唯一数据入口**：阶段 2/3 直接 `require('./db')` 读写，不依赖 HTTP 或前端。

字段流向（红线字段，勿改名）：

| 字段 | 产出 | 消费 | 说明 |
|---|---|---|---|
| `url` | 阶段2 | 阶段3 | ⭐ 投递引擎靠它打开官网投递页 |
| `channel` | 阶段2 | 阶段3 | 仅 `官网` 自动投，平台岗手动 |
| `status`+`history` | 全程 | 全程 | 状态主线 + 审计日志 |

后期新增字段（匹配分 / JD 原文 / 来源平台 / 简历版本）走 `ALTER TABLE` 加列，属追加、不破坏现有结构（范式见 BossHunter `db.py` 的 `_migrate_v1_1~v1_4`）。
