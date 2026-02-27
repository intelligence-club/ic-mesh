#!/usr/bin/env node
/**
 * 🔍 COMPANION ADVERSARIAL ATTACK
 * Target: Job claiming and completion system
 * Focus: Race conditions, payment calc, auth bypass, edge cases
 */

const http = require('http');
const crypto = require('crypto');

const MESH_URL = 'http://localhost:8333';

class MeshAttacker {
  constructor() {
    this.findings = [];
    this.testJobs = [];
    this.fakeNodes = [];
  }

  log(severity, title, details) {
    const finding = { severity, title, details, timestamp: new Date().toISOString() };
    this.findings.push(finding);
    console.log(`[${severity}] ${title}: ${details}`);
  }

  async httpRequest(method, path, data = null, headers = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, MESH_URL);
      const options = {
        method,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        headers: {
          'Content-Type': 'application/json',
          ...headers
        }
      };

      const req = http.request(options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            resolve({ status: res.statusCode, data: parsed, headers: res.headers });
          } catch (e) {
            resolve({ status: res.statusCode, data: body, headers: res.headers });
          }
        });
      });

      req.on('error', reject);
      if (data) req.write(JSON.stringify(data));
      req.end();
    });
  }

  // 🎯 ATTACK 1: Race condition in job claiming
  async attackRaceConditions() {
    this.log('INFO', 'ATTACK 1', 'Testing race conditions in job claiming');
    
    try {
      // Create a test job
      const jobResponse = await this.httpRequest('POST', '/jobs', {
        type: 'test-race',
        payload: { test: 'race-condition' },
        requirements: { capability: 'test' }
      });
      
      if (jobResponse.status !== 200) {
        this.log('ERROR', 'Job Creation Failed', `Status: ${jobResponse.status}`);
        return;
      }

      const jobId = jobResponse.data.job.jobId;
      this.testJobs.push(jobId);
      
      // Create multiple fake nodes
      const nodeIds = [];
      for (let i = 0; i < 5; i++) {
        const nodeId = `race-node-${crypto.randomBytes(4).toString('hex')}`;
        await this.httpRequest('POST', '/nodes/register', {
          nodeId,
          name: `Race Test Node ${i}`,
          capabilities: ['test'],
          models: [],
          cpuCores: 4,
          ramMB: 8192,
          owner: 'attacker'
        });
        nodeIds.push(nodeId);
        this.fakeNodes.push(nodeId);
      }

      // Attempt simultaneous claims
      const claimPromises = nodeIds.map(nodeId => 
        this.httpRequest('POST', `/jobs/${jobId}/claim`, { nodeId })
      );
      
      const results = await Promise.all(claimPromises);
      const successful = results.filter(r => r.status === 200);
      
      if (successful.length > 1) {
        this.log('CRITICAL', 'Race Condition Found', 
          `Multiple nodes (${successful.length}) successfully claimed the same job ${jobId}`);
      } else if (successful.length === 1) {
        this.log('GOOD', 'Race Protection Works', 'Only one node could claim the job');
      } else {
        this.log('WARNING', 'No Claims Succeeded', 'Unexpected: no nodes could claim');
      }
      
    } catch (error) {
      this.log('ERROR', 'Race Attack Failed', error.message);
    }
  }

  // 🎯 ATTACK 2: Payment calculation manipulation
  async attackPaymentCalculation() {
    this.log('INFO', 'ATTACK 2', 'Testing payment calculation vulnerabilities');
    
    try {
      // Create job with extreme payment values
      const extremeJobResponse = await this.httpRequest('POST', '/jobs', {
        type: 'test-payment',
        payload: { 
          price_ints: Number.MAX_SAFE_INTEGER,
          test: 'extreme-payment' 
        },
        requirements: { capability: 'test' }
      });
      
      if (extremeJobResponse.status === 200) {
        const jobId = extremeJobResponse.data.job.jobId;
        this.testJobs.push(jobId);
        
        const nodeId = `payment-node-${crypto.randomBytes(4).toString('hex')}`;
        await this.httpRequest('POST', '/nodes/register', {
          nodeId,
          name: 'Payment Attack Node',
          capabilities: ['test'],
          models: [],
          cpuCores: 4,
          ramMB: 8192,
          owner: 'attacker'
        });
        this.fakeNodes.push(nodeId);
        
        // Claim and complete with extreme values
        const claimResponse = await this.httpRequest('POST', `/jobs/${jobId}/claim`, { nodeId });
        if (claimResponse.status === 200) {
          const completeResponse = await this.httpRequest('POST', `/jobs/${jobId}/complete`, {
            nodeId,
            data: { result: 'completed' }
          });
          
          if (completeResponse.status === 200) {
            this.log('CRITICAL', 'Extreme Payment Accepted', 
              `Job completed with price_ints: ${Number.MAX_SAFE_INTEGER}. Check for integer overflow!`);
          }
        }
      }
      
      // Test negative payment values
      const negativeJobResponse = await this.httpRequest('POST', '/jobs', {
        type: 'test-negative-payment',
        payload: { 
          price_ints: -1000,
          test: 'negative-payment' 
        },
        requirements: { capability: 'test' }
      });
      
      if (negativeJobResponse.status === 200) {
        this.log('WARNING', 'Negative Payment Accepted', 'System accepted negative price_ints value');
      }
      
    } catch (error) {
      this.log('ERROR', 'Payment Attack Failed', error.message);
    }
  }

  // 🎯 ATTACK 3: Authentication bypass attempts  
  async attackAuthentication() {
    this.log('INFO', 'ATTACK 3', 'Testing authentication bypass attempts');
    
    try {
      // Create a legitimate job
      const jobResponse = await this.httpRequest('POST', '/jobs', {
        type: 'test-auth',
        payload: { test: 'auth-bypass' },
        requirements: { capability: 'test' }
      });
      
      if (jobResponse.status !== 200) return;
      
      const jobId = jobResponse.data.job.jobId;
      this.testJobs.push(jobId);
      
      // Register legitimate node
      const legit_nodeId = `legit-node-${crypto.randomBytes(4).toString('hex')}`;
      await this.httpRequest('POST', '/nodes/register', {
        nodeId: legit_nodeId,
        name: 'Legitimate Node',
        capabilities: ['test'],
        models: [],
        cpuCores: 4,
        ramMB: 8192,
        owner: 'legitimate'
      });
      this.fakeNodes.push(legit_nodeId);
      
      // Claim job with legitimate node
      await this.httpRequest('POST', `/jobs/${jobId}/claim`, { nodeId: legit_nodeId });
      
      // Try to complete with DIFFERENT nodeId (impersonation attack)
      const fake_nodeId = `imposter-${crypto.randomBytes(4).toString('hex')}`;
      const impersonateResponse = await this.httpRequest('POST', `/jobs/${jobId}/complete`, {
        nodeId: fake_nodeId,
        data: { result: 'impersonated completion!' }
      });
      
      if (impersonateResponse.status === 200) {
        this.log('CRITICAL', 'Authentication Bypass Found', 
          `Job ${jobId} claimed by ${legit_nodeId} but completed by unregistered ${fake_nodeId}!`);
      } else if (impersonateResponse.status === 403) {
        this.log('GOOD', 'Auth Protection Works', 'Impersonation attempt correctly rejected');
      }
      
    } catch (error) {
      this.log('ERROR', 'Auth Attack Failed', error.message);
    }
  }

  // 🎯 ATTACK 4: JSON payload manipulation
  async attackPayloadManipulation() {
    this.log('INFO', 'ATTACK 4', 'Testing JSON payload manipulation attacks');
    
    try {
      // Test JSON injection in payload
      const maliciousPayloads = [
        { __proto__: { isAdmin: true }, test: 'proto-pollution' },
        { constructor: { name: 'attack' }, test: 'constructor-pollution' },
        '{"test": "string-injection"}',
        { test: "\"; DROP TABLE jobs; --" },
        { test: Array(10000).fill('x').join('') }, // Large payload
        null,
        undefined
      ];
      
      for (const [index, payload] of maliciousPayloads.entries()) {
        try {
          const jobResponse = await this.httpRequest('POST', '/jobs', {
            type: 'test-payload-attack',
            payload: payload,
            requirements: { capability: 'test' }
          });
          
          if (jobResponse.status === 200) {
            const jobId = jobResponse.data.job.jobId;
            this.testJobs.push(jobId);
            this.log('WARNING', `Malicious Payload ${index} Accepted`, 
              `Payload type: ${typeof payload}, size: ${JSON.stringify(payload)?.length || 'null'}`);
          }
        } catch (e) {
          // Expected for some payloads
        }
      }
      
    } catch (error) {
      this.log('ERROR', 'Payload Attack Failed', error.message);
    }
  }

  // 🎯 ATTACK 5: Database consistency stress test
  async attackDatabaseConsistency() {
    this.log('INFO', 'ATTACK 5', 'Testing database consistency under stress');
    
    try {
      // Create many jobs rapidly
      const jobPromises = [];
      for (let i = 0; i < 20; i++) {
        jobPromises.push(this.httpRequest('POST', '/jobs', {
          type: 'stress-test',
          payload: { iteration: i, timestamp: Date.now() },
          requirements: { capability: 'test' }
        }));
      }
      
      const jobResults = await Promise.all(jobPromises);
      const successJobs = jobResults.filter(r => r.status === 200);
      
      if (successJobs.length !== jobPromises.length) {
        this.log('WARNING', 'Job Creation Stress Failed', 
          `Only ${successJobs.length}/${jobPromises.length} jobs created successfully`);
      }
      
      // Try to claim all jobs simultaneously with one node
      const stressNodeId = `stress-node-${crypto.randomBytes(4).toString('hex')}`;
      await this.httpRequest('POST', '/nodes/register', {
        nodeId: stressNodeId,
        name: 'Stress Test Node',
        capabilities: ['test'],
        models: [],
        cpuCores: 16,
        ramMB: 32768,
        owner: 'stress-tester'
      });
      this.fakeNodes.push(stressNodeId);
      
      const claimPromises = successJobs.map(jobResp => 
        this.httpRequest('POST', `/jobs/${jobResp.data.job.jobId}/claim`, { 
          nodeId: stressNodeId 
        })
      );
      
      const claimResults = await Promise.all(claimPromises);
      const successClaims = claimResults.filter(r => r.status === 200);
      
      this.log('INFO', 'Stress Test Results', 
        `Node claimed ${successClaims.length}/${successJobs.length} jobs`);
        
    } catch (error) {
      this.log('ERROR', 'Consistency Attack Failed', error.message);
    }
  }

  // Cleanup test data
  async cleanup() {
    this.log('INFO', 'Cleanup', 'Attempting to clean up test artifacts...');
    // Note: Most test data will be cleaned by natural job reaper
    // Fake nodes will timeout after 2 minutes of inactivity
  }

  async runAllAttacks() {
    console.log('🔍 COMPANION ADVERSARIAL TESTING STARTED');
    console.log('Target: IC Mesh job claiming and completion system');
    console.log('Time:', new Date().toISOString());
    console.log('═'.repeat(60));
    
    await this.attackRaceConditions();
    await this.attackPaymentCalculation();
    await this.attackAuthentication();
    await this.attackPayloadManipulation();
    await this.attackDatabaseConsistency();
    
    await this.cleanup();
    
    console.log('═'.repeat(60));
    console.log('🔍 ADVERSARIAL TESTING COMPLETE');
    
    // Categorize findings
    const critical = this.findings.filter(f => f.severity === 'CRITICAL');
    const warnings = this.findings.filter(f => f.severity === 'WARNING');
    const good = this.findings.filter(f => f.severity === 'GOOD');
    
    console.log(`\nSUMMARY:`);
    console.log(`  🔴 Critical Issues: ${critical.length}`);
    console.log(`  🟡 Warnings: ${warnings.length}`);
    console.log(`  🟢 Good Security: ${good.length}`);
    
    return this.findings;
  }
}

// Run the attack if called directly
if (require.main === module) {
  const attacker = new MeshAttacker();
  attacker.runAllAttacks().then(findings => {
    console.log('\nDETAILED FINDINGS:');
    findings.forEach((f, i) => {
      console.log(`${i+1}. [${f.severity}] ${f.title}: ${f.details}`);
    });
    process.exit(findings.some(f => f.severity === 'CRITICAL') ? 1 : 0);
  }).catch(console.error);
}

module.exports = MeshAttacker;