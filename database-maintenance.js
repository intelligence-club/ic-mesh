#!/usr/bin/env node
/**
 * IC Mesh Database Maintenance Suite
 * Consolidated tool for database cleanup, analysis, and maintenance
 */

const Database = require('better-sqlite3');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_PATH = process.env.DATABASE_PATH || path.join(DATA_DIR, 'mesh.db');

const command = process.argv[2];
const options = process.argv.slice(3);

if (!command) {
  console.log('🛠️  IC Mesh Database Maintenance Suite');
  console.log('');
  console.log('Usage: node database-maintenance.js <command> [options]');
  console.log('');
  console.log('Commands:');
  console.log('  status          - Show database status and health metrics');
  console.log('  cleanup-old     - Remove old failed jobs (>30 days)');
  console.log('  cleanup-orphans - Remove orphaned/abandoned jobs');
  console.log('  fix-timestamps  - Fix corrupted timestamps');
  console.log('  vacuum          - Optimize database (VACUUM)');
  console.log('  analyze         - Update SQLite statistics');
  console.log('  full-maintenance - Run all maintenance operations');
  console.log('');
  console.log('Examples:');
  console.log('  node database-maintenance.js status');
  console.log('  node database-maintenance.js cleanup-old');
  console.log('  node database-maintenance.js full-maintenance');
  process.exit(1);
}

console.log('🛠️  IC Mesh Database Maintenance Suite');
console.log(`Database: ${DB_PATH}`);
console.log('');

const db = new Database(DB_PATH);

async function showStatus() {
  console.log('📊 Database Status:');
  
  // Job statistics
  const jobStats = db.prepare('SELECT status, COUNT(*) as count FROM jobs GROUP BY status ORDER BY count DESC').all();
  console.log('  Jobs by status:');
  jobStats.forEach(row => console.log(`    ${row.status}: ${row.count}`));
  
  const totalJobs = jobStats.reduce((sum, row) => sum + row.count, 0);
  const completedJobs = jobStats.find(row => row.status === 'completed')?.count || 0;
  const successRate = totalJobs > 0 ? Math.round(100 * completedJobs / totalJobs) : 0;
  console.log(`  Overall success rate: ${successRate}% (${completedJobs}/${totalJobs})`);
  
  // Node statistics
  const nodeStats = db.prepare(`
    SELECT COUNT(*) as total,
           COUNT(CASE WHEN (strftime('%s','now') - lastSeen) < 300 THEN 1 END) as active
    FROM nodes
  `).get();
  console.log(`  Nodes: ${nodeStats.active}/${nodeStats.total} active (last 5 min)`);
  
  // Database file size
  try {
    const fs = require('fs');
    const stats = fs.statSync(DB_PATH);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
    console.log(`  Database size: ${sizeMB} MB`);
  } catch (e) {
    console.log(`  Database size: Unable to determine`);
  }
  
  // Check for issues
  console.log('\\n🔍 Health Checks:');
  
  const currentTime = Math.floor(Date.now() / 1000);
  const corruptedJobs = db.prepare('SELECT COUNT(*) as count FROM jobs WHERE createdAt > ? OR createdAt < ?').get(currentTime * 2, 1600000000);
  console.log(`  Corrupted timestamps: ${corruptedJobs.count} jobs`);
  
  const oldFailures = db.prepare('SELECT COUNT(*) as count FROM jobs WHERE status = ? AND createdAt < ?').get('failed', currentTime - (30 * 24 * 60 * 60));
  console.log(`  Old failed jobs: ${oldFailures.count} (>30 days)`);
  
  const stuckJobs = db.prepare('SELECT COUNT(*) as count FROM jobs WHERE status = ? AND createdAt < ?').get('pending', currentTime - (24 * 60 * 60));
  console.log(`  Stuck pending jobs: ${stuckJobs.count} (>24 hours)`);
}

async function cleanupOld() {
  console.log('🧹 Cleaning up old failed jobs...');
  
  const currentTime = Math.floor(Date.now() / 1000);
  const thirtyDaysAgo = currentTime - (30 * 24 * 60 * 60);
  
  const result = db.prepare('DELETE FROM jobs WHERE status = ? AND createdAt < ?').run('failed', thirtyDaysAgo);
  console.log(`  Removed ${result.changes} old failed jobs (>30 days)`);
}

async function cleanupOrphans() {
  console.log('🧹 Cleaning up orphaned jobs...');
  
  const currentTime = Math.floor(Date.now() / 1000);
  const oneDayAgo = currentTime - (24 * 60 * 60);
  
  // Remove pending jobs older than 24 hours (likely abandoned)
  const pendingResult = db.prepare('DELETE FROM jobs WHERE status = ? AND createdAt < ?').run('pending', oneDayAgo);
  console.log(`  Removed ${pendingResult.changes} stuck pending jobs (>24 hours)`);
  
  // Remove claimed jobs older than 2 hours with no progress (likely node died)
  const twoHoursAgo = currentTime - (2 * 60 * 60);
  const claimedResult = db.prepare('DELETE FROM jobs WHERE status = ? AND claimedAt < ?').run('claimed', twoHoursAgo);
  console.log(`  Removed ${claimedResult.changes} stale claimed jobs (>2 hours)`);
}

async function fixTimestamps() {
  console.log('🔧 Fixing corrupted timestamps...');
  
  const currentTime = Math.floor(Date.now() / 1000);
  const recentTime = currentTime - (7 * 24 * 60 * 60); // 7 days ago
  
  // Fix jobs with corrupted timestamps
  const jobResult = db.prepare('UPDATE jobs SET createdAt = ? WHERE createdAt > ? OR createdAt < ?').run(recentTime, currentTime * 2, 1600000000);
  console.log(`  Fixed ${jobResult.changes} job timestamps`);
  
  // Fix nodes with corrupted timestamps  
  const nodeResult = db.prepare('UPDATE nodes SET lastSeen = ? WHERE lastSeen > ? OR lastSeen < ?').run(recentTime, currentTime * 2, 1600000000);
  console.log(`  Fixed ${nodeResult.changes} node timestamps`);
}

async function vacuum() {
  console.log('📦 Optimizing database (VACUUM)...');
  
  const beforeQuery = db.prepare('PRAGMA page_count').get();
  db.exec('VACUUM');
  const afterQuery = db.prepare('PRAGMA page_count').get();
  
  const pagesSaved = beforeQuery.page_count - afterQuery.page_count;
  console.log(`  Optimized: ${pagesSaved} pages reclaimed`);
}

async function analyze() {
  console.log('📈 Updating database statistics...');
  
  db.exec('ANALYZE');
  console.log(`  Statistics updated for query optimization`);
}

async function fullMaintenance() {
  console.log('🔄 Running full database maintenance...');
  console.log('');
  
  await showStatus();
  console.log('');
  await fixTimestamps();
  await cleanupOld();
  await cleanupOrphans();
  await analyze();
  await vacuum();
  
  console.log('');
  console.log('✅ Full maintenance completed');
  await showStatus();
}

// Execute command
(async () => {
  try {
    db.exec('BEGIN TRANSACTION;');
    
    switch (command) {
      case 'status':
        await showStatus();
        db.exec('ROLLBACK;'); // Read-only operation
        break;
      case 'cleanup-old':
        await cleanupOld();
        break;
      case 'cleanup-orphans':
        await cleanupOrphans();
        break;
      case 'fix-timestamps':
        await fixTimestamps();
        break;
      case 'vacuum':
        db.exec('ROLLBACK;'); // VACUUM cannot run in transaction
        await vacuum();
        db.close();
        return;
      case 'analyze':
        await analyze();
        break;
      case 'full-maintenance':
        await fullMaintenance();
        break;
      default:
        console.log(`❌ Unknown command: ${command}`);
        process.exit(1);
    }
    
    if (command !== 'status') {
      db.exec('COMMIT;');
      console.log('');
      console.log('✅ Maintenance completed successfully');
    }
    
  } catch (error) {
    db.exec('ROLLBACK;');
    console.error('❌ Error during maintenance:', error.message);
    process.exit(1);
  } finally {
    db.close();
  }
})();