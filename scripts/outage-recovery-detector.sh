#!/bin/bash

# outage-recovery-detector.sh - Lightweight Service Recovery Detection
# Monitors for nodes coming back online during service outages
# Works without Node.js dependencies, using direct API calls

set -e

SCRIPT_DIR="$(dirname "$0")"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
API_BASE="http://localhost:8333/api"
ALERT_LOG="$PROJECT_ROOT/outage-recovery-alerts.log"
STATE_FILE="$PROJECT_ROOT/outage-recovery-state.json"
CHECK_INTERVAL=30  # seconds

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() {
    echo -e "${1}" | tee -a "$ALERT_LOG"
}

log_info() {
    log "${BLUE}[$(date '+%H:%M:%S')] INFO: ${1}${NC}"
}

log_warn() {
    log "${YELLOW}[$(date '+%H:%M:%S')] WARN: ${1}${NC}"
}

log_error() {
    log "${RED}[$(date '+%H:%M:%S')] ERROR: ${1}${NC}"
}

log_success() {
    log "${GREEN}[$(date '+%H:%M:%S')] SUCCESS: ${1}${NC}"
}

# Check if API is responding
check_api_health() {
    if curl -s -f "$API_BASE/health" > /dev/null 2>&1; then
        return 0
    else
        return 1
    fi
}

# Get current node status
get_node_status() {
    if check_api_health; then
        curl -s "$API_BASE/status" 2>/dev/null || echo '{"error":"API_ERROR"}'
    else
        echo '{"error":"API_DOWN"}'
    fi
}

# Get current job queue status  
get_queue_status() {
    if check_api_health; then
        curl -s "$API_BASE/jobs/pending" 2>/dev/null || echo '{"error":"API_ERROR"}'
    else
        echo '{"error":"API_DOWN"}'
    fi
}

# Parse JSON for active node count (basic shell parsing)
count_active_nodes() {
    local status="$1"
    # Basic grep parsing - count active nodes
    echo "$status" | grep -o '"active":true' | wc -l
}

# Parse JSON for pending job count
count_pending_jobs() {
    local queue="$1"
    # Basic grep parsing - count pending jobs
    echo "$queue" | grep -o '"status":"pending"' | wc -l
}

# Check for service recovery
detect_recovery() {
    local current_time=$(date +%s)
    local node_status=$(get_node_status)
    local queue_status=$(get_queue_status)
    
    # Skip processing if API is down
    if echo "$node_status" | grep -q '"error":"API_DOWN"'; then
        log_error "IC Mesh API is down - cannot monitor recovery"
        return 1
    fi
    
    local active_nodes=$(count_active_nodes "$node_status")
    local pending_jobs=$(count_pending_jobs "$queue_status")
    
    # Load previous state if exists
    local prev_active_nodes=0
    local prev_pending_jobs=0
    
    if [ -f "$STATE_FILE" ]; then
        if prev_state=$(cat "$STATE_FILE" 2>/dev/null); then
            prev_active_nodes=$(echo "$prev_state" | grep -o '"active_nodes":[0-9]*' | cut -d':' -f2 || echo "0")
            prev_pending_jobs=$(echo "$prev_state" | grep -o '"pending_jobs":[0-9]*' | cut -d':' -f2 || echo "0")
        fi
    fi
    
    # Detect significant changes
    local recovery_detected=false
    local capacity_alert=""
    
    # Node recovery detection
    if [ "$active_nodes" -gt "$prev_active_nodes" ]; then
        if [ "$active_nodes" -eq 1 ] && [ "$prev_active_nodes" -eq 0 ]; then
            log_success "🚨 SERVICE RECOVERY: First node online! Service restored from complete outage"
            log_success "   Active nodes: $prev_active_nodes → $active_nodes"
            log_success "   Pending jobs: $pending_jobs"
            recovery_detected=true
        elif [ "$active_nodes" -gt 1 ]; then
            log_success "📈 CAPACITY INCREASE: Additional nodes online (+$((active_nodes - prev_active_nodes)))"
            log_success "   Active nodes: $prev_active_nodes → $active_nodes" 
            recovery_detected=true
        fi
    fi
    
    # Node loss detection
    if [ "$active_nodes" -lt "$prev_active_nodes" ]; then
        if [ "$active_nodes" -eq 0 ]; then
            log_error "🚨 COMPLETE OUTAGE: All nodes offline! Service down"
            log_error "   Active nodes: $prev_active_nodes → $active_nodes"
            capacity_alert="OUTAGE"
        else
            log_warn "📉 CAPACITY LOSS: Nodes disconnected (-$((prev_active_nodes - active_nodes)))"
            log_warn "   Active nodes: $prev_active_nodes → $active_nodes"
        fi
        recovery_detected=true
    fi
    
    # Job queue analysis
    if [ "$pending_jobs" -ne "$prev_pending_jobs" ]; then
        local job_delta=$((pending_jobs - prev_pending_jobs))
        if [ "$job_delta" -gt 0 ]; then
            log_info "📋 Queue growing: +$job_delta jobs (total: $pending_jobs)"
        elif [ "$job_delta" -lt 0 ]; then
            log_info "⚡ Jobs processed: $((job_delta * -1)) completed (remaining: $pending_jobs)"
        fi
    fi
    
    # Critical capacity alerts
    if [ "$active_nodes" -eq 0 ]; then
        capacity_alert="OUTAGE"
    elif [ "$pending_jobs" -gt 50 ]; then
        capacity_alert="BACKLOG"
    fi
    
    # Update state
    cat > "$STATE_FILE" << EOF
{
    "timestamp": $current_time,
    "active_nodes": $active_nodes,
    "pending_jobs": $pending_jobs,
    "capacity_alert": "$capacity_alert",
    "last_recovery": $([ "$recovery_detected" = true ] && echo "$current_time" || echo "null")
}
EOF
    
    # Return success if recovery detected
    [ "$recovery_detected" = true ] && return 0 || return 1
}

# Continuous monitoring mode
monitor_continuous() {
    log_info "🔄 Starting continuous outage recovery monitoring..."
    log_info "   Check interval: ${CHECK_INTERVAL}s"
    log_info "   Alert log: $ALERT_LOG"
    log_info "   Press Ctrl+C to stop"
    
    while true; do
        detect_recovery > /dev/null 2>&1 || true
        sleep "$CHECK_INTERVAL"
    done
}

# Single check mode
check_once() {
    echo "🔍 Service Recovery Detection Check"
    echo "=================================="
    
    if detect_recovery; then
        echo "✅ Recovery event detected - see logs for details"
        exit 0
    else
        local node_status=$(get_node_status)
        local active_nodes=$(count_active_nodes "$node_status")
        local pending_jobs=$(count_pending_jobs "$(get_queue_status)")
        
        if [ "$active_nodes" -eq 0 ]; then
            echo "🚨 Service outage confirmed - 0 active nodes"
            echo "   Use --monitor to watch for recovery"
        else
            echo "📊 Service operational - $active_nodes active nodes, $pending_jobs pending jobs"
            echo "   No significant changes detected"
        fi
        exit 1
    fi
}

# Show current status
show_status() {
    echo "📊 Current Service Status"
    echo "========================"
    
    if ! check_api_health; then
        echo "❌ IC Mesh API is down"
        exit 1
    fi
    
    local node_status=$(get_node_status)
    local queue_status=$(get_queue_status)
    local active_nodes=$(count_active_nodes "$node_status")
    local pending_jobs=$(count_pending_jobs "$queue_status")
    
    echo "🔌 Active nodes: $active_nodes"
    echo "📋 Pending jobs: $pending_jobs"
    
    if [ "$active_nodes" -eq 0 ]; then
        echo "🚨 STATUS: COMPLETE OUTAGE"
        echo "💡 Recommendation: Contact node operators for revival"
    elif [ "$active_nodes" -eq 1 ]; then
        echo "⚠️  STATUS: MINIMAL CAPACITY"
        echo "💡 Recommendation: Monitor for additional node connections"
    else
        echo "✅ STATUS: OPERATIONAL"
    fi
    
    # Show last state if exists
    if [ -f "$STATE_FILE" ]; then
        echo ""
        echo "📈 Monitoring History:"
        if last_recovery=$(grep -o '"last_recovery":[0-9]*' "$STATE_FILE" 2>/dev/null | cut -d':' -f2); then
            if [ "$last_recovery" != "null" ] && [ -n "$last_recovery" ]; then
                local recovery_time=$(date -d "@$last_recovery" '+%H:%M:%S' 2>/dev/null || echo "unknown")
                echo "   Last recovery: $recovery_time"
            else
                echo "   Last recovery: None detected"
            fi
        fi
    fi
}

# Print usage
usage() {
    echo "Usage: $0 [OPTION]"
    echo ""
    echo "Lightweight service recovery detection for IC Mesh outages"
    echo ""
    echo "Options:"
    echo "  --check, -c     Run single recovery check"
    echo "  --monitor, -m   Start continuous monitoring"
    echo "  --status, -s    Show current service status"
    echo "  --help, -h      Show this help"
    echo ""
    echo "Examples:"
    echo "  $0 --check                    # Check once for recovery"
    echo "  $0 --monitor                  # Monitor continuously"
    echo "  $0 --status                   # Show current status"
    echo ""
    echo "Monitoring Logic:"
    echo "  • Detects when first node comes online from outage"
    echo "  • Alerts on capacity increases/decreases"
    echo "  • Tracks job queue changes"
    echo "  • Logs all events to $ALERT_LOG"
    echo ""
}

# Handle command line arguments
case "${1:-}" in
    --check|-c)
        check_once
        ;;
    --monitor|-m)
        monitor_continuous
        ;;
    --status|-s)
        show_status
        ;;
    --help|-h)
        usage
        ;;
    *)
        usage
        exit 1
        ;;
esac