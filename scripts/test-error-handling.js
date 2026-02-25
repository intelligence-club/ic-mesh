#!/usr/bin/env node
/**
 * IC Mesh Error Handling Test
 * 
 * Tests various error scenarios to ensure proper logging and recovery
 */

const http = require('http');

const HOST = process.env.IC_MESH_HOST || 'localhost';
const PORT = process.env.IC_MESH_PORT || 8333;

console.log('🧪 Testing IC Mesh Error Handling\n');

async function testEndpoint(method, path, body = null, headers = {}) {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: HOST,
      port: PORT,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed });
        } catch {
          resolve({ status: res.statusCode, data: data.substring(0, 200) });
        }
      });
    });
    
    req.on('error', (err) => resolve({ status: 0, error: err.message }));
    
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  const tests = [
    {
      name: 'Invalid JSON in job submission',
      test: () => testEndpoint('POST', '/jobs', 'invalid json'),
    },
    {
      name: 'Missing required fields',
      test: () => testEndpoint('POST', '/jobs', {}),
    },
    {
      name: 'Non-existent job ID',
      test: () => testEndpoint('GET', '/jobs/nonexistent-job-id'),
    },
    {
      name: 'Invalid node registration',
      test: () => testEndpoint('POST', '/nodes/register', { invalid: 'data' }),
    },
    {
      name: 'Malformed upload request',
      test: () => testEndpoint('POST', '/upload', null, { 'Content-Type': 'multipart/form-data' }),
    },
    {
      name: 'Invalid presign request',
      test: () => testEndpoint('POST', '/upload/presign', { invalid: 'data' }),
    },
    {
      name: 'Non-existent endpoint',
      test: () => testEndpoint('GET', '/nonexistent'),
    }
  ];
  
  console.log(`Running ${tests.length} error handling tests...\n`);
  
  for (const test of tests) {
    try {
      const result = await test.test();
      const status = result.status === 0 ? 'CONNECTION_ERROR' : result.status;
      console.log(`${status >= 400 ? '✅' : '⚠️'} ${test.name}: ${status}`);
      
      if (result.status === 0) {
        console.log(`   Error: ${result.error}`);
      } else if (result.status < 400) {
        console.log(`   ⚠️  Expected error but got success: ${JSON.stringify(result.data).substring(0, 100)}`);
      }
    } catch (err) {
      console.log(`❌ ${test.name}: Test failed - ${err.message}`);
    }
  }
  
  console.log('\n📊 Error handling test complete');
  console.log('   ✅ = Proper error response received');
  console.log('   ⚠️  = Unexpected success or connection issue');
  console.log('   ❌ = Test execution failure');
}

if (require.main === module) {
  runTests().catch(console.error);
}

module.exports = { testEndpoint, runTests };