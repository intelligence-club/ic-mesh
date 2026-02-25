#!/usr/bin/env node

const Database = require('better-sqlite3');
const db = new Database('./mesh.db');

// Get job statistics
const stats = {
  total: db.prepare('SELECT COUNT(*) as count FROM jobs').get().count,
  pending: db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'pending'").get().count,
  completed: db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'completed'").get().count,
  failed: db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'failed'").get().count
};

console.log('📊 Job Statistics:');
console.log(`Total: ${stats.total}`);
console.log(`Pending: ${stats.pending}`);  
console.log(`Completed: ${stats.completed}`);
console.log(`Failed: ${stats.failed}`);

// Check for old pending jobs (older than 1 hour)
const oneHourAgo = Date.now() - (60 * 60 * 1000);
const oldJobs = db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'pending' AND createdAt < ?").get(oneHourAgo);

console.log(`\n🕐 Old pending jobs (>1h): ${oldJobs.count}`);

if (oldJobs.count > 0) {
  console.log('\n🧹 Cleaning up old pending jobs...');
  
  // Mark old pending jobs as 'expired'
  const result = db.prepare("UPDATE jobs SET status = 'expired' WHERE status = 'pending' AND createdAt < ?").run(oneHourAgo);
  console.log(`✅ Cleaned up ${result.changes} expired jobs`);
  
  // Get updated stats
  const newStats = {
    pending: db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'pending'").get().count,
    expired: db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'expired'").get().count
  };
  
  console.log(`\n📊 After cleanup:`);
  console.log(`Pending: ${newStats.pending}`);
  console.log(`Expired: ${newStats.expired}`);
}

db.close();