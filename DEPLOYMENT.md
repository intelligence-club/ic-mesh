# IC Mesh Deployment Guide

## Prerequisites

- Node.js 18+ 
- npm or yarn
- Git (for updates)

## Production Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Initialize Database
```bash
node init-db.js
```

### 3. Start Server (Production)
```bash
# With PM2 (recommended)
npm install -g pm2
pm2 start server.js --name "ic-mesh-server"
pm2 startup
pm2 save

# Or with nohup
nohup node server.js > server.log 2>&1 &
```

### 4. Configure Worker Nodes
On each worker machine:
```bash
git clone <repository>
cd ic-mesh
npm install
IC_MESH_URL=http://your-server:8333 node client.js
```

## Environment Configuration

### Server (.env)
```bash
IC_MESH_PORT=8333
IC_MESH_HOST=0.0.0.0
IC_DEBUG=false
IC_LOG_LEVEL=info
```

### Client (.env)
```bash
IC_MESH_URL=http://localhost:8333
IC_NODE_ID=worker-1
IC_MAX_CONCURRENT_JOBS=2
```

## Monitoring Setup

### Health Checks
Add to your monitoring system:
```bash
# Simple health check
curl -f http://localhost:8333/health || exit 1

# Detailed status
curl http://localhost:8333/status | jq '.status == "online"'
```

### Log Rotation
```bash
# Using logrotate
sudo tee /etc/logrotate.d/ic-mesh << EOF
/path/to/ic-mesh/*.log {
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

## Backup Strategy

### Database Backup
```bash
# Daily backup script
#!/bin/bash
DATE=$(date +%Y%m%d)
cp mesh.db "backups/mesh-backup-${DATE}.db"
find backups/ -name "mesh-backup-*.db" -mtime +30 -delete
```

### Configuration Backup
```bash
tar -czf config-backup.tar.gz *.json *.env package.json
```

## Scaling

### Horizontal Scaling
- Run multiple server instances behind a load balancer
- Use shared database (PostgreSQL recommended for multi-server)
- Implement session affinity for WebSocket connections

### Vertical Scaling
- Increase `IC_MAX_CONCURRENT_JOBS` on worker nodes
- Add more RAM/CPU to server for larger job queues
- Use SSD storage for database performance

## Troubleshooting

### Common Issues

**Port already in use:**
```bash
# Find process using port 8333
ss -tlnp | grep :8333
# Kill if needed
sudo kill -9 <PID>
```

**Database locked:**
```bash
# Check for zombie connections
lsof mesh.db
# Restart server if needed
pm2 restart ic-mesh-server
```

**Node not connecting:**
```bash
# Check connectivity
curl http://your-server:8333/status
# Verify node logs
tail -f client.log
```

### Performance Monitoring

```bash
# Monitor job processing
watch 'curl -s http://localhost:8333/status | jq "{pending: .jobs.pending, processing: .jobs.processing, nodes: .nodes.active}"'

# Check node utilization  
curl http://localhost:8333/nodes | jq '.[] | {id: .id, load: .stats.load, jobs: .stats.activeJobs}'
```

## Security Hardening

### Network Security
- Use firewall rules to restrict access
- Enable HTTPS in production (reverse proxy recommended)
- Implement API authentication for sensitive operations

### Process Security  
- Run as non-root user
- Use process isolation (containers/VMs)
- Regular security updates

## Updates

### Server Updates
```bash
git pull origin main
npm install
pm2 restart ic-mesh-server
```

### Rolling Node Updates
```bash
# Update nodes one at a time to maintain capacity
for node in node1 node2 node3; do
  ssh $node 'cd ic-mesh && git pull && pm2 restart ic-mesh-client'
  sleep 30
done
```