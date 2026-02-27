#!/usr/bin/env node
/**
 * IC Mesh Capacity Advisor
 * Analyzes current capacity and suggests optimizations
 */

const Database = require('better-sqlite3');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_PATH = process.env.DATABASE_PATH || path.join(DATA_DIR, 'mesh.db');

const db = new Database(DB_PATH, { readonly: true });

console.log('🎯 IC Mesh Capacity Analysis & Recommendations');
console.log('');

// Capability mapping for job requirements  
const capabilityAliases = {
  'transcription': 'whisper',
  'transcribe': 'whisper',
  'ocr': 'tesseract',
  'pdf-extract': 'tesseract',
  'inference': 'ollama',
  'generate-image': 'stable-diffusion'
};

function analyzeCurrentState() {
  // Current job queue
  const queueStats = db.prepare(`
    SELECT status, type, COUNT(*) as count
    FROM jobs
    GROUP BY status, type
    ORDER BY status, type
  `).all();
  
  // Active nodes and their capabilities
  const nodes = db.prepare(`
    SELECT 
      nodeId, 
      name, 
      capabilities,
      flags,
      (strftime('%s', 'now') * 1000 - lastSeen) / 1000 / 60 as minutesOffline
    FROM nodes
    WHERE (strftime('%s', 'now') * 1000 - lastSeen) / 1000 / 60 < 1440
    ORDER BY minutesOffline
  `).all();
  
  return { queueStats, nodes };
}

function analyzeCapabilityGaps(queueStats, nodes) {
  const pendingByType = {};
  const processingByType = {};
  
  queueStats.forEach(row => {
    if (row.status === 'pending') {
      pendingByType[row.type] = row.count;
    } else if (row.status === 'claimed') {
      processingByType[row.type] = row.count;
    }
  });
  
  // Map job types to required capabilities
  const jobCapabilities = {};
  Object.keys(pendingByType).forEach(jobType => {
    jobCapabilities[jobType] = capabilityAliases[jobType] || jobType;
  });
  
  // Count available capacity for each capability
  const availableCapacity = {};
  nodes.forEach(node => {
    const flags = JSON.parse(node.flags || '{}');
    const isQuarantined = flags.quarantined;
    
    if (!isQuarantined) {
      const capabilities = JSON.parse(node.capabilities || '[]');
      capabilities.forEach(cap => {
        availableCapacity[cap] = (availableCapacity[cap] || 0) + 1;
      });
    }
  });
  
  return {
    pendingByType,
    processingByType,
    jobCapabilities,
    availableCapacity,
    activeNodes: nodes.filter(n => {
      const flags = JSON.parse(n.flags || '{}');
      return !flags.quarantined && n.minutesOffline < 10;
    }).length,
    quarantinedNodes: nodes.filter(n => JSON.parse(n.flags || '{}').quarantined).length
  };
}

function generateRecommendations(analysis) {
  const recommendations = [];
  let priority = 1;
  
  // Check for capacity gaps
  Object.entries(analysis.pendingByType).forEach(([jobType, pendingCount]) => {
    const requiredCap = analysis.jobCapabilities[jobType];
    const availableCap = analysis.availableCapacity[requiredCap] || 0;
    const processingCap = analysis.processingByType[jobType] || 0;
    
    if (availableCap === 0) {
      recommendations.push({
        priority: priority++,
        type: 'CAPABILITY_GAP',
        severity: 'HIGH',
        message: `No healthy nodes available for ${jobType} jobs (${pendingCount} pending)`,
        detail: `Required capability: ${requiredCap}`,
        action: `Repair quarantined nodes with ${requiredCap} or onboard new nodes`
      });
    } else if (pendingCount > 20 && availableCap === 1) {
      recommendations.push({
        priority: priority++,
        type: 'CAPACITY_BOTTLENECK',
        severity: 'MEDIUM', 
        message: `Single node handling ${jobType} jobs (${pendingCount} pending, ${processingCap} processing)`,
        detail: `Only 1 healthy node with ${requiredCap} capability available`,
        action: `Scale capacity: add more ${requiredCap} nodes or optimize processing speed`
      });
    }
  });
  
  // Check quarantine situation
  if (analysis.quarantinedNodes > 0) {
    recommendations.push({
      priority: priority++,
      type: 'QUARANTINE_REVIEW',
      severity: analysis.activeNodes === 0 ? 'HIGH' : 'LOW',
      message: `${analysis.quarantinedNodes} nodes quarantined, ${analysis.activeNodes} healthy`,
      detail: 'Quarantined nodes may have recoverable capabilities',
      action: 'Review quarantine reasons and attempt repairs where possible'
    });
  }
  
  // Performance recommendations
  if (Object.values(analysis.pendingByType).reduce((a, b) => a + b, 0) > 50) {
    recommendations.push({
      priority: priority++,
      type: 'QUEUE_BACKLOG',
      severity: 'MEDIUM',
      message: `Large queue backlog detected`,
      detail: `${Object.values(analysis.pendingByType).reduce((a, b) => a + b, 0)} total pending jobs`,
      action: 'Consider temporary capacity scaling or job prioritization'
    });
  }
  
  return recommendations.sort((a, b) => a.priority - b.priority);
}

// Main analysis
const { queueStats, nodes } = analyzeCurrentState();
const analysis = analyzeCapabilityGaps(queueStats, nodes);
const recommendations = generateRecommendations(analysis);

// Display results
console.log('📊 Current Capacity Status:');
console.log(`   Active healthy nodes: ${analysis.activeNodes}`);
console.log(`   Quarantined nodes: ${analysis.quarantinedNodes}`);
console.log('');

console.log('🔧 Available Capabilities:');
Object.entries(analysis.availableCapacity).forEach(([cap, count]) => {
  console.log(`   ${cap}: ${count} node${count === 1 ? '' : 's'}`);
});
console.log('');

console.log('📋 Pending Jobs by Type:');
Object.entries(analysis.pendingByType).forEach(([type, count]) => {
  const requiredCap = analysis.jobCapabilities[type];
  const availableCap = analysis.availableCapacity[requiredCap] || 0;
  const status = availableCap > 0 ? '✅' : '❌';
  console.log(`   ${type}: ${count} pending ${status} (needs: ${requiredCap}, available: ${availableCap})`);
});
console.log('');

if (recommendations.length > 0) {
  console.log('💡 Capacity Recommendations:');
  recommendations.forEach((rec, index) => {
    const icon = rec.severity === 'HIGH' ? '🚨' : rec.severity === 'MEDIUM' ? '⚠️' : 'ℹ️';
    console.log(`${index + 1}. ${icon} ${rec.message}`);
    console.log(`   ${rec.detail}`);
    console.log(`   Action: ${rec.action}`);
    console.log('');
  });
} else {
  console.log('✅ No capacity issues detected. System operating optimally.');
}

db.close();