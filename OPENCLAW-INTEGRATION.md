# OpenClaw Integration Guide 🤝

*Turn your OpenClaw into an AI compute node and earn money*

## Quick Start for OpenClaw Operators

### What This Is
IC Mesh is a decentralized AI compute marketplace. Your OpenClaw can join as a "node" to:
- **Earn money** processing AI tasks (transcription, image generation, LLM inference)
- **Contribute compute** when your system has spare capacity
- **Get paid automatically** via Stripe Connect

### Prerequisites
- OpenClaw running with spare CPU/GPU capacity
- Node.js 22+ installed
- Docker (optional but recommended)

### 1-Minute Setup

```bash
# Clone the node client
git clone https://github.com/your-org/ic-mesh
cd ic-mesh

# Install dependencies
npm install

# Configure your node
cp node-config.example.json node-config.json
```

Edit `node-config.json`:
```json
{
  "nodeId": "your-openclaw-name",
  "serverUrl": "https://moilol.com:8333",
  "capabilities": [
    "transcribe",     // If you have Whisper/ffmpeg
    "ollama",         // If you run local LLMs
    "stable-diffusion"// If you have GPU for images
  ],
  "resources": {
    "cpu": 4,         // CPU cores to dedicate
    "memory": "8GB"   // RAM to dedicate
  },
  "availability": {
    "schedule": "9-17", // When to accept jobs (24/7 for always)
    "maxJobs": 3        // Concurrent job limit
  }
}
```

### Start Earning
```bash
# Start your node
node client.js

# You'll see:
# ✅ Connected to IC Mesh
# 🎯 Capabilities: transcribe, ollama
# 💰 Ready to earn!
```

### Capabilities You Can Offer

**🎙️ Transcription (`transcribe`)**
- Requirements: `whisper` command available
- Pays: $0.10-0.50 per audio file
- Perfect for: Always-on OpenClaw instances

**🧠 LLM Inference (`ollama`)**
- Requirements: Ollama running locally
- Pays: $0.05-0.20 per inference
- Perfect for: GPU-equipped OpenClaws

**🎨 Image Generation (`stable-diffusion`)**
- Requirements: Stable Diffusion model + GPU
- Pays: $0.20-1.00 per image
- Perfect for: High-end gaming/workstation OpenClaws

**⚡ GPU Acceleration (`gpu-*`)**
- Requirements: CUDA/Metal GPU
- Pays: 2-10x premium for GPU tasks
- Perfect for: Mining rigs, gaming PCs

### Payment & Cashout

1. **Automatic tracking**: Jobs completed = credits earned
2. **Stripe Connect**: Link your bank account for instant payouts
3. **Weekly cashouts**: Minimum $5 threshold
4. **Transaction history**: Full audit trail in the dashboard

### Monitoring Your Node

**Web Dashboard**: https://moilol.com:8333
- Real-time earnings
- Job completion history
- Performance metrics
- Network statistics

**CLI Status**:
```bash
# Check your node status
node scripts/node-status.js

# View earnings
node scripts/earnings-report.js
```

### Advanced Configuration

**Resource Limits**:
```json
{
  "resources": {
    "cpu": 6,           // CPU cores
    "memory": "16GB",   // RAM limit
    "disk": "50GB",     // Temp storage
    "bandwidth": "1Gbps"// Network limit
  },
  "limits": {
    "maxJobDuration": "30m",  // Kill long jobs
    "maxFileSize": "500MB",   // Reject huge files
    "rateLimitPerHour": 100   // Jobs per hour cap
  }
}
```

**Custom Scheduling**:
```json
{
  "availability": {
    "schedule": {
      "weekdays": "9-17",     // Business hours only
      "weekends": "off",      // Weekends off
      "timezone": "UTC-8"     // Your timezone
    },
    "priority": "low",        // Only take jobs when idle
    "maxConcurrent": 1        // One job at a time
  }
}
```

**Docker Mode** (Recommended):
```bash
# Use Docker for better isolation
docker build -t ic-mesh-node .
docker run -d --name my-openclaw-node \
  -v ./node-config.json:/app/node-config.json \
  -v ./data:/app/data \
  ic-mesh-node
```

### Security & Privacy

- **Job isolation**: Each task runs in sandboxed environment
- **No data retention**: Files deleted after completion
- **API key protection**: Your credentials never leave your machine
- **Reputation system**: Bad actors get banned automatically

### Troubleshooting

**Node won't connect?**
```bash
# Check server reachability
curl https://moilol.com:8333/health

# Check your config
node scripts/validate-config.js
```

**No jobs coming in?**
- Check your capabilities match network demand
- Verify your node appears in the network dashboard
- Consider adding more capabilities for higher job flow

**Jobs failing?**
```bash
# Check logs
tail -f logs/node.log

# Test capabilities
node scripts/test-capabilities.js
```

### Economics

**Typical earnings** (based on 24/7 operation):

| Setup | Daily Earnings | Monthly |
|-------|---------------|---------|
| Basic CPU (transcription only) | $2-8 | $60-240 |
| CPU + Ollama | $5-15 | $150-450 |
| GPU + All capabilities | $10-50 | $300-1500 |

**Payment timing**:
- Jobs credited instantly upon completion
- Cashouts processed within 24 hours
- Bank transfers: 1-3 business days

### Community & Support

- **Discord**: [IC Mesh Operators](https://discord.gg/ic-mesh)
- **GitHub Issues**: Report bugs and feature requests
- **Email Support**: support@moilol.com
- **Status Page**: https://status.moilol.com

### Getting More Jobs

1. **Add capabilities**: More skills = more job types
2. **Increase availability**: 24/7 nodes get priority
3. **Boost resources**: Higher limits = larger jobs
4. **Build reputation**: Reliable nodes get repeat customers
5. **GPU acceleration**: GPU jobs pay 5-10x more

---

Ready to turn your OpenClaw into a money-making machine? 

**Join the network**: `git clone https://github.com/your-org/ic-mesh && cd ic-mesh && npm install`

*Questions? Drop into our Discord or email support@moilol.com*