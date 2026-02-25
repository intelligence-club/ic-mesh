# IC Mesh Operator Troubleshooting Guide
**Created by Wingman 🤝 | Updated: 2026-02-25**

## Quick Diagnostics

### Check Your Node Status
```bash
# See your node in the network
curl -s https://moilol.com:8333/nodes | jq '.[] | select(.id=="YOUR_NODE_ID")'

# Check your local node health
./ic-mesh-client.js --health
```

### Common Failure Patterns

## 🚨 "Handler X failed: Exit 1" Errors

### Transcribe Handler Failing
**Symptoms**: Jobs fail with "Handler transcribe failed: Exit 1"

**Diagnosis**:
```bash
# Check if Whisper is installed
python3 -c "import whisper; print('Whisper OK')"

# Test whisper directly
whisper --help

# Check Python environment
which python3
python3 --version
```

**Solutions**:
```bash
# Install Whisper
pip3 install openai-whisper

# On macOS
brew install ffmpeg

# On Ubuntu/Debian
sudo apt install ffmpeg python3-pip
pip3 install openai-whisper

# On Arch Linux
sudo pacman -S ffmpeg python-pip
pip install openai-whisper
```

### OCR Handler Failing
**Symptoms**: Jobs fail with "Handler ocr failed: Exit 1"

**Solutions**:
```bash
# Install Tesseract
# macOS
brew install tesseract

# Ubuntu/Debian
sudo apt install tesseract-ocr

# Arch Linux
sudo pacman -S tesseract

# Test tesseract
tesseract --version
```

### PDF-Extract Handler Failing
**Symptoms**: Jobs fail with "Handler pdf-extract failed: Exit 1"

**Solutions**:
```bash
# Usually same as OCR - needs tesseract
# Also may need additional packages

# Ubuntu/Debian
sudo apt install tesseract-ocr poppler-utils

# macOS
brew install tesseract poppler

# Test with sample PDF
echo "Testing..." > test.txt
ps2pdf test.txt test.pdf
tesseract test.pdf output
```

## 🌐 Connection Issues

### Node Can't Connect to Server
**Symptoms**: "Connection refused" or timeout errors

**Diagnosis**:
```bash
# Test connectivity
curl -v https://moilol.com:8333/health

# Check local firewall
sudo ufw status  # Ubuntu
sudo iptables -L  # Generic Linux

# Check if running behind proxy/VPN
curl -s https://ipinfo.io/json
```

**Solutions**:
1. Check internet connection
2. Verify ports 8333 (mesh API) and 443 (main site) are accessible
3. Disable VPN if causing issues
4. Check corporate firewall settings

### Node Goes Offline Frequently
**Common causes**:
1. **Power management**: Laptop going to sleep
2. **Network instability**: Wi-Fi dropping
3. **Process killed**: Out of memory or manual termination

**Solutions**:
```bash
# Run as service (systemd example)
sudo tee /etc/systemd/system/ic-mesh.service << EOF
[Unit]
Description=IC Mesh Node
After=network.target

[Service]
Type=simple
User=your-username
WorkingDirectory=/path/to/ic-mesh
ExecStart=/usr/bin/node client.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable ic-mesh
sudo systemctl start ic-mesh
```

## 📊 Performance Issues

### Low Success Rate
**If your node has <80% success rate**:

1. **Check dependencies** for all capabilities you advertise
2. **Monitor resource usage** (CPU, RAM, disk space)
3. **Check logs** for specific error patterns
4. **Reduce capabilities** if system is overloaded

### Jobs Taking Too Long
**If jobs timeout or take >60 seconds**:

1. **Check system resources**:
   ```bash
   top
   df -h
   free -h
   ```

2. **Profile specific handlers**:
   ```bash
   # Time a transcribe operation
   time whisper sample-audio.mp3
   ```

3. **Consider hardware limits**:
   - CPU transcription: ~1-5x real-time
   - GPU transcription: ~10-50x real-time
   - Large files may need more time

## 🔧 Node Configuration

### Optimizing Capabilities
**Only advertise capabilities you can actually perform**:

```json
{
  "capabilities": [
    "whisper",        // Only if whisper installed
    "transcription",  // Only if whisper + ffmpeg installed
    "ffmpeg",         // Only if ffmpeg installed
    "tesseract",      // Only if tesseract installed
    "ocr"             // Only if tesseract installed
  ]
}
```

### Hardware-Specific Settings
```json
{
  "hardware": "highEnd",    // or "lowEnd"
  "maxConcurrentJobs": 2,   // Adjust based on your system
  "timeoutMs": 300000       // 5 minutes for complex jobs
}
```

## 🏥 Health Monitoring

### Check Your Performance
```bash
# Get your node stats
curl -s "https://moilol.com:8333/nodes/YOUR_NODE_ID/stats"

# Monitor job completion
tail -f ~/.ic-mesh/logs/jobs.log
```

### Warning Signs
- Success rate dropping below 80%
- Jobs taking >2x expected time
- Frequent disconnections (>1 per hour)
- Memory usage consistently >90%

## 💰 Earnings Issues

### No Jobs Arriving
**Possible causes**:
1. **Network has excess capacity** for your capabilities
2. **Your node is quarantined** due to poor performance  
3. **Capability mismatch** with current demand
4. **Node offline** when jobs were available

**Solutions**:
1. Check quarantine status: `curl https://moilol.com:8333/nodes/YOUR_ID`
2. Expand capabilities to meet demand
3. Improve reliability/uptime
4. Join during peak usage hours

### Payment Delays
- **Payments process daily** around 06:00 UTC
- **Minimum payout**: $1.00 equivalent
- **Stripe Connect setup** required for cashouts

## 📞 Getting Help

### Self-Service Tools
1. **Node diagnostics**: Run `./diagnose-node.sh`
2. **Performance analysis**: Check the operator dashboard
3. **Community forum**: Check #ic-mesh channel

### Contact Support
- **Technical issues**: Create ticket at moilol.com/support
- **Payment issues**: Email billing@intelligence.club  
- **Urgent problems**: Tag @primary in Discord

### Useful Logs
```bash
# Node client logs
tail -f ~/.ic-mesh/logs/client.log

# System logs (Linux)
journalctl -u ic-mesh -f

# Job handler logs
ls ~/.ic-mesh/logs/handlers/
```

---

## Quick Reference

### Essential Commands
```bash
# Start node
node client.js

# Check status
curl https://moilol.com:8333/nodes/YOUR_ID

# Test capabilities
./test-handlers.sh

# View earnings
curl https://moilol.com/api/nodes/YOUR_ID/earnings
```

### Key Files
- `node-config.json` - Your node configuration
- `~/.ic-mesh/logs/` - Log files
- `handlers/` - Job handler scripts

### Performance Targets
- **Success rate**: >90% ideal, >80% minimum
- **Response time**: <30s for most jobs  
- **Uptime**: >95% for reliable earnings
- **Queue time**: <60s from job claim to start

---
*Remember: Reliable nodes earn more. Fix issues quickly to maximize earnings.*