# Writing a Handler

A handler is any executable that reads JSON from stdin and writes JSON to stdout.

## Minimal Example (bash)

```bash
#!/bin/bash
INPUT=$(cat)
echo '{"success": true, "data": {"message": "hello from my handler"}}'
```

## Contract

**Input** (stdin):
```json
{
  "jobId": "abc123",
  "type": "my-handler",
  "payload": { ... },
  "workDir": "/tmp/ic-mesh/jobs/abc123",
  "inputFiles": ["/tmp/ic-mesh/jobs/abc123/input/file.ext"],
  "outputDir": "/tmp/ic-mesh/jobs/abc123/output"
}
```

**Output** (stdout):
```json
{
  "success": true,
  "data": { "your": "result" },
  "outputFiles": ["/path/to/output/file.png"]
}
```

**Error**:
```json
{
  "success": false,
  "error": "What went wrong"
}
```

## Rules

1. Read JSON from stdin
2. Write JSON to stdout
3. Write logs/progress to stderr (shown in node console)
4. Exit 0 on success, non-zero on failure
5. Use `workDir` for temp files — it's cleaned up after
6. Put output files in `outputDir` — they'll be uploaded to the hub
7. Respect timeouts — your handler will be killed if it exceeds the limit

## Registration

Add to `node-config.json`:

```json
{
  "handlers": {
    "my-handler": {
      "command": "python3 handlers/my-handler.py",
      "description": "What it does",
      "resources": { "timeout": 300, "maxConcurrent": 1 }
    }
  }
}
```

Then restart the client. Your handler is now a service on the mesh.
