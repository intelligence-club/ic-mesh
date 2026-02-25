#!/bin/bash
# Onboarding Diagnostic Tool for IC Mesh Nodes
# Identifies common issues that cause nodes to disconnect within first hour

echo "🔍 IC Mesh Node Onboarding Diagnostic"
echo "====================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Default mesh server endpoint
MESH_SERVER="${MESH_SERVER:-http://localhost:8333}"
NODE_ID="${NODE_ID:-$(hostname)-$(date +%s)}"

echo "Node ID: $NODE_ID"
echo "Mesh Server: $MESH_SERVER"
echo ""

# Test 1: Network connectivity
echo "📡 Test 1: Network Connectivity"
echo "------------------------------"
if curl -s --connect-timeout 5 "$MESH_SERVER/status" > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} Can reach mesh server at $MESH_SERVER"
else
    echo -e "${RED}✗${NC} Cannot reach mesh server at $MESH_SERVER"
    echo "   Possible causes:"
    echo "   - Server is down"
    echo "   - Firewall blocking connection"
    echo "   - Wrong MESH_SERVER endpoint"
    echo "   - Network connectivity issues"
    exit 1
fi

# Test 2: API endpoint validation
echo ""
echo "🔌 Test 2: API Endpoint Validation"
echo "----------------------------------"
STATUS_RESPONSE=$(curl -s "$MESH_SERVER/status" 2>/dev/null)
if echo "$STATUS_RESPONSE" | grep -q "Intelligence Club Mesh"; then
    echo -e "${GREEN}✓${NC} Mesh server responding correctly"
    
    # Extract node count for reference
    if echo "$STATUS_RESPONSE" | grep -q '"active"'; then
        ACTIVE_NODES=$(echo "$STATUS_RESPONSE" | grep -o '"active":[0-9]*' | cut -d':' -f2)
        TOTAL_NODES=$(echo "$STATUS_RESPONSE" | grep -o '"total":[0-9]*' | cut -d':' -f2)
        echo "   Network status: $ACTIVE_NODES active / $TOTAL_NODES total nodes"
    fi
else
    echo -e "${RED}✗${NC} Mesh server responding but with unexpected format"
    echo "   Response: $STATUS_RESPONSE"
fi

# Test 3: Node registration simulation
echo ""
echo "📝 Test 3: Node Registration Test"
echo "--------------------------------"

# Create test node registration payload
REG_PAYLOAD=$(cat << EOF
{
  "nodeId": "$NODE_ID",
  "name": "diagnostic-test",
  "ip": "$(curl -s ifconfig.me 2>/dev/null || echo '127.0.0.1')",
  "capabilities": ["test"],
  "models": [],
  "cpuCores": $(nproc),
  "ramMB": $(free -m | awk '/^Mem:/ {print $2}'),
  "ramFreeMB": $(free -m | awk '/^Mem:/ {print $7}'),
  "cpuIdle": 90,
  "owner": "diagnostic",
  "region": "test"
}
EOF
)

REG_RESPONSE=$(curl -s -X POST \
  -H "Content-Type: application/json" \
  -d "$REG_PAYLOAD" \
  "$MESH_SERVER/nodes/register" 2>/dev/null)

if echo "$REG_RESPONSE" | grep -q "success\|registered\|$NODE_ID"; then
    echo -e "${GREEN}✓${NC} Node registration successful"
else
    echo -e "${RED}✗${NC} Node registration failed"
    echo "   Response: $REG_RESPONSE"
    echo "   Check server logs for authentication/validation errors"
fi

# Test 4: Job availability check
echo ""
echo "💼 Test 4: Job Availability Check"
echo "--------------------------------"
JOBS_RESPONSE=$(curl -s "$MESH_SERVER/jobs/available" 2>/dev/null)
if echo "$JOBS_RESPONSE" | grep -q '\[\]'; then
    echo -e "${YELLOW}⚠${NC} No jobs currently available (this is normal)"
    echo "   Node would be idle until jobs arrive"
elif echo "$JOBS_RESPONSE" | grep -q '"jobId"'; then
    echo -e "${GREEN}✓${NC} Jobs available for processing"
    JOB_COUNT=$(echo "$JOBS_RESPONSE" | grep -o '"jobId"' | wc -l)
    echo "   $JOB_COUNT jobs in queue"
else
    echo -e "${RED}✗${NC} Error retrieving job queue"
    echo "   Response: $JOBS_RESPONSE"
fi

# Test 5: System resource check
echo ""
echo "💻 Test 5: System Resource Check"  
echo "-------------------------------"
CPU_CORES=$(nproc)
RAM_MB=$(free -m | awk '/^Mem:/ {print $2}')
RAM_FREE_MB=$(free -m | awk '/^Mem:/ {print $7}')
DISK_FREE_GB=$(df -BG / | awk 'NR==2 {print $4}' | sed 's/G//')
CPU_USAGE=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | sed 's/%us,//')

echo "   CPU Cores: $CPU_CORES"
echo "   Total RAM: ${RAM_MB}MB"
echo "   Free RAM: ${RAM_FREE_MB}MB ($(($RAM_FREE_MB * 100 / $RAM_MB))%)"
echo "   Free Disk: ${DISK_FREE_GB}GB"

# Resource warnings
if [ "$RAM_FREE_MB" -lt 500 ]; then
    echo -e "   ${YELLOW}⚠${NC} Low free RAM (<500MB) - may cause job failures"
fi

if [ "$DISK_FREE_GB" -lt 2 ]; then
    echo -e "   ${YELLOW}⚠${NC} Low disk space (<2GB) - may cause storage issues"
fi

if [ "$CPU_CORES" -lt 2 ]; then
    echo -e "   ${YELLOW}⚠${NC} Low CPU cores (<2) - limited processing capacity"
fi

# Test 6: Required dependencies
echo ""
echo "🔧 Test 6: Dependency Check"
echo "---------------------------"

# Check for common dependencies
DEPS=("node" "curl" "ffmpeg")
for dep in "${DEPS[@]}"; do
    if command -v "$dep" > /dev/null 2>&1; then
        echo -e "   ${GREEN}✓${NC} $dep installed"
    else
        echo -e "   ${RED}✗${NC} $dep missing"
    fi
done

# Summary
echo ""
echo "📋 Diagnostic Summary"
echo "===================="

# Count passed tests
TOTAL_TESTS=6
echo "Diagnostic completed. Review any issues above."
echo ""
echo "💡 Common fixes for failed nodes:"
echo "- Update MESH_SERVER environment variable"
echo "- Check firewall settings (port 8333)"  
echo "- Ensure sufficient RAM (>500MB free)"
echo "- Install missing dependencies"
echo "- Verify internet connectivity"

echo ""
echo "🔄 To retry after fixes:"
echo "   MESH_SERVER=$MESH_SERVER NODE_ID=$NODE_ID ./onboarding-diagnostic.sh"