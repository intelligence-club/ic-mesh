#!/usr/bin/env node
/**
 * IC Mesh Comprehensive Health Check
 * 
 * Validates all system components and provides detailed health report
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const HOST = process.env.IC_MESH_HOST || 'localhost';
const PORT = process.env.IC_MESH_PORT || 8333;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = process.env.DATABASE_PATH || path.join(DATA_DIR, 'mesh.db');

console.log('🏥 IC Mesh Health Check\n');

class HealthChecker {
  constructor() {
    this.results = {
      overall: 'unknown',
      checks: {},
      warnings: [],
      errors: [],
      score: 0,
      maxScore: 0
    };
  }

  async check(name, testFn, weight = 1, required = true) {
    this.results.maxScore += weight;
    console.log(`🔍 ${name}...`);
    
    try {
      const result = await testFn();
      if (result.success) {
        this.results.checks[name] = { status: 'pass', ...result };
        this.results.score += weight;
        console.log(`   ✅ ${result.message || 'OK'}`);
      } else {
        this.results.checks[name] = { status: 'fail', ...result };
        const msg = result.message || 'Failed';
        console.log(`   ❌ ${msg}`);
        
        if (required) {
          this.results.errors.push(`${name}: ${msg}`);
        } else {
          this.results.warnings.push(`${name}: ${msg}`);
        }
      }
    } catch (error) {
      this.results.checks[name] = { status: 'error', error: error.message };
      const msg = `Error: ${error.message}`;
      console.log(`   💥 ${msg}`);
      
      if (required) {
        this.results.errors.push(`${name}: ${msg}`);
      } else {
        this.results.warnings.push(`${name}: ${msg}`);
      }
    }
  }

  async httpRequest(method, path, body = null) {
    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: HOST,
        port: PORT,
        path,
        method,
        timeout: 5000,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'IC-Mesh-HealthCheck/1.0'
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = data ? JSON.parse(data) : {};
            resolve({ status: res.statusCode, data: parsed, raw: data });
          } catch {
            resolve({ status: res.statusCode, data: null, raw: data });
          }
        });
      });
      
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
      
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  async runAllChecks() {
    // Database checks
    await this.check('Database file exists', () => ({
      success: fs.existsSync(DB_PATH),
      message: fs.existsSync(DB_PATH) ? `Found at ${DB_PATH}` : `Missing: ${DB_PATH}`
    }));

    await this.check('Database readable', () => {
      const stats = fs.statSync(DB_PATH);
      return {
        success: stats.size > 0,
        message: `${(stats.size / 1024).toFixed(1)}KB`,
        size: stats.size
      };
    });

    // HTTP API checks
    await this.check('Server responding', async () => {
      const response = await this.httpRequest('GET', '/status');
      return {
        success: response.status === 200,
        message: response.status === 200 ? 'Server online' : `HTTP ${response.status}`,
        response
      };
    });

    await this.check('Status endpoint', async () => {
      const response = await this.httpRequest('GET', '/status');
      const hasRequiredFields = response.data && 
        response.data.network && 
        typeof response.data.nodes === 'object' &&
        typeof response.data.jobs === 'object';
      
      return {
        success: hasRequiredFields,
        message: hasRequiredFields ? 
          `${response.data.nodes.active}/${response.data.nodes.total} nodes, ${response.data.jobs.total} jobs` :
          'Missing required status fields',
        data: response.data
      };
    });

    await this.check('Node registration', async () => {
      const testNode = {
        nodeId: 'health-check-' + Date.now(),
        name: 'Health Check Node',
        capabilities: ['test']
      };
      
      const response = await this.httpRequest('POST', '/nodes/register', testNode);
      return {
        success: response.status === 200 && response.data && response.data.ok,
        message: response.status === 200 ? 'Registration working' : `HTTP ${response.status}`,
        nodeId: testNode.nodeId
      };
    });

    await this.check('Job submission', async () => {
      const testJob = {
        type: 'health-check',
        payload: JSON.stringify({ test: true, timestamp: Date.now() }),
        timeout: 30000
      };
      
      const response = await this.httpRequest('POST', '/jobs', testJob);
      const jobId = response.data?.job?.jobId || response.data?.jobId;
      return {
        success: response.status === 200 && response.data && response.data.ok,
        message: response.status === 200 ? 
          `Job ${jobId} created` : 
          `HTTP ${response.status}`,
        jobId
      };
    });

    // WebSocket connectivity
    await this.check('WebSocket connection', () => {
      return new Promise((resolve) => {
        const ws = new WebSocket(`ws://${HOST}:${PORT}/ws?nodeId=health-check-ws`);
        const timeout = setTimeout(() => {
          ws.close();
          resolve({ success: false, message: 'Connection timeout' });
        }, 5000);
        
        ws.on('open', () => {
          clearTimeout(timeout);
          ws.close();
          resolve({ success: true, message: 'WebSocket connection working' });
        });
        
        ws.on('error', (error) => {
          clearTimeout(timeout);
          resolve({ success: false, message: `WebSocket error: ${error.message}` });
        });
      });
    });

    // File system checks
    await this.check('Upload directory', () => {
      const uploadDir = path.join(DATA_DIR, 'uploads');
      const exists = fs.existsSync(uploadDir);
      return {
        success: exists,
        message: exists ? 'Upload directory accessible' : 'Upload directory missing',
        path: uploadDir
      };
    }, 1, false);

    await this.check('Data directory writable', () => {
      const testFile = path.join(DATA_DIR, `health-check-${Date.now()}.tmp`);
      try {
        fs.writeFileSync(testFile, 'test');
        fs.unlinkSync(testFile);
        return { success: true, message: 'Data directory writable' };
      } catch (error) {
        return { success: false, message: `Write test failed: ${error.message}` };
      }
    });

    // Performance checks
    await this.check('Response time', async () => {
      const start = Date.now();
      await this.httpRequest('GET', '/status');
      const duration = Date.now() - start;
      
      return {
        success: duration < 1000,
        message: `${duration}ms ${duration > 1000 ? '(slow)' : '(good)'}`,
        duration
      };
    }, 1, false);

    // System resource checks
    await this.check('Memory usage', () => {
      const used = process.memoryUsage();
      const rss = (used.rss / 1024 / 1024).toFixed(1);
      const heap = (used.heapUsed / 1024 / 1024).toFixed(1);
      
      return {
        success: used.rss < 500 * 1024 * 1024, // Under 500MB
        message: `RSS: ${rss}MB, Heap: ${heap}MB`,
        usage: used
      };
    }, 1, false);

    this.calculateOverallHealth();
    this.printSummary();
  }

  calculateOverallHealth() {
    const percentage = Math.round((this.results.score / this.results.maxScore) * 100);
    
    if (this.results.errors.length > 0) {
      this.results.overall = 'unhealthy';
    } else if (percentage >= 90) {
      this.results.overall = 'healthy';
    } else if (percentage >= 70) {
      this.results.overall = 'degraded';
    } else {
      this.results.overall = 'unhealthy';
    }
  }

  printSummary() {
    const percentage = Math.round((this.results.score / this.results.maxScore) * 100);
    const emoji = {
      healthy: '💚',
      degraded: '💛', 
      unhealthy: '❤️'
    };
    
    console.log(`\n📊 Overall Health: ${emoji[this.results.overall]} ${this.results.overall.toUpperCase()}`);
    console.log(`Score: ${this.results.score}/${this.results.maxScore} (${percentage}%)\n`);
    
    if (this.results.errors.length > 0) {
      console.log('🚨 Critical Issues:');
      this.results.errors.forEach(error => console.log(`   • ${error}`));
      console.log();
    }
    
    if (this.results.warnings.length > 0) {
      console.log('⚠️  Warnings:');
      this.results.warnings.forEach(warning => console.log(`   • ${warning}`));
      console.log();
    }
    
    console.log('📋 Recommendations:');
    if (this.results.errors.length > 0) {
      console.log('   • Address critical issues before production use');
    }
    if (this.results.warnings.length > 0) {
      console.log('   • Review warnings for optimal performance');
    }
    if (this.results.overall === 'healthy') {
      console.log('   • System is ready for production traffic');
    }
    
    // Exit code based on health
    process.exit(this.results.errors.length > 0 ? 1 : 0);
  }
}

async function main() {
  const checker = new HealthChecker();
  await checker.runAllChecks();
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = HealthChecker;