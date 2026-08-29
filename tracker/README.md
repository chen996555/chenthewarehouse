# 求职星计划 · 投递看板（阶段 1）

轻量级投递状态看板：记录投递、流转状态、回溯历史。零依赖（Node 内置 `node:http` + `node:sqlite`），无需 `npm install`。

## 运行

```bash
cd job-star/tracker
node server.js
# 打开 http://localhost:8630
```

## 功能

- **看板**：六列状态 `待投 → 已投 → 有回复 → 面试 → Offer → 拒信`，拖拽卡片即可流转状态。
- **新建/编辑**：公司、岗位、渠道、城市、薪资、岗位链接、跟进提醒日期、备注。
- **审计日志**：每次状态流转写入 `history` 表，右侧「最近动态」可回溯。
- **漏斗统计**：总计 / 已投 / 回复率。
- **跟进提醒**：卡片上显示跟进日期，过期高亮红色。

## 数据模型（沿用 BossHunter 范式）

- `applications`：一条投递记录（含 `status`、`follow_up_date` 等）。
- `history`：状态流转审计日志（`application_id + action + detail`），外键级联删除。
- SQLite 文件：`data/tracker.db`（WAL 模式），重启后数据仍在。

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/meta` | 状态机定义、渠道列表 |
| GET | `/api/applications` | 全部投递记录 |
| POST | `/api/applications` | 新建 |
| GET/PATCH/DELETE | `/api/applications/:id` | 查 / 改（改 status 会写历史）/ 删 |
| GET | `/api/applications/:id/history` | 单条记录的流转历史 |
| GET | `/api/stats` | 漏斗统计 |
| GET | `/api/activity` | 最近动态 |

## 下一步（阶段 2：关键词找岗位）

将「找岗位」的结果落到看板「待投」列，即可无缝衔接。
