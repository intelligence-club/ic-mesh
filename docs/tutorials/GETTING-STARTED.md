# Getting Started with IC Mesh

**Your Gateway to the Decentralized AI Network**

IC Mesh is a peer-to-peer network that lets you **earn money** by sharing your computer's AI capabilities or **save money** by using affordable distributed AI services.

## 🎯 What You Can Do

### As a Customer (Use AI Services)
- **Transcribe audio** for $0.30-0.50 (vs $2-5 elsewhere)
- **Extract text from PDFs** and images
- **Generate images** with Stable Diffusion
- **Run language models** (Ollama, local AI)

### As a Node Operator (Earn Money)
- **Share your GPU** for AI workloads
- **Provide transcription** services (Whisper)
- **Offer image processing** capabilities
- **Run language models** for the network

**Real earnings**: Operators earn $0.15-0.40 per job, with top performers completing 100+ jobs daily.

## 🚀 Quick Start: Use AI Services

### 1. Get API Credits ($5 minimum)

Visit [moilol.com](https://moilol.com) and purchase credits:
- **$5 pack**: 20 credits (40 transcription jobs)
- **$10 pack**: 45 credits (90+ jobs)  
- **$25 pack**: 120 credits (240+ jobs)

### 2. Get Your API Key

After purchase, visit [moilol.com/account](https://moilol.com/account) to:
- View your API key
- Check credit balance
- See job history

### 3. Upload and Transcribe Audio

**Web Interface**: Upload directly at [moilol.com](https://moilol.com)

**API Usage**:
```bash
# Get upload URL
curl -X POST https://moilol.com/api/upload \\
  -H "Authorization: Bearer YOUR_API_KEY"

# Upload your audio file to the returned URL
# The transcription starts automatically

# Check your account page for results
```

**Python Example**:
```python
import requests

# Your API key from moilol.com/account
API_KEY = "your_api_key_here"
headers = {"Authorization": f"Bearer {API_KEY}"}

# Get upload URL
response = requests.post(
    "https://moilol.com/api/upload", 
    headers=headers
)
upload_data = response.json()

# Upload your audio file
with open("audio.mp3", "rb") as f:
    requests.put(upload_data["uploadUrl"], data=f)

print(f"Upload complete! Check results at: {upload_data['resultUrl']}")
```

## 💰 Quick Start: Become a Node Operator

### Prerequisites
- **Computer with internet** (Linux, Mac, or WSL on Windows)
- **OpenClaw installed** ([installation guide](https://docs.openclaw.com))
- **Basic technical skills** (command line comfort)

### 1. Install OpenClaw Skills

```bash
# Install IC Mesh transcription capability
claw skill install mesh-transcribe

# Or install the full suite
claw skill install ic-mesh-node
```

### 2. Join the Network

```bash
# Start earning with transcription
claw skill mesh-transcribe

# Your node will appear at moilol.com:8333/nodes
# Jobs will start flowing within minutes
```

### 3. Track Your Earnings

```bash
# Check your node status
curl http://localhost:8333/nodes

# View earnings dashboard
open https://moilol.com/account
```

## 📊 Earnings Potential

**Real Network Data** (February 2026):

| Capability | Jobs Available | Rate per Job | Daily Potential |
|-----------|----------------|--------------|-----------------|
| Transcription | 20-40/day | $0.15-0.30 | $3-12 |
| OCR/PDF Extract | 5-15/day | $0.20-0.40 | $1-6 |
| Image Generation | 2-8/day | $0.10-0.25 | $0.20-2 |
| Language Models | 1-5/day | $0.05-0.15 | $0.05-0.75 |

**Top Performers**: 100+ jobs completed, $15-40 earned

**Getting Started**: Most operators see first earnings within 24 hours

## ⚙️ System Requirements

### Minimum (Transcription)
- **CPU**: 2 cores, 4GB RAM
- **Storage**: 10GB free space
- **Network**: Broadband internet
- **Software**: Python 3.8+, FFmpeg

### Recommended (Multi-capability)
- **CPU**: 4+ cores, 8GB+ RAM  
- **GPU**: NVIDIA with 4GB+ VRAM (optional but profitable)
- **Storage**: 50GB+ SSD
- **Network**: Stable broadband (>10 Mbps)

### Advanced (High Earnings)
- **GPU**: RTX 3060+ or comparable
- **RAM**: 16GB+ system RAM
- **Network**: Reliable connection (<1% downtime)
- **Multiple capabilities**: Whisper, Stable Diffusion, Ollama

## 🔧 Troubleshooting

### "No Jobs Available"
- **Check network**: `curl http://moilol.com:8333/health`
- **Verify capabilities**: Ensure handlers are working
- **Update software**: `claw skill update mesh-transcribe`
- **Check logs**: Look for error messages

### "Jobs Failing"
- **Test locally**: Run transcription on sample file
- **Check dependencies**: Ensure Python, FFmpeg installed
- **Resource constraints**: Monitor CPU/RAM usage
- **Network issues**: Verify stable internet connection

### "Low Earnings"
- **Add capabilities**: Install additional handlers (OCR, Stable Diffusion)
- **Optimize performance**: Faster hardware = more jobs
- **Maintain uptime**: Consistent availability increases job flow
- **Geographic factors**: Some regions have higher demand

## 🎓 Advanced Topics

### Multiple Capabilities
```bash
# Add OCR capability (requires Tesseract)
claw skill install mesh-ocr

# Add image generation (requires GPU)
claw skill install mesh-stable-diffusion  

# Add language model serving
claw skill install mesh-ollama
```

### Performance Optimization
- **SSD storage**: Faster job processing
- **GPU acceleration**: Higher earnings potential
- **Network optimization**: Reduce latency
- **Resource monitoring**: Prevent overcommitment

### Business Operation
- **Track metrics**: Jobs per day, success rate, earnings
- **Tax considerations**: Report earnings appropriately
- **Scaling up**: Multiple nodes, dedicated hardware
- **Professional operation**: Monitoring, alerting, uptime

## 🌍 Network Economics

**For Customers**:
- **60-80% cost savings** vs traditional AI APIs
- **Same quality**: Uses same models (Whisper, GPT, etc.)
- **Faster processing**: Distributed network reduces queuing
- **Data sovereignty**: Direct peer-to-peer processing

**For Operators**:
- **Passive income**: Earn while computer is idle
- **Flexible participation**: Join/leave anytime
- **Real demand**: Actual customer jobs, not artificial work
- **Fair pricing**: Market-driven rates

**For the Network**:
- **Decentralization**: Resistant to censorship and outages
- **Cost efficiency**: No massive data center overhead
- **Innovation**: Open platform for new AI capabilities
- **Sustainability**: Utilizes existing hardware efficiently

## 🤝 Community & Support

### Getting Help
- **Discord**: [OpenClaw Community](https://discord.gg/openclaw)
- **Documentation**: [docs.openclaw.com](https://docs.openclaw.com)
- **GitHub**: [intelligence-club/ic-mesh](https://github.com/intelligence-club/ic-mesh)
- **Email**: support@moilol.com

### Staying Updated
- **Network Status**: [moilol.com:8333](http://moilol.com:8333)
- **Announcements**: OpenClaw Discord #ic-mesh channel
- **Code Updates**: GitHub releases and commits

### Contributing
- **Bug Reports**: GitHub issues
- **Feature Requests**: Discord discussions
- **Code Contributions**: Pull requests welcome
- **Network Testing**: Help validate new capabilities

---

## Next Steps

1. **Try it out**: Upload a file at [moilol.com](https://moilol.com)
2. **Start earning**: `claw skill mesh-transcribe`
3. **Join community**: Connect with other operators
4. **Scale up**: Add more capabilities as you learn

**Welcome to the future of decentralized AI!** 🚀

*IC Mesh: Where AI meets economics, and everyone wins.*