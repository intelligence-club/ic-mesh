#!/usr/bin/env node
/**
 * Health Dashboard - Consolidated System Status View
 * 
 * Provides a quick, comprehensive overview of IC Mesh system health
 * including service status, node availability, job queue, and key metrics.
 */

const Database = require('better-sqlite3');
const path = require('path');
const http = require('http');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'mesh.db');
const API_BASE = process.env.API_BASE || 'http://localhost:8333';
const NODE_TIMEOUT_MINUTES = 5; // Consider node offline after this

// Color codes for output
const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  reset: '\x1b[0m',
  bold: '\x1b[1m'
};

function colorize(text, color) {
  return `${colors[color]}${text}${colors.reset}`;
}

function formatTimestamp(timestamp) {
  return new Date(timestamp).toISOString().substring(0, 19).replace('T', ' ');
}

async function fetchApiStatus() {
  return new Promise((resolve) => {
    const req = http.get(`${API_BASE}/status`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(3000, () => {
      req.destroy();
      resolve(null);
    });
  });
}

async function getDatabaseStats() {
  try {
    const db = new Database(DB_PATH, { readonly: true });
    
    // Job statistics
    const jobStats = db.prepare(`
      SELECT status, COUNT(*) as count 
      FROM jobs 
      GROUP BY status
    `).all();
    
    const totalJobs = db.prepare('SELECT COUNT(*) as count FROM jobs').get().count;
    
    // Node statistics  
    const nodes = db.prepare(`
      SELECT nodeId, name, capabilities, lastSeen, jobsCompleted,
             datetime(lastSeen/1000, 'unixepoch') as lastSeenDate
      FROM nodes 
      ORDER BY lastSeen DESC
    `).all();
    
    const now = Date.now();
    const activeNodes = nodes.filter(node => 
      (now - node.lastSeen) / 1000 / 60 <= NODE_TIMEOUT_MINUTES
    );
    
    // Capability summary
    const allCapabilities = new Set();
    nodes.forEach(node => {
      try {
        const caps = JSON.parse(node.capabilities || '[]');
        caps.forEach(cap => allCapabilities.add(cap));
      } catch (e) {}
    });
    
    db.close();
    
    return {
      jobs: {
        total: totalJobs,
        byStatus: jobStats.reduce((acc, stat) => {
          acc[stat.status] = stat.count;
          return acc;
        }, {})
      },
      nodes: {
        total: nodes.length,
        active: activeNodes.length,
        list: nodes,
        activeList: activeNodes,
        capabilities: Array.from(allCapabilities).sort()
      }
    };
  } catch (error) {
    return { error: error.message };
  }
}

function renderHeader() {
  const now = new Date().toISOString().substring(0, 19).replace('T', ' ');
  console.log(colorize('═══════════════════════════════════════════════════', 'cyan'));
  console.log(colorize('🔍 IC MESH HEALTH DASHBOARD', 'bold'));
  console.log(colorize(`📅 ${now} UTC`, 'white'));
  console.log(colorize('═══════════════════════════════════════════════════', 'cyan'));
}

function renderServiceStatus(apiStatus, dbStats) {
  console.log(colorize('\n📊 SERVICE STATUS', 'bold'));
  console.log(colorize('─────────────────', 'cyan'));
  
  if (apiStatus) {
    const statusColor = apiStatus.nodes.active > 0 ? 'green' : 'red';
    const statusText = apiStatus.nodes.active > 0 ? 'OPERATIONAL' : 'OUTAGE';
    
    console.log(`🔥 Status: ${colorize(statusText, statusColor)}`);
    console.log(`📈 Uptime: ${Math.floor(apiStatus.uptime / 60 / 60)}h ${Math.floor((apiStatus.uptime / 60) % 60)}m`);
    console.log(`💻 Active Nodes: ${colorize(apiStatus.nodes.active, statusColor)}/${apiStatus.nodes.total}`);
    console.log(`🧮 Total Compute: ${apiStatus.compute.totalCores} cores, ${apiStatus.compute.totalRAM_GB}GB RAM`);
  } else {
    console.log(`🔥 Status: ${colorize('API UNREACHABLE', 'red')}`);
  }
}

function renderJobQueue(dbStats) {
  console.log(colorize('\n📋 JOB QUEUE', 'bold'));
  console.log(colorize('─────────────', 'cyan'));
  
  if (dbStats.error) {
    console.log(`❌ Database Error: ${dbStats.error}`);
    return;
  }
  
  const jobs = dbStats.jobs;
  console.log(`📊 Total Jobs: ${jobs.total}`);
  
  if (jobs.byStatus.completed) {
    console.log(`✅ Completed: ${colorize(jobs.byStatus.completed, 'green')}`);
  }
  if (jobs.byStatus.pending) {
    console.log(`⏳ Pending: ${colorize(jobs.byStatus.pending, 'yellow')}`);
  }
  if (jobs.byStatus.failed) {
    console.log(`❌ Failed: ${colorize(jobs.byStatus.failed, 'red')}`);
  }
  if (jobs.byStatus.claimed) {
    console.log(`🔄 In Progress: ${colorize(jobs.byStatus.claimed, 'blue')}`);
  }
  
  // Calculate success rate
  const completed = jobs.byStatus.completed || 0;
  const failed = jobs.byStatus.failed || 0;
  if (completed + failed > 0) {
    const successRate = Math.round((completed / (completed + failed)) * 100);
    const rateColor = successRate >= 90 ? 'green' : successRate >= 70 ? 'yellow' : 'red';
    console.log(`📈 Success Rate: ${colorize(`${successRate}%`, rateColor)}`);
  }
}

function renderNodeStatus(dbStats) {
  console.log(colorize('\n🖥️  NODE STATUS', 'bold'));
  console.log(colorize('───────────────', 'cyan'));
  
  if (dbStats.error) {
    console.log(`❌ Database Error: ${dbStats.error}`);
    return;
  }
  
  const nodes = dbStats.nodes;
  console.log(`🌐 Total Nodes: ${nodes.total}`);
  console.log(`🟢 Active: ${colorize(nodes.active, nodes.active > 0 ? 'green' : 'red')}`);
  console.log(`🔴 Offline: ${colorize(nodes.total - nodes.active, 'red')}`);
  
  // Show active nodes
  if (nodes.activeList.length > 0) {
    console.log(colorize('\n🟢 ACTIVE NODES:', 'green'));
    nodes.activeList.forEach(node => {
      const minutesAgo = Math.floor((Date.now() - node.lastSeen) / 1000 / 60);
      console.log(`   • ${node.name} (${node.nodeId.substring(0,8)}) - ${node.jobsCompleted} jobs, ${minutesAgo}m ago`);
    });
  }
  
  // Show offline nodes (most recent first, limit 5)
  const offlineNodes = nodes.list.filter(node => 
    (Date.now() - node.lastSeen) / 1000 / 60 > NODE_TIMEOUT_MINUTES
  ).slice(0, 5);
  
  if (offlineNodes.length > 0) {
    console.log(colorize('\n🔴 RECENT OFFLINE NODES:', 'red'));
    offlineNodes.forEach(node => {
      const minutesAgo = Math.floor((Date.now() - node.lastSeen) / 1000 / 60);
      const timeColor = minutesAgo < 60 ? 'yellow' : minutesAgo < 1440 ? 'red' : 'red';
      const timeText = minutesAgo < 60 ? `${minutesAgo}m` : 
                     minutesAgo < 1440 ? `${Math.floor(minutesAgo/60)}h` : 
                     `${Math.floor(minutesAgo/1440)}d`;
      console.log(`   • ${node.name} (${node.nodeId.substring(0,8)}) - ${node.jobsCompleted} jobs, ${colorize(timeText + ' ago', timeColor)}`);
    });
    
    if (nodes.total - nodes.active > 5) {
      console.log(`   ... and ${nodes.total - nodes.active - 5} more offline nodes`);
    }
  }
}

function renderCapabilities(dbStats) {
  console.log(colorize('\n🛠️  CAPABILITIES', 'bold'));
  console.log(colorize('────────────────', 'cyan'));
  
  if (dbStats.error || !dbStats.nodes.capabilities.length) {
    console.log('❌ No capabilities available');
    return;
  }
  
  const caps = dbStats.nodes.capabilities;
  const chunked = [];
  for (let i = 0; i < caps.length; i += 4) {
    chunked.push(caps.slice(i, i + 4));
  }
  
  chunked.forEach(chunk => {
    console.log(`   ${chunk.join(', ')}`);
  });
}

function renderFooter(dbStats) {
  console.log(colorize('\n💡 QUICK ACTIONS', 'bold'));
  console.log(colorize('─────────────────', 'cyan'));
  
  if (dbStats.nodes && dbStats.nodes.active === 0) {
    console.log('🔄 No active nodes - check for auto-reconnection or manual intervention needed');
  }
  
  if (dbStats.jobs && dbStats.jobs.byStatus.pending > 0) {
    console.log(`⏳ ${dbStats.jobs.byStatus.pending} jobs pending - may need node capacity`);
  }
  
  console.log('📊 Monitor: node monitor-primary-node-recovery.js');
  console.log('🔧 Database: sqlite3 data/mesh.db');
  console.log('📈 API: curl http://localhost:8333/status');
  
  console.log(colorize('\n═══════════════════════════════════════════════════\n', 'cyan'));
}

async function main() {
  renderHeader();
  
  console.log('🔍 Gathering system data...');
  
  const [apiStatus, dbStats] = await Promise.all([
    fetchApiStatus(),
    getDatabaseStats()
  ]);
  
  // Clear the "gathering" line
  process.stdout.write('\r\x1b[K');
  
  renderServiceStatus(apiStatus, dbStats);
  renderJobQueue(dbStats);
  renderNodeStatus(dbStats);
  renderCapabilities(dbStats);
  renderFooter(dbStats);
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { main };