#!/usr/bin/env node

/**
 * IC Mesh System Dashboard
 * 
 * Displays real-time system status, health metrics, and key performance indicators
 * Perfect for operators who want a quick overview of their IC Mesh node/network
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class SystemDashboard {
  constructor() {
    this.colors = {
      green: '\x1b[32m',
      red: '\x1b[31m',
      yellow: '\x1b[33m',
      blue: '\x1b[34m',
      cyan: '\x1b[36m',
      white: '\x1b[37m',
      bold: '\x1b[1m',
      reset: '\x1b[0m'
    };
  }
  
  color(text, colorName) {
    if (process.argv.includes('--no-color')) {
      return text;
    }
    return `${this.colors[colorName]}${text}${this.colors.reset}`;
  }
  
  formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (days > 0) {
      return `${days}d ${hours}h ${minutes}m`;
    } else if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  }
  
  formatBytes(bytes) {
    const sizes = ['B', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 B';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
  }
  
  getStatusIcon(status) {
    const icons = {
      healthy: '🟢',
      warning: '🟡',
      error: '🔴',
      unknown: '⚪',
      offline: '⚫'
    };
    return icons[status] || '⚪';
  }
  
  async getSystemInfo() {
    const info = {};
    
    try {
      // System uptime
      const uptime = parseFloat(fs.readFileSync('/proc/uptime', 'utf8').split(' ')[0]);
      info.uptime = this.formatUptime(uptime);
    } catch {
      info.uptime = 'Unknown';
    }
    
    try {
      // Load average
      const loadavg = fs.readFileSync('/proc/loadavg', 'utf8').trim().split(' ');
      info.load = `${loadavg[0]} ${loadavg[1]} ${loadavg[2]}`;
    } catch {
      info.load = 'Unknown';
    }
    
    try {
      // Memory info
      const meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
      const memTotal = parseInt(meminfo.match(/MemTotal:\s+(\d+)/)[1]) * 1024;
      const memAvailable = parseInt(meminfo.match(/MemAvailable:\s+(\d+)/)[1]) * 1024;
      const memUsed = memTotal - memAvailable;
      
      info.memory = {
        total: this.formatBytes(memTotal),
        used: this.formatBytes(memUsed),
        available: this.formatBytes(memAvailable),
        usagePercent: Math.round((memUsed / memTotal) * 100)
      };
    } catch {
      info.memory = { total: 'Unknown', used: 'Unknown', available: 'Unknown', usagePercent: 0 };
    }
    
    try {
      // Disk space
      const df = execSync('df . | tail -1', { encoding: 'utf8' }).trim();
      const parts = df.split(/\s+/);
      const totalKB = parseInt(parts[1]);
      const usedKB = parseInt(parts[2]);
      const availableKB = parseInt(parts[3]);
      const usagePercent = parseInt(parts[4]);
      
      info.disk = {
        total: this.formatBytes(totalKB * 1024),
        used: this.formatBytes(usedKB * 1024),
        available: this.formatBytes(availableKB * 1024),
        usagePercent
      };
    } catch {
      info.disk = { total: 'Unknown', used: 'Unknown', available: 'Unknown', usagePercent: 0 };
    }
    
    return info;
  }
  
  async getICMeshStatus() {
    const status = {
      server: { status: 'unknown', message: 'Not checked' },
      database: { status: 'unknown', message: 'Not checked' },
      jobs: { total: 0, pending: 0, completed: 0, failed: 0 },
      nodes: { total: 0, active: 0 }
    };
    
    try {
      // Check if server is running
      const serverCheck = execSync('curl -s -m 3 http://localhost:8333/health', { encoding: 'utf8' });
      const serverHealth = JSON.parse(serverCheck);
      status.server = {
        status: serverHealth.status === 'healthy' ? 'healthy' : 'warning',
        message: `Response: ${serverHealth.status}`,
        uptime: serverHealth.uptime
      };
    } catch (error) {
      status.server = {
        status: 'error',
        message: 'Server not responding'
      };
    }
    
    try {
      // Check database
      const dbPath = path.join(__dirname, '..', 'mesh.db');
      if (fs.existsSync(dbPath)) {
        const Database = require('better-sqlite3');
        const db = new Database(dbPath, { readonly: true });
        
        // Get job counts
        const jobStats = {
          total: db.prepare('SELECT COUNT(*) as count FROM jobs').get().count,
          pending: db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'pending'").get().count,
          completed: db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'completed'").get().count,
          failed: db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'failed'").get().count
        };
        
        status.jobs = jobStats;
        status.database = {
          status: 'healthy',
          message: `${jobStats.total} jobs in database`
        };
        
        // Get node info
        try {
          const nodeStats = db.prepare(`
            SELECT 
              COUNT(DISTINCT nodeId) as total,
              COUNT(DISTINCT CASE WHEN lastHeartbeat > ? THEN nodeId END) as active
            FROM nodes 
            WHERE nodeId IS NOT NULL
          `).get(Date.now() - 5 * 60 * 1000); // Active = heartbeat within 5 minutes
          
          status.nodes = nodeStats;
        } catch {
          // nodes table might not exist in older versions
        }
        
        db.close();
      } else {
        status.database = {
          status: 'error',
          message: 'Database file not found'
        };
      }
    } catch (error) {
      status.database = {
        status: 'error',
        message: `Database error: ${error.message}`
      };
    }
    
    return status;
  }
  
  async getRecentActivity() {
    const activity = {
      recentJobs: [],
      errorCount: 0,
      successRate: 0
    };
    
    try {
      const dbPath = path.join(__dirname, '..', 'mesh.db');
      if (fs.existsSync(dbPath)) {
        const Database = require('better-sqlite3');
        const db = new Database(dbPath, { readonly: true });
        
        // Get recent jobs (last 10)
        const recentJobs = db.prepare(`
          SELECT jobId, type, status, createdAt, completedAt, nodeId
          FROM jobs 
          ORDER BY createdAt DESC 
          LIMIT 10
        `).all();
        
        activity.recentJobs = recentJobs.map(job => ({
          ...job,
          age: Math.round((Date.now() - job.createdAt) / 1000)
        }));
        
        // Calculate success rate for recent jobs
        const recentTotal = recentJobs.length;
        const recentCompleted = recentJobs.filter(j => j.status === 'completed').length;
        activity.successRate = recentTotal > 0 ? Math.round((recentCompleted / recentTotal) * 100) : 0;
        activity.errorCount = recentJobs.filter(j => j.status === 'failed').length;
        
        db.close();
      }
    } catch (error) {
      // Ignore database errors for activity
    }
    
    return activity;
  }
  
  async getMaintenanceInfo() {
    const maintenance = {
      lastRun: 'Never',
      recentIssues: 0,
      logFileSize: 0
    };
    
    try {
      // Check maintenance log
      const logPath = path.join(__dirname, '..', 'logs', 'maintenance.log');
      if (fs.existsSync(logPath)) {
        const stats = fs.statSync(logPath);
        maintenance.logFileSize = stats.size;
        
        // Get last maintenance run
        const logContent = fs.readFileSync(logPath, 'utf8');
        const lines = logContent.trim().split('\n');
        const lastLine = lines[lines.length - 1];
        const timestampMatch = lastLine.match(/\[([\d-T:.Z]+)\]/);
        if (timestampMatch) {
          const lastRunTime = new Date(timestampMatch[1]);
          const ago = Math.round((Date.now() - lastRunTime.getTime()) / 1000);
          maintenance.lastRun = this.formatUptime(ago) + ' ago';
        }
        
        // Count recent errors/warnings
        const recent = lines.slice(-50).join('\n');
        maintenance.recentIssues = (recent.match(/❌|⚠️/g) || []).length;
      }
    } catch (error) {
      // Ignore maintenance info errors
    }
    
    return maintenance;
  }
  
  printDashboard(systemInfo, icMeshStatus, activity, maintenance) {
    // Clear screen and print header
    if (!process.argv.includes('--no-clear')) {
      console.clear();
    }
    
    console.log(this.color('╔══════════════════════════════════════════════════════════════╗', 'cyan'));
    console.log(this.color('║                    IC MESH SYSTEM DASHBOARD                 ║', 'cyan'));
    console.log(this.color('╚══════════════════════════════════════════════════════════════╝', 'cyan'));
    console.log();
    
    // System Status Section
    console.log(this.color('🖥️  SYSTEM STATUS', 'bold'));
    console.log('═'.repeat(60));
    console.log(`${this.color('Uptime:', 'white')}        ${systemInfo.uptime}`);
    console.log(`${this.color('Load Average:', 'white')}  ${systemInfo.load}`);
    
    const memStatus = systemInfo.memory.usagePercent > 85 ? 'error' : systemInfo.memory.usagePercent > 70 ? 'warning' : 'healthy';
    const diskStatus = systemInfo.disk.usagePercent > 85 ? 'error' : systemInfo.disk.usagePercent > 70 ? 'warning' : 'healthy';
    
    console.log(`${this.color('Memory:', 'white')}        ${this.getStatusIcon(memStatus)} ${systemInfo.memory.used}/${systemInfo.memory.total} (${systemInfo.memory.usagePercent}%)`);
    console.log(`${this.color('Disk Space:', 'white')}    ${this.getStatusIcon(diskStatus)} ${systemInfo.disk.available} available (${systemInfo.disk.usagePercent}% used)`);
    console.log();
    
    // IC Mesh Status Section
    console.log(this.color('🌐 IC MESH STATUS', 'bold'));
    console.log('═'.repeat(60));
    console.log(`${this.color('Server:', 'white')}        ${this.getStatusIcon(icMeshStatus.server.status)} ${icMeshStatus.server.message}`);
    console.log(`${this.color('Database:', 'white')}      ${this.getStatusIcon(icMeshStatus.database.status)} ${icMeshStatus.database.message}`);
    console.log(`${this.color('Network:', 'white')}       ${icMeshStatus.nodes.active}/${icMeshStatus.nodes.total} nodes active`);
    console.log();
    
    // Job Statistics
    console.log(this.color('📊 JOB STATISTICS', 'bold'));
    console.log('═'.repeat(60));
    console.log(`${this.color('Total Jobs:', 'white')}    ${icMeshStatus.jobs.total.toLocaleString()}`);
    console.log(`${this.color('Pending:', 'white')}       ${icMeshStatus.jobs.pending.toLocaleString()}`);
    console.log(`${this.color('Completed:', 'white')}     ${this.color(icMeshStatus.jobs.completed.toLocaleString(), 'green')}`);
    console.log(`${this.color('Failed:', 'white')}        ${icMeshStatus.jobs.failed > 0 ? this.color(icMeshStatus.jobs.failed.toLocaleString(), 'red') : '0'}`);
    console.log(`${this.color('Success Rate:', 'white')}  ${activity.successRate}% (recent jobs)`);
    console.log();
    
    // Recent Activity
    if (activity.recentJobs.length > 0) {
      console.log(this.color('📋 RECENT ACTIVITY (Last 10 Jobs)', 'bold'));
      console.log('═'.repeat(60));
      
      for (const job of activity.recentJobs.slice(0, 5)) {
        const statusIcon = {
          completed: '✅',
          failed: '❌',
          pending: '🔄',
          claimed: '⚡'
        }[job.status] || '⚪';
        
        const jobId = job.jobId.substring(0, 8);
        const age = this.formatUptime(job.age);
        const nodeId = job.nodeId ? job.nodeId.substring(0, 8) : 'none';
        
        console.log(`${statusIcon} ${jobId}... ${job.type.padEnd(12)} ${age.padEnd(8)} ${nodeId}...`);
      }
      
      if (activity.recentJobs.length > 5) {
        console.log(`    ... and ${activity.recentJobs.length - 5} more`);
      }
      console.log();
    }
    
    // Maintenance Info
    console.log(this.color('🔧 MAINTENANCE', 'bold'));
    console.log('═'.repeat(60));
    console.log(`${this.color('Last Run:', 'white')}      ${maintenance.lastRun}`);
    console.log(`${this.color('Recent Issues:', 'white')} ${maintenance.recentIssues > 0 ? this.color(maintenance.recentIssues, 'yellow') : '0'}`);
    console.log(`${this.color('Log Size:', 'white')}      ${this.formatBytes(maintenance.logFileSize)}`);
    console.log();
    
    // Footer with timestamp and refresh info
    const now = new Date().toLocaleString();
    console.log(this.color('─'.repeat(60), 'cyan'));
    console.log(this.color(`📅 ${now}                     Press Ctrl+C to exit`, 'cyan'));
    
    if (process.argv.includes('--watch')) {
      console.log(this.color('🔄 Auto-refreshing every 30 seconds...', 'cyan'));
    }
  }
  
  async run() {
    const [systemInfo, icMeshStatus, activity, maintenance] = await Promise.all([
      this.getSystemInfo(),
      this.getICMeshStatus(),
      this.getRecentActivity(),
      this.getMaintenanceInfo()
    ]);
    
    this.printDashboard(systemInfo, icMeshStatus, activity, maintenance);
  }
}

// CLI execution
async function main() {
  const dashboard = new SystemDashboard();
  
  if (process.argv.includes('--watch')) {
    // Watch mode - refresh every 30 seconds
    while (true) {
      try {
        await dashboard.run();
        await new Promise(resolve => setTimeout(resolve, 30000));
      } catch (error) {
        console.error('Dashboard error:', error.message);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  } else {
    // Single run
    try {
      await dashboard.run();
    } catch (error) {
      console.error('Dashboard error:', error.message);
      process.exit(1);
    }
  }
}

if (require.main === module) {
  main();
}

module.exports = SystemDashboard;