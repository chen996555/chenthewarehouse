#!/bin/bash
# 求职星 · 代码同步脚本（本地 → 服务器）
# 用法：在 Git Bash 里 cd 到 job-star 目录，执行 bash sync.sh
# 作用：打包代码（排除 data/node_modules/.git），上传服务器，解压覆盖，重启后端

SERVER="root@182.92.156.235"

cd "$(dirname "$0")"

echo "① 打包代码（排除 data/node_modules/.git）..."
tar czf /tmp/jobstar-code.tar.gz --exclude=data --exclude=node_modules --exclude=.git tracker extension package.json package-lock.json

echo "② 上传到服务器..."
scp /tmp/jobstar-code.tar.gz "$SERVER:~/jobstar-code.tar.gz"

echo "③ 服务器解压 + 重启后端..."
ssh "$SERVER" "cd ~/job-star && tar xzf ~/jobstar-code.tar.gz && rm ~/jobstar-code.tar.gz && pm2 restart jobstar"

echo "✅ 同步完成，后端已重启"
