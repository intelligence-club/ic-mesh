# IC Mesh — Declarative Handler Spec v1.0

A handler is a YAML file in the `handlers/` directory that declares a compute capability a node can offer to the mesh network.

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

## Schema

```yaml
# === Identity ===
capability: whisper                    # Primary capability name (required)
namespace: whisper.cpp                 # Optional namespace for disambiguation
aliases: [transcription, transcribe, stt]  # Alternative names the hub may use
version: "1.7.2"                       # Software version string
description: "Speech-to-text via whisper.cpp"

# === Detection ===
# How the client determines if this capability is available on the node.
# All conditions must pass. If detect is omitted, capability is always registered.
detect:
  binary: whisper-cli                  # Check `which <binary>` succeeds
  probe_cmd: "whisper-cli --version"   # Run command, success = exit 0
  probe_url: null                      # HTTP 200 check (for services like SD, ComfyUI)
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
  parse_name: "ggml-(?<name>[^.]+)"   # Regex to extract model name from filename (JS named groups)
  list_cmd: null                       # Alternative: run command, one model per line

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
# Proof-of-capability test. Hub sends reference input, validates output + timing.
# Run on registration and periodically on heartbeat.
benchmark:
  reference_url: "https://hub/probe/whisper-5sec.wav"  # Hub provides this
  expected_output: "the quick brown fox"  # Fuzzy match against transcription
  match_threshold: 0.8                 # Levenshtein similarity threshold
  timeout: 30                          # Max seconds for benchmark
  # Results stored: { rtf: 13.2, latency_ms: 380, passed: true, timestamp: ... }

# === Shared Storage ===
# Declare shared filesystem access for storage-aware routing.
storage:
  mounts:                              # Shared storage this handler can access
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

## How It Works

1. **Startup**: Client scans `handlers/` for `.yaml` files
2. **Detection**: For each handler, runs detection checks. Only detected handlers are registered
3. **Models**: Scans model directories, builds model list
4. **Registration**: Sends structured capability manifests to hub (not just string names)
5. **Benchmark**: If hub requests proof, client runs benchmark using the spec
6. **Job dispatch**: When job arrives matching this capability, client uses `invoke` to run it
7. **Result**: Output captured per `output` config, returned to hub

## Backward Compatibility

- Old clients sending string capability arrays still work — hub wraps them as `{ capability: "whisper" }`
- Old hub accepting string arrays still works — client can send both formats based on hub version
- Built-in handlers (hardcoded in client.js) remain as fallbacks if no YAML exists

## Adding a New Capability

1. Create `handlers/my-service.yaml`
2. Restart client (or wait for next heartbeat)
3. Client auto-detects, registers with hub
4. Hub can now route jobs with `requirements: { capability: "my-service" }` to your node

No code changes. No PRs. Drop a file.
