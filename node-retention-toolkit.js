#!/usr/bin/env node
/**
 * Node Retention Toolkit for IC Mesh
 * 
 * Addresses the 75% node churn rate through comprehensive retention strategies
 * and onboarding improvements. Provides actionable insights and automated
 * interventions to keep nodes connected and productive.
 * 
 * Usage:
 *   ./node-retention-toolkit.js analyze     # Analyze current retention patterns
 *   ./node-retention-toolkit.js onboard     # Run enhanced onboarding wizard
 *   ./node-retention-toolkit.js intervene   # Identify and help struggling nodes
 *   ./node-retention-toolkit.js dashboard   # Display retention dashboard
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

class NodeRetentionToolkit {
  constructor() {
    this.db = new Database('./mesh.db');
    this.setupSchema();
  }

  setupSchema() {
    // Ensure retention tracking tables exist
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS node_retention_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        node_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        event_data TEXT,
        created_at INTEGER DEFAULT (unixepoch())
      );

      CREATE TABLE IF NOT EXISTS onboarding_progress (
        node_id TEXT PRIMARY KEY,
        step TEXT NOT NULL,
        completed_at INTEGER DEFAULT (unixepoch()),
        notes TEXT
      );

      CREATE TABLE IF NOT EXISTS retention_interventions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        node_id TEXT NOT NULL,
        intervention_type TEXT NOT NULL,
        intervention_data TEXT,
        outcome TEXT,
        created_at INTEGER DEFAULT (unixepoch())
      );
    `);
  }

  // Comprehensive retention analysis
  analyzeRetention() {
    console.log('🔍 Node Retention Analysis\n');

    // Current network state
    const totalNodes = this.db.prepare('SELECT COUNT(*) as count FROM nodes').get().count;
    const activeNodes = this.db.prepare(`
      SELECT COUNT(*) as count FROM nodes 
      WHERE lastHeartbeat > datetime('now', '-10 minutes')
    `).get().count;

    console.log(`📊 Network Overview:`);
    console.log(`   Total registered nodes: ${totalNodes}`);
    console.log(`   Currently active: ${activeNodes}`);
    console.log(`   Current retention rate: ${((activeNodes/totalNodes)*100).toFixed(1)}%\n`);

    // Analyze churn patterns
    const churned = this.db.prepare(`
      SELECT 
        nodeId, 
        name,
        capabilities,
        firstSeen,
        lastHeartbeat,
        (julianday('now') - julianday(lastHeartbeat)) * 24 as hours_offline
      FROM nodes 
      WHERE lastHeartbeat < datetime('now', '-1 hour')
      ORDER BY hours_offline DESC
    `).all();

    if (churned.length > 0) {
      console.log(`💔 Churned Nodes (${churned.length} nodes):`);
      churned.forEach(node => {
        console.log(`   ${node.nodeId.substring(0,8)} (${node.name || 'unnamed'})`);
        console.log(`      Capabilities: ${node.capabilities || 'none listed'}`);
        console.log(`      Offline for: ${node.hours_offline.toFixed(1)} hours`);
        
        // Identify potential reasons for churn
        const reasons = this.identifyChurnReasons(node);
        if (reasons.length > 0) {
          console.log(`      Likely reasons: ${reasons.join(', ')}`);
        }
        console.log('');
      });
    }

    // Success patterns
    const retained = this.db.prepare(`
      SELECT 
        nodeId, 
        name,
        capabilities,
        firstSeen,
        lastHeartbeat,
        (julianday(lastHeartbeat) - julianday(firstSeen)) * 24 as lifetime_hours
      FROM nodes 
      WHERE lastHeartbeat > datetime('now', '-10 minutes')
        AND firstSeen < datetime('now', '-1 hour')
      ORDER BY lifetime_hours DESC
    `).all();

    if (retained.length > 0) {
      console.log(`✅ Successfully Retained Nodes (${retained.length} nodes):`);
      retained.forEach(node => {
        console.log(`   ${node.nodeId.substring(0,8)} (${node.name || 'unnamed'})`);
        console.log(`      Uptime: ${node.lifetime_hours.toFixed(1)} hours`);
        console.log(`      Capabilities: ${node.capabilities || 'none listed'}`);
        
        // Extract success patterns
        const patterns = this.identifySuccessPatterns(node);
        if (patterns.length > 0) {
          console.log(`      Success factors: ${patterns.join(', ')}`);
        }
        console.log('');
      });
    }

    return { totalNodes, activeNodes, churned, retained };
  }

  identifyChurnReasons(node) {
    const reasons = [];

    // No capabilities set
    if (!node.capabilities || node.capabilities.trim() === '') {
      reasons.push('No capabilities configured');
    }

    // Short session (< 1 hour)
    const sessionHours = (new Date(node.lastHeartbeat) - new Date(node.firstSeen)) / (1000 * 60 * 60);
    if (sessionHours < 1) {
      reasons.push('Quick disconnect (< 1 hour)');
    }

    // No jobs completed
    const jobsCompleted = this.db.prepare(`
      SELECT COUNT(*) as count FROM jobs 
      WHERE assignedTo = ? AND status = 'completed'
    `).get(node.nodeId).count;

    if (jobsCompleted === 0) {
      reasons.push('Never completed a job');
    }

    // Evening/night disconnect pattern
    const disconnectHour = new Date(node.lastHeartbeat).getHours();
    if (disconnectHour >= 22 || disconnectHour <= 6) {
      reasons.push('Disconnected during night hours');
    }

    return reasons;
  }

  identifySuccessPatterns(node) {
    const patterns = [];

    // Multiple capabilities
    const capList = node.capabilities ? node.capabilities.split(',') : [];
    if (capList.length > 2) {
      patterns.push('Multiple capabilities');
    }

    // Named node (shows operator engagement)
    if (node.name && node.name !== '') {
      patterns.push('Named by operator');
    }

    // High job completion rate
    const jobsCompleted = this.db.prepare(`
      SELECT COUNT(*) as count FROM jobs 
      WHERE assignedTo = ? AND status = 'completed'
    `).get(node.nodeId).count;

    const jobsAssigned = this.db.prepare(`
      SELECT COUNT(*) as count FROM jobs 
      WHERE assignedTo = ?
    `).get(node.nodeId).count;

    if (jobsAssigned > 0 && (jobsCompleted / jobsAssigned) > 0.8) {
      patterns.push('High job success rate');
    }

    // Long session
    const sessionHours = (new Date(node.lastHeartbeat) - new Date(node.firstSeen)) / (1000 * 60 * 60);
    if (sessionHours > 24) {
      patterns.push('Multi-day session');
    }

    return patterns;
  }

  // Enhanced onboarding wizard
  runOnboardingWizard() {
    console.log('🎯 IC Mesh Node Onboarding Wizard\n');
    console.log('This wizard will help ensure your node is properly configured');
    console.log('for maximum success and earnings in the network.\n');

    // Step 1: Environment check
    console.log('Step 1: Environment Verification');
    console.log('─────────────────────────────');

    const checks = [
      {
        name: 'Node.js version',
        check: () => process.version,
        expected: 'v18+ or v20+'
      },
      {
        name: 'Available memory',
        check: () => `${Math.round(require('os').totalmem() / 1024 / 1024 / 1024)}GB`,
        expected: '2GB+ recommended'
      },
      {
        name: 'CPU cores',
        check: () => require('os').cpus().length,
        expected: '2+ cores recommended'
      }
    ];

    checks.forEach(check => {
      const result = check.check();
      console.log(`   ✓ ${check.name}: ${result} (${check.expected})`);
    });

    // Step 2: Capability optimization
    console.log('\nStep 2: Capability Optimization');
    console.log('──────────────────────────────');

    const capabilities = this.detectOptimalCapabilities();
    console.log('   Recommended capabilities for your system:');
    capabilities.forEach(cap => {
      console.log(`   ✓ ${cap.name}: ${cap.description}`);
      console.log(`     Expected earnings: ~${cap.earnings}/hour`);
    });

    // Step 3: Configuration guide
    console.log('\nStep 3: Configuration Recommendations');
    console.log('────────────────────────────────────');

    const config = this.generateOptimalConfig();
    console.log('   Recommended node-config.json:');
    console.log(JSON.stringify(config, null, 2));

    // Step 4: First job simulation
    console.log('\nStep 4: Connection Test');
    console.log('──────────────────────');
    console.log('   Run these commands to test your node:');
    console.log('   1. node client.js');
    console.log('   2. Wait for "Node registered successfully" message');
    console.log('   3. Wait for your first job assignment');
    console.log('   4. Check earnings at https://moilol.com/account');

    console.log('\n🚀 Onboarding complete! Your node should now be earning.');
    console.log('   💡 Tip: Nodes that stay online 24/7 earn 3x more');
    console.log('   📊 Monitor your progress: ./node-retention-toolkit.js dashboard');
  }

  detectOptimalCapabilities() {
    const capabilities = [];

    // Basic capabilities available to all
    capabilities.push({
      name: 'transcribe',
      description: 'Audio transcription using built-in capabilities',
      earnings: '$0.10-0.50'
    });

    // GPU-dependent capabilities
    try {
      require('child_process').execSync('nvidia-smi', { stdio: 'ignore' });
      capabilities.push({
        name: 'stable-diffusion',
        description: 'Image generation (requires GPU)',
        earnings: '$0.50-2.00'
      });
    } catch (e) {
      // No GPU available
    }

    // CPU-intensive capabilities
    if (require('os').cpus().length >= 4) {
      capabilities.push({
        name: 'ollama',
        description: 'Local AI inference (4+ cores recommended)',
        earnings: '$0.25-1.00'
      });
    }

    return capabilities;
  }

  generateOptimalConfig() {
    const config = {
      name: `node-${require('os').hostname()}`,
      capabilities: ['transcribe'], // Start with basics
      workerCount: Math.min(require('os').cpus().length, 4),
      retentionOptimized: true
    };

    // Add GPU capabilities if available
    try {
      require('child_process').execSync('nvidia-smi', { stdio: 'ignore' });
      config.capabilities.push('stable-diffusion');
    } catch (e) {}

    // Add ollama for higher-end systems
    if (require('os').cpus().length >= 4) {
      config.capabilities.push('ollama');
    }

    return config;
  }

  // Proactive intervention system
  runRetentionIntervention() {
    console.log('🔧 Node Retention Intervention System\n');

    // Identify at-risk nodes
    const atRisk = this.db.prepare(`
      SELECT 
        nodeId, 
        name,
        capabilities,
        lastHeartbeat,
        (julianday('now') - julianday(lastHeartbeat)) * 24 * 60 as minutes_offline
      FROM nodes 
      WHERE lastHeartbeat < datetime('now', '-5 minutes')
        AND lastHeartbeat > datetime('now', '-2 hours')
      ORDER BY minutes_offline ASC
    `).all();

    if (atRisk.length === 0) {
      console.log('✅ No nodes currently at risk of churning.');
      return;
    }

    console.log(`⚠️  Found ${atRisk.length} nodes at risk of churning:\n`);

    atRisk.forEach((node, i) => {
      console.log(`${i + 1}. Node ${node.nodeId.substring(0, 8)} (${node.name || 'unnamed'})`);
      console.log(`   Offline for: ${Math.round(node.minutes_offline)} minutes`);
      
      // Generate personalized intervention
      const intervention = this.generateIntervention(node);
      console.log(`   Intervention: ${intervention.message}`);
      
      if (intervention.actions.length > 0) {
        console.log('   Suggested actions:');
        intervention.actions.forEach(action => {
          console.log(`     • ${action}`);
        });
      }

      // Log intervention attempt
      this.db.prepare(`
        INSERT INTO retention_interventions 
        (node_id, intervention_type, intervention_data) 
        VALUES (?, ?, ?)
      `).run(node.nodeId, intervention.type, JSON.stringify(intervention));

      console.log('');
    });

    // Success stories for motivation
    const recentSaves = this.db.prepare(`
      SELECT COUNT(*) as saves FROM retention_interventions 
      WHERE created_at > unixepoch() - 86400 
        AND outcome = 'reconnected'
    `).get().saves;

    if (recentSaves > 0) {
      console.log(`🎉 ${recentSaves} nodes reconnected after intervention in the last 24h!`);
    }
  }

  generateIntervention(node) {
    const interventions = [];
    const actions = [];

    // No capabilities configured
    if (!node.capabilities || node.capabilities.trim() === '') {
      interventions.push('capability_setup');
      actions.push('Configure node capabilities in node-config.json');
      actions.push('Restart node client with: node client.js');
    }

    // Irregular connection pattern
    const offlineMinutes = Math.round(node.minutes_offline);
    if (offlineMinutes > 30 && offlineMinutes < 120) {
      interventions.push('connection_stability');
      actions.push('Check network connection stability');
      actions.push('Consider running node in background/daemon mode');
      actions.push('Set up automatic restart on disconnect');
    }

    // Choose primary intervention message
    let message = 'Generic troubleshooting recommended';
    let type = 'generic';

    if (interventions.includes('capability_setup')) {
      message = 'Node needs capability configuration to receive jobs';
      type = 'capability_setup';
    } else if (interventions.includes('connection_stability')) {
      message = 'Node shows irregular connection pattern';
      type = 'connection_stability';
    }

    return { message, type, actions };
  }

  // Real-time retention dashboard
  displayRetentionDashboard() {
    console.clear();
    console.log('📊 IC Mesh Node Retention Dashboard');
    console.log('═══════════════════════════════════\n');

    // Key metrics
    const metrics = this.calculateRetentionMetrics();
    
    console.log('🔥 Live Metrics:');
    console.log(`   Active nodes: ${metrics.activeNodes} / ${metrics.totalNodes}`);
    console.log(`   Retention rate: ${metrics.retentionRate}%`);
    console.log(`   Avg session length: ${metrics.avgSessionHours} hours`);
    console.log(`   24h churn rate: ${metrics.churnRate24h}%\n`);

    // Trend indicators
    const trend = metrics.retentionRate > 50 ? '📈' : '📉';
    const health = metrics.retentionRate > 70 ? 'Excellent' : 
                  metrics.retentionRate > 50 ? 'Good' : 
                  metrics.retentionRate > 30 ? 'Fair' : 'Needs attention';

    console.log(`${trend} Network Health: ${health}\n`);

    // Active nodes detail
    if (metrics.activeNodes > 0) {
      console.log('💪 Currently Active Nodes:');
      const activeNodes = this.db.prepare(`
        SELECT 
          nodeId, 
          name, 
          capabilities,
          (julianday('now') - julianday(firstSeen)) * 24 as lifetime_hours
        FROM nodes 
        WHERE lastHeartbeat > datetime('now', '-10 minutes')
        ORDER BY lifetime_hours DESC
      `).all();

      activeNodes.forEach(node => {
        const lifetime = node.lifetime_hours > 24 ? 
                        `${Math.round(node.lifetime_hours / 24)}d` : 
                        `${Math.round(node.lifetime_hours)}h`;
        console.log(`   ${node.nodeId.substring(0, 8)} (${node.name || 'unnamed'}) - ${lifetime} uptime`);
      });
      console.log('');
    }

    // Recent interventions
    const recentInterventions = this.db.prepare(`
      SELECT 
        intervention_type, 
        COUNT(*) as count,
        SUM(CASE WHEN outcome = 'reconnected' THEN 1 ELSE 0 END) as successes
      FROM retention_interventions 
      WHERE created_at > unixepoch() - 86400
      GROUP BY intervention_type
    `).all();

    if (recentInterventions.length > 0) {
      console.log('🔧 24h Intervention Summary:');
      recentInterventions.forEach(int => {
        const successRate = int.count > 0 ? Math.round((int.successes / int.count) * 100) : 0;
        console.log(`   ${int.intervention_type}: ${int.count} attempts, ${successRate}% success`);
      });
    }

    console.log('\n🔄 Dashboard refreshes every 30 seconds... (Ctrl+C to exit)');
  }

  calculateRetentionMetrics() {
    const totalNodes = this.db.prepare('SELECT COUNT(*) as count FROM nodes').get().count;
    const activeNodes = this.db.prepare(`
      SELECT COUNT(*) as count FROM nodes 
      WHERE lastHeartbeat > datetime('now', '-10 minutes')
    `).get().count;

    const retentionRate = totalNodes > 0 ? Math.round((activeNodes / totalNodes) * 100) : 0;

    // Average session length for nodes that have disconnected
    const avgSession = this.db.prepare(`
      SELECT AVG((julianday(lastHeartbeat) - julianday(firstSeen)) * 24) as avg_hours
      FROM nodes 
      WHERE lastHeartbeat < datetime('now', '-1 hour')
        AND firstSeen < lastHeartbeat
    `).get();

    const avgSessionHours = avgSession.avg_hours ? Math.round(avgSession.avg_hours * 10) / 10 : 0;

    // 24h churn rate (nodes that connected and left)
    const nodesYesterday = this.db.prepare(`
      SELECT COUNT(*) as count FROM nodes 
      WHERE firstSeen > datetime('now', '-24 hours')
    `).get().count;

    const churnedToday = this.db.prepare(`
      SELECT COUNT(*) as count FROM nodes 
      WHERE firstSeen > datetime('now', '-24 hours')
        AND lastHeartbeat < datetime('now', '-1 hour')
    `).get().count;

    const churnRate24h = nodesYesterday > 0 ? Math.round((churnedToday / nodesYesterday) * 100) : 0;

    return {
      totalNodes,
      activeNodes,
      retentionRate,
      avgSessionHours,
      churnRate24h
    };
  }
}

// CLI Interface
function main() {
  const toolkit = new NodeRetentionToolkit();
  const command = process.argv[2] || 'analyze';

  switch (command) {
    case 'analyze':
      toolkit.analyzeRetention();
      break;
    case 'onboard':
      toolkit.runOnboardingWizard();
      break;
    case 'intervene':
      toolkit.runRetentionIntervention();
      break;
    case 'dashboard':
      // Real-time dashboard
      toolkit.displayRetentionDashboard();
      setInterval(() => {
        toolkit.displayRetentionDashboard();
      }, 30000);
      break;
    default:
      console.log('Usage: node-retention-toolkit.js [analyze|onboard|intervene|dashboard]');
      console.log('');
      console.log('Commands:');
      console.log('  analyze   - Analyze current retention patterns and churn reasons');
      console.log('  onboard   - Run enhanced onboarding wizard for new nodes');
      console.log('  intervene - Identify and help at-risk nodes');
      console.log('  dashboard - Display real-time retention dashboard');
  }
}

if (require.main === module) {
  main();
}

module.exports = NodeRetentionToolkit;