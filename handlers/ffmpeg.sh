#!/bin/bash
# IC Mesh Handler: ffmpeg
# Generic media processing via ffmpeg
# Input: JSON with payload.args (ffmpeg arguments) and inputFiles
# Output: Processed file in outputDir

set -e

INPUT=$(cat)
INPUT_FILE=$(echo "$INPUT" | python3 -c "import sys,json; f=json.load(sys.stdin).get('inputFiles',[]); print(f[0] if f else '')")
OUTPUT_DIR=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('outputDir','/tmp'))")
ARGS=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('payload',{}).get('args','-c:v libx264 -crf 28'))")
OUTPUT_FORMAT=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('payload',{}).get('outputFormat','mp4'))")

if [ -z "$INPUT_FILE" ]; then
  echo '{"success": false, "error": "No input file"}'
  exit 1
fi

OUTPUT_FILE="$OUTPUT_DIR/output.$OUTPUT_FORMAT"

# Run ffmpeg
ffmpeg -i "$INPUT_FILE" $ARGS "$OUTPUT_FILE" -y >&2

if [ ! -f "$OUTPUT_FILE" ]; then
  echo '{"success": false, "error": "ffmpeg produced no output"}'
  exit 1
fi

SIZE=$(stat -f%z "$OUTPUT_FILE" 2>/dev/null || stat -c%s "$OUTPUT_FILE" 2>/dev/null)

echo "{\"success\": true, \"data\": {\"format\": \"$OUTPUT_FORMAT\", \"sizeBytes\": $SIZE}, \"outputFiles\": [\"$OUTPUT_FILE\"]}"
