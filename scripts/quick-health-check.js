#!/usr/bin/env node
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '../data/mesh.db');
const db = new Database(dbPath);

try {
  console.log('🚀 IC Mesh Quick Health Check\n');

  // Job counts
  const pending = db.prepare('SELECT COUNT(*) as count FROM jobs WHERE status = ?').get('pending');
  const processing = db.prepare('SELECT COUNT(*) as count FROM jobs WHERE status = ?').get('claimed');
  const completed = db.prepare('SELECT COUNT(*) as count FROM jobs WHERE status = ?').get('completed');
  const failed = db.prepare('SELECT COUNT(*) as count FROM jobs WHERE status = ?').get('failed');
  
  console.log('📊 Queue Status:');
  console.log(`  Pending: ${pending.count} jobs`);
  console.log(`  Processing: ${processing.count} jobs`);
  console.log(`  Completed: ${completed.count} jobs`);
  console.log(`  Failed: ${failed.count} jobs`);

  // Node status
  const activeNodes = db.prepare('SELECT COUNT(*) as count FROM nodes WHERE lastSeen > ?').get(Date.now() - 300000);
  const totalNodes = db.prepare('SELECT COUNT(*) as count FROM nodes').get();
  
  console.log('\n🖥️  Node Status:');
  console.log(`  Active (5min): ${activeNodes.count}/${totalNodes.count} nodes`);

  if (activeNodes.count > 0) {
    const nodes = db.prepare('SELECT name, capabilities, lastSeen FROM nodes WHERE lastSeen > ? ORDER BY lastSeen DESC').all(Date.now() - 300000);
    nodes.forEach(node => {
      const minsAgo = Math.floor((Date.now() - node.lastSeen) / 60000);
      const caps = JSON.parse(node.capabilities || '[]');
      console.log(`  • ${node.name}: [${caps.join(', ')}] (${minsAgo}m ago)`);
    });
  }

  // Job type breakdown
  if (pending.count > 0) {
    console.log('\n📝 Pending Jobs by Type:');
    const jobTypes = db.prepare('SELECT type, COUNT(*) as count FROM jobs WHERE status = ? GROUP BY type ORDER BY count DESC').all('pending');
    jobTypes.forEach(jt => console.log(`  • ${jt.type}: ${jt.count} jobs`));
  }

  // Health assessment
  console.log('\n🏥 Health Assessment:');
  
  if (activeNodes.count === 0) {
    console.log('  🔴 CRITICAL: No active nodes');
  } else if (pending.count > 20) {
    console.log('  🟡 WARNING: High job backlog');
  } else if (pending.count > 0 && processing.count === 0) {
    console.log('  🟡 WARNING: Jobs pending but none processing');
  } else {
    console.log('  ✅ HEALTHY: System operational');
  }

} catch (error) {
  console.error('❌ Error:', error.message);
} finally {
  db.close();
}