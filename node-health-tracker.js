#!/usr/bin/env node

// node-health-tracker.js - Track node connection patterns and health

const Database = require('better-sqlite3');
const db = new Database('./data/mesh.db');

function analyzeNodeHealth() {
  console.log('🔍 Node Health & Retention Tracker\n');
  
  const now = Date.now();
  
  // Get comprehensive node data
  const nodes = db.prepare(`
    SELECT 
      nodeId, name, owner, capabilities,
      registeredAt, lastSeen,
      ((? - lastSeen) / (1000 * 60)) as minutesOffline,
      ((? - registeredAt) / (1000 * 60 * 60)) as hoursRegistered
    FROM nodes 
    ORDER BY lastSeen DESC
  `).all(now, now);
  
  // Get job completion stats per node
  const jobStats = db.prepare(`
    SELECT claimedBy as nodeId, 
           COUNT(*) as totalJobs,
           SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completedJobs,
           SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failedJobs
    FROM jobs 
    WHERE claimedBy IS NOT NULL 
    GROUP BY claimedBy
  `).all();
  
  const jobStatsMap = {};
  jobStats.forEach(stat => {
    jobStatsMap[stat.nodeId] = stat;
  });
  
  // Categorize nodes
  const activeNodes = nodes.filter(n => n.minutesOffline < 10);
  const recentNodes = nodes.filter(n => n.minutesOffline >= 10 && n.minutesOffline < 120);
  const offlineNodes = nodes.filter(n => n.minutesOffline >= 120);
  
  // System vs real nodes
  const systemNodes = nodes.filter(n => 
    n.name && (n.name.includes('test') || n.name.includes('Test') || 
               n.name.includes('Health') || n.owner === 'system')
  );
  const realNodes = nodes.filter(n => !systemNodes.some(s => s.nodeId === n.nodeId));
  
  console.log('📊 NODE CATEGORIES');
  console.log('═'.repeat(60));
  
  // Active nodes
  if (activeNodes.length > 0) {
    console.log(`🟢 ACTIVE (${activeNodes.length} nodes - online within 10min)`);
    activeNodes.forEach(node => {
      const caps = JSON.parse(node.capabilities || '[]');
      const stats = jobStatsMap[node.nodeId] || { totalJobs: 0, completedJobs: 0, failedJobs: 0 };
      const successRate = stats.totalJobs > 0 ? (stats.completedJobs / stats.totalJobs * 100).toFixed(1) : 'N/A';
      
      console.log(`  • ${node.name || 'unnamed'} (${node.nodeId.slice(0,8)})`);
      console.log(`    Owner: ${node.owner}, Offline: ${node.minutesOffline.toFixed(1)}min`);
      console.log(`    Capabilities: [${caps.join(', ')}]`);
      console.log(`    Performance: ${stats.completedJobs}/${stats.totalJobs} jobs (${successRate}% success)`);
      console.log('');
    });
  } else {
    console.log('🟢 ACTIVE: No nodes currently active');
  }
  
  // Recently offline
  if (recentNodes.length > 0) {
    console.log(`🟡 RECENTLY OFFLINE (${recentNodes.length} nodes - 10min to 2h offline)`);
    recentNodes.forEach(node => {
      const caps = JSON.parse(node.capabilities || '[]');
      const stats = jobStatsMap[node.nodeId] || { totalJobs: 0, completedJobs: 0, failedJobs: 0 };
      const isSystem = systemNodes.some(s => s.nodeId === node.nodeId);
      
      console.log(`  • ${node.name || 'unnamed'} ${isSystem ? '(SYSTEM)' : ''}`);
      console.log(`    Offline: ${node.minutesOffline.toFixed(0)}min, Jobs: ${stats.completedJobs}/${stats.totalJobs}`);
      console.log(`    Capabilities: [${caps.join(', ')}]`);
      console.log('');
    });
  }
  
  // Long-term offline
  if (offlineNodes.length > 0) {
    console.log(`🔴 LONG-TERM OFFLINE (${offlineNodes.length} nodes - >2h offline)`);
    offlineNodes.forEach(node => {
      const caps = JSON.parse(node.capabilities || '[]');
      const stats = jobStatsMap[node.nodeId] || { totalJobs: 0, completedJobs: 0, failedJobs: 0 };
      const isSystem = systemNodes.some(s => s.nodeId === node.nodeId);
      const hours = (node.minutesOffline / 60).toFixed(1);
      const days = node.minutesOffline > 1440 ? ` (${(node.minutesOffline / 1440).toFixed(1)}d)` : '';
      
      console.log(`  • ${node.name || 'unnamed'} ${isSystem ? '(SYSTEM)' : ''}`);
      console.log(`    Owner: ${node.owner}, Offline: ${hours}h${days}`);
      console.log(`    Capabilities: [${caps.join(', ')}] - Jobs: ${stats.completedJobs}/${stats.totalJobs}`);
      console.log('');
    });
  }
  
  // Summary metrics
  console.log('📈 RETENTION METRICS');
  console.log('═'.repeat(60));
  
  const totalNodes = nodes.length;
  const totalRealNodes = realNodes.length;
  const activeRealNodes = realNodes.filter(n => n.minutesOffline < 10).length;
  const recentRealNodes = realNodes.filter(n => n.minutesOffline >= 10 && n.minutesOffline < 120).length;
  
  console.log(`Total nodes: ${totalNodes} (${totalRealNodes} real, ${systemNodes.length} system/test)`);
  console.log(`Real node retention: ${activeRealNodes}/${totalRealNodes} active (${(activeRealNodes/totalRealNodes*100).toFixed(1)}%)`);
  console.log(`Recent disconnects: ${recentRealNodes} real nodes (potential recovery targets)`);
  
  // Capability coverage
  console.log('\n🎯 CAPABILITY COVERAGE');
  console.log('═'.repeat(60));
  
  const allCapabilities = new Set();
  const activeCapabilities = new Set();
  
  nodes.forEach(node => {
    const caps = JSON.parse(node.capabilities || '[]');
    caps.forEach(cap => {
      allCapabilities.add(cap);
      if (node.minutesOffline < 10) {
        activeCapabilities.add(cap);
      }
    });
  });
  
  console.log(`Available: [${Array.from(activeCapabilities).join(', ') || 'none'}]`);
  console.log(`Lost: [${Array.from(allCapabilities).filter(c => !activeCapabilities.has(c)).join(', ') || 'none'}]`);
  
  // Critical recommendations
  const criticalOffline = offlineNodes.filter(n => !systemNodes.some(s => s.nodeId === n.nodeId));
  const drakonNodes = criticalOffline.filter(n => n.owner === 'drake');
  
  if (criticalOffline.length > 0) {
    console.log('\n⚠️  RECOVERY PRIORITIES');
    console.log('═'.repeat(60));
    
    if (drakonNodes.length > 0) {
      console.log('🔥 HIGH PRIORITY - Contact Drake:');
      drakonNodes.forEach(node => {
        const caps = JSON.parse(node.capabilities || '[]');
        const stats = jobStatsMap[node.nodeId] || { totalJobs: 0 };
        console.log(`  • ${node.name}: [${caps.join(', ')}] - ${stats.totalJobs} jobs completed`);
      });
      console.log('  📞 Action: claw skill mesh-transcribe + frigg node revival');
    }
    
    const otherCritical = criticalOffline.filter(n => n.owner !== 'drake' && n.owner !== 'unknown');
    if (otherCritical.length > 0) {
      console.log('\n🔍 INVESTIGATE - Contact operators:');
      otherCritical.forEach(node => {
        const caps = JSON.parse(node.capabilities || '[]');
        console.log(`  • ${node.name} (${node.owner}): [${caps.join(', ')}]`);
      });
    }
  }
  
  return {
    total: totalNodes,
    real: totalRealNodes,
    active: activeRealNodes,
    retention: activeRealNodes / totalRealNodes * 100,
    criticalOffline: criticalOffline.length
  };
}

// CLI execution
if (require.main === module) {
  try {
    const metrics = analyzeNodeHealth();
    
    // Exit code based on retention
    if (metrics.retention < 25) {
      process.exit(2); // Critical retention
    } else if (metrics.retention < 50) {
      process.exit(1); // Warning
    } else {
      process.exit(0); // OK
    }
  } catch (error) {
    console.error('❌ Node health analysis failed:', error.message);
    process.exit(3);
  }
}

module.exports = { analyzeNodeHealth };