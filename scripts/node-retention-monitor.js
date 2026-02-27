#!/usr/bin/env node

/**
 * IC Mesh Node Retention Monitor
 * Real-time monitoring for node retention patterns and early warning system
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs').promises;

const dbPath = path.join(__dirname, '..', 'data', 'mesh.db');

class NodeRetentionMonitor {
  constructor(options = {}) {
    this.db = new sqlite3.Database(dbPath);
    this.alertThreshold = options.alertThreshold || 70; // Retention percentage
    this.checkInterval = options.checkInterval || 300000; // 5 minutes
    this.running = false;
    this.lastCheck = null;
    this.retentionHistory = [];
  }

  async getCurrentRetentionMetrics() {
    return new Promise((resolve, reject) => {
      this.db.all(`
        SELECT 
          COUNT(*) as total_nodes,
          COUNT(CASE WHEN (unixepoch('now') - lastSeen) / 60 < 10 THEN 1 END) as active_nodes,
          COUNT(CASE WHEN (unixepoch('now') - lastSeen) / 3600 < 24 THEN 1 END) as recent_nodes,
          COUNT(CASE WHEN (unixepoch('now') - lastSeen) / 86400 > 7 THEN 1 END) as churned_nodes,
          AVG(CASE WHEN (unixepoch('now') - lastSeen) / 60 < 10 THEN jobsCompleted ELSE NULL END) as avg_active_jobs,
          AVG(computeMinutes) as avg_compute_time,
          COUNT(CASE WHEN jobsCompleted > 0 THEN 1 END) as productive_nodes
        FROM nodes
      `, (err, result) => {
        if (err) reject(err);
        else resolve(result[0]);
      });
    });
  }

  async getNodeChanges(sinceMinutes = 60) {
    return new Promise((resolve, reject) => {
      this.db.all(`
        SELECT 
          nodeId,
          substr(nodeId, 1, 8) as short_id,
          name,
          owner,
          lastSeen,
          registeredAt,
          jobsCompleted,
          CASE 
            WHEN (unixepoch('now') - lastSeen) / 60 < 10 THEN 'just_active'
            WHEN (unixepoch('now') - lastSeen) / 60 BETWEEN 10 AND ? THEN 'recently_offline'
            WHEN (unixepoch('now') - lastSeen) / 60 > ? THEN 'was_offline'
            ELSE 'unknown'
          END as status_change,
          (unixepoch('now') - lastSeen) / 60.0 as minutes_offline,
          capabilities
        FROM nodes 
        WHERE (unixepoch('now') - lastSeen) / 60 BETWEEN 0 AND ?
        ORDER BY lastSeen DESC
      `, [sinceMinutes, sinceMinutes, sinceMinutes * 2], (err, nodes) => {
        if (err) reject(err);
        else resolve(nodes);
      });
    });
  }

  async detectRetentionAlerts() {
    const metrics = await this.getCurrentRetentionMetrics();
    const changes = await this.getNodeChanges(30); // Check last 30 minutes
    
    const alerts = [];
    
    // Calculate retention rate
    const retentionRate = metrics.total_nodes > 0 ? 
      ((metrics.active_nodes + metrics.recent_nodes) / metrics.total_nodes) * 100 : 0;
    
    // Low retention alert
    if (retentionRate < this.alertThreshold) {
      alerts.push({
        type: 'low_retention',
        severity: 'high',
        message: `Network retention dropped to ${retentionRate.toFixed(1)}% (below ${this.alertThreshold}%)`,
        metrics: {
          retention_rate: retentionRate,
          active_nodes: metrics.active_nodes,
          total_nodes: metrics.total_nodes
        }
      });
    }

    // High-value node offline
    const highValueOffline = changes.filter(n => 
      n.status_change === 'recently_offline' && 
      n.jobsCompleted > 50 && 
      n.minutes_offline > 15
    );

    highValueOffline.forEach(node => {
      alerts.push({
        type: 'high_value_offline',
        severity: 'medium',
        message: `High-value node ${node.short_id} went offline (${node.jobsCompleted} jobs completed)`,
        nodeId: node.nodeId,
        nodeData: node
      });
    });

    // Mass disconnection event
    const recentlyOffline = changes.filter(n => n.status_change === 'recently_offline');
    if (recentlyOffline.length >= 3) {
      alerts.push({
        type: 'mass_disconnection',
        severity: 'critical',
        message: `Mass disconnection event: ${recentlyOffline.length} nodes went offline in last 30 minutes`,
        affectedNodes: recentlyOffline.map(n => n.short_id)
      });
    }

    // Zero capacity alert
    if (metrics.active_nodes === 0 && metrics.total_nodes > 0) {
      alerts.push({
        type: 'zero_capacity',
        severity: 'critical', 
        message: 'CRITICAL: Zero active nodes - complete service outage',
        metrics
      });
    }

    return { alerts, metrics, changes };
  }

  async recordRetentionHistory(metrics) {
    const record = {
      timestamp: new Date().toISOString(),
      ...metrics,
      retention_rate: metrics.total_nodes > 0 ? 
        ((metrics.active_nodes + metrics.recent_nodes) / metrics.total_nodes) * 100 : 0
    };

    this.retentionHistory.push(record);

    // Keep only last 24 hours of history
    const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
    this.retentionHistory = this.retentionHistory.filter(r => 
      new Date(r.timestamp).getTime() > oneDayAgo
    );

    // Save to file
    const historyPath = path.join(__dirname, '..', 'data', 'retention-history.json');
    try {
      await fs.writeFile(historyPath, JSON.stringify(this.retentionHistory, null, 2));
    } catch (error) {
      console.error('Warning: Could not save retention history:', error.message);
    }

    return record;
  }

  async generateRetentionTrends() {
    if (this.retentionHistory.length < 2) return null;

    const recent = this.retentionHistory.slice(-12); // Last 12 data points
    const trends = {
      retention_rate: this.calculateTrend(recent.map(r => r.retention_rate)),
      active_nodes: this.calculateTrend(recent.map(r => r.active_nodes)),
      total_nodes: this.calculateTrend(recent.map(r => r.total_nodes))
    };

    return trends;
  }

  calculateTrend(values) {
    if (values.length < 2) return 'stable';
    
    const recent = values.slice(-5);
    const older = values.slice(-10, -5);
    
    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const olderAvg = older.length > 0 ? older.reduce((a, b) => a + b, 0) / older.length : recentAvg;
    
    const change = ((recentAvg - olderAvg) / olderAvg) * 100;
    
    if (Math.abs(change) < 5) return 'stable';
    return change > 0 ? 'improving' : 'declining';
  }

  async startMonitoring() {
    if (this.running) return;
    
    this.running = true;
    console.log(`🔄 Starting retention monitoring (${this.checkInterval / 1000}s intervals)`);
    
    while (this.running) {
      try {
        const { alerts, metrics } = await this.detectRetentionAlerts();
        await this.recordRetentionHistory(metrics);
        
        this.lastCheck = new Date();
        
        // Display alerts
        if (alerts.length > 0) {
          console.log(`\n⚠️  RETENTION ALERTS (${new Date().toLocaleTimeString()})`);
          alerts.forEach(alert => {
            const severity = alert.severity === 'critical' ? '🔴' : 
                           alert.severity === 'high' ? '🟠' : '🟡';
            console.log(`${severity} ${alert.type}: ${alert.message}`);
          });
        }

        // Show current status periodically
        if (Math.random() < 0.1) { // 10% chance to show status
          const rate = metrics.total_nodes > 0 ? 
            ((metrics.active_nodes + metrics.recent_nodes) / metrics.total_nodes * 100).toFixed(1) : 0;
          console.log(`📊 Retention: ${rate}% (${metrics.active_nodes}/${metrics.total_nodes} active)`);
        }

      } catch (error) {
        console.error('❌ Monitoring error:', error.message);
      }

      // Wait for next check
      await new Promise(resolve => setTimeout(resolve, this.checkInterval));
    }
  }

  stopMonitoring() {
    this.running = false;
    console.log('🛑 Retention monitoring stopped');
  }

  async generateStatusReport() {
    const { alerts, metrics, changes } = await this.detectRetentionAlerts();
    const trends = await this.generateRetentionTrends();
    
    const retentionRate = metrics.total_nodes > 0 ? 
      ((metrics.active_nodes + metrics.recent_nodes) / metrics.total_nodes) * 100 : 0;
    
    return {
      timestamp: new Date().toISOString(),
      retention_rate: retentionRate,
      status: retentionRate >= this.alertThreshold ? 'healthy' : 'concerning',
      metrics,
      alerts,
      recent_changes: changes,
      trends
    };
  }

  close() {
    this.stopMonitoring();
    this.db.close();
  }
}

// CLI Interface
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'report';
  
  const monitor = new NodeRetentionMonitor({
    alertThreshold: 50 // Alert if retention drops below 50%
  });

  try {
    switch (command) {
      case 'monitor':
        console.log('🔄 IC MESH RETENTION MONITOR');
        console.log('============================');
        console.log('Starting continuous monitoring...');
        console.log('Press Ctrl+C to stop\n');
        
        process.on('SIGINT', () => {
          monitor.close();
          process.exit(0);
        });
        
        await monitor.startMonitoring();
        break;

      case 'report':
        console.log('📊 IC MESH RETENTION STATUS REPORT');
        console.log('===================================\n');
        
        const report = await monitor.generateStatusReport();
        
        console.log(`Current Status: ${report.status.toUpperCase()}`);
        console.log(`Retention Rate: ${report.retention_rate.toFixed(1)}%`);
        console.log(`Active Nodes: ${report.metrics.active_nodes}/${report.metrics.total_nodes}`);
        console.log(`Recent Activity: ${report.metrics.recent_nodes} nodes in last 24h`);
        console.log(`Churned Nodes: ${report.metrics.churned_nodes} (inactive >7 days)`);
        
        if (report.alerts.length > 0) {
          console.log('\n⚠️  Active Alerts:');
          report.alerts.forEach(alert => {
            const emoji = alert.severity === 'critical' ? '🔴' : 
                         alert.severity === 'high' ? '🟠' : '🟡';
            console.log(`${emoji} ${alert.message}`);
          });
        } else {
          console.log('\n✅ No active retention alerts');
        }

        if (report.trends) {
          console.log('\n📈 Trends:');
          Object.entries(report.trends).forEach(([metric, trend]) => {
            const arrow = trend === 'improving' ? '↗️' : trend === 'declining' ? '↘️' : '➡️';
            console.log(`${metric}: ${arrow} ${trend}`);
          });
        }

        if (report.recent_changes.length > 0) {
          console.log('\n🔄 Recent Node Changes:');
          report.recent_changes.forEach(change => {
            const status = change.status_change === 'recently_offline' ? '📴' : '📶';
            console.log(`${status} ${change.short_id}: ${change.status_change} (${change.minutes_offline.toFixed(0)}min ago)`);
          });
        }
        break;

      case 'check':
        const quickCheck = await monitor.detectRetentionAlerts();
        if (quickCheck.alerts.length > 0) {
          console.log('⚠️  ALERTS DETECTED:');
          quickCheck.alerts.forEach(alert => console.log(`- ${alert.message}`));
          process.exit(1); // Exit code 1 for alerts
        } else {
          console.log('✅ No retention alerts');
          process.exit(0);
        }
        break;

      default:
        console.log('Usage: node-retention-monitor.js [command]');
        console.log('Commands:');
        console.log('  report  - Generate current retention status report (default)');
        console.log('  monitor - Start continuous monitoring');
        console.log('  check   - Quick alert check (exit code 0/1)');
        break;
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    if (command !== 'monitor') {
      monitor.close();
    }
  }
}

if (require.main === module) {
  main();
}

module.exports = { NodeRetentionMonitor };