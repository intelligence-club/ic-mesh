#!/usr/bin/env node

/**
 * Daily Health Report Generator
 * Creates a comprehensive daily health summary for IC Mesh
 */

const Database = require('better-sqlite3');
const fs = require('fs');

const db = new Database('./data/mesh.db', { readonly: true });

function generateDailyReport() {
  const timestamp = new Date().toISOString();
  const dateStr = timestamp.split('T')[0];
  
  console.log(`📊 IC Mesh Daily Health Report - ${dateStr}`);
  console.log('=' .repeat(50));
  
  // Overall system status
  const totalJobs = db.prepare("SELECT COUNT(*) as count FROM jobs").get().count;
  const completedJobs = db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'completed'").get().count;
  const pendingJobs = db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'pending'").get().count;
  const failedJobs = db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'failed'").get().count;
  const claimedJobs = db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'claimed'").get().count;
  
  console.log(`\n📋 JOB SUMMARY`);
  console.log(`   Total jobs: ${totalJobs}`);
  console.log(`   Completed: ${completedJobs} (${Math.round(completedJobs/totalJobs*100)}%)`);
  console.log(`   Pending: ${pendingJobs}`);
  console.log(`   Processing: ${claimedJobs}`);
  console.log(`   Failed: ${failedJobs} (${Math.round(failedJobs/totalJobs*100)}%)`);
  
  // Success rate
  const successRate = Math.round(completedJobs/(completedJobs + failedJobs) * 100);
  console.log(`   Success rate: ${successRate}%`);
  
  // Node status
  const totalNodes = db.prepare("SELECT COUNT(*) as count FROM nodes").get().count;
  const recentNodes = db.prepare("SELECT COUNT(*) as count FROM nodes WHERE lastSeen > ?").get(Date.now() - (5 * 60 * 1000)).count;
  
  console.log(`\n🖥️  NODE SUMMARY`);
  console.log(`   Total registered: ${totalNodes}`);
  console.log(`   Active (5min): ${recentNodes}`);
  console.log(`   Retention rate: ${Math.round(recentNodes/totalNodes*100)}%`);
  
  // Capability analysis
  const capabilities = db.prepare(`
    SELECT json_extract(capabilities, '$') as caps 
    FROM nodes 
    WHERE lastSeen > ?
  `).all(Date.now() - (5 * 60 * 1000));
  
  const availableCaps = new Set();
  capabilities.forEach(row => {
    try {
      const caps = JSON.parse(row.caps);
      if (Array.isArray(caps)) {
        caps.forEach(cap => availableCaps.add(cap));
      }
    } catch (e) {
      // Skip invalid JSON
    }
  });
  
  console.log(`\n🎯 AVAILABLE CAPABILITIES`);
  if (availableCaps.size > 0) {
    Array.from(availableCaps).sort().forEach(cap => {
      console.log(`   ✅ ${cap}`);
    });
  } else {
    console.log(`   ⚠️  No capabilities available`);
  }
  
  // Blocked jobs analysis
  const jobTypes = db.prepare(`
    SELECT type, COUNT(*) as count 
    FROM jobs 
    WHERE status = 'pending' 
    GROUP BY type 
    ORDER BY count DESC
  `).all();
  
  console.log(`\n🚫 BLOCKED JOBS`);
  jobTypes.forEach(row => {
    console.log(`   ${row.type}: ${row.count} jobs`);
  });
  
  // Recent activity (last 24h)
  const recentJobs = db.prepare(`
    SELECT COUNT(*) as count 
    FROM jobs 
    WHERE createdAt > ?
  `).get(Date.now() - (24 * 60 * 60 * 1000)).count;
  
  console.log(`\n📈 ACTIVITY (24h)`);
  console.log(`   New jobs: ${recentJobs}`);
  
  // Top performing nodes
  const topNodes = db.prepare(`
    SELECT claimedBy, COUNT(*) as jobs_completed, MAX(completedAt) as last_completion
    FROM jobs 
    WHERE status = 'completed' AND claimedBy IS NOT NULL
    GROUP BY claimedBy 
    ORDER BY jobs_completed DESC
    LIMIT 5
  `).all();
  
  console.log(`\n⭐ TOP PERFORMERS`);
  topNodes.forEach((node, idx) => {
    const nodeInfo = db.prepare("SELECT owner FROM nodes WHERE nodeId = ?").get(node.claimedBy);
    const owner = nodeInfo?.owner || 'unknown';
    const lastJob = new Date(node.last_completion).toISOString().split('T')[0];
    console.log(`   ${idx + 1}. ${node.claimedBy.substring(0,8)} (${owner}): ${node.jobs_completed} jobs, last: ${lastJob}`);
  });
  
  // Health score calculation
  let healthScore = 0;
  
  // Job success rate (40% weight)
  healthScore += (successRate / 100) * 40;
  
  // Node retention (30% weight)  
  healthScore += (recentNodes / Math.max(totalNodes, 1)) * 30;
  
  // Queue health (20% weight) - lower pending ratio is better
  const queueHealth = Math.max(0, 1 - (pendingJobs / Math.max(totalJobs, 1)));
  healthScore += queueHealth * 20;
  
  // Capability coverage (10% weight) - more capabilities is better
  const capabilityHealth = Math.min(1, availableCaps.size / 5); // Assume 5 key capabilities
  healthScore += capabilityHealth * 10;
  
  console.log(`\n🏥 HEALTH SCORE`);
  console.log(`   Overall: ${Math.round(healthScore)}/100`);
  
  if (healthScore >= 80) {
    console.log(`   Status: 🟢 EXCELLENT`);
  } else if (healthScore >= 60) {
    console.log(`   Status: 🟡 GOOD`);
  } else if (healthScore >= 40) {
    console.log(`   Status: 🟠 DEGRADED`);
  } else {
    console.log(`   Status: 🔴 CRITICAL`);
  }
  
  console.log(`\n📅 Report generated: ${timestamp}`);
  console.log('=' .repeat(50));
  
  db.close();
  
  return healthScore;
}

// CLI execution
if (require.main === module) {
  generateDailyReport();
}

module.exports = { generateDailyReport };