#!/bin/bash
# watch-jobs.sh - Real-time job processing monitor

echo "🔄 IC Mesh Job Processing Monitor"
echo "================================"

while true; do
  # Get current status
  STATUS=$(curl -s http://localhost:8333/status)
  TIMESTAMP=$(date '+%H:%M:%S')
  
  # Extract job stats
  TOTAL=$(echo "$STATUS" | jq -r '.jobs.total // 0')
  COMPLETED=$(echo "$STATUS" | jq -r '.jobs.completed // 0') 
  PENDING=$(echo "$STATUS" | jq -r '.jobs.pending // 0')
  ACTIVE_NODES=$(echo "$STATUS" | jq -r '.nodes.active // 0')
  
  # Display current stats
  printf "\r[$TIMESTAMP] Jobs: %d total, %d completed, %d pending | Nodes: %d active" \
    "$TOTAL" "$COMPLETED" "$PENDING" "$ACTIVE_NODES"
  
  sleep 2
done