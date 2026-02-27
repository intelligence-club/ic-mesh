#!/usr/bin/env node

/**
 * IC Mesh Node Recovery Assistant
 * Automated diagnostics and recovery guidance for disconnected nodes
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs').promises;
const { exec } = require('child_process');
const util = require('util');

const execAsync = util.promisify(exec);
const dbPath = path.join(__dirname, '..', 'data', 'mesh.db');

class NodeRecoveryAssistant {
  constructor() {
    this.db = new sqlite3.Database(dbPath);
    this.recoveryStrategies = new Map();
    this.initializeRecoveryStrategies();
  }

  initializeRecoveryStrategies() {
    // Common recovery strategies based on node patterns
    this.recoveryStrategies.set('immediate_reconnect', {
      name: 'Immediate Reconnection',
      description: 'Node just disconnected, likely temporary issue',
      steps: [
        'Check internet connection',
        'Restart node with: claw skill mesh-transcribe',
        'Verify port 8333 is accessible',
        'Check system resources (RAM, disk space)'
      ],
      automated_check: 'ping_server'
    });

    this.recoveryStrategies.set('capability_mismatch', {
      name: 'Capability Configuration Issue',  
      description: 'Node capabilities may not match job requirements',
      steps: [
        'Update node capabilities in mesh client',
        'Ensure all required dependencies are installed',
        'Verify handler scripts are executable',
        'Check capability aliases (transcription -> whisper)'
      ],
      automated_check: 'verify_capabilities'
    });

    this.recoveryStrategies.set('performance_degradation', {
      name: 'Performance Recovery',
      description: 'Node was quarantined or performing poorly',
      steps: [
        'Check system performance and resources',
        'Update node software to latest version', 
        'Clear any stuck processes or temp files',
        'Run diagnostic tests before reconnecting',
        'Monitor first few jobs closely'
      ],
      automated_check: 'performance_check'
    });

    this.recoveryStrategies.set('long_term_absence', {
      name: 'Long-term Re-onboarding',
      description: 'Node has been offline for extended period',
      steps: [
        'Review current mesh network requirements',
        'Update node client to latest version',
        'Verify network connectivity and firewall',
        'Check for any breaking changes or migrations',
        'Consider fresh client installation if needed'
      ],
      automated_check: 'compatibility_check'
    });
  }

  async getNodeHistory(nodeId) {
    return new Promise((resolve, reject) => {
      this.db.all(`
        SELECT 
          j.jobId,
          j.type as job_type,
          j.status,
          j.createdAt,
          j.completedAt,
          j.error,
          (j.completedAt - j.createdAt) as duration_seconds
        FROM jobs j 
        WHERE j.nodeId = ? 
        ORDER BY j.createdAt DESC 
        LIMIT 50
      `, [nodeId], (err, jobs) => {
        if (err) {
          // If jobs table doesn't exist or other error, return empty array
          resolve([]);
        } else {
          resolve(jobs);
        }
      });
    });
  }

  async analyzeNodeIssues(nodeId) {
    return new Promise((resolve, reject) => {
      this.db.get(`
        SELECT 
          nodeId,
          substr(nodeId, 1, 8) as short_id,
          name,
          owner,
          capabilities,
          lastSeen,
          registeredAt,
          jobsCompleted,
          computeMinutes,
          flags,
          (unixepoch('now') - lastSeen) / 3600.0 as hours_offline,
          (unixepoch('now') - registeredAt) / 86400.0 as days_registered
        FROM nodes 
        WHERE nodeId = ?
      `, [nodeId], async (err, node) => {
        if (err) {
          reject(err);
          return;
        }

        if (!node) {
          resolve({ error: 'Node not found' });
          return;
        }

        // Get job history for pattern analysis
        const jobHistory = await this.getNodeHistory(nodeId);
        
        // Parse flags for quarantine status
        let flags = {};
        try {
          flags = node.flags ? JSON.parse(node.flags) : {};
        } catch (e) {
          flags = {};
        }

        // Analyze issues based on node data
        const issues = this.identifyIssues(node, jobHistory, flags);
        const recommendedStrategy = this.selectRecoveryStrategy(node, issues);
        const diagnostics = await this.runAutomatedDiagnostics(recommendedStrategy);

        resolve({
          node,
          issues,
          jobHistory: jobHistory.slice(0, 10), // Recent 10 jobs
          flags,
          recommendedStrategy,
          diagnostics,
          recoveryPlan: this.generateRecoveryPlan(node, issues, recommendedStrategy)
        });
      });
    });
  }

  identifyIssues(node, jobHistory, flags) {
    const issues = [];

    // Offline duration
    if (node.hours_offline > 168) {
      issues.push({
        type: 'long_term_offline',
        severity: 'high',
        description: `Node offline for ${(node.hours_offline / 24).toFixed(1)} days`
      });
    } else if (node.hours_offline > 24) {
      issues.push({
        type: 'daily_churn',
        severity: 'medium',
        description: `Node offline for ${node.hours_offline.toFixed(1)} hours`
      });
    }

    // Quarantine status
    if (flags.quarantined) {
      issues.push({
        type: 'quarantined',
        severity: 'high',
        description: `Node quarantined: ${flags.quarantine_reason || 'Performance issues'}`
      });
    }

    // Job failure patterns
    if (jobHistory.length > 0) {
      const recentJobs = jobHistory.slice(0, 10);
      const failedJobs = recentJobs.filter(j => j.status === 'failed').length;
      const failureRate = (failedJobs / recentJobs.length) * 100;

      if (failureRate > 50) {
        issues.push({
          type: 'high_failure_rate',
          severity: 'high',
          description: `${failureRate.toFixed(1)}% failure rate in recent jobs`
        });
      }

      // Common error patterns
      const errors = recentJobs
        .filter(j => j.error)
        .map(j => j.error)
        .reduce((acc, error) => {
          acc[error] = (acc[error] || 0) + 1;
          return acc;
        }, {});

      Object.entries(errors).forEach(([error, count]) => {
        if (count >= 2) {
          issues.push({
            type: 'recurring_error',
            severity: 'medium',
            description: `Recurring error: ${error} (${count} times)`
          });
        }
      });
    }

    // Capability issues
    if (!node.capabilities || node.capabilities === '[]') {
      issues.push({
        type: 'no_capabilities',
        severity: 'medium',
        description: 'No capabilities registered'
      });
    }

    // Low productivity
    const jobsPerDay = node.days_registered > 0 ? node.jobsCompleted / node.days_registered : 0;
    if (jobsPerDay < 0.1 && node.days_registered > 1) {
      issues.push({
        type: 'low_productivity',
        severity: 'low',
        description: `Only ${jobsPerDay.toFixed(2)} jobs per day average`
      });
    }

    return issues;
  }

  selectRecoveryStrategy(node, issues) {
    // Select strategy based on primary issues
    const severityScore = issues.reduce((score, issue) => {
      return score + (issue.severity === 'high' ? 3 : issue.severity === 'medium' ? 2 : 1);
    }, 0);

    const hasQuarantineIssue = issues.some(i => i.type === 'quarantined');
    const hasLongTermIssue = issues.some(i => i.type === 'long_term_offline');
    const hasPerformanceIssue = issues.some(i => ['high_failure_rate', 'recurring_error'].includes(i.type));
    const isRecentOffline = node.hours_offline < 2;

    if (hasQuarantineIssue || hasPerformanceIssue) {
      return this.recoveryStrategies.get('performance_degradation');
    }
    
    if (hasLongTermIssue) {
      return this.recoveryStrategies.get('long_term_absence');
    }
    
    if (issues.some(i => i.type === 'no_capabilities')) {
      return this.recoveryStrategies.get('capability_mismatch');
    }
    
    return this.recoveryStrategies.get('immediate_reconnect');
  }

  async runAutomatedDiagnostics(strategy) {
    const diagnostics = {
      server_connectivity: 'unknown',
      client_version: 'unknown',
      system_health: 'unknown'
    };

    try {
      // Test server connectivity
      const serverHost = process.env.IC_MESH_HOST || 'localhost';
      const serverPort = process.env.IC_MESH_PORT || '8333';
      
      try {
        const pingResult = await execAsync(`curl -s --connect-timeout 5 http://${serverHost}:${serverPort}/health`);
        diagnostics.server_connectivity = 'ok';
      } catch (e) {
        diagnostics.server_connectivity = 'failed';
      }

      // Check if client is available
      try {
        const clientCheck = await execAsync('which claw');
        diagnostics.client_version = 'available';
      } catch (e) {
        diagnostics.client_version = 'not_found';
      }

      // Basic system health
      try {
        const diskSpace = await execAsync("df -h . | awk 'NR==2{print $4}'");
        const memInfo = await execAsync("free -m | awk 'NR==2{printf \"%.1fGB\", $7/1024}'");
        diagnostics.system_health = `Disk: ${diskSpace.stdout.trim()}, Available RAM: ${memInfo.stdout.trim()}`;
      } catch (e) {
        diagnostics.system_health = 'check_failed';
      }

    } catch (error) {
      console.warn('Some diagnostic checks failed:', error.message);
    }

    return diagnostics;
  }

  generateRecoveryPlan(node, issues, strategy) {
    const plan = {
      strategy: strategy.name,
      priority: this.calculateRecoveryPriority(node, issues),
      steps: [...strategy.steps],
      customized_guidance: [],
      estimated_time: '15-30 minutes'
    };

    // Add issue-specific guidance
    issues.forEach(issue => {
      switch (issue.type) {
        case 'quarantined':
          plan.customized_guidance.push(
            `🔓 Your node was quarantined due to: ${issue.description}. ` +
            'Run diagnostics and fix underlying issues before reconnecting.'
          );
          plan.estimated_time = '30-60 minutes';
          break;
        
        case 'high_failure_rate':
          plan.customized_guidance.push(
            `⚠️  High job failure rate detected. Check system resources and handler dependencies.`
          );
          break;

        case 'long_term_offline':
          plan.customized_guidance.push(
            `📅 Node offline for extended period. Review mesh network updates and requirements.`
          );
          plan.estimated_time = '45-90 minutes';
          break;

        case 'no_capabilities':
          plan.customized_guidance.push(
            `🔧 No capabilities registered. Ensure client is properly configured with handlers.`
          );
          break;
      }
    });

    // Add node-specific commands
    plan.commands = [
      `# Quick reconnection attempt:`,
      `claw skill mesh-transcribe`,
      ``,
      `# If issues persist, check status:`,
      `curl http://localhost:8333/health`,
      ``,
      `# View mesh network status:`,
      `curl http://localhost:8333/nodes`
    ];

    return plan;
  }

  calculateRecoveryPriority(node, issues) {
    let priority = 'low';

    // High-value node gets higher priority
    if (node.jobsCompleted > 50) priority = 'medium';
    if (node.jobsCompleted > 100) priority = 'high';

    // Critical issues increase priority  
    const criticalIssues = issues.filter(i => i.severity === 'high');
    if (criticalIssues.length > 0) {
      priority = priority === 'low' ? 'medium' : 'high';
    }

    // Recent activity increases priority
    if (node.hours_offline < 24 && node.jobsCompleted > 10) {
      priority = 'high';
    }

    return priority;
  }

  async generateRecoveryReport(nodeId) {
    const analysis = await this.analyzeNodeIssues(nodeId);
    
    if (analysis.error) {
      return { error: analysis.error };
    }

    const timestamp = new Date().toISOString().split('T')[0];
    const reportPath = path.join(__dirname, '..', 'data', `recovery-${analysis.node.short_id}-${timestamp}.json`);
    
    const report = {
      generated: new Date().toISOString(),
      node: analysis.node,
      analysis: {
        issues: analysis.issues,
        recovery_strategy: analysis.recommendedStrategy.name,
        priority: analysis.recoveryPlan.priority
      },
      diagnostics: analysis.diagnostics,
      recovery_plan: analysis.recoveryPlan,
      job_history: analysis.jobHistory
    };

    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));

    return { report, reportPath, analysis };
  }

  close() {
    this.db.close();
  }
}

// CLI Interface
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const nodeIdArg = args[1];

  if (!command) {
    console.log('Usage: node-recovery-assistant.js <command> [nodeId]');
    console.log('Commands:');
    console.log('  analyze <nodeId>  - Analyze specific node issues and generate recovery plan');
    console.log('  scan             - Scan all offline nodes and prioritize recovery efforts');
    console.log('  guide <nodeId>   - Interactive recovery guidance');
    return;
  }

  const assistant = new NodeRecoveryAssistant();

  try {
    switch (command) {
      case 'analyze':
        if (!nodeIdArg) {
          console.error('❌ Node ID required for analyze command');
          process.exit(1);
        }

        console.log(`🔍 ANALYZING NODE: ${nodeIdArg.substring(0, 8)}`);
        console.log('=====================================\n');

        const { report, reportPath, analysis } = await assistant.generateRecoveryReport(nodeIdArg);
        
        if (report.error) {
          console.error(`❌ ${report.error}`);
          process.exit(1);
        }

        const node = analysis.node;
        console.log(`📊 NODE STATUS:`);
        console.log(`   ID: ${node.short_id} (${node.name || 'unnamed'})`);
        console.log(`   Owner: ${node.owner}`);
        console.log(`   Offline: ${node.hours_offline.toFixed(1)} hours`);
        console.log(`   Jobs completed: ${node.jobsCompleted}`);
        console.log(`   Registered: ${node.days_registered.toFixed(0)} days ago`);

        if (analysis.issues.length > 0) {
          console.log(`\n❗ IDENTIFIED ISSUES:`);
          analysis.issues.forEach(issue => {
            const emoji = issue.severity === 'high' ? '🔴' : issue.severity === 'medium' ? '🟡' : '🟢';
            console.log(`   ${emoji} ${issue.description}`);
          });
        }

        console.log(`\n🛠️  RECOMMENDED STRATEGY: ${analysis.recommendedStrategy.name}`);
        console.log(`   Priority: ${analysis.recoveryPlan.priority.toUpperCase()}`);
        console.log(`   Estimated time: ${analysis.recoveryPlan.estimated_time}`);

        console.log(`\n📋 RECOVERY STEPS:`);
        analysis.recoveryPlan.steps.forEach((step, i) => {
          console.log(`   ${i + 1}. ${step}`);
        });

        if (analysis.recoveryPlan.customized_guidance.length > 0) {
          console.log(`\n💡 SPECIFIC GUIDANCE:`);
          analysis.recoveryPlan.customized_guidance.forEach(guidance => {
            console.log(`   ${guidance}`);
          });
        }

        console.log(`\n🔧 QUICK COMMANDS:`);
        analysis.recoveryPlan.commands.forEach(cmd => {
          console.log(`   ${cmd}`);
        });

        console.log(`\n💾 Full report saved: ${reportPath}`);
        break;

      case 'scan':
        console.log('🔍 SCANNING OFFLINE NODES FOR RECOVERY');
        console.log('====================================\n');
        
        // Get all offline nodes and prioritize
        // Implementation would scan all nodes and create priority recovery queue
        console.log('📊 Offline node recovery scan (implementation placeholder)');
        console.log('This would scan all nodes and create a prioritized recovery queue');
        break;

      case 'guide':
        console.log('🎯 INTERACTIVE RECOVERY GUIDE (Coming soon)');
        console.log('This would provide step-by-step interactive recovery assistance');
        break;

      default:
        console.log(`❌ Unknown command: ${command}`);
        process.exit(1);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    assistant.close();
  }
}

if (require.main === module) {
  main();
}

module.exports = { NodeRecoveryAssistant };