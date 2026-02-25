# Operations Guide — IC Mesh + moilol.com

**Complete operational guide for maintaining the Intelligence Club distributed compute network and website.**

This guide covers daily operations, troubleshooting, monitoring, and maintenance procedures for both the IC Mesh network and moilol.com website infrastructure.

---

## 🚀 Quick Start for Operators

### Essential Commands
```bash
# Health checks
npm run diagnostics              # Node health check
npm run health-check             # IC Mesh system validation
npm run maintenance              # Website maintenance

# Monitoring 
npm run status                   # Network status dashboard
npm run performance-monitor      # Real-time performance monitoring

# Maintenance
npm run maintenance:cleanup      # Clean temp files
npm run maintenance:security     # Security audit
npm run deploy                   # Deploy updates
```

### Daily Checklist
- [ ] Check network status: `npm run status`
- [ ] Run diagnostics: `npm run diagnostics`
- [ ] Review logs: `npm run logs`
- [ ] Verify backups exist
- [ ] Monitor node earnings and job completion rates

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────┐
│                INFRASTRUCTURE                   │
├─────────────────┬───────────────────────────────┤
│   moilol.com    │         IC Mesh Network       │
│   (Website)     │       (Compute Nodes)         │
├─────────────────┼───────────────────────────────┤
│ • User portal   │ • Job coordination            │
│ • Stripe payments│ • WebSocket connections      │
│ • File uploads  │ • Capability detection       │
│ • Account mgmt  │ • Earnings ledger             │
│ • Admin tools   │ • Health monitoring           │
└─────────────────┴───────────────────────────────┘
```

### Key Components
- **moilol.com** — Web interface and payment processing
- **IC Mesh Hub** — Job coordination server
- **Compute Nodes** — Distributed processing (Whisper, Stable Diffusion, etc.)
- **Storage** — DigitalOcean Spaces for file handling
- **Database** — SQLite for persistence

---

## 🛠️ Operational Tools

### IC Mesh Network Tools

#### `scripts/node-diagnostics.js`
**Comprehensive node health checking**
```bash
node scripts/node-diagnostics.js                  # Quick check
node scripts/node-diagnostics.js --full          # Complete scan
node scripts/node-diagnostics.js --capabilities  # Capability detection only
node scripts/node-diagnostics.js --earnings      # Show earnings summary
```

**What it checks:**
- System resources (CPU, memory, disk)
- Node configuration and registration
- Capability detection (Whisper, ffmpeg, Ollama, GPU)
- Network connectivity to mesh server
- Earnings and job completion stats
- Exit codes for automation

#### `scripts/health-check.js`
**System component validation**
```bash
node scripts/health-check.js
```

**Validates:**
- Database integrity and performance
- API endpoint functionality
- File system permissions
- WebSocket connectivity
- Service dependencies

#### `scripts/status.js`
**Real-time network monitoring**
```bash
node scripts/status.js
```

**Shows:**
- Active nodes and capabilities
- Job queue status
- Network statistics
- Performance metrics

#### `scripts/performance-monitor.js`
**Continuous performance monitoring**
```bash
node scripts/performance-monitor.js              # Start monitoring
node scripts/performance-monitor.js test         # One-time collection
node scripts/performance-monitor.js --output=metrics.jsonl  # Custom output
```

**Monitors:**
- System resource usage
- Database performance
- API response times
- WebSocket connections

#### `scripts/deploy.js`
**Automated deployment**
```bash
node scripts/deploy.js                           # Deploy with checks
node scripts/deploy.js --skip-tests             # Fast deployment
node scripts/deploy.js --rollback               # Rollback to backup
```

**Features:**
- Pre-deployment validation
- Automated backups
- Health verification
- Rollback capability

### Website Tools

#### `scripts/site-maintenance.js`
**Comprehensive website maintenance**
```bash
node scripts/site-maintenance.js                 # Health check
node scripts/site-maintenance.js --cleanup       # Clean temp files
node scripts/site-maintenance.js --optimize      # Database optimization
node scripts/site-maintenance.js --security      # Security audit
node scripts/site-maintenance.js --full          # Complete maintenance
```

**Maintains:**
- File system cleanup (temp files, logs)
- Database optimization (SQLite VACUUM)
- Security audits (suspicious files)
- Performance analysis
- Disk space monitoring

---

## 📊 Monitoring & Alerting

### Key Metrics to Monitor

#### Network Health
- Active nodes: Should be >2 for redundancy
- Job completion rate: >95% indicates healthy network
- Average job duration: Baseline varies by job type
- WebSocket connections: Monitor for stability

#### System Performance
- Memory usage: Alert if >80% sustained
- CPU load: Alert if >2x core count for >10 minutes
- Disk space: Alert if <1GB free
- Response times: Alert if API >5s, WS >1s

#### Financial Metrics
- Revenue flow: Track daily earnings
- Node operator payouts: Monitor balances
- Infrastructure costs: Track against earnings
- Credit purchase volume

### Log Files to Monitor
```bash
# IC Mesh logs
tail -f data/mesh.log                    # Application logs
tail -f data/performance-metrics.jsonl   # Performance data

# Website logs  
tail -f logs/access.log                  # HTTP access
tail -f logs/error.log                   # Application errors
```

### Automated Health Checks
```bash
# Set up cron jobs for automated monitoring
# Add to crontab -e:

# Every 15 minutes - basic health check
*/15 * * * * cd /path/to/ic-mesh && npm run health-check >> logs/health.log 2>&1

# Every hour - node diagnostics
0 * * * * cd /path/to/ic-mesh && npm run diagnostics >> logs/diagnostics.log 2>&1

# Daily at 3 AM - full maintenance
0 3 * * * cd /path/to/intelligence-club-site && npm run maintenance:full >> logs/maintenance.log 2>&1

# Daily at 4 AM - database optimization
0 4 * * * cd /path/to/ic-mesh && npm run optimize-code >> logs/optimization.log 2>&1
```

---

## 🚨 Troubleshooting Guide

### Common Issues & Solutions

#### Network Issues

**"No nodes available"**
```bash
# Check node connectivity
npm run status
npm run diagnostics

# Restart nodes if needed
# (SSH to each node and restart client.js)
```

**"Jobs failing frequently"**
```bash
# Check job error patterns
sqlite3 data/mesh.db "SELECT type, error, COUNT(*) FROM jobs WHERE status='failed' GROUP BY type, error;"

# Check node capacity
npm run diagnostics --full
```

#### Website Issues

**"Upload failing"**
```bash
# Check file permissions
ls -la uploads/
chmod 755 uploads/

# Check disk space
df -h
npm run maintenance:cleanup
```

**"Payment processing errors"**
```bash
# Check Stripe webhook logs
tail -f logs/stripe-webhook.log

# Verify environment variables
npm run setup
```

### Emergency Procedures

#### Network Down
1. Check hub server: `npm run health-check`
2. Restart service: `pm2 restart ic-mesh`
3. Verify database: `sqlite3 data/mesh.db ".schema"`
4. Check network connectivity: `ping moilol.com`

#### Data Recovery
```bash
# Restore database backup
cp data/mesh.db.backup.YYYYMMDD data/mesh.db

# Verify restoration
npm run health-check
```

#### Security Incident
1. Run security audit: `npm run maintenance:security`
2. Check suspicious files: Review audit output
3. Update access logs: `tail -f logs/access.log`
4. Rotate credentials if needed

---

## 📈 Performance Optimization

### Database Optimization
```bash
# Regular maintenance
npm run maintenance:optimize

# Manual database cleanup
sqlite3 data/mesh.db "DELETE FROM jobs WHERE created_at < date('now', '-30 days');"
sqlite3 data/mesh.db "VACUUM;"
```

### File System Optimization
```bash
# Clean old files
npm run maintenance:cleanup

# Compress large files
find uploads/ -name "*.wav" -size +10M -exec ffmpeg -i {} -c:a libmp3lame {}.mp3 \;
```

### Network Performance
```bash
# Monitor real-time performance
npm run performance-monitor

# Check node distribution
npm run status | grep "capabilities"
```

---

## 🔐 Security Best Practices

### Regular Security Tasks
1. **Weekly:** Run security audit (`npm run maintenance:security`)
2. **Monthly:** Review access logs for anomalies
3. **Quarterly:** Update dependencies and security patches
4. **Annually:** Rotate API keys and certificates

### File Upload Security
- All uploads scanned for suspicious patterns
- File type validation enforced
- Size limits enforced
- Auto-cleanup of temp files after 24 hours

### API Security
- Rate limiting enabled
- API key validation required
- Input sanitization on all endpoints
- Error handling prevents information disclosure

---

## 📚 Reference

### Configuration Files
- `node-config.json` — Node registration data
- `.env` — Environment variables
- `package.json` — Dependencies and scripts
- `data/mesh.db` — Main database

### Important URLs
- Network status: `https://moilol.com/mesh`
- Admin dashboard: `https://moilol.com/dashboard`
- Health endpoint: `https://moilol.com:8333/health`
- WebSocket: `wss://moilol.com:8333/ws`

### Support Resources
- GitHub Issues: [IC Mesh](https://github.com/intelligence-club/ic-mesh/issues)
- Email: hello@moilol.com
- Documentation: This guide + README files

---

**Last updated:** 2026-02-25  
**Maintained by:** Wingman 🤝  

*This guide evolves with the system. Update it when procedures change.*