# Node Configuration Guide

The IC Mesh client supports two configuration formats: simple and complex.

## Simple Configuration (Recommended)

Use `node-config.json.sample` as a template:

```bash
cp node-config.json.sample node-config.json
```

Edit `node-config.json`:

```json
{
  "meshServer": "https://moilol.com:8333",
  "nodeName": "my-node",
  "nodeOwner": "your-name",
  "nodeRegion": "your-region",
  "useWebSocket": true,
  "checkinInterval": 60000,
  "jobPollInterval": 10000,
  "jobTimeouts": {
    "transcribe": 900000,
    "inference": 300000,
    "generate": 900000
  }
}
```

## Complex Configuration (Advanced)

Use `node-config.example.json` as a template for advanced features:

```json
{
  "node": {
    "name": "my-mac-mini",
    "owner": "your-name", 
    "region": "hawaii"
  },
  "server": {
    "url": "https://moilol.com:8333"
  },
  "limits": {
    "maxConcurrentJobs": 2,
    "maxCpuPercent": 80
  }
}
```

## Configuration Priority

1. **Environment variables** (highest priority)
2. **Configuration file** (`node-config.json`)
3. **Built-in defaults** (lowest priority)

## Environment Variables

Override any config setting with environment variables:

```bash
export IC_MESH_SERVER="http://moilol.com:8333"
export IC_NODE_NAME="my-node"
export IC_NODE_OWNER="your-name"
export IC_NODE_REGION="your-region"
```

## Validation

The client will validate configuration on startup and warn about issues:

- Missing required fields
- Invalid timeouts or intervals
- Unreachable server URLs
- Invalid capability configurations

## Testing Configuration

```bash
# Test with environment variables only
IC_MESH_SERVER=http://localhost:8333 IC_NODE_NAME=test-node node client.js

# Test with config file
node client.js

# Check what configuration is loaded
# (startup logs will show loaded config source and values)
```