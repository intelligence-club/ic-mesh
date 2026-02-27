# Recovery Instructions for miniclaw

**Node ID:** 9b6a3b5841dc2890
**Owner:** drake
**Capabilities:** whisper, ffmpeg, gpu-metal
**Jobs Completed:** 11
**Last Seen:** 1970-01-01T00:00:00.000Z

## Recovery Steps

### Transcription Service
```bash
claw skill mesh-transcribe
```

## Diagnostics

```bash
# Test server connection
curl http://moilol.com:8333/status

# Check node processes
ps aux | grep mesh

# Check available disk space
df -h
```
