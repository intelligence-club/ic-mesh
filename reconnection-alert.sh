#!/bin/bash

# Simple reconnection alerter for immediate notification
# Runs smart monitor and checks for reconnection events

LAST_ALERT_FILE="last-reconnection-alert.txt"
CURRENT_TIME=$(date +%s)

# Run monitor and capture output
MONITOR_OUTPUT=$(node smart-reconnection-monitor.js --once 2>&1)

# Check if unnamed node is active (look for "ACTIVE" in output)
if echo "$MONITOR_OUTPUT" | grep -q "unnamed.*🟢 ACTIVE"; then
    echo "🟢 UNNAMED NODE ACTIVE - Processing available!"
    
    # Check if we already alerted recently (within 5 minutes)
    if [ -f "$LAST_ALERT_FILE" ]; then
        LAST_ALERT=$(cat "$LAST_ALERT_FILE")
        TIME_DIFF=$((CURRENT_TIME - LAST_ALERT))
        if [ "$TIME_DIFF" -lt 300 ]; then  # 5 minutes
            echo "   (Alert suppressed - already notified ${TIME_DIFF}s ago)"
            exit 0
        fi
    fi
    
    # Alert and record timestamp
    echo "$CURRENT_TIME" > "$LAST_ALERT_FILE"
    echo "🚨 PROCESSING OPPORTUNITY: unnamed node reconnected, 16 jobs waiting for frigg revival"
    
else
    echo "🔴 unnamed node offline (expected pattern)"
    echo "   Next check: Monitor will detect reconnection within 15s"
fi

# Show brief status
echo "$MONITOR_OUTPUT" | grep "Pending jobs:"
echo "$MONITOR_OUTPUT" | grep "unnamed"