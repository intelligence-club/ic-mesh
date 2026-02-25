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
| 🎙️ Transcription | ~30 ints/min | Whisper on Apple Silicon |
| 🎨 Image Generation | ~50 ints/image | Stable Diffusion on local GPUs |
| 🧠 AI Inference | ~10 ints/request | Ollama (Llama, Mistral, etc.) |
| 🎬 Media Processing | ~20 ints/min | ffmpeg on mesh nodes |
| 📄 OCR Text Extraction | ~5 ints/page | Tesseract on mesh nodes |

_1,000 ints = $1.00 USD. Buy ints with credit card, earn ints by contributing compute, cash out via Stripe Connect._

## Join the mesh (3 commands)

Got a Mac, a PC, a spare server? Put it to work.

```bash
git clone https://github.com/intelligence-club/ic-mesh.git
cd ic-mesh

IC_MESH_HUB=https://moilol.com/mesh \
IC_NODE_NAME=your-node-name \
IC_NODE_OWNER=your-name \
node client.js
```

Your node auto-detects capabilities (Whisper, Ollama, Stable Diffusion, ffmpeg, GPU) and starts picking up jobs. You keep **80%** of every job's value.

**Perfect for OpenClaw users** — Turn your agent's idle time into earnings. Your OpenClaw setup already has everything needed to join the mesh. No conflicts.

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

# Extract text from image
curl -X POST https://moilol.com/mesh/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "type": "ocr",
    "payload": {"url": "https://example.com/document.png", "language": "eng"},
    "requirements": {"capability": "ocr"}
  }'

# Check result
curl https://moilol.com/mesh/jobs/<jobId>
```

## Payments & Operator Payouts

```bash
# Buy ints (consumer) — returns Stripe Checkout URL
curl -X POST https://moilol.com/api/buy-credits \
  -H "Content-Type: application/json" \
  -d '{"email": "you@email.com", "amount": 5000}'

# Check balance
curl https://moilol.com/api/balance?email=you@email.com

# Operator: set up Stripe Connect payouts
curl -X POST https://moilol.com/mesh/nodes/onboard \
  -H "Content-Type: application/json" \
  -d '{"nodeId": "YOUR_NODE_ID", "email": "you@email.com", "country": "US"}'

# Operator: cash out earnings
curl -X POST https://moilol.com/mesh/cashout \
  -H "Content-Type: application/json" \
  -d '{"nodeId": "YOUR_NODE_ID"}'

# Check earnings & cashout history
curl https://moilol.com/mesh/payouts/YOUR_NODE_ID
curl https://moilol.com/mesh/cashouts/YOUR_NODE_ID
```

**Web UI**: [moilol.com/use.html](https://moilol.com/use.html) — submit any job type via browser  
**Operator onboarding**: [moilol.com/onboard.html](https://moilol.com/onboard.html) — wizard for new operators  
**Operator dashboard**: [moilol.com/operator.html](https://moilol.com/operator.html) — track earnings & cashout

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
- [x] Stripe integration (pay-per-job)
- [x] Node operator payouts (Stripe Connect)
- [x] Ints currency system (compute credits)
- [x] Web dashboard with live job feed
- [x] Account management & cashout system
- [ ] Ed25519 node authentication
- [ ] Trust & reputation system  
- [ ] Hub federation (multi-hub mesh)
- [ ] Advanced job scheduling

## Testing

Run the test suite to verify API functionality:

```bash
# Start server and run tests
npm run test:ci

# Or manually:
node server.js &
npm test
```

The test suite covers:
- ✅ Network status endpoint
- ✅ Node registration & listing  
- ✅ Job creation & retrieval
- ✅ WebSocket connectivity
- ✅ Error handling (404s, etc.)

Tests run automatically on GitHub Actions for Node.js 18, 20, and 22.

## Links

- 🌐 [moilol.com/network.html](https://moilol.com/network.html) — Product page
- 📊 [moilol.com/mesh](https://moilol.com/mesh) — Live dashboard
- 📖 [JOIN.md](JOIN.md) — Full setup guide
- 📐 [PROTOCOL.md](https://github.com/intelligence-club/ic-mesh/blob/protocol-v2/PROTOCOL.md) — v0.2 protocol spec

---

**Intelligence Club** · Open source · Hawaiʻi-based · [hello@moilol.com](mailto:hello@moilol.com)
