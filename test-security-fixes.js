#!/usr/bin/env node
/**
 * Security Vulnerability Fix Verification Tests
 * Tests the fixes for the 4 critical vulnerabilities found by companion audit
 */

const http = require('http');
const BASE_URL = 'http://localhost:8333';

let testsPassed = 0;
let testsFailed = 0;

function log(message) {
  console.log(`🔍 ${message}`);
}

function logPass(test) {
  console.log(`✅ ${test}`);
  testsPassed++;
}

function logFail(test, error) {
  console.log(`❌ ${test}: ${error}`);
  testsFailed++;
}

async function makeRequest(method, path, data = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 8333,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
      }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ status: res.statusCode, data: parsed });
        } catch {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });

    req.on('error', reject);
    
    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

async function testNegativePriceRejection() {
  try {
    const result = await makeRequest('POST', '/jobs', {
      type: 'transcribe',
      payload: {
        audio_url: 'https://example.com/test.wav',
        price_ints: -1000 // Negative price - should be rejected
      }
    });

    if (result.status === 400 && result.data.error.includes('Invalid price_ints')) {
      logPass('Negative price_ints rejected correctly');
    } else {
      logFail('Negative price_ints test', `Expected 400 error, got ${result.status}: ${JSON.stringify(result.data)}`);
    }
  } catch (error) {
    logFail('Negative price_ints test', error.message);
  }
}

async function testExcessivePriceRejection() {
  try {
    const result = await makeRequest('POST', '/jobs', {
      type: 'transcribe',
      payload: {
        audio_url: 'https://example.com/test.wav',
        price_ints: 999999999999 // Excessive price - should be rejected
      }
    });

    if (result.status === 400 && result.data.error.includes('Price too high')) {
      logPass('Excessive price_ints rejected correctly');
    } else {
      logFail('Excessive price_ints test', `Expected 400 error, got ${result.status}: ${JSON.stringify(result.data)}`);
    }
  } catch (error) {
    logFail('Excessive price_ints test', error.message);
  }
}

async function testValidPriceAccepted() {
  try {
    const result = await makeRequest('POST', '/jobs', {
      type: 'transcribe',
      payload: {
        audio_url: 'https://example.com/test.wav',
        price_ints: 500 // Valid price - should be accepted
      }
    });

    if (result.status === 200 && result.data.ok) {
      logPass('Valid price_ints accepted correctly');
    } else {
      logFail('Valid price_ints test', `Expected 200 success, got ${result.status}: ${JSON.stringify(result.data)}`);
    }
  } catch (error) {
    logFail('Valid price_ints test', error.message);
  }
}

async function testNodeRegistrationRateLimit() {
  try {
    // Try to register many nodes rapidly from same IP
    const registrations = [];
    for (let i = 0; i < 12; i++) {
      registrations.push(makeRequest('POST', '/nodes/register', {
        name: `test-node-${i}`,
        capabilities: ['transcribe'],
        owner: `test-owner-${i}`
      }));
    }

    const results = await Promise.all(registrations);
    const rejectedCount = results.filter(r => r.status === 400).length;

    if (rejectedCount > 0) {
      logPass(`Node registration rate limiting working (${rejectedCount} requests rejected)`);
    } else {
      logFail('Node registration rate limit test', 'Expected some registrations to be rejected');
    }
  } catch (error) {
    logFail('Node registration rate limit test', error.message);
  }
}

async function testNodeRegistrationValidation() {
  try {
    const result = await makeRequest('POST', '/nodes/register', {
      name: '', // Invalid empty name
      capabilities: ['transcribe'],
      owner: 'test-owner'
    });

    if (result.status === 400 && result.data.error.includes('Node name is required')) {
      logPass('Node registration validation working');
    } else {
      logFail('Node registration validation test', `Expected 400 error, got ${result.status}: ${JSON.stringify(result.data)}`);
    }
  } catch (error) {
    logFail('Node registration validation test', error.message);
  }
}

async function runSecurityTests() {
  console.log('🔐 Running Security Vulnerability Fix Tests\n');

  await testNegativePriceRejection();
  await testExcessivePriceRejection();
  await testValidPriceAccepted();
  await testNodeRegistrationRateLimit();
  await testNodeRegistrationValidation();

  console.log(`\n📊 Security Test Results: ${testsPassed} passed, ${testsFailed} failed`);
  
  if (testsFailed === 0) {
    console.log('🎉 All security fixes working correctly!');
    process.exit(0);
  } else {
    console.log('🚨 Some security tests failed - review fixes needed');
    process.exit(1);
  }
}

runSecurityTests().catch(error => {
  console.error('Security test error:', error);
  process.exit(1);
});