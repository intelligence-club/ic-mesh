# IC Mesh Troubleshooting Guide

**Common issues and solutions for IC Mesh nodes and operators**

---

## Quick Diagnostic Commands

```bash
# Check node health
npm run health:regenerative --detailed

# View recent logs
npm run logs | tail -50

# Test network connectivity 
curl -v https://moilol.com/mesh/status

# Check system resources
node scripts/node-diagnostics.js --full

# Run comprehensive tests
npm run test:ci
```

---

## Node Connection Issues

### Problem: Node Can't Connect to Mesh Hub
**Symptoms:**
- Connection timeout errors
- "ECONNREFUSED" or "ENOTFOUND" errors
- Node status shows "offline" in dashboard

**Solutions:**

1. **Check network connectivity**
   ```bash
   # Test basic connectivity
   ping moilol.com
   curl -I https://moilol.com/mesh/status
   
   # Check DNS resolution
   nslookup moilol.com
   dig moilol.com
   ```

2. **Verify environment configuration**
   ```bash
   # Check if IC_MESH_HUB is set correctly
   echo $IC_MESH_HUB
   
   # Should be: https://moilol.com/mesh (note: no trailing slash)
   export IC_MESH_HUB=https://moilol.com/mesh
   ```

3. **Firewall and proxy issues**
   ```bash
   # Check if running behind corporate firewall
   curl -v --proxy http://proxy.company.com:8080 https://moilol.com/mesh/status
   
   # Set proxy environment variables if needed
   export HTTP_PROXY=http://proxy:8080
   export HTTPS_PROXY=http://proxy:8080
   export NO_PROXY=localhost,127.0.0.1
   ```

4. **Certificate issues**
   ```bash
   # Check SSL certificate validity
   openssl s_client -connect moilol.com:443 -servername moilol.com
   
   # If certificate issues, update CA bundle
   apt-get update && apt-get install ca-certificates
   # or on macOS:
   brew install ca-certificates
   ```

### Problem: Node Connects but Immediately Disconnects
**Symptoms:**
- Node appears online briefly then goes offline
- "Connection closed" or "Socket hang up" errors
- Rapid reconnection attempts

**Solutions:**

1. **Check node registration**
   ```bash
   # Verify node name is unique
   curl -s https://moilol.com/mesh/nodes | jq '.[] | select(.name == "YOUR_NODE_NAME")'
   
   # If duplicate found, change IC_NODE_NAME
   export IC_NODE_NAME=unique-node-name-$(date +%s)
   ```

2. **Resource availability**
   ```bash
   # Check available memory and CPU
   free -h
   top -n1 | head -20
   
   # Reduce concurrent job limit if resources are low
   export IC_MAX_CONCURRENT_JOBS=1
   ```

3. **Check for conflicting processes**
   ```bash
   # Look for other IC Mesh processes
   ps aux | grep node
   pkill -f "ic-mesh\|client.js"  # Kill conflicting processes
   ```

---

## Job Processing Issues

### Problem: Jobs Not Being Claimed
**Symptoms:**
- Jobs remain in "pending" state
- Node shows as "idle" but jobs aren't assigned
- Zero job completion metrics

**Solutions:**

1. **Verify node capabilities**
   ```bash
   # Check what capabilities your node advertises
   node scripts/node-diagnostics.js --capabilities
   
   # Test capability detection
   node -e "console.log(require('./lib/capability-detector').detectCapabilities())"
   ```

2. **Check job requirements matching**
   ```bash
   # View available jobs and their requirements
   curl -s https://moilol.com/mesh/jobs/available | jq '.[] | {type, requirements}'
   
   # Ensure your node has matching capabilities
   ```

3. **Resource threshold issues**
   ```bash
   # Check if node resources meet job requirements
   # View resource usage
   node scripts/performance-monitor.js
   
   # Lower resource thresholds temporarily
   export IC_MIN_AVAILABLE_MEMORY=512MB
   export IC_MIN_AVAILABLE_CPU=10%
   ```

### Problem: Jobs Fail During Processing
**Symptoms:**
- Jobs marked as "failed" in dashboard
- Error logs showing execution failures
- Node repeatedly claims then fails jobs

**Solutions:**

1. **Check error logs for specific failures**
   ```bash
   # View detailed error logs
   tail -f logs/node.log | grep ERROR
   
   # Check specific job failures
   grep "job.*failed" logs/node.log | tail -10
   ```

2. **Common transcription failures**
   ```bash
   # Test whisper installation
   which whisper
   whisper --help
   
   # Check audio file processing
   whisper test-audio.wav --output_dir ./test
   
   # Install missing dependencies
   pip install openai-whisper
   # or
   brew install whisper
   ```

3. **Stable Diffusion failures**
   ```bash
   # Check GPU availability
   nvidia-smi  # For NVIDIA
   system_profiler SPDisplaysDataType | grep Metal  # For Apple Silicon
   
   # Test Stable Diffusion setup
   python -c "import torch; print(torch.cuda.is_available())"  # NVIDIA
   python -c "import torch; print(torch.backends.mps.is_available())"  # Apple
   ```

4. **Memory/timeout issues**
   ```bash
   # Increase job timeout
   export IC_JOB_TIMEOUT=600000  # 10 minutes
   
   # Monitor memory during job processing
   while true; do
     echo "$(date): $(free -h | grep Mem)"
     sleep 5
   done
   ```

---

## Performance Issues

### Problem: Slow Job Processing
**Symptoms:**
- Jobs complete but take much longer than expected
- High CPU/memory usage during processing
- Node becomes unresponsive

**Solutions:**

1. **Optimize resource allocation**
   ```bash
   # Check current resource usage
   htop
   iotop  # Check disk I/O
   nethogs  # Check network usage
   
   # Reduce concurrent job limit
   export IC_MAX_CONCURRENT_JOBS=2
   
   # Set process priority
   export PROCESS_PRIORITY=10  # Lower priority
   ```

2. **System optimization**
   ```bash
   # Increase swap if low memory
   sudo fallocate -l 4G /swapfile
   sudo chmod 600 /swapfile
   sudo mkswap /swapfile
   sudo swapon /swapfile
   
   # Clean up disk space
   df -h
   sudo apt-get autoremove
   sudo apt-get autoclean
   docker system prune  # If using Docker
   ```

3. **Model caching optimization**
   ```bash
   # Pre-download models to avoid download time
   export IC_MODELS_CACHE_DIR=/fast/storage/models
   mkdir -p $IC_MODELS_CACHE_DIR
   
   # For Whisper models
   whisper --model base --download-root $IC_MODELS_CACHE_DIR sample.wav
   ```

### Problem: High Resource Usage When Idle
**Symptoms:**
- CPU/memory usage high even when no jobs running
- Node fans spinning up constantly
- System sluggish when IC Mesh is running

**Solutions:**

1. **Check for runaway processes**
   ```bash
   # Monitor processes over time
   ps aux --sort=-%cpu | head -10
   
   # Check for memory leaks
   ps aux --sort=-%mem | head -10
   
   # Monitor node process specifically
   ps -o pid,ppid,cmd,%mem,%cpu --pid $(pgrep -f "node.*client.js")
   ```

2. **Optimize polling intervals**
   ```bash
   # Reduce polling frequency
   export IC_POLLING_INTERVAL=30000  # 30 seconds instead of 10
   export IC_HEARTBEAT_INTERVAL=60000  # 1 minute heartbeats
   ```

3. **Enable resource limits**
   ```bash
   # Set memory limits
   export IC_MAX_NODE_MEMORY=4GB
   
   # Set CPU limits (Linux only)
   systemd-run --scope -p MemoryLimit=4G -p CPUQuota=200% node client.js
   ```

---

## Payment and Earnings Issues

### Problem: Earnings Not Showing Up
**Symptoms:**
- Jobs completed successfully but no earnings recorded
- Balance shows 0 despite completing paid jobs
- Payments not appearing in operator dashboard

**Solutions:**

1. **Check Stripe Connect setup**
   ```bash
   # Verify Stripe onboarding status
   curl -s "https://moilol.com/mesh/nodes/${NODE_ID}/stripe" | jq
   
   # If not onboarded, create Stripe account
   curl -X POST https://moilol.com/mesh/nodes/onboard \
     -H "Content-Type: application/json" \
     -d '{"nodeId": "YOUR_NODE_ID", "email": "your@email.com", "country": "US"}'
   ```

2. **Verify job completion flow**
   ```bash
   # Check if jobs are properly marked as completed
   curl -s "https://moilol.com/mesh/payouts/${NODE_ID}" | jq
   
   # View recent job completions
   grep "job.*completed" logs/node.log | tail -10
   ```

3. **Check minimum payout threshold**
   ```bash
   # Current balance (must be ≥1000 ints for cashout)
   curl -s "https://moilol.com/mesh/payouts/${NODE_ID}" | jq '.balance'
   ```

### Problem: Cashout Failures
**Symptoms:**
- Cashout requests fail or timeout
- "Insufficient balance" errors despite having earnings
- Stripe transfer errors

**Solutions:**

1. **Verify Stripe account status**
   ```bash
   # Check Stripe account details and capabilities
   curl -s "https://moilol.com/mesh/nodes/${NODE_ID}/stripe" | jq '.capabilities'
   
   # Ensure transfers are enabled
   # If not, complete Stripe onboarding requirements
   ```

2. **Check minimum cashout requirements**
   ```bash
   # Balance must be ≥1000 ints ($0.80)
   BALANCE=$(curl -s "https://moilol.com/mesh/payouts/${NODE_ID}" | jq '.balance')
   if [ $BALANCE -lt 1000 ]; then
     echo "Balance too low for cashout: $BALANCE ints (need ≥1000)"
   fi
   ```

3. **Test cashout process**
   ```bash
   # Request cashout (requires ≥1000 ints)
   curl -X POST https://moilol.com/mesh/cashout \
     -H "Content-Type: application/json" \
     -d '{"nodeId": "YOUR_NODE_ID"}'
   
   # Check cashout history
   curl -s "https://moilol.com/mesh/cashouts/${NODE_ID}" | jq
   ```

---

## Docker and Container Issues

### Problem: Docker Container Won't Start
**Symptoms:**
- Container exits immediately
- "Permission denied" errors
- Volume mount issues

**Solutions:**

1. **Check Docker permissions**
   ```bash
   # Add user to docker group
   sudo usermod -aG docker $USER
   newgrp docker  # Refresh group membership
   
   # Test Docker access
   docker run hello-world
   ```

2. **Fix volume permissions**
   ```bash
   # Create directories with proper permissions
   mkdir -p ./data ./logs
   chmod 755 ./data ./logs
   
   # Check Docker volume mounts
   docker-compose config
   ```

3. **Check resource limits**
   ```bash
   # Increase Docker memory limits
   # On macOS: Docker Desktop → Resources → Memory
   # On Linux: Edit /etc/docker/daemon.json
   {
     "default-runtime": "runc",
     "default-shm-size": "1G"
   }
   ```

### Problem: Container Performance Issues
**Symptoms:**
- Slow job processing in containers
- High CPU usage in Docker stats
- Container memory limit errors

**Solutions:**

1. **Optimize Docker configuration**
   ```bash
   # Check current container stats
   docker stats ic-mesh-node
   
   # Increase resource limits in docker-compose.yml
   deploy:
     resources:
       limits:
         cpus: '8.0'
         memory: 16G
   ```

2. **Optimize container networking**
   ```bash
   # Use host networking for better performance (Linux only)
   docker run --network host ic-mesh-node
   
   # Or optimize bridge networking
   docker network create --driver bridge \
     --opt com.docker.network.bridge.name=ic-mesh-br \
     ic-mesh-network
   ```

---

## GPU and Hardware Issues

### Problem: GPU Not Detected or Used
**Symptoms:**
- Node doesn't advertise GPU capabilities
- Jobs fail with "No GPU available" errors
- GPU utilization remains at 0% during jobs

**Solutions:**

1. **NVIDIA GPU troubleshooting**
   ```bash
   # Check NVIDIA driver installation
   nvidia-smi
   
   # Check CUDA installation
   nvcc --version
   cat /usr/local/cuda/version.txt
   
   # Test GPU accessibility from Node.js
   node -e "console.log(process.platform); console.log(require('os').cpus().length);"
   
   # Install NVIDIA Container Runtime (for Docker)
   curl -s -L https://nvidia.github.io/nvidia-container-runtime/gpgkey | sudo apt-key add -
   distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
   curl -s -L https://nvidia.github.io/nvidia-container-runtime/$distribution/nvidia-container-runtime.list | sudo tee /etc/apt/sources.list.d/nvidia-container-runtime.list
   sudo apt-get update && sudo apt-get install nvidia-container-runtime
   sudo systemctl restart docker
   ```

2. **Apple Silicon GPU troubleshooting**
   ```bash
   # Check Metal support
   system_profiler SPDisplaysDataType | grep -A5 "Metal"
   
   # Test Metal performance
   python3 -c "import torch; print(torch.backends.mps.is_available())"
   
   # Check memory pressure
   memory_pressure
   ```

3. **Generic GPU issues**
   ```bash
   # Check if GPU is being used by other processes
   lsof /dev/nvidia*  # NVIDIA
   ps aux | grep gpu  # General GPU processes
   
   # Restart GPU drivers (be careful!)
   sudo rmmod nvidia_drm nvidia_modeset nvidia_uvm nvidia
   sudo modprobe nvidia
   ```

### Problem: Hardware Capability Detection Fails
**Symptoms:**
- Node reports minimal or wrong capabilities
- Expected hardware features not detected
- Capability checks timeout

**Solutions:**

1. **Run manual capability detection**
   ```bash
   # Test individual capability checks
   node scripts/node-diagnostics.js --capabilities --verbose
   
   # Check specific tools
   which whisper ffmpeg python3 docker
   
   # Test hardware detection
   lscpu | grep -E "Model|Flags"
   lsmem
   lsblk
   ```

2. **Fix capability detection timeouts**
   ```bash
   # Increase capability check timeout
   export IC_CAPABILITY_CHECK_TIMEOUT=60000  # 60 seconds
   
   # Skip problematic capability checks
   export IC_SKIP_GPU_CHECK=true
   export IC_SKIP_WHISPER_CHECK=true  # if whisper install is slow
   ```

---

## Debugging and Logging

### Problem: Insufficient Logging Information
**Symptoms:**
- Can't determine cause of issues from logs
- Logs missing important details
- Need more detailed troubleshooting info

**Solutions:**

1. **Enable debug logging**
   ```bash
   # Maximum debug output
   DEBUG=* NODE_ENV=development node client.js
   
   # IC Mesh specific debug
   export IC_LOG_LEVEL=debug
   export IC_VERBOSE=true
   export IC_DEBUG_JOB_DATA=true
   ```

2. **Set up structured logging**
   ```bash
   # Log to files with rotation
   export IC_LOG_FILE=/var/log/ic-mesh/node.log
   export IC_LOG_ROTATION=daily
   export IC_LOG_MAX_FILES=30
   
   # JSON formatted logs
   export IC_LOG_FORMAT=json
   ```

3. **Enable performance profiling**
   ```bash
   # Node.js performance profiling
   node --prof client.js
   # After running, process the profile:
   node --prof-process isolate-*.log > profile.txt
   
   # Memory usage tracking
   node --trace-gc client.js
   ```

### Problem: Log Files Growing Too Large
**Symptoms:**
- Disk space filling up with logs
- Log files several GB in size
- System performance degraded by logging

**Solutions:**

1. **Set up log rotation**
   ```bash
   # Install logrotate
   sudo apt-get install logrotate
   
   # Create IC Mesh logrotate config
   cat > /etc/logrotate.d/ic-mesh << EOF
   /var/log/ic-mesh/*.log {
       daily
       missingok
       rotate 7
       compress
       delaycompress
       notifempty
       copytruncate
   }
   EOF
   ```

2. **Reduce log verbosity**
   ```bash
   # Lower log level
   export IC_LOG_LEVEL=info  # instead of debug
   
   # Disable verbose job logging
   export IC_DEBUG_JOB_DATA=false
   export IC_VERBOSE=false
   ```

---

## Network and Connectivity Issues

### Problem: Intermittent Connection Drops
**Symptoms:**
- Node connects and disconnects repeatedly
- "Socket hang up" errors in logs
- Jobs fail due to connection loss

**Solutions:**

1. **Implement connection resilience**
   ```bash
   # Increase reconnection attempts
   export IC_MAX_RECONNECT_ATTEMPTS=10
   export IC_RECONNECT_DELAY=5000  # 5 seconds
   
   # Enable connection keepalive
   export IC_KEEPALIVE_ENABLED=true
   export IC_KEEPALIVE_INTERVAL=30000  # 30 seconds
   ```

2. **Check network stability**
   ```bash
   # Monitor connection stability
   while true; do
     ping -c 1 moilol.com || echo "$(date): Connection lost"
     sleep 10
   done
   
   # Check for network interface issues
   ip addr show
   ethtool eth0  # Check interface health
   ```

3. **Configure network timeouts**
   ```bash
   # Increase various timeouts
   export IC_NETWORK_TIMEOUT=30000
   export IC_REQUEST_TIMEOUT=60000
   export IC_WEBSOCKET_TIMEOUT=120000
   ```

### Problem: Slow Network Performance
**Symptoms:**
- File uploads/downloads are very slow
- Job processing delayed by network transfers
- High network latency in logs

**Solutions:**

1. **Check bandwidth and latency**
   ```bash
   # Test bandwidth to mesh hub
   curl -w "time_total: %{time_total}\n" -o /dev/null -s https://moilol.com/mesh/status
   
   # Use speedtest if available
   speedtest-cli
   
   # Check local network utilization
   iftop
   ```

2. **Optimize file transfer**
   ```bash
   # Enable compression
   export IC_COMPRESSION_ENABLED=true
   
   # Use CDN for file transfers
   export IC_USE_CDN=true
   export IC_CDN_ENDPOINT=https://cdn.moilol.com
   ```

---

## System Integration Issues

### Problem: systemd Service Issues
**Symptoms:**
- Service fails to start automatically
- Service stops unexpectedly
- systemd status shows failed state

**Solutions:**

1. **Check service configuration**
   ```bash
   # View service status
   systemctl status ic-mesh
   
   # View service logs
   journalctl -u ic-mesh -f
   
   # Check service file syntax
   systemd-analyze verify /etc/systemd/system/ic-mesh.service
   ```

2. **Fix common service issues**
   ```bash
   # Reload systemd after service file changes
   sudo systemctl daemon-reload
   
   # Fix permissions
   sudo chown ic-mesh:ic-mesh /opt/ic-mesh
   sudo chmod +x /opt/ic-mesh/client.js
   
   # Set proper working directory
   cd /opt/ic-mesh
   sudo systemctl restart ic-mesh
   ```

### Problem: Environment Variable Issues
**Symptoms:**
- Configuration not loading correctly
- Different behavior when run manually vs as service
- Environment-dependent failures

**Solutions:**

1. **Debug environment loading**
   ```bash
   # Check which environment variables are set
   env | grep IC_
   
   # Compare service vs manual environment
   systemctl show-environment
   
   # Debug variable expansion
   echo "Hub: $IC_MESH_HUB"
   echo "Name: $IC_NODE_NAME"
   ```

2. **Fix environment variable loading**
   ```bash
   # Use EnvironmentFile in systemd service
   [Service]
   EnvironmentFile=/opt/ic-mesh/.env
   EnvironmentFile=-/opt/ic-mesh/.env.local
   
   # Or export in shell script
   export $(cat .env | xargs)
   node client.js
   ```

---

## Emergency Recovery

### Complete Node Reset
```bash
#!/bin/bash
# emergency-reset.sh - Complete node reset procedure

echo "🚨 Emergency IC Mesh Node Reset"
echo "This will reset all local data and restart from scratch"
read -p "Continue? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
fi

# Stop all IC Mesh processes
pkill -f "ic-mesh\|client.js"
systemctl stop ic-mesh 2>/dev/null

# Backup current configuration
cp .env .env.backup.$(date +%Y%m%d_%H%M%S) 2>/dev/null

# Remove local data (but keep logs for debugging)
rm -rf data/mesh.db data/temp/* data/cache/*

# Reset node ID to force re-registration
export IC_NODE_NAME="${IC_NODE_NAME}_reset_$(date +%s)"

# Start fresh
echo "🔄 Starting fresh node registration..."
node client.js
```

### Data Recovery
```bash
#!/bin/bash
# recover-data.sh - Attempt to recover from corrupted data

echo "🔧 IC Mesh Data Recovery"

# Check database integrity
if [ -f "data/mesh.db" ]; then
    echo "Checking database integrity..."
    sqlite3 data/mesh.db "PRAGMA integrity_check;"
    
    # If corrupted, try to repair
    if [ $? -ne 0 ]; then
        echo "Database corrupted, attempting repair..."
        sqlite3 data/mesh.db ".recover" > data/mesh.db.recovered
        mv data/mesh.db data/mesh.db.corrupted
        mv data/mesh.db.recovered data/mesh.db
    fi
fi

# Restore from backup if available
if [ -f "data/mesh.db.backup*" ]; then
    LATEST_BACKUP=$(ls -t data/mesh.db.backup* | head -1)
    echo "Found backup: $LATEST_BACKUP"
    read -p "Restore from backup? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        cp "$LATEST_BACKUP" data/mesh.db
        echo "✅ Restored from backup"
    fi
fi

echo "🚀 Restart node to complete recovery"
```

---

## Getting Help

### Collecting Debug Information
```bash
#!/bin/bash
# collect-debug-info.sh - Gather information for support

echo "📋 Collecting IC Mesh debug information..."

DEBUG_DIR="debug-$(date +%Y%m%d_%H%M%S)"
mkdir "$DEBUG_DIR"

# System information
uname -a > "$DEBUG_DIR/system.txt"
cat /etc/os-release > "$DEBUG_DIR/os-release.txt" 2>/dev/null
node --version > "$DEBUG_DIR/node-version.txt"
npm --version > "$DEBUG_DIR/npm-version.txt"

# IC Mesh configuration
env | grep IC_ > "$DEBUG_DIR/environment.txt"
cat .env > "$DEBUG_DIR/dot-env.txt" 2>/dev/null

# Recent logs
tail -1000 logs/node.log > "$DEBUG_DIR/recent-logs.txt" 2>/dev/null
journalctl -u ic-mesh --since "1 hour ago" > "$DEBUG_DIR/systemd-logs.txt" 2>/dev/null

# System resources
free -h > "$DEBUG_DIR/memory.txt"
df -h > "$DEBUG_DIR/disk.txt"
ps aux | grep node > "$DEBUG_DIR/processes.txt"

# Network connectivity
curl -v https://moilol.com/mesh/status > "$DEBUG_DIR/connectivity-test.txt" 2>&1

# Package information
npm list > "$DEBUG_DIR/npm-packages.txt" 2>/dev/null

# Hardware info
lscpu > "$DEBUG_DIR/cpu-info.txt" 2>/dev/null
lspci > "$DEBUG_DIR/pci-info.txt" 2>/dev/null
nvidia-smi > "$DEBUG_DIR/nvidia-info.txt" 2>/dev/null

# Create archive
tar -czf "$DEBUG_DIR.tar.gz" "$DEBUG_DIR"
rm -rf "$DEBUG_DIR"

echo "✅ Debug information collected: $DEBUG_DIR.tar.gz"
echo "📧 Send this file when requesting support"
```

### Support Channels
- **GitHub Issues**: https://github.com/intelligence-club/ic-mesh/issues
- **Discord**: https://discord.gg/intelligence-club
- **Email**: hello@moilol.com
- **Documentation**: https://moilol.com/docs

### Before Requesting Support
1. Run the debug information collection script above
2. Check if your issue is covered in this troubleshooting guide
3. Try the emergency reset procedure if nothing else works
4. Include the debug information archive with your support request

---

This troubleshooting guide covers the most common issues encountered when running IC Mesh nodes. For issues not covered here, please collect debug information and contact support through the channels listed above.