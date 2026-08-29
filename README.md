# 求职星计划（Job Star）

个人求职自动化系统，把「翻官网找岗位 → 判断该不该投 → 投递」这一整套流程自动化、半自动化。

核心链路：**简历画像 → 关键词精准搜索 → 精排打分 → 看板「待投」→ 半自动投递**。零依赖（`node:http` + `node:sqlite` + `puppeteer-core`），本地运行。

## 能做什么

- **精准搜索**：用简历画像生成的关键词，精准抓取目标岗位，替代人工逐家翻官网
- **16 类招聘系统适配**：北森(zhiye) / 字节系(byte) / Moka / 京东 / 美团 / 腾讯 / 阿里 / 快手 / 小红书 / B站 / 蚂蚁 / 米哈游 / 携程 / 网易 / 拼多多 / 大易(hotjob)
- **精排打分**：硬过滤（城市/学历/社招/排除词）→ 语义重排（bge-reranker）→ LLM 判定 → 分档 A/B/C/D
- **统一数据层**：岗位唯一 ID + 公司级可达性配置（直达/导航）+ 源头校验，保证数据零脏数据
- **半自动投递**：上传简历 → 系统解析 → AI 补漏 → 停在「提交」前由人工核对（不自动提交，不替用户做「同意协议」这类不可逆动作）
- **稳定性机制**：可达性抽样 / 健康基线 / 冒烟自检，官方改版能及时发现

## 架构

```
profile.json（简历画像）
   └─ portrait.js  生成搜索关键词
        ▼
scan.js（搜索层，16 类适配器 + 分层搜索）
        ▼
scorer.js（精排层：硬过滤 → 重排 → LLM 判定 → 分档）
        ▼
db.js（看板层：待投 → 已投 → 有回复 → 面试 → Offer）
        ▲
apply.js（半自动投递：简历解析 + 补漏 + 停在提交前）
```

## 快速开始

1. 安装依赖：`cd tracker && npm install puppeteer-core`（或用系统 Edge）
2. 配置画像：复制 `tracker/data/profile.example.json` 为 `tracker/data/profile.json`，填入个人信息与简历路径
3. 配置模型 key：设置环境变量 `DEEPSEEK_API_KEY`（判定）、`SILICONFLOW_API_KEY`（重排）
4. 生成画像关键词：`node portrait.js`
5. 一键扫描：`node scan.js`
6. 半自动投递：`node apply.js <岗位标题关键词>`

## 目录结构

```
tracker/
├── scan.js        搜索调度 + 分层搜索
├── scorer.js      精排打分（硬过滤 + 重排 + 判定 + 分档）
├── portrait.js    简历画像关键词生成
├── db.js          看板数据层（岗位 + 状态机 + job_id）
├── companies.js   公司注册表（adapter + reach 可达性配置）
├── apply.js       半自动投递引擎
├── reachability.js 可达性抽样（验证 URL 模板是否失效）
├── staleness.js   下架识别（全量基线对比）
├── feedback.js    反馈闭环（打分 vs 投递结果）
├── health.js / smoke.js  健康基线 / 冒烟自检
└── *.js           16 类招聘系统适配器
```

## 说明

- **判定用非推理模型**（deepseek-chat），推理模型会返回空 content 导致分档失效
- **投递是半自动的**：AI 只做「上传简历、点解析、补确定性字段」，验证码/同意协议/主观问卷/最终提交一律留人工
- 敏感数据（画像、登录态、岗位库）都在 `tracker/data/`，已 gitignore，不上传
