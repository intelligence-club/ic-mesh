#!/bin/bash

# outage-status-generator.sh - Automated Status Updates During Outages
# Generates human-readable status updates for Discord, documentation, etc.

set -e

SCRIPT_DIR="$(dirname "$0")"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
API_BASE="http://localhost:8333/api"

# Status file locations
STATUS_FILE="$PROJECT_ROOT/../STATUS.md"
OUTAGE_STATE="$PROJECT_ROOT/outage-state.json"

# Colors for terminal output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get current timestamp
get_timestamp() {
    date '+%Y-%m-%d %H:%M:%S UTC'
}

# Check if API is responding
check_api_health() {
    curl -s -f "$API_BASE/health" > /dev/null 2>&1
}

# Get service status data
get_service_status() {
    local status='{"active_nodes":0,"total_nodes":0,"pending_jobs":0,"api_status":"down"}'
    
    if check_api_health; then
        local node_data=$(curl -s "$API_BASE/status" 2>/dev/null || echo '{}')
        local queue_data=$(curl -s "$API_BASE/jobs/pending" 2>/dev/null || echo '[]')
        
        local active_nodes=$(echo "$node_data" | grep -o '"active":true' | wc -l || echo "0")
        local total_nodes=$(echo "$node_data" | grep -o '"lastSeen":' | wc -l || echo "0")  
        local pending_jobs=$(echo "$queue_data" | grep -o '"status":"pending"' | wc -l || echo "0")
        
        status=$(cat << EOF
{
    "active_nodes": $active_nodes,
    "total_nodes": $total_nodes,
    "pending_jobs": $pending_jobs,
    "api_status": "up"
}
EOF
        )
    fi
    
    echo "$status"
}

# Calculate outage duration from STATUS.md
get_outage_duration() {
    # Try to extract outage start time from STATUS.md
    if [ -f "$STATUS_FILE" ]; then
        # Look for patterns like "offline 8+ days" or "198+ hours"
        local hours_pattern=$(grep -o "offline [0-9]*[0-9+]*h\|offline [0-9]*[0-9+]* hours" "$STATUS_FILE" | head -1 | grep -o "[0-9][0-9]*" || echo "")
        local days_pattern=$(grep -o "offline [0-9]*[0-9+]* days" "$STATUS_FILE" | head -1 | grep -o "[0-9][0-9]*" || echo "")
        
        if [ -n "$days_pattern" ]; then
            echo "${days_pattern}+ days"
        elif [ -n "$hours_pattern" ]; then
            echo "${hours_pattern}+ hours"
        else
            echo "Unknown duration"
        fi
    else
        echo "Unknown duration"
    fi
}

# Generate Discord-ready status message
generate_discord_status() {
    local status_data="$1"
    local active_nodes=$(echo "$status_data" | grep -o '"active_nodes":[0-9]*' | cut -d':' -f2)
    local total_nodes=$(echo "$status_data" | grep -o '"total_nodes":[0-9]*' | cut -d':' -f2)
    local pending_jobs=$(echo "$status_data" | grep -o '"pending_jobs":[0-9]*' | cut -d':' -f2)
    local api_status=$(echo "$status_data" | grep -o '"api_status":"[^"]*"' | cut -d'"' -f4)
    
    local timestamp=$(get_timestamp)
    local duration=$(get_outage_duration)
    
    if [ "$active_nodes" -eq 0 ]; then
        # Complete outage message
        cat << EOF
🚨 **IC Mesh Service Status Update** 🚨

**Status:** COMPLETE OUTAGE
**Duration:** $duration
**Active Nodes:** 0/$total_nodes
**Pending Jobs:** $pending_jobs (blocked)
**Last Update:** $timestamp

**What's happening:** All compute nodes are offline, blocking all job processing.

**Action being taken:** Monitoring for automatic node reconnections and contacting node operators for manual revival.

**Expected resolution:** Depends on node operator availability. Service will auto-resume when nodes reconnect.

**Updates:** Will post when first node comes back online. 

Status monitoring active 🔄
EOF
    elif [ "$active_nodes" -lt 2 ]; then
        # Degraded service message
        cat << EOF
⚠️ **IC Mesh Service Status Update** ⚠️

**Status:** MINIMAL CAPACITY
**Active Nodes:** $active_nodes/$total_nodes
**Pending Jobs:** $pending_jobs
**Last Update:** $timestamp

**What's happening:** Limited compute capacity available. Service operational but may be slower than normal.

**Action being taken:** Monitoring for additional node connections to restore full capacity.

**Impact:** Transcription services working, OCR/PDF may be limited.

Service recovering 📈
EOF
    else
        # Service restored message
        cat << EOF
✅ **IC Mesh Service Status Update** ✅

**Status:** OPERATIONAL  
**Active Nodes:** $active_nodes/$total_nodes
**Pending Jobs:** $pending_jobs
**Last Update:** $timestamp

**What's happening:** Service capacity restored. All job types processing normally.

**Recovery time:** Service recovered from outage duration: $duration

**Current capacity:** Full transcription, OCR, and PDF processing available.

All systems operational 🟢
EOF
    fi
}

# Generate technical status report  
generate_technical_report() {
    local status_data="$1"
    local timestamp=$(get_timestamp)
    
    cat << EOF
# IC Mesh Service Status Report
**Generated:** $timestamp

## Current Status
\`\`\`json
$status_data
\`\`\`

## Infrastructure Status
- **API Server:** $(echo "$status_data" | grep -q '"api_status":"up"' && echo "✅ Running" || echo "❌ Down")
- **Database:** $([ -f "$PROJECT_ROOT/data/mesh.db" ] && echo "✅ Available" || echo "❌ Missing")
- **Monitoring:** $([ -x "$PROJECT_ROOT/scripts/outage-recovery-detector.sh" ] && echo "✅ Active" || echo "❌ Unavailable")

## Recovery Tools Available
- **Outage Detection:** \`./scripts/outage-recovery-detector.sh\`
- **Recovery Checklist:** \`./scripts/post-outage-recovery-checklist.sh\`
- **Response Playbook:** \`OUTAGE-RESPONSE-PLAYBOOK.md\`

## Recommended Actions
$(echo "$status_data" | grep -q '"active_nodes":0' && cat << ACTIONS
1. **Contact node operators** (see OUTAGE-RESPONSE-PLAYBOOK.md)
2. **Monitor for recovery:** \`./scripts/outage-recovery-detector.sh --monitor\`
3. **Verify infrastructure:** Check API server and database health
ACTIONS
)

$(echo "$status_data" | grep -q '"active_nodes":[1-9]' && cat << RECOVERY
1. **Run recovery verification:** \`./scripts/post-outage-recovery-checklist.sh\`
2. **Monitor stability:** Ensure nodes stay connected
3. **Update documentation:** Record recovery process and lessons learned
RECOVERY
)

---
*Generated by IC Mesh outage status generator*
EOF
}

# Generate short status for logging
generate_short_status() {
    local status_data="$1"
    local active_nodes=$(echo "$status_data" | grep -o '"active_nodes":[0-9]*' | cut -d':' -f2)
    local pending_jobs=$(echo "$status_data" | grep -o '"pending_jobs":[0-9]*' | cut -d':' -f2)
    local timestamp=$(get_timestamp)
    
    if [ "$active_nodes" -eq 0 ]; then
        echo "[$timestamp] OUTAGE: 0 active nodes, $pending_jobs jobs blocked"
    else
        echo "[$timestamp] OPERATIONAL: $active_nodes active nodes, $pending_jobs pending jobs"
    fi
}

# Save current state for comparison
save_outage_state() {
    local status_data="$1"
    local timestamp=$(date +%s)
    
    cat > "$OUTAGE_STATE" << EOF
{
    "timestamp": $timestamp,
    "status": $status_data
}
EOF
}

# Check if status changed since last run
status_changed() {
    local current_status="$1"
    
    if [ ! -f "$OUTAGE_STATE" ]; then
        return 0  # No previous state = changed
    fi
    
    local prev_status=$(cat "$OUTAGE_STATE" | grep -o '"status":{.*}' | cut -d':' -f2- | sed 's/}$//')
    local curr_active=$(echo "$current_status" | grep -o '"active_nodes":[0-9]*' | cut -d':' -f2)
    local prev_active=$(echo "$prev_status" | grep -o '"active_nodes":[0-9]*' | cut -d':' -f2)
    
    [ "$curr_active" != "$prev_active" ]
}

# Main function
main() {
    local format="${1:-discord}"
    local status_data=$(get_service_status)
    
    case "$format" in
        "discord")
            generate_discord_status "$status_data"
            ;;
        "technical"|"tech")
            generate_technical_report "$status_data"
            ;;
        "short")
            generate_short_status "$status_data"
            ;;
        "json")
            echo "$status_data" | jq . 2>/dev/null || echo "$status_data"
            ;;
        "check")
            if status_changed "$status_data"; then
                echo "Status changed - update recommended"
                save_outage_state "$status_data"
                exit 0
            else
                echo "No status change detected"
                exit 1
            fi
            ;;
        *)
            echo "Unknown format: $format"
            echo "Usage: $0 {discord|technical|short|json|check}"
            exit 1
            ;;
    esac
    
    # Save state for future comparisons
    save_outage_state "$status_data"
}

# Handle help
if [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
    cat << EOF
Usage: $0 [FORMAT]

Generate status updates for IC Mesh service outages

Formats:
  discord     Human-readable status for Discord/social media
  technical   Technical report with infrastructure details
  short       One-line status for logging
  json        Raw status data in JSON format
  check       Check if status changed since last run

Examples:
  $0 discord                    # Generate Discord status message
  $0 technical > status.md      # Generate technical report
  $0 short >> outage.log        # Log short status
  $0 check && echo "Updated!"   # Check for changes

The tool automatically detects:
  • Service outage (0 active nodes)
  • Degraded service (< 2 active nodes)
  • Full recovery (multiple active nodes)

Status is compared between runs to detect changes.
EOF
    exit 0
fi

main "$@"