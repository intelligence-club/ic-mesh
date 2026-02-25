# Frigg Node Repair Guide

## 🚨 Issue Summary

The frigg node (fcecb481) has been experiencing transcription failures with "Exit 1" errors, causing:
- 41.7% success rate (down from expected 100%)
- 50+ failed transcribe jobs
- Network capacity bottleneck (only 1-2 healthy nodes processing)

**Current Status:** Node has been **quarantined** to prevent further failures and protect network health.

## 🔍 Root Cause Analysis

The transcribe handler (`handlers/transcribe.sh`) is failing because one or more dependencies are missing:

1. **OpenAI Whisper** - Not installed or not accessible
2. **Python 3** - Missing or broken installation
3. **File permissions** - Handler script or output directory issues
4. **Missing models** - Whisper models not downloaded

## 🛠️ Repair Steps

### Step 1: Run Diagnostics

On the frigg node machine, navigate to your IC Mesh directory and run:

```bash
cd /path/to/ic-mesh
./diagnose-transcribe-handler.sh
```

This will check all dependencies and identify specific issues.

### Step 2: Install Missing Dependencies

#### Install Python 3 (if missing)
```bash
# Ubuntu/Debian
sudo apt update && sudo apt install python3 python3-pip

# macOS
brew install python3

# Windows (use WSL or install from python.org)
```

#### Install OpenAI Whisper
```bash
pip install openai-whisper
# or
pip3 install openai-whisper
```

**Note:** Whisper requires ffmpeg. If not installed:
```bash
# Ubuntu/Debian
sudo apt install ffmpeg

# macOS
brew install ffmpeg
```

### Step 3: Test Installation

After installing dependencies, run the diagnostic again:
```bash
./diagnose-transcribe-handler.sh
```

All checks should show ✅ green checkmarks.

### Step 4: Test Handler Manually

Create a test job to verify the handler works:

```bash
# Create a test input file
echo '{"inputFiles":["/path/to/test-audio.wav"],"payload":{"model":"base","language":"en"},"outputDir":"/tmp"}' > test-input.json

# Test the handler
cat test-input.json | bash handlers/transcribe.sh
```

Expected output: JSON with `"success": true` and transcript data.

### Step 5: Restart Node Client

Restart your IC Mesh node client to apply changes:

```bash
# Stop the current client (if running)
pkill -f "node client.js"  # or however you started it

# Start the client again
node client.js
```

### Step 6: Remove Quarantine

Once the node is healthy, notify the network administrator to remove the quarantine:

```bash
# On the server side (done by admin)
node manage-problematic-nodes.js unquarantine fcecb481
```

## 🔬 Common Issues and Solutions

### Issue: "whisper: command not found"
**Solution:** Install Whisper with `pip install openai-whisper`

### Issue: "python3: command not found"
**Solution:** Install Python 3 from package manager or python.org

### Issue: "Permission denied" on handler script
**Solution:** `chmod +x handlers/transcribe.sh`

### Issue: "No space left on device"
**Solution:** 
- Clean up disk space
- Check `/tmp` directory has space
- Consider setting WHISPER_CACHE_DIR to a larger drive

### Issue: Whisper models not downloading
**Solution:**
- Check internet connection
- Manually download: `whisper --model base /dev/null` (will fail but download model)
- Verify models in `~/.cache/whisper/`

## 📊 Verification

After repair, check these metrics:
- Node success rate should be 95%+ 
- No "Exit 1" errors in job logs
- Transcribe jobs completing successfully
- Node active and accepting jobs

## 🆘 Need Help?

If issues persist:

1. **Share diagnostic output:** Run `./diagnose-transcribe-handler.sh` and share the full output
2. **Check logs:** Look for error messages in your node client output
3. **Create GitHub issue:** https://github.com/intelligence-club/ic-mesh/issues
4. **Contact network admin:** Include your node ID (fcecb481) and diagnostic results

## 📈 Impact After Fix

Once repaired, the frigg node will:
- ✅ Process transcription jobs reliably
- ✅ Increase network capacity
- ✅ Reduce job queue bottlenecks  
- ✅ Earn consistent revenue for the owner

---

**Status:** Quarantined on 2026-02-25 21:01 UTC
**Next Check:** After running repair steps above