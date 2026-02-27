#!/usr/bin/env node

/**
 * Quick capacity status check for work pulses
 * Shows job backlog vs available capacity in seconds
 */

const Database = require('better-sqlite3');
const db = new Database('./data/mesh.db', { readonly: true });

function checkCapacityStatus() {
  try {
    // Get pending jobs by type
    const pendingJobs = db.prepare(`
      SELECT type, COUNT(*) as count 
      FROM jobs 
      WHERE status = 'pending' 
      GROUP BY type 
      ORDER BY count DESC
    `).all();

    // Get active nodes (last seen within 5 minutes)
    const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
    const activeNodes = db.prepare(`
      SELECT nodeId, name, capabilities, 
             ROUND((? - lastSeen) / 1000) as secondsAgo
      FROM nodes 
      WHERE lastSeen > ?
      ORDER BY lastSeen DESC
    `).all(Date.now(), fiveMinutesAgo);

    // Get all nodes with capabilities for gap analysis
    const allNodes = db.prepare(`
      SELECT nodeId, name, capabilities, 
             ROUND((? - lastSeen) / 1000) as secondsAgo,
             CASE WHEN lastSeen > ? THEN 'ONLINE' ELSE 'OFFLINE' END as status
      FROM nodes 
      ORDER BY lastSeen DESC
    `).all(Date.now(), fiveMinutesAgo);

    console.log('⚡ IC Mesh Capacity Status\n');

    // Job backlog summary
    console.log('📋 Pending Jobs:');
    let totalPending = 0;
    pendingJobs.forEach(job => {
      console.log(`  ${job.type}: ${job.count}`);
      totalPending += job.count;
    });
    console.log(`  TOTAL: ${totalPending}\n`);

    // Active capacity
    console.log('🟢 Active Nodes (last 5min):');
    if (activeNodes.length === 0) {
      console.log('  ❌ NO ACTIVE NODES - CRITICAL OUTAGE\n');
    } else {
      activeNodes.forEach(node => {
        const caps = JSON.parse(node.capabilities);
        console.log(`  ${node.name} (${node.nodeId.substring(0,8)}): ${caps.join(', ')} - ${node.secondsAgo}s ago`);
      });
      console.log('');
    }

    // Capability gap analysis
    const jobTypes = ['transcribe', 'pdf-extract', 'ocr', 'generate', 'stable-diffusion'];
    const capabilityMap = {
      'transcribe': ['transcribe', 'transcription'],
      'pdf-extract': ['pdf-extract'],
      'ocr': ['tesseract', 'ocr'],
      'generate': ['generate', 'ollama'],
      'stable-diffusion': ['stable-diffusion']
    };

    console.log('🔍 Capability Coverage:');
    jobTypes.forEach(jobType => {
      const requiredCaps = capabilityMap[jobType] || [jobType];
      const pendingCount = pendingJobs.find(j => j.type === jobType)?.count || 0;
      
      const capableNodes = allNodes.filter(node => {
        const caps = JSON.parse(node.capabilities);
        return requiredCaps.some(reqCap => caps.includes(reqCap));
      });
      
      const activeCapableNodes = capableNodes.filter(n => n.status === 'ONLINE');
      
      if (pendingCount > 0 || capableNodes.length <= 2) {
        const status = activeCapableNodes.length > 0 ? '🟢' : (capableNodes.length > 0 ? '🟡' : '🔴');
        console.log(`  ${status} ${jobType}: ${activeCapableNodes.length} active / ${capableNodes.length} total${pendingCount > 0 ? ` (${pendingCount} pending)` : ''}`);
        
        if (activeCapableNodes.length === 0 && capableNodes.length > 0) {
          const offlineNodes = capableNodes.filter(n => n.status === 'OFFLINE');
          console.log(`    ⚠️  Offline: ${offlineNodes.map(n => `${n.name} (${Math.floor(n.secondsAgo/3600)}h ago)`).join(', ')}`);
        }
      }
    });

    // Quick status summary
    const activeCount = activeNodes.length;
    const totalNodes = allNodes.length;
    const blockedJobTypes = jobTypes.filter(jobType => {
      const requiredCaps = capabilityMap[jobType] || [jobType];
      const pendingCount = pendingJobs.find(j => j.type === jobType)?.count || 0;
      const activeCapableNodes = allNodes.filter(node => {
        const caps = JSON.parse(node.capabilities);
        return requiredCaps.some(reqCap => caps.includes(reqCap)) && node.status === 'ONLINE';
      });
      return pendingCount > 0 && activeCapableNodes.length === 0;
    });

    console.log(`\n⚡ Status: ${activeCount}/${totalNodes} nodes active, ${totalPending} jobs pending`);
    if (blockedJobTypes.length > 0) {
      console.log(`🚨 BLOCKED: ${blockedJobTypes.join(', ')} jobs cannot be processed (no active capable nodes)`);
    }

  } catch (error) {
    console.error('❌ Error checking capacity:', error.message);
    process.exit(1);
  } finally {
    db.close();
  }
}

// Run immediately
checkCapacityStatus();