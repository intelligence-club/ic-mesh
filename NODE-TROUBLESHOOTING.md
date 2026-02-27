# IC Mesh Node Troubleshooting Guide
*Solving Common Node Operation Issues*

This guide helps IC Mesh node operators diagnose and fix common problems.

## Quick Diagnostic Commands

Before diving into specific issues, run these commands to gather basic system information:

```bash
# Check node status
curl http://localhost:8333/status

# Check available jobs
curl http://localhost:8333/jobs/available?nodeId=your-node-id

# Check node registration
curl http://localhost:8333/nodes | grep -A5 -B5 "your-node-id"

# Check system resources
cat /proc/cpuinfo | grep processor | wc -l  # CPU cores
free -h  # Memory usage
df -h    # Disk usage

# Check process status
ps aux | grep node
netstat -tlnp | grep 8333  # Check if port is listening
```

## Common Issues and Solutions

### 1. Node Not Receiving Jobs

#### Symptoms
- Node shows as "active" but never gets job assignments
- Other nodes in network are processing jobs normally
- No jobs appear in node logs

#### Diagnosis Steps
```bash
# Check node capabilities
curl http://localhost:8333/nodes | jq '.[] | select(.nodeId=="your-node-id") | .capabilities'

# Check available jobs vs. node capabilities
curl http://localhost:8333/jobs/available?nodeId=your-node-id

# Verify node requirements
curl http://localhost:8333/jobs/available | jq '.[].requirements'
```

#### Common Causes & Solutions

**Missing Capabilities:**
```bash
# Problem: Node hasn't declared required capabilities
# Solution: Update node configuration
{
  "capabilities": ["transcription", "inference", "image-gen"],
  "models": ["whisper-1", "llama2", "stable-diffusion"]
}
```

**Insufficient Resources:**
```bash
# Problem: Node doesn't meet minimum requirements
# Check job requirements:
curl http://localhost:8333/jobs/available | jq '.[].requirements.minRAM'

# Verify node resources:
curl http://localhost:8333/nodes | jq '.[] | select(.nodeId=="your-node-id") | {ramFreeMB, cpuCores}'
```

**Network Connectivity Issues:**
```bash
# Test connectivity to mesh hub
ping moilol.com
telnet moilol.com 443

# Test WebSocket connection
wscat -c wss://moilol.com/mesh/ws?nodeId=your-node-id
```

### 2. Job Failures

#### Symptoms  
- Jobs assigned to node but fail to complete
- Error messages in node logs
- Jobs timeout or return error status

#### Diagnosis Steps
```bash
# Check recent job failures
curl http://localhost:8333/jobs | jq '.[] | select(.status=="failed" and .nodeId=="your-node-id")'

# Review job logs
tail -f logs/ic-mesh.log | grep ERROR

# Check system resources during job execution
top -p $(pgrep -f "ic-mesh")
```

#### Common Causes & Solutions

**Timeout Issues:**
```bash
# Problem: Jobs timing out before completion
# Solution: Adjust timeout in handler or system config

# Check current timeouts
grep -r "timeout" config/
```

**Memory/Resource Exhaustion:**
```bash
# Problem: Node running out of resources during job processing
# Check memory usage patterns
grep "memory\|RAM\|OOM" logs/ic-mesh.log

# Solution: Adjust resource limits or add more RAM
# Update node-config.json:
{
  "maxConcurrentJobs": 2,  # Reduce if memory constrained
  "ramLimitMB": 2048       # Set appropriate limit
}
```

**Handler Errors:**
```bash
# Problem: Specific handler (whisper, ollama, etc.) failing
# Check handler dependencies
which whisper
ollama list
python3 -c "import torch; print(torch.cuda.is_available())"

# Verify handler paths in config
cat handlers/whisper.js | grep -A10 "command:"
```

### 3. Payment/Earnings Issues

#### Symptoms
- No earnings showing despite completed jobs
- Balance not updating after job completion
- Cashout requests failing

#### Diagnosis Steps
```bash
# Check node earnings balance
curl http://localhost:8333/ledger/your-node-id

# Verify completed job history  
curl http://localhost:8333/jobs | jq '.[] | select(.nodeId=="your-node-id" and .status=="completed")'

# Check payment processing
curl http://localhost:8333/payments | jq '.[] | select(.nodeId=="your-node-id")'
```

#### Common Causes & Solutions

**Ints Currency Issues:**
```bash
# Problem: Ints balance not updating correctly
# Check ints transaction log
sqlite3 mesh.db "SELECT * FROM ints_ledger WHERE account_id='your-node-id' ORDER BY created DESC LIMIT 10;"

# Verify zero-sum invariant
sqlite3 mesh.db "SELECT SUM(balance) FROM ints_ledger;"  # Should be 0
```

**Stripe Connect Setup:**
```bash
# Problem: Cashout failing due to incomplete Stripe setup
# Check Stripe Connect status
curl "https://moilol.com/api/cashout" \
  -H "X-Api-Key: your-api-key" \
  -X POST \
  -d '{"nodeId": "your-node-id", "amount": 1}'

# Look for account setup errors in response
```

### 4. Connection and Networking Issues

#### Symptoms
- Node appears offline despite running
- Intermittent connection losses  
- WebSocket connection errors

#### Diagnosis Steps
```bash
# Check network connectivity
ping -c 5 moilol.com
dig moilol.com

# Test HTTP connectivity
curl -v https://moilol.com/mesh/status

# Check firewall and ports
sudo iptables -L | grep 8333
sudo ufw status | grep 8333
```

#### Common Causes & Solutions

**Port Conflicts:**
```bash
# Problem: Port 8333 already in use
sudo netstat -tlnp | grep 8333
# Kill conflicting process or change port

# Solution: Use different port
export PORT=8334
node server.js
```

**SSL/TLS Issues:**
```bash
# Problem: Certificate verification failures
# Check SSL connectivity
openssl s_client -connect moilol.com:443 -servername moilol.com

# Temporary workaround (not recommended for production):
export NODE_TLS_REJECT_UNAUTHORIZED=0
```

**Proxy/Corporate Network:**
```bash
# Problem: Corporate firewall blocking connections
# Solution: Configure proxy settings
export HTTP_PROXY=http://proxy.company.com:8080
export HTTPS_PROXY=https://proxy.company.com:8080
export NO_PROXY=localhost,127.0.0.1
```

### 5. Performance Issues

#### Symptoms
- Slow job processing compared to other nodes
- High CPU/memory usage when idle
- Long job queue times

#### Diagnosis Steps
```bash
# Monitor system performance
top -p $(pgrep -f ic-mesh)
iostat -x 1 10  # Disk I/O
sar -u 1 10     # CPU usage

# Check job processing times
grep "computeMs" logs/ic-mesh.log | tail -20
```

#### Common Causes & Solutions

**Resource Competition:**
```bash
# Problem: Other processes consuming resources
# Check what else is running
ps aux --sort=-%cpu | head -20
ps aux --sort=-%mem | head -20

# Solution: Adjust scheduling or resource limits
nice -n 10 node server.js  # Lower priority
```

**Inefficient Handlers:**
```bash
# Problem: Custom handlers not optimized
# Profile handler execution
time node handlers/your-handler.js

# Optimize common patterns:
# - Cache model loading
# - Use worker pools for CPU-intensive tasks
# - Stream large file processing
```

## System Health Monitoring

### Automated Health Checks
Create a monitoring script (`health-check.sh`):

```bash
#!/bin/bash

# Basic connectivity
if ! curl -s http://localhost:8333/status > /dev/null; then
    echo "ERROR: Node not responding"
    exit 1
fi

# Resource usage
MEM_USAGE=$(free | grep Mem | awk '{printf "%.0f", $3/$2 * 100.0}')
if [ $MEM_USAGE -gt 90 ]; then
    echo "WARNING: Memory usage high: ${MEM_USAGE}%"
fi

# Disk space
DISK_USAGE=$(df / | grep -vE '^Filesystem' | awk '{print $5}' | sed 's/%//')
if [ $DISK_USAGE -gt 80 ]; then
    echo "WARNING: Disk usage high: ${DISK_USAGE}%"
fi

# Job processing
RECENT_JOBS=$(curl -s http://localhost:8333/jobs | jq '[.[] | select(.nodeId=="'$(hostname)'" and (.created | strptime("%Y-%m-%dT%H:%M:%S.%fZ") | mktime) > (now - 3600))] | length')
if [ $RECENT_JOBS -eq 0 ]; then
    echo "WARNING: No jobs processed in last hour"
fi

echo "Health check passed"
```

### Log Analysis
Monitor logs for patterns:

```bash
# Error patterns
grep -E "ERROR|WARN|timeout|failed" logs/ic-mesh.log | tail -20

# Job success rates
grep "Job completed" logs/ic-mesh.log | wc -l
grep "Job failed" logs/ic-mesh.log | wc -l

# Resource usage trends
grep "RAM usage" logs/ic-mesh.log | awk '{print $NF}' | tail -20
```

## Recovery Procedures

### Node Recovery After Crash
```bash
# 1. Check for core dumps or crash logs
ls -la /var/crash/
dmesg | tail -50

# 2. Clean up stale processes/files
pkill -f ic-mesh
rm -rf /tmp/ic-mesh-*

# 3. Reset database if corrupted
cp mesh.db mesh.db.backup
sqlite3 mesh.db "PRAGMA integrity_check;"

# 4. Restart with logging
NODE_ENV=debug node server.js > restart.log 2>&1 &
```

### Data Recovery
```bash
# Backup current state
tar czf ic-mesh-backup-$(date +%Y%m%d).tgz \
    mesh.db logs/ config/ handlers/

# Restore from backup
tar xzf ic-mesh-backup-YYYYMMDD.tgz
```

## Getting Help

### Information to Gather
When reporting issues, include:

```bash
# System information
uname -a
node --version
npm --version

# IC Mesh configuration
cat config/node-config.json
env | grep -E "PORT|NODE_ENV|API_KEY"

# Error logs
tail -100 logs/ic-mesh.log

# Network status
curl http://localhost:8333/status
curl https://moilol.com/mesh/status
```

### Support Channels
- **GitHub Issues**: [IC Mesh Repository](https://github.com/intelligence-club/ic-mesh/issues)
- **Discord**: Intelligence Club community server
- **Documentation**: Check README.md and other .md files in repository

### Escalation
For critical issues affecting earnings or network stability:
1. **Document the issue** with logs and reproduction steps
2. **Stop the node** if it's causing network problems
3. **Report immediately** via Discord #urgent-support
4. **Include system information** and recent logs

## Prevention

### Regular Maintenance
```bash
# Weekly tasks
- Review logs for warnings/errors
- Check disk space and clean old files
- Update IC Mesh software
- Monitor earnings and payment status

# Monthly tasks  
- Full system backup
- Review and optimize configuration
- Check for security updates
- Analyze performance trends
```

### Best Practices
- **Monitor resources** proactively
- **Keep software updated** regularly
- **Maintain spare capacity** (don't run at 100% utilization)
- **Document configuration changes**
- **Test recovery procedures** periodically

---

*Most IC Mesh issues can be resolved with these troubleshooting steps. For complex problems, don't hesitate to reach out to the community for assistance.*