# IC Mesh — Declarative Handler Spec v1.1

A handler is a YAML file in the `handlers/` directory that declares a compute capability a node can offer to the mesh network.

## Design Principles

- **Drop a file, get a capability.** No code changes to add new services.
- **Proof, not claims.** Benchmarks validate that a node can actually do what it declares.
- **Data before optimization.** Collect benchmark data first, build smart routing from evidence.
- **Private hubs are first-class.** The protocol works identically on LAN and public internet.
- **Backward compatible.** Old clients sending string arrays still work.

---

## File Location

```
ic-mesh/
  handlers/
    whisper.yaml
    ollama.yaml
    stable-diffusion.yaml
    comfyui.yaml
    tesseract.yaml
    custom-service.yaml    # operator-defined
```

The client scans `handlers/` on startup. Each `.yaml` file = one capability declaration.

---

## Handler Schema

```yaml
# === Identity ===
capability: whisper                    # Primary capability name (required)
namespace: whisper.cpp                 # Namespace for disambiguation at scale
aliases: [transcription, transcribe, stt]  # Alternative names the hub may use
version: "1.7.2"                       # Software version string
description: "Speech-to-text via whisper.cpp"

# === Detection ===
# How the client determines if this capability is available on the node.
# All specified conditions must pass. If detect is omitted, capability is always registered.
detect:
  binary: whisper-cli                  # Check `which <binary>` succeeds
  fallback_binaries: [whisper, whisper-cpp]  # Try these if primary not found
  probe_cmd: "whisper-cli --version"   # Run command, success = exit 0
  probe_url: null                      # HTTP 200 check (for services like SD, ComfyUI)
  fallback_urls: []                    # Try these if primary URL fails
  files:                               # Check these paths exist
    - /usr/local/bin/whisper-cli
  env:                                 # Check these env vars are set
    - WHISPER_MODEL_DIR

# === Models ===
# Discover available models. Sent to hub for routing decisions.
models:
  scan_dirs:                           # Directories to scan for model files
    - ~/.cache/whisper
    - ~/Library/Caches/whisper
    - /usr/local/share/whisper/models
  pattern: "ggml-*.bin"                # Glob pattern for model files
  parse_name: "ggml-(?<name>[^.]+)"   # Regex to extract model name (JS named groups)
  list_cmd: null                       # Alternative: run command, one model per line
  list_url: null                       # Alternative: HTTP GET, parse JSON response
  parse_json: null                     # jq-like path for list_url response

# === Invocation ===
# How to execute a job of this type.
invoke:
  cmd: "whisper-cli -m {model_path} -f {input} --no-timestamps -t {threads} -otxt"
  shell: true                          # Run via bash -c (default: true)
  stdin: json                          # What to pipe to stdin: json | none | raw
  output: stdout                       # Where to read result: stdout | file | json
  output_file: "{output_dir}/output.txt"  # If output=file, read from here
  result_type: text                    # Result format: text | json | binary
  env:                                 # Extra env vars for invocation
    WHISPER_THREADS: "{threads}"

# === Resources ===
# Resource requirements and limits for this handler.
resources:
  timeout: 600                         # Max seconds per job (default: 300)
  max_input_mb: 500                    # Max input file size
  min_ram_mb: 2048                     # Minimum free RAM to accept jobs
  gpu_required: false                  # Require GPU
  gpu_backends: [metal, cuda]          # Accepted GPU backends (if gpu_required)
  concurrent: 1                        # Max concurrent jobs of this type

# === Benchmark ===
# Proof-of-capability. See "Benchmark Protocol" section below.
benchmark:
  reference_url: "https://hub/probe/whisper-5sec.wav"
  expected_output: "the quick brown fox jumps over the lazy dog"
  match_threshold: 0.7                 # Levenshtein similarity threshold
  timeout: 30                          # Max seconds for benchmark run

# === Shared Storage ===
# Declare shared filesystem access for storage-aware routing.
storage:
  mounts:
    - id: truenas-tank                 # Storage pool identifier
      path: /mnt/tank/data             # Local mount path
      type: nfs                        # nfs | smb | local
      writable: true

# === Pricing ===
# Optional operator-level pricing hints.
pricing:
  multiplier: 1.0                      # Operator's price multiplier
  min_ints: 1                          # Minimum charge in ints
  rate_per_second: 1                   # Ints per compute-second
```

---

## Template Variables

Available in `invoke.cmd` and `invoke.env`:

| Variable | Description |
|----------|-------------|
| `{input}` | Path to downloaded input file |
| `{output_dir}` | Temporary output directory |
| `{model_path}` | Full path to selected model file |
| `{model_name}` | Model name (e.g., "large-v3-turbo") |
| `{threads}` | Recommended thread count (CPU cores - 1) |
| `{job_id}` | Unique job identifier |
| `{job_type}` | Job type string |

---

## Namespacing

At scale, two operators may both define a `transcribe` capability that works differently. Namespaced identifiers prevent collisions:

- `whisper.cpp/transcribe` vs `openai/transcribe`
- `a1111/generate-image` vs `comfyui/generate-image`

**Resolution order:**
1. Exact match: `whisper.cpp/transcribe` → only nodes with that namespace
2. Capability match: `transcribe` → any node with `transcribe` in capabilities or aliases
3. Alias match: `stt` → resolved via alias map to `whisper`

The `namespace` field in the YAML plus the existing `aliasCapability()` function on the hub handle this. Backward compatible — unnamespaced requests match any provider.

---

## Benchmark Protocol

A single benchmark on registration is misleading — a cold Metal shader cache on M1 runs 3x slower than warm. Benchmarks must be rolling, not point-in-time.

### How It Works

1. **Hub holds reference inputs** per capability type (e.g., a 5-second WAV for whisper)
2. **On registration**, hub sends a benchmark job to the node
3. **Node runs it** using the handler's `benchmark:` block, returns output + timing
4. **Hub validates** output against `expected_output` using fuzzy match (Levenshtein ≥ `match_threshold`)
5. **Hub stores the sample** in a rolling window per node per capability
6. **Periodic re-benchmark** on heartbeat (every N checkins) to track drift

### Benchmark Data Structure

Per node, per capability:

```json
{
  "nodeId": "9b6a3b5841dc2890",
  "capability": "whisper",
  "status": "benchmarked",
  "samples": [
    {
      "rtf": 13.2,
      "latency_ms": 380,
      "passed": true,
      "warm": true,
      "timestamp": 1772228000000
    }
  ],
  "stats": {
    "p50_rtf": 12.8,
    "p95_rtf": 14.1,
    "sample_count": 15,
    "last_updated": 1772228000000
  }
}
```

### Benchmark Status

| Status | Criteria | Meaning |
|--------|----------|---------|
| `benchmarking` | < 3 samples | Not enough data. Don't trust RTF. |
| `benchmarked` | 3+ samples, last < 24h | Reliable data. Use for routing. |
| `stale` | Last sample > 24h old | Was reliable, needs refresh. |
| `failed` | Last benchmark didn't pass | Node may be degraded. |

### Confidence Mapping

The `/estimate` endpoint's `confidence` field maps directly to benchmark status:

- **high**: 10+ samples, most recent < 6h, low variance (p95/p50 < 1.5)
- **medium**: 3-9 samples, most recent < 24h
- **low**: 1-2 samples, or stale, or high variance
- **none**: No benchmark data for this capability on any available node

---

## Estimate Endpoint

```
POST /estimate
{
  "capability": "whisper",
  "duration_seconds": 3600,     # Input duration (primary factor for compute time)
  "file_size_mb": 450,          # File size (for transfer time estimation — separate concern)
  "model": "large-v3-turbo",    # Optional: specific model preference
  "affinity_key": "project-123" # Optional: prefer same node as previous jobs
}
```

**Response:**

```json
{
  "estimates": [
    {
      "nodeId": "9b6a3b5841dc2890",
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

**Key design decisions:**
- `duration_seconds` is the primary input, not file size. RTF × duration = compute time. File size is a weak proxy — a quiet lecture transcribes 4x faster than dense multi-speaker audio at the same file size.
- `file_size_mb` is for transfer time only. Separate concern, separate field.
- Returns estimates for ALL capable nodes, sorted by total time. Caller decides whether to wait for a better node.
- `confidence` maps directly to benchmark status (see above).

---

## Job Affinity

When processing batch workloads (20 files from the same project), routing every job independently wastes warm caches, hot VRAM, and mounted storage.

### How It Works

1. Jobs carry an optional `affinity_key` in their payload
2. Hub maintains a lightweight map: `affinity_key → { nodeId, last_seen, job_count }`
3. When routing, same-key jobs get a scoring bonus for the affiliated node
4. Falls back to normal routing if the affiliated node is busy, dead, or overloaded
5. Map entries expire after TTL (default: 30 minutes of inactivity)

### Affinity in Job Payload

```json
{
  "type": "transcribe",
  "payload": {
    "url": "https://...",
    "affinity_key": "project-meeting-recordings-2026"
  }
}
```

**No cluster state, no coordination — just a preference hint.** The hub doesn't guarantee affinity, it just prefers it when possible.

---

## Smart Routing (Future — After Benchmark Data Collection)

**Not building this yet.** Collecting benchmark data for ~1 week first, then validating the routing function against what actually happened vs what it would have chosen.

### Planned Routing Order

For each capable node, compute a weighted score:

1. **Can it do the job?** (capability match — binary gate, not scored)
2. **Current load** — a faster node at 90% capacity loses to a slower node at 10%
3. **Shared storage proximity** — eliminates transfer time entirely; often bigger than RTF difference
4. **RTF** — only the tiebreaker between comparably-loaded nodes
5. **Reliability score** — long-term tiebreaker

**Duration-aware weighting:** The relative importance of these factors changes with job size:
- Short jobs (< 30s): transfer overhead dominates → storage proximity weighted higher
- Long jobs (> 10min): compute time dominates → RTF weighted higher

### Reliability — Three Separate Signals

Not a single opaque score. Three independently stored, independently debuggable signals:

| Signal | Definition | Catches |
|--------|-----------|---------|
| `completion_rate` | Jobs claimed ÷ jobs successfully completed | Crashes mid-job |
| `accuracy_rate` | Benchmark outputs matching expected | Degraded nodes |
| `latency_consistency` | p95 RTF ÷ p50 RTF ratio | Thermal throttling, noisy neighbors |

Combined at routing time with explicit, tunable weights. "This node was deprioritized because `completion_rate=0.7`" is actionable. "reliability=0.6" is not.

---

## Private Hubs

ic-mesh supports running a private hub instance for local-only clusters. The protocol between client and hub is the same regardless of deployment mode.

### Deployment Modes

| Mode | Use Case |
|------|----------|
| **Public hub** | `moilol.com/mesh` — internet-accessible, multi-operator |
| **Private hub** | `192.168.1.100:8333` — LAN-only, single-operator cluster |
| **Federated** (future) | Private hub peers with public hub for overflow routing |

### Running a Private Hub

```bash
cd ic-mesh
IC_MESH_PORT=8333 node server.js
```

Nodes point to it:
```bash
IC_MESH_SERVER=http://192.168.1.100:8333 node client.js
```

### Design Constraints

- No features that assume moilol.com is the only hub
- No hardcoded public URLs in routing logic
- YAML handler specs travel with the node, not the hub
- A node moving between hubs brings its capabilities with it
- Authentication is hub-level config, not protocol-level assumption

Federation (public↔private hub peering) is a future layer, not a v1 requirement.

---

## Lifecycle

1. **Startup**: Client scans `handlers/` for `.yaml` files
2. **Detection**: For each handler, runs detection checks. Only detected handlers register.
3. **Models**: Scans model directories, builds model list
4. **Registration**: Sends structured capability manifests to hub
5. **Benchmark**: Hub sends benchmark jobs. Node runs them. Hub stores rolling results.
6. **Job dispatch**: Job arrives → hub checks affinity → finds capable nodes → (future: scores them) → dispatches
7. **Execution**: Client uses YAML invoke spec to run the job
8. **Result**: Output captured per `output` config, returned to hub with timing data

---

## Adding a New Capability

1. Create `handlers/my-service.yaml`
2. Restart client (or wait for next heartbeat rescan)
3. Client auto-detects, registers rich manifest with hub
4. Hub validates capability via benchmark
5. Hub can now route jobs with `requirements: { capability: "my-service" }` to your node

No code changes. No PRs. Drop a file.

---

## Backward Compatibility

- Old clients sending string capability arrays still work — hub wraps them as `{ capability: "name" }`
- Old hub accepting string arrays still works — client sends both formats based on hub version
- Built-in handlers (hardcoded in client.js) remain as fallbacks if no YAML exists
- Unnamespaced job requests match any provider of that capability

---

## Implementation Status

### ✅ Built (v1.0)
- Handler YAML loader (`lib/handler-loader.js`)
- Detection (binary, probe_cmd, HTTP, files, env)
- Model discovery (dir scan + regex, CLI command)
- Rich manifest registration (client → hub)
- Hub stores manifests column
- YAML-based job execution (template vars, stdin/stdout/file)
- 3-tier fallback: YAML → config → built-in
- Dynamic job type validation on hub
- 5 reference handlers (whisper, ollama, sd, comfyui, tesseract)

### 🔨 Next (v1.1)
- Benchmark protocol + rolling data collection
- Estimate endpoint (`POST /estimate`)
- Job affinity (`affinity_key`)

### 📊 After Data Collection (~1 week)
- Smart routing with weighted scoring
- Reliability signals (completion_rate, accuracy_rate, latency_consistency)
- Duration-aware weight adjustment

### 🗺️ Future
- Private hub documentation + deployment guide
- Hub federation (public↔private peering)
- Hot-reload: rescan handlers without restart
- Namespace resolution in alias map
- Benchmark reference file hosting on hub
