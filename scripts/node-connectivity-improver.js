#!/usr/bin/env node
/**
 * Node Connectivity Improver - Diagnose and fix node connection issues
 * 
 * Analyzes node connectivity patterns to identify why nodes go offline
 * and provides solutions for improving network stability.
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../data/mesh.db');

async function analyzeConnectivity() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath);
    const analysis = {};

    db.serialize(() => {
      // Current connectivity status
      db.get(`
        SELECT 
          COUNT(*) as total,
          COUNT(CASE WHEN (CAST(strftime('%s', 'now') AS INTEGER) * 1000 - lastSeen) < 300000 THEN 1 END) as active_5min,
          COUNT(CASE WHEN (CAST(strftime('%s', 'now') AS INTEGER) * 1000 - lastSeen) < 600000 THEN 1 END) as active_10min,
          COUNT(CASE WHEN (CAST(strftime('%s', 'now') AS INTEGER) * 1000 - lastSeen) < 3600000 THEN 1 END) as active_1hour,
          COUNT(CASE WHEN (CAST(strftime('%s', 'now') AS INTEGER) * 1000 - lastSeen) < 86400000 THEN 1 END) as active_24hour
        FROM nodes
      `, (err, row) => {
        if (err) reject(err);
        analysis.connectivity = row;
      });

      // Individual node analysis
      db.all(`
        SELECT 
          nodeId,
          name,
          capabilities,
          flags,
          datetime(registeredAt/1000, 'unixepoch') as registeredTime,
          datetime(lastSeen/1000, 'unixepoch') as lastSeenTime,
          (lastSeen - registeredAt)/1000/60 as totalSessionMinutes,
          (CAST(strftime('%s', 'now') AS INTEGER) * 1000 - lastSeen)/1000/60 as minutesOffline,
          CASE 
            WHEN (CAST(strftime('%s', 'now') AS INTEGER) * 1000 - lastSeen) < 300000 THEN 'ACTIVE'
            WHEN (CAST(strftime('%s', 'now') AS INTEGER) * 1000 - lastSeen) < 3600000 THEN 'RECENT'
            WHEN (CAST(strftime('%s', 'now') AS INTEGER) * 1000 - lastSeen) < 86400000 THEN 'OFFLINE'
            ELSE 'DISCONNECTED'
          END as status
        FROM nodes
        ORDER BY lastSeen DESC
      `, (err, rows) => {
        if (err) reject(err);
        analysis.nodes = rows;

        // Process node data
        analysis.nodes.forEach(node => {
          try {
            node.flagsObj = JSON.parse(node.flags || '{}');
            node.isQuarantined = !!node.flagsObj.quarantined || !!node.flagsObj.quarantinedAt;
            node.capabilitiesArray = JSON.parse(node.capabilities || '[]');
          } catch (e) {
            node.flagsObj = {};
            node.isQuarantined = false;
            node.capabilitiesArray = [];
          }
        });

        db.close();
        resolve(analysis);
      });
    });
  });
}

function generateConnectivityReport(analysis) {
  console.log('🔗 Node Connectivity Analysis Report\n');

  // Overall connectivity health
  const { connectivity } = analysis;
  const activeRate = Math.round((connectivity.active_5min / connectivity.total) * 100);
  const recentRate = Math.round((connectivity.active_1hour / connectivity.total) * 100);

  console.log('📊 Network Connectivity Health:');
  console.log(`   Total nodes: ${connectivity.total}`);
  console.log(`   Active (5min): ${connectivity.active_5min} (${activeRate}%)`);
  console.log(`   Recent (1hr): ${connectivity.active_1hour} (${recentRate}%)`);
  console.log(`   Daily (24hr): ${connectivity.active_24hour} (${Math.round((connectivity.active_24hour/connectivity.total)*100)}%)`);
  console.log();

  // Individual node analysis
  console.log('🖥️  Individual Node Status:');
  analysis.nodes.forEach(node => {
    const statusIcon = node.status === 'ACTIVE' ? '🟢' : 
                      node.status === 'RECENT' ? '🟡' : 
                      node.status === 'OFFLINE' ? '🟠' : '🔴';
    const quarantineIcon = node.isQuarantined ? '🔒' : '';
    
    console.log(`   ${statusIcon}${quarantineIcon} ${node.name} (${node.status})`);
    console.log(`      Last seen: ${node.lastSeenTime} (${Math.round(node.minutesOffline)}m ago)`);
    console.log(`      Total session: ${Math.round(node.totalSessionMinutes)}m (${Math.round(node.totalSessionMinutes/60)}h)`);
    console.log(`      Capabilities: ${node.capabilitiesArray.join(', ')}`);
    
    if (node.isQuarantined) {
      console.log(`      🔒 QUARANTINED: ${JSON.stringify(node.flagsObj)}`);
    }
    console.log();
  });

  return analysis;
}

function generateConnectivityRecommendations(analysis) {
  const recommendations = [];
  const { connectivity, nodes } = analysis;

  console.log('🛠️  Connectivity Improvement Recommendations:\n');

  // Analyze connectivity patterns
  const activeNodes = nodes.filter(n => n.status === 'ACTIVE');
  const recentNodes = nodes.filter(n => n.status === 'RECENT');
  const offlineNodes = nodes.filter(n => n.status === 'OFFLINE');
  const quarantinedNodes = nodes.filter(n => n.isQuarantined);

  // Active node percentage too low
  if (connectivity.active_5min / connectivity.total < 0.5) {
    console.log('🚨 LOW ACTIVE NODE RATE:');
    console.log(`   Only ${connectivity.active_5min}/${connectivity.total} nodes active (${Math.round((connectivity.active_5min/connectivity.total)*100)}%)`);
    console.log('   Target: 60-80% nodes active simultaneously');
    recommendations.push({
      issue: 'Low active node rate',
      solutions: [
        'Implement heartbeat monitoring and auto-restart',
        'Improve connection resilience (WebSocket reconnection)',
        'Add node health monitoring and alerting',
        'Investigate network connectivity issues'
      ]
    });
    console.log();
  }

  // Quarantined nodes affecting capacity
  if (quarantinedNodes.length > 0) {
    console.log('🔒 QUARANTINED NODES REDUCING CAPACITY:');
    quarantinedNodes.forEach(node => {
      console.log(`   ${node.name}: ${JSON.stringify(node.flagsObj)}`);
    });
    recommendations.push({
      issue: 'Quarantined nodes reducing capacity',
      solutions: [
        'Investigate quarantine reasons (job failures, timeouts)',
        'Fix underlying issues (missing dependencies, resource limits)',  
        'Implement quarantine recovery procedures',
        'Add node diagnostics and repair tools'
      ]
    });
    console.log();
  }

  // Nodes with good session time but currently offline (connectivity issue)
  const goodSessionOffline = offlineNodes.filter(n => n.totalSessionMinutes > 120); // 2+ hours
  if (goodSessionOffline.length > 0) {
    console.log('📱 GOOD NODES TEMPORARILY OFFLINE (Connectivity Issue):');
    goodSessionOffline.forEach(node => {
      console.log(`   ${node.name}: ${Math.round(node.totalSessionMinutes/60)}h total session, offline ${Math.round(node.minutesOffline)}m`);
    });
    recommendations.push({
      issue: 'Reliable nodes experiencing connectivity drops',
      solutions: [
        'Implement automatic reconnection logic',
        'Add WebSocket keepalive/ping mechanisms',
        'Monitor network stability patterns',
        'Provide operator connectivity troubleshooting guide'
      ]
    });
    console.log();
  }

  // Very few total nodes (need growth)
  if (connectivity.total < 10) {
    console.log('📈 NETWORK SCALE CHALLENGE:');
    console.log(`   Only ${connectivity.total} total nodes registered`);
    console.log('   Healthy network needs 50+ nodes for redundancy');
    recommendations.push({
      issue: 'Network too small for robust operations',
      solutions: [
        'Accelerate operator onboarding campaigns',
        'Improve setup documentation and automation',
        'Create node operator incentive programs',
        'Focus on retention of existing nodes while growing'
      ]
    });
    console.log();
  }

  return recommendations;
}

function generateActionPlan(recommendations) {
  console.log('🎯 IMMEDIATE ACTION PLAN:\n');

  recommendations.forEach((rec, i) => {
    console.log(`${i + 1}. **${rec.issue}**`);
    rec.solutions.forEach(solution => {
      console.log(`   • ${solution}`);
    });
    console.log();
  });

  // Specific technical implementations
  console.log('⚡ Technical Implementation Priorities:\n');
  
  console.log('**Phase 1: Connection Reliability (Week 1)**');
  console.log('• Add WebSocket auto-reconnection with exponential backoff');
  console.log('• Implement heartbeat ping/pong for connection health');
  console.log('• Create node connectivity monitoring dashboard');
  console.log('• Build operator notification system for connection issues');
  console.log();

  console.log('**Phase 2: Health Recovery (Week 2)**');
  console.log('• Automated quarantine investigation and recovery');
  console.log('• Node diagnostic tools for operators');
  console.log('• Performance monitoring and optimization');
  console.log('• Connection quality metrics and alerts');
  console.log();

  console.log('**Phase 3: Scale and Retention (Week 3-4)**');
  console.log('• Operator onboarding automation');
  console.log('• Retention incentives and reputation system');
  console.log('• Network capacity planning and load balancing');
  console.log('• Community building and operator support');
  console.log();
}

async function run() {
  console.log('🔗 Node Connectivity Improver - Network Health Analysis\n');

  try {
    const analysis = await analyzeConnectivity();
    generateConnectivityReport(analysis);
    
    const recommendations = generateConnectivityRecommendations(analysis);
    generateActionPlan(recommendations);

    console.log('✅ Analysis complete. Recommendations ready for implementation.');

  } catch (error) {
    console.error('❌ Analysis failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  run();
}

module.exports = { analyzeConnectivity, generateConnectivityReport };