# Recovery Instructions for frigg

**Node ID:** fcecb481aa501e7a
**Owner:** drake
**Capabilities:** ollama, whisper, ffmpeg, tesseract, gpu-metal, transcribe, generate
**Jobs Completed:** 43
**Last Seen:** 1970-01-01T00:00:00.000Z

## Recovery Steps

### Transcription Service
```bash
claw skill mesh-transcribe
```

### OCR Service
```bash
# Check tesseract installation
which tesseract
tesseract --version

# Start mesh client
node /path/to/ic-mesh/client.js
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
