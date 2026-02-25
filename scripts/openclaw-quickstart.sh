#!/bin/bash

# OpenClaw IC Mesh Quick Start
# Automates the setup process for OpenClaw operators

set -e  # Exit on any error

echo "🤝 OpenClaw IC Mesh Quick Start"
echo "=============================="
echo ""

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: Run this script from the ic-mesh directory"
    echo "   git clone https://github.com/your-org/ic-mesh"
    echo "   cd ic-mesh"
    echo "   ./scripts/openclaw-quickstart.sh"
    exit 1
fi

# Check Node.js version
echo "🔍 Checking Node.js version..."
NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js 18+ required. Found: $(node --version)"
    echo "   Install from: https://nodejs.org"
    exit 1
fi
echo "✅ Node.js $(node --version) OK"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
    echo "✅ Dependencies installed"
else
    echo "✅ Dependencies already installed"
fi

# Create config file if it doesn't exist
if [ ! -f "node-config.json" ]; then
    echo "⚙️  Creating configuration file..."
    
    # Generate a unique node ID based on hostname and random string
    NODE_ID="openclaw-$(hostname)-$(openssl rand -hex 4)"
    
    # Detect capabilities automatically
    CAPABILITIES=()
    
    # Check for transcription capability
    if command -v whisper &> /dev/null || command -v ffmpeg &> /dev/null; then
        CAPABILITIES+=("transcribe")
        echo "   📻 Found transcription capability (whisper/ffmpeg)"
    fi
    
    # Check for Ollama
    if command -v ollama &> /dev/null; then
        CAPABILITIES+=("ollama")
        echo "   🧠 Found Ollama capability"
    fi
    
    # Check for GPU (simplified detection)
    if lspci 2>/dev/null | grep -i nvidia &> /dev/null; then
        CAPABILITIES+=("gpu-cuda")
        echo "   🎮 Found NVIDIA GPU capability"
    fi
    
    if system_profiler SPDisplaysDataType 2>/dev/null | grep -i metal &> /dev/null; then
        CAPABILITIES+=("gpu-metal")
        echo "   🍎 Found Metal GPU capability"
    fi
    
    # If no capabilities found, add transcribe as default
    if [ ${#CAPABILITIES[@]} -eq 0 ]; then
        CAPABILITIES+=("transcribe")
        echo "   📻 Added transcription capability (default)"
    fi
    
    # Get system resources
    CPU_CORES=$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo "4")
    MEMORY_GB=$(free -g 2>/dev/null | awk 'NR==2{print $2}' || echo "8")
    
    # Use conservative resource allocation (50% of available)
    ALLOCATED_CPU=$((CPU_CORES / 2))
    ALLOCATED_MEMORY=$((MEMORY_GB / 2))
    
    # Minimum allocations
    [ "$ALLOCATED_CPU" -lt 1 ] && ALLOCATED_CPU=1
    [ "$ALLOCATED_MEMORY" -lt 2 ] && ALLOCATED_MEMORY=2
    
    # Build capabilities JSON array
    CAPS_JSON=$(printf '%s\n' "${CAPABILITIES[@]}" | jq -R . | jq -s .)
    
    # Create config file
    cat > node-config.json << EOF
{
  "nodeId": "$NODE_ID",
  "serverUrl": "https://moilol.com:8333",
  "capabilities": $CAPS_JSON,
  "resources": {
    "cpu": $ALLOCATED_CPU,
    "memory": "${ALLOCATED_MEMORY}GB"
  },
  "availability": {
    "schedule": "24/7",
    "maxJobs": 2
  }
}
EOF
    
    echo "✅ Configuration created: node-config.json"
    echo "   Node ID: $NODE_ID"
    echo "   CPU: $ALLOCATED_CPU cores"
    echo "   Memory: ${ALLOCATED_MEMORY}GB"
    echo "   Capabilities: ${CAPABILITIES[*]}"
else
    echo "✅ Configuration file already exists"
fi

# Run setup test
echo ""
echo "🧪 Testing setup..."
node scripts/openclaw-setup-test.js

# Check if tests passed
if [ $? -eq 0 ]; then
    echo ""
    echo "🎉 Setup complete! Your OpenClaw is ready to earn."
    echo ""
    echo "Next steps:"
    echo "1. Start your node:     node client.js"
    echo "2. Monitor earnings:    node scripts/openclaw-earnings.js"
    echo "3. View dashboard:      https://moilol.com:8333"
    echo "4. Join Discord:        https://discord.gg/ic-mesh"
    echo ""
    echo "💰 Estimated earnings:   \$2-50/day (depends on capabilities)"
    echo "🏦 Minimum cashout:      \$5.00"
    echo "💳 Payment method:       Stripe Connect (bank account)"
    echo ""
    echo "Ready to start earning? Run: node client.js"
else
    echo ""
    echo "🔧 Setup issues detected. Please fix them before starting."
    echo "Run the test again: node scripts/openclaw-setup-test.js"
fi