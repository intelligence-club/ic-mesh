# IC Mesh Quick Reference Card 📋

*Essential commands and information for IC Mesh operators*

## 🚀 Quick Start

```bash
# Setup (one time)
git clone https://github.com/your-org/ic-mesh
cd ic-mesh
npm install
./scripts/openclaw-quickstart.sh

# Start earning
node client.js
```

## 💰 Essential Commands

| Command | Purpose |
|---------|---------|
| `node client.js` | Start your earning node |
| `node scripts/openclaw-earnings.js` | Check income/stats |
| `node scripts/system-dashboard.js` | System health overview |
| `node scripts/openclaw-setup-test.js` | Test your configuration |

## 📊 Monitoring

### Quick Status Check
```bash
# One-command health check
node scripts/system-dashboard.js

# Detailed earnings
node scripts/openclaw-earnings.js

# Watch live activity  
node scripts/system-dashboard.js --watch
```

### Web Dashboards
- **Personal**: https://moilol.com/account
- **Network**: https://moilol.com:8333
- **Status**: https://status.moilol.com

## ⚙️ Configuration

### Basic Config (`node-config.json`)
```json
{
  "nodeId": "your-unique-name",
  "serverUrl": "https://moilol.com:8333",
  "capabilities": ["transcribe", "ollama"],
  "resources": {
    "cpu": 4,
    "memory": "8GB"
  },
  "availability": {
    "schedule": "24/7",
    "maxJobs": 2
  }
}
```

### Capability Setup

| Capability | Installation | Pay Rate |
|------------|-------------|----------|
| **transcribe** | `pip install openai-whisper` | $0.10-0.50/job |
| **ollama** | `curl -fsSL https://ollama.ai/install.sh \| sh` | $0.05-0.20/task |
| **stable-diffusion** | GPU + SD setup | $0.50-2.00/image |

## 🔧 Troubleshooting

### Common Issues

| Problem | Quick Fix |
|---------|-----------|
| No jobs coming | Add capabilities, check `node scripts/openclaw-setup-test.js` |
| Jobs failing | Check logs: `tail -f logs/node.log` |
| Low earnings | Add GPU capability or increase uptime |
| Connection issues | Test: `curl https://moilol.com:8333/health` |

### Debug Commands
```bash
# Test everything
node scripts/openclaw-setup-test.js

# Check logs
tail -f logs/node.log

# System health
node scripts/system-dashboard.js

# Network connection
curl https://moilol.com:8333/health
```

## 💳 Payment Info

- **Minimum cashout**: $5.00
- **Payment method**: Stripe Connect (bank account)  
- **Processing time**: 1-3 business days
- **Fees**: None (IC Mesh covers Stripe fees)
- **Tax docs**: 1099 for US earnings over $600/year

### Setup Cashouts
1. Visit https://moilol.com/account
2. Click "Link Bank Account"
3. Complete Stripe Connect verification
4. Enable auto-weekly cashouts

## 📈 Optimization Tips

### Maximize Earnings
1. **Add GPU** capability (10x earning potential)
2. **Run 24/7** (more uptime = more jobs)
3. **Multiple capabilities** (transcribe + ollama + gpu)
4. **Good internet** (faster uploads = quicker job completion)
5. **Multiple machines** (scale horizontally)

### Peak Hours (US timezone)
- **9 AM - 5 PM EST**: Business transcription
- **7 PM - 11 PM EST**: Content creators
- **Weekends**: Podcast surge

## 🛠️ Maintenance

### Automated Maintenance
```bash
# Setup automatic maintenance
./scripts/setup-maintenance-cron.sh

# Manual maintenance
node scripts/automated-maintenance.js

# Check maintenance status
./scripts/check-maintenance-status.sh
```

### Log Management
```bash
# View recent activity
tail -f logs/node.log

# Check log sizes
du -h logs/

# Rotate logs manually
node scripts/automated-maintenance.js --logs-only
```

## 🆘 Getting Help

### Self-Service
1. Read logs: `tail -f logs/node.log`
2. Run diagnostics: `node scripts/openclaw-setup-test.js`
3. Check status: `node scripts/system-dashboard.js`
4. Review docs: Browse `docs/` folder

### Community Support
- 💬 **Discord**: https://discord.gg/ic-mesh
- 📧 **Email**: support@moilol.com
- 🐛 **Issues**: https://github.com/your-org/ic-mesh/issues
- 📚 **Docs**: `docs/BEGINNER-TUTORIAL.md`

## 🔍 Performance Benchmarks

### Typical Daily Earnings

| Setup Type | Hardware | Daily Earnings |
|------------|----------|----------------|
| **Basic** | Laptop, transcribe only | $2-6 |
| **Standard** | Desktop, CPU + transcribe + ollama | $5-15 |
| **Advanced** | Desktop + GPU, all capabilities | $15-50 |
| **Pro** | Dedicated server + GPU | $30-100+ |

### Success Metrics
- **Success rate**: >95%
- **Response time**: <30s for small jobs
- **Uptime**: >90%
- **Jobs/day**: Varies by capability

## 📋 Cheat Sheet

### Daily Routine
```bash
# Morning check
node scripts/openclaw-earnings.js

# Optional: System health
node scripts/system-dashboard.js

# Evening: Review logs if issues
tail logs/node.log | grep ERROR
```

### Weekly Tasks
1. Check earnings dashboard
2. Review system performance
3. Consider optimization opportunities
4. Cash out if over $5

### Monthly Optimization
1. Analyze earning trends
2. Compare with network averages
3. Upgrade hardware if profitable
4. Add new capabilities

## 🎯 Quick Performance Check

```bash
# One-command system check
echo "=== IC Mesh Quick Status ===" && \
echo "Earnings:" && node scripts/openclaw-earnings.js | head -5 && \
echo -e "\nSystem:" && node scripts/system-dashboard.js --no-clear | grep -A 5 "SYSTEM STATUS" && \
echo -e "\nJobs:" && node scripts/system-dashboard.js --no-clear | grep -A 5 "JOB STATISTICS"
```

---

**💡 Tip**: Bookmark this page and check it whenever you need quick answers!

*For detailed explanations, see `docs/BEGINNER-TUTORIAL.md`*