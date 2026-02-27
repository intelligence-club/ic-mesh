# IC Mesh Handler Development Guide

A handler is any executable that reads JSON from stdin and writes JSON to stdout. Handlers are the compute engines of the IC Mesh - they process jobs submitted to the network.

## Quick Start

### Minimal Example (bash)
```bash
#!/bin/bash
INPUT=$(cat)
echo '{"success": true, "data": {"message": "hello from my handler"}}'
```

### Simple Echo Handler (Python)
```python
#!/usr/bin/env python3
import json
import sys

# Read input from stdin
input_data = json.load(sys.stdin)

# Process the job
result = {
    "success": True,
    "data": {
        "message": f"Processed job {input_data['jobId']}",
        "payload": input_data.get("payload", {})
    }
}

# Write result to stdout
json.dump(result, sys.stdout)
```

## Handler Contract

### Input Format (stdin)
Every handler receives this JSON structure via stdin:

```json
{
  "jobId": "abc123",
  "type": "my-handler", 
  "payload": {
    "user_param1": "value1",
    "user_param2": "value2"
  },
  "workDir": "/tmp/ic-mesh/jobs/abc123",
  "inputFiles": ["/tmp/ic-mesh/jobs/abc123/input/audio.wav"],
  "outputDir": "/tmp/ic-mesh/jobs/abc123/output",
  "requirements": {
    "capability": "gpu",
    "model": "whisper-large"
  }
}
```

**Key Fields:**
- `jobId` — Unique identifier for this job
- `type` — Handler type name (matches your registration)
- `payload` — User-provided parameters 
- `workDir` — Temporary directory for this job
- `inputFiles` — Downloaded input files (if any)
- `outputDir` — Directory for output files
- `requirements` — Job requirements (for matching)

### Output Format (stdout)

**Success Response:**
```json
{
  "success": true,
  "data": {
    "result": "your processing result",
    "metadata": {
      "duration": "15.3s",
      "model_used": "whisper-large-v3"
    }
  },
  "outputFiles": [
    "/tmp/ic-mesh/jobs/abc123/output/transcript.json",
    "/tmp/ic-mesh/jobs/abc123/output/subtitles.srt"
  ]
}
```

**Error Response:**
```json
{
  "success": false,
  "error": "Detailed error description",
  "details": {
    "error_code": "INSUFFICIENT_MEMORY",
    "suggestion": "Try reducing batch size or input file size"
  }
}
```

### Progress Updates (stderr)
Use stderr for progress updates and logging:

```python
import sys

# Log progress (visible in node console)
print("Starting transcription...", file=sys.stderr)
print(f"Progress: 25%", file=sys.stderr)
print("Transcription complete", file=sys.stderr)
```

## Built-in Handlers

### transcribe.sh
**Purpose:** Audio transcription using Whisper

**Payload:**
```json
{
  "audio_url": "https://example.com/audio.wav",
  "language": "en",
  "model": "base"
}
```

**Example Usage:**
```bash
curl -X POST http://localhost:8333/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "type": "transcribe",
    "payload": {
      "audio_url": "https://example.com/recording.mp3",
      "language": "auto",
      "model": "small"
    }
  }'
```

### generate-image.js  
**Purpose:** AI image generation

**Payload:**
```json
{
  "prompt": "A sunset over mountains",
  "model": "stable-diffusion",
  "width": 512,
  "height": 512
}
```

### inference.js
**Purpose:** General ML model inference

**Payload:**
```json
{
  "model": "gpt-3.5-turbo",
  "messages": [
    {"role": "user", "content": "Hello!"}
  ]
}
```

### ffmpeg.sh
**Purpose:** Video/audio processing with FFmpeg

**Payload:**
```json
{
  "input_url": "https://example.com/video.mp4", 
  "format": "mp3",
  "options": ["-acodec", "mp3", "-ab", "128k"]
}
```

### ocr.py
**Purpose:** Optical Character Recognition

**Payload:**
```json
{
  "image_url": "https://example.com/document.jpg",
  "language": "eng",
  "output_format": "text"
}
```

### pdf-extract.py
**Purpose:** PDF content extraction

**Payload:**
```json
{
  "pdf_url": "https://example.com/document.pdf",
  "extract_text": true,
  "extract_images": false,
  "page_range": "1-5"
}
```

## Handler Development

### Environment Setup

**Dependencies:**
```bash
# Python handlers
pip install -r requirements.txt

# Node.js handlers  
npm install

# System dependencies (example for transcribe)
apt-get install ffmpeg python3-pip
pip3 install openai-whisper
```

**Testing Locally:**
```bash
# Test your handler directly
echo '{"jobId":"test","type":"my-handler","payload":{"test":true}}' | ./my-handler.py

# Test with the mesh client
node client.js --test-handler my-handler
```

### Best Practices

#### Input Validation
```python
def validate_input(data):
    required_fields = ['jobId', 'type', 'payload']
    for field in required_fields:
        if field not in data:
            return False, f"Missing required field: {field}"
    
    # Validate payload structure
    payload = data.get('payload', {})
    if not isinstance(payload, dict):
        return False, "Payload must be an object"
    
    return True, None

# Use in handler
input_data = json.load(sys.stdin)
valid, error = validate_input(input_data)
if not valid:
    json.dump({"success": False, "error": error}, sys.stdout)
    sys.exit(1)
```

#### File Handling
```python
import os
import shutil

def process_files(input_data):
    work_dir = input_data['workDir']
    output_dir = input_data['outputDir'] 
    input_files = input_data.get('inputFiles', [])
    
    # Ensure output directory exists
    os.makedirs(output_dir, exist_ok=True)
    
    # Process each input file
    output_files = []
    for input_file in input_files:
        # Process the file...
        output_file = os.path.join(output_dir, f"processed_{os.path.basename(input_file)}")
        # Save result to output_file
        output_files.append(output_file)
    
    return output_files
```

#### Error Handling
```python
try:
    # Your processing logic
    result = process_data(input_data)
    
    response = {
        "success": True,
        "data": result
    }
    
except ValueError as e:
    response = {
        "success": False,
        "error": f"Invalid input: {str(e)}",
        "details": {"error_type": "validation_error"}
    }
    
except Exception as e:
    response = {
        "success": False, 
        "error": f"Processing failed: {str(e)}",
        "details": {"error_type": "processing_error"}
    }
    
finally:
    json.dump(response, sys.stdout)
```

#### Resource Management
```python
import psutil
import time

def monitor_resources():
    """Monitor memory and CPU usage"""
    process = psutil.Process()
    memory_mb = process.memory_info().rss / 1024 / 1024
    cpu_percent = process.cpu_percent()
    
    print(f"Memory: {memory_mb:.1f}MB, CPU: {cpu_percent:.1f}%", file=sys.stderr)
    
    # Alert if resource usage is high
    if memory_mb > 1000:  # 1GB
        print("WARNING: High memory usage", file=sys.stderr)
```

### Advanced Examples

#### Multi-step Processing Handler
```python
#!/usr/bin/env python3
import json
import sys
import os
from typing import Dict, List

def main():
    input_data = json.load(sys.stdin)
    
    try:
        # Step 1: Validate input
        print("Step 1: Validating input...", file=sys.stderr)
        validate_input(input_data)
        
        # Step 2: Download/prepare files  
        print("Step 2: Preparing files...", file=sys.stderr)
        files = prepare_files(input_data)
        
        # Step 3: Process
        print("Step 3: Processing...", file=sys.stderr)  
        results = process_files(files, input_data['payload'])
        
        # Step 4: Generate outputs
        print("Step 4: Generating outputs...", file=sys.stderr)
        output_files = save_results(results, input_data['outputDir'])
        
        response = {
            "success": True,
            "data": {
                "processed_count": len(files),
                "results": results
            },
            "outputFiles": output_files
        }
        
    except Exception as e:
        response = {
            "success": False,
            "error": str(e)
        }
    
    json.dump(response, sys.stdout)

if __name__ == "__main__":
    main()
```

#### Batch Processing Handler
```python
def process_batch(input_data):
    """Process multiple items in a single job"""
    items = input_data['payload'].get('batch_items', [])
    batch_size = input_data['payload'].get('batch_size', 10)
    
    results = []
    for i in range(0, len(items), batch_size):
        batch = items[i:i + batch_size]
        print(f"Processing batch {i//batch_size + 1}/{(len(items) + batch_size - 1)//batch_size}", file=sys.stderr)
        
        batch_result = process_items(batch)
        results.extend(batch_result)
        
        # Update progress
        progress = min(100, int((i + batch_size) / len(items) * 100))
        print(f"Progress: {progress}%", file=sys.stderr)
    
    return results
```

## Handler Registration

### Basic Registration
Add to your `node-config.json`:

```json
{
  "handlers": {
    "my-handler": {
      "command": "python3 handlers/my-handler.py",
      "description": "Custom processing handler",
      "resources": {
        "timeout": 300,
        "maxConcurrent": 2,
        "memoryMB": 1024
      }
    }
  }
}
```

### Advanced Registration  
```json
{
  "handlers": {
    "gpu-inference": {
      "command": "python3 handlers/gpu-inference.py",
      "description": "GPU-accelerated ML inference",
      "resources": {
        "timeout": 1800,
        "maxConcurrent": 1, 
        "memoryMB": 4096,
        "requiresGPU": true
      },
      "capabilities": ["gpu", "ml-inference"],
      "models": ["gpt-4", "stable-diffusion", "whisper-large"],
      "requirements": {
        "minGPUMemory": 8000,
        "cudaVersion": ">=11.2"
      }
    }
  }
}
```

**Registration Fields:**
- `command` — Shell command to execute handler
- `description` — Human-readable description  
- `resources.timeout` — Max execution time (seconds)
- `resources.maxConcurrent` — Max simultaneous jobs
- `resources.memoryMB` — Expected memory usage
- `capabilities` — What this handler can do
- `models` — AI models supported
- `requirements` — System requirements

## Testing & Debugging

### Unit Testing
```python
import unittest
import json
from io import StringIO
import sys

class TestMyHandler(unittest.TestCase):
    def test_valid_input(self):
        test_input = {
            "jobId": "test123",
            "type": "my-handler", 
            "payload": {"test": True},
            "workDir": "/tmp/test",
            "outputDir": "/tmp/test/output"
        }
        
        # Mock stdin/stdout
        sys.stdin = StringIO(json.dumps(test_input))
        sys.stdout = StringIO()
        
        # Run handler
        from my_handler import main
        main()
        
        # Check output
        result = json.loads(sys.stdout.getvalue())
        self.assertTrue(result['success'])
```

### Integration Testing
```bash
#!/bin/bash
# Test handler with real mesh client

echo "Testing my-handler..."

# Start test job
JOB_ID=$(curl -s -X POST http://localhost:8333/jobs \
  -H "Content-Type: application/json" \
  -d '{"type":"my-handler","payload":{"test":true}}' | \
  jq -r '.jobId')

echo "Created job: $JOB_ID"

# Wait for completion
while true; do
  STATUS=$(curl -s http://localhost:8333/jobs/$JOB_ID | jq -r '.status')
  echo "Status: $STATUS"
  
  if [ "$STATUS" = "completed" ]; then
    echo "✅ Test passed!"
    break
  elif [ "$STATUS" = "failed" ]; then
    echo "❌ Test failed!"
    curl -s http://localhost:8333/jobs/$JOB_ID | jq '.result'
    exit 1
  fi
  
  sleep 2
done
```

### Debugging Tips

**Enable Debug Logging:**
```python
import logging
logging.basicConfig(level=logging.DEBUG, stream=sys.stderr)

logger = logging.getLogger(__name__)
logger.debug("Processing started")
logger.info(f"Received payload: {payload}")
logger.warning("High memory usage detected")
logger.error("Processing failed")
```

**Handle Timeouts Gracefully:**
```python
import signal
import time

def timeout_handler(signum, frame):
    print("Handler timed out - cleaning up...", file=sys.stderr)
    # Cleanup code here
    sys.exit(1)

# Set up timeout handling
signal.signal(signal.SIGTERM, timeout_handler)
signal.signal(signal.SIGINT, timeout_handler)
```

**Memory Debugging:**
```python
import tracemalloc

# Start tracing
tracemalloc.start()

# Your processing code...

# Check memory usage
current, peak = tracemalloc.get_traced_memory()
print(f"Current memory: {current / 1024 / 1024:.1f}MB", file=sys.stderr)
print(f"Peak memory: {peak / 1024 / 1024:.1f}MB", file=sys.stderr)
```

## Performance Optimization

### Caching
```python
import os
import pickle
import hashlib

def get_cache_key(input_data):
    """Generate cache key from input"""
    payload_str = json.dumps(input_data['payload'], sort_keys=True)
    return hashlib.md5(payload_str.encode()).hexdigest()

def load_from_cache(cache_key):
    """Load result from cache if available"""
    cache_file = f"/tmp/handler_cache/{cache_key}.pkl"
    if os.path.exists(cache_file):
        with open(cache_file, 'rb') as f:
            return pickle.load(f)
    return None

def save_to_cache(cache_key, result):
    """Save result to cache"""
    os.makedirs("/tmp/handler_cache", exist_ok=True)
    cache_file = f"/tmp/handler_cache/{cache_key}.pkl"
    with open(cache_file, 'wb') as f:
        pickle.dump(result, f)
```

### Parallel Processing
```python
import multiprocessing
from concurrent.futures import ProcessPoolExecutor

def process_item(item):
    """Process a single item"""
    # Your processing logic
    return result

def process_parallel(items, max_workers=None):
    """Process items in parallel"""
    if max_workers is None:
        max_workers = min(len(items), multiprocessing.cpu_count())
    
    with ProcessPoolExecutor(max_workers=max_workers) as executor:
        results = list(executor.map(process_item, items))
    
    return results
```

### Memory Optimization
```python
import gc

def process_large_dataset(data):
    """Process large dataset with memory management"""
    
    # Process in chunks to avoid memory issues
    chunk_size = 1000
    results = []
    
    for i in range(0, len(data), chunk_size):
        chunk = data[i:i + chunk_size]
        
        # Process chunk
        chunk_result = process_chunk(chunk)
        results.extend(chunk_result)
        
        # Force garbage collection
        del chunk
        del chunk_result
        gc.collect()
        
        print(f"Processed {min(i + chunk_size, len(data))}/{len(data)} items", file=sys.stderr)
    
    return results
```

## Deployment Checklist

Before deploying your handler to production:

- [ ] **Input validation** — Handle all edge cases
- [ ] **Error handling** — Graceful failure with helpful messages  
- [ ] **Resource limits** — Respect memory and time constraints
- [ ] **Output files** — Properly save to outputDir
- [ ] **Logging** — Informative progress updates to stderr
- [ ] **Testing** — Unit tests and integration tests passing
- [ ] **Documentation** — Usage examples and parameter descriptions
- [ ] **Performance** — Optimized for expected workload
- [ ] **Security** — Input sanitization and safe file handling
- [ ] **Dependencies** — All required packages documented

## Troubleshooting

### Common Issues

**"Handler not found"**
- Check handler name in node-config.json
- Verify command path is correct
- Ensure handler file has execute permissions

**"Handler timeout"**
- Increase timeout in handler registration
- Optimize handler performance
- Check for infinite loops or blocking operations

**"JSON decode error"**  
- Validate your JSON output format
- Ensure no extra output to stdout
- Check for proper UTF-8 encoding

**"Output files not found"**
- Verify files are saved to outputDir  
- Check file permissions
- Ensure file paths are absolute

### Getting Help

1. **Test your handler directly:**
   ```bash
   echo '{"jobId":"test","type":"my-handler","payload":{}}' | ./my-handler.py
   ```

2. **Check node logs:**
   ```bash
   node client.js --log-level debug
   ```

3. **Use the testing scripts:**
   ```bash
   node ../scripts/test-error-handling.js
   ```

---

**Ready to build?** Start with the minimal example and expand from there. The mesh is waiting for your compute! 🚀
