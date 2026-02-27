#!/usr/bin/env node
/**
 * Manual Job Claiming Trigger
 * 
 * Directly triggers job claiming for active nodes by simulating
 * the actions that should happen automatically.
 */

const sqlite3 = require('sqlite3').verbose();
const http = require('http');
const path = require('path');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'data', 'mesh.db');

class JobClaimingTrigger {
  constructor() {
    this.db = new sqlite3.Database(DB_PATH);
  }

  async triggerJobClaiming() {
    console.log('🎯 Manual Job Claiming Trigger');
    console.log('================================');
    
    // Get active nodes with capabilities
    return new Promise((resolve) => {
      this.db.all(`
        SELECT nodeId, capabilities, lastSeen, jobsCompleted
        FROM nodes 
        WHERE lastSeen > ?
        ORDER BY jobsCompleted DESC
      `, [Date.now() - 10 * 60 * 1000], (err, activeNodes) => {
        if (err) {
          console.error('❌ Database error:', err.message);
          return resolve();
        }

        console.log(`Found ${activeNodes.length} active nodes:`);
        
        activeNodes.forEach(node => {
          const capabilities = JSON.parse(node.capabilities || '[]');
          const minutesAgo = Math.floor((Date.now() - node.lastSeen) / 60000);
          console.log(`  ${node.nodeId.substring(0,8)}: [${capabilities.join(', ')}] - ${minutesAgo}min ago (${node.jobsCompleted} completed)`);
        });

        // Get pending jobs that can be claimed
        this.db.all(`
          SELECT jobId, type, requirements, createdAt
          FROM jobs 
          WHERE status = 'pending'
          ORDER BY createdAt ASC
        `, (err, pendingJobs) => {
          if (err) {
            console.error('❌ Error getting pending jobs:', err.message);
            return resolve();
          }

          console.log(`\nFound ${pendingJobs.length} pending jobs:`);
          
          const jobsByType = {};
          pendingJobs.forEach(job => {
            jobsByType[job.type] = (jobsByType[job.type] || 0) + 1;
          });
          
          Object.entries(jobsByType).forEach(([type, count]) => {
            console.log(`  ${type}: ${count} jobs`);
          });

          // Try to manually trigger claiming for each capable node
          this.attemptManualClaiming(activeNodes, pendingJobs);
          resolve();
        });
      });
    });
  }

  attemptManualClaiming(activeNodes, pendingJobs) {
    console.log('\n🔧 Attempting manual job claiming triggers...');
    
    activeNodes.forEach(node => {
      const capabilities = JSON.parse(node.capabilities || '[]');
      
      // Skip test nodes
      if (capabilities.includes('test')) {
        console.log(`⏭️  Skipping test node ${node.nodeId.substring(0,8)}`);
        return;
      }

      // Find jobs this node can handle
      const claimableJobs = pendingJobs.filter(job => {
        const requirements = JSON.parse(job.requirements || '{}');
        if (!requirements.capability) return false;
        
        // Check both direct capability and aliases
        return capabilities.includes(requirements.capability) || 
               (requirements.capability === 'transcription' && capabilities.includes('transcription')) ||
               (requirements.capability === 'whisper' && capabilities.includes('transcription'));
      });

      if (claimableJobs.length > 0) {
        console.log(`\n🎯 Node ${node.nodeId.substring(0,8)} can claim ${claimableJobs.length} jobs:`);
        claimableJobs.slice(0, 3).forEach(job => {
          const requirements = JSON.parse(job.requirements || '{}');
          const minutesOld = Math.floor((Date.now() - job.createdAt) / 60000);
          console.log(`  📄 ${job.jobId.substring(0,8)}: ${job.type} (requires: ${requirements.capability}) - ${minutesOld}min old`);
        });
        
        // Simulate what should trigger the node to claim jobs
        this.simulateJobNotification(node, claimableJobs);
      }
    });
  }

  simulateJobNotification(node, jobs) {
    console.log(`\n📡 Simulating job notifications for node ${node.nodeId.substring(0,8)}...`);
    
    // In a real system, this would:
    // 1. Send WebSocket message to the node
    // 2. Update node heartbeat to trigger polling
    // 3. Directly call the node's claim endpoint
    
    console.log(`   Would notify about ${jobs.length} available jobs`);
    console.log(`   Node should check GET /jobs/available?nodeId=${node.nodeId}`);
    console.log(`   Then POST /jobs/{jobId}/claim with nodeId=${node.nodeId}`);
    
    // For now, just update the node's lastSeen to current time to encourage polling
    this.db.run(`
      UPDATE nodes 
      SET lastSeen = ? 
      WHERE nodeId = ?
    `, [Date.now(), node.nodeId], (err) => {
      if (err) {
        console.error(`❌ Error updating node heartbeat: ${err.message}`);
      } else {
        console.log(`✅ Updated node ${node.nodeId.substring(0,8)} heartbeat to encourage job polling`);
      }
    });
  }
}

// Run if called directly
if (require.main === module) {
  const trigger = new JobClaimingTrigger();
  trigger.triggerJobClaiming().then(() => {
    console.log('\n✅ Manual job claiming trigger completed');
    process.exit(0);
  }).catch(error => {
    console.error('💥 Error:', error);
    process.exit(1);
  });
}

module.exports = JobClaimingTrigger;