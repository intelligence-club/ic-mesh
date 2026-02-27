#!/usr/bin/env node
/**
 * IC Mesh Operations Dashboard
 * 
 * Real-time operational monitoring and management interface providing:
 * - System health overview and alerts
 * - Node performance and capacity monitoring
 * - Job queue management and insights
 * - Business metrics and revenue tracking
 * - Automated maintenance recommendations
 * - Interactive management actions
 * 
 * Usage: node ops-dashboard.js [--refresh=5s] [--alerts] [--interactive]
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Configuration
const DB_PATH = process.env.DB_PATH || './mesh.db';
const REFRESH_INTERVAL = 5000; // 5 seconds
const ALERT_THRESHOLDS = {
  pendingJobs: 50,
  failureRate: 0.1,
  nodeOfflineMinutes: 10,
  lowSuccessRate: 0.8,
  queueBacklog: 100,
  systemLoad: 0.9
};

class OperationsDashboard {
  constructor(options = {}) {
    this.options = {
      refreshInterval: this.parseInterval(options.refresh || '5s'),
      showAlerts: options.alerts !== false,
      interactive: options.interactive || false
    };
    
    this.db = new Database(DB_PATH, { readonly: true });
    this.running = false;
    this.lastUpdate = null;
    
    if (this.options.interactive) {
      this.setupInteractiveMode();
    }
  }

  /**
   * Start the operations dashboard
   */
  async start() {
    console.log('🚀 IC Mesh Operations Dashboard');
    console.log('================================\n');
    
    this.running = true;
    
    while (this.running) {
      await this.refreshDashboard();
      
      if (!this.options.interactive) {
        await this.sleep(this.options.refreshInterval);
      } else {
        await this.handleInteractiveInput();
      }
    }
  }

  /**
   * Refresh dashboard data and display
   */
  async refreshDashboard() {
    try {
      console.clear();
      console.log('🚀 IC Mesh Operations Dashboard');
      console.log('================================');
      console.log(`Last updated: ${new Date().toLocaleTimeString()} | Press 'h' for help\n`);
      
      const data = await this.collectSystemData();
      
      this.displaySystemHealth(data.health);
      this.displayNodeStatus(data.nodes);
      this.displayJobQueue(data.jobs);
      this.displayBusinessMetrics(data.business);
      this.displayAlerts(data.alerts);
      this.displayQuickActions();
      
      this.lastUpdate = Date.now();
      
    } catch (error) {
      console.error('❌ Dashboard refresh failed:', error.message);
    }
  }

  /**
   * Collect comprehensive system data
   */
  async collectSystemData() {
    const data = {
      health: await this.getSystemHealth(),
      nodes: await this.getNodeStatus(),
      jobs: await this.getJobQueueStatus(),
      business: await this.getBusinessMetrics(),
      alerts: []
    };
    
    data.alerts = await this.generateAlerts(data);
    return data;
  }

  /**
   * Get overall system health metrics
   */
  async getSystemHealth() {
    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000);
    
    // Recent job success rate
    const recentJobs = this.db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
      FROM jobs 
      WHERE createdAt > ?
    `).get(oneHourAgo);
    
    const successRate = recentJobs.total > 0 ? recentJobs.completed / recentJobs.total : 0;
    
    // Active nodes
    const activeNodes = this.db.prepare(`
      SELECT COUNT(*) as count 
      FROM nodes 
      WHERE lastHeartbeat > datetime('now', '-5 minutes')
    `).get().count;
    
    const totalNodes = this.db.prepare('SELECT COUNT(*) as count FROM nodes').get().count;
    
    // System load approximation
    const pendingJobs = this.db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'pending'").get().count;
    const systemLoad = Math.min(1, pendingJobs / 100); // Normalize to 0-1
    
    return {
      successRate,
      activeNodes,
      totalNodes,
      systemLoad,
      recentJobsTotal: recentJobs.total,
      recentJobsCompleted: recentJobs.completed,
      recentJobsFailed: recentJobs.failed,
      healthScore: this.calculateHealthScore(successRate, activeNodes, totalNodes, systemLoad)
    };
  }

  /**
   * Get detailed node status information
   */
  async getNodeStatus() {
    const nodes = this.db.prepare(`
      SELECT 
        n.*,
        COALESCE(j.jobs_completed, 0) as jobs_completed,
        COALESCE(j.jobs_failed, 0) as jobs_failed,
        COALESCE(j.success_rate, 0) as success_rate,
        CASE 
          WHEN n.lastHeartbeat > datetime('now', '-5 minutes') THEN 'online'
          WHEN n.lastHeartbeat > datetime('now', '-30 minutes') THEN 'recent'
          ELSE 'offline'
        END as status
      FROM nodes n
      LEFT JOIN (
        SELECT 
          claimedBy,
          COUNT(*) as total_jobs,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as jobs_completed,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as jobs_failed,
          CASE WHEN COUNT(*) > 0 
            THEN CAST(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS REAL) / COUNT(*)
            ELSE 0 
          END as success_rate
        FROM jobs 
        GROUP BY claimedBy
      ) j ON n.nodeId = j.claimedBy
      ORDER BY n.lastHeartbeat DESC
    `).all();
    
    return nodes.map(node => ({
      ...node,
      lastSeenMinutes: node.lastHeartbeat ? 
        Math.floor((Date.now() - new Date(node.lastHeartbeat).getTime()) / (1000 * 60)) : 999,
      capabilities: JSON.parse(node.capabilities || '[]'),
      models: JSON.parse(node.models || '[]')
    }));
  }

  /**
   * Get job queue status and metrics
   */
  async getJobQueueStatus() {
    // Queue breakdown by type and status
    const queueBreakdown = this.db.prepare(`
      SELECT 
        type,
        status,
        COUNT(*) as count,
        AVG(CASE WHEN completedAt IS NOT NULL AND claimedAt IS NOT NULL 
            THEN (completedAt - claimedAt) / 1000.0 ELSE NULL END) as avg_duration
      FROM jobs 
      WHERE createdAt > datetime('now', '-24 hours')
      GROUP BY type, status
      ORDER BY type, status
    `).all();
    
    // Recent throughput
    const throughput = this.db.prepare(`
      SELECT 
        strftime('%H', datetime(createdAt, 'unixepoch')) as hour,
        COUNT(*) as jobs_created,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as jobs_completed
      FROM jobs
      WHERE createdAt > datetime('now', '-24 hours')
      GROUP BY strftime('%H', datetime(createdAt, 'unixepoch'))
      ORDER BY hour DESC
      LIMIT 6
    `).all();
    
    // Current queue state
    const currentQueue = this.db.prepare(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
        COUNT(CASE WHEN status = 'claimed' THEN 1 END) as claimed,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed
      FROM jobs
      WHERE createdAt > datetime('now', '-1 hour')
    `).get();
    
    return {
      breakdown: queueBreakdown,
      throughput,
      current: currentQueue
    };
  }

  /**
   * Get business metrics and revenue data
   */
  async getBusinessMetrics() {
    const totalJobs = this.db.prepare('SELECT COUNT(*) as count FROM jobs').get().count;
    const completedJobs = this.db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'completed'").get().count;
    
    // Revenue calculations (simplified)
    const avgJobValue = 0.10; // $0.10 per job
    const totalRevenue = completedJobs * avgJobValue;
    
    // Recent performance
    const last24h = this.db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
      FROM jobs 
      WHERE createdAt > datetime('now', '-24 hours')
    `).get();
    
    const dailyRevenue = last24h.completed * avgJobValue;
    
    return {
      totalJobs,
      completedJobs,
      totalRevenue,
      dailyRevenue,
      successRate: totalJobs > 0 ? completedJobs / totalJobs : 0,
      last24h
    };
  }

  /**
   * Generate system alerts based on thresholds
   */
  async generateAlerts(data) {
    const alerts = [];
    
    // High pending jobs
    if (data.jobs.current.pending > ALERT_THRESHOLDS.pendingJobs) {
      alerts.push({
        level: 'warning',
        type: 'queue',
        message: `High pending jobs: ${data.jobs.current.pending}`,
        action: 'Consider adding more nodes or investigating bottlenecks'
      });
    }
    
    // Low success rate
    if (data.health.successRate < ALERT_THRESHOLDS.lowSuccessRate) {
      alerts.push({
        level: 'critical',
        type: 'performance',
        message: `Low success rate: ${(data.health.successRate * 100).toFixed(1)}%`,
        action: 'Investigate job failures and node issues'
      });
    }
    
    // Offline nodes
    const offlineNodes = data.nodes.filter(n => n.status === 'offline');
    if (offlineNodes.length > 0) {
      alerts.push({
        level: 'info',
        type: 'nodes',
        message: `${offlineNodes.length} nodes offline`,
        action: 'Check node connectivity and health'
      });
    }
    
    // System overload
    if (data.health.systemLoad > ALERT_THRESHOLDS.systemLoad) {
      alerts.push({
        level: 'warning',
        type: 'load',
        message: `High system load: ${(data.health.systemLoad * 100).toFixed(0)}%`,
        action: 'Monitor performance and consider scaling'
      });
    }
    
    return alerts.sort((a, b) => {
      const priority = { critical: 3, warning: 2, info: 1 };
      return priority[b.level] - priority[a.level];
    });
  }

  /**
   * Display system health overview
   */
  displaySystemHealth(health) {
    const healthEmoji = health.healthScore >= 90 ? '🟢' : 
                       health.healthScore >= 70 ? '🟡' : 
                       health.healthScore >= 50 ? '🟠' : '🔴';
    
    console.log('🏥 System Health');
    console.log('----------------');
    console.log(`Overall Health: ${healthEmoji} ${health.healthScore}/100`);
    console.log(`Success Rate: ${(health.successRate * 100).toFixed(1)}%`);
    console.log(`Active Nodes: ${health.activeNodes}/${health.totalNodes}`);
    console.log(`System Load: ${(health.systemLoad * 100).toFixed(0)}%`);
    console.log(`Jobs (1h): ${health.recentJobsTotal} total, ${health.recentJobsCompleted} completed, ${health.recentJobsFailed} failed\n`);
  }

  /**
   * Display node status table
   */
  displayNodeStatus(nodes) {
    console.log('🖥️  Node Status');
    console.log('---------------');
    
    if (nodes.length === 0) {
      console.log('No nodes registered\n');
      return;
    }
    
    console.log('Name           | Status  | Success | Jobs | Last Seen | Capabilities');
    console.log('---------------|---------|---------|------|-----------|-------------');
    
    nodes.slice(0, 8).forEach(node => {
      const name = node.name?.substring(0, 14).padEnd(14) || node.nodeId.substring(0, 14).padEnd(14);
      const status = {
        'online': '🟢 Online ',
        'recent': '🟡 Recent',
        'offline': '🔴 Offline'
      }[node.status];
      
      const successRate = node.success_rate ? `${(node.success_rate * 100).toFixed(0)}%`.padStart(6) : '  N/A ';
      const jobCount = `${node.jobs_completed || 0}`.padStart(4);
      const lastSeen = node.lastSeenMinutes < 60 ? `${node.lastSeenMinutes}m` : `${Math.floor(node.lastSeenMinutes / 60)}h`;
      const capabilities = node.capabilities.slice(0, 3).join(',').substring(0, 12) || 'none';
      
      console.log(`${name} | ${status} | ${successRate} | ${jobCount} | ${lastSeen.padStart(8)} | ${capabilities}`);
    });
    
    if (nodes.length > 8) {
      console.log(`... and ${nodes.length - 8} more nodes`);
    }
    console.log();
  }

  /**
   * Display job queue information
   */
  displayJobQueue(jobs) {
    console.log('📋 Job Queue');
    console.log('-------------');
    console.log(`Current Hour: ${jobs.current.pending} pending, ${jobs.current.claimed} claimed, ${jobs.current.completed} completed, ${jobs.current.failed} failed`);
    
    if (jobs.throughput.length > 0) {
      console.log('\nHourly Throughput (last 6 hours):');
      jobs.throughput.forEach(slot => {
        const hour = slot.hour.padStart(2, '0');
        const created = `${slot.jobs_created}`.padStart(3);
        const completed = `${slot.jobs_completed}`.padStart(3);
        const bar = '█'.repeat(Math.floor(slot.jobs_completed / 10));
        console.log(`  ${hour}:00 | Created: ${created} | Completed: ${completed} ${bar}`);
      });
    }
    console.log();
  }

  /**
   * Display business metrics
   */
  displayBusinessMetrics(business) {
    console.log('💰 Business Metrics');
    console.log('-------------------');
    console.log(`Total Jobs: ${business.totalJobs.toLocaleString()}`);
    console.log(`Completed: ${business.completedJobs.toLocaleString()} (${(business.successRate * 100).toFixed(1)}%)`);
    console.log(`Revenue: $${business.totalRevenue.toFixed(2)} total | $${business.dailyRevenue.toFixed(2)} today`);
    console.log(`Projected Monthly: $${(business.dailyRevenue * 30).toFixed(2)}\n`);
  }

  /**
   * Display active alerts
   */
  displayAlerts(alerts) {
    if (alerts.length === 0) {
      console.log('✅ No active alerts\n');
      return;
    }
    
    console.log('🚨 Active Alerts');
    console.log('----------------');
    
    alerts.forEach((alert, i) => {
      const icon = {
        'critical': '🔴',
        'warning': '🟡', 
        'info': '🔵'
      }[alert.level];
      
      console.log(`${i + 1}. ${icon} ${alert.message}`);
      console.log(`   Action: ${alert.action}`);
    });
    console.log();
  }

  /**
   * Display quick action menu
   */
  displayQuickActions() {
    if (!this.options.interactive) return;
    
    console.log('🎛️  Quick Actions');
    console.log('----------------');
    console.log('r - Refresh | n - Node details | j - Job details | a - Alerts | q - Quit | h - Help');
  }

  /**
   * Calculate overall health score
   */
  calculateHealthScore(successRate, activeNodes, totalNodes, systemLoad) {
    const successWeight = 0.4;
    const nodeWeight = 0.3;  
    const loadWeight = 0.3;
    
    const successScore = successRate * 100;
    const nodeScore = totalNodes > 0 ? (activeNodes / totalNodes) * 100 : 0;
    const loadScore = Math.max(0, (1 - systemLoad) * 100);
    
    return Math.round(
      successScore * successWeight +
      nodeScore * nodeWeight +
      loadScore * loadWeight
    );
  }

  /**
   * Setup interactive mode
   */
  setupInteractiveMode() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    process.stdin.setRawMode(true);
    process.stdin.resume();
  }

  /**
   * Handle interactive input
   */
  async handleInteractiveInput() {
    return new Promise((resolve) => {
      const handler = (key) => {
        const keyStr = key.toString();
        
        switch (keyStr) {
          case 'r':
            process.stdin.removeListener('data', handler);
            resolve();
            break;
          case 'q':
            this.running = false;
            process.stdin.removeListener('data', handler);
            resolve();
            break;
          case 'h':
            this.showHelp();
            break;
          case 'n':
            this.showNodeDetails();
            break;
          case 'j':
            this.showJobDetails();
            break;
          case 'a':
            this.showAlertDetails();
            break;
          case '\u0003': // Ctrl+C
            this.running = false;
            process.stdin.removeListener('data', handler);
            resolve();
            break;
        }
      };
      
      process.stdin.on('data', handler);
    });
  }

  /**
   * Show help information
   */
  showHelp() {
    console.log('\n📖 Help');
    console.log('========');
    console.log('r - Refresh dashboard');
    console.log('n - Show detailed node information');
    console.log('j - Show detailed job information');
    console.log('a - Show detailed alerts');
    console.log('q - Quit dashboard');
    console.log('h - Show this help');
    console.log('\nPress any key to continue...');
  }

  /**
   * Show detailed node information
   */
  async showNodeDetails() {
    console.log('\n🖥️  Detailed Node Information');
    console.log('==============================');
    
    const nodes = await this.getNodeStatus();
    nodes.forEach(node => {
      console.log(`\n${node.name || node.nodeId}:`);
      console.log(`  Status: ${node.status}`);
      console.log(`  Success Rate: ${(node.success_rate * 100).toFixed(1)}%`);
      console.log(`  Jobs: ${node.jobs_completed} completed, ${node.jobs_failed} failed`);
      console.log(`  Resources: ${node.cpuCores} cores, ${node.ramMB}MB RAM`);
      console.log(`  Capabilities: ${node.capabilities.join(', ') || 'none'}`);
      console.log(`  Last Heartbeat: ${node.lastSeenMinutes} minutes ago`);
    });
    
    console.log('\nPress any key to continue...');
  }

  /**
   * Show detailed job information
   */
  async showJobDetails() {
    console.log('\n📋 Detailed Job Information');
    console.log('============================');
    
    const recentJobs = this.db.prepare(`
      SELECT * FROM jobs 
      ORDER BY createdAt DESC 
      LIMIT 10
    `).all();
    
    recentJobs.forEach(job => {
      const created = new Date(job.createdAt).toLocaleTimeString();
      console.log(`\n${job.jobId.substring(0, 8)}... (${job.type}):`);
      console.log(`  Status: ${job.status}`);
      console.log(`  Created: ${created}`);
      console.log(`  Node: ${job.claimedBy || 'none'}`);
      if (job.error) {
        console.log(`  Error: ${job.error.substring(0, 50)}...`);
      }
    });
    
    console.log('\nPress any key to continue...');
  }

  /**
   * Show detailed alert information
   */
  async showAlertDetails() {
    console.log('\n🚨 Detailed Alert Information');
    console.log('==============================');
    
    const data = await this.collectSystemData();
    const alerts = data.alerts;
    
    if (alerts.length === 0) {
      console.log('✅ No active alerts');
    } else {
      alerts.forEach(alert => {
        console.log(`\n${alert.level.toUpperCase()}: ${alert.message}`);
        console.log(`Type: ${alert.type}`);
        console.log(`Recommended Action: ${alert.action}`);
      });
    }
    
    console.log('\nPress any key to continue...');
  }

  /**
   * Parse interval string to milliseconds
   */
  parseInterval(intervalStr) {
    const match = intervalStr.match(/^(\d+)([smh])$/);
    if (!match) return 5000;
    
    const value = parseInt(match[1]);
    const unit = match[2];
    
    switch (unit) {
      case 's': return value * 1000;
      case 'm': return value * 60 * 1000;
      case 'h': return value * 60 * 60 * 1000;
      default: return 5000;
    }
  }

  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Cleanup on exit
   */
  cleanup() {
    if (this.rl) {
      this.rl.close();
    }
    
    if (this.db) {
      this.db.close();
    }
    
    process.stdin.setRawMode(false);
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  
  const options = {
    refresh: args.find(arg => arg.startsWith('--refresh='))?.split('=')[1] || '5s',
    alerts: !args.includes('--no-alerts'),
    interactive: args.includes('--interactive')
  };
  
  const dashboard = new OperationsDashboard(options);
  
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    dashboard.cleanup();
    process.exit(0);
  });
  
  process.on('SIGTERM', () => {
    dashboard.cleanup();
    process.exit(0);
  });
  
  try {
    await dashboard.start();
  } catch (error) {
    console.error('❌ Dashboard failed:', error.message);
    process.exit(1);
  } finally {
    dashboard.cleanup();
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = OperationsDashboard;