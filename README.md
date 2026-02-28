# IC Mesh - Distributed Compute Network

A decentralized job processing system that leverages spare compute across trusted nodes for AI workloads, transcription, OCR, and more.

## Quick Start

### Prerequisites
- Node.js 18+ 
- SQLite3
- Internet connectivity for job coordination

### Starting the Server
```bash
# Install dependencies
npm install

# Start the mesh server
node server.js

# Or with custom port
IC_MESH_PORT=9000 node server.js
```
Server runs on `http://localhost:8333` by default.

### Connecting a Worker Node
```bash
# From another machine or terminal
node client.js

# Or connect to remote server
IC_MESH_URL=http://your-server.com:8333 node client.js
```

### Submitting Jobs

#### Audio Transcription
```bash
# Transcribe audio file
curl -X POST http://localhost:8333/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "type": "transcribe",
    "model": "whisper-base",
    "data": {
      "url": "https://example.com/audio.mp3"
    }
  }'

# With language specification
curl -X POST http://localhost:8333/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "type": "transcribe", 
    "model": "whisper-medium",
    "data": {
      "url": "https://example.com/podcast.wav",
      "language": "en"
    }
  }'
```

#### OCR Processing
```bash
# Extract text from image
curl -X POST http://localhost:8333/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "type": "ocr",
    "data": {
      "url": "https://example.com/document.png"
    }
  }'
```

#### AI Text Generation
```bash
# Generate text with LLM
curl -X POST http://localhost:8333/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "type": "inference",
    "model": "llama2-7b",
    "data": {
      "prompt": "Explain quantum computing",
      "max_tokens": 500
    }
  }'
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

### Environment Variables
| Variable | Default | Description |
|----------|---------|-------------|
| `IC_MESH_PORT` | 8333 | Server listening port |
| `IC_MESH_HOST` | 0.0.0.0 | Server bind address |
| `IC_MESH_URL` | http://localhost:8333 | Server URL for clients |
| `IC_DEBUG` | false | Enable detailed logging |
| `DATABASE_PATH` | ./data/mesh.db | SQLite database location |
| `LOG_LEVEL` | info | Logging level (error/warn/info/debug) |

### Node Configuration
Worker nodes automatically discover their capabilities on startup:
- **CPU cores** - Detected automatically
- **Available models** - Scanned from installed dependencies
- **Memory limits** - Based on system resources

## Monitoring & Observability

### Health Check Endpoints
```bash
# Quick health check
curl http://localhost:8333/health

# Detailed network status
curl http://localhost:8333/status

# Active nodes and capabilities  
curl http://localhost:8333/nodes

# Job queue and processing stats
curl http://localhost:8333/jobs/stats
```

### Real-time Monitoring
```bash
# Watch network status with auto-refresh
watch -n 5 'curl -s http://localhost:8333/status | jq'

# Monitor job queue
watch -n 2 'curl -s http://localhost:8333/jobs/stats'
```

### Log Analysis
```bash
# View recent logs
tail -f data/mesh.log

# Search for errors
grep ERROR data/mesh.log

# Job completion stats
grep "Job completed" data/mesh.log | wc -l
```

## Troubleshooting

### Common Issues

#### "No nodes available"
- **Check node connectivity**: `curl http://localhost:8333/nodes`
- **Verify node capabilities**: Ensure nodes have required models installed
- **Check node logs**: Look for connection errors or capability mismatches

#### "Job timeout" 
- **Increase timeout**: Add `"timeout": 300` to job payload (seconds)
- **Check node resources**: High CPU load may slow processing
- **Verify job data**: Large files may require more time

#### "Connection refused"
- **Server status**: Ensure server is running on correct port
- **Firewall**: Check if port 8333 (or custom port) is accessible
- **Network**: Verify connectivity between client and server

#### Database Issues
- **Permissions**: Ensure write access to `data/` directory
- **Corruption**: Delete `data/mesh.db` to reset (loses history)
- **Space**: Check disk space for database growth

### Debug Mode
```bash
# Start server with debug logging
IC_DEBUG=true node server.js

# Start client with verbose output
IC_DEBUG=true node client.js
```

## Development

### Project Structure
```
ic-mesh/
├── server.js          # Main mesh coordinator
├── client.js          # Worker node client  
├── lib/               # Shared utilities
│   ├── db.js         # Database operations
│   ├── logger.js     # Logging system
│   └── error-handler.js # Error formatting
├── data/             # Runtime data (created automatically)
│   ├── mesh.db       # SQLite database
│   └── mesh.log      # Application logs
└── test/             # Test suite
```

### Running Tests
```bash
# Install test dependencies
npm install --dev

# Run test suite  
npm test

# Run specific test
npm test -- --grep "job processing"
```

### Database Schema
```sql
-- Core tables
CREATE TABLE nodes (id TEXT PRIMARY KEY, ...);
CREATE TABLE jobs (id TEXT PRIMARY KEY, ...);  
CREATE TABLE job_assignments (job_id TEXT, node_id TEXT, ...);
CREATE TABLE ledger (id TEXT PRIMARY KEY, ...);
```

### API Reference

#### Submit Job
```
POST /jobs
Content-Type: application/json

{
  "type": "transcribe|ocr|inference|extract-pdf",
  "model": "model-name", 
  "data": { /* job-specific payload */ },
  "timeout": 300,  /* optional */
  "priority": 1    /* optional, 1-10 */
}
```

#### Get Job Status
```
GET /jobs/{job_id}

Response:
{
  "id": "job_123",
  "status": "pending|processing|completed|failed",
  "result": { /* job output */ },
  "created_at": "2024-01-01T12:00:00Z",
  "completed_at": "2024-01-01T12:05:00Z"
}
```

## Security

- **Job Isolation**: Each job runs in isolated context
- **No Data Persistence**: Job payloads cleared after completion  
- **Capability Verification**: Nodes validated before job assignment
- **Rate Limiting**: Prevents job queue flooding
- **Input Validation**: All job data validated before processing
- **Network Security**: Consider firewall rules for production deployments

## Performance

### Scaling Recommendations
- **Small networks** (1-5 nodes): Single server instance sufficient
- **Medium networks** (5-20 nodes): Consider dedicated server hardware
- **Large networks** (20+ nodes): Implement server clustering

### Optimization Tips
- **Node placement**: Distribute nodes across different networks
- **Model caching**: Pre-install common models on all nodes
- **Database tuning**: Use SSD storage for better I/O performance
- **Memory management**: Monitor node memory usage for large jobs

## Getting Help

### Diagnostics Checklist
1. **Server health**: `curl http://localhost:8333/health`
2. **Node connectivity**: Check node count in `/status`
3. **Job queue**: Monitor pending/failed jobs in `/jobs/stats`  
4. **Logs**: Review `data/mesh.log` for errors
5. **Resources**: Check CPU/memory on server and nodes

### Community & Support
- **Documentation**: Full API docs at `/docs` endpoint (if enabled)
- **Issue Reporting**: Include logs, job payloads, and system info
- **Performance Issues**: Share network topology and job patterns

### Contributing
See `CONTRIBUTING.md` for development setup and contribution guidelines.