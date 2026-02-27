#!/usr/bin/env node

const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '../data/mesh.db');
const db = new Database(dbPath);

console.log('🔧 Fixing stuck jobs...\n');

// Find jobs that have been claimed for more than 10 minutes (should have completed by now)
const now = Date.now();
const tenMinutesAgo = now - (10 * 60 * 1000);

console.log('Current timestamp:', now);
console.log('Looking for jobs claimed before:', tenMinutesAgo);

// Check current claimed jobs
const claimedJobs = db.prepare("SELECT jobId, type, claimedAt, claimedBy FROM jobs WHERE status = 'claimed'").all();
console.log(`Found ${claimedJobs.length} claimed jobs:`);

let fixedCount = 0;

claimedJobs.forEach(job => {
  console.log(`  ${job.jobId.slice(0,8)}... (${job.type}) - claimedAt: ${job.claimedAt}`);
  
  // If claimedAt is null, very old, or invalid format, consider it stuck
  if (!job.claimedAt || job.claimedAt < tenMinutesAgo || job.claimedAt > now) {
    console.log(`    🚨 Stuck job detected - resetting to pending`);
    
    // Reset to pending
    const resetStmt = db.prepare("UPDATE jobs SET status = 'pending', claimedBy = NULL, claimedAt = NULL WHERE jobId = ?");
    resetStmt.run(job.jobId);
    fixedCount++;
  }
});

console.log(`\n✅ Fixed ${fixedCount} stuck jobs`);

// Show updated status
const updatedStatus = db.prepare("SELECT status, COUNT(*) as count FROM jobs GROUP BY status").all();
console.log('\nUpdated job status:');
updatedStatus.forEach(row => console.log(`  ${row.status}: ${row.count}`));

db.close();
console.log('\n🎯 Job queue optimization complete!');