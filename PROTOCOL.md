# IC Mesh Protocol v2.0

_A protocol for distributed compute, storage, and services — negotiated by machines, for machines._

---

## Design Principles

1. **Primitive composition.** Six objects compose into everything: Node, Resource, Deal, Job, Proof, Reputation.
2. **Drop a file, get a capability.** Handler YAML specs declare what a node can do. No code changes.
3. **Proof, not claims.** Benchmarks validate capabilities. Reputation is computed from evidence.
4. **Data before optimization.** Collect benchmark data first, build smart routing from evidence.
5. **Private hubs are first-class.** The protocol works identically on LAN and public internet.
6. **No blockchain. No token.** Trust comes from identities, escrow, proofs, and reputation.
7. **Incremental adoption.** Old clients work. New features are additive, not breaking.

---

## 1. Primitives

### 1.1 Node

A machine participating in the network.

```
Node {
  id: string              # Unique, persistent (stored in .node-id)
  name: string            # Human-readable (hostname)
  owner: string           # Operator identity
  pubkey: ed25519?        # Identity verification (future)
  capabilities: string[]  # What it can do (from handler YAML + auto-detect)
  manifests: {}           # Rich capability declarations (from handler YAML)
  resources: {            # What it has
    cpuCores, ramMB, ramFreeMB, cpuIdle,
    gpuVRAM, diskFreeGB
  }
  storage_pools: []       # Shared storage mounts (from handler YAML)
  region: string          # Network topology hint
  status: online|offline  # Derived from lastSeen
}
```

**Current implementation:** `nodes` table in SQLite. Registration via `POST /nodes/register`. Rich manifests sent from handler YAML scan.

### 1.2 Resource

Something a node offers to the network. Currently implicit (flat fields on Node); moving toward typed first-class objects.

```
Resource {
  type: compute|storage|bandwidth|memory|gpu
  capability: string      # Links to handler YAML capability name
  capacity: number        # How much available
  unit: string            # ints/second, GB, Mbps
  price_ints: number      # Ints per unit per time period
  constraints: {
    min_contract_seconds,  max_contract_seconds,
    availability_windows, concurrent_limit
  }
  benchmark: {}           # Performance data from Proofs
}
```

**Current implementation:** Resources reported as flat fields in node registration. Handler YAML `resources:` block defines per-capability constraints. Not yet a separate table.

### 1.3 Deal

An agreement between two parties about resource usage over time. The SLA primitive.

```
Deal {
  id: string
  provider: node_id
  consumer: string        # node_id, hub_id, or account email
  resource_type: string   # capability name
  terms: {
    duration_seconds: number
    capacity: number
    price_per_unit_ints: number
    total_price_ints: number
    availability: number        # Required uptime (e.g., 0.99)
    penalty_ints: number        # Collateral forfeited on breach
    renewal: auto|manual|none
    notice_period_seconds: number
  }
  state: proposed|accepted|active|completed|breached|terminated
  provider_sig: string?
  consumer_sig: string?
  created_at: timestamp
  activated_at: timestamp?
  expires_at: timestamp
}
```

**Current implementation:** Not yet built. Schema defined, implementation in Phase 2.

### 1.4 Job

A unit of work to be executed. Short-lived (seconds to hours).

```
Job {
  id: string
  type: string              # Capability required
  payload: {}               # Input data or reference
  requirements: {
    capability: string
    model: string?
    min_ram_mb: number?
    affinity_key: string?   # Prefer same node as previous jobs with this key
    storage_pool: string?   # Prefer nodes with this shared storage
  }
  budget_ints: number?      # Max willing to pay (future)
  deadline: timestamp?      # Must complete by (future)
  deal_id: string?          # If this job is under a Deal
  state: pending|claimed|running|completed|failed
  claimed_by: node_id?
  result: {}?
  compute_ms: number?
  created_at: timestamp
}
```

**Current implementation:** `jobs` table with full lifecycle. Missing: `affinity_key` in requirements, `budget_ints`, `deadline`, `deal_id`.

### 1.5 Proof

Evidence that a node performed work or holds a resource. The trust primitive.

```
Proof {
  id: string
  type: benchmark|completion|storage|uptime
  node_id: string
  capability: string
  evidence: {
    input_hash: string?       # What was the input
    output_hash: string?      # What was produced  
    output_sample: string?    # Snippet for validation
    duration_ms: number       # How long it took
    rtf: number?              # Realtime factor (for transcription etc)
    warm: boolean             # Was the node warmed up
    passed: boolean           # Did output match expected
    verified_by: string?      # Who checked it (hub or peer)
  }
  timestamp: number
}
```

**Current implementation:** Not yet built. Benchmark block defined in handler YAML. Implementation in this PR.

### 1.6 Reputation

Derived from Proofs. Not stored as a single number — computed from three separate signals.

```
Reputation(node, capability) {
  completion_rate: number     # Jobs completed / jobs claimed (catches crashes)
  accuracy_rate: number       # Benchmark passes / benchmark attempts (catches degradation)
  latency_consistency: number # p95_rtf / p50_rtf ratio (catches throttling/noisy neighbors)
  
  # Long-term deal signals (Phase 2)
  uptime: number              # Actual vs promised availability
  deal_honor_rate: number     # Deals completed vs deals breached
  
  # Metadata
  sample_count: number
  last_updated: timestamp
  confidence: high|medium|low|none
}
```

**Current implementation:** `ledger` table tracks earned/spent/jobs. `node_health_scores` exists. Not yet computed from proofs.

---

## 2. Handler Declaration (YAML Spec)

Operators declare capabilities by dropping YAML files in `handlers/`. See individual handler files for examples.

### File Location

```
ic-mesh/handlers/
  whisper.yaml          # Speech-to-text
  ollama.yaml           # LLM inference
  stable-diffusion.yaml # Image generation
  comfyui.yaml          # Node-based workflows
  tesseract.yaml        # OCR
  custom.yaml           # Operator-defined
```

### Schema

```yaml
capability: whisper                      # Required: primary name
namespace: whisper.cpp                   # Optional: disambiguation at scale
aliases: [transcription, transcribe]     # Alternative names
version: "1.7.2"                         # Software version
description: "Speech-to-text"

detect:                                  # How to check if available
  binary: whisper-cli
  fallback_binaries: [whisper]
  probe_cmd: "whisper-cli --version"
  probe_url: null
  fallback_urls: []
  files: []
  env: []

models:                                  # Discover available models
  scan_dirs: [~/.cache/whisper]
  pattern: "ggml-*.bin"
  parse_name: "ggml-(?<name>.+)\\.bin"
  list_cmd: null

invoke:                                  # How to execute jobs
  cmd: "whisper-cli -m {model_path} -f {input} -t {threads} -otxt"
  shell: true
  stdin: json|none|raw
  output: stdout|file|json
  output_file: "{input}.txt"
  result_type: text|json|binary
  env: {}

resources:                               # Limits and requirements
  timeout: 600
  max_input_mb: 500
  min_ram_mb: 1024
  gpu_required: false
  gpu_backends: [metal, cuda]
  concurrent: 1

benchmark:                               # Proof-of-capability test
  expected_output: "the quick brown fox"
  match_threshold: 0.7
  timeout: 30

storage:                                 # Shared filesystem access
  mounts:
    - id: truenas-tank
      path: /mnt/tank/data
      type: nfs
      writable: true

pricing:                                 # Operator pricing hints
  multiplier: 1.0
  min_ints: 1
  rate_per_second: 1
```

### Template Variables

| Variable | Description |
|----------|-------------|
| `{input}` | Path to downloaded input file |
| `{output_dir}` | Temporary output directory |
| `{model_path}` | Full path to selected model file |
| `{model_name}` | Model name |
| `{threads}` | CPU cores - 1 |
| `{job_id}` | Job identifier |
| `{job_type}` | Job type string |

### Execution Priority

1. **YAML handler spec** (declarative, in `handlers/`)
2. **node-config.json handler** (legacy config format)
3. **Built-in handler** (hardcoded in client.js)

### Namespacing

At scale: `whisper.cpp/transcribe` vs `openai/transcribe`. Backward compatible — unnamespaced requests match any provider.

---

## 3. Benchmark Protocol

### Purpose

Prove that a node can actually do what it declares, and measure how fast.

### Flow

1. Node registers with hub, sends capability manifests
2. Hub checks: does this capability have a benchmark spec?
3. If yes and no recent benchmark exists: hub submits a `_benchmark` job to that node
4. Node executes using handler YAML's `benchmark:` block
5. Node returns: output text + duration_ms
6. Hub validates output against `expected_output` (fuzzy match, Levenshtein ≥ threshold)
7. Hub stores result as a Proof in the `benchmarks` table
8. Periodic re-benchmark on heartbeat (every N checkins, configurable)

### Rolling Window

A single cold benchmark misleads (M1 Max with cold Metal shader cache = 3x slower than warm).

Per node, per capability:

```json
{
  "node_id": "9b6a3b5841dc2890",
  "capability": "whisper",
  "status": "benchmarked",
  "samples": [
    { "rtf": 13.2, "duration_ms": 380, "passed": true, "warm": true, "ts": 1772228000000 },
    { "rtf": 4.1, "duration_ms": 1219, "passed": true, "warm": false, "ts": 1772200000000 }
  ],
  "p50_rtf": 12.8,
  "p95_rtf": 14.1,
  "sample_count": 15,
  "last_updated": 1772228000000
}
```

### Benchmark Status

| Status | Criteria | Confidence |
|--------|----------|------------|
| `new` | 0 samples | none |
| `benchmarking` | 1-2 samples | low |
| `benchmarked` | 3+ samples, last < 24h | medium-high |
| `stale` | Last sample > 24h | low |
| `failed` | Last benchmark didn't pass | none |

### Benchmark Reference Files

Hub hosts small reference inputs per capability type:
- `whisper`: 5-second WAV clip ("the quick brown fox jumps over the lazy dog")
- `tesseract`: Simple image with known text
- `ollama`: Standard prompt with expected response pattern
- Others: defined in handler YAML `benchmark:` block

---

## 4. Job Lifecycle

### Current Flow (v1)

```
Submit → Pending → [Hub matches to capable node] → Claimed → Running → Completed/Failed
                                                                          ↓
                                                                    [If failed: re-queue or refund]
```

### Enhanced Flow (v2)

```
Submit (with affinity_key, budget, deadline)
  → Pending
  → [Hub scores nodes: capability → load → storage → RTF → reliability]
  → [Affinity bonus for matching nodes]
  → Dispatched to best node
  → Claimed
  → Running (progress reported via heartbeat)
  → Completed (Proof generated, reputation updated)
  OR
  → Failed (auto-refund, Proof of failure, reputation dinged)
```

### Affinity

Jobs with the same `affinity_key` prefer the same node:
- Hub maintains `affinity_key → { nodeId, last_seen, job_count }` map
- Same-key jobs get scoring bonus for affiliated node
- TTL: 30 minutes of inactivity
- Falls back to normal routing if affiliated node is busy/dead

---

## 5. Estimate Endpoint

```
POST /estimate
{
  "capability": "whisper",
  "duration_seconds": 3600,     # Primary input for compute time
  "file_size_mb": 450,          # For transfer time estimation (separate concern)
  "model": "large-v3-turbo",
  "affinity_key": "project-123"
}

Response:
{
  "estimates": [
    {
      "node_id": "9b6a3b5841dc2890",
      "node_name": "frigg",
      "estimated_compute_seconds": 273,
      "estimated_transfer_seconds": 12,
      "estimated_total_seconds": 285,
      "confidence": "high",
      "benchmark_samples": 15,
      "p50_rtf": 13.2,
      "has_shared_storage": false,
      "current_load": 0.1,
      "affinity_match": true
    }
  ],
  "best_node": "9b6a3b5841dc2890",
  "estimated_cost_ints": 273
}
```

---

## 6. Deal Lifecycle (Phase 2)

### Negotiation Protocol

```
PUBLISH_ASK    → Provider announces: "I have X at price Y with terms Z"
PUBLISH_DEMAND → Consumer announces: "I need X with budget Y and requirements Z"
MATCH          → Hub finds compatible asks/demands
PROPOSE_DEAL   → One party sends specific terms
COUNTER        → Other party modifies terms
ACCEPT         → Both sign
ACTIVATE       → Collateral locked, work begins
PROVE          → Ongoing evidence of fulfillment
SETTLE         → Payment released, collateral returned, reputation updated
```

### Deal Types

| Type | Duration | Example |
|------|----------|---------|
| **Spot** | Seconds-minutes | Transcribe this file (current jobs) |
| **Reserved** | Hours-days | Keep llama-70b loaded in VRAM for 2 hours |
| **Contract** | Days-months | Store 500GB at 99.9% uptime for 30 days |

### Escrow

Hub-held, like Stripe. Both parties' ints are locked when deal activates. No blockchain needed.

---

## 7. Smart Routing (After Data Collection)

### Scoring Function

For each capable node, compute weighted score:

1. **Capability match** — binary gate (pass/fail)
2. **Current load** — `score -= load_pct * W_load`
3. **Shared storage** — `score += W_storage` if node has job's storage pool
4. **RTF** — `score += (1/rtf) * W_rtf` (faster = higher)
5. **Reliability** — `score += reliability * W_reliability`
6. **Affinity** — `score += W_affinity` if affinity_key matches

**Duration-aware weights:**
- Short jobs (< 30s): `W_storage = 0.4, W_rtf = 0.1`
- Long jobs (> 10min): `W_storage = 0.1, W_rtf = 0.4`

### Reliability Signals

| Signal | Formula | Catches |
|--------|---------|---------|
| `completion_rate` | completed / claimed | Crashes mid-job |
| `accuracy_rate` | benchmark passes / attempts | Degraded nodes |
| `latency_consistency` | p95_rtf / p50_rtf | Thermal throttling |

---

## 8. Private Hubs

The protocol works identically on LAN and internet.

```bash
# Run a private hub
IC_MESH_PORT=8333 node server.js

# Point nodes to it
IC_MESH_SERVER=http://192.168.1.100:8333 node client.js
```

### Federation (Future)

Private hubs peer with public hubs for overflow routing. Like BGP autonomous systems — each hub makes local routing decisions, no central coordinator.

---

## 9. Trust Model

### Without Blockchain

| Threat | Defense |
|--------|---------|
| Lying about capabilities | Benchmarks (Proof) |
| Failing to deliver | Completion tracking (Reputation) |
| Disappearing mid-deal | Collateral escrow (Deal) |
| Slow degradation | Rolling benchmark windows (Proof) |

### Escrow

Hub holds ints for active deals. Like Stripe — a trusted intermediary. If hub trust is the concern: federation means no single hub is God.

---

## 10. Backward Compatibility

- Old clients sending string capability arrays → hub wraps as `{ capability: "name" }`
- Old hub accepting string arrays → client sends both formats
- Built-in handlers remain as fallbacks
- Unnamespaced requests match any provider
- Jobs without affinity_key, budget, deadline work exactly as before

---

## Implementation Status

### ✅ Built
- Node registration with rich manifests
- Handler YAML loader + detection + model discovery + execution
- Job lifecycle (submit → claim → complete/fail)
- 3-tier handler fallback (YAML → config → built-in)
- Dynamic job type validation
- Revenue split (80/15/5)
- Founding operator tracking
- 5 reference handler YAMLs

### 🔨 This Release
- Benchmarks table + rolling window storage
- Benchmark-on-registration flow
- Estimate endpoint
- Job affinity (affinity_key)

### 📊 After 1 Week Data Collection
- Smart routing with weighted scoring
- Reliability signal computation
- Duration-aware weight adjustment

### 🗺️ Phase 2 (Month 2)
- Deals table + propose/accept/activate/settle
- Escrow against ints balance
- Storage deals with periodic proof challenges
- Ask/Demand publishing

### 🗺️ Phase 3 (Month 3)
- Agent-to-agent negotiation protocol
- Hub federation (peering)
- Ed25519 node identity

### 🗺️ Phase 4+ 
- DHT-based discovery (no central hub required)
- Market-driven pricing
- Agents negotiating infrastructure autonomously
