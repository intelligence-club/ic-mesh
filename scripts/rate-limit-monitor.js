#!/usr/bin/env node
/**
 * Rate Limit Monitor & Manager
 * 
 * Monitor current rate limiting status, view trends, and manage whitelist.
 * Helps diagnose rate limiting issues and optimize limits.
 * 
 * Usage:
 *   node scripts/rate-limit-monitor.js              # View current status
 *   node scripts/rate-limit-monitor.js --watch      # Continuous monitoring
 *   node scripts/rate-limit-monitor.js --history    # Show rate limit trends
 *   node scripts/rate-limit-monitor.js --whitelist  # Manage IP whitelist
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const DATABASE_PATH = process.env.DATABASE_PATH || './mesh.db';
const RATE_LIMIT_LOG = './logs/rate-limits.log';
const WHITELIST_FILE = './config/rate-limit-whitelist.json';

// Ensure directories exist
[path.dirname(RATE_LIMIT_LOG), path.dirname(WHITELIST_FILE)].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

class RateLimitMonitor {
  constructor() {
    this.serverUrl = process.env.MESH_URL || 'http://localhost:8333';
    this.logFile = RATE_LIMIT_LOG;
    this.whitelistFile = WHITELIST_FILE;
    
    // Load existing whitelist
    this.whitelist = this.loadWhitelist();
  }

  loadWhitelist() {
    try {
      if (fs.existsSync(this.whitelistFile)) {
        return JSON.parse(fs.readFileSync(this.whitelistFile, 'utf8'));
      }
    } catch (e) {
      console.warn('⚠️  Warning: Could not load whitelist, creating new one');
    }
    return {
      ips: ['127.0.0.1', '::1'],
      description: 'Default localhost whitelist for monitoring tools'
    };
  }

  saveWhitelist() {
    fs.writeFileSync(this.whitelistFile, JSON.stringify(this.whitelist, null, 2));
    console.log('✅ Whitelist saved to', this.whitelistFile);
  }

  async checkRateLimitStatus() {
    try {
      const response = await this.makeRequest('/health');
      const headers = response.headers || {};
      
      return {
        status: response.status,
        rateLimited: response.status === 429,
        retryAfter: headers['retry-after'] || 0,
        remaining: headers['x-ratelimit-remaining'],
        limit: headers['x-ratelimit-limit'],
        resetTime: headers['x-ratelimit-reset']
      };
    } catch (error) {
      return {
        error: error.message,
        status: 0,
        rateLimited: false
      };
    }
  }

  async makeRequest(path, options = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, this.serverUrl);
      const req = http.request(url, options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = data ? JSON.parse(data) : {};
            resolve({
              status: res.statusCode,
              headers: res.headers,
              data: parsed
            });
          } catch (e) {
            resolve({
              status: res.statusCode,
              headers: res.headers,
              data: data
            });
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(5000, () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
      
      req.end();
    });
  }

  logRateLimit(status) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      ...status
    };
    
    const logLine = JSON.stringify(logEntry) + '\n';
    fs.appendFileSync(this.logFile, logLine);
  }

  async showCurrentStatus() {
    console.log('🔍 Rate Limit Monitor - Current Status\n');
    
    const status = await this.checkRateLimitStatus();
    
    if (status.error) {
      console.log('❌ Server Error:', status.error);
      return;
    }

    console.log(`📊 Status: ${status.status}`);
    
    if (status.rateLimited) {
      console.log(`🚫 RATE LIMITED - Retry after ${status.retryAfter}s`);
      console.log(`⏰ Wait time: ${status.retryAfter} seconds`);
    } else {
      console.log('✅ Not rate limited');
    }

    if (status.remaining !== undefined) {
      console.log(`📈 Remaining requests: ${status.remaining}/${status.limit}`);
    }

    if (status.resetTime) {
      const resetDate = new Date(parseInt(status.resetTime) * 1000);
      console.log(`🔄 Reset time: ${resetDate.toLocaleString()}`);
    }

    // Show whitelist status
    console.log(`\n🛡️  Whitelisted IPs: ${this.whitelist.ips.length}`);
    console.log('   ', this.whitelist.ips.join(', '));

    return status;
  }

  async watchStatus() {
    console.log('👀 Rate Limit Monitor - Watching (Ctrl+C to stop)\n');
    
    const interval = setInterval(async () => {
      const status = await this.checkRateLimitStatus();
      const timestamp = new Date().toLocaleTimeString();
      
      let statusIcon = '✅';
      let statusText = 'OK';
      
      if (status.rateLimited) {
        statusIcon = '🚫';
        statusText = `RATE LIMITED (retry ${status.retryAfter}s)`;
      } else if (status.error) {
        statusIcon = '❌';
        statusText = `ERROR: ${status.error}`;
      }

      console.log(`[${timestamp}] ${statusIcon} ${statusText}`);
      
      if (status.remaining !== undefined) {
        console.log(`           📊 ${status.remaining}/${status.limit} remaining`);
      }

      // Log all status checks
      this.logRateLimit(status);
    }, 5000); // Check every 5 seconds

    // Handle Ctrl+C gracefully
    process.on('SIGINT', () => {
      console.log('\n🛑 Stopping monitor...');
      clearInterval(interval);
      process.exit(0);
    });
  }

  showHistory() {
    console.log('📜 Rate Limit History\n');
    
    if (!fs.existsSync(this.logFile)) {
      console.log('📝 No history found. Run monitor with --watch to start logging.');
      return;
    }

    const logs = fs.readFileSync(this.logFile, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .slice(-20) // Last 20 entries
      .map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    if (logs.length === 0) {
      console.log('📝 No valid log entries found.');
      return;
    }

    console.log('Recent Rate Limit Events:');
    console.log('------------------------');

    logs.forEach(entry => {
      const time = new Date(entry.timestamp).toLocaleTimeString();
      let status = '✅ OK';
      
      if (entry.rateLimited) {
        status = `🚫 RATE LIMITED (${entry.retryAfter}s)`;
      } else if (entry.error) {
        status = `❌ ERROR: ${entry.error}`;
      }

      console.log(`[${time}] ${status}`);
      if (entry.remaining !== undefined) {
        console.log(`           📊 ${entry.remaining}/${entry.limit} remaining`);
      }
    });

    // Show summary stats
    const rateLimited = logs.filter(l => l.rateLimited).length;
    const errors = logs.filter(l => l.error).length;
    const success = logs.length - rateLimited - errors;

    console.log('\n📈 Summary (last 20 entries):');
    console.log(`   ✅ Success: ${success}`);
    console.log(`   🚫 Rate Limited: ${rateLimited}`);
    console.log(`   ❌ Errors: ${errors}`);
  }

  manageWhitelist() {
    console.log('🛡️  Rate Limit Whitelist Manager\n');
    console.log('Current whitelist:');
    this.whitelist.ips.forEach((ip, i) => {
      console.log(`  ${i + 1}. ${ip}`);
    });
    
    console.log('\nCommands:');
    console.log('  add <ip>     - Add IP to whitelist');
    console.log('  remove <ip>  - Remove IP from whitelist');
    console.log('  list         - Show current whitelist');
    console.log('  save         - Save whitelist to file');
    console.log('\nExample usage:');
    console.log('  node scripts/rate-limit-monitor.js --whitelist add 192.168.1.100');
  }

  addToWhitelist(ip) {
    if (!this.whitelist.ips.includes(ip)) {
      this.whitelist.ips.push(ip);
      console.log(`✅ Added ${ip} to whitelist`);
      this.saveWhitelist();
    } else {
      console.log(`ℹ️  ${ip} already in whitelist`);
    }
  }

  removeFromWhitelist(ip) {
    const index = this.whitelist.ips.indexOf(ip);
    if (index > -1) {
      this.whitelist.ips.splice(index, 1);
      console.log(`✅ Removed ${ip} from whitelist`);
      this.saveWhitelist();
    } else {
      console.log(`ℹ️  ${ip} not found in whitelist`);
    }
  }

  async generateOptimizationSuggestions() {
    console.log('🔧 Rate Limiting Optimization Suggestions\n');
    
    const status = await this.checkRateLimitStatus();
    
    if (status.rateLimited) {
      console.log('🚫 Currently rate limited! Immediate suggestions:');
      console.log('   • Wait', status.retryAfter, 'seconds before retrying');
      console.log('   • Check if your IP should be whitelisted');
      console.log('   • Consider reducing request frequency');
    }

    // Check log history for patterns
    if (fs.existsSync(this.logFile)) {
      const logs = fs.readFileSync(this.logFile, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .slice(-100) // Last 100 entries
        .map(line => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean);

      if (logs.length > 10) {
        const recentRateLimits = logs.filter(l => l.rateLimited).length;
        const rateLimitRate = recentRateLimits / logs.length;

        console.log('📊 Analysis of recent activity:');
        console.log(`   • Rate limit frequency: ${(rateLimitRate * 100).toFixed(1)}%`);
        
        if (rateLimitRate > 0.3) {
          console.log('   🔴 High rate limiting detected!');
          console.log('   • Consider implementing exponential backoff');
          console.log('   • Add delays between requests');
          console.log('   • Check for infinite retry loops');
        } else if (rateLimitRate > 0.1) {
          console.log('   🟡 Moderate rate limiting');
          console.log('   • Monitor request patterns');
          console.log('   • Consider request batching');
        } else {
          console.log('   🟢 Rate limiting within normal range');
        }
      }
    }

    console.log('\n💡 General optimization tips:');
    console.log('   • Use exponential backoff for retries');
    console.log('   • Implement client-side rate limiting');
    console.log('   • Cache responses to reduce API calls');
    console.log('   • Batch multiple operations when possible');
    console.log('   • Monitor rate limit headers in responses');
  }
}

// CLI Interface
async function main() {
  const monitor = new RateLimitMonitor();
  const args = process.argv.slice(2);

  if (args.includes('--watch')) {
    await monitor.watchStatus();
  } else if (args.includes('--history')) {
    monitor.showHistory();
  } else if (args.includes('--whitelist')) {
    if (args.includes('add') && args[args.indexOf('add') + 1]) {
      monitor.addToWhitelist(args[args.indexOf('add') + 1]);
    } else if (args.includes('remove') && args[args.indexOf('remove') + 1]) {
      monitor.removeFromWhitelist(args[args.indexOf('remove') + 1]);
    } else {
      monitor.manageWhitelist();
    }
  } else if (args.includes('--optimize')) {
    await monitor.generateOptimizationSuggestions();
  } else {
    await monitor.showCurrentStatus();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('❌ Error:', error.message);
    process.exit(1);
  });
}

module.exports = RateLimitMonitor;