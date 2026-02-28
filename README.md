# IC Mesh - Distributed Compute Network

A decentralized job processing system that leverages spare compute across trusted nodes for AI workloads, transcription, OCR, and more.

## Quick Start

### Starting the Server
```bash
node server.js
```
Server runs on `http://localhost:8333` by default.

### Connecting a Node
```bash
node client.js
```

### Submitting Jobs
```bash
# Transcribe audio
curl -X POST http://localhost:8333/jobs \
  -H "Content-Type: application/json" \
  -d '{"type": "transcribe", "model": "whisper-base", "data": {"url": "https://example.com/audio.mp3"}}'

# OCR an image
curl -X POST http://localhost:8333/jobs \
  -H "Content-Type: application/json" \
  -d '{"type": "ocr", "data": {"url": "https://example.com/document.png"}}'
```

## Supported Job Types

| Type | Models Available | Description |
|------|------------------|-------------|
| `transcribe` | whisper-base, whisper-medium, whisper-large-v3 | Audio transcription |
| `ocr` | tesseract | Text extraction from images |
| `inference` | Various LLMs | AI text generation |
| `extract-pdf` | - | PDF text extraction |

## Network Status

Check network health:
```bash
curl http://localhost:8333/status
```

Example response:
```json
{
  "network": "Intelligence Club Mesh",
  "status": "online", 
  "nodes": {
    "active": 2,
    "total": 288
  },
  "compute": {
    "totalCores": 11,
    "availableSlots": 8
  },
  "jobs": {
    "pending": 0,
    "completed": 140,
    "failed": 0
  }
}
```

## Features

- **Race-to-claim** job routing - fastest available node wins
- **Real-time updates** via WebSocket connections  
- **Automatic retries** for failed jobs
- **Load balancing** across available nodes
- **Capability matching** - jobs route to nodes with required models
- **Comprehensive logging** and monitoring
- **RESTful API** for easy integration

## Architecture

```
[Client] → [Mesh Server] → [Worker Nodes]
             ↓
        [SQLite DB]
```

- **Mesh Server**: Coordinates jobs, manages node registry, handles WebSocket connections
- **Worker Nodes**: Process jobs, report capabilities, maintain heartbeat
- **SQLite Database**: Persistent storage for jobs, nodes, and ledger data

## Configuration

Set environment variables:
- `IC_MESH_PORT` - Server port (default: 8333)
- `IC_MESH_HOST` - Server host (default: 0.0.0.0) 
- `IC_DEBUG` - Enable debug logging

## Monitoring

Built-in monitoring endpoints:
- `/status` - Network overview
- `/nodes` - Active node list
- `/jobs/stats` - Job statistics
- `/health` - Health check

## Security

- All job data is isolated per execution
- No persistent storage of job payloads beyond completion
- Node authentication via capability verification
- Rate limiting and request validation

## Getting Help

- Check server logs for diagnostics
- Use `/status` endpoint for network health
- Monitor `/jobs/stats` for processing metrics