#!/usr/bin/env node

const Database = require('better-sqlite3');
const db = new Database('data/mesh.db');

console.log('\n📊 IC MESH STATUS REPORT');
console.log('=====================================');

// Get pending jobs by type
const pendingByType = db.prepare(`
  SELECT type, COUNT(*) as count 
  FROM jobs 
  WHERE status = 'pending' 
  GROUP BY type 
  ORDER BY count DESC
`).all();

console.log('\n🔄 PENDING JOBS BY TYPE:');
if (pendingByType.length === 0) {
  console.log('  ✅ NO PENDING JOBS');
} else {
  pendingByType.forEach(row => {
    console.log(`  ${row.type}: ${row.count} jobs`);
  });
}

// Get active nodes (last 5 minutes)
const activeNodes = db.prepare(`
  SELECT nodeId, name, capabilities, lastSeen,
         datetime(lastSeen/1000, 'unixepoch') as lastSeenHuman
  FROM nodes 
  WHERE datetime(lastSeen/1000, 'unixepoch') > datetime('now', '-5 minutes')
  ORDER BY lastSeen DESC
`).all();

console.log('\n🟢 ACTIVE NODES (last 5 min):');
if (activeNodes.length === 0) {
  console.log('  ❌ NO ACTIVE NODES - COMPLETE SERVICE OUTAGE');
} else {
  activeNodes.forEach(node => {
    console.log(`  ${node.nodeId.slice(0,8)} (${node.name || 'unnamed'}): ${node.capabilities} [${node.lastSeenHuman}]`);
  });
}

// Get all registered nodes with offline status
const allNodes = db.prepare(`
  SELECT nodeId, name, capabilities, lastSeen,
         datetime(lastSeen/1000, 'unixepoch') as lastSeenHuman,
         ROUND((julianday('now') - julianday(lastSeen/1000, 'unixepoch')) * 24 * 60) as minutesAgo
  FROM nodes 
  ORDER BY lastSeen DESC
`).all();

console.log('\n📋 ALL REGISTERED NODES:');
allNodes.forEach(node => {
  const status = node.minutesAgo < 5 ? '🟢' : node.minutesAgo < 60 ? '🟡' : '🔴';
  const capabilities = node.capabilities || '[]';
  console.log(`  ${status} ${node.nodeId.slice(0,8)} (${node.name || 'unnamed'}): ${node.minutesAgo}min ago [${capabilities}]`);
});

// Get most recent pending jobs details
if (pendingByType.length > 0) {
  console.log('\n🔍 RECENT PENDING JOBS (last 10):');
  const recentPending = db.prepare(`
    SELECT jobId, type, requester, datetime(createdAt/1000, 'unixepoch') as created
    FROM jobs 
    WHERE status = 'pending'
    ORDER BY createdAt DESC
    LIMIT 10
  `).all();
  
  recentPending.forEach(job => {
    console.log(`  ${job.jobId.slice(0,8)}: ${job.type} (${job.requester}) [${job.created}]`);
  });
}

// Check for recent failures
const recentFailed = db.prepare(`
  SELECT COUNT(*) as count 
  FROM jobs 
  WHERE status = 'failed' AND datetime(completedAt/1000, 'unixepoch') > datetime('now', '-1 hour')
`).get();

if (recentFailed.count > 0) {
  console.log(`\n⚠️  ${recentFailed.count} JOBS FAILED IN LAST HOUR`);
}

// System health summary
const totalJobs = db.prepare("SELECT COUNT(*) as count FROM jobs").get();
const completedJobs = db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'completed'").get();
const successRate = totalJobs.count > 0 ? ((completedJobs.count / totalJobs.count) * 100).toFixed(1) : 0;

console.log('\n🎯 HEALTH SUMMARY:');
console.log(`  Active nodes: ${activeNodes.length}/${allNodes.length}`);
console.log(`  Pending jobs: ${pendingByType.reduce((sum, p) => sum + p.count, 0)}`);
console.log(`  Success rate: ${successRate}% (${completedJobs.count}/${totalJobs.count})`);

if (activeNodes.length === 0) {
  console.log('\n🚨 CRITICAL: Complete service outage - no compute capacity available');
  console.log('   Action needed: Contact node operators or wait for auto-reconnection');
}

db.close();