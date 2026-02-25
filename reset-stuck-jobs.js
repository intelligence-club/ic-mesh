#!/usr/bin/env node
const Database = require('better-sqlite3');
const db = new Database('./data/mesh.db');

console.log('🔄 Checking for stuck claimed jobs...\n');

// Find jobs claimed more than 2 minutes ago (transcription should be faster)
const stuckThresholdMs = 2 * 60 * 1000; // 2 minutes
const cutoffTime = Date.now() - stuckThresholdMs;

const stuckJobs = db.prepare(`
  SELECT jobId, type, claimedBy, 
         datetime(claimedAt/1000, 'unixepoch') as claimed_time,
         claimedAt
  FROM jobs 
  WHERE status = 'claimed' 
  AND claimedAt < ?
  ORDER BY claimedAt ASC
`).all(cutoffTime);

if (stuckJobs.length === 0) {
  console.log('✅ No stuck jobs found');
  process.exit(0);
}

console.log(`⚠️  Found ${stuckJobs.length} stuck job(s):`);
stuckJobs.forEach(job => {
  const minutesStuck = Math.floor((Date.now() - job.claimedAt) / 60000);
  console.log(`  ${job.jobId.substring(0, 8)} (${job.type}) by ${job.claimedBy.substring(0, 8)} - stuck for ${minutesStuck}m`);
});

const isDryRun = process.argv.includes('--dry-run');

if (isDryRun) {
  console.log('\n🔍 DRY RUN - No changes made. Use without --dry-run to reset these jobs.');
  process.exit(0);
}

// Reset stuck jobs to pending
console.log('\n🔄 Resetting stuck jobs to pending...');

const resetStmt = db.prepare(`
  UPDATE jobs 
  SET status = 'pending', claimedBy = NULL, claimedAt = NULL 
  WHERE status = 'claimed' AND claimedAt < ?
`);

const result = resetStmt.run(cutoffTime);
console.log(`✅ Reset ${result.changes} stuck job(s) to pending status`);

db.close();