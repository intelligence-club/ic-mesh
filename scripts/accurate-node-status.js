#!/usr/bin/env node

/**
 * ACCURATE NODE STATUS - Real-time node availability analysis
 * Created during 2026-02-27 service outage to fix monitoring inconsistencies
 */

const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '../data/mesh.db'), { readonly: true });

console.log('🔍 ACCURATE NODE STATUS ANALYSIS');
console.log('=====================================');

const ACTIVE_THRESHOLD = 5 * 60 * 1000; // 5 minutes
const now = Date.now();

// Get all nodes with comprehensive data
const nodes = db.prepare(`
  SELECT nodeId, name, lastSeen, capabilities, jobsCompleted, owner 
  FROM nodes 
  ORDER BY lastSeen DESC
`).all();

console.log(`📊 Network Status (${new Date().toISOString()})`);
console.log('────────────────────────────────────────');

let activeNodes = 0;
let customerCapableNodes = 0;
const offlineNodes = [];

nodes.forEach(node => {
  const minutesOffline = Math.floor((now - node.lastSeen) / 60000);
  const isActive = (now - node.lastSeen) <= ACTIVE_THRESHOLD;
  const capabilities = JSON.parse(node.capabilities || '[]');
  const canServeCustomers = capabilities.some(cap => 
    ['transcribe', 'transcription', 'whisper', 'ocr', 'tesseract', 'pdf-extract'].includes(cap)
  );
  
  if (isActive) {
    activeNodes++;
    if (canServeCustomers) customerCapableNodes++;
  }
  
  const status = isActive ? '🟢 ONLINE' : '🔴 OFFLINE';
  const customerStatus = canServeCustomers ? '💼 CUSTOMER' : '🔧 TEST-ONLY';
  
  console.log(`${node.nodeId.substring(0,8)} (${node.name || 'unnamed'})`);
  console.log(`  ${status} | ${customerStatus} | ${minutesOffline}min ago`);
  console.log(`  Capabilities: ${capabilities.join(', ')}`);
  console.log(`  Jobs completed: ${node.jobsCompleted}`);
  console.log('');
  
  if (!isActive && canServeCustomers) {
    offlineNodes.push({
      nodeId: node.nodeId.substring(0,8),
      name: node.name || 'unnamed',
      minutesOffline,
      capabilities,
      jobsCompleted: node.jobsCompleted,
      owner: node.owner
    });
  }
});

// Get pending job counts
const pendingJobs = db.prepare(`
  SELECT type, COUNT(*) as count 
  FROM jobs 
  WHERE status = 'pending' 
  GROUP BY type 
  ORDER BY count DESC
`).all();

const totalPending = pendingJobs.reduce((sum, job) => sum + job.count, 0);

console.log('🚨 CRISIS SUMMARY');
console.log('────────────────────────────────────────');
console.log(`Active nodes: ${activeNodes}/${nodes.length}`);
console.log(`Customer-capable nodes: ${customerCapableNodes}/${activeNodes}`);
console.log(`Pending customer jobs: ${totalPending}`);

if (customerCapableNodes === 0 && totalPending > 0) {
  console.log('🔥 CRITICAL: COMPLETE SERVICE OUTAGE');
  console.log('   No customer-capable nodes online');
  console.log('   All customer requests failing');
} else if (customerCapableNodes === 1) {
  console.log('⚠️  WARNING: Single point of failure');
} else if (customerCapableNodes >= 2) {
  console.log('✅ Service operational with redundancy');
}

if (offlineNodes.length > 0) {
  console.log('\n🎯 OFFLINE NODES (customer-capable):');
  offlineNodes.forEach(node => {
    console.log(`  ${node.nodeId} (${node.name}): ${node.minutesOffline}min offline`);
    console.log(`    Owner: ${node.owner || 'unknown'}`);
    console.log(`    Performance: ${node.jobsCompleted} jobs completed`);
    console.log(`    Capabilities: ${node.capabilities.join(', ')}`);
  });
}

if (pendingJobs.length > 0) {
  console.log('\n📋 PENDING JOB QUEUE:');
  pendingJobs.forEach(job => {
    console.log(`  ${job.type}: ${job.count} jobs`);
  });
}

db.close();