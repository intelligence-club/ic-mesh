#!/usr/bin/env node

const Database = require('better-sqlite3');
const db = new Database('./data/mesh.db', { readonly: false });

// Get job statistics
const stats = {
  total: db.prepare('SELECT COUNT(*) as count FROM jobs').get().count,
  pending: db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'pending'").get().count,
  completed: db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'completed'").get().count,
  failed: db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'failed'").get().count
};

console.log('📊 Real Database Job Statistics:');
console.log(`Total: ${stats.total}`);
console.log(`Pending: ${stats.pending}`);  
console.log(`Completed: ${stats.completed}`);
console.log(`Failed: ${stats.failed}`);

// Check for old pending jobs (older than 24 hours - more conservative)
const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
const oldJobs = db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'pending' AND createdAt < ?").get(oneDayAgo);

console.log(`\n🕐 Old pending jobs (>24h): ${oldJobs.count}`);

// Sample some old jobs to see what they are
const sampleOldJobs = db.prepare("SELECT jobId, type, createdAt, status FROM jobs WHERE status = 'pending' AND createdAt < ? LIMIT 5").all(oneDayAgo);

if (sampleOldJobs.length > 0) {
  console.log('\n📋 Sample old jobs:');
  sampleOldJobs.forEach(job => {
    const age = Math.floor((Date.now() - job.createdAt) / (1000 * 60 * 60)); // hours
    console.log(`  ${job.jobId}: ${job.type} (${age}h old)`);
  });
}

if (oldJobs.count > 0) {
  console.log('\n🧹 Cleaning up old pending jobs...');
  
  // Mark old pending jobs as 'expired'
  const result = db.prepare("UPDATE jobs SET status = 'expired' WHERE status = 'pending' AND createdAt < ?").run(oneDayAgo);
  console.log(`✅ Cleaned up ${result.changes} expired jobs`);
  
  // Get updated stats
  const newStats = {
    pending: db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'pending'").get().count,
    expired: db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'expired'").get().count
  };
  
  console.log(`\n📊 After cleanup:`);
  console.log(`Pending: ${newStats.pending}`);
  console.log(`Expired: ${newStats.expired}`);
} else {
  console.log('\n✅ No cleanup needed - all pending jobs are recent');
}

db.close();