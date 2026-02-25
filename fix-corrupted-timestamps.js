#!/usr/bin/env node
/**
 * Fix corrupted timestamps in IC Mesh database
 * Addresses invalid dates showing year 58123+ and negative time calculations
 */

const Database = require('better-sqlite3');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_PATH = process.env.DATABASE_PATH || path.join(DATA_DIR, 'mesh.db');

console.log('🔧 IC Mesh Database Timestamp Cleanup');
console.log(`Database: ${DB_PATH}`);
console.log('');

const db = new Database(DB_PATH);

// Begin transaction
db.exec('BEGIN TRANSACTION;');

try {
  const currentTime = Math.floor(Date.now() / 1000);
  const recentTime = currentTime - (7 * 24 * 60 * 60); // 7 days ago
  
  // 1. Find and fix corrupted job timestamps
  console.log('1. Checking job timestamps...');
  const corruptedJobs = db.prepare('SELECT jobId, createdAt FROM jobs WHERE createdAt > ? OR createdAt < ?').all(currentTime * 2, 1600000000); // After 2x current time or before 2020
  
  if (corruptedJobs.length > 0) {
    console.log(`   Found ${corruptedJobs.length} corrupted job timestamps`);
    
    // Delete jobs with corrupted timestamps that are pending (can't be fixed reliably)
    const deletedPending = db.prepare('DELETE FROM jobs WHERE (createdAt > ? OR createdAt < ?) AND status = ?').run(currentTime * 2, 1600000000, 'pending');
    console.log(`   Deleted ${deletedPending.changes} pending jobs with corrupted timestamps`);
    
    // Fix completed/failed jobs by setting reasonable timestamp (1 week ago)
    const fixedOther = db.prepare('UPDATE jobs SET createdAt = ? WHERE (createdAt > ? OR createdAt < ?) AND status != ?').run(recentTime, currentTime * 2, 1600000000, 'pending');
    console.log(`   Fixed ${fixedOther.changes} completed/failed job timestamps`);
  } else {
    console.log('   ✅ All job timestamps are valid');
  }
  
  // 2. Find and fix corrupted node timestamps
  console.log('\n2. Checking node timestamps...');
  const corruptedNodes = db.prepare('SELECT nodeId, name, lastSeen FROM nodes WHERE lastSeen > ? OR lastSeen < ?').all(currentTime * 2, 1600000000);
  
  if (corruptedNodes.length > 0) {
    console.log(`   Found ${corruptedNodes.length} corrupted node timestamps`);
    
    // Fix node timestamps to recent time (they were probably active recently)
    const fixedNodes = db.prepare('UPDATE nodes SET lastSeen = ? WHERE lastSeen > ? OR lastSeen < ?').run(recentTime, currentTime * 2, 1600000000);
    console.log(`   Fixed ${fixedNodes.changes} node timestamps`);
  } else {
    console.log('   ✅ All node timestamps are valid');
  }
  
  // 3. Clean up old failed jobs (keep only recent failures for debugging)
  console.log('\n3. Cleaning up old failed jobs...');
  const oldFailures = db.prepare('DELETE FROM jobs WHERE status = ? AND createdAt < ?').run('failed', currentTime - (30 * 24 * 60 * 60)); // Delete failures older than 30 days
  console.log(`   Removed ${oldFailures.changes} old failed jobs (>30 days)`);
  
  // 4. Summary after cleanup
  console.log('\n📊 Database Summary After Cleanup:');
  const jobSummary = db.prepare('SELECT status, COUNT(*) as count FROM jobs GROUP BY status').all();
  jobSummary.forEach(row => console.log(`   ${row.status}: ${row.count} jobs`));
  
  const activePlans = db.prepare('SELECT COUNT(*) as count FROM nodes WHERE lastSeen > ?').get(currentTime - 300); // 5 minutes
  console.log(`   Active nodes: ${activePlans.count}`);
  
  // Commit transaction
  db.exec('COMMIT;');
  console.log('\n✅ Database cleanup completed successfully');
  
} catch (error) {
  // Rollback on error
  db.exec('ROLLBACK;');
  console.error('\n❌ Error during cleanup:', error.message);
  process.exit(1);
} finally {
  db.close();
}