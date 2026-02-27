#!/bin/bash
# IC Mesh Operator Dashboard
# Quick health check for node operators
# Created by Wingman 🤝

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
API_BASE="https://moilol.com:8333"
SITE_BASE="https://moilol.com"

echo -e "${BLUE}🤝 IC Mesh Operator Dashboard${NC}"
echo "=================================="
echo

# Check if node config exists
if [[ ! -f "node-config.json" ]]; then
    echo -e "${RED}❌ node-config.json not found${NC}"
    echo "Run this script from your ic-mesh directory"
    exit 1
fi

# Get node ID from config
NODE_ID=$(jq -r '.nodeId // .id // "unknown"' node-config.json)
echo -e "${BLUE}🆔 Node ID:${NC} ${NODE_ID:0:8}..."

# Check network connectivity
echo
echo -e "${BLUE}🌐 Network Connectivity${NC}"
echo "------------------------"

if curl -s --max-time 5 "$API_BASE/health" > /dev/null; then
    echo -e "${GREEN}✅ IC Mesh API reachable${NC}"
else
    echo -e "${RED}❌ IC Mesh API unreachable${NC}"
fi

if curl -s --max-time 5 "$SITE_BASE" > /dev/null; then
    echo -e "${GREEN}✅ Main site reachable${NC}"
else
    echo -e "${RED}❌ Main site unreachable${NC}"
fi

# Get node status from network
echo
echo -e "${BLUE}📊 Node Network Status${NC}"
echo "----------------------"

NODE_STATUS=$(curl -s --max-time 10 "$API_BASE/nodes" | jq -r ".[] | select(.id==\"$NODE_ID\")" 2>/dev/null || echo "{}")

if [[ "$NODE_STATUS" == "{}" ]]; then
    echo -e "${RED}❌ Node not found in network${NC}"
else
    LAST_SEEN=$(echo "$NODE_STATUS" | jq -r '.lastSeen // "unknown"')
    STATUS=$(echo "$NODE_STATUS" | jq -r '.status // "unknown"')
    QUARANTINED=$(echo "$NODE_STATUS" | jq -r '.quarantined // false')
    
    echo -e "Status: ${GREEN}$STATUS${NC}"
    echo -e "Last seen: $LAST_SEEN"
    
    if [[ "$QUARANTINED" == "true" ]]; then
        echo -e "${RED}⚠️  Node is QUARANTINED${NC}"
        echo "   Check performance and fix issues"
    else
        echo -e "${GREEN}✅ Node is active${NC}"
    fi
fi

# Check local node performance
echo
echo -e "${BLUE}💻 Local Node Health${NC}"
echo "--------------------"

# Check if node process is running
if pgrep -f "node.*client" > /dev/null; then
    echo -e "${GREEN}✅ Node client running${NC}"
else
    echo -e "${RED}❌ Node client not running${NC}"
    echo "   Start with: node client.js"
fi

# Check disk space
DISK_USAGE=$(df . | tail -1 | awk '{print $5}' | sed 's/%//')
if [[ $DISK_USAGE -lt 80 ]]; then
    echo -e "${GREEN}✅ Disk space: ${DISK_USAGE}%${NC}"
elif [[ $DISK_USAGE -lt 90 ]]; then
    echo -e "${YELLOW}⚠️  Disk space: ${DISK_USAGE}%${NC}"
else
    echo -e "${RED}❌ Disk space critical: ${DISK_USAGE}%${NC}"
fi

# Check memory
MEM_USAGE=$(free | grep Mem | awk '{print int($3/$2 * 100)}')
if [[ $MEM_USAGE -lt 80 ]]; then
    echo -e "${GREEN}✅ Memory usage: ${MEM_USAGE}%${NC}"
elif [[ $MEM_USAGE -lt 90 ]]; then
    echo -e "${YELLOW}⚠️  Memory usage: ${MEM_USAGE}%${NC}"
else
    echo -e "${RED}❌ Memory usage critical: ${MEM_USAGE}%${NC}"
fi

# Check key dependencies
echo
echo -e "${BLUE}🔧 Dependencies${NC}"
echo "---------------"

# Check Python/Whisper
if python3 -c "import whisper" 2>/dev/null; then
    echo -e "${GREEN}✅ Whisper (transcription)${NC}"
else
    echo -e "${RED}❌ Whisper missing${NC} - install: pip3 install openai-whisper"
fi

# Check FFmpeg
if command -v ffmpeg &> /dev/null; then
    echo -e "${GREEN}✅ FFmpeg (audio processing)${NC}"
else
    echo -e "${RED}❌ FFmpeg missing${NC} - install: brew install ffmpeg (macOS) or apt install ffmpeg (Linux)"
fi

# Check Tesseract
if command -v tesseract &> /dev/null; then
    echo -e "${GREEN}✅ Tesseract (OCR)${NC}"
else
    echo -e "${RED}❌ Tesseract missing${NC} - install: brew install tesseract (macOS) or apt install tesseract-ocr (Linux)"
fi

# Check recent earnings (if node is registered)
echo
echo -e "${BLUE}💰 Earnings Overview${NC}"
echo "-------------------"

EARNINGS_RESPONSE=$(curl -s --max-time 10 "$SITE_BASE/api/nodes/$NODE_ID/earnings" 2>/dev/null || echo "{}")
TOTAL_EARNINGS=$(echo "$EARNINGS_RESPONSE" | jq -r '.totalEarnings // "0"' 2>/dev/null || echo "0")
JOBS_COMPLETED=$(echo "$EARNINGS_RESPONSE" | jq -r '.jobsCompleted // "0"' 2>/dev/null || echo "0")

if [[ "$TOTAL_EARNINGS" != "0" ]]; then
    echo -e "Total earnings: ${GREEN}\$${TOTAL_EARNINGS}${NC}"
    echo -e "Jobs completed: $JOBS_COMPLETED"
else
    echo -e "${YELLOW}No earnings data available${NC}"
    echo "Make sure your node is properly registered"
fi

# Quick action suggestions
echo
echo -e "${BLUE}🎯 Quick Actions${NC}"
echo "----------------"

if [[ "$QUARANTINED" == "true" ]]; then
    echo "• Fix performance issues to get unquarantined"
    echo "• Check handler logs for error patterns"
fi

if ! pgrep -f "node.*client" > /dev/null; then
    echo "• Start your node: node client.js"
fi

if [[ ! -f "handlers/transcribe.js" ]]; then
    echo "• Update to latest client with all handlers"
fi

echo "• Monitor performance: watch -n 30 ./operator-dashboard.sh"
echo "• Full diagnostics: node tools/comprehensive-node-diagnosis.js"

echo
echo -e "${GREEN}Dashboard complete!${NC} 🚀"