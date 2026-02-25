# IC Mesh — Distributed Compute Network

**Your hardware. Our network. Multiplied.**

A distributed compute mesh that connects idle hardware into a shared network. Transcription, image generation, AI inference — powered by real machines, not rented cloud.

🌐 **[Live Network Dashboard](https://moilol.com/mesh)**  
📊 **[Network Status](https://moilol.com/mesh/status)**  
🛠️ **[Use the Mesh](https://moilol.com/use.html)** — submit jobs via browser  
💰 **[Become an Operator](https://moilol.com/onboard.html)** — earn money with your hardware

---

## 🔒 Security Features

IC Mesh implements multiple security layers to protect against common attack vectors:

### URL Validation
- **Protocol enforcement:** Only `http://` and `https://` URLs accepted for job payloads
- **Internal network protection:** Blocks localhost and private IP ranges to prevent SSRF attacks
- **File system protection:** Prevents `file://`, `ftp://`, and other dangerous protocols
- **Validation points:** Both job submission and mesh processing validate URLs

### Capability Validation
- **Strict matching:** Jobs only assigned to nodes with confirmed capabilities
- **Alias system:** Supports capability name variations (`transcription` → `whisper`, `ocr` → `tesseract`)
- **Real-time verification:** Capability checked at job claim time, not just submission

### Rate Limiting
- **Per-IP limits:** Prevents spam and resource exhaustion attacks
- **Graceful degradation:** Rate-limited requests receive clear error messages
- **Configurable thresholds:** Operators can adjust limits based on their capacity

---

## ⚠️ Important: Two Servers, Two Base URLs

IC Mesh has **two servers**. Getting the base URL wrong is the #1 mistake machines make.

| Server | Base URL | What it does |
|--------|----------|-------------|
| **Mesh hub** | `https://moilol.com/mesh/` | Compute: nodes, jobs, payouts, cashout |
| **Site** | `https://moilol.com/` | Money: buy credits, accounts, auth, Stripe webhooks |

**If you get a 404**, check which server you're hitting. `POST /mesh/buy-credits` will 404 — it's `POST /api/buy-credits` on the site. `POST /api/cashout` will 404 — it's `POST /mesh/cashout` on the mesh hub.

Route-not-found errors are clearly labeled:
```json
{"error":"Route not found","code":"ROUTE_NOT_FOUND","path":"/buy","hint":"See docs"}
```

Resource-not-found errors tell you what's missing:
```json
{"error":"Node not found. Register first."}
```

If you see `ROUTE_NOT_FOUND`, you're hitting the wrong path. If you see a specific error message, the endpoint exists and is telling you what's wrong.

---

## What it does

| Service | Price | Powered by | Capability |
|---------|-------|-----------|-----------|
| 🎙️ Transcription | ~30 ints/min | Whisper on Apple Silicon | `whisper` |
| 🎨 Image Generation | ~50 ints/image | Stable Diffusion on local GPUs | `stable-diffusion` |
| 🧠 AI Inference | ~10 ints/request | Ollama (Llama, Mistral, etc.) | `gpu-metal` |
| 🎬 Media Processing | ~20 ints/min | ffmpeg on mesh nodes | `ffmpeg` |

_1,000 ints = $1.00 USD. Buy ints with credit card, earn ints by contributing compute, cash out to your bank via Stripe Connect._

---

## 🚀 Quick Start for New Operators

**Want to start earning with your machine? We've got a 3-minute setup:**

```bash
git clone https://github.com/intelligence-club/ic-mesh.git
cd ic-mesh
node scripts/operator-setup.js
```

This setup script will:
- ✅ Detect your system capabilities (Ollama, Whisper, FFmpeg)
- 💰 Show your earning potential ($2-15/day typical)
- ⚙️ Create optimized configuration
- 💳 Walk you through payment setup (Stripe Connect)
- 🚀 Start your node earning immediately

**For manual setup or development:** See detailed [JOIN.md](JOIN.md) guide.

---

## Complete API Reference

### Mesh Hub Endpoints (`https://moilol.com/mesh/...`)

Everything below is relative to `https://moilol.com/mesh`.

#### Network

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/status` | Network status, active nodes, capabilities, job counts |

#### Nodes

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/nodes/register` | Register a node (called automatically by client.js) |
| `GET` | `/nodes` | List all nodes with status |
| `POST` | `/nodes/onboard` | Create Stripe Express account for operator payouts |
| `GET` | `/nodes/{nodeId}/stripe` | Check operator's Stripe onboarding status |

#### Jobs

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/jobs` | Submit a job |
| `GET` | `/jobs/{jobId}` | Get job status and result |
| `GET` | `/jobs/available` | List unclaimed jobs (for node polling) |
| `POST` | `/jobs/{jobId}/claim` | Node claims a job |
| `POST` | `/jobs/{jobId}/complete` | Node reports job completion |

#### Earnings & Payouts

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/ledger/{nodeId}` | Compute balance (minutes) |
| `GET` | `/payouts` | All operator earnings (ints) |
| `GET` | `/payouts/{nodeId}` | Single operator's earnings |
| `POST` | `/cashout` | Request cashout → Stripe Connect transfer |
| `GET` | `/cashouts/{nodeId}` | Cashout history + Stripe transfer details |

### Site Endpoints (`https://moilol.com/...`)

These handle money, accounts, and authentication. **Not prefixed with /mesh.**

#### Buy & Spend

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/buy-credits` | Buy ints → returns Stripe Checkout URL |
| `GET` | `/api/balance?email=...` | Check int balance + transaction history |
| `POST` | `/api/use-credits` | Spend ints on a job (if you have balance) |

#### Authentication

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/auth/send-code` | Send email login code |
| `POST` | `/api/auth/verify-code` | Verify code → session cookie |
| `GET` | `/api/auth/me` | Current session info |
| `POST` | `/api/auth/keys` | Get or generate API key |
| `GET` | `/api/auth/keys` | View current API key |

#### Machine API

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/transcribe` | Submit transcription (requires `Authorization: Bearer <api_key>`) |
| `GET` | `/api/jobs/{token}` | Poll job status + result |

#### Webhooks

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/stripe/webhook` | Stripe payment confirmation (signature verified) |

---

## Quick Start: Use the Mesh (Consumer)

### Via web
Go to **https://moilol.com/use.html** — upload a file or enter a prompt, pay, get results.

### Via API

```bash
# 1. Get an account + API key
curl -X POST https://moilol.com/api/auth/send-code \
  -H "Content-Type: application/json" \
  -d '{"email": "you@email.com"}'
# Check your email for the 6-digit code, then:
curl -X POST https://moilol.com/api/auth/verify-code \
  -H "Content-Type: application/json" \
  -d '{"email": "you@email.com", "code": "123456"}'

# 2. Buy ints
curl -X POST https://moilol.com/api/buy-credits \
  -H "Content-Type: application/json" \
  -d '{"email": "you@email.com", "amount": 5000}'
# → Returns {"url": "https://checkout.stripe.com/..."} — complete payment there

# 3. Generate an API key
curl -X POST https://moilol.com/api/auth/keys \
  -b 'ic_session=YOUR_SESSION_TOKEN'
# → Returns {"api_key": "ic_abc123..."}

# 4. Submit a job
curl -X POST https://moilol.com/api/transcribe \
  -H "Authorization: Bearer ic_abc123..." \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/audio.mp3"}'
# → Returns {"job_token": "...", "poll": "https://moilol.com/api/jobs/TOKEN"}

# 5. Poll for result
curl https://moilol.com/api/jobs/YOUR_JOB_TOKEN
# → Returns {"status": "completed", "result": {"transcript": "..."}}
```

### Submit directly to the mesh (any job type)

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
    "type": "generate-image",
    "payload": {"prompt": "a sunset over the ocean", "width": 1024, "height": 1024},
    "requirements": {"capability": "stable-diffusion"}
  }'

# Process media with ffmpeg
curl -X POST https://moilol.com/mesh/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "type": "ffmpeg",
    "payload": {"url": "https://example.com/video.mp4", "args": "-c:v libx264 -crf 28", "outputFormat": "mp4"},
    "requirements": {"capability": "ffmpeg"}
  }'

# Check result
curl https://moilol.com/mesh/jobs/<jobId>
```

---

## Capability System

IC Mesh uses a flexible capability system to match jobs with appropriate nodes. Jobs specify required capabilities in their `requirements` field, and only nodes with matching capabilities can claim them.

### Standard Capabilities

| Capability | Purpose | Node Requirements |
|------------|---------|-------------------|
| `whisper` | Audio transcription | Whisper model installed |
| `stable-diffusion` | Image generation | Stable Diffusion models loaded |
| `ollama` | LLM inference | Ollama service running |
| `tesseract` | OCR, PDF text extraction | Tesseract OCR installed |
| `ffmpeg` | Media processing/conversion | FFmpeg binary available |
| `gpu-metal` | GPU-accelerated tasks | Metal-compatible GPU (macOS) |

### Capability Aliases

The system supports legacy capability names for backward compatibility:

| Legacy Name | Maps To | Description |
|-------------|---------|-------------|
| `transcription` | `whisper` | Audio transcription jobs |
| `ocr` | `tesseract` | Optical character recognition |
| `pdf-extract` | `tesseract` | PDF text extraction |
| `inference` | `ollama` | Large language model inference |
| `generate-image` | `stable-diffusion` | AI image generation |

### Job Type → Capability Mapping

When submitting jobs through the site interface, job types are automatically mapped to appropriate capabilities:

```javascript
// Automatic mapping in job submission
{
  'transcribe': 'whisper',
  'generate-image': 'stable-diffusion', 
  'inference': 'ollama',
  'ocr': 'tesseract',
  'pdf-extract': 'tesseract'
}
```

---

## Quick Start: Earn Money (Operator)

### Via web
Go to **https://moilol.com/onboard.html** — 4-step wizard walks you through everything.

### Via terminal

```bash
# 1. Clone and start your node
git clone https://github.com/intelligence-club/ic-mesh.git
cd ic-mesh && npm install

IC_MESH_HUB=https://moilol.com/mesh \
IC_NODE_NAME=my-node \
IC_NODE_OWNER=you@email.com \
node client.js
# → Prints your node ID when it connects

# 2. Set up Stripe to get paid
curl -X POST https://moilol.com/mesh/nodes/onboard \
  -H "Content-Type: application/json" \
  -d '{"nodeId": "YOUR_NODE_ID", "email": "you@email.com", "country": "US"}'
# → Returns {"onboarding_url": "https://connect.stripe.com/..."} — complete there

# 3. Check your earnings
curl https://moilol.com/mesh/payouts/YOUR_NODE_ID

# 4. Cash out (minimum 1,000 ints = $0.80)
curl -X POST https://moilol.com/mesh/cashout \
  -H "Content-Type: application/json" \
  -d '{"nodeId": "YOUR_NODE_ID"}'

# 5. View cashout history
curl https://moilol.com/mesh/cashouts/YOUR_NODE_ID
```

**Operator dashboard**: https://moilol.com/operator.html — track earnings, manage Stripe, cashout with one click.

Your node auto-detects capabilities (Whisper, Stable Diffusion, ffmpeg, GPU) and picks up matching jobs automatically. You keep **80%** of every job.

---

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

## Economics

```
Consumer buys ints (Stripe Checkout) → submits job → node claims & executes → result returned

Revenue split per job:
  80% → node operator (you)
  15% → network treasury
   5% → infrastructure

Operator cashout: ints → USD via Stripe Connect → your bank account
Minimum cashout: 1,000 ints ($0.80)
Stripe fee: 0.25% + $0.25 per payout
```

## Stack

- **Server**: Node.js, SQLite (WAL), WebSocket — zero external dependencies
- **Storage**: DigitalOcean Spaces (S3-compatible) with local fallback
- **Client**: Zero dependencies, auto-detects capabilities
- **Payments**: Stripe (raw HTTPS, no SDK) — Connect Express for operators
- **Protocol**: HTTP polling (v0.1 compat) + WebSocket push (v0.3+)

## Practical Examples & Troubleshooting

### Common API Tasks

**Check network health before submitting jobs:**
```bash
# Check if any nodes are online
curl -s https://moilol.com/mesh/status | jq '.nodes_active'

# See available capabilities
curl -s https://moilol.com/mesh/nodes | jq '.[].capabilities[]' | sort | uniq
```

**Upload a file for processing:**
```bash
# Get presigned upload URL
curl -X POST https://moilol.com/mesh/upload/presign \
  -H "Content-Type: application/json" \
  -d '{"filename": "my-audio.wav", "content_type": "audio/wav"}'

# Upload directly to the response URL, then use the download_url in your job payload
```

**Monitor job progress:**
```bash
# Submit job and get jobId
JOB_ID=$(curl -s -X POST https://moilol.com/mesh/jobs \
  -H "Content-Type: application/json" \
  -d '{"type":"transcribe","payload":{"url":"https://example.com/audio.wav"}}' | jq -r '.jobId')

# Poll until completion
while true; do
  STATUS=$(curl -s "https://moilol.com/mesh/jobs/$JOB_ID" | jq -r '.job.status')
  echo "Status: $STATUS"
  [ "$STATUS" = "completed" ] && break
  sleep 2
done

# Get final result
curl -s "https://moilol.com/mesh/jobs/$JOB_ID" | jq '.job.result'
```

### Error Troubleshooting

**Rate Limited (429):**
```json
{"error": "Rate limit exceeded", "retry_after": 60}
```
→ Wait the specified seconds before retrying

**Invalid Job Type (400):**
```json
{"error": "Invalid job type. Must be one of: transcribe, generate-image, ffmpeg, inference, ocr, pdf-extract"}
```
→ Check spelling and available job types

**No Available Nodes (pending forever):**
```bash
# Check if any nodes have your required capability
curl -s https://moilol.com/mesh/nodes | jq '.[] | select(.capabilities | contains(["whisper"]))'
```
→ Wait for nodes with the required capability to come online

**File Not Found (404):**
```json
{"error": "File not found", "suggestion": "Check filename or upload the file first"}
```
→ Verify the file was uploaded successfully before referencing it

**Authentication Errors (401):**
```json
{"error": "Authorization: Bearer <api_key> required"}
```
→ Include your API key in the Authorization header

### Performance Tips

- **Batch jobs**: Submit multiple small jobs rather than one large job for better parallelization
- **Use presigned uploads**: For large files, upload to Spaces first rather than POSTing directly
- **Monitor node availability**: Check `/mesh/nodes` to see which capabilities are online
- **Set appropriate timeouts**: Complex jobs may need longer timeout values

---

## Testing

```bash
npm run test:ci
# Or: node server.js & npm test
```

Tests cover: status, node registration, job lifecycle, WebSocket, error handling.

## Links

- 🛠️ [moilol.com/use.html](https://moilol.com/use.html) — Use the mesh (submit jobs)
- 💰 [moilol.com/onboard.html](https://moilol.com/onboard.html) — Become an operator
- 📊 [moilol.com/operator.html](https://moilol.com/operator.html) — Operator dashboard
- 🌐 [moilol.com/mesh](https://moilol.com/mesh) — Live network dashboard
- 📖 [JOIN.md](JOIN.md) — Full setup guide
- 📐 [PROTOCOL.md](PROTOCOL.md) — Protocol spec

## 🌱 Regenerative Computing

The Intelligence Club Mesh isn't just distributed computing—it's **regenerative** computing. Like healthy soil that creates abundance while healing the ecosystem, our mesh network operates on principles that strengthen the whole while serving each part.

**Study & Implementation:**
- 📖 [REGENERATIVE-COMPUTING.md](docs/REGENERATIVE-COMPUTING.md) — How Korean Natural Farming principles guide distributed intelligence toward planetary healing
- 🔧 [KNF-IMPLEMENTATION-GUIDE.md](docs/KNF-IMPLEMENTATION-GUIDE.md) — Practical code patterns implementing biological principles in mesh networks
- 🩺 `npm run health:regenerative` — Monitor network health using biological metrics (diversity, activity, resilience, circulation)

**Vision:** A distributed intelligence network that heals the planet. Compute that serves life. Technology that makes the earth more alive, not less.

The mesh becomes a tool for ecosystem restoration when we direct its computational power toward:
- Carbon sequestration monitoring and verification
- Biodiversity tracking and restoration consulting  
- Precision regenerative agriculture optimization
- Watershed management and ecological modeling

**"The network that heals the earth"** isn't just aspiration—it's practical possibility emerging from regenerative principles applied to computing.

---

**Intelligence Club** · Open source · Hawaiʻi-based · [hello@moilol.com](mailto:hello@moilol.com)
