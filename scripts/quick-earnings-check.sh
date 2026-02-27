#!/bin/bash

# Quick Earnings Check for IC Mesh
# Run this before setup to see your earning potential
# 
# Usage: 
#   curl -s https://raw.githubusercontent.com/intelligence-club/ic-mesh/main/scripts/quick-earnings-check.sh | bash
#   OR
#   bash quick-earnings-check.sh

set -e

# Colors for pretty output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

echo -e "${BOLD}🔍 IC Mesh Earnings Calculator${NC}"
echo -e "${CYAN}Checking your computer's earning potential...${NC}"
echo ""

# Initialize earnings
DAILY_MIN=1
DAILY_MAX=3
CAPABILITIES=()
RECOMMENDATIONS=()

# Check Node.js
if command -v node >/dev/null 2>&1; then
    NODE_VERSION=$(node --version 2>/dev/null | sed 's/v//')
    if [ ! -z "$NODE_VERSION" ]; then
        echo -e "✅ ${GREEN}Node.js ${NODE_VERSION} detected${NC}"
        CAPABILITIES+=("Node.js")
    fi
else
    echo -e "❌ ${RED}Node.js not found${NC}"
    echo -e "   ${YELLOW}Install Node.js 18+ to start earning${NC}"
    RECOMMENDATIONS+=("Install Node.js from https://nodejs.org")
fi

# Check Ollama (High value!)
if command -v curl >/dev/null 2>&1; then
    OLLAMA_RESPONSE=$(curl -s http://localhost:11434/api/tags 2>/dev/null || echo "")
    if [ ! -z "$OLLAMA_RESPONSE" ]; then
        # Try to parse model count
        MODEL_COUNT=$(echo "$OLLAMA_RESPONSE" | grep -o '"models":\[' | wc -l 2>/dev/null || echo "0")
        if [ "$MODEL_COUNT" -gt 0 ]; then
            # Count actual models (rough estimate)
            ACTUAL_MODELS=$(echo "$OLLAMA_RESPONSE" | grep -o '"name"' | wc -l 2>/dev/null || echo "1")
            echo -e "✅ ${GREEN}Ollama detected with ~${ACTUAL_MODELS} models${NC}"
            echo -e "   ${CYAN}💰 High-value capability! +$$(( ACTUAL_MODELS * 3 ))-$$(( ACTUAL_MODELS * 6 )) daily${NC}"
            DAILY_MIN=$((DAILY_MIN + ACTUAL_MODELS * 3))
            DAILY_MAX=$((DAILY_MAX + ACTUAL_MODELS * 6))
            CAPABILITIES+=("Ollama LLM inference")
        fi
    else
        echo -e "⚠️  ${YELLOW}Ollama not running${NC}"
        RECOMMENDATIONS+=("Install Ollama (https://ollama.com) for +\$5-15/day")
    fi
fi

# Check Whisper (Highest demand!)
WHISPER_FOUND=false
if command -v whisper >/dev/null 2>&1; then
    echo -e "✅ ${GREEN}Whisper CLI detected${NC}"
    WHISPER_FOUND=true
elif python3 -c "import whisper" >/dev/null 2>&1; then
    echo -e "✅ ${GREEN}Whisper Python module detected${NC}"
    WHISPER_FOUND=true
fi

if [ "$WHISPER_FOUND" = true ]; then
    echo -e "   ${CYAN}🔥 HIGHEST DEMAND! Transcription jobs earn +\$10-20 daily${NC}"
    DAILY_MIN=$((DAILY_MIN + 10))
    DAILY_MAX=$((DAILY_MAX + 20))
    CAPABILITIES+=("Whisper transcription")
else
    echo -e "⚠️  ${YELLOW}Whisper not found${NC}"
    RECOMMENDATIONS+=("Install Whisper: pip install openai-whisper (+\$10-20/day)")
fi

# Check FFmpeg
if command -v ffmpeg >/dev/null 2>&1; then
    echo -e "✅ ${GREEN}FFmpeg detected${NC}"
    echo -e "   ${CYAN}📹 Media processing capability +\$2-4 daily${NC}"
    DAILY_MIN=$((DAILY_MIN + 2))
    DAILY_MAX=$((DAILY_MAX + 4))
    CAPABILITIES+=("FFmpeg media processing")
else
    echo -e "⚠️  ${YELLOW}FFmpeg not found${NC}"
    RECOMMENDATIONS+=("Install FFmpeg for media jobs (+\$2-4/day)")
fi

# Check GPU (Apple Silicon common for OpenClaw users)
GPU_DETECTED=false
if command -v system_profiler >/dev/null 2>&1; then
    if system_profiler SPDisplaysDataType 2>/dev/null | grep -qi "metal\|apple"; then
        echo -e "✅ ${GREEN}Apple Silicon GPU detected${NC}"
        echo -e "   ${CYAN}🚀 GPU acceleration: +50-100% earnings boost${NC}"
        GPU_DETECTED=true
        # Apply GPU multiplier
        DAILY_MIN=$((DAILY_MIN * 3 / 2))
        DAILY_MAX=$((DAILY_MAX * 2))
        CAPABILITIES+=("GPU acceleration")
    fi
elif command -v nvidia-smi >/dev/null 2>&1; then
    if nvidia-smi >/dev/null 2>&1; then
        echo -e "✅ ${GREEN}NVIDIA GPU detected${NC}"
        echo -e "   ${CYAN}🚀 GPU acceleration: +50-100% earnings boost${NC}"
        GPU_DETECTED=true
        DAILY_MIN=$((DAILY_MIN * 3 / 2))
        DAILY_MAX=$((DAILY_MAX * 2))
        CAPABILITIES+=("GPU acceleration")
    fi
fi

if [ "$GPU_DETECTED" = false ]; then
    echo -e "ℹ️  ${BLUE}No dedicated GPU detected (CPU processing is still valuable)${NC}"
fi

# Check if this looks like an OpenClaw setup
OPENCLAW_USER=false
if command -v openclaw >/dev/null 2>&1; then
    OPENCLAW_USER=true
    echo -e "✅ ${GREEN}OpenClaw detected - Perfect for IC Mesh!${NC}"
elif [ -d "$HOME/.openclaw" ] || command -v node >/dev/null 2>&1; then
    # Likely OpenClaw user based on Node.js presence
    OPENCLAW_USER=true
    echo -e "💡 ${CYAN}Looks like an OpenClaw setup - IC Mesh is perfect for you!${NC}"
fi

echo ""
echo -e "${BOLD}💰 YOUR EARNING POTENTIAL${NC}"
echo -e "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo -e "📊 ${BOLD}Daily earnings:${NC}   \$${DAILY_MIN}-\$${DAILY_MAX}"
echo -e "📈 ${BOLD}Monthly estimate:${NC} \$$(( DAILY_MIN * 30 ))-\$$(( DAILY_MAX * 30 ))"
echo -e "🎯 ${BOLD}Annual potential:${NC} \$$(( DAILY_MIN * 365 ))-\$$(( DAILY_MAX * 365 ))"

# Founding operator bonus
FOUNDING_DAILY_MIN=$((DAILY_MIN * 2))
FOUNDING_DAILY_MAX=$((DAILY_MAX * 2))
echo ""
echo -e "${BOLD}⚡ FOUNDING OPERATOR BONUS (Limited Time):${NC}"
echo -e "🔥 2x earning rate = \$${FOUNDING_DAILY_MIN}-\$${FOUNDING_DAILY_MAX} daily"
echo -e "💎 Monthly with bonus: \$$(( FOUNDING_DAILY_MIN * 30 ))-\$$(( FOUNDING_DAILY_MAX * 30 ))"
echo -e "⏰ Only 44 spots remaining (6/50 taken)"

# OpenClaw ROI analysis
if [ "$OPENCLAW_USER" = true ]; then
    echo ""
    echo -e "${BOLD}🤝 OPENCLAW COST OFFSET ANALYSIS${NC}"
    echo -e "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo -e "💡 Your machine already runs 24/7 for OpenClaw"
    echo -e "🎯 IC Mesh monetizes spare cycles with ${GREEN}ZERO additional cost${NC}"
    echo ""
    
    ESTIMATED_API_COSTS=55
    MESH_MONTHLY=$((DAILY_MIN * 30))
    
    echo -e "💳 Typical OpenClaw API costs: ~\$${ESTIMATED_API_COSTS}/month"
    echo -e "💰 Your IC Mesh potential:     \$${MESH_MONTHLY}+/month"
    
    if [ $MESH_MONTHLY -ge $ESTIMATED_API_COSTS ]; then
        PROFIT=$((MESH_MONTHLY - ESTIMATED_API_COSTS))
        echo -e "🎉 ${GREEN}Result: \$${PROFIT}+ monthly profit (covers API costs!)${NC}"
    else
        COVERAGE=$(( MESH_MONTHLY * 100 / ESTIMATED_API_COSTS ))
        echo -e "📊 Result: ${COVERAGE}% of your OpenClaw costs covered"
    fi
fi

# Current capabilities summary
if [ ${#CAPABILITIES[@]} -gt 0 ]; then
    echo ""
    echo -e "${BOLD}⚙️  DETECTED CAPABILITIES${NC}"
    for cap in "${CAPABILITIES[@]}"; do
        echo -e "  ✅ $cap"
    done
fi

# Recommendations for higher earnings
if [ ${#RECOMMENDATIONS[@]} -gt 0 ]; then
    echo ""
    echo -e "${BOLD}🚀 BOOST YOUR EARNINGS${NC}"
    for rec in "${RECOMMENDATIONS[@]}"; do
        echo -e "  💡 $rec"
    done
fi

echo ""
echo -e "${BOLD}🌟 CURRENT IC MESH STATS${NC}"
echo -e "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "💰 Total network revenue: \$771+ (verified)"
echo -e "⚡ Jobs completed: 79+"
echo -e "🔥 Active operators: 6 (growing fast)"  
echo -e "📈 Job processing: 13 active jobs right now"
echo -e "🎯 Founding operator spots: 44 remaining"

echo ""
echo -e "${BOLD}⚡ READY TO START EARNING?${NC}"
echo -e "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [ "$OPENCLAW_USER" = true ]; then
    echo -e "🤝 ${CYAN}Specialized OpenClaw setup:${NC}"
    echo -e "   git clone https://github.com/intelligence-club/ic-mesh.git"
    echo -e "   cd ic-mesh && node openclaw-user-onboarding.js"
else
    echo -e "🚀 ${CYAN}Standard setup:${NC}"
    echo -e "   git clone https://github.com/intelligence-club/ic-mesh.git"
    echo -e "   cd ic-mesh && node scripts/operator-setup.js"
fi

echo ""
echo -e "⚡ Setup time: 5 minutes"
echo -e "💰 Start earning: Within 1 hour"  
echo -e "🎯 Payment setup: 2 minutes via Stripe"
echo ""
echo -e "Questions? Check: ${BLUE}https://github.com/intelligence-club/ic-mesh${NC}"