#!/usr/bin/env node

/**
 * Automated Node Recovery System
 * Attempts to automatically diagnose and recover offline nodes
 * 
 * Usage: node automated-node-recovery.js [--dry-run] [--verbose]
 */

const Database = require('better-sqlite3');
const { exec } = require('child_process');
const http = require('http');
const WebSocket = require('ws');
const util = require('util');
const execAsync = util.promisify(exec);

class AutomatedNodeRecovery {
  constructor(options = {}) {
    this.db = new Database('data/mesh.db');
    this.dryRun = options.dryRun || false;
    this.verbose = options.verbose || false;
    this.serverUrl = 'http://moilol.com:8333';
    this.wsUrl = 'ws://moilol.com:8333';
  }

  log(message, level = 'INFO') {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${level}: ${message}`);
  }

  verboseLog(message) {
    if (this.verbose) {
      this.log(message, 'DEBUG');
    }
  }

  async checkServerHealth() {
    this.verboseLog('Checking mesh server health...');
    
    try {
      const response = await this.httpGet(`${this.serverUrl}/status`);
      const health = JSON.parse(response);
      
      if (health.status) {
        this.log(`✅ Mesh server is responding (status: ${health.status})`);
        return true;
      } else {
        this.log('❌ Mesh server reports no status', 'ERROR');
        return false;
      }
    } catch (error) {
      this.log(`❌ Cannot reach mesh server: ${error.message}`, 'ERROR');
      return false;
    }
  }

  async checkWebSocketConnection() {
    this.verboseLog('Testing WebSocket connection...');
    
    return new Promise((resolve) => {
      const ws = new WebSocket(this.wsUrl);
      let connected = false;
      
      const timeout = setTimeout(() => {
        if (!connected) {
          ws.terminate();
          this.log('❌ WebSocket connection timeout', 'ERROR');
          resolve(false);
        }
      }, 5000);
      
      ws.on('open', () => {
        connected = true;
        clearTimeout(timeout);
        this.log('✅ WebSocket connection successful');
        ws.close();
        resolve(true);
      });
      
      ws.on('error', (error) => {
        connected = true;
        clearTimeout(timeout);
        this.log(`❌ WebSocket connection failed: ${error.message}`, 'ERROR');
        resolve(false);
      });
    });
  }

  async getOfflineNodes() {
    const now = Date.now();
    const fiveMinutesAgo = now - (5 * 60 * 1000);
    
    const offlineNodes = this.db.prepare(`
      SELECT nodeId, name, owner, capabilities, jobsCompleted, lastSeen, flags
      FROM nodes 
      WHERE lastSeen < ?
      ORDER BY jobsCompleted DESC
    `).all(fiveMinutesAgo);

    return offlineNodes;
  }

  async analyzeNodeFailure(node) {
    const now = Date.now();
    const minutesOffline = Math.floor((now - node.lastSeen) / 60000);
    
    this.log(`📊 Analyzing failure: ${node.name || node.nodeId.substring(0,8)} (${minutesOffline}m offline)`);
    
    const analysis = {
      nodeId: node.nodeId,
      name: node.name,
      owner: node.owner,
      minutesOffline,
      capabilities: JSON.parse(node.capabilities || '[]'),
      jobsCompleted: node.jobsCompleted,
      flags: JSON.parse(node.flags || '{}'),
      issues: [],
      recommendations: []
    };

    // Check for quarantine status
    if (analysis.flags.quarantined) {
      analysis.issues.push('Node is quarantined due to job failures');
      analysis.recommendations.push('Review quarantine reason and fix underlying issues');
    }

    // Check disconnection patterns
    if (minutesOffline < 60) {
      analysis.issues.push('Recent disconnection - may be temporary network issue');
      analysis.recommendations.push('Monitor for automatic reconnection');
    } else if (minutesOffline < 24 * 60) {
      analysis.issues.push('Extended offline period - likely requires manual intervention');
      analysis.recommendations.push('Contact node operator for manual restart');
    } else {
      analysis.issues.push('Long-term offline - operator may have abandoned node');
      analysis.recommendations.push('Consider removing from network or recruiting replacement');
    }

    // Check capability importance
    const criticalCapabilities = ['transcription', 'whisper', 'tesseract'];
    const hasCriticalCap = analysis.capabilities.some(cap => criticalCapabilities.includes(cap));
    if (hasCriticalCap) {
      analysis.issues.push('Node has critical capabilities needed for job processing');
      analysis.recommendations.push('HIGH PRIORITY for restoration');
    }

    // Check performance history
    if (analysis.jobsCompleted > 10) {
      analysis.issues.push('High-performing node - significant capacity loss');
      analysis.recommendations.push('Urgent restoration needed - proven reliable performer');
    }

    return analysis;
  }

  async attemptAutomaticRecovery(node) {
    if (this.dryRun) {
      this.log(`🧪 DRY RUN: Would attempt recovery for ${node.name}`, 'INFO');
      return false;
    }

    this.log(`🔄 Attempting automatic recovery for ${node.name}...`);
    
    // For known Drake nodes, we can attempt some basic diagnostics
    if (node.owner === 'drake' && (node.name === 'miniclaw' || node.name === 'frigg')) {
      return await this.recoverDrakeNode(node);
    }
    
    // For unknown nodes, we can only do basic monitoring
    if (node.owner === 'unknown') {
      this.log(`⚠️ Cannot auto-recover anonymous node ${node.nodeId.substring(0,8)}`);
      return false;
    }

    this.log(`⚠️ No automatic recovery available for ${node.name}`);
    return false;
  }

  async recoverDrakeNode(node) {
    this.log(`🔧 Attempting Drake node recovery: ${node.name}`);
    
    // We can't actually SSH to Drake's machines, but we can prepare recovery instructions
    const instructions = this.generateRecoveryInstructions(node);
    
    // Save instructions to file for Drake
    const filename = `node-recovery-${node.name}-${Date.now()}.md`;
    const fs = require('fs');
    fs.writeFileSync(filename, instructions);
    
    this.log(`📝 Recovery instructions saved: ${filename}`);
    return false; // Can't actually auto-recover, need human intervention
  }

  generateRecoveryInstructions(node) {
    let capabilities;
    if (Array.isArray(node.capabilities)) {
      capabilities = node.capabilities;
    } else {
      try {
        capabilities = JSON.parse(node.capabilities || '[]');
      } catch (error) {
        console.log('Error parsing capabilities:', node.capabilities);
        capabilities = [];
      }
    }
    let instructions = `# Recovery Instructions for ${node.name}\n\n`;
    
    instructions += `**Node ID:** ${node.nodeId}\n`;
    instructions += `**Owner:** ${node.owner}\n`;
    instructions += `**Capabilities:** ${capabilities.join(', ')}\n`;
    instructions += `**Jobs Completed:** ${node.jobsCompleted}\n`;
    instructions += `**Last Seen:** ${new Date(node.lastSeen || 0).toISOString()}\n\n`;
    
    instructions += `## Recovery Steps\n\n`;
    
    if (capabilities.includes('whisper') || capabilities.includes('transcription')) {
      instructions += `### Transcription Service\n`;
      instructions += `\`\`\`bash\n`;
      instructions += `claw skill mesh-transcribe\n`;
      instructions += `\`\`\`\n\n`;
    }
    
    if (capabilities.includes('tesseract')) {
      instructions += `### OCR Service\n`;
      instructions += `\`\`\`bash\n`;
      instructions += `# Check tesseract installation\n`;
      instructions += `which tesseract\n`;
      instructions += `tesseract --version\n\n`;
      instructions += `# Start mesh client\n`;
      instructions += `node /path/to/ic-mesh/client.js\n`;
      instructions += `\`\`\`\n\n`;
    }
    
    instructions += `## Diagnostics\n\n`;
    instructions += `\`\`\`bash\n`;
    instructions += `# Test server connection\n`;
    instructions += `curl http://moilol.com:8333/status\n\n`;
    instructions += `# Check node processes\n`;
    instructions += `ps aux | grep mesh\n\n`;
    instructions += `# Check available disk space\n`;
    instructions += `df -h\n`;
    instructions += `\`\`\`\n`;
    
    return instructions;
  }

  async clearStuckJobs() {
    if (this.dryRun) {
      this.log('🧪 DRY RUN: Would clear stuck jobs', 'INFO');
      return 0;
    }

    // Find jobs claimed by offline nodes
    const now = Date.now();
    const fiveMinutesAgo = now - (5 * 60 * 1000);
    
    const stuckJobs = this.db.prepare(`
      SELECT j.jobId, j.claimedBy, n.lastSeen
      FROM jobs j
      LEFT JOIN nodes n ON j.claimedBy = n.nodeId
      WHERE j.status = 'claimed' 
      AND (n.lastSeen IS NULL OR n.lastSeen < ?)
    `).all(fiveMinutesAgo);

    if (stuckJobs.length > 0) {
      this.log(`🧹 Clearing ${stuckJobs.length} stuck jobs from offline nodes`);
      
      const updateStmt = this.db.prepare(`
        UPDATE jobs 
        SET status = 'pending', claimedBy = NULL, claimedAt = NULL 
        WHERE jobId = ?
      `);
      
      stuckJobs.forEach(job => {
        updateStmt.run(job.jobId);
        this.verboseLog(`Cleared job ${job.jobId} from offline node ${job.claimedBy?.substring(0,8)}`);
      });
      
      this.log(`✅ Released ${stuckJobs.length} jobs back to pending status`);
    }
    
    return stuckJobs.length;
  }

  async httpGet(url) {
    return new Promise((resolve, reject) => {
      http.get(url, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
      }).on('error', reject);
    });
  }

  async run() {
    this.log('🚀 Starting Automated Node Recovery System');
    
    if (this.dryRun) {
      this.log('🧪 Running in DRY RUN mode - no changes will be made');
    }

    // Step 1: Check server health
    const serverHealthy = await this.checkServerHealth();
    if (!serverHealthy) {
      this.log('❌ Server unhealthy - cannot proceed with node recovery', 'ERROR');
      return;
    }

    // Step 2: Check WebSocket connectivity
    const wsHealthy = await this.checkWebSocketConnection();
    if (!wsHealthy) {
      this.log('⚠️ WebSocket connection issues - nodes may have connectivity problems', 'WARN');
      // Continue anyway - we can still analyze offline nodes
    }

    // Step 3: Clear stuck jobs from offline nodes
    const clearedJobs = await this.clearStuckJobs();
    if (clearedJobs > 0) {
      this.log(`✅ Cleared ${clearedJobs} stuck jobs`);
    }

    // Step 4: Analyze offline nodes
    const offlineNodes = await this.getOfflineNodes();
    this.log(`📊 Found ${offlineNodes.length} offline nodes`);

    const analyses = [];
    for (const node of offlineNodes) {
      const analysis = await this.analyzeNodeFailure(node);
      analyses.push(analysis);
    }

    // Step 5: Attempt automatic recovery where possible
    let recoveryAttempts = 0;
    let successfulRecoveries = 0;

    for (const analysis of analyses) {
      if (analysis.jobsCompleted > 5) { // Only attempt recovery for proven nodes
        recoveryAttempts++;
        const success = await this.attemptAutomaticRecovery(analysis);
        if (success) {
          successfulRecoveries++;
        }
      }
    }

    // Step 6: Generate summary report
    this.generateSummaryReport(analyses, recoveryAttempts, successfulRecoveries, clearedJobs);
  }

  generateSummaryReport(analyses, recoveryAttempts, successfulRecoveries, clearedJobs) {
    const report = [];
    
    report.push('# Automated Node Recovery Report');
    report.push('');
    report.push(`**Timestamp:** ${new Date().toISOString()}`);
    report.push(`**Offline Nodes Analyzed:** ${analyses.length}`);
    report.push(`**Recovery Attempts:** ${recoveryAttempts}`);
    report.push(`**Successful Recoveries:** ${successfulRecoveries}`);
    report.push(`**Stuck Jobs Cleared:** ${clearedJobs}`);
    report.push('');

    // High priority nodes needing manual intervention
    const criticalNodes = analyses.filter(a => 
      a.jobsCompleted > 10 || 
      a.capabilities.some(cap => ['transcription', 'whisper', 'tesseract'].includes(cap))
    );

    if (criticalNodes.length > 0) {
      report.push('## 🚨 Critical Nodes Needing Manual Intervention');
      report.push('');
      criticalNodes.forEach(node => {
        report.push(`### ${node.name || node.nodeId.substring(0,8)}`);
        report.push(`- **Owner:** ${node.owner}`);
        report.push(`- **Offline:** ${node.minutesOffline} minutes`);
        report.push(`- **Jobs Completed:** ${node.jobsCompleted}`);
        report.push(`- **Capabilities:** ${node.capabilities.join(', ')}`);
        report.push('- **Issues:**');
        node.issues.forEach(issue => report.push(`  - ${issue}`));
        report.push('- **Recommendations:**');
        node.recommendations.forEach(rec => report.push(`  - ${rec}`));
        report.push('');
      });
    }

    const reportContent = report.join('\n');
    const filename = `AUTO-RECOVERY-REPORT-${Date.now()}.md`;
    const fs = require('fs');
    fs.writeFileSync(filename, reportContent);
    
    this.log(`📄 Summary report saved: ${filename}`);
    console.log('\n' + reportContent);
  }

  close() {
    this.db.close();
  }
}

// CLI usage
if (require.main === module) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const verbose = args.includes('--verbose');
  
  const recovery = new AutomatedNodeRecovery({ dryRun, verbose });
  
  recovery.run()
    .then(() => recovery.close())
    .catch(error => {
      console.error('Fatal error:', error);
      recovery.close();
      process.exit(1);
    });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down recovery system...');
    recovery.close();
    process.exit(0);
  });
}

module.exports = AutomatedNodeRecovery;