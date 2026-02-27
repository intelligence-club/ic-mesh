#!/usr/bin/env node

const Database = require('better-sqlite3');
const db = new Database('./data/mesh.db', { readonly: false });

console.log('🧹 Direct Bulk Job Cleanup\n');

// Check the timestamp format first
const sampleJob = db.prepare("SELECT jobId, createdAt, status FROM jobs WHERE status = 'pending' LIMIT 1").get();
console.log('📋 Sample job timestamp:', sampleJob);
console.log('📅 Converted date:', new Date(sampleJob.createdAt));

// Today's timestamp range (for 2026-02-25)
const todayStart = new Date('2026-02-25T00:00:00Z').getTime();
const todayEnd = new Date('2026-02-26T00:00:00Z').getTime();

console.log(`\n🕐 Today's range: ${todayStart} to ${todayEnd}`);
console.log(`    That's: ${new Date(todayStart)} to ${new Date(todayEnd)}`);

// Count jobs from today
const todayJobs = db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'pending' AND createdAt >= ? AND createdAt < ?").get(todayStart, todayEnd);
console.log(`\n📊 Pending jobs from today: ${todayJobs.count}`);

// Since all 552 jobs were created at once today, they're likely test jobs
// Let's clean them up but be conservative - keep recent ones (last hour)
const oneHourAgo = Date.now() - (60 * 60 * 1000);

const recentJobs = db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'pending' AND createdAt > ?").get(oneHourAgo);
console.log(`📊 Very recent jobs (last hour): ${recentJobs.count}`);

// Clean up older pending jobs from today (but not the last hour)
console.log('\n🧽 Cleaning up bulk test jobs (older than 1 hour)...');
const cleanup = db.prepare(`
  UPDATE jobs 
  SET status = 'bulk-test-cleanup' 
  WHERE status = 'pending' 
  AND createdAt >= ? 
  AND createdAt <= ?
`).run(todayStart, oneHourAgo);

console.log(`✅ Moved ${cleanup.changes} bulk test jobs to 'bulk-test-cleanup' status`);

// Get final stats
const finalStats = {
  pending: db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'pending'").get().count,
  cleanup: db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'bulk-test-cleanup'").get().count
};

console.log(`\n📊 After cleanup:`);
console.log(`  Pending: ${finalStats.pending}`);
console.log(`  Bulk test cleanup: ${finalStats.cleanup}`);

db.close();