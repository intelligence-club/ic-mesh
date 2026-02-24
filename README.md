# IC Mesh — Distributed Compute Network

**Your hardware. Our network. Multiplied.**

A distributed compute mesh that connects idle hardware into a shared network. Transcription, image generation, AI inference — powered by real machines, not rented cloud.

🌐 **[Live Network Dashboard](https://moilol.com/mesh)**  
🎙️ **[Try it now — free](https://moilol.com/network.html#try)**  
📊 **[Network Status](https://moilol.com/mesh/status)**

---

## What it does

| Service | Price | Powered by |
|---------|-------|-----------|
| 🎙️ Transcription | $0.004/min | Whisper on Apple Silicon |
| 🎨 Image Generation | $0.05/image | Stable Diffusion on local GPUs |
| 🧠 AI Inference | $0.001/request | Ollama (Llama, Mistral, etc.) |
| 🎬 Media Processing | $0.01/min | ffmpeg on mesh nodes |

## Join the mesh (3 commands)

Got a Mac, a PC, a spare server? Put it to work.

```bash
git clone https://github.com/intelligence-club/ic-mesh.git
cd ic-mesh

IC_MESH_SERVER=https://moilol.com:8333 \
IC_NODE_NAME=your-node-name \
IC_NODE_OWNER=your-name \
node client.js
```

Your node auto-detects capabilities (Whisper, Ollama, Stable Diffusion, ffmpeg, GPU) and starts picking up jobs. You keep **80%** of every job's value.

📖 **[Full setup guide →](JOIN.md)**

## Architecture

```
         ┌─────────────────────────┐
         │      IC MESH HUB        │
         │   SQLite + WebSocket    │
         │   DO Spaces (file CDN)  │
         └────┬──────────┬─────────┘
              │          │
    ┌─────────┴──┐  ┌────┴──────────┐
    │  Node A    │  │  Node B       │
    │  Whisper   │  │  Stable Diff  │
    │  ffmpeg    │  │  Ollama       │
    │  Metal GPU │  │  NVIDIA GPU   │
    └────────────┘  └───────────────┘
```

- **Hub** routes jobs to the best available node
- **Nodes** check in, advertise capabilities, claim and execute jobs
- **Files** go through DO Spaces CDN (presigned URLs, 24hr auto-cleanup)
- **Ledger** tracks compute credits per node
- **HTTP + WebSocket** — backward compatible, real-time ready

## Stack

- **Server**: Node.js, SQLite (WAL), WebSocket
- **Storage**: DigitalOcean Spaces (S3-compatible) with local fallback
- **Client**: Zero dependencies, auto-detects capabilities
- **Protocol**: HTTP polling (v0.1 compat) + WebSocket push (v0.3+)

## API

Submit a job from anywhere:

```bash
# Transcribe audio
curl -X POST https://moilol.com/mesh/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "type": "transcribe",
    "payload": {"url": "https://example.com/audio.mp3", "model": "base"},
    "requirements": {"capability": "whisper"}
  }'

# Generate an image
curl -X POST https://moilol.com/mesh/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "type": "generate",
    "payload": {"prompt": "a sunset over the ocean", "width": 1024, "height": 1024},
    "requirements": {"capability": "stable-diffusion"}
  }'

# Check result
curl https://moilol.com/mesh/jobs/<jobId>
```

## Economics

```
Job submitted → best node claims it → executes locally → result returned

Revenue split:
  80% → node operator
  15% → network treasury
   5% → infrastructure
```

## Roadmap

- [x] Core mesh (job routing, node registry, ledger)
- [x] Transcription (Whisper)
- [x] Image generation (Stable Diffusion)
- [x] SQLite persistence
- [x] WebSocket real-time transport
- [x] DO Spaces file storage
- [ ] Ed25519 node authentication
- [ ] Trust & reputation system
- [ ] Hub federation (multi-hub mesh)
- [ ] Web dashboard with live job feed
- [ ] Stripe integration (pay-per-job)
- [ ] Node operator payouts

## Links

- 🌐 [moilol.com/network.html](https://moilol.com/network.html) — Product page
- 📊 [moilol.com/mesh](https://moilol.com/mesh) — Live dashboard
- 📖 [JOIN.md](JOIN.md) — Full setup guide
- 📐 [PROTOCOL.md](https://github.com/intelligence-club/ic-mesh/blob/protocol-v2/PROTOCOL.md) — v0.2 protocol spec

---

**Intelligence Club** · Open source · Hawaiʻi-based · [hello@moilol.com](mailto:hello@moilol.com)
