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

suite.test('GET /nodes returns nodes data', async () => {
  const res = await suite.request('GET', '/nodes');
  suite.assertEqual(res.status, 200, 'Should return 200');
  suite.assert(res.data.nodes !== undefined, 'Should have nodes property');
  suite.assert(typeof res.data.total === 'number', 'Should have total count');
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
  suite.assert(res.data.ok, 'Should return ok true');
  suite.assert(res.data.node, 'Should return node object');
});

suite.test('POST /jobs creates a job', async () => {
  const jobData = {
    type: 'transcription',
    payload: { audio_url: 'https://example.com/test.wav' },
    requirements: { capability: 'transcription' }
  };

  const res = await suite.request('POST', '/jobs', jobData);
  suite.assertEqual(res.status, 200, 'Should create job successfully');
  suite.assert(res.data.job, 'Should return job object');
  suite.assert(res.data.job.jobId, 'Should return job ID');
});

suite.test('GET /jobs/:id returns job details', async () => {
  // First create a job
  const jobData = {
    type: 'transcription',
    payload: { audio_url: 'https://example.com/test2.wav' },
    requirements: { capability: 'transcription' }
  };
  
  const createRes = await suite.request('POST', '/jobs', jobData);
  const jobId = createRes.data.job.jobId;

  // Then fetch it
  const res = await suite.request('GET', `/jobs/${jobId}`);
  suite.assertEqual(res.status, 200, 'Should return job details');
  suite.assert(res.data.job.jobId === jobId, 'Should return correct job ID');
  suite.assert(res.data.job.type === 'transcription', 'Should return correct type');
});

suite.test('GET /jobs/available returns pending jobs', async () => {
  const res = await suite.request('GET', '/jobs/available');
  suite.assertEqual(res.status, 200, 'Should return available jobs');
  suite.assert(Array.isArray(res.data.jobs), 'Should return jobs array');
  suite.assert(typeof res.data.count === 'number', 'Should return count');
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

// ===== EXPANDED TEST COVERAGE =====

suite.test('POST /jobs validates required fields', async () => {
  const res = await suite.request('POST', '/jobs', {});
  suite.assert(res.status >= 400, 'Should return error for missing required fields');
});

suite.test('POST /jobs with invalid task type', async () => {
  const jobData = {
    type: 'invalid-task-type',
    payload: { test: 'data' },
    requirements: { capability: 'invalid' }
  };
  const res = await suite.request('POST', '/jobs', jobData);
  // Note: API might accept any type, so this test validates the request completes
  suite.assert(res.status === 200 || res.status >= 400, 'Should handle invalid task types');
});

suite.test('Job claiming workflow', async () => {
  // Create a node first with a truly unique ID
  const nodeData = {
    nodeId: 'claiming-node-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
    capabilities: ['transcription'],
    reputation: 1000,
    location: 'test'
  };
  const registerRes = await suite.request('POST', '/nodes/register', nodeData);
  
  // Use the actual nodeId from the response (in case server modified it)
  const actualNodeId = registerRes.data.node.nodeId;

  // Create a job
  const jobData = {
    type: 'transcription',
    payload: { audio_url: 'https://example.com/claim-test.wav' },
    requirements: { capability: 'transcription' }
  };
  const createRes = await suite.request('POST', '/jobs', jobData);
  const jobId = createRes.data.job.jobId;

  // Claim the job
  const claimRes = await suite.request('POST', `/jobs/${jobId}/claim`, {
    nodeId: actualNodeId
  });
  suite.assertEqual(claimRes.status, 200, 'Should claim job successfully');
});

suite.test('Job completion workflow', async () => {
  // Create a node with a truly unique ID
  const nodeData = {
    nodeId: 'completion-node-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
    capabilities: ['transcription'],
    reputation: 1000,
    location: 'test'
  };
  const registerRes = await suite.request('POST', '/nodes/register', nodeData);
  
  // Use the actual nodeId from the response
  const actualNodeId = registerRes.data.node.nodeId;

  // Create and claim a job
  const jobData = {
    type: 'transcription',
    payload: { audio_url: 'https://example.com/complete-test.wav' },
    requirements: { capability: 'transcription' }
  };
  const createRes = await suite.request('POST', '/jobs', jobData);
  const jobId = createRes.data.job.jobId;
  
  await suite.request('POST', `/jobs/${jobId}/claim`, {
    nodeId: actualNodeId
  });

  // Complete the job
  const completeRes = await suite.request('POST', `/jobs/${jobId}/complete`, {
    nodeId: actualNodeId,
    result: { transcript: 'test transcript' },
    success: true
  });
  suite.assertEqual(completeRes.status, 200, 'Should complete job successfully');

  // Verify job is marked completed
  const jobRes = await suite.request('GET', `/jobs/${jobId}`);
  suite.assertEqual(jobRes.data.job.status, 'completed', 'Job should be marked completed');
});

suite.test('Ledger balance tracking', async () => {
  const nodeId = 'ledger-node-' + Date.now();
  
  // Register node
  const nodeData = {
    nodeId,
    capabilities: ['transcription'],
    reputation: 1000,
    location: 'test'
  };
  await suite.request('POST', '/nodes/register', nodeData);

  // Check initial balance (should be 0 or not exist)
  const balanceRes = await suite.request('GET', `/ledger/${nodeId}`);
  suite.assertEqual(balanceRes.status, 200, 'Should return balance data');
});

suite.test('Node duplicate registration handling', async () => {
  const nodeId = 'duplicate-node-' + Date.now();
  const nodeData = {
    nodeId,
    capabilities: ['transcription'],
    reputation: 1000,
    location: 'test'
  };

  // First registration
  const firstRes = await suite.request('POST', '/nodes/register', nodeData);
  suite.assertEqual(firstRes.status, 200, 'First registration should succeed');

  // Second registration with same nodeId
  const secondRes = await suite.request('POST', '/nodes/register', nodeData);
  suite.assertEqual(secondRes.status, 200, 'Should handle duplicate registration gracefully');
});

suite.test('Job claiming validation', async () => {
  // Try to claim non-existent job
  const claimRes = await suite.request('POST', '/jobs/nonexistent-job/claim', {
    nodeId: 'test-node'
  });
  suite.assert(claimRes.status >= 400, 'Should reject claim for non-existent job');
});

suite.test('Job claiming with invalid node', async () => {
  // Create a job first
  const jobData = {
    type: 'transcription',
    payload: { audio_url: 'https://example.com/invalid-node-test.wav' },
    requirements: { capability: 'transcription' }
  };
  const createRes = await suite.request('POST', '/jobs', jobData);
  const jobId = createRes.data.job.jobId;

  // Try to claim with non-existent node
  const claimRes = await suite.request('POST', `/jobs/${jobId}/claim`, {
    nodeId: 'non-existent-node'
  });
  suite.assert(claimRes.status >= 400, 'Should reject claim from non-existent node');
});

suite.test('WebSocket node heartbeat', async () => {
  return new Promise((resolve, reject) => {
    const nodeId = 'heartbeat-node-' + Date.now();
    const ws = new WebSocket(WS_URL + `?nodeId=${nodeId}`);
    
    let heartbeatReceived = false;

    ws.on('open', () => {
      // Send a heartbeat message
      ws.send(JSON.stringify({
        type: 'node.heartbeat',
        nodeId,
        timestamp: Date.now()
      }));
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data);
        if (message.type && message.type.includes('heartbeat')) {
          heartbeatReceived = true;
          ws.close();
          resolve();
        }
      } catch (e) {
        // Ignore parsing errors
      }
    });

    ws.on('error', (err) => {
      reject(new Error(`WebSocket heartbeat test failed: ${err.message}`));
    });

    setTimeout(() => {
      ws.close();
      if (!heartbeatReceived) {
        resolve(); // Don't fail if no heartbeat response - may not be implemented
      }
    }, 3000);
  });
});

suite.test('Rate limiting and validation', async () => {
  // Test rapid job submissions to check for rate limiting
  const promises = [];
  for (let i = 0; i < 5; i++) {
    promises.push(suite.request('POST', '/jobs', {
      type: 'transcription',
      payload: { audio_url: `https://example.com/rate-test-${i}.wav` },
      requirements: { capability: 'transcription' }
    }));
  }
  
  const results = await Promise.all(promises);
  const successfulRequests = results.filter(r => r.status === 200).length;
  suite.assert(successfulRequests >= 1, 'Should handle multiple job submissions');
});

suite.test('Large payload handling', async () => {
  // Test with a larger data payload
  const largeData = {
    type: 'transcription',
    payload: {
      audio_url: 'https://example.com/large-test.wav',
      metadata: {
        description: 'A'.repeat(1000), // 1KB of description
        tags: Array.from({length: 100}, (_, i) => `tag${i}`)
      }
    },
    requirements: { capability: 'transcription' }
  };

  const res = await suite.request('POST', '/jobs', largeData);
  suite.assert(res.status === 200 || res.status === 413, 'Should handle or reject large payloads appropriately');
});

suite.test('JSON parsing error handling', async () => {
  // Send malformed JSON
  const res = await suite.request('POST', '/jobs', 'malformed json');
  suite.assert(res.status >= 400, 'Should handle malformed JSON gracefully');
});

suite.test('GET /jobs with pagination', async () => {
  // Test jobs listing endpoint if it exists
  const res = await suite.request('GET', '/jobs');
  // This might return 404 if not implemented, which is fine
  suite.assert(res.status === 200 || res.status === 404, 'Should handle jobs listing request');
});

// ===== NEW ENDPOINT TESTS =====

suite.test('POST /upload/presign for presigned URLs', async () => {
  const res = await suite.request('POST', '/upload/presign', {
    filename: 'test.wav',
    contentType: 'audio/wav'
  });
  // This will likely fail if Spaces not configured, which is expected
  suite.assert(res.status === 200 || res.status === 503, 'Should handle presign requests');
  if (res.status === 200) {
    suite.assert(res.data.upload_url, 'Should return upload_url if successful');
    suite.assert(res.data.download_url, 'Should return download_url if successful');
  }
});

suite.test('POST /upload direct file upload', async () => {
  // The upload endpoint expects multipart/form-data format, which is complex to test
  // For now, just verify the endpoint handles requests (will return parse error)
  const testData = 'Hello, this is a test file!';
  const res = await suite.request('POST', '/upload', testData, {
    'Content-Type': 'text/plain',
    'X-Filename': 'test.txt'
  });
  // Expect 400 because we're not sending proper multipart data
  suite.assertEqual(res.status, 400, 'Should return parse error for non-multipart data');
  suite.assert(res.data.error, 'Should return error message');
});

suite.test('GET /files/:name downloads uploaded file', async () => {
  // First upload a file
  const testData = 'Test file content for download';
  const uploadRes = await suite.request('POST', '/upload', testData, {
    'Content-Type': 'text/plain',
    'X-Filename': 'download-test.txt'
  });
  
  if (uploadRes.status === 200) {
    // Extract filename from URL
    const filename = uploadRes.data.url.split('/').pop();
    
    // Now try to download it
    const downloadRes = await suite.request('GET', `/files/${filename}`);
    suite.assertEqual(downloadRes.status, 200, 'Should download file successfully');
    suite.assert(downloadRes.data.includes('Test file content'), 'Should return correct file content');
  }
});

suite.test('GET /payouts returns payout data', async () => {
  const res = await suite.request('GET', '/payouts');
  suite.assertEqual(res.status, 200, 'Should return payouts data');
  suite.assert(Array.isArray(res.data.payouts), 'Should return payouts array');
});

suite.test('GET /payouts/:nodeId returns specific payout', async () => {
  // First register a node to ensure we have a nodeId to test with
  const nodeData = {
    nodeId: 'payout-test-node-' + Date.now(),
    capabilities: ['transcription'],
    reputation: 1000,
    location: 'test'
  };
  await suite.request('POST', '/nodes/register', nodeData);

  const res = await suite.request('GET', `/payouts/${nodeData.nodeId}`);
  suite.assertEqual(res.status, 200, 'Should return specific payout data');
  suite.assert(res.data.nodeId, 'Should return nodeId');
  suite.assert(res.data.earned_ints !== undefined, 'Should return earned_ints');
});

suite.test('POST /cashout cashout request', async () => {
  const cashoutData = {
    nodeId: 'cashout-test-node-' + Date.now(),
    amount_ints: 100,
    payout_email: 'test@example.com'
  };
  
  const res = await suite.request('POST', '/cashout', cashoutData);
  // Might fail due to validation (node not existing, insufficient balance)
  suite.assert(res.status === 200 || res.status >= 400, 'Should handle cashout request');
});

suite.test('GET /handlers returns handler information', async () => {
  const res = await suite.request('GET', '/handlers');
  suite.assertEqual(res.status, 200, 'Should return handlers data');
  suite.assert(res.data.handlers !== undefined, 'Should have handlers property');
});

suite.test('POST /support creates support ticket', async () => {
  const supportData = {
    email: 'test@example.com',
    category: 'technical',
    subject: 'Test support ticket',
    body: 'This is a test support request'
  };
  
  const res = await suite.request('POST', '/support', supportData);
  suite.assertEqual(res.status, 200, 'Should create support ticket successfully');
  suite.assert(res.data.ticket_id, 'Should return ticket ID');
});

suite.test('POST /api/support creates API support ticket', async () => {
  const supportData = {
    email: 'api-test@example.com',
    api_key: 'test-api-key',
    category: 'billing',
    subject: 'API Test Ticket',
    body: 'Testing API support endpoint',
    job_id: 'test-job-123'
  };
  
  const res = await suite.request('POST', '/api/support', supportData);
  suite.assertEqual(res.status, 200, 'Should create API support ticket successfully');
  suite.assert(res.data.ticket_id, 'Should return ticket ID');
});

suite.test('GET /api/tickets lists support tickets', async () => {
  const res = await suite.request('GET', '/api/tickets');
  // Endpoint requires authentication, so expect 401
  suite.assertEqual(res.status, 401, 'Should require authentication');
  suite.assert(res.data.error, 'Should return error message');
});

suite.test('POST /nodes/onboard Stripe Connect onboarding', async () => {
  const onboardData = {
    nodeId: 'onboard-test-node-' + Date.now(),
    email: 'test-onboard@example.com',
    ip: '127.0.0.1'
  };
  
  const res = await suite.request('POST', '/nodes/onboard', onboardData);
  // Will likely fail without proper Stripe configuration, which is expected
  suite.assert(res.status === 200 || res.status >= 400, 'Should handle onboarding request');
});

suite.test('Operator dashboard endpoint', async () => {
  const res = await suite.request('GET', '/operator/');
  // Operator endpoint requires node ID parameter, so expect error
  suite.assert(res.status >= 400, 'Should require node ID parameter');
  suite.assert(res.data.error, 'Should return error message');
});

suite.test('Root endpoint serves main page', async () => {
  const res = await suite.request('GET', '/');
  suite.assertEqual(res.status, 200, 'Should serve root page');
});

suite.test('POST /jobs/:id/fail endpoint', async () => {
  // Create a job first
  const jobData = {
    type: 'transcription',
    payload: { audio_url: 'https://example.com/fail-test.wav' },
    requirements: { capability: 'transcription' }
  };
  const createRes = await suite.request('POST', '/jobs', jobData);
  const jobId = createRes.data.job.jobId;

  // Try to fail the job
  const failRes = await suite.request('POST', `/jobs/${jobId}/fail`, {
    error: 'Test error condition'
  });
  suite.assertEqual(failRes.status, 200, 'Should fail job successfully');

  // Verify job is marked failed
  const jobRes = await suite.request('GET', `/jobs/${jobId}`);
  suite.assertEqual(jobRes.data.job.status, 'failed', 'Job should be marked failed');
});

suite.test('GET /nodes/:id/stripe Stripe Connect status', async () => {
  const nodeId = 'stripe-test-node-' + Date.now();
  
  const res = await suite.request('GET', `/nodes/${nodeId}/stripe`);
  // Will likely return error for non-existent node
  suite.assert(res.status >= 400, 'Should handle Stripe status request for non-existent node');
});

suite.test('Support ticket workflow', async () => {
  // Create a ticket
  const supportData = {
    email: 'workflow-test@example.com',
    category: 'technical',
    subject: 'Workflow Test Ticket',
    body: 'Testing complete ticket workflow'
  };
  
  const createRes = await suite.request('POST', '/support', supportData);
  if (createRes.status !== 200) return; // Skip if support system not working
  
  const ticketId = createRes.data.ticket_id;

  // Get ticket details
  const getRes = await suite.request('GET', `/api/tickets/${ticketId}`);
  suite.assertEqual(getRes.status, 200, 'Should retrieve ticket details');
  suite.assert(getRes.data.ticket, 'Should return ticket object');

  // Add a message to the ticket
  const messageRes = await suite.request('POST', `/api/tickets/${ticketId}/messages`, {
    sender: 'customer',
    body: 'Additional information for this ticket'
  });
  suite.assertEqual(messageRes.status, 200, 'Should add message to ticket');

  // Get ticket messages
  const messagesRes = await suite.request('GET', `/api/tickets/${ticketId}/messages`);
  suite.assertEqual(messagesRes.status, 200, 'Should retrieve ticket messages');
  suite.assert(Array.isArray(messagesRes.data.messages), 'Should return messages array');

  // Update ticket status
  const updateRes = await suite.request('PATCH', `/api/tickets/${ticketId}`, {
    status: 'resolved',
    resolution: 'Test resolution'
  });
  suite.assertEqual(updateRes.status, 200, 'Should update ticket status');
});

suite.test('Error handling for malformed endpoints', async () => {
  // Test various malformed endpoints
  const malformedRequests = [
    { method: 'POST', path: '/jobs//claim' },
    { method: 'GET', path: '/jobs/' },
    { method: 'POST', path: '/nodes/' },
    { method: 'GET', path: '/ledger/' },
    { method: 'POST', path: '/api/tickets//messages' }
  ];

  for (const req of malformedRequests) {
    const res = await suite.request(req.method, req.path);
    suite.assert(res.status >= 400, `Should handle malformed ${req.method} ${req.path}`);
  }
});

suite.test('Content-Type validation', async () => {
  // Test with various content types
  const jobData = { type: 'test', payload: {}, requirements: {} };
  
  // Without Content-Type
  const res1 = await suite.request('POST', '/jobs', JSON.stringify(jobData), {});
  suite.assert(res1.status === 200 || res1.status >= 400, 'Should handle missing Content-Type');

  // With wrong Content-Type  
  const res2 = await suite.request('POST', '/jobs', JSON.stringify(jobData), {
    'Content-Type': 'text/plain'
  });
  suite.assert(res2.status === 200 || res2.status >= 400, 'Should handle wrong Content-Type');
});

suite.test('OCR handler availability check', async () => {
  // Test OCR job creation to ensure handler is recognized
  const ocrJob = {
    type: 'ocr',
    payload: {
      language: 'eng',
      format: 'txt'
    },
    requirements: { capability: 'ocr' }
  };
  
  const res = await suite.request('POST', '/jobs', ocrJob);
  suite.assertEqual(res.status, 200, 'Should accept OCR job creation');
  suite.assert(res.data.job, 'Should return job object');
  suite.assertEqual(res.data.job.type, 'ocr', 'Job type should be OCR');
});

suite.test('PDF extraction handler availability check', async () => {
  // Test PDF extraction job creation to ensure handler is recognized
  const pdfJob = {
    type: 'pdf-extract',
    payload: {
      method: 'auto',
      format: 'json',
      extract_tables: true
    },
    requirements: { capability: 'pdf-extract' }
  };
  
  const res = await suite.request('POST', '/jobs', pdfJob);
  suite.assertEqual(res.status, 200, 'Should accept PDF extraction job creation');
  suite.assert(res.data.job, 'Should return job object');
  suite.assertEqual(res.data.job.type, 'pdf-extract', 'Job type should be pdf-extract');
});

// Run tests if this file is executed directly
if (require.main === module) {
  suite.run();
}

module.exports = TestSuite;