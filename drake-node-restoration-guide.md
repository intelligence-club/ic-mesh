# 🚨 DRAKE NODE RESTORATION EMERGENCY GUIDE

**CRITICAL SERVICE OUTAGE - ALL NODES OFFLINE**

Drake, your immediate action is needed to restore the IC Mesh network. **190 customer jobs** are blocked with **$400-800+ in revenue** at stake.

## 🔥 IMMEDIATE ACTIONS (Next 30 minutes)

### 1. RESTORE MINICLAW (Highest Priority)
**Impact:** Will process 132 transcription jobs immediately

```bash
# Check if miniclaw process is running
ps aux | grep mesh

# If not running, restart transcription capability
claw skill mesh-transcribe

# Verify it's connecting
tail -f /path/to/miniclaw/logs
```

**Expected Result:** miniclaw should reconnect to mesh network and start claiming transcribe jobs

### 2. CHECK FRIGG NODES (Critical for OCR)
**Impact:** Will process 58 OCR/PDF jobs (only nodes with tesseract)

```bash
# Check both frigg instances
ssh frigg-node-1  # or however you access them
ssh frigg-node-2

# On each frigg node, check mesh client status
ps aux | grep mesh
systemctl status ic-mesh-client  # if using systemd

# Restart if needed
node /path/to/ic-mesh/client.js
# or
systemctl start ic-mesh-client
```

## 🔍 DIAGNOSTIC COMMANDS

### Check Network Connectivity
```bash
# Test connection to mesh server
curl https://moilol.com:8333/health
# Should return: {"status":"healthy"}

# Test WebSocket connection (from node)
node -e "const WebSocket = require('ws'); const ws = new WebSocket('wss://moilol.com:8333'); ws.on('open', () => console.log('Connected')); ws.on('error', console.error);"
```

### Check Node Capabilities
```bash
# Verify transcription tools are available
which whisper
python3 -c "import whisper; print('Whisper available')"

# Verify OCR tools are available (frigg nodes only)
which tesseract
tesseract --version
```

### Check Disk Space & Resources
```bash
df -h  # Check disk space (client needs space for downloads)
free -h  # Check RAM
```

## 📊 CURRENT CRISIS STATUS

**As of 2026-02-27 08:30 UTC:**
- **Active Nodes:** 0/5 (COMPLETE OUTAGE)
- **Pending Jobs:** 190 (vs normal ~0-5)
- **Offline Duration:**
  - miniclaw: 13 hours (was working perfectly)
  - frigg nodes: 8 days (long-term issue)
  - unnamed: 5 minutes (just went offline)

## ⚠️ TROUBLESHOOTING COMMON ISSUES

### Issue: "Connection refused to mesh server"
```bash
# Check if server is responding
curl -I https://moilol.com:8333
# If not responding, the mesh server may be down (contact via Discord)
```

### Issue: "Authentication failed"
```bash
# Check if node-config.json exists and has valid keys
cat node-config.json | jq .
# Regenerate API key if needed at: https://moilol.com/account
```

### Issue: "Handler not found"
```bash
# Check if required binaries are in PATH
which whisper  # For transcription
which tesseract  # For OCR
which ffmpeg  # For media processing

# Reinstall missing dependencies
pip install openai-whisper  # For transcription
brew install tesseract  # For OCR (macOS)
sudo apt install tesseract-ocr  # For OCR (Linux)
```

### Issue: Node connects but doesn't claim jobs
```bash
# Check node capabilities match job requirements
# Transcribe jobs need: "transcription" or "whisper" capability
# OCR jobs need: "tesseract" capability
# PDF-extract jobs need: "tesseract" capability

# Check if node is quarantined (due to previous failures)
# Contact support to remove quarantine if needed
```

## 📞 ESCALATION PATH

If nodes won't reconnect after trying above steps:

1. **Discord:** Post in #ic-mesh channel with error messages
2. **Direct Contact:** Message primary directly with:
   - Error logs from node startup
   - Output of diagnostic commands
   - Any error messages from mesh client

## 💰 BUSINESS IMPACT

**Every hour of delay costs:**
- Lost customer confidence
- Potential refund requests
- Reputation damage in OpenClaw community

**Expected recovery:**
- miniclaw restoration: ~132 jobs processed in 1-2 hours
- frigg restoration: ~58 jobs processed in 1-2 hours
- **Total:** $400-800+ revenue recovered

## 🎯 SUCCESS METRICS

**You'll know restoration is working when:**
```bash
# Check pending job count (should decrease)
curl -s https://moilol.com:8333/stats | jq '.pendingJobs'

# Check active nodes (should increase)  
curl -s https://moilol.com:8333/stats | jq '.activeNodes'

# Watch jobs being processed in real-time
curl -s https://moilol.com:8333/recent-jobs
```

---

**This guide created by Wingman 🤝 during service outage crisis at 08:30 UTC**  
**190 jobs awaiting your nodes. The network needs you! 🚀**