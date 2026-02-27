# IC Mesh Troubleshooting & Deployment Guide

*Your complete reference for diagnosing, fixing, and deploying IC Mesh systems*

## Quick Diagnosis Commands

**Before you debug, run these commands to gather information:**

```bash
# System health overview
npm run health

# Detailed node diagnostics  
npm run diagnostics:full

# Performance analysis
node scripts/performance-optimizer.js analyze

# Check environment variables
npm run check-env

# View recent logs
npm run logs
```

**Emergency shortcuts for common fixes:**
```bash
# Fix 90% of "not working" issues
npm run test                    # Run all tests
npm run backup                  # Backup database first
systemctl restart ic-mesh       # Restart service

# Fix database corruption
cp data/mesh.db data/mesh.db.backup
node scripts/performance-optimizer.js optimize
```

---

## Problem Categories & Solutions

### 1. Server Won't Start

#### Problem: `Error: EADDRINUSE :::8333`
**Cause:** Another process is using port 8333
**Solution:**
```bash
# Find what's using the port
sudo netstat -tlnp | grep 8333
# OR
lsof -i :8333

# Kill the process (replace PID with actual process ID)
sudo kill -9 <PID>

# Then restart
npm start
```

#### Problem: `Error: SQLITE_CANTOPEN: unable to open database file`
**Cause:** Database file permissions or missing data directory
**Solution:**
```bash
# Create data directory
mkdir -p data

# Fix permissions
chmod 755 data
touch data/mesh.db
chmod 644 data/mesh.db

# If owned by wrong user
sudo chown -R $(whoami):$(whoami) data/
```

#### Problem: `Error: Cannot find module './lib/storage'`
**Cause:** Missing dependencies or incomplete installation
**Solution:**
```bash
# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install

# Verify all files present
ls -la lib/
ls -la scripts/

# If still missing, re-clone repository
```

#### Problem: Server starts but crashes immediately
**Check logs for specific error:**
```bash
# Check system logs
journalctl -u ic-mesh -f

# Check application logs
tail -f data/mesh.log

# Check for memory/resource issues
free -h
df -h
```

### 2. Database Issues

#### Problem: `SQLITE_BUSY: database is locked`
**Cause:** Another process has database lock or unclean shutdown
**Solution:**
```bash
# Check for other IC Mesh processes
ps aux | grep node | grep server.js

# Kill any duplicate processes
sudo pkill -f "node server.js"

# If persistent, backup and recreate database
cp data/mesh.db data/mesh.db.backup
sqlite3 data/mesh.db ".backup data/mesh.db.clean"
mv data/mesh.db.clean data/mesh.db
```

#### Problem: Database corruption or slow queries
**Diagnosis:**
```bash
# Check database integrity
sqlite3 data/mesh.db "PRAGMA integrity_check;"

# Analyze database performance
node scripts/performance-optimizer.js analyze
```

**Solution:**
```bash
# Fix fragmentation and optimize
node scripts/performance-optimizer.js optimize

# If corruption found, restore from backup
ls -la data/*.backup*
cp data/mesh.db.backup.YYYYMMDD_HHMMSS data/mesh.db
```

#### Problem: `Error: no such table: jobs`
**Cause:** Database schema not initialized
**Solution:**
```bash
# Check if tables exist
sqlite3 data/mesh.db ".tables"

# If empty, database needs initialization
# Delete empty database and restart server to recreate
rm data/mesh.db
npm start  # Server will create tables on startup
```

### 3. Network & Connectivity Issues

#### Problem: Nodes can't connect to mesh
**Diagnosis:**
```bash
# Test local connectivity
curl http://localhost:8333/status

# Test external connectivity
curl https://moilol.com/mesh/status

# Check firewall
sudo ufw status
sudo iptables -L
```

**Solutions:**
```bash
# Open firewall ports
sudo ufw allow 8333
sudo ufw allow 8334  # WebSocket port if different

# Check server binding
netstat -tlnp | grep 8333

# If bound to 127.0.0.1, server not accessible externally
# Edit server.js to bind to 0.0.0.0
```

#### Problem: WebSocket connections failing
**Diagnosis:**
```bash
# Test WebSocket connectivity
node -e "
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:8333/ws?nodeId=test');
ws.on('open', () => console.log('Connected'));
ws.on('error', (e) => console.log('Error:', e.message));
setTimeout(() => process.exit(0), 2000);
"
```

**Solutions:**
```bash
# Check server WebSocket handler
grep -n "WebSocketServer" server.js

# Verify WebSocket upgrade process
# Check if reverse proxy (nginx/apache) supports WebSocket upgrades

# For nginx, add to location block:
# proxy_http_version 1.1;
# proxy_set_header Upgrade $http_upgrade;
# proxy_set_header Connection "upgrade";
```

#### Problem: API endpoints returning 404
**Cause:** Wrong base URL (common mistake)
**Reference:**
```bash
# Mesh hub endpoints (port 8333)
POST /mesh/jobs              ✓ Correct
POST /mesh/cashout           ✓ Correct

# Site endpoints (port 80/443)  
POST /api/buy-credits        ✓ Correct
POST /api/auth/keys          ✓ Correct

# Common mistakes:
POST /buy-credits            ❌ Wrong (missing /api/)
POST /api/cashout            ❌ Wrong (should be /mesh/)
```

### 4. Job Processing Issues

#### Problem: Jobs stuck in "pending" state
**Diagnosis:**
```bash
# Check active nodes
curl -s http://localhost:8333/nodes | jq '.'

# Check job queue
sqlite3 data/mesh.db "SELECT id, nodeId, status, capability, createdAt FROM jobs WHERE status='pending' ORDER BY createdAt DESC LIMIT 10;"

# Check node capabilities
npm run diagnostics:capabilities
```

**Solutions:**
```bash
# If no active nodes
# Nodes need to register and heartbeat every 5 minutes

# If nodes exist but not claiming jobs
# Check node capabilities match job requirements
# Check if nodes are overloaded

# If specific capability missing
# Add handler to node or wait for capable node to join

# Manual job cleanup (if really stuck)
sqlite3 data/mesh.db "UPDATE jobs SET status='failed', result='timeout' WHERE status='pending' AND createdAt < datetime('now', '-1 hour');"
```

#### Problem: Jobs failing with timeout
**Diagnosis:**
```bash
# Check job timeout settings in server.js
grep -n "timeout" server.js

# Check node processing capabilities
node scripts/node-diagnostics.js --full

# Check if input files are accessible
curl -I <job_input_url>
```

**Solutions:**
```bash
# Increase timeout for large files (in server.js)
# Default timeout is usually 300 seconds (5 minutes)

# For nodes: ensure sufficient resources
free -h    # Check memory
df -h      # Check disk space
htop       # Check CPU usage

# For large files: optimize input size or use streaming
```

#### Problem: Handler crashes or produces errors
**Node-side debugging:**
```bash
# Check handler logs
tail -f /path/to/handler/logs

# Test handler locally
echo "test input" | your-handler-command

# Check handler dependencies
which ffmpeg     # For media processing
which whisper    # For transcription  
python3 -c "import torch; print(torch.cuda.is_available())"  # For GPU
```

### 5. Performance Issues

#### Problem: Slow database queries
**Diagnosis:**
```bash
# Analyze query performance
node scripts/performance-optimizer.js benchmark

# Check database size and fragmentation
ls -lh data/mesh.db
sqlite3 data/mesh.db "PRAGMA page_count; PRAGMA freelist_count;"
```

**Solutions:**
```bash
# Optimize database
node scripts/performance-optimizer.js optimize

# Add missing indexes (if needed)
sqlite3 data/mesh.db "CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);"
sqlite3 data/mesh.db "CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(createdAt);"

# Clean up old data
sqlite3 data/mesh.db "DELETE FROM jobs WHERE status IN ('completed', 'failed') AND createdAt < datetime('now', '-30 days');"
```

#### Problem: High memory usage
**Diagnosis:**
```bash
# Check memory usage
node scripts/performance-optimizer.js analyze

# Monitor memory over time
watch -n 5 'ps aux | grep "node server.js"'

# Check for memory leaks
node --inspect server.js
# Open chrome://inspect in browser
```

**Solutions:**
```bash
# Restart server to clear memory
systemctl restart ic-mesh

# Increase memory limit
node --max-old-space-size=4096 server.js

# Profile and fix memory leaks
# Use Chrome DevTools heap profiler
```

#### Problem: High CPU usage
**Diagnosis:**
```bash
# Check CPU usage patterns
htop
iotop    # Check I/O usage
```

**Solutions:**
```bash
# Check for infinite loops or blocking operations
# Profile with Node.js profiler
node --prof server.js

# Optimize database queries
# Add rate limiting for API endpoints
# Consider clustering for multiple CPU cores
```

### 6. Payment & Stripe Issues

#### Problem: Credit purchases failing
**Diagnosis:**
```bash
# Test buy-credits endpoint
curl -X POST https://moilol.com/api/buy-credits \
  -H "Content-Type: application/json" \
  -d '{"amount": 1000, "apiKey": "your_key"}'

# Check Stripe webhook logs
tail -f data/stripe-webhooks.log
```

**Solutions:**
```bash
# Verify environment variables
npm run check-env | grep STRIPE

# Test Stripe connectivity
curl -u ${STRIPE_SECRET_KEY}: https://api.stripe.com/v1/charges

# Check webhook endpoint accessibility
curl -X POST https://moilol.com/api/stripe/webhook -H "stripe-signature: test"
```

#### Problem: Cashout/withdrawal failures
**Diagnosis:**
```bash
# Check Stripe Connect setup
curl -s http://localhost:8333/mesh/cashout \
  -H "Authorization: Bearer your_api_key" \
  -H "Content-Type: application/json" \
  -d '{}'

# Verify node has earnings to withdraw
sqlite3 data/mesh.db "SELECT nodeId, SUM(ints) as earnings FROM jobs WHERE status='completed' GROUP BY nodeId;"
```

### 7. Security Issues

#### Problem: Unauthorized API access
**Diagnosis:**
```bash
# Check API key validation
grep -n "Authorization" server.js lib/*.js

# Test API key validation
curl -H "Authorization: Bearer invalid_key" http://localhost:8333/nodes
```

**Solutions:**
```bash
# Regenerate compromised API keys
sqlite3 data/mesh.db "UPDATE apiKeys SET key = 'revoked_' || datetime('now') WHERE key = 'compromised_key';"

# Add IP-based rate limiting
# Check server.js for rate limiting configuration

# Enable access logging
# Add middleware to log all API requests
```

#### Problem: File upload vulnerabilities
**Diagnosis:**
```bash
# Check file upload restrictions
grep -n "upload" server.js

# Test file type validation
curl -X POST http://localhost:8333/upload -F "file=@malicious.exe"
```

**Solutions:**
```bash
# Verify file type validation is enabled
# Check maximum file size limits
# Ensure uploaded files are scanned/sandboxed
# Never execute uploaded files directly
```

---

## Deployment Scenarios

### 1. Single Server Deployment

**Basic setup on Ubuntu 22.04:**
```bash
# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Clone and setup
git clone https://github.com/your-org/ic-mesh.git
cd ic-mesh
npm install

# Create service user
sudo useradd -r -s /bin/false ic-mesh
sudo mkdir -p /opt/ic-mesh
sudo cp -r * /opt/ic-mesh/
sudo chown -R ic-mesh:ic-mesh /opt/ic-mesh

# Create systemd service
sudo tee /etc/systemd/system/ic-mesh.service > /dev/null <<EOF
[Unit]
Description=IC Mesh Coordination Server
After=network.target

[Service]
Type=simple
User=ic-mesh
Group=ic-mesh
WorkingDirectory=/opt/ic-mesh
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=10

Environment=NODE_ENV=production
Environment=PORT=8333

[Install]
WantedBy=multi-user.target
EOF

# Start service
sudo systemctl daemon-reload
sudo systemctl enable ic-mesh
sudo systemctl start ic-mesh
```

**Nginx reverse proxy config:**
```nginx
upstream ic_mesh {
    server 127.0.0.1:8333;
}

server {
    listen 80;
    server_name your-mesh-domain.com;
    
    location /mesh/ {
        proxy_pass http://ic_mesh/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    
    location /ws {
        proxy_pass http://ic_mesh/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

### 2. Load Balanced Deployment

**For high availability with multiple servers:**

```bash
# Database setup (external PostgreSQL recommended)
# Update lib/storage.js to use PostgreSQL instead of SQLite

# Load balancer config (HAProxy example)
cat > /etc/haproxy/haproxy.cfg <<EOF
global
    daemon

defaults
    mode http
    timeout connect 5000ms
    timeout client 50000ms
    timeout server 50000ms

frontend ic_mesh_frontend
    bind *:80
    default_backend ic_mesh_servers

backend ic_mesh_servers
    balance roundrobin
    option httpchk GET /status
    server mesh1 10.0.1.10:8333 check
    server mesh2 10.0.1.11:8333 check
    server mesh3 10.0.1.12:8333 check
EOF

# Sticky sessions for WebSocket connections
frontend ic_mesh_websocket
    bind *:8080
    default_backend ic_mesh_websocket_servers

backend ic_mesh_websocket_servers
    balance source
    server mesh1 10.0.1.10:8333 check
    server mesh2 10.0.1.11:8333 check
    server mesh3 10.0.1.12:8333 check
```

### 3. Docker Deployment

**Dockerfile:**
```dockerfile
FROM node:18-alpine

# Create app directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./
RUN npm ci --only=production

# Copy app source
COPY . .

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001
RUN chown -R nodejs:nodejs /usr/src/app
USER nodejs

# Expose port
EXPOSE 8333

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node scripts/health-check.js || exit 1

# Start command
CMD ["node", "server.js"]
```

**Docker Compose for development:**
```yaml
version: '3.8'

services:
  ic-mesh:
    build: .
    ports:
      - "8333:8333"
    volumes:
      - mesh-data:/usr/src/app/data
      - ./config.json:/usr/src/app/config.json:ro
    environment:
      - NODE_ENV=production
      - DATABASE_PATH=/usr/src/app/data/mesh.db
    healthcheck:
      test: ["CMD", "node", "scripts/health-check.js"]
      interval: 30s
      timeout: 10s
      retries: 3
    restart: unless-stopped

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./ssl:/etc/nginx/ssl:ro
    depends_on:
      - ic-mesh
    restart: unless-stopped

volumes:
  mesh-data:
```

### 4. Cloud Deployment (Digital Ocean)

**Automated deployment script:**
```bash
#!/bin/bash

# Create droplet
doctl compute droplet create ic-mesh-prod \
  --image ubuntu-22-04-x64 \
  --size s-2vcpu-2gb \
  --region nyc3 \
  --ssh-keys $(doctl compute ssh-key list --format ID --no-header)

# Wait for droplet to be ready
sleep 60

# Get droplet IP
DROPLET_IP=$(doctl compute droplet get ic-mesh-prod --format PublicIPv4 --no-header)

# Install and configure
ssh root@$DROPLET_IP << 'EOF'
# System updates
apt update && apt upgrade -y

# Install Node.js, nginx, certbot
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt-get install -y nodejs nginx certbot python3-certbot-nginx

# Clone and setup application
cd /opt
git clone https://github.com/your-org/ic-mesh.git
cd ic-mesh
npm install --production
npm run check-env

# Setup systemd service (same as above)
# Configure nginx (same as above) 
# Setup SSL with certbot

systemctl enable ic-mesh nginx
systemctl start ic-mesh nginx
EOF

echo "Deployment completed. Server available at: $DROPLET_IP"
```

### 5. Monitoring & Logging

**Comprehensive monitoring setup:**

```bash
# Install monitoring tools
npm install -g pm2

# PM2 ecosystem file
cat > ecosystem.config.js <<EOF
module.exports = {
  apps: [{
    name: 'ic-mesh',
    script: 'server.js',
    instances: 1,
    exec_mode: 'fork',
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 8333
    },
    log_file: 'logs/combined.log',
    out_file: 'logs/out.log',
    error_file: 'logs/error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
  }]
}
EOF

# Start with PM2
pm2 start ecosystem.config.js
pm2 startup  # Setup PM2 to start on boot
pm2 save     # Save current PM2 configuration

# Setup log rotation
pm2 install pm2-logrotate
pm2 set pm2-logrotate:retain 30
pm2 set pm2-logrotate:max_size 100M
```

**System monitoring script:**
```bash
#!/bin/bash
# Add to crontab: */5 * * * * /opt/ic-mesh/scripts/monitor.sh

# Check service status
if ! systemctl is-active --quiet ic-mesh; then
    echo "$(date): IC Mesh service is down, restarting..." >> /var/log/ic-mesh-monitor.log
    systemctl restart ic-mesh
fi

# Check disk space
DISK_USAGE=$(df / | awk 'NR==2 {print $5}' | sed 's/%//')
if [ $DISK_USAGE -gt 90 ]; then
    echo "$(date): Disk usage high: ${DISK_USAGE}%" >> /var/log/ic-mesh-monitor.log
    # Clean up old logs, backups, etc.
    find /opt/ic-mesh/data -name "*.backup*" -mtime +7 -delete
fi

# Check memory usage
MEMORY_USAGE=$(free | awk 'NR==2{printf "%.0f", $3*100/$2}')
if [ $MEMORY_USAGE -gt 90 ]; then
    echo "$(date): Memory usage high: ${MEMORY_USAGE}%" >> /var/log/ic-mesh-monitor.log
    systemctl restart ic-mesh
fi

# Database integrity check (weekly)
if [ $(date +%u) -eq 1 ] && [ $(date +%H) -eq 2 ]; then
    echo "$(date): Running weekly database integrity check..." >> /var/log/ic-mesh-monitor.log
    node /opt/ic-mesh/scripts/performance-optimizer.js analyze >> /var/log/ic-mesh-monitor.log 2>&1
fi
```

---

## Emergency Procedures

### 1. Complete System Recovery

**If everything is broken:**
```bash
# 1. Stop services
sudo systemctl stop ic-mesh nginx
sudo pkill -f "node server"

# 2. Backup current state
mkdir -p ~/ic-mesh-emergency-backup/$(date +%Y%m%d_%H%M%S)
cp -r /opt/ic-mesh/data ~/ic-mesh-emergency-backup/$(date +%Y%m%d_%H%M%S)/
cp /opt/ic-mesh/.env ~/ic-mesh-emergency-backup/$(date +%Y%m%d_%H%M%S)/

# 3. Fresh installation
cd /opt
sudo rm -rf ic-mesh.old
sudo mv ic-mesh ic-mesh.old
sudo git clone https://github.com/your-org/ic-mesh.git
cd ic-mesh
sudo npm install --production

# 4. Restore data and configuration
sudo cp ~/ic-mesh-emergency-backup/*/data/* data/
sudo cp ~/ic-mesh-emergency-backup/*/.env .
sudo chown -R ic-mesh:ic-mesh /opt/ic-mesh

# 5. Test before starting
npm run check-env
npm run test

# 6. Start services
sudo systemctl start ic-mesh
sudo systemctl start nginx

# 7. Verify functionality
curl http://localhost:8333/status
```

### 2. Database Disaster Recovery

**If database is corrupted beyond repair:**
```bash
# 1. Stop server
sudo systemctl stop ic-mesh

# 2. Analyze corruption
sqlite3 data/mesh.db "PRAGMA integrity_check;"

# 3. Try to salvage data
sqlite3 data/mesh.db ".dump" > data/dump.sql

# 4. Create new database
mv data/mesh.db data/mesh.db.corrupted
sqlite3 data/mesh.db.new < data/dump.sql

# 5. If dump fails, restore from backup
ls -la data/*.backup*
cp data/mesh.db.backup.YYYYMMDD_HHMMSS data/mesh.db

# 6. Start server (will recreate tables if needed)
sudo systemctl start ic-mesh

# 7. Verify data integrity
npm run test
curl http://localhost:8333/status
```

---

## Best Practices & Maintenance

### Daily Monitoring
```bash
# Add to daily cron
0 9 * * * cd /opt/ic-mesh && npm run health >> logs/daily-health.log
```

### Weekly Maintenance
```bash
# Add to weekly cron (Sunday 3 AM)
0 3 * * 0 cd /opt/ic-mesh && npm run backup && node scripts/performance-optimizer.js optimize
```

### Monthly Tasks
```bash
# Update system and dependencies
sudo apt update && sudo apt upgrade -y
cd /opt/ic-mesh && npm update

# Review logs and clean up old data
find logs/ -name "*.log" -mtime +30 -delete
sqlite3 data/mesh.db "DELETE FROM jobs WHERE status IN ('completed', 'failed') AND createdAt < datetime('now', '-60 days');"

# Performance analysis and optimization
node scripts/performance-optimizer.js report
```

### Security Updates
```bash
# Check for security vulnerabilities
npm audit

# Update Node.js security patches
# Follow Node.js security release notes

# Review and update firewall rules
sudo ufw status
# Ensure only necessary ports are open
```

---

## Getting Help

### Information to Collect Before Reporting Issues

**System Information:**
```bash
# System details
uname -a
cat /etc/os-release
node --version
npm --version

# Service status  
systemctl status ic-mesh
journalctl -u ic-mesh --since "1 hour ago"

# Resource usage
free -h
df -h
ps aux | grep node

# Network configuration
netstat -tlnp | grep 8333
ss -tlnp | grep 8333

# Application status
curl -s http://localhost:8333/status | jq '.'
npm run diagnostics:full
```

**Application Logs:**
```bash
# Recent application logs
tail -100 logs/combined.log
tail -100 data/mesh.log

# Error logs specifically
grep -i error logs/* | tail -50

# Database status
sqlite3 data/mesh.db "SELECT COUNT(*) FROM nodes; SELECT COUNT(*) FROM jobs;"
```

### Support Channels

1. **GitHub Issues**: For bugs and feature requests
2. **Documentation**: Check README.md and docs/ directory
3. **Community Discord**: For real-time help and discussion
4. **Email Support**: For private/security issues

### When to Escalate

**Immediate escalation (security/data loss):**
- Database corruption with no backups
- Security breach suspected
- Complete system failure in production
- Data loss or payment processing issues

**Standard support (within 24 hours):**
- Performance issues
- Configuration problems
- Integration questions
- Feature requests

---

*This guide covers the most common issues and solutions. For specific problems not covered here, collect the diagnostic information above and reach out for help.*