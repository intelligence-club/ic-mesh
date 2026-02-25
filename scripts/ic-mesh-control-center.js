#!/usr/bin/env node
/**
 * IC Mesh Control Center
 * 
 * Unified operational dashboard for IC Mesh operators
 * Combines system health, performance metrics, job management, and troubleshooting tools
 * 
 * Usage:
 *   node ic-mesh-control-center.js                    # Full dashboard
 *   node ic-mesh-control-center.js --status           # Quick status check
 *   node ic-mesh-control-center.js --jobs             # Job queue management
 *   node ic-mesh-control-center.js --nodes            # Node management
 *   node ic-mesh-control-center.js --performance      # Performance overview
 *   node ic-mesh-control-center.js --watch            # Live monitoring
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

class ICMeshControlCenter {
  constructor() {
    this.colors = {
      green: '\x1b[32m',
      red: '\x1b[31m', 
      yellow: '\x1b[33m',
      blue: '\x1b[34m',
      cyan: '\x1b[36m',
      magenta: '\x1b[35m',
      white: '\x1b[37m',
      gray: '\x1b[90m',
      bold: '\x1b[1m',
      dim: '\x1b[2m',
      reset: '\x1b[0m'
    };
    
    this.icMeshPath = '/home/openclaw/.openclaw/workspace/ic-mesh';
    this.dataPath = path.join(this.icMeshPath, 'data');
    this.dbPath = path.join(this.dataPath, 'mesh.db');
    
    // Check if we have access to the IC Mesh installation
    this.hasAccess = fs.existsSync(this.icMeshPath) && fs.existsSync(this.dbPath);
  }
  
  color(text, colorName) {
    if (process.argv.includes('--no-color')) return text;
    return `${this.colors[colorName]}${text}${this.colors.reset}`;
  }
  
  bold(text) { return this.color(text, 'bold'); }
  
  async getSystemHealth() {
    const health = {
      timestamp: new Date(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      cpu: os.loadavg(),
      platform: os.platform(),
      hostname: os.hostname(),
      nodeVersion: process.version
    };
    
    // System memory
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    health.systemMemory = {
      total: totalMem,
      free: freeMem,
      used: totalMem - freeMem,
      usagePercent: ((totalMem - freeMem) / totalMem * 100).toFixed(1)
    };
    
    return health;
  }
  
  async getICMeshStatus() {
    if (!this.hasAccess) {
      return {
        error: 'Cannot access IC Mesh installation',
        path: this.icMeshPath,
        suggestions: [
          'Check if IC Mesh is installed',
          'Verify file permissions',
          'Run from correct directory'
        ]
      };
    }
    
    const status = {
      version: await this.getVersion(),
      server: await this.getServerStatus(),
      database: await this.getDatabaseStatus(),
      network: await this.getNetworkStatus(),
      jobs: await this.getJobStatus(),
      nodes: await this.getNodeStatus(),
      rateLimiting: await this.getRateLimitingStatus(),
      performance: await this.getPerformanceMetrics()
    };
    
    return status;
  }
  
  async getVersion() {
    try {
      const packagePath = path.join(this.icMeshPath, 'package.json');
      if (fs.existsSync(packagePath)) {
        const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
        return pkg.version || 'unknown';
      }
      return 'unknown';
    } catch (e) {
      return 'error';
    }
  }
  
  async getServerStatus() {
    try {
      // Check if server is running by testing the port
      const testCommand = 'curl -s -m 3 http://localhost:8333/status';
      const result = execSync(testCommand, { encoding: 'utf8', stdio: 'pipe' });
      
      return {
        running: true,
        port: 8333,
        response: result ? 'OK' : 'No response',
        pid: await this.getServerPID()
      };
    } catch (e) {
      return {
        running: false,
        error: 'Server not responding on port 8333',
        suggestions: [
          'Start the server: npm start',
          'Check if port is in use',
          'Review server logs'
        ]
      };
    }
  }
  
  async getServerPID() {
    try {
      const result = execSync('pgrep -f "node.*server.js"', { encoding: 'utf8' }).trim();
      return result ? result.split('\\n')[0] : null;
    } catch (e) {
      return null;
    }
  }
  
  async getDatabaseStatus() {
    if (!fs.existsSync(this.dbPath)) {
      return {
        error: 'Database file not found',
        path: this.dbPath
      };
    }
    
    const stats = fs.statSync(this.dbPath);
    
    try {
      // Run a simple query to check database health
      const testQuery = `echo "SELECT 1;" | sqlite3 "${this.dbPath}"`;
      execSync(testQuery, { stdio: 'pipe' });
      
      return {
        healthy: true,
        size: stats.size,
        sizeHuman: this.formatBytes(stats.size),
        lastModified: stats.mtime,
        path: this.dbPath
      };
    } catch (e) {
      return {
        healthy: false,
        error: 'Database query failed',
        size: stats.size,
        sizeHuman: this.formatBytes(stats.size)
      };
    }
  }
  
  async getNetworkStatus() {
    if (!this.hasAccess) return { error: 'No access to IC Mesh' };
    
    try {
      // Get node count from database
      const nodeQuery = `echo "SELECT COUNT(*) FROM nodes;" | sqlite3 "${this.dbPath}"`;
      const totalNodes = parseInt(execSync(nodeQuery, { encoding: 'utf8' }).trim()) || 0;
      
      const activeQuery = `echo "SELECT COUNT(*) FROM nodes WHERE lastSeen > datetime('now', '-5 minutes');" | sqlite3 "${this.dbPath}"`;
      const activeNodes = parseInt(execSync(activeQuery, { encoding: 'utf8' }).trim()) || 0;
      
      return {
        totalNodes,
        activeNodes,
        offlineNodes: totalNodes - activeNodes,
        healthPercent: totalNodes > 0 ? ((activeNodes / totalNodes) * 100).toFixed(1) : 0
      };
    } catch (e) {
      return {
        error: 'Failed to query network status',
        details: e.message
      };
    }
  }
  
  async getJobStatus() {
    if (!this.hasAccess) return { error: 'No access to IC Mesh' };
    
    try {
      const queries = {
        total: `echo "SELECT COUNT(*) FROM jobs;" | sqlite3 "${this.dbPath}"`,
        pending: `echo "SELECT COUNT(*) FROM jobs WHERE status = 'pending';" | sqlite3 "${this.dbPath}"`,
        processing: `echo "SELECT COUNT(*) FROM jobs WHERE status = 'processing';" | sqlite3 "${this.dbPath}"`,
        completed: `echo "SELECT COUNT(*) FROM jobs WHERE status = 'completed';" | sqlite3 "${this.dbPath}"`,
        failed: `echo "SELECT COUNT(*) FROM jobs WHERE status = 'failed';" | sqlite3 "${this.dbPath}"`
      };
      
      const results = {};
      for (const [key, query] of Object.entries(queries)) {
        try {
          results[key] = parseInt(execSync(query, { encoding: 'utf8' }).trim()) || 0;
        } catch (e) {
          results[key] = 0;
        }
      }
      
      // Calculate success rate
      const totalProcessed = results.completed + results.failed;
      results.successRate = totalProcessed > 0 ? 
        ((results.completed / totalProcessed) * 100).toFixed(1) : 0;
      
      // Get recent activity
      try {
        const recentQuery = `echo "SELECT COUNT(*) FROM jobs WHERE createdAt > datetime('now', '-1 hour');" | sqlite3 "${this.dbPath}"`;
        results.recentJobs = parseInt(execSync(recentQuery, { encoding: 'utf8' }).trim()) || 0;
      } catch (e) {
        results.recentJobs = 0;
      }
      
      return results;
    } catch (e) {
      return {
        error: 'Failed to query job status',
        details: e.message
      };
    }
  }
  
  async getNodeStatus() {
    if (!this.hasAccess) return { error: 'No access to IC Mesh' };
    
    try {
      const nodeListQuery = `echo "SELECT nodeId, name, capabilities, lastSeen, jobsCompleted FROM nodes ORDER BY lastSeen DESC LIMIT 10;" | sqlite3 -header -csv "${this.dbPath}"`;
      const result = execSync(nodeListQuery, { encoding: 'utf8' });
      
      const lines = result.trim().split('\\n');
      if (lines.length < 2) return { nodes: [] };
      
      const headers = lines[0].split(',');
      const nodes = lines.slice(1).map(line => {
        const values = line.split(',');
        const node = {};
        headers.forEach((header, index) => {
          node[header] = values[index] || '';
        });
        
        // Calculate time since last seen
        if (node.lastSeen) {
          const lastSeen = new Date(parseInt(node.lastSeen));
          const now = new Date();
          const minutesAgo = Math.floor((now - lastSeen) / 60000);
          node.minutesAgo = minutesAgo;
          node.isActive = minutesAgo < 5;
        }
        
        return node;
      });
      
      return { nodes };
    } catch (e) {
      return {
        error: 'Failed to query node status',
        details: e.message
      };
    }
  }
  
  async getRateLimitingStatus() {
    const configPath = path.join(this.icMeshPath, 'config', 'rate-limits.json');
    const whitelistPath = path.join(this.icMeshPath, 'config', 'rate-limit-whitelist.json');
    const logPath = path.join(this.icMeshPath, 'logs', 'rate-limits.log');
    
    const status = {
      configured: fs.existsSync(configPath),
      whitelisted: false,
      recentBlocks: 0
    };
    
    if (status.configured) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        status.limits = config.limits;
        status.windowMs = config.windowMs;
      } catch (e) {
        status.error = 'Failed to read rate limit config';
      }
    }
    
    if (fs.existsSync(whitelistPath)) {
      try {
        const whitelist = JSON.parse(fs.readFileSync(whitelistPath, 'utf8'));
        status.whitelisted = true;
        status.whitelistCount = whitelist.ips ? whitelist.ips.length : 0;
      } catch (e) {
        // Ignore whitelist errors
      }
    }
    
    // Check recent rate limiting events
    if (fs.existsSync(logPath)) {
      try {
        const logContent = fs.readFileSync(logPath, 'utf8');
        const lines = logContent.split('\\n').filter(Boolean);
        
        // Count rate limit events in last hour
        const oneHourAgo = Date.now() - (60 * 60 * 1000);
        const recentEvents = lines
          .map(line => {
            try {
              return JSON.parse(line);
            } catch {
              return null;
            }
          })
          .filter(Boolean)
          .filter(event => event.event === 'rate_limited' && new Date(event.timestamp) > oneHourAgo);
        
        status.recentBlocks = recentEvents.length;
      } catch (e) {
        // Ignore log parsing errors
      }
    }
    
    return status;
  }
  
  async getPerformanceMetrics() {
    // Quick performance snapshot
    const metrics = {
      timestamp: Date.now(),
      memory: process.memoryUsage(),
      cpu: os.loadavg(),
      uptime: os.uptime()
    };
    
    // Database performance test
    try {
      const start = Date.now();
      execSync(`echo "SELECT COUNT(*) FROM sqlite_master;" | sqlite3 "${this.dbPath}"`, { stdio: 'pipe' });
      metrics.dbResponseTime = Date.now() - start;
    } catch (e) {
      metrics.dbResponseTime = -1;
    }
    
    return metrics;
  }
  
  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
  
  formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m`;
    return `${Math.floor(seconds)}s`;
  }
  
  displayHeader() {
    const now = new Date().toLocaleString();
    console.log(this.color('═'.repeat(80), 'cyan'));
    console.log(this.color('🎛️  IC MESH CONTROL CENTER', 'bold'));
    console.log(this.color(`   Operational Dashboard for Mesh Network Management`, 'gray'));
    console.log(this.color(`   ${now}`, 'gray'));
    console.log(this.color('═'.repeat(80), 'cyan'));
    console.log();
  }
  
  async displayQuickStatus() {
    const health = await this.getSystemHealth();
    const icMesh = await this.getICMeshStatus();
    
    console.log(this.bold('🏥 SYSTEM HEALTH'));
    console.log(`   Uptime: ${this.formatUptime(health.uptime)}`);
    console.log(`   Memory: ${this.formatBytes(health.memory.heapUsed)} / ${this.formatBytes(health.memory.heapTotal)}`);
    console.log(`   CPU Load: ${health.cpu[0].toFixed(2)} (1m avg)`);
    console.log();
    
    if (icMesh.error) {
      console.log(this.color('❌ IC MESH STATUS: NOT ACCESSIBLE', 'red'));
      console.log(`   ${icMesh.error}`);
      icMesh.suggestions?.forEach(suggestion => {
        console.log(this.color(`   • ${suggestion}`, 'yellow'));
      });
    } else {
      console.log(this.color('✅ IC MESH STATUS: OPERATIONAL', 'green'));
      console.log(`   Version: ${icMesh.version}`);
      console.log(`   Server: ${icMesh.server.running ? this.color('Running', 'green') : this.color('Stopped', 'red')}`);
      console.log(`   Database: ${icMesh.database.healthy ? this.color('Healthy', 'green') : this.color('Issues', 'yellow')}`);
      console.log(`   Network: ${icMesh.network.activeNodes}/${icMesh.network.totalNodes} nodes online`);
      console.log(`   Jobs: ${icMesh.jobs.pending} pending, ${icMesh.jobs.processing} processing`);
    }
  }
  
  async displayFullDashboard() {
    this.displayHeader();
    
    const health = await this.getSystemHealth();
    const icMesh = await this.getICMeshStatus();
    
    // System Health Section
    console.log(this.bold('🏥 SYSTEM HEALTH'));
    console.log(`   Platform: ${health.platform} | Node: ${health.nodeVersion} | Host: ${health.hostname}`);
    console.log(`   Uptime: ${this.formatUptime(health.uptime)}`);
    console.log(`   Memory: ${this.formatBytes(health.memory.rss)} RSS | ${this.formatBytes(health.memory.heapUsed)} heap used`);
    console.log(`   System RAM: ${health.systemMemory.usagePercent}% used (${this.formatBytes(health.systemMemory.used)})`);
    console.log(`   CPU Load: ${health.cpu[0].toFixed(2)}, ${health.cpu[1].toFixed(2)}, ${health.cpu[2].toFixed(2)} (1m, 5m, 15m)`);
    console.log();
    
    if (icMesh.error) {
      console.log(this.color('❌ IC MESH: NOT ACCESSIBLE', 'red'));
      console.log(`   ${icMesh.error}`);
      console.log(`   Path: ${this.icMeshPath}`);
      icMesh.suggestions?.forEach(suggestion => {
        console.log(this.color(`   • ${suggestion}`, 'yellow'));
      });
      return;
    }
    
    // IC Mesh Status
    console.log(this.bold('🌐 IC MESH STATUS'));
    console.log(`   Version: ${icMesh.version}`);
    console.log(`   Server: ${icMesh.server.running ? 
      this.color(`Running (PID: ${icMesh.server.pid || 'unknown'})`, 'green') : 
      this.color('Stopped', 'red')}`);
    console.log(`   Database: ${icMesh.database.healthy ? 
      this.color(`Healthy (${icMesh.database.sizeHuman})`, 'green') : 
      this.color('Issues', 'yellow')}`);
    console.log();
    
    // Network Status
    console.log(this.bold('🔗 NETWORK STATUS'));
    if (icMesh.network.error) {
      console.log(this.color(`   Error: ${icMesh.network.error}`, 'red'));
    } else {
      console.log(`   Total Nodes: ${icMesh.network.totalNodes}`);
      console.log(`   Active Nodes: ${this.color(icMesh.network.activeNodes.toString(), icMesh.network.activeNodes > 0 ? 'green' : 'yellow')}`);
      console.log(`   Offline Nodes: ${icMesh.network.offlineNodes}`);
      console.log(`   Network Health: ${icMesh.network.healthPercent}%`);
    }
    console.log();
    
    // Job Queue Status
    console.log(this.bold('📋 JOB QUEUE'));
    if (icMesh.jobs.error) {
      console.log(this.color(`   Error: ${icMesh.jobs.error}`, 'red'));
    } else {
      console.log(`   Total Jobs: ${icMesh.jobs.total}`);
      console.log(`   Pending: ${this.color(icMesh.jobs.pending.toString(), icMesh.jobs.pending > 0 ? 'yellow' : 'green')}`);
      console.log(`   Processing: ${this.color(icMesh.jobs.processing.toString(), icMesh.jobs.processing > 0 ? 'cyan' : 'gray')}`);
      console.log(`   Completed: ${this.color(icMesh.jobs.completed.toString(), 'green')}`);
      console.log(`   Failed: ${icMesh.jobs.failed > 0 ? this.color(icMesh.jobs.failed.toString(), 'red') : icMesh.jobs.failed}`);
      console.log(`   Success Rate: ${icMesh.jobs.successRate}%`);
      console.log(`   Recent (1h): ${icMesh.jobs.recentJobs} jobs`);
    }
    console.log();
    
    // Rate Limiting Status  
    console.log(this.bold('🛡️  RATE LIMITING'));
    if (icMesh.rateLimiting.configured) {
      console.log(this.color('   ✅ Enhanced rate limiting enabled', 'green'));
      console.log(`   Whitelist: ${icMesh.rateLimiting.whitelisted ? 
        `${icMesh.rateLimiting.whitelistCount} IPs` : 'Not configured'}`);
      console.log(`   Recent Blocks: ${icMesh.rateLimiting.recentBlocks} (last hour)`);
      
      if (icMesh.rateLimiting.limits) {
        console.log('   Limits:');
        Object.entries(icMesh.rateLimiting.limits).forEach(([endpoint, limit]) => {
          console.log(`     ${endpoint}: ${limit}/min`);
        });
      }
    } else {
      console.log(this.color('   ⚠️  Basic rate limiting', 'yellow'));
    }
    console.log();
    
    // Performance Metrics
    console.log(this.bold('⚡ PERFORMANCE'));
    console.log(`   DB Response: ${icMesh.performance.dbResponseTime >= 0 ? 
      `${icMesh.performance.dbResponseTime}ms` : 'Error'}`);
    console.log(`   Memory Usage: ${this.formatBytes(icMesh.performance.memory.heapUsed)}`);
    console.log(`   System Uptime: ${this.formatUptime(icMesh.performance.uptime)}`);
    console.log();
    
    // Node Details (if available)
    if (icMesh.nodes && icMesh.nodes.nodes && icMesh.nodes.nodes.length > 0) {
      console.log(this.bold('🤖 ACTIVE NODES'));
      icMesh.nodes.nodes.slice(0, 5).forEach(node => {
        const status = node.isActive ? this.color('●', 'green') : this.color('●', 'red');
        const lastSeen = node.minutesAgo !== undefined ? 
          `${node.minutesAgo}m ago` : 'unknown';
        console.log(`   ${status} ${node.name || node.id} | ${node.capabilities} | ${lastSeen}`);
      });
      
      if (icMesh.nodes.nodes.length > 5) {
        console.log(this.color(`   ... and ${icMesh.nodes.nodes.length - 5} more nodes`, 'gray'));
      }
    }
    
    console.log();
    console.log(this.color('━'.repeat(80), 'gray'));
    console.log(this.color('💡 Pro tip: Use --status for quick checks, --watch for live monitoring', 'gray'));
  }
  
  async watchMode() {
    console.log(this.bold('🔄 LIVE MONITORING MODE'));
    console.log('Refreshing every 10 seconds. Press Ctrl+C to exit.\\n');
    
    const refreshInterval = setInterval(async () => {
      // Clear screen
      process.stdout.write('\\x1b[2J\\x1b[0f');
      
      await this.displayQuickStatus();
      console.log();
      console.log(this.color(`Last updated: ${new Date().toLocaleTimeString()}`, 'gray'));
    }, 10000);
    
    // Initial display
    await this.displayQuickStatus();
    
    process.on('SIGINT', () => {
      clearInterval(refreshInterval);
      console.log('\\n\\n👋 Monitoring stopped. Have a great day!');
      process.exit(0);
    });
  }
}

// CLI Interface
async function main() {
  const args = process.argv.slice(2);
  const controlCenter = new ICMeshControlCenter();
  
  try {
    if (args.includes('--help') || args.includes('-h')) {
      console.log('IC Mesh Control Center - Unified operational dashboard\\n');
      console.log('Usage:');
      console.log('  node ic-mesh-control-center.js           # Full dashboard');
      console.log('  node ic-mesh-control-center.js --status  # Quick status check');
      console.log('  node ic-mesh-control-center.js --watch   # Live monitoring');
      console.log('  node ic-mesh-control-center.js --no-color # Disable colors');
      console.log();
      console.log('The control center provides a unified view of:');
      console.log('  • System health and resource usage');
      console.log('  • IC Mesh server and database status');
      console.log('  • Network node management');
      console.log('  • Job queue monitoring');
      console.log('  • Rate limiting and security status');
      console.log('  • Performance metrics');
      return;
    }
    
    if (args.includes('--watch')) {
      await controlCenter.watchMode();
    } else if (args.includes('--status')) {
      await controlCenter.displayQuickStatus();
    } else {
      await controlCenter.displayFullDashboard();
    }
    
  } catch (error) {
    console.error('❌ Control center error:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = ICMeshControlCenter;