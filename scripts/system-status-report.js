#!/usr/bin/env node
/**
 * IC Mesh Comprehensive System Status Report
 * Generates a complete operational overview for humans and monitoring
 * 
 * Usage: node scripts/system-status-report.js [--format=text|json] [--brief]
 */

const Database = require('better-sqlite3');
const path = require('path');

// Configuration
const FORMAT = process.argv.find(arg => arg.startsWith('--format='))?.split('=')[1] || 'text';
const BRIEF = process.argv.includes('--brief');

// Database setup
const dbPath = path.join('/home/openclaw/.openclaw/workspace/ic-mesh/data/mesh.db');
const db = new Database(dbPath);

const now = Date.now();
const report = {
  timestamp: new Date().toISOString(),
  status: 'unknown',
  summary: {},
  nodes: {},
  jobs: {},
  capacity: {},
  health: {}
};

try {
  // === JOB ANALYSIS ===
  const jobStats = db.prepare(`
    SELECT status, COUNT(*) as count 
    FROM jobs 
    GROUP BY status
  `).all();

  const jobsByStatus = {};
  jobStats.forEach(stat => {
    jobsByStatus[stat.status] = stat.count;
  });

  report.jobs = {
    total: Object.values(jobsByStatus).reduce((a, b) => a + b, 0),
    by_status: jobsByStatus,
    pending_breakdown: {}
  };

  // Pending jobs by type
  const pendingByType = db.prepare(`
    SELECT type, COUNT(*) as count 
    FROM jobs 
    WHERE status = 'pending'
    GROUP BY type
    ORDER BY count DESC
  `).all();

  pendingByType.forEach(item => {
    report.jobs.pending_breakdown[item.type] = item.count;
  });

  // === NODE ANALYSIS ===
  const allNodes = db.prepare(`
    SELECT nodeId, capabilities, lastSeen, flags,
           (SELECT COUNT(*) FROM jobs WHERE claimedBy = nodes.nodeId AND status = 'completed') as completed_jobs
    FROM nodes
  `).all();

  const activeThreshold = now - (10 * 60 * 1000); // 10 minutes
  const activeNodes = [];
  const offlineNodes = [];
  const availableCapabilities = new Set();

  allNodes.forEach(node => {
    let caps;
    try {
      caps = JSON.parse(node.capabilities || '[]');
    } catch(e) {
      caps = [];
    }

    let flags;
    try {
      flags = JSON.parse(node.flags || '{}');
    } catch(e) {
      flags = {};
    }

    const minutesOffline = Math.round((now - node.lastSeen) / (1000 * 60));
    const isActive = node.lastSeen > activeThreshold;

    const nodeData = {
      nodeId: node.nodeId,
      capabilities: caps,
      lastSeen: new Date(node.lastSeen).toISOString(),
      minutesOffline,
      completedJobs: node.completed_jobs,
      flags,
      quarantined: !!flags.quarantined
    };

    if (isActive) {
      activeNodes.push(nodeData);
      caps.forEach(cap => availableCapabilities.add(cap));
    } else {
      offlineNodes.push(nodeData);
    }
  });

  report.nodes = {
    total: allNodes.length,
    active: activeNodes.length,
    offline: offlineNodes.length,
    active_nodes: activeNodes,
    offline_nodes: offlineNodes.slice(0, BRIEF ? 3 : 10), // Limit offline list
    available_capabilities: Array.from(availableCapabilities).sort()
  };

  // === CAPACITY ANALYSIS ===
  const capabilityDemand = db.prepare(`
    SELECT 
      JSON_EXTRACT(requirements, '$.capability') as capability,
      COUNT(*) as pending_jobs
    FROM jobs 
    WHERE status = 'pending' 
      AND JSON_EXTRACT(requirements, '$.capability') IS NOT NULL
    GROUP BY capability
    ORDER BY pending_jobs DESC
  `).all();

  const capacity = {};
  const criticalGaps = [];

  capabilityDemand.forEach(item => {
    const capability = item.capability;
    const aliases = {
      'transcription': 'whisper',
      'transcribe': 'whisper', 
      'ocr': 'tesseract',
      'pdf-extract': 'tesseract',
      'inference': 'ollama',
      'generate-image': 'stable-diffusion'
    };
    
    const aliased = aliases[capability] || capability;
    const hasCapacity = availableCapabilities.has(capability) || availableCapabilities.has(aliased);
    
    capacity[capability] = {
      pending_jobs: item.pending_jobs,
      has_active_nodes: hasCapacity,
      required_capability: aliased !== capability ? aliased : null
    };

    if (!hasCapacity) {
      criticalGaps.push({
        capability,
        pending_jobs: item.pending_jobs,
        required_node_capability: aliased
      });
    }
  });

  report.capacity = {
    by_capability: capacity,
    critical_gaps: criticalGaps,
    gaps_count: criticalGaps.length
  };

  // === HEALTH SCORE ===
  let healthScore = 100;
  let healthIssues = [];

  // Deduct for offline critical capacity
  if (criticalGaps.length > 0) {
    const totalBlockedJobs = criticalGaps.reduce((sum, gap) => sum + gap.pending_jobs, 0);
    healthScore -= Math.min(40, totalBlockedJobs * 2); // Max 40 point deduction
    healthIssues.push(`${criticalGaps.length} capability gaps blocking ${totalBlockedJobs} jobs`);
  }

  // Deduct for low active node count
  if (activeNodes.length === 0) {
    healthScore = 0;
    healthIssues.push('No active nodes');
  } else if (activeNodes.length === 1) {
    healthScore -= 20;
    healthIssues.push('Single point of failure (only 1 active node)');
  }

  // Deduct for old pending jobs
  const oldJobs = db.prepare(`
    SELECT COUNT(*) as count 
    FROM jobs 
    WHERE status = 'pending' AND createdAt < ?
  `).get(now - (60 * 60 * 1000)).count;

  if (oldJobs > 0) {
    healthScore -= Math.min(15, oldJobs);
    healthIssues.push(`${oldJobs} jobs pending >1 hour`);
  }

  report.health = {
    score: Math.max(0, healthScore),
    status: healthScore >= 90 ? 'excellent' : healthScore >= 70 ? 'good' : healthScore >= 50 ? 'degraded' : 'critical',
    issues: healthIssues
  };

  // === OVERALL STATUS ===
  report.status = report.health.status;
  report.summary = {
    service_status: report.status,
    active_nodes: activeNodes.length,
    pending_jobs: jobsByStatus.pending || 0,
    blocked_capabilities: criticalGaps.length,
    health_score: report.health.score
  };

} catch (error) {
  report.status = 'error';
  report.error = error.message;
} finally {
  db.close();
}

// === OUTPUT ===
if (FORMAT === 'json') {
  console.log(JSON.stringify(report, null, 2));
} else {
  // Text format
  console.log('🏥 IC Mesh System Status Report');
  console.log('================================');
  console.log(`📅 Generated: ${report.timestamp}`);
  console.log(`📊 Overall Status: ${report.status.toUpperCase()}`);
  console.log(`💯 Health Score: ${report.health.score}/100`);
  console.log('');

  if (report.health.issues.length > 0) {
    console.log('⚠️  Health Issues:');
    report.health.issues.forEach(issue => console.log(`   • ${issue}`));
    console.log('');
  }

  console.log('📈 Summary:');
  console.log(`   • Active nodes: ${report.summary.active_nodes}`);
  console.log(`   • Pending jobs: ${report.summary.pending_jobs}`);
  console.log(`   • Blocked capabilities: ${report.summary.blocked_capabilities}`);
  console.log('');

  if (!BRIEF) {
    console.log('🖥️  Node Details:');
    if (report.nodes.active_nodes.length === 0) {
      console.log('   No active nodes');
    } else {
      report.nodes.active_nodes.forEach(node => {
        const statusFlag = node.quarantined ? ' [QUARANTINED]' : '';
        console.log(`   ✅ ${node.nodeId}${statusFlag}`);
        console.log(`      Capabilities: ${JSON.stringify(node.capabilities)}`);
        console.log(`      Jobs completed: ${node.completedJobs}`);
        console.log(`      Last seen: ${Math.round((Date.now() - new Date(node.lastSeen).getTime()) / (1000 * 60))} min ago`);
      });
    }

    if (report.nodes.offline_nodes.length > 0) {
      console.log('');
      console.log('   Offline nodes (recent):');
      report.nodes.offline_nodes.slice(0, 3).forEach(node => {
        console.log(`   ❌ ${node.nodeId} (${node.minutesOffline} min offline)`);
        console.log(`      Capabilities: ${JSON.stringify(node.capabilities)}`);
        console.log(`      Jobs completed: ${node.completedJobs}`);
      });
    }

    console.log('');
    console.log('🔧 Capacity Status:');
    if (Object.keys(report.capacity.by_capability).length === 0) {
      console.log('   No capacity requirements found');
    } else {
      Object.entries(report.capacity.by_capability).forEach(([cap, info]) => {
        const status = info.has_active_nodes ? '✅' : '❌';
        const aliasInfo = info.required_capability ? ` (requires ${info.required_capability})` : '';
        console.log(`   ${status} ${cap}: ${info.pending_jobs} jobs${aliasInfo}`);
      });
    }
  }

  console.log('');
  console.log('✅ Report complete');
}