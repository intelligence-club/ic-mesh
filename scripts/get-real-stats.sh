#!/bin/bash
# get-real-stats.sh - API-verified statistics for IC Mesh
# Created by Wingman for accurate revenue/status reporting

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
API_BASE="${API_BASE:-http://localhost:3000}"
DB_PATH="${DB_PATH:-./mesh.db}"

echo "📊 IC Mesh Real Stats - API Verified"
echo "======================================"

# Check if server is running, fallback to database
SERVER_ONLINE=false
if curl -s "$API_BASE/status" > /dev/null 2>&1; then
    SERVER_ONLINE=true
    echo "✅ Using live API data"
    # Get status data
    STATUS_DATA=$(curl -s "$API_BASE/status")
    JOBS_DATA=$(curl -s "$API_BASE/jobs")
else
    echo -e "${YELLOW}⚠️  Server offline, using database directly${NC}"
    
    # Check if sqlite3 is available
    if ! command -v sqlite3 >/dev/null 2>&1; then
        echo -e "${RED}❌ sqlite3 not found. Install with: apt install sqlite3${NC}"
        exit 1
    fi
    
    # Check if database exists
    if [ ! -f "$DB_PATH" ]; then
        echo -e "${RED}❌ Database not found at $DB_PATH${NC}"
        exit 1
    fi
fi

# Extract key metrics
if [ "$SERVER_ONLINE" = true ]; then
    # Parse API data
    if command -v jq >/dev/null 2>&1; then
        # Parse with jq for accuracy
        TOTAL_JOBS=$(echo "$STATUS_DATA" | jq -r '.jobs.total // 0')
        PENDING_JOBS=$(echo "$STATUS_DATA" | jq -r '.jobs.pending // 0')  
        ACTIVE_NODES=$(echo "$STATUS_DATA" | jq -r '.nodes.active // 0')
        TOTAL_NODES=$(echo "$STATUS_DATA" | jq -r '.nodes.total // 0')
        HEALTH_STATUS=$(echo "$STATUS_DATA" | jq -r '.status // "unknown"')
    else
        # Fallback parsing without jq
        TOTAL_JOBS=$(echo "$STATUS_DATA" | grep -o '"total":[0-9]*' | head -1 | cut -d: -f2)
        PENDING_JOBS=$(echo "$STATUS_DATA" | grep -o '"pending":[0-9]*' | head -1 | cut -d: -f2)
        ACTIVE_NODES=$(echo "$STATUS_DATA" | grep -o '"active":[0-9]*' | head -1 | cut -d: -f2)
        TOTAL_NODES=$(echo "$STATUS_DATA" | grep -o '"total":[0-9]*' | tail -1 | cut -d: -f2)
        HEALTH_STATUS=$(echo "$STATUS_DATA" | grep -o '"status":"[^"]*' | cut -d'"' -f4 || echo "unknown")
        
        # Defaults if parsing failed
        TOTAL_JOBS=${TOTAL_JOBS:-0}
        PENDING_JOBS=${PENDING_JOBS:-0}
        ACTIVE_NODES=${ACTIVE_NODES:-0}
        TOTAL_NODES=${TOTAL_NODES:-0}
    fi
else
    # Query database directly
    echo "Querying database..."
    
    TOTAL_JOBS=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM jobs;" 2>/dev/null || echo "0")
    PENDING_JOBS=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM jobs WHERE status = 'pending';" 2>/dev/null || echo "0")
    COMPLETED_JOBS=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM jobs WHERE status = 'completed';" 2>/dev/null || echo "0")
    
    # Node stats
    TOTAL_NODES=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM nodes;" 2>/dev/null || echo "0")
    
    # Active nodes (heartbeat within last 5 minutes)
    FIVE_MINUTES_AGO=$(date -d '5 minutes ago' +%s 2>/dev/null || echo $(($(date +%s) - 300)))
    ACTIVE_NODES=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM nodes WHERE lastSeen > $FIVE_MINUTES_AGO;" 2>/dev/null || echo "0")
    
    HEALTH_STATUS="database-only"
    
    # Revenue calculation from ledger if available
    REVENUE_FROM_LEDGER=$(sqlite3 "$DB_PATH" "SELECT COALESCE(SUM(CAST(amount AS REAL)), 0) FROM ledger WHERE amount > 0;" 2>/dev/null || echo "0")
    
    # If no ledger data, estimate from completed jobs
    if [ "$REVENUE_FROM_LEDGER" = "0" ] || [ -z "$REVENUE_FROM_LEDGER" ]; then
        ESTIMATED_REVENUE=$(echo "$COMPLETED_JOBS * 0.50" | bc -l 2>/dev/null || echo "$((COMPLETED_JOBS / 2)).00")
    else
        ESTIMATED_REVENUE="$REVENUE_FROM_LEDGER"
    fi
fi

# Calculate completed jobs if not set
if [ -z "$COMPLETED_JOBS" ]; then
    COMPLETED_JOBS=$((TOTAL_JOBS - PENDING_JOBS))
fi

# Calculate revenue if not set
if [ -z "$ESTIMATED_REVENUE" ]; then
    ESTIMATED_REVENUE=$(echo "$COMPLETED_JOBS * 0.50" | bc -l 2>/dev/null || echo "$((COMPLETED_JOBS / 2)).00")
fi

# Database size (if accessible)
if [ -f "$DB_PATH" ]; then
    DB_SIZE=$(du -h "$DB_PATH" | cut -f1)
else
    DB_SIZE="N/A"
fi

# Output results
echo ""
echo -e "${GREEN}💰 REVENUE METRICS${NC}"
echo "Jobs completed: $COMPLETED_JOBS"
echo "Estimated revenue: \$${ESTIMATED_REVENUE}+"
echo "Jobs pending: $PENDING_JOBS"
echo ""
echo -e "${GREEN}🏗️ INFRASTRUCTURE${NC}"
echo "Active nodes: $ACTIVE_NODES/$TOTAL_NODES"
echo "System health: $HEALTH_STATUS"
echo "Database size: $DB_SIZE"
echo ""
echo -e "${GREEN}📈 CAPACITY${NC}"
if [ "$PENDING_JOBS" -gt 0 ] && [ "$ACTIVE_NODES" -gt 0 ]; then
    echo "Status: Processing ($PENDING_JOBS jobs in queue)"
elif [ "$PENDING_JOBS" -eq 0 ]; then
    echo "Status: All jobs processed ✅"
else
    echo -e "${YELLOW}Status: No active nodes${NC}"
fi

# Verification timestamp
echo ""
echo "Verified: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
if [ "$SERVER_ONLINE" = true ]; then
    echo "Source: $API_BASE/status (Live API)"
else
    echo "Source: $DB_PATH (Database Direct)"
fi

# Optional: Export for scripts
if [ "$1" = "--export" ]; then
    cat > /tmp/ic-mesh-stats.env <<EOF
COMPLETED_JOBS=$COMPLETED_JOBS
ESTIMATED_REVENUE=$ESTIMATED_REVENUE
PENDING_JOBS=$PENDING_JOBS
ACTIVE_NODES=$ACTIVE_NODES
TOTAL_NODES=$TOTAL_NODES
HEALTH_STATUS=$HEALTH_STATUS
VERIFICATION_TIME=$(date -u +%s)
EOF
    echo "Stats exported to /tmp/ic-mesh-stats.env"
fi

# Optional: JSON output
if [ "$1" = "--json" ]; then
    cat <<EOF
{
  "jobs": {
    "completed": $COMPLETED_JOBS,
    "pending": $PENDING_JOBS,
    "total": $TOTAL_JOBS
  },
  "revenue": {
    "estimated": $ESTIMATED_REVENUE,
    "currency": "USD"
  },
  "nodes": {
    "active": $ACTIVE_NODES,
    "total": $TOTAL_NODES
  },
  "system": {
    "health": "$HEALTH_STATUS",
    "database_size": "$DB_SIZE"
  },
  "verification": {
    "timestamp": "$(date -u '+%Y-%m-%d %H:%M:%S UTC')",
    "source": "$API_BASE"
  }
}
EOF
fi