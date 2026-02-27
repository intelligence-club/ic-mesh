#!/usr/bin/env node

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

async function investigateOfflineNodes() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database('./data/mesh.db');
    
    console.log('🔍 INVESTIGATING OFFLINE NODE RECOVERY');
    console.log('======================================');
    
    // Check the unnamed node details  
    db.all(`
      SELECT nodeId, lastSeen, capabilities, jobsCompleted, name
      FROM nodes 
      WHERE nodeId LIKE '%unnamed%' OR capabilities LIKE '%transcribe%' OR capabilities LIKE '%transcription%'
      ORDER BY lastSeen DESC
    `, (err, rows) => {
      if (err) {
        console.error('Database error:', err);
        return reject(err);
      }
      
      console.log('📋 Transcription-capable nodes:');
      rows.forEach(node => {
        const minutesOffline = (Date.now() - node.lastSeen) / 60000;
        const hoursOffline = minutesOffline / 60;
        const formatTime = hoursOffline > 1 ? 
          `${Math.round(hoursOffline * 10) / 10}h` : 
          `${Math.round(minutesOffline)}m`;
          
        console.log(`  📍 ${node.nodeId.slice(0, 12)}...`);
        console.log(`     Capabilities: ${node.capabilities}`);
        console.log(`     Jobs completed: ${node.jobsCompleted}`);
        console.log(`     Offline for: ${formatTime}`);
        
        if (minutesOffline < 30) {
          console.log(`     🟡 Recently offline - may reconnect soon`);
        } else if (minutesOffline < 120) {
          console.log(`     🟠 Moderately offline - manual intervention may help`);
        } else {
          console.log(`     🔴 Long offline - likely requires operator restart`);
        }
        console.log('');
      });
      
      // Check for stuck jobs from offline nodes
      db.all(`
        SELECT jobId, type, claimedBy, claimedAt, 
               (julianday('now') - julianday(claimedAt/86400000.0 + 2440588)) * 24 * 60 as minutesClaimed
        FROM jobs 
        WHERE status = 'claimed' 
        ORDER BY claimedAt DESC
      `, (err, stuckJobs) => {
        if (err) {
          console.error('Error checking stuck jobs:', err);
          db.close();
          return reject(err);
        }
        
        console.log('🔄 STUCK JOBS ANALYSIS');
        console.log('======================');
        
        if (stuckJobs && stuckJobs.length > 0) {
          let releasableCount = 0;
          stuckJobs.forEach(job => {
            const minutesClaimed = (Date.now() - job.claimedAt) / 60000;
            const shouldRelease = minutesClaimed > 10; // Release jobs claimed more than 10 minutes ago
            
            console.log(`  🔗 ${job.jobId} (${job.type})`);
            console.log(`     Claimed by: ${job.claimedBy?.slice(0, 12) || 'unknown'}...`);
            console.log(`     Claimed: ${Math.round(minutesClaimed)}m ago`);
            
            if (shouldRelease) {
              console.log(`     ⚡ Should be released back to pending`);
              releasableCount++;
            } else {
              console.log(`     ⏳ Still within processing window`);
            }
            console.log('');
          });
          
          if (releasableCount > 0) {
            console.log(`💡 RECOMMENDATION: Release ${releasableCount} stuck jobs back to pending status`);
            console.log(`   This will make them available for the active node to process`);
          }
        } else {
          console.log('✅ No stuck jobs found - all jobs are properly queued');
        }
        
        db.close();
        resolve({ rows, stuckJobs });
      });
    });
  });
}

if (require.main === module) {
  investigateOfflineNodes().catch(console.error);
}

module.exports = investigateOfflineNodes;