# IC Mesh — Handler System Design

*How nodes advertise and execute arbitrary compute services.*

---

## Principles

1. **Language agnostic** — handlers are executables. Shell scripts, Python, Node, Go, Rust, whatever runs on your machine.
2. **Simple contract** — handler receives JSON on stdin, writes JSON to stdout. That's it.
3. **Operator-controlled** — you decide what handlers to register, what resources they get, and when they run.
4. **Composable** — handlers are small, focused units. Complex workflows chain multiple handlers.
5. **Safe by default** — handlers run with resource limits, timeouts, and no network access unless explicitly granted.

---

## Handler Contract

### Input

The handler receives a JSON object on **stdin**:

```json
{
  "jobId": "abc123",
  "type": "transcribe",
  "payload": {
    "url": "https://...",
    "model": "base",
    "language": "en"
  },
  "workDir": "/tmp/ic-mesh/jobs/abc123",
  "inputFiles": [
    "/tmp/ic-mesh/jobs/abc123/input/audio.m4a"
  ]
}
```

- `payload` — whatever the job submitter sent (arbitrary JSON)
- `workDir` — a temp directory the handler can use freely (cleaned up after)
- `inputFiles` — if the job included file URLs, they're pre-downloaded here

### Output

The handler writes a JSON object to **stdout**:

```json
{
  "success": true,
  "data": {
    "transcript": "Hello world...",
    "model": "base",
    "chars": 1234
  },
  "outputFiles": [
    "/tmp/ic-mesh/jobs/abc123/output/result.png"
  ]
}
```

- `success` — boolean, did the job complete
- `data` — arbitrary result data (returned to the job submitter)
- `outputFiles` — files to upload back to the hub (optional)
- If `success` is false, include an `error` string

### Error

```json
{
  "success": false,
  "error": "Whisper model not found"
}
```

### Exit Code

- `0` — success (stdout parsed as result)
- Non-zero — failure (stderr captured as error message)

---

## Handler Definition

Handlers are defined in `node-config.json`:

```json
{
  "handlers": {
    "transcribe": {
      "command": "python3 handlers/transcribe.py",
      "description": "Audio/video transcription via Whisper",
      "accepts": {
        "mimeTypes": ["audio/*", "video/*"],
        "maxInputSizeMB": 100
      },
      "resources": {
        "timeout": 600,
        "maxConcurrent": 1,
        "cpuWeight": "high",
        "requiresGPU": false
      },
      "env": {
        "WHISPER_MODEL": "base"
      }
    }
  }
}
```

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| `command` | yes | Executable to run. Receives JSON on stdin. |
| `description` | no | Human-readable description (shown in network listing) |
| `accepts.mimeTypes` | no | File types this handler can process |
| `accepts.maxInputSizeMB` | no | Max input file size (default: 50MB) |
| `resources.timeout` | no | Max execution time in seconds (default: 300) |
| `resources.maxConcurrent` | no | Max simultaneous jobs of this type (default: 1) |
| `resources.cpuWeight` | no | `low`, `medium`, `high` — for scheduling (default: medium) |
| `resources.requiresGPU` | no | Whether this handler needs GPU access |
| `env` | no | Extra environment variables passed to the handler |

---

## Handler Directory

Handlers live in the `handlers/` directory:

```
ic-mesh/
├── handlers/
│   ├── transcribe.py        — whisper transcription
│   ├── generate-image.sh    — stable diffusion via API
│   ├── inference.js         — ollama inference
│   ├── ocr.py               — tesseract OCR
│   ├── compress-video.sh    — ffmpeg compression
│   └── README.md            — how to write a handler
├── client.js
├── meshctl.js
├── node-config.json
└── ...
```

### Example: Minimal Handler (bash)

```bash
#!/bin/bash
# handlers/echo.sh — simplest possible handler
# Reads JSON from stdin, echoes it back

INPUT=$(cat)
echo "{\"success\": true, \"data\": {\"echo\": $INPUT}}"
```

### Example: Transcription Handler (Python)

```python
#!/usr/bin/env python3
"""handlers/transcribe.py — Whisper transcription handler"""

import json, sys, subprocess, os

def main():
    job = json.load(sys.stdin)
    payload = job.get("payload", {})
    work_dir = job.get("workDir", "/tmp")
    input_files = job.get("inputFiles", [])
    
    if not input_files:
        print(json.dumps({"success": False, "error": "No input file"}))
        return
    
    audio_file = input_files[0]
    model = payload.get("model", "base")
    language = payload.get("language", "en")
    output_dir = os.path.join(work_dir, "output")
    os.makedirs(output_dir, exist_ok=True)
    
    # Run whisper
    result = subprocess.run(
        ["whisper", audio_file, "--model", model, "--language", language,
         "--output_dir", output_dir, "--output_format", "txt"],
        capture_output=True, text=True, timeout=600
    )
    
    if result.returncode != 0:
        print(json.dumps({"success": False, "error": result.stderr[:500]}))
        return
    
    # Read output
    txt_files = [f for f in os.listdir(output_dir) if f.endswith(".txt")]
    transcript = ""
    if txt_files:
        with open(os.path.join(output_dir, txt_files[0])) as f:
            transcript = f.read().strip()
    
    print(json.dumps({
        "success": True,
        "data": {
            "transcript": transcript,
            "model": model,
            "language": language,
            "chars": len(transcript)
        }
    }))

if __name__ == "__main__":
    main()
```

### Example: Image Generation Handler (Node.js)

```javascript
#!/usr/bin/env node
// handlers/generate-image.js — Stable Diffusion via A1111 API

const fs = require('fs');
const path = require('path');

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const job = JSON.parse(input);
  const { payload, workDir } = job;
  
  const SD_URL = process.env.SD_URL || 'http://localhost:7860';
  
  const resp = await fetch(`${SD_URL}/sdapi/v1/txt2img`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: payload.prompt || '',
      negative_prompt: payload.negative_prompt || '',
      width: payload.width || 1024,
      height: payload.height || 1024,
      steps: payload.steps || 30,
      cfg_scale: payload.cfg_scale || 5
    })
  });
  
  const data = await resp.json();
  if (!data.images?.length) {
    console.log(JSON.stringify({ success: false, error: 'No images returned' }));
    return;
  }
  
  // Save image to output
  const outputDir = path.join(workDir, 'output');
  fs.mkdirSync(outputDir, { recursive: true });
  const imgPath = path.join(outputDir, 'generated.png');
  fs.writeFileSync(imgPath, Buffer.from(data.images[0], 'base64'));
  
  console.log(JSON.stringify({
    success: true,
    data: {
      width: payload.width || 1024,
      height: payload.height || 1024,
      prompt: payload.prompt,
      seed: data.parameters?.seed || -1
    },
    outputFiles: [imgPath]
  }));
}

main().catch(e => {
  console.log(JSON.stringify({ success: false, error: e.message }));
  process.exit(1);
});
```

### Example: OCR Handler (Python)

```python
#!/usr/bin/env python3
"""handlers/ocr.py — Tesseract OCR handler"""

import json, sys, subprocess, os

def main():
    job = json.load(sys.stdin)
    payload = job.get("payload", {})
    work_dir = job.get("workDir", "/tmp")
    input_files = job.get("inputFiles", [])
    
    if not input_files:
        print(json.dumps({"success": False, "error": "No input file"}))
        return
    
    image_path = input_files[0]
    language = payload.get("language", "eng")
    output_format = payload.get("format", "txt")
    
    # Run Tesseract OCR
    output_base = os.path.join(work_dir, "output", "ocr_result")
    os.makedirs(os.path.dirname(output_base), exist_ok=True)
    
    cmd = ["tesseract", image_path, output_base, "-l", language]
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        
        if result.returncode != 0:
            print(json.dumps({"success": False, "error": result.stderr}))
            return
        
        # Read extracted text
        with open(f"{output_base}.txt", 'r', encoding='utf-8') as f:
            text = f.read().strip()
        
        print(json.dumps({
            "success": True,
            "data": {
                "text": text,
                "language": language,
                "format": output_format,
                "character_count": len(text)
            },
            "outputFiles": [f"{output_base}.txt"]
        }))
        
    except subprocess.TimeoutExpired:
        print(json.dumps({"success": False, "error": "OCR timeout"}))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))

if __name__ == "__main__":
    main()
```

**Configuration example:**

```json
{
  "handlers": {
    "ocr": {
      "command": "python3 handlers/ocr.py",
      "description": "Optical Character Recognition via Tesseract",
      "accepts": {
        "mimeTypes": ["image/*"],
        "maxInputSizeMB": 10
      },
      "resources": {
        "timeout": 120,
        "maxConcurrent": 2,
        "cpuWeight": "medium"
      }
    }
  }
}
```

**Usage example:**

```bash
# Extract text from image
curl -X POST https://moilol.com/mesh/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "type": "ocr",
    "payload": {
      "url": "https://example.com/document.png",
      "language": "eng",
      "format": "txt",
      "confidence": true
    },
    "requirements": {"capability": "ocr"}
  }'
```

---

## Client Execution Flow

```
1. Client receives job (HTTP poll or WebSocket push)
2. Check: do we have a handler for job.type?
3. Check: are we under maxConcurrent for this handler?
4. Check: are we within resource limits (CPU, RAM)?
5. Check: is schedule allowing jobs right now?
6. Create workDir: /tmp/ic-mesh/jobs/<jobId>/
7. Download any input files to workDir/input/
8. Spawn handler process:
   - stdin:  JSON job object
   - stdout: captured for result
   - stderr: captured for logging
   - env:    handler.env + system defaults
   - cwd:    workDir
   - timeout: handler.resources.timeout
9. Parse stdout JSON as result
10. Upload any outputFiles to hub storage
11. Report result to hub
12. Clean up workDir
```

---

## Security

### Sandboxing (future)

Handlers run as the node operator's user. Future enhancements:

- **Container isolation** — run handlers in Docker/Podman containers
- **Network policy** — handlers can be denied network access (for pure compute)
- **Filesystem isolation** — handlers only see workDir, not the host filesystem
- **Resource cgroups** — enforce CPU/RAM limits at the kernel level

### Current Safety

- **Timeout enforcement** — handler killed after timeout
- **Work directory isolation** — each job gets its own temp dir
- **No ambient credentials** — handlers don't inherit node's mesh credentials
- **Operator review** — you install and configure every handler manually
- **Exit code enforcement** — non-zero exit = job failed, no result sent

---

## Handler Registry (Hub Side)

The hub maintains a directory of available handler types across the network:

```
GET /handlers → list of all handler types available on the mesh

{
  "handlers": {
    "transcribe": {
      "nodes": 3,
      "description": "Audio/video transcription",
      "accepts": ["audio/*", "video/*"]
    },
    "generate": {
      "nodes": 1,
      "description": "Image generation via Stable Diffusion",
      "accepts": []
    },
    "ocr": {
      "nodes": 2,
      "description": "Optical character recognition",
      "accepts": ["image/*"]
    }
  }
}
```

This lets job submitters discover what the mesh can do without knowing about individual nodes.

---

## Writing a New Handler

1. Create a script in `handlers/` (any language)
2. Make it executable: `chmod +x handlers/my-handler.sh`
3. It must read JSON from stdin, write JSON to stdout
4. Register it in `node-config.json` under `handlers`
5. Restart the client

That's it. Your handler is now a service on the mesh.

---

## Built-in Handlers (Shipped with ic-mesh)

| Handler | File | Description |
|---------|------|-------------|
| `ping` | (built-in) | Health check, always available |
| `transcribe` | `handlers/transcribe.sh` | Whisper transcription |
| `generate` | `handlers/generate-image.js` | Stable Diffusion image gen |
| `inference` | `handlers/inference.js` | Ollama LLM inference |
| `ffmpeg` | `handlers/ffmpeg.sh` | Generic ffmpeg processing |
| `ocr` | `handlers/ocr.py` | Optical Character Recognition via Tesseract |
| `pdf-extract` | `handlers/pdf-extract.py` | PDF text extraction with table support |

These ship as examples. Operators can modify, disable, or replace them.

### Configuration Examples

**PDF Text Extraction:**
```json
{
  "handlers": {
    "pdf-extract": {
      "command": "python3 handlers/pdf-extract.py",
      "description": "Extract text, tables, and metadata from PDF documents",
      "accepts": {
        "mimeTypes": ["application/pdf"],
        "maxInputSizeMB": 50
      },
      "resources": {
        "timeout": 300,
        "maxConcurrent": 2,
        "cpuWeight": "medium"
      }
    }
  }
}
```

**OCR with Custom Configuration:**
```json
{
  "handlers": {
    "ocr": {
      "command": "python3 handlers/ocr.py",
      "description": "OCR text extraction with multi-language support",
      "accepts": {
        "mimeTypes": ["image/*", "application/pdf"],
        "maxInputSizeMB": 25
      },
      "resources": {
        "timeout": 120,
        "maxConcurrent": 3
      },
      "env": {
        "TESSERACT_LANG": "eng+fra+deu"
      }
    }
  }
}
```

---

*IC Mesh Handler System — v0.4*
*"Any script. Any language. Any service."*
