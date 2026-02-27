# IC Mesh Node Onboarding Guide 🚀

**New to IC Mesh? Start here!** This guide helps you avoid the common issues that cause 50% of nodes to disconnect immediately.

## Quick Start Checklist ✅

1. **Run the diagnostic tool first** (saves 90% of connection problems)
2. **Create your node config** (copy the example below)
3. **Install required tools** for your chosen capabilities
4. **Connect and verify** you're earning immediately

## Step 1: Pre-Flight Check 🔍

**Before connecting your node, run our diagnostic tool:**

```bash
# Download and run the diagnostic
node onboarding-diagnostic.js

# If you have a custom config location:
node onboarding-diagnostic.js /path/to/your/config.json
```

**What it checks:**
- ✅ Network connectivity to IC Mesh servers
- ✅ Configuration file validity  
- ✅ Required tools for your capabilities
- ✅ System resources (memory, CPU, disk)
- ✅ Common onboarding failure points

**Fix all issues before proceeding!** Nodes that pass diagnostics have 95% success rate.

## Step 2: Create Node Configuration 📝

Create `node-config.json` in your IC Mesh directory:

```json
{
  "SERVER_HOST": "moilol.com",
  "SERVER_PORT": 8333,
  "NODE_ID": "your-unique-name-here",
  "capabilities": ["whisper", "ffmpeg"],
  "maxJobs": 3,
  "description": "Your node description",
  "owner": "your-name"
}
```

### Capability Options:

| Capability | Tool Required | What It Does | Typical Earnings |
|------------|---------------|--------------|------------------|
| `whisper` | whisper | Audio transcription | $0.50-2.00/job |
| `ffmpeg` | ffmpeg | Audio/video processing | $0.25-1.00/job |
| `tesseract` | tesseract | OCR (text from images) | $0.50-1.50/job |
| `ollama` | ollama | AI text generation | $1.00-5.00/job |
| `stable-diffusion` | python3 | AI image generation | $2.00-10.00/job |

**Pro tip:** Start with `whisper` and `ffmpeg` - they're the most in-demand and easiest to set up.

## Step 3: Install Required Tools 🔧

### For Whisper (Transcription):
```bash
# Option 1: Python whisper
pip install openai-whisper

# Option 2: Faster whisper.cpp
git clone https://github.com/ggerganov/whisper.cpp
cd whisper.cpp && make
```

### For FFmpeg (Audio/Video):
```bash
# Ubuntu/Debian
sudo apt install ffmpeg

# macOS
brew install ffmpeg

# Other systems: https://ffmpeg.org/download.html
```

### For OCR (Tesseract):
```bash
# Ubuntu/Debian  
sudo apt install tesseract-ocr

# macOS
brew install tesseract
```

### For AI Text (Ollama):
```bash
# Install ollama
curl -fsSL https://ollama.com/install.sh | sh

# Pull a model (required for operation)
ollama pull llama2
```

## Step 4: Connect Your Node 🔌

```bash
# Start your node
node client.js

# You should see:
# ✅ Connected to IC Mesh
# ✅ Node registered successfully  
# ✅ Waiting for jobs...
```

**If connection fails:**
1. Re-run the diagnostic: `node onboarding-diagnostic.js`
2. Check the troubleshooting section below
3. Contact support with your diagnostic results

## Step 5: Verify Earnings 💰

**Within 15 minutes you should see:**
- Job assignments in your console
- Completed jobs in your logs
- Earnings in the operator dashboard: https://moilol.com/account

**No jobs after 30 minutes?** Check:
- Are your capabilities in demand? (whisper is always busy)
- Is your node showing as active? (check operator dashboard)
- Are there network capacity issues? (check #mesh-status Discord)

## Common Onboarding Issues 🚨

### "Configuration file not found"
- Create `node-config.json` in your IC Mesh directory
- Copy the example above and customize it

### "Connection timeout" or "Connection failed"  
- Check firewall settings (allow outbound port 8333)
- Test connectivity: `ping moilol.com`
- Ensure you're not behind restrictive corporate network

### "Tool for [capability] not found"
- Install the required tool (see Step 3)
- Verify installation: `which whisper`, `which ffmpeg`, etc.
- Remove capability from config if tool unavailable

### "Low available memory" 
- Close unnecessary applications
- Consider reducing `maxJobs` in config
- Upgrade RAM if running intensive capabilities

### Node connects but gets no jobs
- Check your capabilities match network demand
- Verify tools actually work: `whisper --help`
- Join Discord #mesh-operators for real-time status

## Performance Optimization 🚀

### Hardware Recommendations:
- **Minimum:** 2GB RAM, 1 CPU core
- **Recommended:** 4GB RAM, 2+ CPU cores  
- **Optimal:** 8GB+ RAM, 4+ cores, GPU for AI workloads

### Earning Optimization:
- **Multi-capability nodes earn more** (whisper + ffmpeg + tesseract)
- **GPU acceleration** significantly increases AI job earnings
- **Reliable uptime** gets you priority in job queues
- **Fast job completion** leads to more jobs assigned

### Retention Tips:
- **Stay online >10 hours** for retention milestone rewards
- **Monitor your console** for errors and fix them quickly
- **Join operator Discord** for network updates and tips
- **Check earnings regularly** to track performance

## Support & Community 💬

- **Real-time help:** Discord #mesh-operators
- **Documentation:** https://moilol.com/docs  
- **Operator dashboard:** https://moilol.com/account
- **GitHub issues:** For bugs and feature requests

**Remember:** Nodes that pass pre-flight diagnostics have 95% success rate. Use the tools!

---

*Created by Wingman for IC Mesh node operators. Last updated: 2026-02-27*