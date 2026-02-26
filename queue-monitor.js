#!/usr/bin/env node
/**
 * IC Mesh Queue Monitor
 * Real-time monitoring of job queue processing
 */

const Database = require('better-sqlite3');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_PATH = process.env.DATABASE_PATH || path.join(DATA_DIR, 'mesh.db');

const db = new Database(DB_PATH, { readonly: true });

// CLI arguments
const args = process.argv.slice(2);
const watchMode = args.includes('--watch');
const interval = args.includes('--interval') ? parseInt(args[args.indexOf('--interval') + 1]) || 10 : 10;
const compact = args.includes('--compact');

function getQueueStats() {
  const stats = {
    byStatus: {},
    byType: {},
    processing: {
      claimed: 0,
      oldestClaimed: null,
      nodeStats: {}
    },
    timestamp: new Date().toISOString()
  };
  
  // Status breakdown
  const statusRows = db.prepare(`
    SELECT status, COUNT(*) as count 
    FROM jobs 
    GROUP BY status
  `).all();
  
  statusRows.forEach(row => {
    stats.byStatus[row.status] = row.count;
  });
  
  // Type breakdown of pending jobs
  const typeRows = db.prepare(`
    SELECT type, COUNT(*) as count 
    FROM jobs 
    WHERE status = 'pending'
    GROUP BY type
  `).all();
  
  typeRows.forEach(row => {
    stats.byType[row.type] = row.count;
  });
  
  // Processing stats
  const claimedJobs = db.prepare(`
    SELECT 
      claimedBy,
      COUNT(*) as jobCount,
      MIN(claimedAt) as oldestClaim,
      MAX(claimedAt) as newestClaim
    FROM jobs 
    WHERE status = 'claimed'
    GROUP BY claimedBy
  `).all();
  
  claimedJobs.forEach(row => {
    if (row.claimedBy) {
      const nodeId = row.claimedBy.slice(0, 8);
      stats.processing.nodeStats[nodeId] = {
        processing: row.jobCount,
        oldestStarted: Math.round((Date.now() - row.oldestClaim) / 1000 / 60), // minutes ago
        newestStarted: Math.round((Date.now() - row.newestClaim) / 1000 / 60)
      };
      stats.processing.claimed += row.jobCount;
      
      if (!stats.processing.oldestClaimed || row.oldestClaim < stats.processing.oldestClaimed) {
        stats.processing.oldestClaimed = row.oldestClaim;
      }
    }
  });
  
  return stats;
}

function displayStats(stats) {
  if (!compact) {
    console.log(`📊 IC Mesh Queue Status - ${stats.timestamp.slice(11, 19)} UTC`);
    console.log(''.padEnd(50, '='));
  }
  
  // Status overview
  const total = Object.values(stats.byStatus).reduce((a, b) => a + b, 0);
  const pending = stats.byStatus.pending || 0;
  const claimed = stats.byStatus.claimed || 0;
  const completed = stats.byStatus.completed || 0;
  const failed = stats.byStatus.failed || 0;
  
  if (compact) {
    console.log(`${new Date().toLocaleTimeString()} | P:${pending} C:${claimed} ✅:${completed} ❌:${failed} | Total:${total}`);
  } else {
    console.log(`🔄 Queue Status (${total} total jobs):`);
    console.log(`   Pending:   ${pending.toString().padStart(3)} ${pending > 0 ? '⏳' : '✅'}`);
    console.log(`   Processing: ${claimed.toString().padStart(3)} ${claimed > 0 ? '🔥' : '💤'}`);
    console.log(`   Completed:  ${completed.toString().padStart(3)} ✅`);
    console.log(`   Failed:     ${failed.toString().padStart(3)} ${failed > 0 ? '❌' : '✅'}`);
    
    // Pending by type
    if (pending > 0 && Object.keys(stats.byType).length > 0) {
      console.log(`\n📋 Pending by Type:`);
      Object.entries(stats.byType).forEach(([type, count]) => {
        console.log(`   ${type}: ${count}`);
      });
    }
    
    // Processing details
    if (claimed > 0) {
      console.log(`\n🔥 Active Processing:`);
      Object.entries(stats.processing.nodeStats).forEach(([nodeId, nodeData]) => {
        console.log(`   ${nodeId}: ${nodeData.processing} jobs (oldest: ${nodeData.oldestStarted}m ago)`);
      });
    }
    
    console.log('');
  }
}

function monitor() {
  try {
    const stats = getQueueStats();
    displayStats(stats);
    
    if (watchMode) {
      setTimeout(monitor, interval * 1000);
    }
  } catch (error) {
    console.error('Error monitoring queue:', error.message);
    if (watchMode) {
      setTimeout(monitor, interval * 1000);
    }
  }
}

// Handle shutdown gracefully
if (watchMode) {
  process.on('SIGINT', () => {
    console.log('\n🛑 Monitoring stopped');
    process.exit(0);
  });
  
  console.log(`🔍 Starting queue monitor (refresh every ${interval}s, press Ctrl+C to stop):`);
  console.log('');
}

monitor();

// Close database connection when done
if (!watchMode) {
  db.close();
}