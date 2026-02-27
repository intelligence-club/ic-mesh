#!/usr/bin/env node

const Database = require('better-sqlite3');
const db = new Database('data/mesh.db');

console.log('\n🔧 DATABASE HEALTH CHECK');
console.log('=============================');

// Check for jobs claimed by offline nodes (stuck jobs)
const stuckJobs = db.prepare(`
  SELECT j.jobId, j.type, j.claimedBy, j.status,
         datetime(j.claimedAt/1000, 'unixepoch') as claimedAtHuman,
         ROUND((julianday('now') - julianday(j.claimedAt/1000, 'unixepoch')) * 24 * 60) as minutesClaimed,
         n.name as nodeName,
         ROUND((julianday('now') - julianday(n.lastSeen/1000, 'unixepoch')) * 24 * 60) as nodeOfflineMinutes
  FROM jobs j
  LEFT JOIN nodes n ON j.claimedBy = n.nodeId
  WHERE j.status = 'claimed' 
  AND (n.nodeId IS NULL OR datetime(n.lastSeen/1000, 'unixepoch') < datetime('now', '-5 minutes'))
  ORDER BY j.claimedAt ASC
`).all();

console.log('\n🚫 STUCK JOBS (claimed by offline nodes):');
if (stuckJobs.length === 0) {
  console.log('  ✅ No stuck jobs found');
} else {
  console.log(`  ⚠️  Found ${stuckJobs.length} stuck jobs:`);
  stuckJobs.forEach(job => {
    console.log(`    ${job.jobId.slice(0,8)}: ${job.type} claimed by ${job.claimedBy.slice(0,8)} (${job.nodeName || 'unknown'}) ${job.minutesClaimed}min ago`);
    console.log(`      Node offline: ${job.nodeOfflineMinutes}min`);
  });
  
  console.log('\n🔄 RELEASING STUCK JOBS...');
  const released = db.prepare(`
    UPDATE jobs 
    SET status = 'pending', claimedBy = NULL, claimedAt = NULL 
    WHERE status = 'claimed' 
    AND claimedBy IN (
      SELECT j.claimedBy FROM jobs j
      LEFT JOIN nodes n ON j.claimedBy = n.nodeId
      WHERE j.status = 'claimed' 
      AND (n.nodeId IS NULL OR datetime(n.lastSeen/1000, 'unixepoch') < datetime('now', '-5 minutes'))
    )
  `);
  
  const result = released.run();
  console.log(`  ✅ Released ${result.changes} stuck jobs back to pending status`);
}

// Check for duplicate pending jobs or other anomalies
const duplicateCheck = db.prepare(`
  SELECT type, payload, COUNT(*) as count
  FROM jobs
  WHERE status = 'pending'
  GROUP BY type, payload
  HAVING COUNT(*) > 1
  ORDER BY count DESC
`).all();

console.log('\n🔍 DUPLICATE JOB CHECK:');
if (duplicateCheck.length === 0) {
  console.log('  ✅ No duplicate jobs detected');
} else {
  console.log(`  ⚠️  Found ${duplicateCheck.length} sets of duplicate jobs:`);
  duplicateCheck.forEach(dup => {
    console.log(`    ${dup.type}: ${dup.count} identical jobs`);
  });
}

// Check node heartbeat status
const nodeHeartbeats = db.prepare(`
  SELECT nodeId, name,
         datetime(lastSeen/1000, 'unixepoch') as lastSeenHuman,
         ROUND((julianday('now') - julianday(lastSeen/1000, 'unixepoch')) * 24 * 60) as minutesOffline,
         capabilities
  FROM nodes
  ORDER BY lastSeen DESC
`).all();

console.log('\n💗 NODE HEARTBEAT STATUS:');
nodeHeartbeats.forEach(node => {
  const status = node.minutesOffline < 5 ? '🟢' : node.minutesOffline < 60 ? '🟡' : '🔴';
  console.log(`  ${status} ${node.nodeId.slice(0,8)} (${node.name || 'unnamed'}): ${node.minutesOffline}min offline [${node.capabilities}]`);
});

// Check for corrupted timestamps
const corruptedTimestamps = db.prepare(`
  SELECT 'jobs' as table_name, COUNT(*) as count
  FROM jobs 
  WHERE createdAt < 1000000000000 OR createdAt > 9999999999999
  UNION ALL
  SELECT 'nodes' as table_name, COUNT(*) as count
  FROM nodes 
  WHERE lastSeen < 1000000000000 OR lastSeen > 9999999999999
`).all();

console.log('\n⚠️  TIMESTAMP CORRUPTION CHECK:');
const totalCorrupted = corruptedTimestamps.reduce((sum, row) => sum + row.count, 0);
if (totalCorrupted === 0) {
  console.log('  ✅ All timestamps valid');
} else {
  corruptedTimestamps.forEach(row => {
    if (row.count > 0) {
      console.log(`  🔴 ${row.table_name}: ${row.count} corrupted timestamps`);
    }
  });
}

console.log('\n✅ DATABASE HEALTH CHECK COMPLETE');

db.close();