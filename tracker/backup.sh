#!/bin/bash
# 求职星 · SQLite 数据备份脚本
# 用法：./backup.sh  （或配 crontab：0 3 * * * ~/job-star/tracker/backup.sh）
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
DB="$DIR/data/tracker.db"
BACKUP_DIR="${BACKUP_DIR:-$DIR/data/backups}"

if [ ! -f "$DB" ]; then
  echo "未找到数据库 $DB，跳过备份"
  exit 0
fi

mkdir -p "$BACKUP_DIR"
STAMP=$(date +%Y%m%d-%H%M%S)
cp "$DB" "$BACKUP_DIR/tracker-$STAMP.db"
echo "[备份完成] $BACKUP_DIR/tracker-$STAMP.db"

# 保留最近 7 份，删更旧的
find "$BACKUP_DIR" -name 'tracker-*.db' -mtime +7 -delete 2>/dev/null || true
