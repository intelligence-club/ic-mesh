# IC Mesh Protocol v0.2

*A protocol for decentralized compute coordination — secure, verifiable, trust-building.*

---

## Overview

The IC Mesh Protocol defines how independent compute nodes discover each other, negotiate trust, exchange work, and verify results. It's designed to scale from two friends sharing a Mac Mini to a global mesh of thousands of heterogeneous machines.

**Design principles:**
- **No central authority required** — hubs coordinate, they don't control
- **Trust is earned** — nodes build reputation through reliable work
- **Verify, don't trust** — results are hashed, signed, and optionally consensus-verified
- **Privacy by default** — payloads can be end-to-end encrypted
- **Simple at the edges** — a node should be easy to run; complexity lives in the protocol

---

## 1. Identity

Every node has a cryptographic identity.

### 1.1 Key Generation

On first run, a node generates an **Ed25519 keypair**:

```
Private key → stored locally at ~/.ic-mesh/node.key (never leaves the machine)
Public key  → registered with the network as the node's identity
Node ID     → SHA-256(public_key)[:16] (hex, 32 chars)
```

Why Ed25519:
- Fast key generation and signing
- Small keys (32 bytes) and signatures (64 bytes)  
- Battle-tested (SSH, Signal, WireGuard all use it)
- No configuration — one curve, no choices to get wrong

### 1.2 Node Identity File

```json
{
  "nodeId": "a3f8b2c1e9d04567890abcdef1234567",
  "publicKey": "base64-encoded-ed25519-public-key",
  "name": "hilo-mac-mini",
  "owner": "drake",
  "region": "hawaii",
  "created": "2026-02-24T00:00:00Z",
  "version": "0.2.0"
}
```

### 1.3 Hub Registration

```
Node                                Hub
  |                                  |
  |-- REGISTER(identity, pubkey) --> |
  |                                  |-- verify pubkey format
  |                                  |-- store in registry
  |<-- OK(nodeId, challenge) ------- |
  |                                  |
  |-- PROVE(sign(challenge)) -----> |
  |                                  |-- verify signature
  |<-- VERIFIED -------------------- |
```

After verification, the node is **registered but untrusted** (trust level 0).

---

## 2. Transport

### 2.1 WebSocket (Primary)

Persistent bidirectional connection replaces HTTP polling.

```
wss://hub.example.com/mesh/ws?nodeId=<id>&sig=<signed-timestamp>
```

Benefits:
- **Instant job dispatch** — hub pushes jobs to nodes, no polling delay
- **Real-time status** — heartbeats, job progress, network events
- **Lower overhead** — one connection vs repeated HTTP requests
- **NAT-friendly** — outbound connection from node, works behind firewalls

### 2.2 Message Format

All messages are JSON with a standard envelope:

```json
{
  "type": "job.submit | job.claim | job.result | node.heartbeat | ...",
  "id": "message-uuid",
  "timestamp": 1771895056512,
  "from": "node-id",
  "signature": "base64-ed25519-signature-of-payload",
  "payload": { ... }
}
```

The `signature` field signs `SHA-256(JSON.stringify(payload) + timestamp)`.

### 2.3 Fallback: HTTP

For environments where WebSocket isn't available, the existing HTTP polling API remains as a fallback. All HTTP requests include:

```
X-Node-Id: <nodeId>
X-Timestamp: <unix-ms>
X-Signature: <sign(method + path + timestamp)>
```

---

## 3. Discovery

### 3.1 Well-Known Endpoint

Any hub advertises itself at:

```
GET /.well-known/ic-mesh.json
```

```json
{
  "protocol": "ic-mesh",
  "version": "0.2.0",
  "hub": {
    "name": "Intelligence Club Hub",
    "websocket": "wss://moilol.com/mesh/ws",
    "http": "https://moilol.com/mesh",
    "publicKey": "base64-hub-pubkey"
  },
  "network": {
    "nodes": 47,
    "capabilities": ["inference", "transcribe", "ffmpeg", "gpu-nvidia", "gpu-metal"],
    "totalCores": 312,
    "totalRAM_GB": 1240
  },
  "policies": {
    "open": true,
    "minTrustForJobs": 1,
    "networkFee": 0.20
  }
}
```

### 3.2 Multi-Hub Federation (Future)

Hubs can peer with each other:

```
Hub A <---> Hub B <---> Hub C
```

A job submitted to Hub A can overflow to Hub B's nodes if A lacks capacity. Hubs exchange signed capability summaries. This is how the mesh becomes truly decentralized — no single hub is a bottleneck.

---

## 4. Trust & Reputation

### 4.1 Trust Levels

```
Level 0 — Registered    : Just joined. Can receive ping jobs only.
Level 1 — Verified      : Completed 5+ jobs correctly. Can receive standard jobs.
Level 2 — Trusted       : 50+ jobs, 95%+ success rate. Priority routing.
Level 3 — Core          : 500+ jobs, 99%+ success, vouched by Level 3 node. Can verify others.
```

### 4.2 Reputation Score

```
reputation = (jobs_completed * success_rate * uptime_factor) - penalties

success_rate  = successful_jobs / total_claimed_jobs
uptime_factor = hours_online_last_30d / (30 * 24)
penalties     = failed_jobs * 5 + timeout_jobs * 2 + bad_results * 10
```

### 4.3 Vouching

A Level 3 node can vouch for another node, instantly promoting it to Level 1. This creates a web of trust — you join through someone who trusts you.

### 4.4 Verification Methods

| Method | Speed | Trust Required | Use Case |
|--------|-------|---------------|----------|
| **None** | Instant | Level 2+ | Trusted nodes, low-stakes jobs |
| **Hash check** | Fast | Level 1+ | Deterministic outputs (transcription, conversion) |
| **Dual-execute** | 2x cost | Level 0+ | Untrusted nodes, critical jobs |
| **Spot check** | Async | Any | Random re-execution of completed jobs |

**Hash check**: For deterministic jobs, the hub can re-run on a trusted node and compare output hashes. If they match, the untrusted node's result is confirmed.

**Dual-execute**: Job is sent to two independent nodes. Results are compared. If they match, both nodes get credit. If they differ, a third (trusted) node arbitrates.

---

## 5. Job Lifecycle

### 5.1 States

```
SUBMITTED → ROUTED → CLAIMED → EXECUTING → COMPLETED
                                    ↓
                                  FAILED
                                    ↓
                                RETRY (up to 3x)
```

### 5.2 Job Submission

```json
{
  "type": "job.submit",
  "payload": {
    "jobType": "transcribe",
    "input": {
      "url": "https://example.com/audio.m4a",
      "hash": "sha256:abc123...",
      "encrypted": false
    },
    "requirements": {
      "capability": "whisper",
      "minTrust": 1,
      "minRAM": 4000,
      "maxLatency": 300000,
      "verification": "hash"
    },
    "priority": "normal",
    "maxCost": 5.0
  }
}
```

### 5.3 Job Routing

The hub's compute broker scores eligible nodes:

```
score = (capability_match * 0.3)
      + (resource_fit * 0.25)
      + (trust_level * 0.25)
      + (proximity * 0.1)
      + (current_load_inverse * 0.1)
```

Job is pushed to the highest-scoring available node via WebSocket.

### 5.4 Job Completion

```json
{
  "type": "job.result",
  "payload": {
    "jobId": "abc123",
    "status": "completed",
    "output": {
      "data": { "transcript": "..." },
      "hash": "sha256:def456...",
      "computeMs": 71948
    },
    "signature": "base64-signature-of-output-hash"
  }
}
```

The signature proves this specific node produced this specific output. Non-repudiable.

---

## 6. Payload Security

### 6.1 Encryption Levels

| Level | Description | Overhead |
|-------|------------|----------|
| **Transport** | TLS (WSS) — encrypted in transit | Minimal |
| **Signed** | Payloads signed by submitter + worker | ~1ms |
| **Encrypted** | E2E encrypted — hub can't read payload | Key exchange |
| **Confidential** | Encrypted + trusted execution environment | Hardware TEE |

### 6.2 End-to-End Encryption

For sensitive jobs (medical records, private conversations):

```
Submitter                          Worker
    |                                |
    |-- ECDH key exchange ---------> |
    |<-- shared secret ------------- |
    |                                |
    |-- AES-256-GCM(payload) ------> |
    |                                |-- decrypt, process
    |<-- AES-256-GCM(result) ------- |
```

The hub routes the job but never sees the plaintext. It only knows the job type, requirements, and metadata.

---

## 7. Economics

### 7.1 Compute Credits

```
1 credit = 1 minute of baseline compute (1 CPU core, 4GB RAM)

Multipliers:
  GPU work     = 4x credits
  High-trust   = 1.2x credits
  Rush priority = 2x credits
  Encrypted    = 1.1x credits
```

### 7.2 Fee Structure

```
Job cost = compute_minutes * multiplier

Distribution:
  80% → worker node
  15% → network treasury (infrastructure, development)
   5% → hub operator (if federated)
```

### 7.3 Settlement

Credits are tracked on a signed ledger. Each entry is a receipt:

```json
{
  "jobId": "abc123",
  "worker": "node-id",
  "requester": "node-id",
  "credits": 1.2,
  "workerSig": "...",
  "hubSig": "...",
  "timestamp": 1771895134107
}
```

Both parties sign. Disputes can be resolved by replaying the signed job chain.

Future: credits can be exchanged for fiat, crypto, or services outside the mesh.

---

## 8. Job Types

### 8.1 Core Types

| Type | Capability | Input | Output |
|------|-----------|-------|--------|
| `ping` | any | — | pong + node info |
| `inference` | ollama | prompt, model | response text |
| `transcribe` | whisper | audio URL | transcript text |
| `convert` | ffmpeg | media URL, format | converted media URL |
| `evaluate` | any | code, runtime | execution result |

### 8.2 Composite Jobs (Pipelines)

A pipeline chains multiple jobs:

```json
{
  "type": "pipeline",
  "steps": [
    { "type": "transcribe", "input": { "url": "video.mp4" } },
    { "type": "inference", "input": { "prompt": "Summarize: {{step.0.transcript}}" } }
  ]
}
```

Output of step N feeds into step N+1. Each step can run on a different node.

---

## 9. Wire Protocol Summary

### Messages (WebSocket)

| Direction | Type | Description |
|-----------|------|-------------|
| Node → Hub | `node.register` | Register with keypair |
| Hub → Node | `node.challenge` | Prove identity |
| Node → Hub | `node.prove` | Signed challenge response |
| Node → Hub | `node.heartbeat` | I'm alive + resource update |
| Hub → Node | `job.dispatch` | Here's a job for you |
| Node → Hub | `job.accept` | I'll take it |
| Node → Hub | `job.progress` | Status update (% complete) |
| Node → Hub | `job.result` | Done, here's the output |
| Node → Hub | `job.reject` | Can't do this right now |
| Hub → Node | `node.kick` | You've been removed (trust violation) |
| Any → Any | `mesh.announce` | Network-wide broadcast |

### HTTP Fallback

| Method | Path | Description |
|--------|------|-------------|
| POST | `/nodes/register` | Register node |
| GET | `/nodes` | List active nodes |
| POST | `/jobs` | Submit job |
| GET | `/jobs/:id` | Get job status/result |
| GET | `/jobs/available` | Poll for available jobs |
| POST | `/jobs/:id/claim` | Claim a job |
| POST | `/jobs/:id/complete` | Report completion |
| GET | `/ledger/:nodeId` | Get compute balance |
| GET | `/status` | Network status |

---

## 10. Migration from v0.1

The v0.2 protocol is backward-compatible:

1. **Phase 1**: Add key generation to client. Hub accepts both signed and unsigned requests.
2. **Phase 2**: Add WebSocket transport alongside HTTP polling.
3. **Phase 3**: Enable trust levels. Unsigned requests treated as Level 0.
4. **Phase 4**: Require signatures for job completion. HTTP polling deprecated.

Existing v0.1 nodes continue to work during the transition. They just won't earn trust.

---

## 11. Scaling

### Small (2-10 nodes)
- Single hub
- HTTP polling fine
- Trust via personal relationships
- No verification needed

### Medium (10-100 nodes)
- WebSocket required
- Automated trust/reputation
- Hash verification for new nodes
- Regional hub preference

### Large (100-10,000 nodes)
- Hub federation
- Geographic routing
- Dual-execute for untrusted
- Credit settlement periods
- Capability-based sharding (GPU hub, CPU hub, storage hub)

### Global (10,000+ nodes)
- Hierarchical hub topology
- DHT-based node discovery
- Proof of useful work as consensus mechanism
- Cross-network peering (other mesh protocols)
- The world's largest supercomputer

---

*IC Mesh Protocol v0.2 — Intelligence Club, 2026*
*"Every node strengthens the network."*
