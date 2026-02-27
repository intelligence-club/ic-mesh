# 🚨 IC Mesh Service Outage Response Playbook

**CRITICAL REFERENCE** for complete service outages (0 active nodes)

## 🔍 Immediate Assessment (2 minutes)

### 1. Confirm Outage Severity
```bash
# Quick status check
cd ic-mesh
./scripts/outage-recovery-detector.sh --status

# Expected result during outage:
# "🚨 Service outage confirmed - 0 active nodes"
```

### 2. Check Infrastructure Health
```bash
# Verify IC Mesh server is running
curl -f http://localhost:8333/api/health

# If server is down, check process:
ps aux | grep server.js
netstat -tlnp | grep :8333
```

### 3. Assess Outage Duration
Check STATUS.md for:
- When outage started
- How long nodes have been offline
- Previous recovery attempts

## 🔧 Infrastructure Recovery (5 minutes)

### 1. Restart IC Mesh Server (if needed)
```bash
cd ic-mesh

# Check if server is running
pgrep -f "node server.js" || echo "Server not running"

# Start server if needed
npm start &

# Verify startup
sleep 5
curl -f http://localhost:8333/api/health
```

### 2. Database Integrity Check
```bash
# Backup current database
npm run backup-db

# Basic integrity test
ls -la data/mesh.db

# If available, check with database tools
node scripts/health-check.js 2>/dev/null || echo "Health check tools need npm install"
```

## 🔌 Node Recovery Process (15-30 minutes)

### Priority Order for Node Contact:

#### **PHASE 1: Critical Capacity (Transcription Service)**
**Target:** unnamed node (highest performer, 134+ jobs completed)
- **Status:** Anonymous node - no direct contact method
- **Action:** Monitor for automatic reconnection
- **Monitoring:** `./scripts/outage-recovery-detector.sh --monitor`

**Target:** miniclaw node (Drake's reliable node)
- **Contact:** Drake (Discord: @drakew6543)
- **Action:** Request `claw skill mesh-transcribe` execution
- **Expected result:** Restores transcription capability (~80% of demand)

#### **PHASE 2: Full Service Restoration (OCR/PDF)**
**Target:** frigg nodes (Drake's tesseract-capable nodes)
- **Contact:** Drake (Discord: @drakew6543)  
- **Action:** Request frigg node revival with tesseract capability
- **Expected result:** Restores OCR/PDF processing capability

#### **PHASE 3: Additional Capacity**
**Target:** Other registered nodes (if any)
- **Method:** Check node registry for contact information
- **Priority:** Lower - focus on critical capacity first

### Contact Template for Drake:
```
🚨 IC Mesh Service Outage Alert

Status: Complete service outage - 0 active nodes
Duration: [X hours] since last node disconnect
Impact: All customer processing stopped

Immediate Action Needed:
1. `claw skill mesh-transcribe` (restores transcription service)
2. frigg node revival (restores OCR/PDF capabilities)

Current queue: [X] jobs blocked
Estimated revenue impact: $[X] blocked

Please run commands when convenient - service monitoring active.
```

## 📊 Recovery Monitoring (Ongoing)

### 1. Start Continuous Monitoring
```bash
# Monitor for node reconnections in background
./scripts/outage-recovery-detector.sh --monitor &
MONITOR_PID=$!

# Monitor logs
tail -f outage-recovery-alerts.log
```

### 2. Watch for Recovery Events
Expected alerts when nodes return:
- `🚨 SERVICE RECOVERY: First node online! Service restored from complete outage`
- `📈 CAPACITY INCREASE: Additional nodes online`
- `⚡ Jobs processed: X completed`

### 3. Stop Monitoring When Stable
```bash
# Stop monitoring when service restored
kill $MONITOR_PID
```

## ✅ Post-Recovery Verification (10 minutes)

### 1. Run Full Recovery Checklist
```bash
./scripts/post-outage-recovery-checklist.sh
```

### 2. Expected Results:
- ✅ API connectivity restored
- ✅ Active nodes > 0
- ✅ Job processing operational
- ✅ Database integrity maintained
- ✅ Performance acceptable

### 3. Update STATUS.md
Document:
- Recovery time and method
- Which nodes returned online
- Any issues discovered
- Lessons learned for prevention

## 🛡️ Outage Prevention (Future)

### 1. Monitoring Automation
```bash
# Set up continuous monitoring (cron job suggestion)
# Add to crontab: */5 * * * * /path/to/outage-recovery-detector.sh --check
```

### 2. Node Retention Improvements
- **Investigate churn patterns:** Why do nodes disconnect?
- **Improve node stability:** Better error handling, auto-reconnection
- **Diversify capacity:** Reduce single-points-of-failure
- **Operator communication:** Regular check-ins with reliable operators

### 3. Early Warning Systems
- **Capacity alerts:** Alert when dropping below 2 active nodes
- **Critical node monitoring:** Special tracking for high-volume nodes
- **Automated messaging:** Contact operators when their nodes disconnect

## 🔄 Testing Recovery Procedures

### Monthly Recovery Drill:
1. **Simulated outage:** Temporarily disable nodes in test environment
2. **Practice playbook:** Run through recovery steps
3. **Time measurement:** How fast can we detect and resolve?
4. **Documentation:** Update playbook with lessons learned

### Contact Information Maintenance:
- **Quarterly review:** Verify operator contact methods
- **Response testing:** Ensure operators receive and respond to alerts
- **Backup contacts:** Multiple ways to reach critical node operators

---

## 📋 Quick Reference

### Emergency Contacts
- **Drake (Primary):** Discord @drakew6543
- **OpenClaw Telegram:** [Add when available]

### Key Commands
```bash
# Status check
./scripts/outage-recovery-detector.sh --status

# Start monitoring  
./scripts/outage-recovery-detector.sh --monitor

# Post-recovery verification
./scripts/post-outage-recovery-checklist.sh

# Health check
npm run health

# View logs
tail -f outage-recovery-alerts.log
```

### Success Metrics
- **Detection time:** < 5 minutes from outage start
- **Response time:** < 15 minutes to contact node operators  
- **Recovery time:** < 30 minutes for first node online
- **Full restoration:** < 2 hours for all capabilities

---

**Last Updated:** 2026-02-27 (during complete service outage)
**Next Review:** After outage resolution and lessons learned documentation