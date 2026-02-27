#!/usr/bin/env node

/**
 * IC Mesh Automated Node Retention System
 * Proactive retention tools to prevent node churn and improve operator satisfaction
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs').promises;

const dbPath = path.join(__dirname, '..', 'data', 'mesh.db');

class NodeRetentionSystem {
  constructor() {
    this.db = new sqlite3.Database(dbPath);
  }

  async analyzeRetentionPatterns() {
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
          computeMinutes,
          capabilities,
          payout_email,
          CASE 
            WHEN (unixepoch('now') - lastSeen) / 60 < 5 THEN 'active'
            WHEN (unixepoch('now') - lastSeen) / 3600 < 24 THEN 'at_risk'
            WHEN (unixepoch('now') - lastSeen) / 86400 < 7 THEN 'churned'
            ELSE 'lost'
          END as retention_status
        FROM nodes 
        ORDER BY lastSeen DESC
      `, (err, nodes) => {
        if (err) reject(err);
        else resolve(nodes);
      });
    });
  }

  async getNodeRetentionScore(nodeId) {
    return new Promise((resolve, reject) => {
      this.db.get(`
        SELECT 
          nodeId,
          jobsCompleted,
          computeMinutes,
          (unixepoch('now') - registeredAt) / 86400.0 as days_registered,
          (unixepoch('now') - lastSeen) / 3600.0 as hours_offline,
          CASE 
            WHEN jobsCompleted = 0 THEN 0
            ELSE jobsCompleted / NULLIF(((unixepoch('now') - registeredAt) / 86400.0), 0)
          END as jobs_per_day,
          capabilities
        FROM nodes 
        WHERE nodeId = ?
      `, [nodeId], (err, node) => {
        if (err) reject(err);
        else resolve(this.calculateRetentionScore(node));
      });
    });
  }

  calculateRetentionScore(node) {
    if (!node) return { score: 0, factors: [] };

    const factors = [];
    let score = 50; // Base score

    // Job completion factor (0-30 points)
    const jobsPerDay = node.jobs_per_day || 0;
    if (jobsPerDay > 5) {
      score += 30;
      factors.push({ factor: 'high_activity', impact: 30, description: `${jobsPerDay.toFixed(1)} jobs/day` });
    } else if (jobsPerDay > 1) {
      score += 20;
      factors.push({ factor: 'moderate_activity', impact: 20, description: `${jobsPerDay.toFixed(1)} jobs/day` });
    } else if (jobsPerDay > 0) {
      score += 10;
      factors.push({ factor: 'low_activity', impact: 10, description: `${jobsPerDay.toFixed(1)} jobs/day` });
    } else {
      score -= 20;
      factors.push({ factor: 'no_activity', impact: -20, description: 'No jobs completed' });
    }

    // Time offline factor (0 to -40 points)
    const hoursOffline = node.hours_offline || 0;
    if (hoursOffline < 1) {
      score += 20;
      factors.push({ factor: 'currently_online', impact: 20, description: 'Online now' });
    } else if (hoursOffline < 24) {
      score -= 5;
      factors.push({ factor: 'recently_offline', impact: -5, description: `${hoursOffline.toFixed(1)}h offline` });
    } else if (hoursOffline < 168) {
      score -= 20;
      factors.push({ factor: 'weekly_churn', impact: -20, description: `${(hoursOffline/24).toFixed(1)} days offline` });
    } else {
      score -= 40;
      factors.push({ factor: 'long_gone', impact: -40, description: `${(hoursOffline/24).toFixed(0)} days offline` });
    }

    // Tenure factor (0-15 points)
    const daysRegistered = node.days_registered || 0;
    if (daysRegistered > 30) {
      score += 15;
      factors.push({ factor: 'veteran', impact: 15, description: `${daysRegistered.toFixed(0)} days registered` });
    } else if (daysRegistered > 7) {
      score += 10;
      factors.push({ factor: 'established', impact: 10, description: `${daysRegistered.toFixed(0)} days registered` });
    } else if (daysRegistered < 1) {
      score -= 10;
      factors.push({ factor: 'new_node', impact: -10, description: 'Less than 1 day old' });
    }

    // Capability factor (0-15 points)
    const capabilities = node.capabilities ? JSON.parse(node.capabilities) : [];
    if (capabilities.length > 3) {
      score += 15;
      factors.push({ factor: 'multi_capability', impact: 15, description: `${capabilities.length} capabilities` });
    } else if (capabilities.length > 1) {
      score += 10;
      factors.push({ factor: 'multi_capability', impact: 10, description: `${capabilities.length} capabilities` });
    } else if (capabilities.length === 0) {
      score -= 10;
      factors.push({ factor: 'no_capabilities', impact: -10, description: 'No capabilities registered' });
    }

    return {
      score: Math.max(0, Math.min(100, score)),
      factors,
      metrics: {
        jobsPerDay,
        hoursOffline,
        daysRegistered,
        capabilityCount: capabilities.length
      }
    };
  }

  async generateRetentionActions() {
    const nodes = await this.analyzeRetentionPatterns();
    const actions = [];

    for (const node of nodes) {
      const retentionData = await this.getNodeRetentionScore(node.nodeId);
      const action = this.determineRetentionAction(node, retentionData);
      if (action) actions.push(action);
    }

    return actions;
  }

  determineRetentionAction(node, retentionData) {
    const { score, factors } = retentionData;
    const status = node.retention_status;

    // Determine priority and action type
    let priority = 'low';
    let actionType = 'monitor';
    let message = '';

    if (status === 'at_risk' && score > 60) {
      priority = 'high';
      actionType = 'proactive_outreach';
      message = `High-value node (${score}/100 retention score) went offline. Immediate outreach recommended.`;
    } else if (status === 'churned' && score > 40) {
      priority = 'medium';
      actionType = 'win_back';
      message = `Valuable node churned. Win-back campaign with incentives.`;
    } else if (status === 'active' && score < 30) {
      priority = 'medium';
      actionType = 'satisfaction_check';
      message = `Active node with low satisfaction indicators. Check for issues.`;
    } else if (status === 'lost' && node.jobsCompleted > 10) {
      priority = 'low';
      actionType = 'quarterly_outreach';
      message = `Previously productive node. Include in quarterly retention campaigns.`;
    }

    if (actionType === 'monitor') return null;

    return {
      nodeId: node.nodeId,
      shortId: node.short_id,
      owner: node.owner,
      email: node.payout_email,
      priority,
      actionType,
      message,
      retentionScore: score,
      status,
      metrics: {
        jobsCompleted: node.jobsCompleted,
        daysRegistered: ((Date.now() / 1000 - node.registeredAt) / 86400).toFixed(1),
        hoursOffline: ((Date.now() / 1000 - node.lastSeen) / 3600).toFixed(1)
      },
      keyFactors: factors.filter(f => Math.abs(f.impact) > 10).map(f => f.description)
    };
  }

  async createRetentionCampaigns() {
    const actions = await this.generateRetentionActions();
    const campaigns = {
      immediate: actions.filter(a => a.priority === 'high'),
      weekly: actions.filter(a => a.priority === 'medium'),
      monthly: actions.filter(a => a.priority === 'low')
    };

    return campaigns;
  }

  generateRetentionMessage(action) {
    const templates = {
      proactive_outreach: {
        subject: `IC Mesh: We miss your ${action.shortId} node!`,
        body: `Hi ${action.owner || 'there'},

We noticed your node (${action.shortId}) went offline recently. You've been a valuable contributor with ${action.metrics.jobsCompleted} jobs completed!

Is everything okay? If you're experiencing any issues, we're here to help:
- Technical support
- Configuration assistance  
- Earnings optimization

Your node has a ${action.retentionScore}/100 retention score, which means you're important to our network.

Reply to this email if you need any assistance getting back online.

Best regards,
IC Mesh Team`
      },
      win_back: {
        subject: `Come back to IC Mesh - Special bonus waiting`,
        body: `Hi ${action.owner || 'there'},

Your node (${action.shortId}) has been offline for ${action.metrics.hoursOffline} hours. We miss your contribution!

As a win-back offer, we're providing:
🎁 2x earnings for your first 10 jobs when you return
🔧 Free priority technical support
📊 Performance optimization consultation

Your previous ${action.metrics.jobsCompleted} jobs helped build the network. We'd love to have you back.

Ready to restart? Just run: claw skill mesh-transcribe

Questions? Reply to this email.

Best regards,  
IC Mesh Team`
      },
      satisfaction_check: {
        subject: `How's your IC Mesh experience? Quick feedback`,
        body: `Hi ${action.owner || 'there'},

Your node (${action.shortId}) is active, but we want to make sure you're having a great experience.

Quick 2-minute survey: How can we improve IC Mesh for you?
- Are earnings meeting expectations?
- Any technical issues?
- Feature requests?

We value your ${action.metrics.jobsCompleted} completed jobs and want to ensure long-term satisfaction.

Reply with any feedback or concerns.

Best regards,
IC Mesh Team`
      }
    };

    return templates[action.actionType] || null;
  }

  async exportRetentionReport() {
    const campaigns = await this.createRetentionCampaigns();
    const timestamp = new Date().toISOString().split('T')[0];
    
    const report = {
      generated: new Date().toISOString(),
      summary: {
        total_actions: campaigns.immediate.length + campaigns.weekly.length + campaigns.monthly.length,
        immediate_priority: campaigns.immediate.length,
        weekly_priority: campaigns.weekly.length,
        monthly_priority: campaigns.monthly.length
      },
      campaigns,
      messages: {}
    };

    // Generate sample messages for each action
    [...campaigns.immediate, ...campaigns.weekly, ...campaigns.monthly].forEach(action => {
      const message = this.generateRetentionMessage(action);
      if (message) {
        report.messages[action.nodeId] = {
          ...message,
          metadata: {
            nodeId: action.nodeId,
            priority: action.priority,
            retentionScore: action.retentionScore,
            actionType: action.actionType
          }
        };
      }
    });

    const reportPath = path.join(__dirname, '..', 'data', `retention-report-${timestamp}.json`);
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));

    return { report, reportPath };
  }

  close() {
    this.db.close();
  }
}

// CLI Interface
async function main() {
  const system = new NodeRetentionSystem();
  
  try {
    console.log('🔄 IC MESH NODE RETENTION SYSTEM');
    console.log('=================================\n');

    console.log('📊 Analyzing retention patterns...');
    const nodes = await system.analyzeRetentionPatterns();
    
    console.log('🎯 Generating retention actions...');
    const campaigns = await system.createRetentionCampaigns();
    
    console.log('📝 Creating retention report...\n');
    const { report, reportPath } = await system.exportRetentionReport();
    
    // Display summary
    console.log('📋 RETENTION CAMPAIGN SUMMARY');
    console.log('============================');
    console.log(`Total nodes analyzed: ${nodes.length}`);
    console.log(`Action items generated: ${report.summary.total_actions}`);
    console.log(`  🔴 Immediate priority: ${report.summary.immediate_priority}`);
    console.log(`  🟡 Weekly priority: ${report.summary.weekly_priority}`);
    console.log(`  🟢 Monthly priority: ${report.summary.monthly_priority}`);
    
    if (report.summary.immediate_priority > 0) {
      console.log('\n🚨 IMMEDIATE ACTIONS REQUIRED:');
      campaigns.immediate.forEach((action, i) => {
        console.log(`${i + 1}. Node ${action.shortId}: ${action.message}`);
        console.log(`   Contact: ${action.email || action.owner || 'Unknown'}`);
        console.log(`   Score: ${action.retentionScore}/100`);
      });
    }
    
    if (report.summary.weekly_priority > 0) {
      console.log('\n📅 WEEKLY CAMPAIGN ACTIONS:');
      campaigns.weekly.forEach((action, i) => {
        console.log(`${i + 1}. Node ${action.shortId}: ${action.message}`);
      });
    }
    
    console.log(`\n💾 Full report saved: ${reportPath}`);
    console.log('\n🎯 Next steps:');
    console.log('1. Review immediate priority actions');
    console.log('2. Execute high-priority outreach campaigns');  
    console.log('3. Set up automated weekly/monthly campaigns');
    console.log('4. Monitor retention score improvements');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    system.close();
  }
}

if (require.main === module) {
  main();
}

module.exports = { NodeRetentionSystem };