#!/bin/bash
# quick-health.sh - Fast system health verification

echo "🏥 IC Mesh Quick Health Check"
echo "============================"

# Test server connectivity
echo -n "Server connection: "
if curl -s --max-time 5 http://localhost:8333/status > /dev/null; then
    echo "✅ OK"
else
    echo "❌ FAILED"
    exit 1
fi

# Get current stats
STATUS=$(curl -s http://localhost:8333/status)
ACTIVE_NODES=$(echo "$STATUS" | jq -r '.nodes.active // 0')
PENDING_JOBS=$(echo "$STATUS" | jq -r '.jobs.pending // 0')
COMPLETED_JOBS=$(echo "$STATUS" | jq -r '.jobs.completed // 0')

echo "Active nodes: $ACTIVE_NODES"
echo "Pending jobs: $PENDING_JOBS" 
echo "Completed jobs: $COMPLETED_JOBS"

# Test job availability for a sample node
echo -n "Job availability: "
AVAILABLE_JOBS=$(curl -s "http://localhost:8333/jobs/available?nodeId=4a5cde9ebc1a473a" | jq -r '.count // 0')
if [ "$AVAILABLE_JOBS" -gt 0 ] || [ "$PENDING_JOBS" -eq 0 ]; then
    echo "✅ OK ($AVAILABLE_JOBS jobs available)"
else
    echo "⚠️  Warning: $PENDING_JOBS pending but 0 available"
fi

# Overall health assessment
if [ "$ACTIVE_NODES" -gt 0 ] && ([ "$AVAILABLE_JOBS" -gt 0 ] || [ "$PENDING_JOBS" -eq 0 ]); then
    echo ""
    echo "🎯 System Status: HEALTHY"
    echo "   ✅ Server responding"
    echo "   ✅ Nodes active ($ACTIVE_NODES)"
    echo "   ✅ Job processing working"
else
    echo ""
    echo "⚠️  System Status: DEGRADED" 
    echo "   Server: OK, Nodes: $ACTIVE_NODES, Job matching: needs attention"
    exit 1
fi