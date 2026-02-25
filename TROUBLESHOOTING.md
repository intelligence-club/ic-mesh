# IC Mesh Troubleshooting Guide

Comprehensive troubleshooting guide for IC Mesh operators and clients.

## Quick Diagnostic Commands

### System Health Check
```bash
# Full system status
curl -s http://localhost:8333/status | jq .

# Check specific components
curl -s http://localhost:8333/health | jq .

# Node availability
curl -s http://localhost:8333/nodes | jq 'length'

# Active jobs count
curl -s http://localhost:8333/jobs/available | jq 'length'
```

### Common Diagnostic Script
```bash
#!/bin/bash
echo "=== IC Mesh Diagnostic Report ==="
echo "Timestamp: $(date -u)"
echo "Node.js Version: $(node --version)"
echo "OS: $(uname -a)"
echo ""

echo "=== Hub Status ==="
curl -s http://localhost:8333/status 2>/dev/null | jq . || echo "❌ Hub not responding"
echo ""

echo "=== Available Nodes ==="
curl -s http://localhost:8333/nodes 2>/dev/null | jq '.[] | {nodeId, capabilities, status}' || echo "❌ Cannot fetch nodes"
echo ""

echo "=== Database Size ==="
ls -lah data/mesh.db* 2>/dev/null || echo "❌ Database files not found"
echo ""

echo "=== Process Status ==="
pgrep -fl "node.*serve.js\|npm.*start" || echo "❌ No IC Mesh processes found"
echo ""
```

## API Error Codes and Solutions

### HTTP Status Codes

#### 400 Bad Request
**Common causes:**
- Invalid JSON in request body
- Missing required parameters
- Invalid parameter types

**Example errors:**
```json
{
  "error": "Missing required field: capabilities",
  "code": "VALIDATION_ERROR"
}
```

**Solutions:**
```bash
# Validate JSON format
echo '{"nodeId":"test"}' | jq .

# Check required fields for /register
curl -X POST http://localhost:8333/register \
  -H "Content-Type: application/json" \
  -d '{"nodeId":"node-123","capabilities":["transcription"],"webhook":"http://localhost:3000/webhook"}'
```

#### 401 Unauthorized
**Common causes:**
- Missing API key for protected endpoints
- Invalid or expired API key
- Wrong authentication header format

**Solutions:**
```bash
# Check API key format
curl -H "Authorization: Bearer your-api-key-here" http://localhost:8333/jobs/submit

# Generate new API key (requires authentication)
curl -X POST https://moilol.com/api/auth/keys -H "Content-Type: application/json" -H "Cookie: session=your-session"
```

#### 404 Not Found
**Common causes:**
- Wrong endpoint URL
- Node ID doesn't exist
- Job ID doesn't exist

**Solutions:**
```bash
# List available endpoints
curl http://localhost:8333/ | jq .endpoints

# Check if node exists
curl http://localhost:8333/nodes | jq '.[] | select(.nodeId == "your-node-id")'
```

#### 409 Conflict
**Common causes:**
- Duplicate node registration
- Job already claimed
- Race condition in database

**Solutions:**
```bash
# Check existing registrations
curl http://localhost:8333/nodes | jq '.[] | .nodeId'

# Generate unique node ID
node -e "console.log('node-' + Date.now() + '-' + Math.random().toString(36).substr(2,9))"
```

#### 429 Too Many Requests
**Common causes:**
- Rate limiting triggered
- Too many concurrent requests
- DDoS protection activated

**Solutions:**
```bash
# Add delay between requests
sleep 1 && curl http://localhost:8333/status

# Use exponential backoff
for i in {1..5}; do curl http://localhost:8333/status && break || sleep $((2**i)); done
```

#### 500 Internal Server Error
**Common causes:**
- Database connection issues
- Uncaught exceptions
- File system problems

**Solutions:**
```bash
# Check logs for details
tail -f logs/error.log

# Check database integrity
sqlite3 data/mesh.db "PRAGMA integrity_check;"

# Restart service
npm restart
```

## Node Registration Issues

### ❌ "Connection refused" when registering node

**Detailed diagnosis:**
```bash
# Test basic connectivity
telnet localhost 8333

# Check if service is bound to correct interface
netstat -tulpn | grep :8333

# Verify hub process is running
ps aux | grep "serve.js\|npm.*start"
```

**Solutions:**
1. **Hub not running:**
   ```bash
   cd ic-mesh && npm start
   ```

2. **Wrong port configuration:**
   ```bash
   PORT=8333 npm start  # Set correct port
   ```

3. **Firewall blocking:**
   ```bash
   sudo ufw allow 8333/tcp
   sudo iptables -A INPUT -p tcp --dport 8333 -j ACCEPT
   ```

4. **Hub bound to localhost only:**
   ```bash
   BIND_ADDRESS=0.0.0.0 PORT=8333 npm start
   ```

### ❌ "Node registration failed" 

**Detailed error analysis:**
```bash
# Check full error response
curl -v -X POST http://localhost:8333/register \
  -H "Content-Type: application/json" \
  -d @node-config.json

# Validate node config format
cat node-config.json | jq .
```

**Common configuration errors:**

1. **Missing required fields:**
   ```json
   {
     "nodeId": "node-123",          // ✅ Required
     "capabilities": ["transcription"], // ✅ Required 
     "webhook": "http://...",       // ✅ Required
     "metadata": {}                 // Optional
   }
   ```

2. **Invalid capability names:**
   ```bash
   # Check available capabilities
   curl http://localhost:8333/capabilities
   ```

3. **Duplicate nodeId:**
   ```bash
   # Check existing nodes
   curl http://localhost:8333/nodes | jq '.[].nodeId'
   
   # Generate unique ID
   node -e "console.log('node-' + require('crypto').randomBytes(8).toString('hex'))"
   ```

## Job Submission Problems

### ❌ "No available nodes" for job

**Detailed analysis:**
```bash
# Check nodes with specific capability
curl http://localhost:8333/nodes | jq '.[] | select(.capabilities | contains(["transcription"]))'

# Check node status
curl http://localhost:8333/nodes | jq '.[] | {nodeId, status, lastSeen}'

# Check job requirements vs available capabilities
echo "Job requirements:" && cat job.json | jq .requirements
echo "Available capabilities:" && curl -s http://localhost:8333/capabilities | jq .
```

**Solutions:**
1. **No nodes with required capability:**
   ```bash
   # Start a node with required capability
   node client.js --capabilities transcription
   ```

2. **Nodes offline:**
   ```bash
   # Check node health
   curl http://localhost:8333/nodes | jq '.[] | select(.status != "online")'
   
   # Restart offline nodes
   ```

3. **Insufficient credits:**
   ```bash
   # Check credit balance
   curl -H "Authorization: Bearer $API_KEY" http://localhost:8333/api/balance
   
   # Buy more credits
   curl -X POST http://localhost:8333/api/buy-credits -H "Content-Type: application/json" -d '{"pack":"starter"}'
   ```

### ❌ Jobs stuck in "pending" status

**Diagnostic commands:**
```bash
# Check job details
curl http://localhost:8333/jobs/available | jq '.[] | select(.status == "pending")'

# Check if nodes are claiming jobs
curl http://localhost:8333/jobs/available | jq 'map(select(.claimedBy)) | length'

# Monitor job state changes
watch 'curl -s http://localhost:8333/jobs/available | jq "group_by(.status) | map({status: .[0].status, count: length})"'
```

**Common causes and fixes:**

1. **Nodes not pulling jobs:**
   ```bash
   # Check WebSocket connections
   curl http://localhost:8333/status | jq .connections
   
   # Restart node clients
   pkill -f client.js && node client.js
   ```

2. **Job timeout too short:**
   ```json
   {
     "handler": "transcribe",
     "input": "audio.wav",
     "timeout": 300000  // 5 minutes instead of default 60s
   }
   ```

3. **Handler not available:**
   ```bash
   # Check available handlers
   curl http://localhost:8333/handlers
   
   # Install missing handler
   npm install handler-package
   ```

## WebSocket Connection Issues

### ❌ "WebSocket connection failed"

**Detailed diagnostics:**
```bash
# Test WebSocket manually
npm install -g wscat
wscat -c "ws://localhost:8333/ws?nodeId=test-node"

# Check WebSocket upgrade headers
curl -v -H "Connection: Upgrade" -H "Upgrade: websocket" http://localhost:8333/ws?nodeId=test
```

**Network-specific solutions:**

1. **Behind reverse proxy:**
   ```nginx
   # Nginx configuration
   location /ws {
       proxy_pass http://backend;
       proxy_http_version 1.1;
       proxy_set_header Upgrade $http_upgrade;
       proxy_set_header Connection "upgrade";
       proxy_set_header Host $host;
   }
   ```

2. **Corporate firewall:**
   ```bash
   # Use HTTP polling fallback
   node client.js --no-websocket --poll-interval 5000
   ```

3. **SSL/TLS issues:**
   ```bash
   # Use secure WebSocket
   wscat -c "wss://your-domain.com/ws?nodeId=test-node"
   ```

### ❌ "Authentication required" on WebSocket

**Detailed validation:**
```bash
# Check URL format
echo "ws://localhost:8333/ws?nodeId=your-node-id"

# Verify node exists
curl http://localhost:8333/nodes | jq '.[] | select(.nodeId == "your-node-id")'

# Test with different nodeId
wscat -c "ws://localhost:8333/ws?nodeId=debug-$(date +%s)"
```

## Performance Issues

### ⚠️ High memory usage on hub

**Memory monitoring:**
```bash
# Continuous memory monitoring
while true; do
  echo "$(date): $(ps -o pid,vsz,rss,comm -p $(pgrep -f serve.js) | tail -1)"
  sleep 10
done

# Node.js memory details
node -e "setInterval(() => console.log(process.memoryUsage()), 5000)"
```

**Memory optimization:**
```bash
# Increase Node.js heap size
node --max-old-space-size=4096 serve.js

# Enable garbage collection logging
node --trace-gc serve.js

# Use streaming for large files
curl -X POST http://localhost:8333/upload \
  --data-binary @large-file.dat \
  -H "Content-Type: application/octet-stream"
```

### ⚠️ Slow job processing

**Performance profiling:**
```bash
# Monitor job processing times
curl http://localhost:8333/jobs/completed | jq '.[] | {id, handler, processingTime: (.completedAt - .claimedAt)}'

# Check node performance
curl http://localhost:8333/nodes | jq '.[] | {nodeId, load: .metadata.load, uptime: .metadata.uptime}'

# Network latency test
ping -c 10 hub-hostname
traceroute hub-hostname
```

**Performance optimization:**
1. **Horizontal scaling:**
   ```bash
   # Start multiple nodes with same capabilities
   for i in {1..3}; do
     node client.js --nodeId "node-worker-$i" --capabilities transcription &
   done
   ```

2. **Load balancing:**
   ```bash
   # Use multiple hub instances
   HAProxy or Nginx upstream configuration
   ```

3. **Resource monitoring:**
   ```bash
   # System resource usage
   top -p $(pgrep -f "serve.js\|client.js")
   
   # I/O monitoring
   iotop -p $(pgrep -f "serve.js")
   ```

## Database Issues

### ❌ "Database locked" errors

**Advanced diagnostics:**
```bash
# Check database locks
lsof data/mesh.db*

# SQLite busy timeout check
sqlite3 data/mesh.db "PRAGMA busy_timeout;"

# WAL mode verification
sqlite3 data/mesh.db "PRAGMA journal_mode;"
```

**Recovery procedures:**
```bash
# Safe database recovery
cp data/mesh.db data/mesh.db.backup
sqlite3 data/mesh.db "PRAGMA integrity_check;"

# Force WAL checkpoint
sqlite3 data/mesh.db "PRAGMA wal_checkpoint(FULL);"

# Reset to rollback journal
sqlite3 data/mesh.db "PRAGMA journal_mode=DELETE; PRAGMA journal_mode=WAL;"
```

### ❌ "No such table" error

**Schema verification:**
```bash
# Check table structure
sqlite3 data/mesh.db ".schema"

# List all tables
sqlite3 data/mesh.db ".tables"

# Check specific table
sqlite3 data/mesh.db "SELECT sql FROM sqlite_master WHERE name='nodes';"
```

**Database migration:**
```bash
# Backup before migration
cp data/mesh.db data/mesh.db.pre-migration

# Manual schema creation (if needed)
sqlite3 data/mesh.db < schema.sql

# Verify migration
npm run test:db
```

## Network Connectivity

### ❌ Can't reach hub from other machines

**Network diagnostics:**
```bash
# Check listening ports
sudo netstat -tulpn | grep :8333

# Test from remote machine
telnet hub-ip 8333
nc -zv hub-ip 8333

# Check routing
ip route show
traceroute hub-ip
```

**Firewall configuration:**
```bash
# Ubuntu/Debian UFW
sudo ufw allow from any to any port 8333

# CentOS/RHEL firewalld
sudo firewall-cmd --permanent --add-port=8333/tcp
sudo firewall-cmd --reload

# Check iptables rules
sudo iptables -L -n | grep 8333
```

**Network security:**
```bash
# Bind to specific interface only
BIND_ADDRESS=192.168.1.100 npm start

# Use SSL termination
# Configure reverse proxy with SSL certificates
```

### ❌ CORS errors in browser

**CORS configuration:**
```javascript
// In serve.js, add CORS headers
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  next();
});
```

**Reverse proxy solution:**
```nginx
server {
    listen 80;
    server_name your-domain.com;
    
    location / {
        proxy_pass http://localhost:8333;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        add_header Access-Control-Allow-Origin *;
    }
}
```

## Advanced Debugging

### Log Analysis Tools

**Structured logging analysis:**
```bash
# Error pattern analysis
grep -E "(ERROR|FATAL)" logs/*.log | cut -d' ' -f3- | sort | uniq -c | sort -nr

# Performance bottlenecks
grep "slow" logs/*.log | awk '{print $6}' | sort -n | tail -10

# WebSocket connection patterns
grep "websocket" logs/*.log | grep -o "connected\|disconnected" | sort | uniq -c
```

**Real-time monitoring:**
```bash
# Tail multiple logs
multitail logs/app.log logs/error.log logs/access.log

# JSON log parsing
tail -f logs/app.log | jq 'select(.level == "ERROR")'
```

### Debug Mode Configuration

**Enable comprehensive debugging:**
```bash
# Maximum debug output
DEBUG=* NODE_ENV=development npm start

# Specific module debugging
DEBUG=ic-mesh:websocket,ic-mesh:database npm start

# Performance profiling
node --prof serve.js
```

### Database Analysis

**Query performance:**
```bash
# Enable query logging
sqlite3 data/mesh.db "PRAGMA query_only = ON;"

# Analyze query plans
sqlite3 data/mesh.db "EXPLAIN QUERY PLAN SELECT * FROM jobs WHERE status = 'pending';"

# Index optimization
sqlite3 data/mesh.db "ANALYZE;"
```

## Emergency Procedures

### Service Recovery

**Automated recovery script:**
```bash
#!/bin/bash
# emergency-recovery.sh

echo "=== Emergency IC Mesh Recovery ==="

# 1. Stop all processes
pkill -f "serve.js\|client.js"
sleep 5

# 2. Backup database
cp data/mesh.db "data/mesh.db.emergency-$(date +%s)" 2>/dev/null

# 3. Check database integrity
if ! sqlite3 data/mesh.db "PRAGMA integrity_check;" | grep -q "ok"; then
    echo "❌ Database corrupted, restoring from backup"
    cp data/mesh.db.backup data/mesh.db
fi

# 4. Clear stale locks
rm -f data/mesh.db-wal data/mesh.db-shm

# 5. Restart service
npm start &
sleep 10

# 6. Verify recovery
if curl -s http://localhost:8333/status | grep -q "OK"; then
    echo "✅ Recovery successful"
else
    echo "❌ Recovery failed, manual intervention required"
fi
```

### Data Recovery

**Job data recovery:**
```bash
# Export all jobs before corruption
sqlite3 data/mesh.db "SELECT * FROM jobs;" > jobs-backup.sql

# Recover specific job data
sqlite3 data/mesh.db "SELECT input, output FROM jobs WHERE id = 'job-123';"
```

## Getting Help

### Information to Include

When reporting issues, include:

**System Information:**
```bash
# Generate diagnostic report
curl -s http://localhost:8333/status > status.json
node --version > system-info.txt
uname -a >> system-info.txt
df -h >> system-info.txt
free -m >> system-info.txt
```

**Log Collection:**
```bash
# Collect relevant logs
mkdir ic-mesh-debug-$(date +%s)
cp logs/*.log ic-mesh-debug-*/
cp data/mesh.db ic-mesh-debug-*/
tar -czf ic-mesh-debug.tar.gz ic-mesh-debug-*/
```

### Support Channels

1. 📊 **Check system status:** [Network Dashboard](https://moilol.com/mesh)
2. 📖 **Documentation:** [IC Mesh Docs](https://github.com/intelligence-club/ic-mesh/docs)
3. 🐛 **Report bugs:** [GitHub Issues](https://github.com/intelligence-club/ic-mesh/issues)  
4. 💬 **Community help:** [OpenClaw Discord](https://discord.gg/openclaw)
5. 📧 **Direct support:** [hello@moilol.com](mailto:hello@moilol.com)

**Include in support requests:**
- Operating system and Node.js version
- Complete error messages and stack traces  
- Steps to reproduce the issue
- System diagnostic output (from scripts above)
- Recent log files (last 100 lines minimum)

### Emergency Contacts

- **Critical system issues:** hello@moilol.com
- **Security vulnerabilities:** security@moilol.com  
- **Business inquiries:** business@moilol.com

---

*This troubleshooting guide is actively maintained. Last updated: 2026-02-25*