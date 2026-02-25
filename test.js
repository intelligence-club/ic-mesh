#!/usr/bin/env node
/**
 * IC Mesh Test Suite
 * 
 * Basic integration tests for API endpoints
 */

const http = require('http');
const { WebSocket } = require('ws');

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
    console.log('🧪 IC Mesh Test Suite\n');
    
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
    }

    console.log(`\n📊 Results: ${this.passed} passed, ${this.failed} failed`);
    process.exit(this.failed > 0 ? 1 : 0);
  }

  async request(method, path, data = null, headers = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, BASE_URL);
      const options = {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers
        }
      };

      const req = http.request(url, options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const parsed = body ? JSON.parse(body) : null;
            resolve({ status: res.statusCode, data: parsed, headers: res.headers });
          } catch {
            resolve({ status: res.statusCode, data: body, headers: res.headers });
          }
        });
      });

      req.on('error', reject);
      
      if (data) {
        req.write(typeof data === 'string' ? data : JSON.stringify(data));
      }
      
      req.end();
    });
  }

  assert(condition, message) {
    if (!condition) {
      throw new Error(message);
    }
  }

  assertEqual(actual, expected, message) {
    if (actual !== expected) {
      throw new Error(message || `Expected ${expected}, got ${actual}`);
    }
  }
}

// ===== TESTS =====

const suite = new TestSuite();

suite.test('GET /status returns network status', async () => {
  const res = await suite.request('GET', '/status');
  suite.assertEqual(res.status, 200, 'Should return 200');
  suite.assert(res.data.nodes !== undefined, 'Should have nodes count');
  suite.assert(res.data.jobs !== undefined, 'Should have jobs count');
});

suite.test('GET /nodes returns empty array initially', async () => {
  const res = await suite.request('GET', '/nodes');
  suite.assertEqual(res.status, 200, 'Should return 200');
  suite.assert(Array.isArray(res.data), 'Should return an array');
});

suite.test('POST /nodes/register creates a node', async () => {
  const nodeData = {
    nodeId: 'test-node-' + Date.now(),
    capabilities: ['transcription'],
    reputation: 1000,
    location: 'test'
  };

  const res = await suite.request('POST', '/nodes/register', nodeData);
  suite.assertEqual(res.status, 200, 'Should create node successfully');
  suite.assert(res.data.success, 'Should return success true');
});

suite.test('POST /jobs creates a job', async () => {
  const jobData = {
    task: 'transcription',
    data: { audio_url: 'https://example.com/test.wav' },
    maxCost: 100
  };

  const res = await suite.request('POST', '/jobs', jobData);
  suite.assertEqual(res.status, 200, 'Should create job successfully');
  suite.assert(res.data.jobId, 'Should return job ID');
});

suite.test('GET /jobs/:id returns job details', async () => {
  // First create a job
  const jobData = {
    task: 'transcription',
    data: { audio_url: 'https://example.com/test2.wav' },
    maxCost: 100
  };
  
  const createRes = await suite.request('POST', '/jobs', jobData);
  const jobId = createRes.data.jobId;

  // Then fetch it
  const res = await suite.request('GET', `/jobs/${jobId}`);
  suite.assertEqual(res.status, 200, 'Should return job details');
  suite.assert(res.data.jobId === jobId, 'Should return correct job ID');
  suite.assert(res.data.task === 'transcription', 'Should return correct task');
});

suite.test('GET /jobs/available returns pending jobs', async () => {
  const res = await suite.request('GET', '/jobs/available');
  suite.assertEqual(res.status, 200, 'Should return available jobs');
  suite.assert(Array.isArray(res.data), 'Should return an array');
});

suite.test('WebSocket connection works', async () => {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL + '?nodeId=test-ws-node');
    
    ws.on('open', () => {
      ws.close();
      resolve();
    });

    ws.on('error', (err) => {
      reject(new Error(`WebSocket connection failed: ${err.message}`));
    });

    setTimeout(() => {
      ws.close();
      reject(new Error('WebSocket connection timeout'));
    }, 5000);
  });
});

suite.test('Invalid endpoints return 404', async () => {
  const res = await suite.request('GET', '/nonexistent');
  suite.assertEqual(res.status, 404, 'Should return 404 for invalid endpoint');
});

// Run tests if this file is executed directly
if (require.main === module) {
  suite.run();
}

module.exports = TestSuite;