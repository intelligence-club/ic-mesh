#!/usr/bin/env node

const Database = require('better-sqlite3');
const db = new Database('./data/mesh.db', { readonly: false });

console.log('🧹 Cleaning up old failed jobs...\n');

// Get failed job statistics
const failedStats = db.prepare(`
  SELECT 
    COUNT(*) as count,
    MIN(createdAt) as oldest,
    MAX(createdAt) as newest
  FROM jobs WHERE status = 'failed'
`).get();

console.log(`📊 Failed jobs: ${failedStats.count}`);
if (failedStats.count > 0) {
  console.log(`  Oldest: ${new Date(failedStats.oldest)}`);
  console.log(`  Newest: ${new Date(failedStats.newest)}`);
}

// Clean up failed jobs older than 6 hours (keep recent ones for debugging)
const sixHoursAgo = Date.now() - (6 * 60 * 60 * 1000);
const oldFailed = db.prepare('SELECT COUNT(*) as count FROM jobs WHERE status = ? AND createdAt < ?').get('failed', sixHoursAgo);

console.log(`\n🗑️  Old failed jobs (>6h): ${oldFailed.count}`);

if (oldFailed.count > 0) {
  const result = db.prepare('DELETE FROM jobs WHERE status = ? AND createdAt < ?').run('failed', sixHoursAgo);
  console.log(`✅ Deleted ${result.changes} old failed jobs`);
  
  const newStats = {
    total: db.prepare('SELECT COUNT(*) as count FROM jobs').get().count,
    failed: db.prepare('SELECT COUNT(*) as count FROM jobs WHERE status = ?').get('failed').count,
    completed: db.prepare('SELECT COUNT(*) as count FROM jobs WHERE status = ?').get('completed').count
  };
  
  console.log(`\n📊 Database after cleanup:`);
  console.log(`  Total jobs: ${newStats.total}`);
  console.log(`  Failed: ${newStats.failed}`);
  console.log(`  Completed: ${newStats.completed}`);
} else {
  console.log('✅ No old failed jobs to clean');
}

db.close();