#!/usr/bin/env node

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Configuration
const MONITOR_INTERVAL = 15000; // 15 seconds
const RECENT_THRESHOLD = 2 * 60 * 1000; // 2 minutes
const dbPath = path.join(__dirname, '../data/mesh.db');

let lastKnownActive = 0;
let monitoring = true;

console.log('🔍 IC Mesh Node Reconnection Monitor');
console.log('════════════════════════════════════════');
console.log(`⏰ Checking every ${MONITOR_INTERVAL/1000} seconds for node reconnections...`);
console.log('💡 Press Ctrl+C to stop monitoring\n');

const checkForReconnections = async () => {
  try {
    // Check server status
    const response = await fetch('http://localhost:8333/status');
    const serverStatus = await response.json();
    
    const currentActive = serverStatus.websocket.connected;
    
    // Detect changes in active node count
    if (currentActive !== lastKnownActive) {
      const timestamp = new Date().toISOString();
      
      if (currentActive > lastKnownActive) {
        console.log(`🟢 ${timestamp}: CAPACITY INCREASE! ${lastKnownActive} → ${currentActive} active nodes`);
        
        // Get detailed node information
        const db = new sqlite3.Database(dbPath);
        const recentThreshold = Date.now() - RECENT_THRESHOLD;
        
        db.all(
          `SELECT nodeId, name, capabilities, jobsCompleted, lastSeen 
           FROM nodes 
           WHERE lastSeen > ?
           ORDER BY lastSeen DESC`,
          [recentThreshold],
          (err, rows) => {
            if (err) {
              console.log('   ❌ Could not fetch node details:', err.message);
            } else {
              console.log('   📋 Recently active nodes:');
              rows.forEach(node => {
                const capabilities = JSON.parse(node.capabilities || '[]');
                const minutesAgo = Math.round((Date.now() - node.lastSeen) / 60000);
                console.log(`   • ${node.name || 'unnamed'} (${node.nodeId.substring(0, 8)}...)`);
                console.log(`     ${node.jobsCompleted} jobs completed, ${minutesAgo}m ago`);
                console.log(`     Capabilities: ${capabilities.join(', ')}`);
              });
            }
            
            console.log(`   🎯 Jobs pending: ${serverStatus.jobs.pending}`);
            console.log('   💻 Nodes can now claim and process jobs!');
            console.log('');
            
            db.close();
          }
        );
        
      } else if (currentActive < lastKnownActive) {
        console.log(`🔴 ${timestamp}: CAPACITY DECREASE: ${lastKnownActive} → ${currentActive} active nodes`);
        console.log(`   📋 Jobs pending: ${serverStatus.jobs.pending}`);
        console.log('');
      }
      
      lastKnownActive = currentActive;
    }
    
    // Show periodic status (every 5 minutes)
    if (Date.now() % (5 * 60 * 1000) < MONITOR_INTERVAL) {
      const timestamp = new Date().toISOString();
      console.log(`⏱️  ${timestamp}: ${currentActive} active nodes, ${serverStatus.jobs.pending} pending jobs`);
    }
    
  } catch (error) {
    console.log(`❌ ${new Date().toISOString()}: Monitoring error - ${error.message}`);
  }
};

// Initialize with current state
const initialize = async () => {
  try {
    const response = await fetch('http://localhost:8333/status');
    const serverStatus = await response.json();
    lastKnownActive = serverStatus.websocket.connected;
    
    console.log(`🎯 Initial state: ${lastKnownActive} active nodes, ${serverStatus.jobs.pending} pending jobs`);
    console.log('👀 Watching for changes...\n');
    
  } catch (error) {
    console.log('❌ Could not initialize - server may be down');
    process.exit(1);
  }
};

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Stopping monitor...');
  monitoring = false;
  process.exit(0);
});

// Main monitoring loop
const startMonitoring = async () => {
  await initialize();
  
  while (monitoring) {
    await checkForReconnections();
    await new Promise(resolve => setTimeout(resolve, MONITOR_INTERVAL));
  }
};

startMonitoring().catch(error => {
  console.error('❌ Monitor failed:', error);
  process.exit(1);
});