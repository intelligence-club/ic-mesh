# OpenClaw + IC Mesh Troubleshooting Guide

This guide helps OpenClaw operators resolve common issues when setting up and running IC Mesh nodes alongside their existing OpenClaw installations.

## Quick Start Problems

### ❌ "Command not found: node"

**Problem:** OpenClaw is running but `node` command isn't available for IC Mesh.

**OpenClaw Context:** OpenClaw runs in a container/environment where Node.js might not be globally accessible.

**Solutions:**
```bash
# Option 1: Check if Node.js is already installed
which node
node --version

# Option 2: Install Node.js (Ubuntu/Debian)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Option 3: Install via package manager
# macOS: brew install node  
# Windows: choco install nodejs

# Option 4: Use OpenClaw's Node.js if available
/path/to/openclaw/node_modules/.bin/node client.js
```

### ❌ "git: command not found"

**Problem:** Need to clone IC Mesh but git isn't installed.

**Solutions:**
```bash
# Ubuntu/Debian
sudo apt update && sudo apt install git

# macOS  
brew install git

# Or download ZIP from GitHub instead of cloning
wget https://github.com/intelligence-club/ic-mesh/archive/main.zip
unzip main.zip
cd ic-mesh-main
```

### ❌ "Error: Cannot find module 'ws'"

**Problem:** Missing Node.js dependencies.

**Solution:**
```bash
cd ic-mesh
npm install
# If npm fails, try:
npm install --no-optional
```

## Configuration Issues

### ❌ IC Mesh can't connect to server

**Problem:** `IC_MESH_SERVER` not configured or unreachable.

**Symptoms:**
```
❌ Failed to register with mesh server
Error: getaddrinfo ENOTFOUND undefined
```

**OpenClaw Integration:**
```bash
# Set environment variables in your OpenClaw startup script
export IC_MESH_SERVER="http://moilol.com:8333"
export IC_NODE_NAME="openclaw-$(hostname)"
export IC_NODE_OWNER="your-name"
export IC_NODE_REGION="your-location"

# Or create .env file in ic-mesh directory
echo "IC_MESH_SERVER=http://moilol.com:8333" > .env
echo "IC_NODE_NAME=openclaw-$(hostname)" >> .env
echo "IC_NODE_OWNER=your-name" >> .env
```

### ❌ "Node name already exists"

**Problem:** Multiple IC Mesh instances with same name.

**OpenClaw Context:** Running multiple OpenClaw instances or restarting frequently.

**Solutions:**
```bash
# Option 1: Use unique names per instance
export IC_NODE_NAME="openclaw-$(hostname)-$(date +%s)"

# Option 2: Use MAC address for uniqueness
export IC_NODE_NAME="openclaw-$(cat /sys/class/net/eth0/address | tr -d ':')"

# Option 3: Include process ID
export IC_NODE_NAME="openclaw-$(hostname)-$$"
```

## Resource Conflicts

### ⚠️ IC Mesh interfering with OpenClaw performance

**Problem:** Both systems competing for CPU/GPU resources.

**OpenClaw-Specific Solutions:**
```bash
# Option 1: Configure IC Mesh resource limits in node-config.json
{
  "limits": {
    "maxCpuPercent": 60,      // Leave 40% for OpenClaw
    "maxRamPercent": 50,      // Leave 50% for OpenClaw  
    "maxConcurrentJobs": 1    // One job at a time
  }
}

# Option 2: Schedule IC Mesh to run when OpenClaw is idle
{
  "schedule": {
    "enabled": true,
    "timezone": "UTC",
    "available": [
      "00:00-06:00",  // Night hours
      "12:00-13:00"   // Lunch break
    ]
  }
}
```

### ❌ Port conflicts

**Problem:** IC Mesh and OpenClaw trying to use same ports.

**Symptoms:**
```
Error: listen EADDRINUSE :::8333
```

**Solutions:**
```bash
# Check what's using the port
netstat -tlnp | grep 8333
lsof -i :8333

# If OpenClaw is using the port, IC Mesh client doesn't need to bind
# (Client connects OUT to server, doesn't listen IN)
# This error suggests you're running the IC Mesh SERVER alongside OpenClaw

# Solution: Run IC Mesh client only, not server
node client.js  # ✅ Correct for operators
# Don't run: node server.js  # Only for hub
```

## Capability Detection Issues

### ❌ "No capabilities detected"

**Problem:** IC Mesh can't find your installed tools.

**OpenClaw Context:** Tools installed in containers or non-standard locations.

**Diagnosis:**
```bash
# Test each capability manually
which ollama     # LLM inference
which whisper    # Audio transcription  
which ffmpeg     # Media processing
which python3    # For Whisper/SD
```

**Solutions:**
```bash
# Option 1: Add tools to PATH
export PATH=$PATH:/path/to/ollama/bin
export PATH=$PATH:/usr/local/bin

# Option 2: Create symlinks
sudo ln -s /path/to/ollama /usr/local/bin/ollama

# Option 3: Configure explicit paths in node-config.json
{
  "handlers": {
    "ollama": {
      "enabled": true,
      "path": "/path/to/ollama",
      "models": ["llama3.1:8b"]
    }
  }
}
```

### ❌ Ollama detected but models missing

**Problem:** Ollama is installed but no models available.

**OpenClaw Integration:**
```bash
# If OpenClaw already has Ollama models, IC Mesh can use them
ollama list

# If no models, install some profitable ones:
ollama pull llama3.1:8b      # Fast, popular
ollama pull mistral:7b       # Good quality
ollama pull codellama:7b     # Code generation jobs

# Configure in node-config.json to share OpenClaw's models
{
  "handlers": {
    "ollama": {
      "models": ["llama3.1:8b", "mistral:7b"],
      "baseUrl": "http://localhost:11434"  // Same as OpenClaw
    }
  }
}
```

## Network and Connectivity

### ❌ "Mesh server unreachable"

**Problem:** Can't connect to IC Mesh hub.

**Diagnosis:**
```bash
# Test connectivity
curl -I http://moilol.com:8333/status
ping moilol.com

# Check firewall
sudo ufw status
iptables -L

# Test with different ports
curl https://moilol.com/health  # Port 443 instead of 8333
```

**OpenClaw Network Solutions:**
```bash
# If OpenClaw is behind proxy/VPN, ensure IC Mesh can reach internet
# Option 1: Use same network config as OpenClaw
source /path/to/openclaw/.env  # If OpenClaw sets HTTP_PROXY etc

# Option 2: Configure proxy for IC Mesh
export HTTP_PROXY=http://your-proxy:8080
export HTTPS_PROXY=http://your-proxy:8080

# Option 3: Run IC Mesh in same container as OpenClaw
# Add to OpenClaw's docker-compose.yml or startup script
```

### ❌ WebSocket connection fails

**Problem:** IC Mesh can't maintain real-time connection.

**Symptoms:**
```
WebSocket connection failed: Error during WebSocket handshake
```

**Solutions:**
```bash
# Option 1: Disable WebSocket, use polling instead
{
  "useWebSocket": false,
  "jobPollInterval": 30000
}

# Option 2: Check corporate firewall/proxy
# Many corporate networks block WebSockets
# Talk to IT about allowing wss://moilol.com:8333

# Option 3: Use HTTP fallback
# IC Mesh will automatically retry with HTTP polling
```

## Job Processing Issues

### ❌ Jobs failing with timeout

**Problem:** IC Mesh jobs taking too long, getting killed.

**OpenClaw Context:** Shared resources slowing down job processing.

**Solutions:**
```bash
# Option 1: Increase timeouts in node-config.json
{
  "jobTimeouts": {
    "transcribe": 1200000,    // 20 minutes instead of 10
    "inference": 600000,      // 10 minutes instead of 5
    "generate": 1800000       // 30 minutes for image generation
  }
}

# Option 2: Reduce concurrent jobs
{
  "limits": {
    "maxConcurrentJobs": 1    // One at a time when sharing with OpenClaw
  }
}

# Option 3: Schedule heavy jobs for off-hours
{
  "schedule": {
    "enabled": true,
    "available": ["22:00-06:00"]  // Night hours only
  }
}
```

### ❌ "Job failed: insufficient resources"

**Problem:** Not enough RAM/CPU for large jobs.

**OpenClaw Integration:**
```bash
# Monitor resource usage
htop
nvidia-smi  # If using GPU

# Configure resource limits to prevent overload
{
  "limits": {
    "maxFileSizeMB": 25,      // Smaller files when sharing resources
    "maxConcurrentJobs": 1,   // One job at a time
    "maxRamPercent": 40       // Leave majority for OpenClaw
  }
}

# If still failing, focus on lighter job types
{
  "handlers": {
    "whisper": { "enabled": false },     // Disable heavy transcription
    "ollama": { "enabled": true },       // Keep lighter inference
    "ffmpeg": { "enabled": false }       // Disable media processing
  }
}
```

## Financial/Account Issues

### ❌ "Unable to create operator account"

**Problem:** Stripe Connect onboarding failing.

**Solutions:**
```bash
# Visit account page directly
open https://moilol.com/account

# If link expires (5 minute timeout), refresh and try again
# Check browser console for errors

# Ensure clean cookies/cache
# Try incognito mode

# Check Stripe support if repeated failures:
# Some countries/business types have restrictions
```

### ❌ "Jobs completing but no ints credited"

**Problem:** Earnings not showing up in account.

**Diagnosis:**
```bash
# Check account balance
curl -H "Authorization: Bearer YOUR_API_KEY" \
     https://moilol.com/api/balance

# Check job completion logs
tail -f ~/.ic-mesh/logs/jobs.log

# Verify node registration
curl http://moilol.com:8333/nodes | grep your-node-name
```

## OpenClaw-Specific Integration

### Running IC Mesh as OpenClaw Service

**Option 1: Systemd service (Linux)**
```bash
# Create service file
sudo cat > /etc/systemd/system/ic-mesh.service << 'EOF'
[Unit]
Description=IC Mesh Node for OpenClaw
After=network.target openclaw.service

[Service]
Type=simple
User=openclaw
WorkingDirectory=/home/openclaw/ic-mesh
ExecStart=/usr/bin/node client.js
Environment=IC_MESH_SERVER=http://moilol.com:8333
Environment=IC_NODE_NAME=openclaw-%i
Restart=always
RestartSec=30

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable ic-mesh
sudo systemctl start ic-mesh
```

**Option 2: Docker Compose integration**
```yaml
# Add to OpenClaw's docker-compose.yml
services:
  ic-mesh:
    build: ./ic-mesh
    environment:
      - IC_MESH_SERVER=http://moilol.com:8333
      - IC_NODE_NAME=openclaw-${HOSTNAME}
      - IC_NODE_OWNER=${USER}
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock  # If needed for capabilities
    restart: unless-stopped
    depends_on:
      - openclaw
```

**Option 3: OpenClaw startup script integration**
```bash
# Add to your OpenClaw startup script
export IC_MESH_SERVER="http://moilol.com:8333"
export IC_NODE_NAME="openclaw-$(hostname)"
export IC_NODE_OWNER="$(whoami)"

# Start IC Mesh in background
cd /path/to/ic-mesh
nohup node client.js > ~/.ic-mesh/logs/client.log 2>&1 &
echo $! > ~/.ic-mesh/client.pid

# Start OpenClaw as usual
cd /path/to/openclaw
# ... your normal OpenClaw startup
```

## Monitoring and Logs

### Checking IC Mesh Status

```bash
# View live logs
tail -f ~/.ic-mesh/logs/client.log

# Check process status
ps aux | grep "node client.js"

# Monitor resource usage
htop | grep node

# Check earnings
curl -s https://moilol.com/account | grep balance
```

### Using the Health Monitor

```bash
# Run comprehensive health check
node tools/health-monitor.js

# Continuous monitoring
node tools/health-monitor.js --continuous

# JSON output for integration
node tools/health-monitor.js --json
```

## Getting Help

### Log Collection for Support

When reporting issues, include:
```bash
# System information
uname -a
node --version
npm --version

# IC Mesh configuration
cat node-config.json
env | grep IC_

# Recent logs
tail -50 ~/.ic-mesh/logs/client.log

# Network test results  
node tools/health-monitor.js --json

# Resource usage
free -h
df -h
htop -n 1
```

### OpenClaw Community Support

- **OpenClaw Discord**: IC Mesh channel for integration questions
- **GitHub Issues**: https://github.com/intelligence-club/ic-mesh/issues  
- **Email**: hello@moilol.com with "OpenClaw Integration" subject

### Common OpenClaw Questions

**Q: Will IC Mesh slow down my OpenClaw agent?**
A: Not if configured properly. Use resource limits and scheduling to avoid conflicts.

**Q: Can I use the same Ollama instance for both?**
A: Yes! Both can share the same Ollama server at localhost:11434.

**Q: Do I need separate API keys?** 
A: Yes, IC Mesh uses its own API keys for earnings/billing.

**Q: What if my OpenClaw instance restarts frequently?**
A: IC Mesh client will auto-reconnect. Use unique node names to avoid conflicts.

**Q: Can I run multiple OpenClaw instances with IC Mesh?**
A: Yes, but use different node names and resource limits for each.

---

*This guide is specific to OpenClaw integration. For general IC Mesh troubleshooting, see the main [README.md](../README.md).*