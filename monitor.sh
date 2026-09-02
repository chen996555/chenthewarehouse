#!/bin/bash
# 求职星 · 监控告警：探活 /healthz，异常时告警 + 自动重启
# 用法：crontab 每 5 分钟跑一次（见下方 crontab 行）
#   可选配置 ALERT_WEBHOOK 环境变量（钉钉/企业微信机器人 webhook）实现主动推送
#   crontab -e 加一行：*/5 * * * * bash /root/job-star/monitor.sh >> /root/job-star/monitor.log 2>&1

URL="http://localhost:8630/healthz"
WEBHOOK="${ALERT_WEBHOOK:-}"
LOG="$HOME/job-star/monitor.log"

http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$URL" 2>/dev/null)

if [ "$http_code" != "200" ]; then
  msg="$(date '+%F %T') healthz 异常：HTTP ${http_code:-超时}"
  echo "$msg" >> "$LOG"
  # 主动推送（如配置了 webhook）
  if [ -n "$WEBHOOK" ]; then
    curl -s -H 'Content-Type: application/json' \
      -d "{\"msgtype\":\"text\",\"text\":{\"content\":\"求职星告警：${msg}\"}}" \
      "$WEBHOOK" >/dev/null 2>&1
  fi
  # 自动重启恢复
  pm2 restart jobstar >> "$LOG" 2>&1
  echo "$(date '+%F %T') 已执行 pm2 restart" >> "$LOG"
fi
