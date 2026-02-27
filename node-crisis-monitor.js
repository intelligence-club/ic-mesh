#!/usr/bin/env node

/**
 * Node Crisis Monitor - Real-time capacity monitoring for IC Mesh
 * Detects critical capacity gaps and alerts for immediate action
 * 
 * Usage: node node-crisis-monitor.js [--continuous] [--alert-threshold=5]
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

class NodeCrisisMonitor {
  constructor() {
    this.db = new Database('data/mesh.db', { readonly: true });
    this.alertThreshold = 5; // minutes before considering node offline
    this.criticalCapabilities = ['transcription', 'whisper', 'tesseract'];
  }

  getCurrentStatus() {
    const now = Date.now();
    
    // Get all nodes
    const nodes = this.db.prepare(`
      SELECT nodeId, name, capabilities, jobsCompleted, lastSeen, owner, flags
      FROM nodes 
      ORDER BY lastSeen DESC
    `).all();

    // Get pending jobs by type
    const pendingJobs = this.db.prepare(`
      SELECT type, COUNT(*) as count 
      FROM jobs 
      WHERE status = 'pending' 
      GROUP BY type
    `).all();

    const totalPending = this.db.prepare('SELECT COUNT(*) as count FROM jobs WHERE status = ?').get('pending');

    return {
      timestamp: now,
      nodes,
      pendingJobs,
      totalPending: totalPending.count
    };
  }

  analyzeCapacityGaps(status) {
    const now = status.timestamp;
    const activeNodes = status.nodes.filter(n => now - n.lastSeen < this.alertThreshold * 60 * 1000);
    const offlineNodes = status.nodes.filter(n => now - n.lastSeen >= this.alertThreshold * 60 * 1000);

    // Map job types to required capabilities
    const jobCapabilityMap = {
      'transcribe': ['transcription', 'whisper'],
      'ocr': ['tesseract'],
      'pdf-extract': ['tesseract'],
      'stable-diffusion': ['stable-diffusion'],
      'ollama': ['ollama']
    };

    // Get all active capabilities
    const activeCapabilities = new Set();
    activeNodes.forEach(node => {
      const capabilities = JSON.parse(node.capabilities || '[]');
      capabilities.forEach(cap => activeCapabilities.add(cap));
    });

    // Find gaps
    const gaps = [];
    status.pendingJobs.forEach(job => {
      const requiredCaps = jobCapabilityMap[job.type] || [job.type];
      const hasCapability = requiredCaps.some(cap => activeCapabilities.has(cap));
      
      if (!hasCapability) {
        gaps.push({
          jobType: job.type,
          jobCount: job.count,
          requiredCapabilities: requiredCaps,
          severity: this.calculateSeverity(job.count, requiredCaps)
        });
      }
    });

    return {
      activeNodes,
      offlineNodes,
      activeCapabilities: Array.from(activeCapabilities),
      gaps,
      totalActiveNodes: activeNodes.length,
      totalOfflineNodes: offlineNodes.length,
      networkHealth: activeNodes.length / status.nodes.length
    };
  }

  calculateSeverity(jobCount, capabilities) {
    const criticalCaps = capabilities.filter(cap => this.criticalCapabilities.includes(cap));
    const criticalScore = criticalCaps.length * 2;
    const volumeScore = Math.min(jobCount / 10, 3); // Max 3 points for volume
    return criticalScore + volumeScore;
  }

  generateAlert(analysis, status) {
    const now = new Date(status.timestamp);
    const alerts = [];

    // Critical capacity gaps
    if (analysis.gaps.length > 0) {
      analysis.gaps.forEach(gap => {
        if (gap.severity >= 4) {
          alerts.push({
            level: 'CRITICAL',
            type: 'CAPACITY_GAP',
            message: `${gap.jobCount} ${gap.jobType} jobs blocked - NO active nodes with ${gap.requiredCapabilities.join(' or ')} capability`,
            severity: gap.severity,
            actionRequired: this.getActionRequired(gap.requiredCapabilities)
          });
        }
      });
    }

    // Network health alerts
    if (analysis.networkHealth < 0.3) {
      alerts.push({
        level: 'CRITICAL',
        type: 'NETWORK_HEALTH',
        message: `Network capacity at ${(analysis.networkHealth * 100).toFixed(1)}% (${analysis.totalActiveNodes}/${analysis.totalActiveNodes + analysis.totalOfflineNodes} nodes active)`,
        severity: 5,
        actionRequired: 'Contact node operators immediately'
      });
    }

    // High-value node offline alerts
    analysis.offlineNodes.forEach(node => {
      const minutesOffline = Math.floor((status.timestamp - node.lastSeen) / 60000);
      if (node.jobsCompleted > 10 && minutesOffline < 60) { // High-value nodes offline less than 1 hour
        alerts.push({
          level: 'URGENT',
          type: 'HIGH_VALUE_NODE_OFFLINE',
          message: `High-performing node "${node.name || node.nodeId.substring(0,8)}" offline ${minutesOffline} minutes (${node.jobsCompleted} jobs completed)`,
          severity: 4,
          actionRequired: `Contact ${node.owner} to restore node`
        });
      }
    });

    return alerts.sort((a, b) => b.severity - a.severity);
  }

  getActionRequired(capabilities) {
    const actions = [];
    
    if (capabilities.includes('transcription') || capabilities.includes('whisper')) {
      actions.push('Contact Drake: `claw skill mesh-transcribe` (miniclaw)');
    }
    
    if (capabilities.includes('tesseract')) {
      actions.push('Contact Drake: Restore frigg node with tesseract capability');
    }
    
    if (capabilities.includes('stable-diffusion')) {
      actions.push('Contact Drake: Restore frigg node with GPU capabilities');
    }

    return actions.length > 0 ? actions.join('; ') : 'Recruit nodes with required capabilities';
  }

  formatReport(status, analysis, alerts) {
    const report = [];
    const timestamp = new Date(status.timestamp).toISOString();
    
    report.push('='.repeat(60));
    report.push(`IC MESH CRISIS MONITOR REPORT - ${timestamp}`);
    report.push('='.repeat(60));
    report.push('');

    // Network health overview
    report.push('📊 NETWORK HEALTH OVERVIEW');
    report.push(`Active Nodes: ${analysis.totalActiveNodes}/${analysis.totalActiveNodes + analysis.totalOfflineNodes} (${(analysis.networkHealth * 100).toFixed(1)}% capacity)`);
    report.push(`Pending Jobs: ${status.totalPending}`);
    report.push(`Active Capabilities: [${analysis.activeCapabilities.join(', ')}]`);
    report.push('');

    // Alerts section
    if (alerts.length > 0) {
      report.push('🚨 ACTIVE ALERTS');
      alerts.forEach(alert => {
        const emoji = alert.level === 'CRITICAL' ? '🔴' : alert.level === 'URGENT' ? '🟠' : '🟡';
        report.push(`${emoji} ${alert.level}: ${alert.message}`);
        if (alert.actionRequired) {
          report.push(`   → Action: ${alert.actionRequired}`);
        }
        report.push('');
      });
    } else {
      report.push('✅ NO ACTIVE ALERTS - System healthy');
      report.push('');
    }

    // Capacity gaps
    if (analysis.gaps.length > 0) {
      report.push('⚠️  CAPACITY GAPS');
      analysis.gaps.forEach(gap => {
        report.push(`❌ ${gap.jobCount} ${gap.jobType} jobs blocked (need: ${gap.requiredCapabilities.join(' or ')})`);
      });
      report.push('');
    }

    // Node details
    report.push('🖥️  NODE STATUS');
    const allNodes = [...analysis.activeNodes, ...analysis.offlineNodes];
    allNodes.forEach(node => {
      const minutesAgo = Math.floor((status.timestamp - node.lastSeen) / 60000);
      const status_icon = minutesAgo < this.alertThreshold ? '🟢' : '⚫';
      const timeDesc = minutesAgo < 60 ? `${minutesAgo}m ago` : 
                     minutesAgo < 1440 ? `${Math.floor(minutesAgo/60)}h ago` : 
                     `${Math.floor(minutesAgo/1440)}d ago`;
      
      report.push(`${status_icon} ${node.name || 'unnamed'} (${node.owner}) - ${timeDesc}`);
      report.push(`   Jobs: ${node.jobsCompleted} | Capabilities: ${node.capabilities}`);
    });

    return report.join('\n');
  }

  saveReport(report, alerts) {
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `CRISIS-MONITOR-${timestamp}.md`;
    
    let content = '# IC Mesh Crisis Monitor Report\n\n';
    content += '```\n' + report + '\n```\n\n';
    
    if (alerts.length > 0) {
      content += '## Required Actions\n\n';
      alerts.forEach((alert, i) => {
        content += `${i + 1}. **${alert.level}**: ${alert.message}\n`;
        if (alert.actionRequired) {
          content += `   - Action: ${alert.actionRequired}\n`;
        }
        content += '\n';
      });
    }

    fs.writeFileSync(filename, content);
    console.log(`Report saved to: ${filename}`);
  }

  async monitor(continuous = false) {
    do {
      try {
        const status = this.getCurrentStatus();
        const analysis = this.analyzeCapacityGaps(status);
        const alerts = this.generateAlert(analysis, status);
        const report = this.formatReport(status, analysis, alerts);

        console.log(report);

        // Save report if there are alerts
        if (alerts.length > 0) {
          this.saveReport(report, alerts);
        }

        if (continuous) {
          await new Promise(resolve => setTimeout(resolve, 30000)); // 30 second intervals
        }
      } catch (error) {
        console.error('Monitor error:', error);
      }
    } while (continuous);
  }

  close() {
    this.db.close();
  }
}

// CLI usage
if (require.main === module) {
  const args = process.argv.slice(2);
  const continuous = args.includes('--continuous');
  const thresholdArg = args.find(arg => arg.startsWith('--alert-threshold='));
  
  const monitor = new NodeCrisisMonitor();
  
  if (thresholdArg) {
    monitor.alertThreshold = parseInt(thresholdArg.split('=')[1]) || 5;
  }

  monitor.monitor(continuous)
    .then(() => monitor.close())
    .catch(error => {
      console.error('Fatal error:', error);
      monitor.close();
      process.exit(1);
    });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down monitor...');
    monitor.close();
    process.exit(0);
  });
}

module.exports = NodeCrisisMonitor;