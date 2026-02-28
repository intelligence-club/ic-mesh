#!/bin/bash
# Rollback ic-mesh to previous commit
set -e
cd "$(dirname "$0")/.."
CURRENT=$(git rev-parse --short HEAD)
git reset --hard HEAD~1
npm install --production 2>/dev/null
pm2 restart ic-mesh
echo "Rolled back from $CURRENT to $(git rev-parse --short HEAD)"
