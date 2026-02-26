#!/usr/bin/env node
/**
 * Job Queue Fixer - Diagnose and fix job processing issues
 * 
 * Investigates why jobs aren't being processed despite having active nodes,
 * and provides solutions for common issues.
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../data/mesh.db');

async function analyzeQueue() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath);
    const analysis = {};

    db.serialize(() => {
      // Job status breakdown
      db.get(`
        SELECT 
          COUNT(*) as total,
          COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
          COUNT(CASE WHEN status = 'claimed' THEN 1 END) as claimed,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
          COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed
        FROM jobs
      `, (err, row) => {
        if (err) reject(err);
        analysis.jobStats = row;
      });

      // Pending jobs by type
      db.all(`
        SELECT type, COUNT(*) as count
        FROM jobs 
        WHERE status = 'pending'
        GROUP BY type
        ORDER BY count DESC
      `, (err, rows) => {
        if (err) reject(err);
        analysis.pendingByType = rows;
      });

      // Node status analysis  
      db.all(`
        SELECT 
          nodeId,
          name,
          capabilities,
          flags,
          datetime(lastSeen/1000, 'unixepoch') as lastSeenTime,
          (CAST(strftime('%s', 'now') AS INTEGER) * 1000 - lastSeen) / 60000 as minutesAgo,
          CASE 
            WHEN (CAST(strftime('%s', 'now') AS INTEGER) * 1000 - lastSeen) < 300000 THEN 'ACTIVE'
            WHEN (CAST(strftime('%s', 'now') AS INTEGER) * 1000 - lastSeen) < 600000 THEN 'RECENT'
            ELSE 'OFFLINE'
          END as status
        FROM nodes
        ORDER BY lastSeen DESC
      `, (err, rows) => {
        if (err) reject(err);
        analysis.nodes = rows;
        
        // Process quarantine status
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

async function fixIssues(analysis) {
  const fixes = [];

  // Find capability coverage gaps
  const pendingJobs = analysis.pendingByType;
  const activeNodes = analysis.nodes.filter(n => n.status === 'ACTIVE' && !n.isQuarantined);

  console.log('🔍 ISSUE ANALYSIS:');
  console.log();

  pendingJobs.forEach(job => {
    const capableNodes = activeNodes.filter(node => 
      node.capabilitiesArray.includes(job.type) || 
      (job.type === 'transcribe' && node.capabilitiesArray.includes('transcription'))
    );

    console.log(`📋 ${job.type}: ${job.count} pending jobs`);
    console.log(`   Capable active nodes: ${capableNodes.length}`);
    
    if (capableNodes.length > 0) {
      console.log(`   Nodes: ${capableNodes.map(n => n.name).join(', ')}`);
      console.log(`   ❓ ISSUE: Jobs not being claimed despite capable nodes`);
      fixes.push({
        issue: `${job.type} jobs not being claimed`,
        solution: 'Check job claiming system, node connectivity, or restart IC Mesh server'
      });
    } else {
      console.log(`   🚫 NO CAPABLE ACTIVE NODES`);
      
      // Check if there are quarantined nodes with this capability
      const quarantinedCapable = analysis.nodes.filter(n => 
        n.isQuarantined && (
          n.capabilitiesArray.includes(job.type) ||
          (job.type === 'transcribe' && n.capabilitiesArray.includes('transcription'))
        )
      );

      if (quarantinedCapable.length > 0) {
        console.log(`   🔒 Quarantined capable nodes: ${quarantinedCapable.map(n => n.name).join(', ')}`);
        fixes.push({
          issue: `No active nodes for ${job.type}, but quarantined nodes available`,
          solution: `Investigate and possibly unquarantine: ${quarantinedCapable.map(n => n.name).join(', ')}`
        });
      } else {
        fixes.push({
          issue: `No nodes with ${job.type} capability`,
          solution: 'Need to onboard nodes with this capability or restart existing nodes'
        });
      }
    }
    console.log();
  });

  return fixes;
}

async function run() {
  console.log('🔧 Job Queue Fixer - Diagnostic and Repair Tool\n');

  try {
    const analysis = await analyzeQueue();

    console.log('📊 QUEUE STATUS:');
    console.log(`   Total jobs: ${analysis.jobStats.total}`);
    console.log(`   Pending: ${analysis.jobStats.pending}`);
    console.log(`   Claimed: ${analysis.jobStats.claimed}`);
    console.log(`   Completed: ${analysis.jobStats.completed}`);
    console.log(`   Failed: ${analysis.jobStats.failed}`);
    console.log();

    console.log('🖥️  NODE STATUS:');
    analysis.nodes.forEach(node => {
      const statusIcon = node.status === 'ACTIVE' ? '🟢' : 
                        node.status === 'RECENT' ? '🟡' : '🔴';
      const quarantineIcon = node.isQuarantined ? '🔒' : '';
      console.log(`   ${statusIcon}${quarantineIcon} ${node.name} (${node.status})`);
      console.log(`      Last seen: ${node.lastSeenTime} (${Math.round(node.minutesAgo)}m ago)`);
      console.log(`      Capabilities: ${node.capabilitiesArray.join(', ')}`);
      if (node.isQuarantined) {
        console.log(`      🔒 QUARANTINED: ${JSON.stringify(node.flagsObj)}`);
      }
      console.log();
    });

    const fixes = await fixIssues(analysis);

    if (fixes.length > 0) {
      console.log('🛠️  RECOMMENDED FIXES:');
      fixes.forEach((fix, i) => {
        console.log(`   ${i + 1}. Issue: ${fix.issue}`);
        console.log(`      Solution: ${fix.solution}`);
        console.log();
      });
    } else {
      console.log('✅ No issues detected - queue appears healthy');
    }

  } catch (error) {
    console.error('❌ Analysis failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  run();
}

module.exports = { run, analyzeQueue };