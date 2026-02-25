#!/usr/bin/env node
/**
 * IC Mesh Problematic Node Manager
 * Flags, quarantines, or removes problematic nodes based on performance
 */

const Database = require('better-sqlite3');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_PATH = process.env.DATABASE_PATH || path.join(DATA_DIR, 'mesh.db');

const action = process.argv[2];
const nodeIdPattern = process.argv[3];

if (!action || !['analyze', 'flag', 'unflag', 'quarantine', 'remove'].includes(action)) {
  console.log('Usage: node manage-problematic-nodes.js <action> [nodeId]');
  console.log('');
  console.log('Actions:');
  console.log('  analyze             - Show problematic nodes');
  console.log('  flag <nodeId>       - Flag node as problematic (add metadata)');
  console.log('  unflag <nodeId>     - Remove problematic flag');
  console.log('  quarantine <nodeId> - Prevent node from claiming new jobs');
  console.log('  remove <nodeId>     - Remove problematic node completely');
  console.log('');
  console.log('Example:');
  console.log('  node manage-problematic-nodes.js analyze');
  console.log('  node manage-problematic-nodes.js flag fcecb481');
  process.exit(1);
}

console.log('🔧 IC Mesh Problematic Node Manager');
console.log('');

const db = new Database(DB_PATH);

// Extend nodes table to support flagging (if not exists)
try {
  db.exec(`
    ALTER TABLE nodes ADD COLUMN flags TEXT DEFAULT '{}';
  `);
  console.log('✅ Added flags column to nodes table');
} catch (e) {
  // Column probably already exists
}

if (action === 'analyze') {
  // Find problematic nodes based on success rate
  const problematicNodes = db.prepare(`
    SELECT 
      n.nodeId,
      n.name,
      n.owner,
      n.flags,
      COUNT(j.jobId) as totalJobs,
      SUM(CASE WHEN j.status = 'completed' THEN 1 ELSE 0 END) as completedJobs,
      SUM(CASE WHEN j.status = 'failed' THEN 1 ELSE 0 END) as failedJobs,
      ROUND(100.0 * SUM(CASE WHEN j.status = 'completed' THEN 1 ELSE 0 END) / NULLIF(COUNT(j.jobId), 0), 1) as successRate
    FROM nodes n
    LEFT JOIN jobs j ON n.nodeId = j.claimedBy
    GROUP BY n.nodeId, n.name, n.owner, n.flags
    HAVING COUNT(j.jobId) > 5 AND (successRate < 60 OR successRate IS NULL)
    ORDER BY successRate ASC
  `).all();
  
  if (problematicNodes.length === 0) {
    console.log('✅ No problematic nodes found (all active nodes >60% success rate)');
  } else {
    console.log('⚠️  Problematic Nodes Detected:');
    console.log('');
    
    problematicNodes.forEach(node => {
      const flags = JSON.parse(node.flags || '{}');
      console.log(`📛 ${node.name} (${node.nodeId.slice(0, 8)})`);
      console.log(`   Owner: ${node.owner}`);
      console.log(`   Performance: ${node.completedJobs}/${node.totalJobs} (${node.successRate || 0}% success)`);
      console.log(`   Status: ${flags.problematic ? '🚫 FLAGGED' : '⚠️  Unflagged'}`);
      console.log(`   Quarantined: ${flags.quarantined ? '🔒 YES' : '🔓 NO'}`);
      
      if (flags.reason) console.log(`   Reason: ${flags.reason}`);
      if (flags.flaggedAt) console.log(`   Flagged: ${new Date(flags.flaggedAt).toISOString()}`);
      console.log('');
    });
    
    console.log('💡 Recommended Actions:');
    console.log('  1. Flag problematic nodes: node manage-problematic-nodes.js flag <nodeId>');
    console.log('  2. Quarantine to prevent new jobs: node manage-problematic-nodes.js quarantine <nodeId>');
    console.log('  3. Remove completely if unrecoverable: node manage-problematic-nodes.js remove <nodeId>');
  }
}

else if (action === 'flag' && nodeIdPattern) {
  const node = db.prepare('SELECT nodeId, name, flags FROM nodes WHERE nodeId LIKE ?').get(`${nodeIdPattern}%`);
  
  if (!node) {
    console.log(`❌ Node not found: ${nodeIdPattern}`);
    process.exit(1);
  }
  
  const flags = JSON.parse(node.flags || '{}');
  flags.problematic = true;
  flags.reason = 'Low success rate detected by automated analysis';
  flags.flaggedAt = new Date().toISOString();
  
  const updated = db.prepare('UPDATE nodes SET flags = ? WHERE nodeId = ?').run(JSON.stringify(flags), node.nodeId);
  
  if (updated.changes > 0) {
    console.log(`🚩 Flagged ${node.name} (${node.nodeId.slice(0, 8)}) as problematic`);
    console.log(`   Reason: ${flags.reason}`);
    console.log(`   Time: ${flags.flaggedAt}`);
  } else {
    console.log('❌ Failed to flag node');
  }
}

else if (action === 'unflag' && nodeIdPattern) {
  const node = db.prepare('SELECT nodeId, name, flags FROM nodes WHERE nodeId LIKE ?').get(`${nodeIdPattern}%`);
  
  if (!node) {
    console.log(`❌ Node not found: ${nodeIdPattern}`);
    process.exit(1);
  }
  
  const flags = JSON.parse(node.flags || '{}');
  delete flags.problematic;
  delete flags.reason;
  delete flags.flaggedAt;
  delete flags.quarantined;
  
  const updated = db.prepare('UPDATE nodes SET flags = ? WHERE nodeId = ?').run(JSON.stringify(flags), node.nodeId);
  
  if (updated.changes > 0) {
    console.log(`✅ Removed problematic flags from ${node.name} (${node.nodeId.slice(0, 8)})`);
  } else {
    console.log('❌ Failed to unflag node');
  }
}

else if (action === 'quarantine' && nodeIdPattern) {
  const node = db.prepare('SELECT nodeId, name, flags FROM nodes WHERE nodeId LIKE ?').get(`${nodeIdPattern}%`);
  
  if (!node) {
    console.log(`❌ Node not found: ${nodeIdPattern}`);
    process.exit(1);
  }
  
  const flags = JSON.parse(node.flags || '{}');
  flags.quarantined = true;
  flags.quarantinedAt = new Date().toISOString();
  
  const updated = db.prepare('UPDATE nodes SET flags = ? WHERE nodeId = ?').run(JSON.stringify(flags), node.nodeId);
  
  if (updated.changes > 0) {
    console.log(`🔒 Quarantined ${node.name} (${node.nodeId.slice(0, 8)})`);
    console.log(`   Node will be excluded from job assignment`);
    console.log(`   Time: ${flags.quarantinedAt}`);
  } else {
    console.log('❌ Failed to quarantine node');
  }
}

else if (action === 'remove' && nodeIdPattern) {
  const node = db.prepare('SELECT nodeId, name, owner FROM nodes WHERE nodeId LIKE ?').get(`${nodeIdPattern}%`);
  
  if (!node) {
    console.log(`❌ Node not found: ${nodeIdPattern}`);
    process.exit(1);
  }
  
  console.log(`⚠️  About to remove node: ${node.name} (${node.nodeId.slice(0, 8)}, owner: ${node.owner})`);
  console.log('This will:');
  console.log('  - Delete the node record');
  console.log('  - Preserve job history (jobs table unchanged)');
  console.log('  - Make the node unable to claim new jobs');
  console.log('');
  console.log('Type "CONFIRM" to proceed:');
  
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  
  let input = '';
  process.stdin.on('data', (key) => {
    if (key === '\r' || key === '\n') {
      if (input.trim() === 'CONFIRM') {
        const deleted = db.prepare('DELETE FROM nodes WHERE nodeId = ?').run(node.nodeId);
        if (deleted.changes > 0) {
          console.log(`\n🗑️  Removed node ${node.name} (${node.nodeId.slice(0, 8)})`);
          console.log('   Job history preserved in database');
        } else {
          console.log('\n❌ Failed to remove node');
        }
      } else {
        console.log('\n🚫 Removal cancelled');
      }
      process.exit(0);
    } else {
      input += key;
      process.stdout.write(key);
    }
  });
}

db.close();