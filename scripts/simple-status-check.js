#!/usr/bin/env node

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Get database path
const dbPath = path.join(__dirname, '../data/mesh.db');
const db = new sqlite3.Database(dbPath);

console.log('🔍 Simple IC Mesh Status Check');
console.log('════════════════════════════════════');

// Check server status via API
const checkServerStatus = async () => {
  try {
    const response = await fetch('http://localhost:8333/status');
    const status = await response.json();
    
    console.log('\n📊 Server Status:');
    console.log(`   WebSocket connections: ${status.websocket.connected}`);
    console.log(`   Active nodes: ${status.nodes.active}`);
    console.log(`   Registered nodes: ${status.nodes.total}`);
    console.log(`   Pending jobs: ${status.jobs.pending}`);
    console.log(`   Completed jobs: ${status.jobs.completed}`);
    
    return status;
  } catch (error) {
    console.log('\n❌ Server Status: Cannot connect to server');
    return null;
  }
};

// Check recent node activity
const checkRecentNodes = () => {
  return new Promise((resolve) => {
    const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
    const thirtyMinutesAgo = Date.now() - (30 * 60 * 1000);
    
    const query = `
      SELECT nodeId, name, capabilities, jobsCompleted, lastSeen,
             CASE 
               WHEN lastSeen > ? THEN 'active'
               WHEN lastSeen > ? THEN 'recent'
               ELSE 'offline'
             END as status,
             (? - lastSeen) / 60000 as minutes_ago
      FROM nodes 
      ORDER BY lastSeen DESC
    `;
    
    db.all(query, [fiveMinutesAgo, thirtyMinutesAgo, Date.now()], (err, rows) => {
      if (err) {
        console.log('❌ Database Error:', err.message);
        resolve([]);
        return;
      }
      
      console.log('\n🖥️  Node Status:');
      if (rows.length === 0) {
        console.log('   No nodes registered');
      } else {
        rows.forEach(node => {
          const capabilities = JSON.parse(node.capabilities || '[]');
          const status = node.status === 'active' ? '🟢' : 
                        node.status === 'recent' ? '🟡' : '🔴';
          const timeAgo = Math.round(node.minutes_ago);
          
          console.log(`   ${status} ${node.name || 'unnamed'} (${node.nodeId.substring(0, 8)}...)`);
          console.log(`      Last seen: ${timeAgo} minutes ago`);
          console.log(`      Jobs: ${node.jobsCompleted}, Capabilities: ${capabilities.join(', ')}`);
        });
      }
      
      resolve(rows);
    });
  });
};

// Main execution
const main = async () => {
  const serverStatus = await checkServerStatus();
  const nodes = await checkRecentNodes();
  
  console.log('\n💡 Summary:');
  if (serverStatus && serverStatus.websocket.connected === 0 && serverStatus.nodes.total > 0) {
    console.log('   🚨 All registered nodes are disconnected - need to reconnect');
    console.log('   💻 Nodes should run: claw skill mesh-transcribe');
  } else if (serverStatus && serverStatus.websocket.connected > 0) {
    console.log('   ✅ Some nodes are connected and processing jobs');
  }
  
  if (serverStatus && serverStatus.jobs.pending > 0) {
    console.log(`   📋 ${serverStatus.jobs.pending} jobs waiting for processing`);
  }
  
  db.close();
};

main().catch(console.error);