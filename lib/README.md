# IC Mesh Library

Core library functions for the Intelligence Club mesh network.

## Modules

### `handler-runtime.js`
Handler execution runtime for processing mesh jobs. Provides sandboxed execution environment for custom handlers with:

- **Process management** — Spawn, monitor, and clean up handler processes
- **Resource limits** — CPU, RAM, and file size constraints  
- **Timeout handling** — Configurable job timeouts with graceful termination
- **Output capture** — Stream job output and results
- **Error isolation** — Prevent handler failures from crashing the mesh node

Key functions:
- `runHandler(type, payload, config)` — Execute a handler with given payload
- `killJob(jobId)` — Force terminate a running job
- `getSystemInfo()` — Get node resource usage and capabilities

### `storage.js`
Unified storage abstraction supporting multiple backends:

- **Local filesystem** — Store files on local disk
- **DigitalOcean Spaces** — S3-compatible object storage
- **Automatic failover** — Fall back to local storage if cloud fails

Key functions:
- `uploadFile(buffer, filename, mimeType)` — Upload file to configured storage
- `getStorageInfo()` — Get storage configuration and status
- `generateSignedUrl(filename)` — Create temporary download URLs

Storage is configured via environment variables:
```bash
DO_SPACES_KEY=your_access_key
DO_SPACES_SECRET=your_secret_key
DO_SPACES_BUCKET=your_bucket
DO_SPACES_REGION=your_region
```

## Usage

These modules are used internally by the mesh client and server. They provide the core functionality for:

1. **Job execution** — Running AI inference, image generation, and transcription
2. **File management** — Handling uploads, downloads, and temporary files
3. **Resource monitoring** — Tracking CPU, RAM, and disk usage
4. **Node capabilities** — Determining what types of jobs a node can handle

## Handler Types

The runtime supports these built-in handlers:

- **`inference`** — LLM text generation via Ollama
- **`whisper`** — Audio transcription via Whisper
- **`image-gen`** — Image generation via Stable Diffusion API
- **`custom`** — User-defined handlers via shell commands

## Security

- All handlers run in isolated processes
- Resource limits prevent runaway jobs
- File system access is controlled
- Network access can be restricted per handler

---

*This library powers the distributed compute network for Intelligence Club services.*