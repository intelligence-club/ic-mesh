#!/bin/bash
# IC Mesh Handler: transcribe
# Transcribes audio/video files using Whisper
# Input: JSON on stdin with inputFiles[] and payload.model, payload.language
# Output: JSON on stdout with transcript

set -e

INPUT=$(cat)
INPUT_FILE=$(echo "$INPUT" | python3 -c "import sys,json; f=json.load(sys.stdin).get('inputFiles',[]); print(f[0] if f else '')")
MODEL=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('payload',{}).get('model','base'))")
LANGUAGE=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('payload',{}).get('language','en'))")
OUTPUT_DIR=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('outputDir','/tmp'))")

if [ -z "$INPUT_FILE" ]; then
  echo '{"success": false, "error": "No input file provided"}'
  exit 1
fi

# Run whisper
whisper "$INPUT_FILE" --model "$MODEL" --language "$LANGUAGE" --output_dir "$OUTPUT_DIR" --output_format txt >&2

# Find the output txt file
TXT_FILE=$(find "$OUTPUT_DIR" -name "*.txt" -type f | head -1)

if [ -z "$TXT_FILE" ]; then
  echo '{"success": false, "error": "Whisper produced no output"}'
  exit 1
fi

TRANSCRIPT=$(cat "$TXT_FILE")
CHARS=${#TRANSCRIPT}

python3 -c "
import json, sys
transcript = open('$TXT_FILE').read().strip()
print(json.dumps({
    'success': True,
    'data': {
        'transcript': transcript,
        'model': '$MODEL',
        'language': '$LANGUAGE',
        'chars': len(transcript)
    }
}))
"
