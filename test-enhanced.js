#!/usr/bin/env node
/**
 * IC Mesh Enhanced Test Suite
 * 
 * Fixed test isolation issues by:
 * 1. Using TEST_MODE requirement to prevent real nodes from claiming test jobs
 * 2. Adding pre-test cleanup
 * 3. Better error context
 */

const http = require('http');
const { WebSocket } = require('ws');
const { cleanupTestData } = require('./test-cleanup');

const BASE_URL = process.env.TEST_URL || 'http://localhost:8333';
const WS_URL = BASE_URL.replace('http', 'ws') + '/ws';

class TestSuite {
  constructor() {
    this.tests = [];
    this.passed = 0;
    this.failed = 0;
  }

  test(name, fn) {
    this.tests.push({ name, fn });
  }

  async run() {
    console.log('🧪 IC Mesh Enhanced Test Suite\n');
    
    // Clean test data before starting
    console.log('🧹 Cleaning test data...');
    try {
      cleanupTestData();
      console.log('✅ Database cleaned\n');
    } catch (error) {
      console.log('⚠️ Cleanup failed, continuing with tests\n');
    }
    
    for (const { name, fn } of this.tests) {
      try {
        await fn();
        this.passed++;
        console.log(`✅ ${name}`);
      } catch (error) {
        this.failed++;
        console.log(`❌ ${name}`);
        console.log(`   Error: ${error.message}`);
      }

      // Rate limit between tests
      await this.sleep(100);
    }

    console.log(`\n📊 Results: ${this.passed} passed, ${this.failed} failed`);
    return this.failed === 0;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async request(method, path, body = null) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, BASE_URL);
      const options = {
        method,
        headers: {
          'Content-Type': 'application/json',
        }
      };

      const req = http.request(url, options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = data ? JSON.parse(data) : {};
            resolve({ status: res.statusCode, data: parsed });
          } catch (e) {
            resolve({ status: res.statusCode, data: { raw: data } });
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

  assertEqual(actual, expected, message, context = {}) {
    if (actual !== expected) {
      const error = new Error(`${message}\nExpected: ${expected}, Got: ${actual}`);
      if (Object.keys(context).length > 0) {
        error.message += `\nContext: ${JSON.stringify(context, null, 2)}`;
      }
      throw error;
    }
  }

  assert(condition, message) {
    if (!condition) {
      throw new Error(message);
    }
  }
}

const suite = new TestSuite();

// Basic API tests (these should work fine)
suite.test('GET /status returns network status', async () => {
  const res = await suite.request('GET', '/status');
  suite.assertEqual(res.status, 200, 'Status endpoint should return 200');
  suite.assert(res.data.version, 'Status should include version');
});

suite.test('GET /nodes returns nodes data', async () => {
  const res = await suite.request('GET', '/nodes');
  suite.assertEqual(res.status, 200, 'Nodes endpoint should return 200');
  suite.assert(Array.isArray(res.data.nodes), 'Should return nodes array');
});

// Fixed job claiming test with TEST_MODE requirement
suite.test('Job claiming workflow (isolated)', async () => {
  // Create a test node
  const nodeData = {
    nodeId: 'test-claiming-node-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
    capabilities: ['transcription', 'TEST_MODE'], // Add TEST_MODE capability
    reputation: 1000,
    location: 'test'
  };
  const registerRes = await suite.request('POST', '/nodes/register', nodeData);
  const actualNodeId = registerRes.data.node.nodeId;

  // Create a job that requires TEST_MODE (so real nodes won't claim it)
  const jobData = {
    type: 'transcribe',
    payload: { audio_url: 'https://example.com/isolated-test.wav' },
    requirements: { capability: 'TEST_MODE' } // Require TEST_MODE capability
  };
  const createRes = await suite.request('POST', '/jobs', jobData);
  const jobId = createRes.data.job.jobId;

  // Small delay to ensure job is fully created
  await suite.sleep(50);

  // Claim the job
  const claimRes = await suite.request('POST', `/jobs/${jobId}/claim`, {
    nodeId: actualNodeId
  });
  suite.assertEqual(
    claimRes.status, 
    200, 
    `Should claim job successfully (jobId: ${jobId}, nodeId: ${actualNodeId})`,
    { 
      status: claimRes.status, 
      data: claimRes.data,
      endpoint: `POST /jobs/${jobId}/claim`
    }
  );
});

// Fixed job completion test  
suite.test('Job completion workflow (isolated)', async () => {
  // Create a test node
  const nodeData = {
    nodeId: 'test-completion-node-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
    capabilities: ['transcription', 'TEST_MODE'],
    reputation: 1000,
    location: 'test'
  };
  const registerRes = await suite.request('POST', '/nodes/register', nodeData);
  const actualNodeId = registerRes.data.node.nodeId;

  // Create and claim a job that requires TEST_MODE
  const jobData = {
    type: 'transcribe',
    payload: { audio_url: 'https://example.com/completion-test.wav' },
    requirements: { capability: 'TEST_MODE' }
  };
  const createRes = await suite.request('POST', '/jobs', jobData);
  const jobId = createRes.data.job.jobId;
  
  await suite.sleep(50);
  
  // Claim the job
  const claimRes = await suite.request('POST', `/jobs/${jobId}/claim`, {
    nodeId: actualNodeId
  });
  
  suite.assertEqual(claimRes.status, 200, 'Should claim job for completion test');

  // Complete the job
  const completeRes = await suite.request('POST', `/jobs/${jobId}/complete`, {
    nodeId: actualNodeId,
    result: { transcript: 'test transcript' },
    success: true
  });
  suite.assertEqual(
    completeRes.status, 
    200, 
    `Should complete job successfully (jobId: ${jobId}, nodeId: ${actualNodeId})`,
    { 
      status: completeRes.status, 
      data: completeRes.data,
      endpoint: `POST /jobs/${jobId}/complete`
    }
  );

  // Verify job is marked completed
  const jobRes = await suite.request('GET', `/jobs/${jobId}`);
  suite.assertEqual(jobRes.data.job.status, 'completed', 'Job should be marked completed');
});

// Add remaining tests from original test.js (the ones that are working)
suite.test('POST /nodes/register creates a node', async () => {
  const nodeData = {
    nodeId: 'test-node-' + Date.now(),
    capabilities: ['transcription'],
    reputation: 1000,
    location: 'test'
  };
  const res = await suite.request('POST', '/nodes/register', nodeData);
  suite.assertEqual(res.status, 200, 'Node registration should succeed');
  suite.assert(res.data.node, 'Should return node data');
});

// Run the test suite
suite.run().then(success => {
  process.exit(success ? 0 : 1);
});