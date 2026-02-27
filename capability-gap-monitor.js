#!/usr/bin/env node
/**
 * Capability Gap Monitor - Detect when jobs require capabilities we don't have
 */

const sqlite3 = require('sqlite3');

class CapabilityGapMonitor {
  constructor() {
    this.db = new sqlite3.Database('data/mesh.db');
  }

  async analyzeCapabilityGaps() {
    return new Promise((resolve, reject) => {
      // Get all pending jobs and their types
      this.db.all('SELECT type, COUNT(*) as count FROM jobs WHERE status = "pending" GROUP BY type', (err, jobTypes) => {
        if (err) {
          reject(err);
          return;
        }

        // Get all active node capabilities  
        this.db.all(`
          SELECT nodeId, name, capabilities, lastSeen 
          FROM nodes 
          WHERE (${Date.now()} - lastSeen) < 300000 
          ORDER BY lastSeen DESC
        `, (err, nodes) => {
          if (err) {
            reject(err);
            return;
          }

          resolve({ jobTypes, nodes });
        });
      });
    });
  }

  getCapabilitiesForJobType(jobType) {
    const capabilityMap = {
      'transcribe': ['transcription', 'whisper'],
      'ocr': ['tesseract', 'ocr'],
      'pdf-extract': ['tesseract', 'pdf-extract', 'poppler'],
      'stable-diffusion': ['stable-diffusion'],
      'ollama': ['ollama']
    };
    return capabilityMap[jobType] || [jobType];
  }

  parseCapabilities(capabilitiesJson) {
    try {
      return JSON.parse(capabilitiesJson).flat();
    } catch (err) {
      return [];
    }
  }

  formatTimeDiff(timestamp) {
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    return `${minutes}m`;
  }

  async analyze() {
    try {
      const { jobTypes, nodes } = await this.analyzeCapabilityGaps();
      
      console.log('🔍 CAPABILITY GAP ANALYSIS');
      console.log('═══════════════════════════');
      
      if (jobTypes.length === 0) {
        console.log('✅ No pending jobs - all clear!');
        return { status: 'healthy', gaps: [] };
      }

      const gaps = [];
      const availableCapabilities = new Set();
      
      // Collect all available capabilities from active nodes
      nodes.forEach(node => {
        const caps = this.parseCapabilities(node.capabilities);
        caps.forEach(cap => availableCapabilities.add(cap));
      });

      console.log(`\n📊 Active Nodes: ${nodes.length}`);
      if (nodes.length > 0) {
        console.log('   Available capabilities:', Array.from(availableCapabilities).join(', '));
        nodes.forEach(node => {
          const caps = this.parseCapabilities(node.capabilities);
          const timeDiff = this.formatTimeDiff(node.lastSeen);
          console.log(`   • ${node.name || node.nodeId.slice(0,8)}: [${caps.join(', ')}] (${timeDiff} ago)`);
        });
      } else {
        console.log('   ❌ No active nodes detected!');
      }

      console.log(`\n📋 Pending Jobs: ${jobTypes.reduce((sum, jt) => sum + jt.count, 0)}`);
      
      // Check each job type for capability coverage
      jobTypes.forEach(jobType => {
        const requiredCaps = this.getCapabilitiesForJobType(jobType.type);
        const hasCapability = requiredCaps.some(cap => availableCapabilities.has(cap));
        
        if (!hasCapability) {
          gaps.push({
            jobType: jobType.type,
            count: jobType.count,
            requiredCapabilities: requiredCaps,
            blockedRevenue: jobType.count * 2 // Estimate $2 per job
          });
          
          console.log(`   🚨 ${jobType.type}: ${jobType.count} jobs BLOCKED`);
          console.log(`      Required: [${requiredCaps.join(', ')}]`);
          console.log(`      Revenue at risk: ~$${jobType.count * 2}`);
        } else {
          console.log(`   ✅ ${jobType.type}: ${jobType.count} jobs (can process)`);
        }
      });

      // Summary
      if (gaps.length > 0) {
        const totalBlocked = gaps.reduce((sum, gap) => sum + gap.count, 0);
        const totalRevenue = gaps.reduce((sum, gap) => sum + gap.blockedRevenue, 0);
        
        console.log(`\n🚨 CAPABILITY GAPS DETECTED!`);
        console.log(`   Blocked jobs: ${totalBlocked}`);
        console.log(`   Revenue at risk: ~$${totalRevenue}`);
        console.log(`   Missing capabilities: ${[...new Set(gaps.flatMap(g => g.requiredCapabilities))].join(', ')}`);
        
        return { status: 'gaps_detected', gaps, totalBlocked, totalRevenue };
      } else {
        console.log(`\n✅ All job types have capability coverage`);
        return { status: 'healthy', gaps: [] };
      }

    } catch (err) {
      console.error('❌ Analysis error:', err.message);
      return { status: 'error', error: err.message };
    } finally {
      this.db.close();
    }
  }

  async generateAlert(analysis) {
    if (analysis.status === 'gaps_detected') {
      const timestamp = new Date().toISOString();
      const alertContent = `# 🚨 CAPABILITY GAP ALERT

**Time:** ${timestamp}  
**Status:** Service capacity crisis detected  
**Impact:** ${analysis.totalBlocked} jobs blocked, ~$${analysis.totalRevenue} revenue at risk

## Missing Capabilities
${analysis.gaps.map(gap => 
  `- **${gap.requiredCapabilities.join(' OR ')}** (${gap.count} ${gap.jobType} jobs blocked)`
).join('\n')}

## Required Actions
1. Contact node operators with missing capabilities
2. Deploy emergency nodes with required tools
3. Consider disabling job acceptance for unsupported services
4. Monitor queue growth and customer impact

**Priority:** P0 - Revenue blocking issue requiring immediate attention
`;

      await require('fs').promises.writeFile(
        `/home/openclaw/.openclaw/workspace/CAPABILITY-GAP-ALERT-${timestamp.slice(0,19).replace(/:/g,'-')}.md`,
        alertContent
      );
      
      console.log(`📄 Alert saved to CAPABILITY-GAP-ALERT-${timestamp.slice(0,19).replace(/:/g,'-')}.md`);
    }
  }
}

// CLI usage
if (require.main === module) {
  const monitor = new CapabilityGapMonitor();
  monitor.analyze().then(analysis => {
    monitor.generateAlert(analysis);
    process.exit(analysis.status === 'healthy' ? 0 : 1);
  });
}

module.exports = CapabilityGapMonitor;