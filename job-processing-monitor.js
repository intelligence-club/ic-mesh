#!/usr/bin/env node

/**
 * Monitor job processing flow to identify bottlenecks
 * Checks for jobs stuck in pending despite available nodes
 */

const Database = require('better-sqlite3');
const db = new Database('./data/mesh.db', { readonly: true });

console.log('🔍 Job Processing Flow Analysis\n');

try {
  const now = Date.now();
  const fiveMinutesAgo = now - (5 * 60 * 1000);
  const oneHourAgo = now - (60 * 60 * 1000);

  // Get job status breakdown
  const jobStats = db.prepare(`
    SELECT 
      status,
      COUNT(*) as count,
      MIN(createdAt) as oldest_timestamp,
      MAX(createdAt) as newest_timestamp
    FROM jobs 
    GROUP BY status 
    ORDER BY count DESC
  `).all();

  console.log('📊 Job Status Overview:');
  jobStats.forEach(stat => {
    const oldestTime = new Date(stat.oldest_timestamp).toISOString();
    const newestTime = new Date(stat.newest_timestamp).toISOString();
    console.log(`  ${stat.status}: ${stat.count} jobs (${oldestTime} to ${newestTime})`);
  });
  console.log('');

  // Check for stale pending jobs
  const stalePending = db.prepare(`
    SELECT 
      jobId, type, createdAt,
      ROUND((? - createdAt) / 1000 / 60) as minutes_ago
    FROM jobs 
    WHERE status = 'pending' AND createdAt < ?
    ORDER BY createdAt ASC
    LIMIT 5
  `).all(now, oneHourAgo);

  if (stalePending.length > 0) {
    console.log('⚠️  Old Pending Jobs (>1 hour):');
    stalePending.forEach(job => {
      console.log(`  ${job.jobId.substring(0,8)}: ${job.type} (${job.minutes_ago}min ago)`);
    });
    console.log('');
  }

  // Check claimed jobs status
  const claimedJobs = db.prepare(`
    SELECT 
      jobId, type, claimedBy, claimedAt,
      ROUND((? - claimedAt) / 1000 / 60) as minutes_claimed
    FROM jobs 
    WHERE status = 'claimed'
    ORDER BY claimedAt ASC
  `).all(now);

  if (claimedJobs.length > 0) {
    console.log('🔄 Currently Claimed Jobs:');
    claimedJobs.forEach(job => {
      console.log(`  ${job.jobId.substring(0,8)}: ${job.type} by ${job.claimedBy.substring(0,8)} (${job.minutes_claimed}min ago)`);
    });
    console.log('');
  }

  // Active node check
  const activeNodes = db.prepare(`
    SELECT nodeId, name, capabilities, lastSeen
    FROM nodes 
    WHERE lastSeen > ?
    ORDER BY lastSeen DESC
  `).all(fiveMinutesAgo);

  console.log('🟢 Active Nodes (last 5min):');
  if (activeNodes.length === 0) {
    console.log('  ❌ NO ACTIVE NODES');
  } else {
    activeNodes.forEach(node => {
      const secondsAgo = Math.round((now - node.lastSeen) / 1000);
      const capabilities = JSON.parse(node.capabilities);
      console.log(`  ${node.name}: ${capabilities.join(', ')} (${secondsAgo}s ago)`);
    });
  }
  console.log('');

  // Processing rate analysis
  const recentCompleted = db.prepare(`
    SELECT COUNT(*) as count
    FROM jobs 
    WHERE status = 'completed' AND completedAt > ?
  `).get(oneHourAgo);

  const recentFailed = db.prepare(`
    SELECT COUNT(*) as count
    FROM jobs 
    WHERE status = 'failed' AND completedAt > ?
  `).get(oneHourAgo);

  console.log(`📈 Last Hour Processing:  ${recentCompleted.count} completed, ${recentFailed.count} failed`);

  // Check for processing bottlenecks
  const pendingByType = db.prepare(`
    SELECT type, COUNT(*) as count
    FROM jobs 
    WHERE status = 'pending'
    GROUP BY type
    ORDER BY count DESC
  `).all();

  const issues = [];
  pendingByType.forEach(job => {
    if (job.count > 20) {
      const capableNodes = activeNodes.filter(node => {
        const caps = JSON.parse(node.capabilities);
        return caps.includes(job.type) || 
               (job.type === 'transcribe' && caps.includes('transcription'));
      });
      
      if (capableNodes.length > 0) {
        issues.push(`${job.count} ${job.type} jobs pending despite ${capableNodes.length} capable active nodes`);
      }
    }
  });

  if (issues.length > 0) {
    console.log('\n🚨 Potential Issues:');
    issues.forEach(issue => console.log(`  • ${issue}`));
  }

} catch (error) {
  console.error('❌ Error analyzing job processing:', error.message);
  process.exit(1);
} finally {
  db.close();
}