#!/bin/bash

# unified-monitoring-dashboard.sh - Comprehensive Monitoring Dashboard
# Brings together all diagnostic tools into one unified interface

set -e

SCRIPT_DIR="$(dirname "$0")"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
API_BASE="http://localhost:8333/api"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
GRAY='\033[0;90m'
NC='\033[0m' # No Color

# Dashboard state
REFRESH_INTERVAL=5
CONTINUOUS_MODE=false
DETAILED_MODE=false
JSON_MODE=false

log() {
    echo -e "${1}"
}

# Clear screen for continuous mode
clear_screen() {
    if [ "$CONTINUOUS_MODE" = true ]; then
        clear
    fi
}

# Display header
show_header() {
    log "${WHITE}╔══════════════════════════════════════════════════════════════╗${NC}"
    log "${WHITE}║                    IC MESH MONITORING DASHBOARD               ║${NC}"
    log "${WHITE}╚══════════════════════════════════════════════════════════════╝${NC}"
    log "${GRAY}Timestamp: $(date '+%Y-%m-%d %H:%M:%S UTC')${NC}"
    
    if [ "$CONTINUOUS_MODE" = true ]; then
        log "${GRAY}Continuous mode (${REFRESH_INTERVAL}s refresh) - Press Ctrl+C to exit${NC}"
    fi
    log ""
}

# Get service status
get_service_status() {
    if curl -s -f "$API_BASE/health" > /dev/null 2>&1; then
        echo "up"
    else
        echo "down"
    fi
}

# Get node metrics
get_node_metrics() {
    local status_response=$(curl -s "$API_BASE/status" 2>/dev/null || echo '{}')
    local active_nodes=$(echo "$status_response" | grep -o '"active":true' | wc -l || echo "0")
    local total_nodes=$(echo "$status_response" | grep -o '"lastSeen":' | wc -l || echo "0")
    
    echo "$active_nodes,$total_nodes"
}

# Get queue metrics
get_queue_metrics() {
    local queue_response=$(curl -s "$API_BASE/jobs/pending" 2>/dev/null || echo '[]')
    local pending_jobs=$(echo "$queue_response" | grep -o '"status":"pending"' | wc -l || echo "0")
    
    echo "$pending_jobs"
}

# Display service status section
show_service_status() {
    log "${BLUE}🌐 SERVICE STATUS${NC}"
    log "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
    
    local service_status=$(get_service_status)
    local node_metrics=$(get_node_metrics)
    local active_nodes=$(echo "$node_metrics" | cut -d',' -f1)
    local total_nodes=$(echo "$node_metrics" | cut -d',' -f2)
    local pending_jobs=$(get_queue_metrics)
    
    # Service status indicator
    if [ "$service_status" = "up" ]; then
        if [ "$active_nodes" -eq 0 ]; then
            log "🔴 ${RED}OUTAGE${NC}        - API responding but no compute capacity"
        elif [ "$active_nodes" -eq 1 ]; then
            log "🟡 ${YELLOW}DEGRADED${NC}      - Limited capacity ($active_nodes/$total_nodes nodes)"
        else
            log "🟢 ${GREEN}OPERATIONAL${NC}   - Full service capacity"
        fi
    else
        log "🔴 ${RED}API DOWN${NC}      - Server not responding"
    fi
    
    # Metrics display
    log "📊 Active Nodes:   ${WHITE}$active_nodes${NC}/$total_nodes"
    log "📋 Pending Jobs:   ${WHITE}$pending_jobs${NC}"
    
    # Calculate uptime if possible
    local uptime_info=""
    if [ "$service_status" = "up" ]; then
        uptime_info=$(curl -s "$API_BASE/health" 2>/dev/null | grep -o '"uptime":"[^"]*"' | cut -d'"' -f4 || echo "")
        if [ -n "$uptime_info" ]; then
            log "⏰ Server Uptime: ${WHITE}$uptime_info${NC}"
        fi
    fi
    
    log ""
}

# Display capacity analysis
show_capacity_analysis() {
    log "${PURPLE}⚡ CAPACITY ANALYSIS${NC}"
    log "${PURPLE}═══════════════════════════════════════════════════════════════${NC}"
    
    if [ "$(get_service_status)" = "up" ]; then
        # Run the real-time capacity monitor if available
        if [ -f "$PROJECT_ROOT/real-time-capacity-monitor.js" ]; then
            cd "$PROJECT_ROOT"
            local capacity_output=$(timeout 10s node real-time-capacity-monitor.js --check 2>/dev/null || echo "TIMEOUT")
            
            if [ "$capacity_output" != "TIMEOUT" ]; then
                # Extract key information from capacity monitor
                echo "$capacity_output" | grep -E "🔴|🟡|🟢" | head -5 | while IFS= read -r line; do
                    log "  $line"
                done
            else
                log "⚠️  Capacity analysis timeout - server may be slow"
            fi
        else
            log "⚠️  Capacity monitor not available - run setup-dev-environment.sh"
        fi
    else
        log "❌ Cannot analyze capacity - API server down"
    fi
    
    log ""
}

# Display recent alerts
show_recent_alerts() {
    log "${RED}🚨 RECENT ALERTS${NC}"
    log "${RED}═══════════════════════════════════════════════════════════════${NC}"
    
    # Check for recent outage alerts
    local alert_file="$PROJECT_ROOT/outage-recovery-alerts.log"
    if [ -f "$alert_file" ]; then
        local recent_alerts=$(tail -5 "$alert_file" 2>/dev/null || echo "")
        if [ -n "$recent_alerts" ]; then
            echo "$recent_alerts" | while IFS= read -r line; do
                # Color code alerts
                if echo "$line" | grep -q "SUCCESS"; then
                    log "  ${GREEN}$line${NC}"
                elif echo "$line" | grep -q "ERROR"; then
                    log "  ${RED}$line${NC}"
                elif echo "$line" | grep -q "WARN"; then
                    log "  ${YELLOW}$line${NC}"
                else
                    log "  ${GRAY}$line${NC}"
                fi
            done
        else
            log "📝 No recent alerts"
        fi
    else
        log "📝 No alert log found - alerts will appear here when monitoring is active"
    fi
    
    log ""
}

# Display system health metrics
show_system_health() {
    log "${CYAN}💻 SYSTEM HEALTH${NC}"
    log "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
    
    # Database size
    local db_file="$PROJECT_ROOT/data/mesh.db"
    if [ -f "$db_file" ]; then
        local db_size=$(du -h "$db_file" | cut -f1)
        log "💾 Database Size:  ${WHITE}$db_size${NC}"
    else
        log "💾 Database:       ${RED}Not found${NC}"
    fi
    
    # Free disk space
    local free_space=$(df -h "$PROJECT_ROOT" | awk 'NR==2 {print $4}')
    log "💿 Free Space:     ${WHITE}$free_space${NC}"
    
    # Memory usage
    local memory_usage=$(free -h | awk 'NR==2{printf "%.1f%%", $3/$2*100}' 2>/dev/null || echo "N/A")
    log "🧠 Memory Usage:   ${WHITE}$memory_usage${NC}"
    
    # CPU load
    local cpu_load=$(uptime | awk -F'load average:' '{print $2}' | awk '{print $1}' | sed 's/,//' 2>/dev/null || echo "N/A")
    log "🔥 CPU Load:       ${WHITE}$cpu_load${NC}"
    
    log ""
}

# Display quick actions
show_quick_actions() {
    log "${WHITE}🔧 QUICK ACTIONS${NC}"
    log "${WHITE}═══════════════════════════════════════════════════════════════${NC}"
    
    if [ "$CONTINUOUS_MODE" = false ]; then
        log "📊 ./unified-monitoring-dashboard.sh --watch     Start continuous monitoring"
        log "🔍 ./outage-recovery-detector.sh --status       Check outage status"
        log "📝 ./outage-status-generator.sh discord         Generate status update"
        log "✅ ./post-outage-recovery-checklist.sh          Run recovery verification"
        log "⚙️  ./setup-dev-environment.sh                   Setup dev environment"
        
        log ""
        log "${GRAY}Commands from project root:${NC}"
        log "🏃 npm start                                     Start IC Mesh server"
        log "🧪 npm test                                      Run test suite"
        log "❤️  npm run health                                Check service health"
        log "📈 node real-time-capacity-monitor.js --check   Detailed capacity analysis"
    fi
    
    log ""
}

# Display detailed diagnostics
show_detailed_diagnostics() {
    if [ "$DETAILED_MODE" = false ]; then
        return
    fi
    
    log "${YELLOW}🔬 DETAILED DIAGNOSTICS${NC}"
    log "${YELLOW}═══════════════════════════════════════════════════════════════${NC}"
    
    # Node details
    if [ "$(get_service_status)" = "up" ]; then
        local status_response=$(curl -s "$API_BASE/status" 2>/dev/null || echo '{}')
        log "📡 Raw Node Status:"
        echo "$status_response" | head -c 200
        log "..."
    fi
    
    # Recent log entries
    local log_file="$PROJECT_ROOT/data/mesh.log"
    if [ -f "$log_file" ]; then
        log ""
        log "📜 Recent Log Entries:"
        tail -3 "$log_file" 2>/dev/null | while IFS= read -r line; do
            log "  ${GRAY}$line${NC}"
        done
    fi
    
    log ""
}

# JSON output mode
show_json_output() {
    local service_status=$(get_service_status)
    local node_metrics=$(get_node_metrics)
    local active_nodes=$(echo "$node_metrics" | cut -d',' -f1)
    local total_nodes=$(echo "$node_metrics" | cut -d',' -f2)
    local pending_jobs=$(get_queue_metrics)
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S UTC')
    
    cat << EOF
{
  "timestamp": "$timestamp",
  "service_status": "$service_status",
  "nodes": {
    "active": $active_nodes,
    "total": $total_nodes
  },
  "jobs": {
    "pending": $pending_jobs
  },
  "health_score": $([ "$active_nodes" -eq 0 ] && echo "0" || echo "$((active_nodes * 25 > 100 ? 100 : active_nodes * 25))")
}
EOF
}

# Main dashboard display
show_dashboard() {
    if [ "$JSON_MODE" = true ]; then
        show_json_output
        return
    fi
    
    clear_screen
    show_header
    show_service_status
    show_capacity_analysis
    show_recent_alerts
    show_system_health
    show_quick_actions
    show_detailed_diagnostics
    
    if [ "$CONTINUOUS_MODE" = true ]; then
        log "${GRAY}Last updated: $(date '+%H:%M:%S') | Next refresh in ${REFRESH_INTERVAL}s${NC}"
    fi
}

# Continuous monitoring mode
run_continuous_monitoring() {
    CONTINUOUS_MODE=true
    
    log "Starting continuous monitoring (${REFRESH_INTERVAL}s intervals)..."
    log "Press Ctrl+C to exit"
    sleep 2
    
    # Trap Ctrl+C for clean exit
    trap 'echo -e "\n\nMonitoring stopped."; exit 0' INT
    
    while true; do
        show_dashboard
        sleep "$REFRESH_INTERVAL"
    done
}

# Print usage information
show_usage() {
    cat << EOF
Usage: $0 [OPTIONS]

IC Mesh Unified Monitoring Dashboard

Options:
  --watch, -w           Continuous monitoring mode (${REFRESH_INTERVAL}s refresh)
  --detailed, -d        Show detailed diagnostics
  --json, -j            Output in JSON format
  --interval N          Set refresh interval (default: ${REFRESH_INTERVAL}s)
  --help, -h            Show this help

Examples:
  $0                    Show dashboard once
  $0 --watch            Continuous monitoring
  $0 --detailed         One-time detailed view
  $0 --json             JSON output for scripts
  $0 --watch --interval 10    Continuous with 10s refresh

Dashboard Sections:
  🌐 Service Status      API health, node count, job queue
  ⚡ Capacity Analysis   Node capabilities and alerts
  🚨 Recent Alerts       Latest monitoring events
  💻 System Health       Resource usage and database status
  🔧 Quick Actions       Common management commands

The dashboard integrates:
  • Real-time capacity monitoring
  • Outage detection and recovery tools
  • System health metrics
  • Alert management
  • Quick action commands
EOF
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --watch|-w)
            CONTINUOUS_MODE=true
            shift
            ;;
        --detailed|-d)
            DETAILED_MODE=true
            shift
            ;;
        --json|-j)
            JSON_MODE=true
            shift
            ;;
        --interval)
            REFRESH_INTERVAL="$2"
            shift 2
            ;;
        --help|-h)
            show_usage
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            show_usage
            exit 1
            ;;
    esac
done

# Change to project directory
cd "$PROJECT_ROOT"

# Run the dashboard
if [ "$CONTINUOUS_MODE" = true ]; then
    run_continuous_monitoring
else
    show_dashboard
fi