#!/usr/bin/env node
/**
 * IC Mesh Capacity Monitor
 * Real-time monitoring and alerting for node capacity and service health
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

class CapacityMonitor {
  constructor(dbPath = './data/mesh.db') {
    this.dbPath = dbPath;
    this.db = new Database(dbPath, { readonly: true });
  }

  getServiceStatus() {
    const now = Date.now();
    
    // Get node status
    const nodes = this.db.prepare(`
      SELECT nodeId, name, capabilities, lastSeen, jobsCompleted,
             ROUND((? - lastSeen) / 60000.0, 1) as minutesAgo
      FROM nodes 
      ORDER BY lastSeen DESC
    `).all(now);

    // Get job status  
    const jobStats = this.db.prepare(`
      SELECT status, COUNT(*) as count 
      FROM jobs 
      GROUP BY status
    `).all();

    const pendingJobs = this.db.prepare(`
      SELECT type, COUNT(*) as count 
      FROM jobs 
      WHERE status = 'pending'
      GROUP BY type
    `).all();

    // Calculate health metrics
    const activeNodes = nodes.filter(n => n.minutesAgo < 5);
    const recentNodes = nodes.filter(n => n.minutesAgo < 60);
    const totalPending = jobStats.find(j => j.status === 'pending')?.count || 0;
    
    // Available capabilities from active nodes
    const capabilities = new Set();
    activeNodes.forEach(node => {
      const caps = JSON.parse(node.capabilities || '[]');
      caps.forEach(cap => capabilities.add(cap));
    });

    return {
      timestamp: new Date().toISOString(),
      nodes: {
        active: activeNodes.length,
        total: nodes.length,
        recent: recentNodes.length,
        details: nodes.map(n => ({
          id: n.nodeId.substring(0, 8),
          name: n.name || 'unnamed',
          minutesAgo: n.minutesAgo,
          capabilities: JSON.parse(n.capabilities || '[]'),
          jobsCompleted: n.jobsCompleted,
          status: n.minutesAgo < 5 ? 'active' : n.minutesAgo < 60 ? 'recent' : 'offline'
        }))
      },
      jobs: {
        pending: totalPending,
        byType: pendingJobs,
        stats: jobStats
      },
      capabilities: Array.from(capabilities),
      health: this.calculateHealthScore(activeNodes.length, nodes.length, totalPending, capabilities.size),
      alerts: this.generateAlerts(activeNodes, nodes, totalPending, pendingJobs)
    };
  }

  calculateHealthScore(active, total, pending, capabilities) {
    // Base health: percentage of nodes active
    let health = total > 0 ? (active / total) * 70 : 0;
    
    // Bonus for having key capabilities
    const keyCaps = ['transcription', 'whisper', 'stable-diffusion', 'ollama'];
    const capBonus = keyCaps.filter(cap => 
      ['transcription', 'whisper'].includes(cap) || capabilities > 0
    ).length * 5;
    health += capBonus;
    
    // Penalty for job backlog
    if (pending > 0 && active === 0) {
      health = Math.max(0, health - 30); // Service outage penalty
    } else if (pending > 10) {
      health = Math.max(0, health - 10); // Backlog penalty
    }
    
    return Math.round(Math.min(100, health));
  }

  generateAlerts(activeNodes, allNodes, pendingJobs, pendingByType) {
    const alerts = [];
    
    // Critical: Service outage
    if (activeNodes.length === 0 && pendingJobs > 0) {
      alerts.push({
        level: 'CRITICAL',
        message: `Complete service outage: ${pendingJobs} jobs blocked, 0 active nodes`,
        action: 'Contact node operators for immediate reconnection'
      });
    }
    
    // Warning: No capacity
    if (activeNodes.length === 0 && pendingJobs === 0) {
      alerts.push({
        level: 'WARNING', 
        message: 'No processing capacity available (but no demand)',
        action: 'Monitor for new jobs, prepare for capacity restoration'
      });
    }
    
    // Warning: Low capacity
    if (activeNodes.length === 1 && allNodes.length > 1) {
      alerts.push({
        level: 'WARNING',
        message: `Low redundancy: Only 1/${allNodes.length} nodes active`,
        action: 'Consider contacting additional node operators'
      });
    }
    
    // Info: Recent disconnections
    const recentOffline = allNodes.filter(n => n.minutesAgo > 5 && n.minutesAgo < 60);
    if (recentOffline.length > 0) {
      alerts.push({
        level: 'INFO',
        message: `${recentOffline.length} nodes recently offline (${recentOffline.map(n => n.name || 'unnamed').join(', ')})`,
        action: 'Monitor for reconnections within normal pattern'
      });
    }
    
    return alerts;
  }

  startMonitoring(intervalMinutes = 5) {
    console.log(`🔍 Starting capacity monitoring (every ${intervalMinutes} minutes)`);
    console.log('=====================================');
    
    const check = () => {
      const status = this.getServiceStatus();
      this.displayStatus(status);
      
      // Log to file for historical analysis
      this.logStatus(status);
    };
    
    // Initial check
    check();
    
    // Set up interval
    const interval = setInterval(check, intervalMinutes * 60 * 1000);
    
    // Graceful shutdown
    process.on('SIGINT', () => {
      console.log('\n🛑 Stopping monitoring...');
      clearInterval(interval);
      this.db.close();
      process.exit(0);
    });
  }

  displayStatus(status) {
    console.log(`\n[${status.timestamp}] Health: ${status.health}/100`);
    
    // Node status
    const statusEmoji = status.health >= 80 ? '🟢' : status.health >= 50 ? '🟡' : '🔴';
    console.log(`${statusEmoji} Nodes: ${status.nodes.active}/${status.nodes.total} active`);
    
    status.nodes.details.forEach(node => {
      const emoji = node.status === 'active' ? '🟢' : node.status === 'recent' ? '🟡' : '🔴';
      const caps = node.capabilities.slice(0, 3).join(', ');
      console.log(`  ${emoji} ${node.name} (${node.id}): ${node.minutesAgo}m ago - [${caps}] - ${node.jobsCompleted} jobs`);
    });
    
    // Job status
    if (status.jobs.pending > 0) {
      console.log(`📋 Pending: ${status.jobs.pending} jobs`);
      status.jobs.byType.forEach(job => {
        console.log(`   - ${job.type}: ${job.count}`);
      });
    } else {
      console.log('✅ Queue: Clean (no pending jobs)');
    }
    
    // Capabilities
    if (status.capabilities.length > 0) {
      console.log(`🛠️ Available: ${status.capabilities.join(', ')}`);
    } else {
      console.log('❌ Capabilities: None available');
    }
    
    // Alerts
    if (status.alerts.length > 0) {
      console.log('\n🚨 Alerts:');
      status.alerts.forEach(alert => {
        const emoji = alert.level === 'CRITICAL' ? '🔴' : alert.level === 'WARNING' ? '🟡' : 'ℹ️';
        console.log(`${emoji} ${alert.level}: ${alert.message}`);
        console.log(`   Action: ${alert.action}`);
      });
    }
  }

  logStatus(status) {
    const logDir = './logs';
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    
    const logFile = path.join(logDir, 'capacity-monitor.jsonl');
    const logEntry = JSON.stringify(status) + '\n';
    
    fs.appendFileSync(logFile, logEntry);
  }

  close() {
    this.db.close();
  }
}

// CLI usage
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0] || 'check';
  
  const monitor = new CapacityMonitor();
  
  switch (command) {
    case 'check':
      const status = monitor.getServiceStatus();
      monitor.displayStatus(status);
      monitor.close();
      break;
      
    case 'monitor':
      const interval = parseInt(args[1]) || 5;
      monitor.startMonitoring(interval);
      break;
      
    case 'alerts':
      const alertStatus = monitor.getServiceStatus();
      if (alertStatus.alerts.length > 0) {
        console.log('🚨 Active Alerts:');
        alertStatus.alerts.forEach(alert => {
          console.log(`${alert.level}: ${alert.message}`);
        });
        process.exit(1); // Exit with error for scripting
      } else {
        console.log('✅ No active alerts');
        process.exit(0);
      }
      break;
      
    default:
      console.log('Usage:');
      console.log('  node monitor-capacity.js check          - One-time status check');
      console.log('  node monitor-capacity.js monitor [min]  - Continuous monitoring');
      console.log('  node monitor-capacity.js alerts         - Check alerts only');
      monitor.close();
  }
}

module.exports = CapacityMonitor;