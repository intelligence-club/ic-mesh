#!/usr/bin/env node
/**
 * IC Mesh Node Health Analyzer
 * Identifies problematic nodes and provides recommendations
 */

const Database = require('better-sqlite3');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_PATH = process.env.DATABASE_PATH || path.join(DATA_DIR, 'mesh.db');

console.log('🏥 IC Mesh Node Health Analysis');
console.log('');

const db = new Database(DB_PATH);

// Get comprehensive node statistics
const nodeStats = db.prepare(`
  SELECT 
    n.nodeId,
    n.name,
    n.owner,
    n.lastSeen,
    (strftime('%s','now') * 1000 - n.lastSeen) / (1000 * 60) as minutesOffline,
    COUNT(j.jobId) as totalJobs,
    SUM(CASE WHEN j.status = 'completed' THEN 1 ELSE 0 END) as completedJobs,
    SUM(CASE WHEN j.status = 'failed' THEN 1 ELSE 0 END) as failedJobs,
    ROUND(100.0 * SUM(CASE WHEN j.status = 'completed' THEN 1 ELSE 0 END) / NULLIF(COUNT(j.jobId), 0), 1) as successRate
  FROM nodes n
  LEFT JOIN jobs j ON n.nodeId = j.claimedBy
  GROUP BY n.nodeId, n.name, n.owner, n.lastSeen
  ORDER BY totalJobs DESC
`).all();

console.log('📊 Node Performance Summary:');
console.log('');

const healthyNodes = [];
const problematicNodes = [];
const inactiveNodes = [];

nodeStats.forEach(node => {
  const isOnline = node.minutesOffline < 60;
  const hasJobs = node.totalJobs > 0;
  const isHealthy = node.successRate >= 80 || node.totalJobs === 0;
  
  let status = '🔴 OFFLINE';
  if (node.minutesOffline < 5) status = '🟢 ONLINE';
  else if (node.minutesOffline < 60) status = '🟡 RECENT';
  
  console.log(`${status} ${node.name} (${node.nodeId.slice(0, 8)})`);
  console.log(`  Owner: ${node.owner}`);
  console.log(`  Jobs: ${node.completedJobs}/${node.totalJobs} (${node.successRate || 0}% success)`);
  console.log(`  Last seen: ${Math.round(node.minutesOffline)} minutes ago`);
  
  if (!hasJobs) {
    console.log(`  🆔 Status: New/inactive node (no job history)`);
    inactiveNodes.push(node);
  } else if (node.successRate < 50) {
    console.log(`  ⚠️  Status: PROBLEMATIC (${node.successRate}% success rate)`);
    problematicNodes.push(node);
  } else if (node.successRate >= 80) {
    console.log(`  ✅ Status: Healthy performer`);
    healthyNodes.push(node);
  } else {
    console.log(`  🟡 Status: Moderate performance (needs monitoring)`);
  }
  console.log('');
});

// Analyze failure patterns for problematic nodes
if (problematicNodes.length > 0) {
  console.log('🔍 Failure Pattern Analysis:');
  console.log('');
  
  problematicNodes.forEach(node => {
    const failurePatterns = db.prepare(`
      SELECT 
        type,
        COUNT(*) as failures,
        GROUP_CONCAT(DISTINCT substr(result, 1, 100)) as errorSamples
      FROM jobs 
      WHERE claimedBy = ? AND status = 'failed'
      GROUP BY type
      ORDER BY failures DESC
    `).all(node.nodeId);
    
    console.log(`❌ ${node.name} (${node.nodeId.slice(0, 8)}) - Failure Analysis:`);
    failurePatterns.forEach(pattern => {
      console.log(`  ${pattern.type}: ${pattern.failures} failures`);
      // Parse error samples
      try {
        const errors = pattern.errorSamples.split('},{').map(s => {
          const clean = s.replace(/^[,{]*|[,}]*$/g, '');
          if (clean.startsWith('{') || clean.startsWith('"')) {
            const parsed = JSON.parse(`{${clean}}`);
            return parsed.error || parsed.message || 'Unknown error';
          }
          return clean;
        });
        const uniqueErrors = [...new Set(errors)].slice(0, 3);
        uniqueErrors.forEach(err => console.log(`    • ${err}`));
      } catch (e) {
        console.log(`    • ${pattern.errorSamples.slice(0, 80)}...`);
      }
    });
    console.log('');
  });
}

// Recommendations
console.log('🎯 Recommendations:');
console.log('');

if (problematicNodes.length > 0) {
  console.log(`⚠️  ${problematicNodes.length} problematic nodes detected:`);
  problematicNodes.forEach(node => {
    console.log(`  • ${node.name}: ${node.successRate}% success rate (${node.failedJobs} failures)`);
  });
  console.log('  Action: Investigate node configurations, update handlers, or consider removal');
  console.log('');
}

if (healthyNodes.length > 0) {
  console.log(`✅ ${healthyNodes.length} healthy nodes available:`);
  healthyNodes.forEach(node => {
    if (node.totalJobs > 0) {
      console.log(`  • ${node.name}: ${node.successRate}% success (${node.completedJobs} jobs completed)`);
    }
  });
  console.log('  Action: These nodes can handle increased workload');
  console.log('');
}

if (inactiveNodes.length > 0) {
  console.log(`🆔 ${inactiveNodes.length} inactive/new nodes:`);
  inactiveNodes.forEach(node => {
    console.log(`  • ${node.name}: No job history (${Math.round(node.minutesOffline)}min offline)`);
  });
  console.log('  Action: Monitor for activity or clean up if permanently offline');
  console.log('');
}

// Overall network health
const totalJobs = nodeStats.reduce((sum, node) => sum + node.totalJobs, 0);
const totalCompleted = nodeStats.reduce((sum, node) => sum + node.completedJobs, 0);
const overallSuccessRate = totalJobs > 0 ? Math.round(100 * totalCompleted / totalJobs) : 0;

console.log(`🌐 Overall Network Health: ${overallSuccessRate}% success rate`);
console.log(`  Total jobs processed: ${totalJobs}`);
console.log(`  Active nodes: ${nodeStats.filter(n => n.minutesOffline < 60).length}`);
console.log(`  Healthy performers: ${healthyNodes.length}`);

db.close();