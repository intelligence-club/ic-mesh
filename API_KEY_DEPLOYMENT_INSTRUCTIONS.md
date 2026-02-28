
# API Key Creation Infrastructure Fix - Deployment Instructions

## Problem Summary
- **Issue**: POST https://moilol.com/auth/create-api-key returns 404
- **Root Cause**: Production server running outdated code without API key creation endpoint
- **Impact**: Developer onboarding completely blocked
- **Severity**: HIGH - blocks new user acquisition

## Test Results
- Local endpoint: ✅ WORKING
- Production endpoint: ❌ FAILED (needs deployment)
- Code verification: ✅ ENDPOINT PRESENT

## Deployment Steps

### 1. Backup Current State
```bash
# On production server
cp server.js server.js.backup.$(date +%Y%m%d_%H%M%S)
cp -r data/ data.backup.$(date +%Y%m%d_%H%M%S)/
```

### 2. Deploy Updated Code
```bash
# Upload current server.js to production server
scp server.js user@moilol.com:/path/to/ic-mesh/
```

### 3. Restart Production Service
```bash
# On production server
# Stop existing service
pkill -f "node.*server.js" || systemctl stop ic-mesh

# Start new service  
nohup node server.js > server.log 2>&1 &
# OR if using systemd:
systemctl start ic-mesh
```

### 4. Verify Deployment
```bash
# Test the endpoint
curl -X POST "https://moilol.com/auth/create-api-key" \
  -H "Content-Type: application/json" \
  -d "{}"

# Expected response (200 status):
{
  "api_key": "ic_f3c54724501247a5954aa43ebf5f7232351440c8e57f7a87d3d2753275ac7664",
  "created": "2026-02-28T03:33:57.506Z",
  "note": "Store this API key securely. It will not be shown again.",
  "usage": "Include in X-Api-Key header or Authorization: Bearer <key>",
  "expires": "Never (until manually revoked)"
}
```

## Rollback Procedure (if needed)
```bash
# Stop new service
pkill -f "node.*server.js" || systemctl stop ic-mesh

# Restore backup
cp server.js.backup.[timestamp] server.js
cp -r data.backup.[timestamp]/* data/

# Restart old service
nohup node server.js > server.log 2>&1 &
```

## Post-Deployment Verification Checklist
- [ ] API key creation endpoint returns 200 status
- [ ] Generated API keys work for job submission
- [ ] Existing functionality unaffected (status, nodes, jobs endpoints)
- [ ] No error logs in server.log
- [ ] Database integrity maintained

## Technical Details
The endpoint handles both `/api/create_api_key` and `/auth/create-api-key` paths and generates
API keys with format: `ic_` + 64 hex characters (67 characters total).

Generated: $(date)
