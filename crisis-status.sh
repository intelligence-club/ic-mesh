#!/bin/bash

# Quick Crisis Status Check
# Usage: ./crisis-status.sh

echo "🚨 FRIGG CRISIS STATUS - $(date -u '+%Y-%m-%d %H:%M UTC')"
echo "────────────────────────────────────────────────────────"

cd "$(dirname "$0")"

# Check pending jobs requiring frigg capabilities
PENDING_OCR=$(sqlite3 data/mesh.db "SELECT COUNT(*) FROM jobs WHERE status='pending' AND type='ocr';")
PENDING_PDF=$(sqlite3 data/mesh.db "SELECT COUNT(*) FROM jobs WHERE status='pending' AND type='pdf-extract';")  
PENDING_TRANSCRIBE=$(sqlite3 data/mesh.db "SELECT COUNT(*) FROM jobs WHERE status='pending' AND type='transcribe';")
TOTAL_BLOCKED=$((PENDING_OCR + PENDING_PDF + PENDING_TRANSCRIBE))

# Check frigg node status
FRIGG_ONLINE=$(sqlite3 data/mesh.db "SELECT COUNT(*) FROM nodes WHERE owner='drake' AND lastSeen > $(( $(date +%s) * 1000 - 5*60*1000 ));")
FRIGG_TOTAL=$(sqlite3 data/mesh.db "SELECT COUNT(*) FROM nodes WHERE owner='drake';")

echo "📊 Blocked Jobs: $TOTAL_BLOCKED ($PENDING_OCR OCR, $PENDING_PDF PDF, $PENDING_TRANSCRIBE transcribe)"
echo "🖥️  Frigg Nodes: $FRIGG_ONLINE/$FRIGG_TOTAL online" 
REVENUE_MIN=$((TOTAL_BLOCKED * 30 / 100))
REVENUE_MAX=$((TOTAL_BLOCKED * 50 / 100))
echo "💰 Revenue Impact: ~\$${REVENUE_MIN}-\$${REVENUE_MAX}"

if [ $FRIGG_ONLINE -eq 0 ]; then
    echo "🔴 STATUS: CRISIS - No frigg nodes online"
    echo "🔥 ACTION: Contact Drake immediately!"
elif [ $TOTAL_BLOCKED -gt 50 ]; then
    echo "🟡 STATUS: RECOVERING - Some nodes online but queue still backed up"
    echo "⏳ ACTION: Monitor recovery progress"
else  
    echo "🟢 STATUS: RESOLVED - Queue healthy"
    echo "✅ ACTION: Crisis resolved"
fi

echo ""
echo "Quick actions:"
echo "  🚨 Contact Drake: node urgent-drake-contact.js"  
echo "  📊 Monitor recovery: node monitor-frigg-recovery.js"
echo "  🔍 Full analysis: node frigg-revival-analysis.js"