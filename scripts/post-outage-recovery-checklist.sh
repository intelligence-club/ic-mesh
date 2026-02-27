#!/bin/bash

# post-outage-recovery-checklist.sh - Post-Outage Recovery Verification
# Comprehensive checklist to verify service health after outage recovery
# Ensures all systems are operating correctly when nodes come back online

set -e

SCRIPT_DIR="$(dirname "$0")"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
API_BASE="http://localhost:8333/api"
RECOVERY_LOG="$PROJECT_ROOT/recovery-verification.log"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S UTC')

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test results tracking
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

log() {
    echo -e "${1}" | tee -a "$RECOVERY_LOG"
}

log_test() {
    local status="$1"
    local test_name="$2"
    local details="$3"
    
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    
    if [ "$status" = "PASS" ]; then
        PASSED_TESTS=$((PASSED_TESTS + 1))
        log "${GREEN}✅ PASS${NC} | $test_name"
        [ -n "$details" ] && log "     $details"
    elif [ "$status" = "FAIL" ]; then
        FAILED_TESTS=$((FAILED_TESTS + 1))
        log "${RED}❌ FAIL${NC} | $test_name"
        [ -n "$details" ] && log "     ${RED}$details${NC}"
    elif [ "$status" = "WARN" ]; then
        log "${YELLOW}⚠️  WARN${NC} | $test_name"
        [ -n "$details" ] && log "     ${YELLOW}$details${NC}"
    elif [ "$status" = "INFO" ]; then
        log "${BLUE}ℹ️  INFO${NC} | $test_name"
        [ -n "$details" ] && log "     $details"
    fi
}

# API Health Tests
test_api_connectivity() {
    log ""
    log "${BLUE}🔍 API Connectivity Tests${NC}"
    log "========================"
    
    # Basic ping test
    if curl -s -f "$API_BASE/health" > /dev/null 2>&1; then
        log_test "PASS" "API Health Endpoint" "Responding correctly"
    else
        log_test "FAIL" "API Health Endpoint" "Not responding or returning errors"
        return 1
    fi
    
    # Status endpoint test
    if status_response=$(curl -s "$API_BASE/status" 2>/dev/null); then
        log_test "PASS" "API Status Endpoint" "Returns data: $(echo "$status_response" | head -c 50)..."
    else
        log_test "FAIL" "API Status Endpoint" "Failed to retrieve status"
    fi
    
    # Jobs endpoint test
    if curl -s -f "$API_BASE/jobs/pending" > /dev/null 2>&1; then
        log_test "PASS" "Jobs API Endpoint" "Responding correctly"
    else
        log_test "WARN" "Jobs API Endpoint" "May have issues or no pending jobs"
    fi
}

# Node Status Tests
test_node_capacity() {
    log ""
    log "${BLUE}🔌 Node Capacity Tests${NC}"
    log "====================="
    
    local status_response=$(curl -s "$API_BASE/status" 2>/dev/null || echo '{}')
    local active_count=$(echo "$status_response" | grep -o '"active":true' | wc -l || echo "0")
    local total_count=$(echo "$status_response" | grep -o '"lastSeen":' | wc -l || echo "0")
    
    # Active node count
    if [ "$active_count" -gt 0 ]; then
        log_test "PASS" "Active Nodes" "$active_count active out of $total_count registered"
    else
        log_test "FAIL" "Active Nodes" "No active nodes detected - service still in outage"
        return 1
    fi
    
    # Node retention analysis
    local retention_rate=0
    if [ "$total_count" -gt 0 ]; then
        retention_rate=$((active_count * 100 / total_count))
    fi
    
    if [ "$retention_rate" -ge 50 ]; then
        log_test "PASS" "Node Retention" "${retention_rate}% retention rate"
    elif [ "$retention_rate" -ge 25 ]; then
        log_test "WARN" "Node Retention" "${retention_rate}% retention rate - consider investigating churn"
    else
        log_test "WARN" "Node Retention" "${retention_rate}% retention rate - high churn detected"
    fi
}

# Job Queue Tests
test_job_processing() {
    log ""
    log "${BLUE}📋 Job Processing Tests${NC}"
    log "======================="
    
    local queue_response=$(curl -s "$API_BASE/jobs/pending" 2>/dev/null || echo '[]')
    local pending_count=$(echo "$queue_response" | grep -o '"status":"pending"' | wc -l || echo "0")
    
    # Pending job analysis
    if [ "$pending_count" -eq 0 ]; then
        log_test "PASS" "Job Queue" "No backlog - queue processed successfully"
    elif [ "$pending_count" -lt 20 ]; then
        log_test "PASS" "Job Queue" "$pending_count pending jobs - normal operational level"
    elif [ "$pending_count" -lt 50 ]; then
        log_test "WARN" "Job Queue" "$pending_count pending jobs - elevated but manageable"
    else
        log_test "WARN" "Job Queue" "$pending_count pending jobs - significant backlog needs attention"
    fi
    
    # Job processing capability test
    local capabilities=$(echo "$queue_response" | grep -o '"capability":"[^"]*"' | sort | uniq || echo "")
    if [ -n "$capabilities" ]; then
        log_test "INFO" "Required Capabilities" "Jobs need: $(echo "$capabilities" | sed 's/"capability":"//g' | sed 's/"//g' | tr '\n' ' ')"
    fi
}

# Database Health Tests
test_database_integrity() {
    log ""
    log "${BLUE}💾 Database Health Tests${NC}"
    log "========================"
    
    local db_path="$PROJECT_ROOT/data/mesh.db"
    
    # Database file existence
    if [ -f "$db_path" ]; then
        log_test "PASS" "Database File" "Found at $db_path"
        
        # Database size check
        local db_size=$(du -h "$db_path" | cut -f1)
        log_test "INFO" "Database Size" "$db_size"
    else
        log_test "FAIL" "Database File" "Missing at $db_path"
        return 1
    fi
    
    # Recent backup check
    local backup_files=$(ls "$PROJECT_ROOT/data/mesh.db.backup."* 2>/dev/null | wc -l || echo "0")
    if [ "$backup_files" -gt 0 ]; then
        local latest_backup=$(ls -t "$PROJECT_ROOT/data/mesh.db.backup."* 2>/dev/null | head -1 || echo "none")
        if [ -n "$latest_backup" ] && [ "$latest_backup" != "none" ]; then
            local backup_age=$(stat -c %Y "$latest_backup" 2>/dev/null || echo "0")
            local current_time=$(date +%s)
            local age_hours=$(((current_time - backup_age) / 3600))
            
            if [ "$age_hours" -lt 24 ]; then
                log_test "PASS" "Database Backup" "Recent backup exists (${age_hours}h old)"
            else
                log_test "WARN" "Database Backup" "Backup exists but is ${age_hours}h old"
            fi
        fi
    else
        log_test "WARN" "Database Backup" "No backups found - consider running backup"
    fi
}

# Performance Tests  
test_system_performance() {
    log ""
    log "${BLUE}⚡ Performance Tests${NC}"
    log "===================="
    
    # API response time test
    local start_time=$(date +%s%3N)
    if curl -s -f "$API_BASE/health" > /dev/null 2>&1; then
        local end_time=$(date +%s%3N)
        local response_time=$((end_time - start_time))
        
        if [ "$response_time" -lt 100 ]; then
            log_test "PASS" "API Response Time" "${response_time}ms - excellent"
        elif [ "$response_time" -lt 500 ]; then
            log_test "PASS" "API Response Time" "${response_time}ms - good"
        elif [ "$response_time" -lt 1000 ]; then
            log_test "WARN" "API Response Time" "${response_time}ms - acceptable but slow"
        else
            log_test "WARN" "API Response Time" "${response_time}ms - performance issues detected"
        fi
    else
        log_test "FAIL" "API Response Time" "Could not measure - API not responding"
    fi
    
    # System resource check
    local cpu_usage=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | sed 's/%us,//' || echo "unknown")
    local memory_usage=$(free | grep Mem | awk '{printf "%.1f", $3/$2 * 100.0}' || echo "unknown")
    
    log_test "INFO" "System Resources" "CPU: ${cpu_usage}% | Memory: ${memory_usage}%"
}

# Recovery Actions Test
test_recovery_actions() {
    log ""
    log "${BLUE}🔄 Recovery Actions Test${NC}"
    log "========================"
    
    # Check if monitoring tools are available
    if [ -x "$PROJECT_ROOT/scripts/outage-recovery-detector.sh" ]; then
        log_test "PASS" "Outage Recovery Detector" "Tool available for future monitoring"
    else
        log_test "WARN" "Outage Recovery Detector" "Tool not found or not executable"
    fi
    
    # Check if health monitoring scripts exist
    local health_scripts=$(find "$PROJECT_ROOT" -name "*health*" -o -name "*monitor*" | wc -l)
    if [ "$health_scripts" -gt 0 ]; then
        log_test "PASS" "Health Monitoring Tools" "$health_scripts monitoring tools available"
    else
        log_test "WARN" "Health Monitoring Tools" "No monitoring tools detected"
    fi
    
    # Test if we can enable continuous monitoring
    if "$PROJECT_ROOT/scripts/outage-recovery-detector.sh" --check > /dev/null 2>&1; then
        log_test "PASS" "Continuous Monitoring" "Ready to start continuous outage detection"
    else
        log_test "WARN" "Continuous Monitoring" "Recovery detector may need configuration"
    fi
}

# Generate Recovery Summary
generate_summary() {
    log ""
    log "${BLUE}📊 Post-Outage Recovery Summary${NC}"
    log "==============================="
    
    local success_rate=0
    if [ "$TOTAL_TESTS" -gt 0 ]; then
        success_rate=$((PASSED_TESTS * 100 / TOTAL_TESTS))
    fi
    
    log "🧪 Total Tests: $TOTAL_TESTS"
    log "✅ Passed: $PASSED_TESTS"
    log "❌ Failed: $FAILED_TESTS"
    log "📈 Success Rate: ${success_rate}%"
    
    if [ "$FAILED_TESTS" -eq 0 ]; then
        log ""
        log "${GREEN}🎉 RECOVERY SUCCESSFUL${NC}"
        log "Service appears to be fully operational after outage"
        
        # Recommendations for stable operation
        log ""
        log "${BLUE}💡 Recommendations for Stable Operation:${NC}"
        log "1. Start continuous monitoring: ./scripts/outage-recovery-detector.sh --monitor"
        log "2. Set up regular health checks: npm run health (every 15 minutes)"
        log "3. Monitor node retention patterns for early warning signs"
        log "4. Consider implementing automated node revival procedures"
        
    elif [ "$success_rate" -ge 80 ]; then
        log ""
        log "${YELLOW}⚠️  PARTIAL RECOVERY${NC}"
        log "Service is mostly operational but some issues remain"
        log "Review failed tests above and address critical issues"
        
    else
        log ""
        log "${RED}🚨 RECOVERY INCOMPLETE${NC}"
        log "Significant issues remain - service may still be degraded"
        log "Address failed tests before considering service fully recovered"
    fi
    
    log ""
    log "Recovery verification completed at: $TIMESTAMP"
    log "Full log available at: $RECOVERY_LOG"
}

# Main execution
main() {
    echo "🔄 Post-Outage Recovery Verification"
    echo "====================================="
    echo "Timestamp: $TIMESTAMP"
    echo ""
    
    # Initialize log
    echo "Post-Outage Recovery Verification - $TIMESTAMP" > "$RECOVERY_LOG"
    echo "=============================================" >> "$RECOVERY_LOG"
    
    # Run all test suites
    if test_api_connectivity; then
        test_node_capacity
        test_job_processing
        test_database_integrity
        test_system_performance
        test_recovery_actions
    else
        log_test "FAIL" "Recovery Verification" "API not available - service may still be in outage"
    fi
    
    generate_summary
    
    # Return appropriate exit code
    if [ "$FAILED_TESTS" -eq 0 ]; then
        exit 0
    else
        exit 1
    fi
}

# Handle command line options
case "${1:-}" in
    --help|-h)
        echo "Usage: $0 [OPTIONS]"
        echo ""
        echo "Post-outage recovery verification for IC Mesh service"
        echo ""
        echo "Options:"
        echo "  --help, -h      Show this help"
        echo ""
        echo "This tool runs a comprehensive verification checklist after"
        echo "service recovery from a complete outage. It tests:"
        echo ""
        echo "  • API connectivity and responsiveness"
        echo "  • Node capacity and retention"
        echo "  • Job processing capability"
        echo "  • Database integrity"
        echo "  • System performance"
        echo "  • Recovery tool availability"
        echo ""
        echo "Results are logged to: $RECOVERY_LOG"
        echo ""
        ;;
    *)
        main
        ;;
esac