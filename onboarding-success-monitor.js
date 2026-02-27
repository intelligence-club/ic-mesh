#!/usr/bin/env node

// Real-time onboarding success monitor 
// Detects and responds to immediate disconnects

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

class OnboardingMonitor {
  constructor() {
    this.db = new sqlite3.Database('./data/mesh.db', sqlite3.OPEN_READONLY);
    this.recentRegistrations = new Map();
    this.monitoringActive = false;
  }

  async getRecentRegistrations() {
    return new Promise((resolve, reject) => {
      // Get nodes registered in last 30 minutes
      const thirtyMinsAgo = Math.floor(Date.now() / 1000) - (30 * 60);
      
      this.db.all(
        `SELECT nodeId, registeredAt, lastHeartbeat, name, capabilities 
         FROM nodes 
         WHERE registeredAt > ? 
         ORDER BY registeredAt DESC`,
        [thirtyMinsAgo],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
  }

  async checkOnboardingSuccess(node) {
    const now = Math.floor(Date.now() / 1000);
    const registeredMinutesAgo = Math.floor((now - node.registeredAt) / 60);
    const lastSeenMinutesAgo = Math.floor((now - node.lastSeen) / 60);
    
    // Classify onboarding status
    if (registeredMinutesAgo < 5) {
      return { status: 'connecting', minutesActive: registeredMinutesAgo };
    } else if (lastSeenMinutesAgo < 5) {
      return { status: 'active', minutesActive: registeredMinutesAgo };
    } else if (registeredMinutesAgo < 30 && lastSeenMinutesAgo > 5) {
      return { status: 'immediate_disconnect', minutesActive: registeredMinutesAgo - lastSeenMinutesAgo };
    } else {
      return { status: 'needs_revival', minutesActive: registeredMinutesAgo - lastSeenMinutesAgo };
    }
  }

  async getNodeJobs(nodeId) {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT jobId, type, status, completedAt 
         FROM jobs 
         WHERE claimedBy = ? 
         ORDER BY createdAt DESC LIMIT 5`,
        [nodeId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
  }

  formatTime(timestamp) {
    return new Date(timestamp * 1000).toLocaleString();
  }

  async generateOnboardingReport() {
    const recent = await this.getRecentRegistrations();
    
    console.log('🚀 REAL-TIME ONBOARDING MONITOR');
    console.log('═'.repeat(50));
    console.log(`📊 Monitoring ${recent.length} recent registrations (30min window)`);
    console.log('');
    
    const statusCounts = { connecting: 0, active: 0, immediate_disconnect: 0, needs_revival: 0 };
    
    for (const node of recent) {
      const status = await this.checkOnboardingSuccess(node);
      const jobs = await this.getNodeJobs(node.nodeId);
      statusCounts[status.status]++;
      
      const icon = {
        connecting: '🔄',
        active: '✅',
        immediate_disconnect: '🚨', 
        needs_revival: '⚠️'
      }[status.status];
      
      console.log(`${icon} ${node.nodeId.substring(0,8)} (${node.name || 'unknown'})`);
      console.log(`   Status: ${status.status.replace('_', ' ').toUpperCase()}`);
      console.log(`   Registered: ${this.formatTime(node.registeredAt)}`);
      console.log(`   Last seen: ${node.lastHeartbeat ? this.formatTime(node.lastHeartbeat) : 'Never'}`);
      console.log(`   Capabilities: ${JSON.parse(node.capabilities || '[]').join(', ')}`);
      console.log(`   Jobs completed: ${jobs.filter(j => j.status === 'completed').length}`);
      
      if (status.status === 'immediate_disconnect') {
        console.log(`   ⚠️  DISCONNECTED after ${status.minutesActive} minutes`);
        console.log(`   💡 ACTION: Send troubleshooting guide and reconnection instructions`);
      }
      console.log('');
    }
    
    console.log('📈 ONBOARDING SUCCESS RATES');
    console.log('─'.repeat(30));
    const total = recent.length;
    if (total > 0) {
      console.log(`✅ Active: ${statusCounts.active}/${total} (${Math.round(100*statusCounts.active/total)}%)`);
      console.log(`🔄 Connecting: ${statusCounts.connecting}/${total} (${Math.round(100*statusCounts.connecting/total)}%)`);
      console.log(`🚨 Immediate disconnect: ${statusCounts.immediate_disconnect}/${total} (${Math.round(100*statusCounts.immediate_disconnect/total)}%)`);
      console.log(`⚠️  Needs revival: ${statusCounts.needs_revival}/${total} (${Math.round(100*statusCounts.needs_revival/total)}%)`);
    }
    
    return statusCounts;
  }

  async generateImmediateDisconnectReport() {
    const recent = await this.getRecentRegistrations();
    const problematic = [];
    
    for (const node of recent) {
      const status = await this.checkOnboardingSuccess(node);
      if (status.status === 'immediate_disconnect') {
        problematic.push({ node, status });
      }
    }
    
    if (problematic.length > 0) {
      console.log('🚨 IMMEDIATE DISCONNECT ALERTS');
      console.log('═'.repeat(40));
      
      for (const { node, status } of problematic) {
        console.log(`📱 Node: ${node.nodeId}`);
        console.log(`👤 Owner: ${node.name || 'unknown'}`);
        console.log(`⏰ Disconnected after: ${status.minutesActive} minutes`);
        console.log(`🔧 Capabilities: ${JSON.parse(node.capabilities || '[]').join(', ')}`);
        console.log(`💡 Suggest: Check connection, send troubleshooting guide`);
        console.log('');
      }
      
      // Create alert file for monitoring systems
      const alert = {
        timestamp: Date.now(),
        count: problematic.length,
        nodes: problematic.map(p => ({
          nodeId: p.node.nodeId,
          owner: p.node.name,
          minutesActive: p.status.minutesActive
        }))
      };
      
      fs.writeFileSync('onboarding-disconnect-alert.json', JSON.stringify(alert, null, 2));
      console.log('📝 Alert saved to onboarding-disconnect-alert.json');
    }
    
    return problematic;
  }

  close() {
    this.db.close();
  }
}

// Main execution
async function main() {
  const monitor = new OnboardingMonitor();
  
  try {
    const args = process.argv.slice(2);
    
    if (args.includes('--alerts-only')) {
      await monitor.generateImmediateDisconnectReport();
    } else {
      await monitor.generateOnboardingReport();
      
      if (args.includes('--with-alerts')) {
        console.log('');
        await monitor.generateImmediateDisconnectReport();
      }
    }
    
  } catch (error) {
    console.error('❌ Monitor error:', error.message);
  } finally {
    monitor.close();
  }
}

if (require.main === module) {
  main();
}

module.exports = OnboardingMonitor;