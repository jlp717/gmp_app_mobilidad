#!/bin/bash
# ============================================================
# GMP Activity Monitor - Daily Summary
# Run via cron: 0 8 * * * /opt/gmp-api/backend/scripts/monitor-activity.sh
# ============================================================

LOG_DIR="/opt/gmp-api/backend/logs/user-actions"
DATE=$(date -d "yesterday" +%Y-%m-%d 2>/dev/null || date -v-1d +%Y-%m-%d)
REPORT_FILE="/opt/gmp-api/backend/logs/daily-report-${DATE}.txt"

echo "=== GMP MOVILIDAD - Daily Activity Report ===" > $REPORT_FILE
echo "Date: ${DATE}" >> $REPORT_FILE
echo "" >> $REPORT_FILE

# Count installations
if [ -f "${LOG_DIR}/installs-${DATE}.json" ]; then
    INSTALLS=$(wc -l < "${LOG_DIR}/installs-${DATE}.json")
    echo "📲 New Installations: ${INSTALLS}" >> $REPORT_FILE
else
    echo "📲 New Installations: 0" >> $REPORT_FILE
fi

# Count actions
if [ -f "${LOG_DIR}/actions-${DATE}.json" ]; then
    ACTIONS=$(wc -l < "${LOG_DIR}/actions-${DATE}.json")
    echo "📱 User Actions: ${ACTIONS}" >> $REPORT_FILE
    
    # Unique users
    USERS=$(grep -o '"userId":"[^"]*"' "${LOG_DIR}/actions-${DATE}.json" 2>/dev/null | sort -u | wc -l)
    echo "👥 Unique Users: ${USERS}" >> $REPORT_FILE
    
    # Top screens
    echo "" >> $REPORT_FILE
    echo "Top Screens Visited:" >> $REPORT_FILE
    grep -o '"screen":"[^"]*"' "${LOG_DIR}/actions-${DATE}.json" 2>/dev/null | sort | uniq -c | sort -rn | head -5 >> $REPORT_FILE
else
    echo "📱 User Actions: 0" >> $REPORT_FILE
fi

# PM2 status
echo "" >> $REPORT_FILE
echo "=== Server Status ===" >> $REPORT_FILE
pm2 jlist 2>/dev/null | head -100 >> $REPORT_FILE || echo "PM2 not available" >> $REPORT_FILE

echo "" >> $REPORT_FILE
echo "Report generated at $(date)" >> $REPORT_FILE

echo "Report saved to: $REPORT_FILE"
