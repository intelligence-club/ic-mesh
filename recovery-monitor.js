#!/usr/bin/env node

// Real-time recovery monitor for IC Mesh service outage
// Monitors for node reconnections and service recovery

const Database = require('better-sqlite3');
const db = new Database('data/mesh.db');

console.log('🔄 IC MESH RECOVERY MONITOR STARTING...');
console.log('Monitor for automatic node reconnections and service recovery\n');

let lastActiveCount = 0;
let recoveryDetected = false;

function checkRecovery() {
  const timestamp = new Date().toISOString().slice(11, 19);
  
  // Get active nodes
  const activeNodes = db.prepare(`
    SELECT nodeId, name, capabilities, lastSeen,
           datetime(lastSeen/1000, 'unixepoch') as lastSeenHuman
    FROM nodes 
    WHERE datetime(lastSeen/1000, 'unixepoch') > datetime('now', '-3 minutes')
    ORDER BY lastSeen DESC
  `).all();

  // Get pending job counts
  const pendingCounts = db.prepare(`
    SELECT type, COUNT(*) as count 
    FROM jobs 
    WHERE status = 'pending' 
    GROUP BY type
  `).all();

  const totalPending = pendingCounts.reduce((sum, p) => sum + p.count, 0);
  
  if (activeNodes.length > lastActiveCount) {
    console.log(`\n✅ [${timestamp}] RECOVERY DETECTED!`);
    console.log(`   Active nodes: ${lastActiveCount} → ${activeNodes.length}`);
    
    activeNodes.forEach(node => {
      const capabilities = JSON.parse(node.capabilities || '[]').join(', ');
      console.log(`   🟢 ${node.nodeId.slice(0,8)} (${node.name || 'unnamed'}): [${capabilities}]`);
    });
    
    console.log(`   📋 Pending jobs: ${totalPending}`);
    recoveryDetected = true;
    
    // Check if primary service restored
    const transcriptionNodes = activeNodes.filter(n => {
      const caps = JSON.parse(n.capabilities || '[]');
      return caps.includes('transcription') || caps.includes('transcribe');
    });
    
    if (transcriptionNodes.length > 0) {
      console.log('   🎉 PRIMARY TRANSCRIPTION SERVICE RESTORED!');
      
      // Run quick verification
      setTimeout(() => {
        console.log('\n🔍 RUNNING RECOVERY VERIFICATION...');
        const fs = require('fs');
        const { execSync } = require('child_process');
        
        try {
          const status = execSync('curl -s http://localhost:8333/status', {encoding: 'utf8'});
          const statusObj = JSON.parse(status);
          
          console.log(`   Server status: ${statusObj.status}`);
          console.log(`   Active nodes: ${statusObj.nodes.active}/${statusObj.nodes.total}`);
          console.log(`   Pending jobs: ${statusObj.jobs.pending}`);
          
          if (statusObj.nodes.active > 0) {
            console.log('\n✅ SERVICE RECOVERY CONFIRMED - Monitor can be stopped');
            process.exit(0);
          }
        } catch (e) {
          console.log('   ⚠️ Verification check failed, continuing monitoring...');
        }
      }, 15000); // Wait 15 seconds for server status to update
      
    } else {
      console.log('   ⚠️ Node reconnected but no transcription capability yet');
    }
    
  } else if (activeNodes.length > 0 && !recoveryDetected) {
    console.log(`[${timestamp}] Service partially active: ${activeNodes.length} nodes, ${totalPending} pending jobs`);
  } else if (lastActiveCount === 0 && activeNodes.length === 0) {
    console.log(`[${timestamp}] Outage continues: 0 active nodes, ${totalPending} pending jobs`);
  }
  
  lastActiveCount = activeNodes.length;
}

// Initial check
checkRecovery();

// Monitor every 15 seconds
const monitor = setInterval(() => {
  checkRecovery();
}, 15000);

// Auto-stop after 20 minutes
setTimeout(() => {
  console.log('\n⏰ Monitor timeout reached (20 minutes)');
  console.log('If no recovery detected, manual intervention may be needed');
  clearInterval(monitor);
  db.close();
  process.exit(0);
}, 20 * 60 * 1000);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Monitor stopped');
  clearInterval(monitor);
  db.close();
  process.exit(0);
});

console.log('📡 Monitoring every 15 seconds... (Ctrl+C to stop)');