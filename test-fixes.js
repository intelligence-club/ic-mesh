#!/usr/bin/env node

// Simple test to verify that our fixes work
const http = require('http');

async function request(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: 8333,
      path,
      method,
      headers: { 'Content-Type': 'application/json', ...headers }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            data: JSON.parse(data)
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            data: data
          });
        }
      });
    });
    
    req.on('error', reject);
    
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function testFixes() {
  console.log('🧪 Testing fixes for IC Mesh\n');

  // Test 1: Node duplicate registration
  console.log('TEST 1: Node duplicate registration handling');
  const nodeName = 'fix-test-node-' + Date.now();
  const nodeData = {
    name: nodeName,
    capabilities: ['whisper'],
    reputation: 1000,
    location: 'test'
  };

  try {
    console.log('  First registration...');
    const firstRes = await request('POST', '/nodes/register', nodeData);
    console.log(`  Status: ${firstRes.status}, Success: ${firstRes.status === 200}`);

    if (firstRes.status === 200) {
      console.log('  Second registration...');
      // Wait a moment to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const secondRes = await request('POST', '/nodes/register', nodeData);
      console.log(`  Status: ${secondRes.status}, Success: ${secondRes.status === 200}`);
      console.log(`  ✅ Duplicate registration test: ${secondRes.status === 200 ? 'PASSED' : 'FAILED'}`);
    } else {
      console.log(`  ❌ Could not perform duplicate test, first registration failed: ${JSON.stringify(firstRes.data)}`);
    }
  } catch (e) {
    console.log(`  ❌ Duplicate registration test error: ${e.message}`);
  }

  console.log('\n');

  // Test 2: /api/tickets authentication
  console.log('TEST 2: /api/tickets authentication');
  
  try {
    console.log('  Testing without auth header...');
    const noAuthRes = await request('GET', '/api/tickets');
    console.log(`  Status: ${noAuthRes.status}, Expected: 401, Success: ${noAuthRes.status === 401}`);
    
    console.log('  Testing with correct auth header...');
    const withAuthRes = await request('GET', '/api/tickets', null, { 'x-admin-key': process.env.ADMIN_KEY });
    console.log(`  Status: ${withAuthRes.status}, Expected: 200, Success: ${withAuthRes.status === 200}`);
    
    const authTestPassed = (noAuthRes.status === 401) && (withAuthRes.status === 200);
    console.log(`  ✅ Authentication test: ${authTestPassed ? 'PASSED' : 'FAILED'}`);
    
    if (!authTestPassed) {
      console.log('  Debug info:');
      console.log(`    No auth response: ${JSON.stringify(noAuthRes.data).substr(0, 100)}...`);
      console.log(`    With auth response type: ${typeof withAuthRes.data}`);
    }
  } catch (e) {
    console.log(`  ❌ Authentication test error: ${e.message}`);
  }

  console.log('\n🏁 Test complete');
}

testFixes().catch(console.error);