#!/usr/bin/env node
/**
 * Critical Capacity Monitor
 * Monitors IC Mesh network for capacity crises and service outages
 * Usage: node scripts/critical-capacity-monitor.js [--once] [--quiet] [--alert-threshold=130]
 */

const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../data/mesh.db');
const ALERT_THRESHOLD = process.argv.find(arg => arg.startsWith('--alert-threshold='))?.split('=')[1] || 130;
const ONCE_MODE = process.argv.includes('--once');
const QUIET_MODE = process.argv.includes('--quiet');

let Database;
try {
  Database = require('better-sqlite3');
} catch (e) {
  console.error('❌ better-sqlite3 not installed. Run: npm install better-sqlite3');
  process.exit(1);
}

let db;
try {
  db = new Database(DB_PATH);
} catch (e) {
  console.error(`❌ Could not open database at ${DB_PATH}:`, e.message);
  process.exit(1);
}

// Prepared statements for efficiency
const stmts = {
  activeNodes: db.prepare(`
    SELECT nodeId, name, capabilities, lastSeen, jobsCompleted 
    FROM nodes 
    WHERE lastSeen > ? 
    ORDER BY jobsCompleted DESC
  `),
  recentNodes: db.prepare(`
    SELECT nodeId, name, capabilities, lastSeen, jobsCompleted,
           (? - lastSeen) as ms_ago
    FROM nodes 
    WHERE lastSeen > ?
    ORDER BY lastSeen DESC
  `),
  pendingJobs: db.prepare(`
    SELECT type, COUNT(*) as count 
    FROM jobs 
    WHERE status = 'pending' 
    GROUP BY type 
    ORDER BY count DESC
  `),
  criticalCapabilities: db.prepare(`
    SELECT DISTINCT JSON_EXTRACT(requirements, '$.capability') as required_cap,
           COUNT(*) as blocked_jobs
    FROM jobs 
    WHERE status = 'pending'
    GROUP BY required_cap
    ORDER BY blocked_jobs DESC
  `)
};

function analyzeCapacity() {
  const now = Date.now();
  const activeThreshold = now - (2 * 60 * 1000); // 2 minutes
  const recentThreshold = now - (30 * 60 * 1000); // 30 minutes
  
  // Get current network status
  const activeNodes = stmts.activeNodes.all(activeThreshold);
  const recentNodes = stmts.recentNodes.all(now, recentThreshold);
  const pendingJobs = stmts.pendingJobs.all();
  const criticalCapabilities = stmts.criticalCapabilities.all();
  
  const totalPending = pendingJobs.reduce((sum, job) => sum + job.count, 0);
  
  // Analyze capacity situation
  const status = {
    timestamp: new Date().toISOString(),
    active_nodes: activeNodes.length,
    recent_nodes: recentNodes.length,
    total_pending_jobs: totalPending,
    critical: false,
    alerts: [],
    capacity_analysis: {
      active: activeNodes,
      recent_offline: recentNodes.filter(n => !activeNodes.find(a => a.nodeId === n.nodeId)),
      pending_by_type: pendingJobs,
      blocked_capabilities: criticalCapabilities
    }
  };
  
  // Critical situation detection
  if (activeNodes.length === 0) {
    status.critical = true;
    status.alerts.push({
      level: 'CRITICAL',
      type: 'COMPLETE_OUTAGE', 
      message: `Zero active nodes - complete service outage`,
      impact: `${totalPending} customer jobs blocked`
    });
  }
  
  if (totalPending >= ALERT_THRESHOLD) {
    status.critical = true;
    status.alerts.push({
      level: 'HIGH',
      type: 'CAPACITY_CRISIS',
      message: `${totalPending} pending jobs exceeds threshold (${ALERT_THRESHOLD})`,
      impact: 'Service degradation likely'
    });
  }
  
  // Check for specific capability gaps
  for (const cap of criticalCapabilities) {
    if (cap.required_cap && cap.blocked_jobs > 20) {
      const hasCapability = activeNodes.some(node => {
        try {
          const capabilities = JSON.parse(node.capabilities || '[]');
          return capabilities.includes(cap.required_cap);
        } catch (e) { return false; }
      });
      
      if (!hasCapability) {
        status.critical = true;
        status.alerts.push({
          level: 'HIGH',
          type: 'CAPABILITY_GAP',
          message: `No active nodes with '${cap.required_cap}' capability`,
          impact: `${cap.blocked_jobs} jobs blocked`
        });
      }
    }
  }
  
  // Recent disconnection analysis  
  const recentlyDisconnected = recentNodes.filter(n => 
    !activeNodes.find(a => a.nodeId === n.nodeId) && n.jobsCompleted > 50
  );
  
  for (const node of recentlyDisconnected) {
    if (node.ms_ago < 10 * 60 * 1000) { // Disconnected within 10 minutes
      status.alerts.push({
        level: 'MEDIUM',
        type: 'NODE_DISCONNECT',
        message: `High-value node '${node.name}' (${node.jobsCompleted} jobs) disconnected ${Math.round(node.ms_ago/60000)}min ago`,
        impact: 'Capacity reduction'
      });
    }
  }
  
  return status;
}

function formatOutput(status) {
  if (QUIET_MODE && !status.critical) return null;
  
  const lines = [];
  lines.push(`🔍 IC Mesh Capacity Monitor — ${status.timestamp}`);
  lines.push(`📊 Status: ${status.active_nodes} active nodes, ${status.total_pending_jobs} pending jobs`);
  
  if (status.critical) {
    lines.push(`🚨 CRITICAL SITUATION DETECTED`);
  }
  
  for (const alert of status.alerts) {
    const emoji = alert.level === 'CRITICAL' ? '🔥' : alert.level === 'HIGH' ? '⚠️' : '📢';
    lines.push(`${emoji} ${alert.level}: ${alert.message}`);
    lines.push(`   Impact: ${alert.impact}`);
  }
  
  if (status.capacity_analysis.active.length > 0) {
    lines.push(`\n✅ Active Nodes:`);
    for (const node of status.capacity_analysis.active) {
      const caps = JSON.parse(node.capabilities || '[]').join(', ');
      lines.push(`   • ${node.name} (${node.jobsCompleted} jobs) [${caps}]`);
    }
  }
  
  if (status.capacity_analysis.recent_offline.length > 0) {
    lines.push(`\n⏰ Recently Disconnected:`);
    for (const node of status.capacity_analysis.recent_offline) {
      const minsAgo = Math.round(node.ms_ago / 60000);
      lines.push(`   • ${node.name} (${node.jobsCompleted} jobs) - ${minsAgo}min ago`);
    }
  }
  
  if (status.capacity_analysis.pending_by_type.length > 0) {
    lines.push(`\n📋 Pending Jobs by Type:`);
    for (const job of status.capacity_analysis.pending_by_type) {
      lines.push(`   • ${job.type}: ${job.count}`);
    }
  }
  
  return lines.join('\n');
}

function saveAlert(status) {
  if (!status.critical) return;
  
  const alertDir = path.join(__dirname, '../alerts');
  if (!fs.existsSync(alertDir)) {
    fs.mkdirSync(alertDir, { recursive: true });
  }
  
  const alertFile = path.join(alertDir, `capacity-alert-${new Date().toISOString().split('T')[0]}.json`);
  
  let alerts = [];
  if (fs.existsSync(alertFile)) {
    try {
      alerts = JSON.parse(fs.readFileSync(alertFile, 'utf8'));
    } catch (e) { /* ignore corrupt file */ }
  }
  
  alerts.push(status);
  fs.writeFileSync(alertFile, JSON.stringify(alerts, null, 2));
  
  if (!QUIET_MODE) {
    console.log(`💾 Critical alert saved to ${alertFile}`);
  }
}

async function monitor() {
  try {
    const status = analyzeCapacity();
    const output = formatOutput(status);
    
    if (output) {
      console.log(output);
      console.log(); // Empty line for readability
    }
    
    if (status.critical) {
      saveAlert(status);
    }
    
    return status;
    
  } catch (error) {
    console.error('❌ Monitor error:', error.message);
    return null;
  }
}

// Main execution
if (ONCE_MODE) {
  monitor().then(status => {
    process.exit(status?.critical ? 1 : 0);
  });
} else {
  console.log('🎯 Starting IC Mesh Critical Capacity Monitor...');
  console.log(`📈 Alert threshold: ${ALERT_THRESHOLD} pending jobs`);
  console.log(`🔄 Check interval: 30 seconds`);
  console.log(`${QUIET_MODE ? '🤫 Quiet mode: only critical alerts' : '📢 Verbose mode: all status updates'}`);
  console.log();
  
  // Initial check
  monitor();
  
  // Continuous monitoring
  setInterval(monitor, 30 * 1000);
  
  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n👋 Capacity monitor shutting down...');
    db.close();
    process.exit(0);
  });
}