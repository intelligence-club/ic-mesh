#!/usr/bin/env node

const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '../data/mesh.db');
const db = new Database(dbPath);

// Check for jobs claimed more than 10 minutes ago
const tenMinutesAgo = Date.now() - (10 * 60 * 1000);

console.log('🔍 Checking for stuck claimed jobs...');

const stuckJobs = db.prepare(`
  SELECT jobId, type, claimedBy, claimedAt
  FROM jobs 
  WHERE status = 'claimed' 
  AND claimedAt < ?
`).all(tenMinutesAgo);

console.log(`Found ${stuckJobs.length} jobs claimed more than 10 minutes ago`);

if (stuckJobs.length > 0) {
  console.log('\n🔧 Resetting stuck jobs to pending...');
  
  const resetStmt = db.prepare(`
    UPDATE jobs 
    SET status = 'pending', claimedBy = NULL, claimedAt = NULL 
    WHERE jobId = ?
  `);
  
  stuckJobs.forEach(job => {
    resetStmt.run(job.jobId);
    console.log(`  Reset ${job.jobId.slice(0,8)}... (${job.type})`);
  });
  
  console.log(`\n✅ Reset ${stuckJobs.length} stuck jobs to pending status`);
} else {
  console.log('✅ No stuck jobs found');
}

// Show current status
console.log('\n📊 Updated Job Status:');
const statusCounts = db.prepare(`
  SELECT status, COUNT(*) as count 
  FROM jobs 
  GROUP BY status 
  ORDER BY count DESC
`).all();

statusCounts.forEach(row => {
  console.log(`  ${row.status}: ${row.count}`);
});

db.close();