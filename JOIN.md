# Join the IC Mesh Network

Connect your machine to the Intelligence Club compute mesh. Your node contributes processing power and gains access to the network's collective capabilities.

## Requirements

- **Node.js 18+** — [nodejs.org](https://nodejs.org)
- **Git** — to clone the repo
- **Network access** — outbound HTTPS to the mesh hub

### Optional (unlocks capabilities)

- **Ollama** — local LLM inference → [ollama.com](https://ollama.com)
- **Whisper** — audio transcription → `pip install openai-whisper`
- **ffmpeg** — media processing → `brew install ffmpeg` / `apt install ffmpeg`
- **GPU** — NVIDIA or Apple Silicon (auto-detected)

---

## Quick Start

### 1. Clone the repo

```bash
git clone https://github.com/intelligence-club/ic-mesh.git
cd ic-mesh
```

### 2. Configure your node

Set these environment variables (or create a `.env` file):

```bash
export IC_MESH_SERVER="https://moilol.com:8333"
export IC_NODE_NAME="your-node-name"      # e.g. "hilo-mac-mini"
export IC_NODE_OWNER="your-name"           # e.g. "drake"
export IC_NODE_REGION="your-region"        # e.g. "hawaii", "nyc", "berlin"
```

Or create a `.env` file in the `ic-mesh` directory:

```
IC_MESH_SERVER=https://moilol.com:8333
IC_NODE_NAME=hilo-mac-mini
IC_NODE_OWNER=drake
IC_NODE_REGION=hawaii
```

### 3. Start your node

```bash
node client.js
```

You should see:

```
┌──────────────────────────────────┐
│  ◉ IC MESH — Node Client v0.1.0 │
└──────────────────────────────────┘
  Server: https://moilol.com:8333
  Node:   hilo-mac-mini
  Owner:  drake

◉ Registered as node: a3f8b2c1e9d04567
  Capabilities: ollama, ffmpeg, gpu-metal
  Models: llama3.1:8b, mistral:7b
  RAM: 16384MB (11200MB free)
  CPU: 10 cores (78% idle)

◉ Node running. Checking in every 60s, polling jobs every 10s
  Press Ctrl+C to leave the mesh.
```

### 4. (Optional) Run as a background service

**macOS (launchd):**

```bash
# Create the plist
cat > ~/Library/LaunchAgents/com.ic-mesh.node.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.ic-mesh.node</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>client.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/path/to/ic-mesh</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>IC_MESH_SERVER</key>
        <string>https://moilol.com:8333</string>
        <key>IC_NODE_NAME</key>
        <string>your-node-name</string>
        <key>IC_NODE_OWNER</key>
        <string>your-name</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
EOF

# Load it
launchctl load ~/Library/LaunchAgents/com.ic-mesh.node.plist
```

**Linux (systemd):**

```bash
sudo cat > /etc/systemd/system/ic-mesh-node.service << 'EOF'
[Unit]
Description=IC Mesh Node
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/ic-mesh
ExecStart=/usr/bin/node client.js
Environment=IC_MESH_SERVER=https://moilol.com:8333
Environment=IC_NODE_NAME=your-node-name
Environment=IC_NODE_OWNER=your-name
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable ic-mesh-node
sudo systemctl start ic-mesh-node
```

---

## How It Works

1. **Your node checks in** with the mesh hub every 60 seconds, reporting its capabilities (CPU, RAM, GPU, installed tools, Ollama models)
2. **Jobs appear** when someone on the network needs compute — inference, transcription, media processing
3. **Your node claims jobs** it can handle, executes them locally, and reports results
4. **Compute credits** are tracked on a ledger — you earn credits for work done, spend them when you submit jobs
5. **20% network fee** goes to the IC treasury to fund infrastructure

## What Your Node Can Do

The client auto-detects your capabilities:

| Capability | What it enables | How to install |
|-----------|----------------|---------------|
| `ollama` | LLM inference (chat, completion) | [ollama.com](https://ollama.com) |
| `whisper` | Audio/video transcription | `pip install openai-whisper` |
| `ffmpeg` | Media processing, conversion | `brew install ffmpeg` |
| `gpu-nvidia` | GPU-accelerated compute | NVIDIA drivers + CUDA |
| `gpu-metal` | Apple Silicon acceleration | Built into macOS (auto-detected) |

## Network Dashboard

See all active nodes and network stats:
- **Dashboard:** https://moilol.com:8333
- **API status:** https://moilol.com:8333/status
- **Node list:** https://moilol.com:8333/nodes

---

## Troubleshooting

**"Mesh server unreachable"**
- Check your internet connection
- Verify `IC_MESH_SERVER` is set to `https://moilol.com:8333`
- The hub might be restarting — the client will auto-retry

**Node shows no capabilities**
- Install Ollama, Whisper, or ffmpeg and restart the client
- The client detects tools via `which` — make sure they're on your PATH

**Not picking up jobs**
- Your node only claims jobs matching its capabilities
- Check the dashboard to see if jobs are pending

---

*Questions? Drop into the [Intelligence Club](https://moilol.com) or reach us at hello@moilol.com*
