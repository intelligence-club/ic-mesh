# Join the IC Mesh Network - Enhanced Onboarding

Turn your OpenClaw machine's idle time into real money. Connect to the Intelligence Club compute mesh and get paid 80% of job revenue in USD via Stripe Connect when your machine processes tasks for other users.

**Perfect for OpenClaw users:** Your agent uses compute during work hours, the mesh monetizes your spare cycles during off hours. Cover your API costs and more.

## 🚀 Easy Setup with Onboarding Wizard

**New!** Use our interactive setup wizard for the smoothest onboarding experience:

```bash
git clone https://github.com/intelligence-club/ic-mesh.git
cd ic-mesh
node scripts/onboarding-wizard.js
```

The wizard will:
- ✅ **Check system requirements** and detect issues early
- ✅ **Optimize your earning potential** by finding all capabilities
- ✅ **Test network connectivity** to ensure reliable operation  
- ✅ **Configure your node** with interactive prompts
- ✅ **Provide troubleshooting** if problems are found
- ✅ **Start your node** automatically when ready

**Result:** Higher success rate, fewer connection issues, maximum earnings from day one.

## Manual Setup (Alternative)

If you prefer manual configuration or need to understand the details:

### Requirements

- **Node.js 18+** — [nodejs.org](https://nodejs.org)
- **Git** — to clone the repo
- **Network access** — outbound HTTPS to the mesh hub

### Money-Making Capabilities (Optional but Recommended)

| Capability | Earning Potential | Installation |
|------------|------------------|--------------|
| **Ollama** | 🌟 Very High | [ollama.com](https://ollama.com) |
| **Whisper** | 🌟 High | `pip install openai-whisper` |
| **FFmpeg** | 🔶 Medium | `brew install ffmpeg` / `apt install ffmpeg` |
| **GPU** | 🚀 Maximum | NVIDIA drivers or Apple Silicon (auto-detected) |

### Quick Start

```bash
# 1. Clone and setup
git clone https://github.com/intelligence-club/ic-mesh.git
cd ic-mesh
npm install

# 2. Configure (choose one method)
export IC_MESH_SERVER="https://moilol.com:8333"
export IC_NODE_NAME="your-node-name"
export IC_NODE_OWNER="your-name"
export IC_NODE_REGION="your-region"

# 3. Start earning
node client.js
```

## 💰 How Earnings Work

### Real Money Flow
1. **Customers pay** real USD for compute jobs (transcription, AI inference, etc.)
2. **Your node processes** jobs matching your capabilities  
3. **You earn 80%** of the job value in "ints" currency (100 ints = $1.00)
4. **Cash out via Stripe** when you reach $25 minimum

### Example Earnings
- **Audio transcription job**: Customer pays $5 → You earn $4.00 (400 ints)
- **LLM inference job**: Customer pays $2 → You earn $1.60 (160 ints)
- **Media processing**: Customer pays $3 → You earn $2.40 (240 ints)

### Maximize Earnings
- **Run 24/7**: More uptime = more job opportunities
- **Add capabilities**: Ollama + Whisper + GPU = highest earnings
- **Stay online**: Reliable nodes get priority job assignments
- **Monitor dashboard**: Track earnings at https://moilol.com/account

## 🔧 OpenClaw Integration

**Your OpenClaw setup is already perfect for the mesh:**

| What you have | How it helps |
|---------------|--------------|
| ✅ Node.js | Required for mesh client |
| ✅ Always-on machine | Perfect for 24/7 earning |
| ✅ Network connectivity | Ready for mesh communication |
| ✅ Likely have Ollama | Major earning capability already installed |

**Perfect coexistence:**
- OpenClaw agent: Works during your active hours
- IC Mesh: Monetizes spare cycles during downtime  
- Both systems: Can share Ollama models and resources
- No conflicts: Independent operation, no interference

## 📊 Monitoring Your Success

### Dashboard Features
- **Live earnings**: Real-time ints balance and USD equivalent
- **Job history**: Complete ledger with per-job earnings
- **Performance stats**: Success rate and reliability score
- **Cashout status**: Stripe Connect setup and payment history

### Access Your Dashboard
- **Earnings**: https://moilol.com/account
- **Network status**: https://moilol.com:8333
- **Node performance**: Check client console output

## 🛠 Troubleshooting

### Common Issues & Solutions

**"Cannot reach mesh server"**
```bash
# Test connectivity
curl -s https://moilol.com:8333/status

# Check configuration
echo $IC_MESH_SERVER
```

**"No capabilities detected"**  
```bash
# Run capability check
node scripts/onboarding-wizard.js

# Verify installations
which ollama whisper ffmpeg
```

**"Node not earning"**
- Check dashboard for available jobs matching your capabilities
- Ensure 24/7 operation for maximum opportunities
- Verify capabilities are correctly detected (run wizard)
- Monitor success rate and improve reliability

**"Authentication or payment issues"**
```bash
# Check Stripe Connect setup
curl -H "Authorization: Bearer YOUR_API_KEY" \
     https://moilol.com/api/account
```

### Get Help Fast
1. **Run the wizard**: `node scripts/onboarding-wizard.js` (diagnoses most issues)
2. **Check logs**: Node console output shows detailed status  
3. **Test connectivity**: `curl https://moilol.com:8333/status`
4. **Community**: [Intelligence Club Discord](https://moilol.com)
5. **Support**: hello@moilol.com

## 🎯 Success Tips from High Earners

### Node Operators Earning $50+/month:
- **"Install Ollama first"** - LLM jobs pay the most
- **"Run it on a dedicated machine"** - Reliability matters
- **"Add GPU acceleration"** - 3x earning multiplier
- **"Set up as a service"** - 24/7 operation is key
- **"Monitor the dashboard daily"** - Track trends and optimize

### Optimization Strategies:
- **Morning setup**: Install capabilities when GPU demand is lower
- **Evening monitoring**: Check dashboard for daily earnings  
- **Weekend upgrades**: Add new capabilities when jobs are queued
- **Monthly review**: Analyze earnings and plan capability upgrades

## 🚀 Production Service Setup

### macOS (Background Service)
```bash
# The onboarding wizard can help set this up
node scripts/onboarding-wizard.js

# Or manually:
launchctl load ~/Library/LaunchAgents/com.ic-mesh.node.plist
```

### Linux (systemd)
```bash
sudo systemctl enable ic-mesh-node
sudo systemctl start ic-mesh-node
```

### Docker (Cross-platform)
```bash
docker run -d --name ic-mesh-node \
  -e IC_MESH_SERVER=https://moilol.com:8333 \
  -e IC_NODE_NAME=my-docker-node \
  ic-mesh:latest
```

---

## 🎉 Ready to Start Earning?

**Recommended path:**
1. **Run the wizard**: `node scripts/onboarding-wizard.js`
2. **Start your node**: Wizard will do this automatically
3. **Check your dashboard**: https://moilol.com/account  
4. **Install more capabilities**: Follow wizard suggestions
5. **Set up 24/7 service**: For maximum earnings

**Questions?** The [Intelligence Club community](https://moilol.com) is here to help, or reach us at hello@moilol.com.

**Your machine. Your spare cycles. Your money.** 💰