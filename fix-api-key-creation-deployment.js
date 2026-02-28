#!/usr/bin/env node
/**
 * IC Mesh API Key Creation Deployment Fix
 * 
 * CRITICAL INFRASTRUCTURE GAP: Production server at moilol.com is missing the API key creation endpoint
 * 
 * Problem: POST https://moilol.com/auth/create-api-key returns 404
 * Root Cause: Production server running older code without API key creation endpoint  
 * Business Impact: Complete developer onboarding blocked
 * 
 * This script:
 * 1. Verifies the local API key endpoint works
 * 2. Tests production deployment readiness
 * 3. Creates deployment instructions
 * 4. Provides rollback procedures
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// Test local endpoint
function testLocalEndpoint() {
  console.log('🧪 Testing local API key creation endpoint...');
  
  return new Promise((resolve) => {
    const postData = JSON.stringify({});
    
    const options = {
      hostname: 'localhost',
      port: 8333,
      path: '/auth/create-api-key',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };
    
    const req = http.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        if (res.statusCode === 200) {
          const result = JSON.parse(data);
          console.log('✅ Local endpoint working correctly');
          console.log(`   Generated API key: ${result.api_key.substring(0, 20)}...`);
          resolve({ success: true, response: result });
        } else {
          console.log(`❌ Local endpoint failed: ${res.statusCode}`);
          console.log(`   Response: ${data}`);
          resolve({ success: false, error: data });
        }
      });
    });
    
    req.on('error', (error) => {
      console.log(`❌ Local endpoint connection failed: ${error.message}`);
      resolve({ success: false, error: error.message });
    });
    
    req.write(postData);
    req.end();
  });
}

// Test production endpoint
function testProductionEndpoint() {
  console.log('🌐 Testing production API key creation endpoint...');
  
  return new Promise((resolve) => {
    const postData = JSON.stringify({});
    
    const options = {
      hostname: 'moilol.com',
      port: 443,
      path: '/auth/create-api-key',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        if (res.statusCode === 200) {
          const result = JSON.parse(data);
          console.log('✅ Production endpoint working correctly');
          console.log(`   Generated API key: ${result.api_key.substring(0, 20)}...`);
          resolve({ success: true, response: result });
        } else {
          console.log(`❌ Production endpoint failed: ${res.statusCode}`);
          console.log(`   Response: ${data}`);
          resolve({ success: false, error: data, statusCode: res.statusCode });
        }
      });
    });
    
    req.on('error', (error) => {
      console.log(`❌ Production endpoint connection failed: ${error.message}`);
      resolve({ success: false, error: error.message });
    });
    
    req.write(postData);
    req.end();
  });
}

// Check server.js file for API key endpoint
function verifyServerCodeHasEndpoint() {
  console.log('📁 Verifying server.js contains API key creation endpoint...');
  
  const serverFile = path.join(__dirname, 'server.js');
  
  if (!fs.existsSync(serverFile)) {
    console.log('❌ server.js file not found');
    return { success: false, error: 'server.js file not found' };
  }
  
  const serverContent = fs.readFileSync(serverFile, 'utf8');
  
  // Check for API key creation endpoint
  const hasEndpoint = serverContent.includes('/api/create_api_key') && 
                     serverContent.includes('/auth/create-api-key');
  
  if (hasEndpoint) {
    console.log('✅ server.js contains API key creation endpoint');
    
    // Find the endpoint in the code
    const endpointMatch = serverContent.match(/if \(method === 'POST' && \(pathname === '\/api\/create_api_key' \|\| pathname === '\/auth\/create-api-key'\)\) \{[\s\S]*?\}/);
    
    if (endpointMatch) {
      console.log('✅ Endpoint implementation found and appears complete');
      return { success: true, hasEndpoint: true, implementation: endpointMatch[0] };
    } else {
      console.log('⚠️  Endpoint declared but implementation may be incomplete');
      return { success: false, error: 'Endpoint implementation incomplete' };
    }
  } else {
    console.log('❌ server.js missing API key creation endpoint');
    return { success: false, hasEndpoint: false };
  }
}

// Generate deployment instructions
function generateDeploymentInstructions(localTest, prodTest, codeTest) {
  const instructions = `
# API Key Creation Infrastructure Fix - Deployment Instructions

## Problem Summary
- **Issue**: POST https://moilol.com/auth/create-api-key returns 404
- **Root Cause**: Production server running outdated code without API key creation endpoint
- **Impact**: Developer onboarding completely blocked
- **Severity**: HIGH - blocks new user acquisition

## Test Results
- Local endpoint: ${localTest.success ? '✅ WORKING' : '❌ FAILED'}
- Production endpoint: ${prodTest.success ? '✅ WORKING (fix not needed)' : '❌ FAILED (needs deployment)'}
- Code verification: ${codeTest.success ? '✅ ENDPOINT PRESENT' : '❌ ENDPOINT MISSING'}

## Deployment Steps

### 1. Backup Current State
\`\`\`bash
# On production server
cp server.js server.js.backup.$(date +%Y%m%d_%H%M%S)
cp -r data/ data.backup.$(date +%Y%m%d_%H%M%S)/
\`\`\`

### 2. Deploy Updated Code
\`\`\`bash
# Upload current server.js to production server
scp server.js user@moilol.com:/path/to/ic-mesh/
\`\`\`

### 3. Restart Production Service
\`\`\`bash
# On production server
# Stop existing service
pkill -f "node.*server.js" || systemctl stop ic-mesh

# Start new service  
nohup node server.js > server.log 2>&1 &
# OR if using systemd:
systemctl start ic-mesh
\`\`\`

### 4. Verify Deployment
\`\`\`bash
# Test the endpoint
curl -X POST "https://moilol.com/auth/create-api-key" \\
  -H "Content-Type: application/json" \\
  -d "{}"

# Expected response (200 status):
{
  "api_key": "ic_f3c54724501247a5954aa43ebf5f7232351440c8e57f7a87d3d2753275ac7664",
  "created": "2026-02-28T03:33:57.506Z",
  "note": "Store this API key securely. It will not be shown again.",
  "usage": "Include in X-Api-Key header or Authorization: Bearer <key>",
  "expires": "Never (until manually revoked)"
}
\`\`\`

## Rollback Procedure (if needed)
\`\`\`bash
# Stop new service
pkill -f "node.*server.js" || systemctl stop ic-mesh

# Restore backup
cp server.js.backup.[timestamp] server.js
cp -r data.backup.[timestamp]/* data/

# Restart old service
nohup node server.js > server.log 2>&1 &
\`\`\`

## Post-Deployment Verification Checklist
- [ ] API key creation endpoint returns 200 status
- [ ] Generated API keys work for job submission
- [ ] Existing functionality unaffected (status, nodes, jobs endpoints)
- [ ] No error logs in server.log
- [ ] Database integrity maintained

## Technical Details
The endpoint handles both \`/api/create_api_key\` and \`/auth/create-api-key\` paths and generates
API keys with format: \`ic_\` + 64 hex characters (67 characters total).

Generated: $(date)
`;

  return instructions;
}

// Main execution
async function main() {
  console.log('🚀 IC Mesh API Key Creation Infrastructure Fix');
  console.log('============================================\n');
  
  // Test local endpoint
  const localTest = await testLocalEndpoint();
  console.log();
  
  // Test production endpoint  
  const prodTest = await testProductionEndpoint();
  console.log();
  
  // Verify server code
  const codeTest = verifyServerCodeHasEndpoint();
  console.log();
  
  // Generate deployment instructions
  const instructions = generateDeploymentInstructions(localTest, prodTest, codeTest);
  
  const instructionsFile = path.join(__dirname, 'API_KEY_DEPLOYMENT_INSTRUCTIONS.md');
  fs.writeFileSync(instructionsFile, instructions);
  
  console.log(`📋 Deployment instructions written to: ${instructionsFile}`);
  console.log();
  
  // Summary
  console.log('📊 SUMMARY:');
  if (prodTest.success) {
    console.log('✅ Production endpoint already working - no deployment needed');
  } else if (localTest.success && codeTest.success) {
    console.log('🚨 DEPLOYMENT REQUIRED: Local code has working endpoint, production needs update');
    console.log('   → Follow deployment instructions in API_KEY_DEPLOYMENT_INSTRUCTIONS.md');
  } else if (!codeTest.success) {
    console.log('❌ CODE ISSUE: Server.js missing API key endpoint - code fix needed first');
  } else {
    console.log('❌ UNKNOWN ISSUE: Further investigation needed');
  }
  
  console.log(`\n🔍 Log this work to: memory/work-log/$(date +%Y-%m-%d)-wingman-api-key-fix.md`);
}

main().catch(console.error);