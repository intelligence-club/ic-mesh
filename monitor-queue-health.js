#!/usr/bin/env node

// monitor-queue-health.js - Comprehensive queue health monitoring

const Database = require('better-sqlite3');
const fs = require('fs');

const db = new Database('./data/mesh.db');

function analyzeQueueHealth() {
  console.log('🔍 IC Mesh Queue Health Monitor\n');
  
  // Get current timestamp
  const now = Date.now();
  
  // Job distribution analysis
  const jobStats = db.prepare(`
    SELECT type, status, COUNT(*) as count 
    FROM jobs 
    GROUP BY type, status 
    ORDER BY type, status
  `).all();
  
  // Capability analysis
  const capabilityNeeds = {};
  const blockedJobs = {};
  
  for (const stat of jobStats) {
    if (stat.status === 'pending') {
      capabilityNeeds[stat.type] = stat.count;
      blockedJobs[stat.type] = stat.count;
    }
  }
  
  // Active nodes and capabilities
  const nodes = db.prepare(`
    SELECT nodeId, name, capabilities, lastSeen, 
           (? - lastSeen) / (1000 * 60) as minutesOffline
    FROM nodes 
    ORDER BY lastSeen DESC
  `).all(now);
  
  const activeNodes = nodes.filter(n => n.minutesOffline < 10);
  const availableCapabilities = new Set();
  
  for (const node of activeNodes) {
    try {
      const caps = JSON.parse(node.capabilities || '[]');
      caps.forEach(cap => availableCapabilities.add(cap));
    } catch (e) {
      // Skip invalid JSON
    }
  }
  
  // Health analysis
  let healthScore = 100;
  const issues = [];
  const recommendations = [];
  
  // Check for stuck jobs (claimed > 10 minutes ago)
  const stuckJobs = db.prepare(`
    SELECT jobId, type, claimedBy, 
           (? - claimedAt) / (1000 * 60) as minutesClaimed
    FROM jobs 
    WHERE status = 'claimed' AND claimedAt < ? - 10*60*1000
  `).all(now, now);
  
  if (stuckJobs.length > 0) {
    healthScore -= 30;
    issues.push(`⚠️ ${stuckJobs.length} stuck jobs (claimed >10min ago)`);
    recommendations.push('🔧 Reset stuck jobs with: node reset-stuck-jobs.js');
  }
  
  // Check for capability gaps
  const capabilityGaps = [];
  for (const [type, count] of Object.entries(capabilityNeeds)) {
    let requiredCap = type;
    if (type === 'transcribe') requiredCap = 'transcription';
    if (type === 'ocr') requiredCap = 'tesseract';
    if (type === 'pdf-extract') requiredCap = 'tesseract';
    
    if (!availableCapabilities.has(requiredCap)) {
      capabilityGaps.push({ type, count, requiredCap });
      healthScore -= Math.min(20, count * 2);
    }
  }
  
  if (capabilityGaps.length > 0) {
    issues.push(`🚫 Missing capabilities blocking ${capabilityGaps.map(g => `${g.count} ${g.type}`).join(', ')} jobs`);
    
    // Specific recommendations
    const tesseractNeeded = capabilityGaps.some(g => g.requiredCap === 'tesseract');
    const transcriptionNeeded = capabilityGaps.some(g => g.requiredCap === 'transcription');
    
    if (tesseractNeeded) {
      recommendations.push('📞 Contact Drake to revive frigg nodes (tesseract/OCR capability)');
    }
    if (transcriptionNeeded) {
      recommendations.push('📞 Contact operators to restore transcription nodes');
    }
  }
  
  // Check node retention
  const totalNodes = nodes.length;
  const offlineNodes = nodes.filter(n => n.minutesOffline > 10);
  const retentionRate = ((totalNodes - offlineNodes.length) / totalNodes * 100);
  
  if (retentionRate < 50) {
    healthScore -= 15;
    issues.push(`📉 Poor node retention: ${activeNodes.length}/${totalNodes} active (${retentionRate.toFixed(1)}%)`);
    recommendations.push('🔍 Investigate node disconnection causes');
  }
  
  // Health score bounds
  healthScore = Math.max(0, Math.min(100, healthScore));
  
  // Display results
  console.log('📊 QUEUE STATUS');
  console.log('═'.repeat(50));
  
  if (jobStats.length === 0) {
    console.log('📭 No jobs in system');
  } else {
    for (const stat of jobStats) {
      const icon = stat.status === 'completed' ? '✅' : 
                   stat.status === 'pending' ? '⏳' :
                   stat.status === 'claimed' ? '🔄' : 
                   stat.status === 'failed' ? '❌' : '❓';
      console.log(`${icon} ${stat.type}: ${stat.count} ${stat.status}`);
    }
  }
  
  console.log('\n🖥️  NODE STATUS');
  console.log('═'.repeat(50));
  console.log(`Active: ${activeNodes.length}/${totalNodes} nodes (${retentionRate.toFixed(1)}% retention)`);
  
  if (activeNodes.length > 0) {
    console.log('\nActive nodes:');
    for (const node of activeNodes) {
      const caps = JSON.parse(node.capabilities || '[]');
      console.log(`  • ${node.name || node.nodeId.slice(0,8)}: [${caps.join(', ')}]`);
    }
  }
  
  if (offlineNodes.length > 0) {
    console.log(`\nOffline: ${offlineNodes.length} nodes`);
    for (const node of offlineNodes.slice(0, 3)) { // Show first 3
      console.log(`  • ${node.name || node.nodeId.slice(0,8)}: ${node.minutesOffline.toFixed(0)}min ago`);
    }
    if (offlineNodes.length > 3) {
      console.log(`  ... and ${offlineNodes.length - 3} more`);
    }
  }
  
  console.log('\n🎯 CAPABILITIES');
  console.log('═'.repeat(50));
  if (availableCapabilities.size > 0) {
    console.log(`Available: [${Array.from(availableCapabilities).join(', ')}]`);
  } else {
    console.log('❌ No capabilities available');
  }
  
  if (capabilityGaps.length > 0) {
    console.log('\nBlocked jobs needing:');
    for (const gap of capabilityGaps) {
      console.log(`  🚫 ${gap.requiredCap}: ${gap.count} ${gap.type} jobs`);
    }
  }
  
  // Health summary
  console.log('\n🏥 HEALTH SUMMARY');
  console.log('═'.repeat(50));
  
  const healthIcon = healthScore >= 90 ? '💚' :
                     healthScore >= 70 ? '💛' :
                     healthScore >= 40 ? '🧡' : '❤️';
  
  console.log(`${healthIcon} Overall health: ${healthScore}/100`);
  
  if (issues.length > 0) {
    console.log('\n⚠️ Issues:');
    issues.forEach(issue => console.log(`  ${issue}`));
  }
  
  if (recommendations.length > 0) {
    console.log('\n💡 Recommendations:');
    recommendations.forEach(rec => console.log(`  ${rec}`));
  }
  
  if (healthScore >= 90 && issues.length === 0) {
    console.log('  🎉 System healthy! Queue processing normally.');
  }
  
  return {
    healthScore,
    issues: issues.length,
    blockedJobs: Object.values(blockedJobs).reduce((a, b) => a + b, 0),
    activeNodes: activeNodes.length,
    totalNodes
  };
}

// CLI execution
if (require.main === module) {
  try {
    const health = analyzeQueueHealth();
    
    // Exit code based on health
    if (health.healthScore < 40) {
      process.exit(2); // Critical
    } else if (health.healthScore < 70) {
      process.exit(1); // Warning
    } else {
      process.exit(0); // OK
    }
  } catch (error) {
    console.error('❌ Health monitoring failed:', error.message);
    process.exit(3);
  }
}

module.exports = { analyzeQueueHealth };