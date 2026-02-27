#!/usr/bin/env node

// Clean up duplicate pending jobs to improve queue health
const Database = require('better-sqlite3');
const db = new Database('data/mesh.db');

console.log('\n🧹 DUPLICATE JOB CLEANUP');
console.log('===========================');

// Find duplicate jobs (same type and payload)
const duplicates = db.prepare(`
  SELECT 
    type, 
    payload, 
    GROUP_CONCAT(jobId) as jobIds,
    COUNT(*) as count
  FROM jobs 
  WHERE status = 'pending'
  GROUP BY type, payload
  HAVING COUNT(*) > 1
  ORDER BY count DESC
`).all();

console.log(`\nFound ${duplicates.length} sets of duplicate jobs:`);

let totalRemoved = 0;

duplicates.forEach(dup => {
  console.log(`\n📋 ${dup.type}: ${dup.count} duplicate jobs`);
  
  const jobIds = dup.jobIds.split(',');
  const keepJob = jobIds[0]; // Keep the first one (oldest)
  const removeJobs = jobIds.slice(1); // Remove the rest
  
  console.log(`   Keeping: ${keepJob.slice(0,8)}`);
  console.log(`   Removing: ${removeJobs.map(id => id.slice(0,8)).join(', ')}`);
  
  // Remove duplicates
  removeJobs.forEach(jobId => {
    const result = db.prepare('DELETE FROM jobs WHERE jobId = ?').run(jobId);
    if (result.changes > 0) {
      totalRemoved++;
    }
  });
});

console.log(`\n✅ Cleanup complete: removed ${totalRemoved} duplicate jobs`);

// Show new job counts
const newCounts = db.prepare(`
  SELECT type, COUNT(*) as count 
  FROM jobs 
  WHERE status = 'pending' 
  GROUP BY type 
  ORDER BY count DESC
`).all();

console.log('\n📊 Updated pending job counts:');
newCounts.forEach(row => {
  console.log(`   ${row.type}: ${row.count} jobs`);
});

const totalPending = newCounts.reduce((sum, row) => sum + row.count, 0);
console.log(`\nTotal pending: ${totalPending} jobs (${totalRemoved} fewer than before)`);

db.close();