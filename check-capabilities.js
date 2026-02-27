#!/usr/bin/env node

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'mesh.db');
const db = new sqlite3.Database(dbPath);

console.log('🔍 Checking node capabilities and job types...\n');

// Check active nodes and their capabilities
db.all(
  `SELECT nodeId, name, capabilities, lastHeartbeat 
   FROM nodes 
   ORDER BY lastHeartbeat DESC`,
  (err, nodes) => {
    if (err) {
      console.error('Error querying nodes:', err);
      return;
    }
    
    console.log('📋 Nodes and capabilities:');
    const now = Date.now();
    
    nodes.forEach(node => {
      const capabilities = JSON.parse(node.capabilities || '[]');
      const lastSeen = node.lastHeartbeat;
      const minutesAgo = Math.round((now - lastSeen) / (1000 * 60));
      
      const status = minutesAgo < 5 ? '🟢' : minutesAgo < 60 ? '🟡' : '🔴';
      
      console.log(`${status} ${node.name} (${node.nodeId.substring(0,8)}): ${capabilities.join(', ')} (${minutesAgo}m ago)`);
    });
    
    console.log('\n🔍 Pending job types:');
    
    // Check pending job types
    db.all(
      `SELECT type, COUNT(*) as count 
       FROM jobs 
       WHERE status = 'pending' 
       GROUP BY type`,
      (err, jobs) => {
        if (err) {
          console.error('Error querying jobs:', err);
        } else {
          jobs.forEach(job => {
            console.log(`📋 ${job.type}: ${job.count} jobs`);
          });
        }
        
        db.close();
      }
    );
  }
);