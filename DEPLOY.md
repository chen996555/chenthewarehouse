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

## 四、HTTPS + 域名

1. 域名解析到服务器 IP
2. Nginx 反向代理 + Let's Encrypt 证书：

```nginx
server {
  listen 443 ssl;
  server_name job.example.com;
  ssl_certificate /etc/letsencrypt/live/job.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/job.example.com/privkey.pem;
  location / {
    proxy_pass http://127.0.0.1:8630;
    proxy_set_header Host $host;
  }
}
```

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
