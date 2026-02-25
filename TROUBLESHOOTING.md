# IC Mesh Troubleshooting Guide

Common issues and their solutions for IC Mesh operators and clients.

## Node Registration Issues

### ❌ "Connection refused" when registering node

**Cause:** Hub is not running or wrong port  
**Solution:** 
```bash
# Check if hub is running
curl http://localhost:8333/status

# Start hub if needed
npm start

# Check firewall allows port 8333
sudo ufw allow 8333
```

### ❌ "Node registration failed" 

**Cause:** Invalid node configuration or duplicate nodeId  
**Solution:**
```bash
# Check node-config.json format
cat node-config.json | jq .

# Generate new nodeId if conflict
node -e "console.log('node-' + require('crypto').randomBytes(8).toString('hex'))"
```

## Job Submission Problems

### ❌ "No available nodes" for job

**Cause:** No nodes with required capabilities are online  
**Solution:**
```bash
# Check available nodes
curl http://localhost:8333/nodes

# Check specific capability
curl http://localhost:8333/nodes | jq '.[] | select(.capabilities[] == "transcription")'
```

### ❌ Jobs stuck in "pending" status

**Cause:** No nodes claiming jobs or insufficient credits  
**Solution:**
```bash
# Check job queue
curl http://localhost:8333/jobs/available

# Check node health  
curl http://localhost:8333/status

# Restart nodes if needed
```

## WebSocket Connection Issues

### ❌ "WebSocket connection failed"

**Cause:** Network issues or wrong URL format  
**Solution:**
```bash
# Test WebSocket manually
wscat -c "ws://localhost:8333/ws?nodeId=test-node"

# Check if behind proxy/load balancer
# Ensure WebSocket upgrade headers are passed
```

### ❌ "Authentication required" on WebSocket

**Cause:** Missing or invalid nodeId parameter  
**Solution:**
```bash
# Ensure nodeId is in URL
ws://localhost:8333/ws?nodeId=your-node-id

# Check nodeId exists in database
curl http://localhost:8333/nodes | jq '.[] | select(.nodeId == "your-node-id")'
```

## Performance Issues

### ⚠️ High memory usage on hub

**Cause:** Large job payloads or many concurrent connections  
**Solution:**
```bash
# Monitor memory
node -e "console.log(process.memoryUsage())"

# Use file uploads for large payloads
curl -X POST http://localhost:8333/upload -F "file=@large-file.dat"

# Restart hub periodically if needed
```

### ⚠️ Slow job processing

**Cause:** Node overload or network latency  
**Solution:**
```bash
# Check node CPU/memory
top -p $(pgrep node)

# Test network latency
ping <hub-host>

# Consider adding more nodes with same capabilities
```

## Database Issues

### ❌ "Database locked" errors

**Cause:** Concurrent access or unclean shutdown  
**Solution:**
```bash
# Check for other processes
lsof data/mesh.db

# Restart with WAL mode (done automatically)
rm -f data/mesh.db-wal data/mesh.db-shm
npm start
```

### ❌ "No such table" error

**Cause:** Database schema not initialized  
**Solution:**
```bash
# Remove corrupted database
rm -f data/mesh.db*

# Restart to recreate schema
npm start
```

## Network Connectivity

### ❌ Can't reach hub from other machines

**Cause:** Firewall or binding issues  
**Solution:**
```bash
# Check binding address
netstat -tulpn | grep :8333

# Allow through firewall
sudo ufw allow 8333/tcp

# Bind to all interfaces if needed
PORT=8333 BIND_ADDRESS=0.0.0.0 npm start
```

### ❌ CORS errors in browser

**Cause:** Cross-origin restrictions  
**Solution:**
```bash
# Use same origin or configure CORS headers
# Or proxy through your web server
nginx proxy_pass http://localhost:8333;
```

## Log Analysis

Enable debug logging:
```bash
DEBUG=ic-mesh* npm start
```

Check specific issues:
```bash
# WebSocket issues
grep -i websocket logs/app.log

# Database issues  
grep -i sqlite logs/app.log

# Job processing issues
grep -i "job.*error\|claim.*fail" logs/app.log
```

## Getting Help

If these solutions don't resolve your issue:

1. 📊 Check the [network status dashboard](https://moilol.com/mesh)
2. 🐛 Search [existing issues](https://github.com/intelligence-club/ic-mesh/issues)  
3. 💬 Ask in the [OpenClaw Discord](https://discord.gg/openclaw)
4. 📧 Email [hello@moilol.com](mailto:hello@moilol.com) with:
   - Operating system and Node.js version
   - Full error message and logs
   - Steps to reproduce the issue