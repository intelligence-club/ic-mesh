#!/usr/bin/env node

/**
 * IC Mesh Inactive Node Cleanup Tool
 * 
 * Identifies and removes nodes that have been offline for extended periods
 * with no job history or minimal activity. Helps maintain network health metrics.
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'mesh.db');

function getInactiveNodes(minOfflineMinutes = 7 * 24 * 60) { // 7 days default
  const db = new Database(DB_PATH, { readonly: true });
  
  try {
    const now = Date.now();
    const cutoffTime = now - (minOfflineMinutes * 60 * 1000);
    
    const query = `
      SELECT 
        n.nodeId,
        n.name,
        n.owner,
        n.lastSeen,
        ROUND((? - n.lastSeen) / 1000 / 60) as minutesOffline,
        COUNT(j.jobId) as totalJobs,
        SUM(CASE WHEN j.status = 'completed' THEN 1 ELSE 0 END) as completedJobs,
        SUM(CASE WHEN j.status = 'failed' THEN 1 ELSE 0 END) as failedJobs
      FROM nodes n
      LEFT JOIN jobs j ON n.nodeId = j.claimedBy
      WHERE n.lastSeen < ?
      GROUP BY n.nodeId
      ORDER BY n.lastSeen ASC
    `;
    
    return db.prepare(query).all(now, cutoffTime);
  } finally {
    db.close();
  }
}

function removeNode(nodeId, dryRun = true) {
  if (dryRun) {
    console.log(`[DRY RUN] Would remove node ${nodeId}`);
    return false;
  }
  
  const db = new Database(DB_PATH);
  
  try {
    db.prepare('BEGIN').run();
    
    // Remove related jobs first (if any)
    const jobDeleteResult = db.prepare('DELETE FROM jobs WHERE claimedBy = ?').run(nodeId);
    
    // Remove the node
    const nodeDeleteResult = db.prepare('DELETE FROM nodes WHERE nodeId = ?').run(nodeId);
    
    db.prepare('COMMIT').run();
    
    console.log(`✅ Removed node ${nodeId}:`);
    console.log(`   - ${jobDeleteResult.changes} related jobs deleted`);
    console.log(`   - ${nodeDeleteResult.changes} node record deleted`);
    
    return true;
  } catch (error) {
    db.prepare('ROLLBACK').run();
    console.error(`❌ Error removing node ${nodeId}:`, error.message);
    return false;
  } finally {
    db.close();
  }
}

function formatDuration(minutes) {
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.round(minutes/60)}h`;
  return `${Math.round(minutes/1440)}d`;
}

function analyzeInactiveNodes() {
  console.log('🧹 IC Mesh Inactive Node Cleanup Analysis\n');
  
  const inactiveNodes = getInactiveNodes();
  
  if (inactiveNodes.length === 0) {
    console.log('✅ No inactive nodes found (all nodes active within 7 days)');
    return;
  }
  
  console.log('📊 Inactive Nodes Found:\n');
  
  const candidates = [];
  const keepNodes = [];
  
  inactiveNodes.forEach(node => {
    const nodeInfo = `${node.name || 'unnamed'} (${node.nodeId.substring(0,8)})`;
    const duration = formatDuration(node.minutesOffline);
    const jobInfo = node.totalJobs > 0 ? 
      `${node.completedJobs}/${node.totalJobs} jobs completed` : 
      'no job history';
    
    console.log(`🔴 OFFLINE ${nodeInfo}`);
    console.log(`   Owner: ${node.owner || 'unknown'}`);
    console.log(`   Offline: ${duration} (${node.minutesOffline} minutes)`);
    console.log(`   Jobs: ${jobInfo}`);
    
    // Determine if node should be removed
    const shouldRemove = (
      node.minutesOffline > 7 * 24 * 60 && // Offline > 7 days
      node.totalJobs === 0 // No job history
    ) || (
      node.minutesOffline > 30 * 24 * 60 && // Offline > 30 days
      node.totalJobs <= 2 // Very minimal activity
    );
    
    if (shouldRemove) {
      console.log(`   🗑️  CANDIDATE FOR REMOVAL: ${shouldRemove ? 'Long offline + minimal/no activity' : ''}`);
      candidates.push(node);
    } else {
      console.log(`   ⚠️  KEEP: Has significant job history or recent enough activity`);
      keepNodes.push(node);
    }
    
    console.log('');
  });
  
  console.log('📋 Summary:');
  console.log(`   Total inactive nodes: ${inactiveNodes.length}`);
  console.log(`   Candidates for removal: ${candidates.length}`);
  console.log(`   Should keep: ${keepNodes.length}`);
  
  if (candidates.length > 0) {
    console.log('\n💡 Cleanup Commands:');
    console.log('   # Review candidates (dry run):');
    console.log('   node cleanup-inactive-nodes.js clean --dry-run');
    console.log('   # Execute cleanup:');
    console.log('   node cleanup-inactive-nodes.js clean');
  }
  
  return candidates;
}

function cleanupNodes(dryRun = true) {
  const candidates = getInactiveNodes().filter(node => {
    return (
      node.minutesOffline > 7 * 24 * 60 && 
      node.totalJobs === 0
    ) || (
      node.minutesOffline > 30 * 24 * 60 && 
      node.totalJobs <= 2
    );
  });
  
  if (candidates.length === 0) {
    console.log('✅ No nodes meet removal criteria');
    return;
  }
  
  console.log(`🧹 ${dryRun ? '[DRY RUN] ' : ''}Cleaning up ${candidates.length} inactive nodes:\n`);
  
  candidates.forEach(node => {
    const nodeInfo = `${node.name || 'unnamed'} (${node.nodeId.substring(0,8)})`;
    console.log(`🗑️  ${nodeInfo} - offline ${formatDuration(node.minutesOffline)}, ${node.totalJobs} jobs`);
    
    if (!dryRun) {
      removeNode(node.nodeId, false);
    }
  });
  
  if (dryRun) {
    console.log('\n💡 Run with --execute to perform actual cleanup');
  } else {
    console.log('\n✅ Cleanup completed');
  }
}

// CLI interface
const args = process.argv.slice(2);
const action = args[0];

if (action === 'analyze' || !action) {
  analyzeInactiveNodes();
} else if (action === 'clean') {
  const dryRun = !args.includes('--execute');
  cleanupNodes(dryRun);
} else {
  console.log(`
Usage: node cleanup-inactive-nodes.js [action] [options]

Actions:
  analyze     - Show all inactive nodes with removal recommendations
  clean       - Remove nodes that meet cleanup criteria

Options:
  --execute   - Actually perform cleanup (default is dry-run)

Examples:
  node cleanup-inactive-nodes.js analyze
  node cleanup-inactive-nodes.js clean
  node cleanup-inactive-nodes.js clean --execute
`);
  process.exit(1);
}