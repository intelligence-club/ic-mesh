#!/bin/bash
# IC Mesh Transcribe Handler Diagnostic Tool
# Run this on the problematic frigg node to identify issues

echo "🔍 IC Mesh Transcribe Handler Diagnostics"
echo "=========================================="
echo ""

# Function to check command availability
check_command() {
    if command -v "$1" >/dev/null 2>&1; then
        echo "✅ $1: Available"
        if [ "$1" = "whisper" ]; then
            echo "   Version: $(whisper --version 2>/dev/null || echo 'Version check failed')"
        elif [ "$1" = "python3" ]; then
            echo "   Version: $(python3 --version 2>/dev/null || echo 'Version check failed')"
        fi
        return 0
    else
        echo "❌ $1: NOT FOUND"
        return 1
    fi
}

# Function to check Python modules
check_python_module() {
    if python3 -c "import $1" 2>/dev/null; then
        echo "✅ Python module $1: Available"
        return 0
    else
        echo "❌ Python module $1: NOT FOUND"
        return 1
    fi
}

# Check basic dependencies
echo "📋 Checking Basic Dependencies:"
check_command "bash"
check_command "cat"
check_command "find"
check_command "python3"
check_python3_available=$?

if [ $check_python3_available -eq 0 ]; then
    check_python_module "json"
    check_python_module "sys"
fi

echo ""

# Check Whisper installation
echo "🎤 Checking Whisper Installation:"
check_command "whisper"
whisper_available=$?

if [ $whisper_available -eq 0 ]; then
    echo "   Testing Whisper models:"
    whisper_models_dir="$HOME/.cache/whisper"
    if [ -d "$whisper_models_dir" ]; then
        echo "   Models directory: $whisper_models_dir"
        echo "   Available models:"
        ls -la "$whisper_models_dir" 2>/dev/null | grep -E "\.(pt|ckpt)$" || echo "   ⚠️ No Whisper models found"
    else
        echo "   ⚠️ Whisper models directory not found: $whisper_models_dir"
    fi
fi

echo ""

# Check file permissions and temp directory
echo "📁 Checking File System Access:"
TEMP_DIR="/tmp"
if [ -w "$TEMP_DIR" ]; then
    echo "✅ Write access to $TEMP_DIR: OK"
else
    echo "❌ Write access to $TEMP_DIR: DENIED"
fi

# Test creating a temp file
TEST_FILE="$TEMP_DIR/ic-mesh-diagnostic-test-$$"
if touch "$TEST_FILE" 2>/dev/null; then
    echo "✅ Temp file creation: OK"
    rm -f "$TEST_FILE"
else
    echo "❌ Temp file creation: FAILED"
fi

echo ""

# Check current working directory and handler script
echo "📄 Checking Handler Script:"
HANDLER_SCRIPT="handlers/transcribe.sh"
if [ -f "$HANDLER_SCRIPT" ]; then
    echo "✅ Handler script exists: $HANDLER_SCRIPT"
    if [ -x "$HANDLER_SCRIPT" ]; then
        echo "✅ Handler script is executable"
    else
        echo "❌ Handler script is NOT executable"
        echo "   Fix with: chmod +x $HANDLER_SCRIPT"
    fi
else
    echo "❌ Handler script NOT FOUND: $HANDLER_SCRIPT"
    echo "   Current directory: $(pwd)"
    echo "   Contents:"
    ls -la handlers/ 2>/dev/null || echo "   handlers/ directory not found"
fi

echo ""

# Memory and disk space check
echo "💾 Checking System Resources:"
echo "   Memory usage:"
free -h 2>/dev/null || echo "   ⚠️ free command not available"
echo "   Disk space:"
df -h . 2>/dev/null || echo "   ⚠️ df command not available"

echo ""

# Create a minimal test
echo "🧪 Running Minimal Test:"
if [ $whisper_available -eq 0 ] && [ $check_python3_available -eq 0 ]; then
    echo "   Creating test audio file..."
    # Create a 1-second sine wave as test audio
    if command -v ffmpeg >/dev/null 2>&1; then
        TEST_AUDIO="$TEMP_DIR/test-audio-$$.wav"
        if ffmpeg -f lavfi -i "sine=frequency=440:duration=1" -acodec pcm_s16le "$TEST_AUDIO" -y >/dev/null 2>&1; then
            echo "✅ Test audio file created: $TEST_AUDIO"
            
            echo "   Testing Whisper transcription..."
            if whisper "$TEST_AUDIO" --model base --output_dir "$TEMP_DIR" --output_format txt >/dev/null 2>&1; then
                echo "✅ Whisper transcription test: PASSED"
                rm -f "$TEST_AUDIO" "$TEMP_DIR"/*.txt
            else
                echo "❌ Whisper transcription test: FAILED"
                echo "   This is likely the root cause of the 'Exit 1' errors"
            fi
        else
            echo "⚠️ Could not create test audio file (ffmpeg failed)"
        fi
    else
        echo "⚠️ ffmpeg not available for test audio creation"
        echo "   Skipping Whisper functionality test"
    fi
else
    echo "⚠️ Prerequisites missing, skipping functionality test"
fi

echo ""
echo "🔧 REPAIR RECOMMENDATIONS:"
echo "========================="

if [ $check_python3_available -ne 0 ]; then
    echo "❌ Install Python 3:"
    echo "   Ubuntu/Debian: sudo apt update && sudo apt install python3"
    echo "   macOS: brew install python3"
    echo "   Or download from: https://python.org"
    echo ""
fi

if [ $whisper_available -ne 0 ]; then
    echo "❌ Install OpenAI Whisper:"
    echo "   pip install openai-whisper"
    echo "   Or: pip3 install openai-whisper"
    echo "   Note: Requires Python 3.7+ and ffmpeg"
    echo ""
fi

if [ ! -f "$HANDLER_SCRIPT" ] || [ ! -x "$HANDLER_SCRIPT" ]; then
    echo "❌ Fix handler script permissions:"
    echo "   chmod +x handlers/transcribe.sh"
    echo ""
fi

echo "✅ After installing dependencies:"
echo "   1. Run this diagnostic again to verify fixes"
echo "   2. Restart the IC Mesh node client"
echo "   3. Check the problematic node status with: node manage-problematic-nodes.js analyze"
echo "   4. If fixed, remove quarantine with: node manage-problematic-nodes.js unquarantine fcecb481"
echo ""
echo "📞 For help, contact: https://github.com/intelligence-club/ic-mesh/issues"