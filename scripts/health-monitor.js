#!/usr/bin/env node
/**
 * IC Mesh Health Monitor
 * 
 * Comprehensive health monitoring script for IC Mesh infrastructure.
 * Checks all endpoints, database health, node connectivity, and system metrics.
 * 
 * Usage:
 *   node scripts/health-monitor.js [--continuous] [--interval=30] [--slack-webhook=url]
 */

const http = require('http');
const fs = require('fs');
const { exec } = require('child_process');
const { WebSocket } = require('ws');

/**
 * URL validation to prevent SSRF attacks
 */
function validateUrl(url, type = 'base') {
  try {
    const parsedUrl = new URL(url);
    
    // Only allow HTTP/HTTPS protocols
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error(`Invalid protocol: ${parsedUrl.protocol}. Only http:// and https:// are allowed.`);
    }
    
    // Whitelist based on URL type
    if (type === 'base') {
      // Base URLs for IC Mesh - only allow localhost and specific trusted hosts
      const allowedHosts = [
        'localhost',
        '127.0.0.1',
        '::1',
        'moilol.com',  // Production domain
        // Add more trusted hosts as needed
      ];
      
      if (!allowedHosts.includes(parsedUrl.hostname)) {
        throw new Error(`Host not allowed: ${parsedUrl.hostname}. Allowed hosts: ${allowedHosts.join(', ')}`);
      }
      
      // Only allow standard ports for IC Mesh
      const allowedPorts = ['', '80', '443', '8333', '8334'];
      if (!allowedPorts.includes(parsedUrl.port)) {
        throw new Error(`Port not allowed: ${parsedUrl.port}. Allowed ports: ${allowedPorts.join(', ')}`);
      }
    } else if (type === 'slack') {
      // Slack webhooks must be from hooks.slack.com
      if (parsedUrl.hostname !== 'hooks.slack.com') {
        throw new Error(`Invalid Slack webhook host: ${parsedUrl.hostname}. Must be hooks.slack.com`);
      }
      
      // Must use HTTPS for Slack webhooks
      if (parsedUrl.protocol !== 'https:') {
        throw new Error('Slack webhooks must use HTTPS');
      }
      
      // Must have the correct path structure for Slack webhooks
      if (!parsedUrl.pathname.startsWith('/services/')) {
        throw new Error('Invalid Slack webhook path structure');
      }
    }
    
    return url;
  } catch (error) {
    throw new Error(`URL validation failed: ${error.message}`);
  }
}

class HealthMonitor {
  constructor(options = {}) {
    // Validate and set base URL
    const defaultBaseUrl = 'http://localhost:8333';
    this.baseUrl = options.baseUrl ? validateUrl(options.baseUrl, 'base') : defaultBaseUrl;
    this.wsUrl = this.baseUrl.replace('http', 'ws') + '/ws';
    this.continuous = options.continuous || false;
    this.interval = (options.interval || 30) * 1000; // Convert to ms
    
    // Validate Slack webhook if provided
    this.slackWebhook = options.slackWebhook ? validateUrl(options.slackWebhook, 'slack') : null;
    this.lastStatus = null;
    this.checks = [];
  }

  async request(method, path, data = null) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, this.baseUrl);
      const options = {
        method,
        headers: { 'Content-Type': 'application/json' },
        timeout: 5000
      };

      const req = http.request(url, options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            resolve({
              status: res.statusCode,
              data: body ? JSON.parse(body) : null,
              headers: res.headers
            });
          } catch {
            resolve({
              status: res.statusCode,
              data: body,
              headers: res.headers
            });
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => reject(new Error('Request timeout')));

      if (data) {
        req.write(typeof data === 'string' ? data : JSON.stringify(data));
      }
      
      req.end();
    });
  }

  async checkEndpoint(name, method, path, expectedStatus = 200, validator = null, data = null) {
    const start = Date.now();
    try {
      const response = await this.request(method, path, data);
      const duration = Date.now() - start;
      
      const expectedStatuses = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
      let success = expectedStatuses.includes(response.status);
      let details = `${response.status} (${duration}ms)`;
      
      if (validator && success) {
        const validation = validator(response);
        success = validation.success;
        if (!success) {
          details += ` - ${validation.error}`;
        }
      }

      this.checks.push({
        name,
        success,
        details,
        duration,
        timestamp: new Date().toISOString()
      });

      return { success, duration, details: response };
    } catch (error) {
      this.checks.push({
        name,
        success: false,
        details: error.message,
        duration: Date.now() - start,
        timestamp: new Date().toISOString()
      });
      return { success: false, duration: Date.now() - start, error: error.message };
    }
  }

  async checkWebSocket() {
    return new Promise((resolve) => {
      const start = Date.now();
      const timeout = setTimeout(() => {
        this.checks.push({
          name: 'WebSocket Connection',
          success: false,
          details: 'Connection timeout (5s)',
          duration: 5000,
          timestamp: new Date().toISOString()
        });
        resolve({ success: false, duration: 5000 });
      }, 5000);

      try {
        const ws = new WebSocket(this.wsUrl);
        
        ws.on('open', () => {
          clearTimeout(timeout);
          const duration = Date.now() - start;
          ws.close();
          
          this.checks.push({
            name: 'WebSocket Connection',
            success: true,
            details: `Connected (${duration}ms)`,
            duration,
            timestamp: new Date().toISOString()
          });
          
          resolve({ success: true, duration });
        });

        ws.on('error', (error) => {
          clearTimeout(timeout);
          const duration = Date.now() - start;
          
          this.checks.push({
            name: 'WebSocket Connection',
            success: false,
            details: error.message,
            duration,
            timestamp: new Date().toISOString()
          });
          
          resolve({ success: false, duration, error: error.message });
        });
      } catch (error) {
        clearTimeout(timeout);
        const duration = Date.now() - start;
        
        this.checks.push({
          name: 'WebSocket Connection',
          success: false,
          details: error.message,
          duration,
          timestamp: new Date().toISOString()
        });
        
        resolve({ success: false, duration, error: error.message });
      }
    });
  }

  async checkDatabaseHealth() {
    try {
      // Check if database file exists and is readable
      const dbPath = 'data/mesh.db';
      const stats = fs.statSync(dbPath);
      const sizeKB = Math.round(stats.size / 1024);
      
      this.checks.push({
        name: 'Database File',
        success: true,
        details: `${sizeKB}KB, modified ${stats.mtime.toISOString()}`,
        duration: 0,
        timestamp: new Date().toISOString()
      });

      return { success: true, size: stats.size };
    } catch (error) {
      this.checks.push({
        name: 'Database File',
        success: false,
        details: error.message,
        duration: 0,
        timestamp: new Date().toISOString()
      });
      return { success: false, error: error.message };
    }
  }

  async checkSystemResources() {
    return new Promise((resolve) => {
      exec('free -m && df -h /', (error, stdout) => {
        if (error) {
          this.checks.push({
            name: 'System Resources',
            success: false,
            details: error.message,
            duration: 0,
            timestamp: new Date().toISOString()
          });
          resolve({ success: false, error: error.message });
          return;
        }

        const lines = stdout.trim().split('\n');
        const memLine = lines.find(l => l.includes('Mem:'));
        const diskLine = lines[lines.length - 1];
        
        let memUsage = 'unknown';
        if (memLine) {
          const parts = memLine.split(/\s+/);
          const total = parseInt(parts[1]);
          const used = parseInt(parts[2]);
          const percent = Math.round((used / total) * 100);
          memUsage = `${percent}% (${used}MB/${total}MB)`;
        }

        let diskUsage = 'unknown';
        if (diskLine) {
          const match = diskLine.match(/(\d+)%/);
          if (match) {
            diskUsage = match[1] + '%';
          }
        }

        this.checks.push({
          name: 'System Resources',
          success: true,
          details: `Memory: ${memUsage}, Disk: ${diskUsage}`,
          duration: 0,
          timestamp: new Date().toISOString()
        });

        resolve({ success: true, memory: memUsage, disk: diskUsage });
      });
    });
  }

  async performHealthCheck() {
    console.log(`🏥 IC Mesh Health Check - ${new Date().toISOString()}`);
    console.log('━'.repeat(60));
    
    this.checks = [];
    const start = Date.now();

    // Core endpoints
    await this.checkEndpoint('Status Endpoint', 'GET', '/status', 200, (res) => {
      if (!res.data || typeof res.data.uptime !== 'number') {
        return { success: false, error: 'Invalid status response' };
      }
      return { success: true };
    });

    await this.checkEndpoint('Nodes List', 'GET', '/nodes', 200, (res) => {
      if (!res.data || typeof res.data.nodes !== 'object' || typeof res.data.total !== 'number') {
        return { success: false, error: 'Invalid nodes response' };
      }
      return { success: true };
    });

    await this.checkEndpoint('Jobs Available', 'GET', '/jobs/available', 200, (res) => {
      if (!res.data || !Array.isArray(res.data.jobs)) {
        return { success: false, error: 'Invalid jobs response' };
      }
      return { success: true };
    });

    // Test job creation (internal - should work from localhost)
    await this.checkEndpoint('Job Creation', 'POST', '/jobs', [200, 401], (res) => {
      // Accept either successful creation (200) or auth required (401) as valid responses
      if (res.status === 401) {
        return { success: true }; // Auth required is expected behavior
      }
      if (!res.data || !res.data.ok || !res.data.job) {
        return { success: false, error: 'Invalid job creation response' };
      }
      return { success: true };
    }, {
      type: 'transcribe',
      payload: { audio_url: 'https://example.com/test.wav' },
      requirements: { capability: 'transcription' }
    });

    // Error handling
    await this.checkEndpoint('404 Handling', 'GET', '/nonexistent-endpoint', 404);

    // WebSocket
    await this.checkWebSocket();

    // System checks
    await this.checkDatabaseHealth();
    await this.checkSystemResources();

    const totalDuration = Date.now() - start;
    const passed = this.checks.filter(c => c.success).length;
    const failed = this.checks.filter(c => !c.success).length;

    // Display results
    for (const check of this.checks) {
      const status = check.success ? '✅' : '❌';
      console.log(`${status} ${check.name}: ${check.details}`);
    }

    console.log('━'.repeat(60));
    console.log(`📊 Summary: ${passed} passed, ${failed} failed (${totalDuration}ms)`);
    
    const currentStatus = {
      timestamp: new Date().toISOString(),
      passed,
      failed,
      total: this.checks.length,
      duration: totalDuration,
      health: failed === 0 ? 'healthy' : failed < 3 ? 'degraded' : 'unhealthy'
    };

    // Alert on status changes
    if (this.lastStatus && this.lastStatus.health !== currentStatus.health) {
      const message = `🚨 IC Mesh health changed: ${this.lastStatus.health} → ${currentStatus.health}`;
      console.log(`\n${message}`);
      
      if (this.slackWebhook) {
        await this.sendSlackAlert(message, currentStatus);
      }
    }

    this.lastStatus = currentStatus;
    return currentStatus;
  }

  async sendSlackAlert(message, status) {
    try {
      const payload = {
        text: message,
        attachments: [{
          color: status.health === 'healthy' ? 'good' : status.health === 'degraded' ? 'warning' : 'danger',
          fields: [
            { title: 'Passed', value: status.passed, short: true },
            { title: 'Failed', value: status.failed, short: true },
            { title: 'Duration', value: `${status.duration}ms`, short: true },
            { title: 'Health', value: status.health, short: true }
          ]
        }]
      };

      const response = await this.request('POST', this.slackWebhook, JSON.stringify(payload));
      if (response.status !== 200) {
        console.log(`⚠️ Failed to send Slack alert: ${response.status}`);
      }
    } catch (error) {
      console.log(`⚠️ Failed to send Slack alert: ${error.message}`);
    }
  }

  async run() {
    if (this.continuous) {
      console.log(`🔄 Starting continuous monitoring (interval: ${this.interval/1000}s)`);
      
      while (true) {
        await this.performHealthCheck();
        console.log(`\n💤 Next check in ${this.interval/1000}s...\n`);
        await new Promise(resolve => setTimeout(resolve, this.interval));
      }
    } else {
      const status = await this.performHealthCheck();
      process.exit(status.failed > 0 ? 1 : 0);
    }
  }
}

// CLI handling
if (require.main === module) {
  const args = process.argv.slice(2);
  const options = {};

  for (const arg of args) {
    if (arg === '--continuous') {
      options.continuous = true;
    } else if (arg.startsWith('--interval=')) {
      options.interval = parseInt(arg.split('=')[1]);
    } else if (arg.startsWith('--slack-webhook=')) {
      try {
        options.slackWebhook = validateUrl(arg.split('=')[1], 'slack');
      } catch (error) {
        console.error(`❌ Invalid Slack webhook URL: ${error.message}`);
        process.exit(1);
      }
    } else if (arg.startsWith('--base-url=')) {
      try {
        options.baseUrl = validateUrl(arg.split('=')[1], 'base');
      } catch (error) {
        console.error(`❌ Invalid base URL: ${error.message}`);
        process.exit(1);
      }
    }
  }

  const monitor = new HealthMonitor(options);
  monitor.run().catch(error => {
    console.error(`💥 Monitor crashed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = HealthMonitor;