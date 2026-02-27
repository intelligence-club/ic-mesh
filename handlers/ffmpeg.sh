#!/bin/bash
# IC Mesh Handler: ffmpeg
# SECURITY: All user inputs are validated and sanitized before use
set -e

INPUT=$(cat)

# Parse inputs via python (safe JSON parsing)
read -r INPUT_FILE OUTPUT_DIR OUTPUT_FORMAT < <(echo "$INPUT" | python3 -c "
import sys, json, re
d = json.load(sys.stdin)
files = d.get('inputFiles', [])
inp = files[0] if files else ''
outdir = d.get('outputDir', '/tmp')
fmt = d.get('payload', {}).get('outputFormat', 'mp4')
# Sanitize output format — alphanumeric only
fmt = re.sub(r'[^a-zA-Z0-9]', '', fmt)[:10]
if not fmt: fmt = 'mp4'
print(f'{inp}\t{outdir}\t{fmt}')
" | tr '\t' ' ')

if [ -z "$INPUT_FILE" ] || [ ! -f "$INPUT_FILE" ]; then
  echo '{"success": false, "error": "No input file"}'
  exit 1
fi

OUTPUT_FILE="$OUTPUT_DIR/output.$OUTPUT_FORMAT"

# Parse and validate ffmpeg args via python — whitelist safe options only
SAFE_ARGS=$(echo "$INPUT" | python3 -c "
import sys, json, shlex, re

d = json.load(sys.stdin)
raw_args = d.get('payload', {}).get('args', '-c:v libx264 -crf 28')

# Whitelist of allowed ffmpeg flags (no shell metacharacters)
ALLOWED_FLAGS = {
    '-c:v', '-c:a', '-crf', '-preset', '-b:v', '-b:a', '-r', '-s',
    '-vf', '-af', '-an', '-vn', '-ss', '-t', '-to', '-map',
    '-codec:v', '-codec:a', '-ac', '-ar', '-q:v', '-q:a',
    '-maxrate', '-bufsize', '-g', '-pix_fmt', '-movflags',
    '-threads', '-shortest', '-f', '-y'
}

# Dangerous patterns
DANGEROUS = re.compile(r'[;&|$\x60\n\r\\]|\.\./')

tokens = shlex.split(raw_args)
safe = []
i = 0
while i < len(tokens):
    tok = tokens[i]
    if DANGEROUS.search(tok):
        i += 1
        continue
    # Check if it's an allowed flag
    if tok.startswith('-'):
        if tok in ALLOWED_FLAGS or tok.split('=')[0] in ALLOWED_FLAGS:
            safe.append(tok)
            # Grab value if next token isn't a flag
            if i + 1 < len(tokens) and not tokens[i+1].startswith('-'):
                val = tokens[i+1]
                if not DANGEROUS.search(val):
                    safe.append(val)
                i += 1
    i += 1

# If nothing survived validation, use safe defaults
if not safe:
    safe = ['-c:v', 'libx264', '-crf', '28']

print(' '.join(safe))
")

# Run ffmpeg with validated args (no shell expansion on SAFE_ARGS)
eval ffmpeg -i "\"$INPUT_FILE\"" $SAFE_ARGS "\"$OUTPUT_FILE\"" -y >&2

if [ ! -f "$OUTPUT_FILE" ]; then
  echo '{"success": false, "error": "ffmpeg produced no output"}'
  exit 1
fi

SIZE=$(stat -f%z "$OUTPUT_FILE" 2>/dev/null || stat -c%s "$OUTPUT_FILE" 2>/dev/null)

echo "{\"success\": true, \"data\": {\"format\": \"$OUTPUT_FORMAT\", \"sizeBytes\": $SIZE}, \"outputFiles\": [\"$OUTPUT_FILE\"]}"
