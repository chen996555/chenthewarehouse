# 求职星 · 上云部署文档

> 已选型：阿里云 ECS **2核2G e实例（ecs.e-c1m1.large）+ 3Mbps 固定带宽 + 40G ESSD**，系统 Alibaba Cloud Linux 3。本文档是上云时的完整操作清单。

## 一、服务器准备

1. 服务器：2核2G e实例（求职星是 I/O 密集 + 低并发，CPU/内存富余；3Mbps 够用，扫描和 LLM 走入站不限速）
2. 安全组：开放 **22**（SSH）、**443**（HTTPS）入方向端口
3. 装 Node.js **v22+**（`node:sqlite` 内置模块需要；Alibaba Cloud Linux 3 默认源没有 Node 22，用 nvm）：
   ```bash
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
   source ~/.bashrc
   nvm install 22
   node -v   # 确认 v22+
   ```
4. 装 pm2（进程保活）：`npm i -g pm2`

## 二、代码部署

```bash
# 上传项目到服务器（git clone 或 scp）
cd ~/job-star/tracker
npm install          # 装 pdf-parse、mammoth 等依赖
```

## 三、环境变量（关键）

后端 LLM 需要 `DEEPSEEK_API_KEY`，三种方式任选：

```bash
# 方式 1：环境变量（pm2 启动时注入）
DEEPSEEK_API_KEY=sk-xxx pm2 start server.js --name jobstar

# 方式 2：写进 data/scorer-config.json（gitignore，不上传）
# {"apiKey":"sk-xxx","baseUrl":"https://api.deepseek.com","judgeModel":"deepseek-chat"}

# 方式 3：pm2 ecosystem 配置文件
```

## 四、HTTPS + 域名（域名已定 jobaistar.ltd）

**当前状态（2026-08-30）**：域名 `jobaistar.ltd` 已在阿里云注册（NS=hichina，与服务器同家），已选**走 ICP 备案**（个人备案）。备案期间继续 `http://182.92.156.235:8630` 内测。

### 第一步：ICP 备案（用户本人操作，约 7-20 工作日）

前置：①域名实名认证（阿里云域名控制台，身份证，与备案主体一致）②服务器账号实名。

流程：阿里云控制台 → ICP 备案 → 个人备案 → 填主体信息（姓名/身份证/手机号/地址）→ 填网站信息（域名 jobaistar.ltd、网站名称「求职星」）→ 传身份证正反面 + 人脸核验 → 阿里云初审（1-2 天）→ 短信核验 → 管局审核（7-20 天）。

> 注意：**备案主体 = 域名实名 = 服务器账号，三者必须都是陈端发本人**。个人备案网站名称避免「招聘平台」这类经营性词汇，用「求职星」即可。

### 第二步：备案通过后配 HTTPS（我来操作）

1. **DNS 解析**：阿里云云解析 DNS，`jobaistar.ltd` 和 `www` 加 A 记录 → `182.92.156.235`
2. **安全组**：开放 80、443 入方向
3. **装 nginx**：`dnf install -y nginx`，systemctl 开机自启
4. **SSL 证书**：阿里云免费 SSL 证书（单域名 1 年，自动续期）或 Let's Encrypt（certbot）
5. **nginx 反代**：

```nginx
server {
  listen 80;
  server_name jobaistar.ltd www.jobaistar.ltd;
  return 301 https://$host$request_uri;   # 强制 HTTPS
}
server {
  listen 443 ssl;
  server_name jobaistar.ltd www.jobaistar.ltd;
  ssl_certificate /etc/letsencrypt/live/jobaistar.ltd/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/jobaistar.ltd/privkey.pem;
  location / {
    proxy_pass http://127.0.0.1:8630;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

6. **扩展切域名**（2 处）：manifest.json `host_permissions` → `https://jobaistar.ltd/*`；扩展「①简历」页「服务器地址」填 `https://jobaistar.ltd`

## 五、扩展端改 URL（2 处）

上云后，扩展要连公网域名：

1. **manifest.json**：`host_permissions` 从 `http://localhost:8630/*` 改成 `https://job.example.com/*`（静态，必须改 manifest 后重载扩展）
2. **运行时**：扩展「①简历」页 →「服务器地址」输入框 → 填 `https://job.example.com`（这个我已经做成可配置了，用户/你在界面上就能改）

## 六、备份策略

SQLite 单文件 `data/tracker.db`，定期备份：

```bash
# 每天凌晨 3 点备份（crontab -e）
0 3 * * * cp ~/job-star/tracker/data/tracker.db ~/backups/tracker-$(date +\%Y\%m\%d).db
# 保留最近 7 份
0 3 * * * find ~/backups -name 'tracker-*.db' -mtime +7 -delete
```

## 七、安全（本次已修 + 上云注意）

| 项 | 状态 |
|---|---|
| 数据按用户隔离（user_id）| ✅ 已修 |
| 未登录访问数据返回 401 | ✅ 已修 |
| 写操作/资源操作鉴权 | ✅ 已修 |
| 密码加盐（scrypt）| ✅ 已修（兼容旧 sha256）|
| token 30 天过期 | ✅ 已修 |
| rate limit 限流 | ✅ 已加（登录/注册 10次/分、推荐 5次/分）|
| 结构化日志 + LLM 成本追踪 | ✅ 已加（`logger.js` JSON 格式 + token/成本日志）|

## 八、上云检查清单

- [ ] 服务器装 Node v22+ + pm2
- [ ] 配 DEEPSEEK_API_KEY
- [ ] 域名 + HTTPS（Nginx 反代）
- [ ] manifest host_permissions 改公网域名
- [ ] 扩展「服务器地址」填公网域名
- [ ] 配 crontab 备份
- [x] rate limit + 结构化日志（已加）

## 九、代码同步（日常改代码后）

本地 Git Bash 执行（项目根目录 `job-star/`）：

```bash
bash sync.sh
```

`sync.sh` 自动三步：打包代码（**排除 data/node_modules/.git**）→ scp 上传 → 服务器解压 + `pm2 restart jobstar`。

- 后端改动（tracker/）→ 自动重启生效
- 前端改动（extension/）→ 本地重载扩展
- **data 目录永不覆盖**（云端数据库/缓存/简历独立，与本地隔离）

## 十、当前部署状态（2026-08-30）

- ✅ 已部署：阿里云 ECS 182.92.156.235，pm2 开机自启，安全组 8630
- ✅ 数据备份：crontab 每天凌晨 3 点（`backup.sh`）
- ✅ 代码同步：`sync.sh` 一键
- ⏸️ HTTPS：暂缓，内测用 http+IP+8630（有域名后再配 Nginx + SSL）
