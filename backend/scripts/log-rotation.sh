#!/bin/bash
# ============================================================
# GMP Log Rotation & Backup
# Run via cron: 0 2 * * * /opt/gmp-api/backend/scripts/log-rotation.sh
# ============================================================

LOG_DIR="/opt/gmp-api/backend/logs"
BACKUP_DIR="/opt/gmp-api/backend/logs/archive"
RETENTION_DAYS=30

mkdir -p $BACKUP_DIR

echo "[$(date)] Starting log rotation..." >> $LOG_DIR/maintenance.log

# Compress logs older than 7 days
find $LOG_DIR -name "*.json" -mtime +7 -exec gzip {} \; 2>/dev/null

# Move compressed to archive
find $LOG_DIR -name "*.gz" -exec mv {} $BACKUP_DIR/ \; 2>/dev/null

# Delete archives older than retention period
find $BACKUP_DIR -mtime +$RETENTION_DAYS -delete 2>/dev/null

# PM2 log rotation
pm2 flush 2>/dev/null
pm2 reloadLogs 2>/dev/null

echo "[$(date)] Log rotation completed" >> $LOG_DIR/maintenance.log
