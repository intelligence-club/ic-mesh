#!/usr/bin/env node

/**
 * CRISIS DASHBOARD - Real-time outage monitoring and recovery tracking
 * Created during 2026-02-27 service outage for live situation awareness
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const db = new Database(path.join(__dirname, '../data/mesh.db'), { readonly: true });

function formatDuration(minutes) {
  if (minutes < 60) return `${minutes}min`;
  if (minutes < 1440) return `${Math.floor(minutes/60)}h ${minutes%60}min`;
  return `${Math.floor(minutes/1440)}d ${Math.floor((minutes%1440)/60)}h`;
}

function calculateRevenue(jobCount, avgJobValue = 0.35) {
  const low = Math.floor(jobCount * (avgJobValue - 0.05) * 100) / 100;
  const high = Math.floor(jobCount * (avgJobValue + 0.15) * 100) / 100;
  return `$${low}-${high}`;
}

function clearScreen() {
  console.clear();
  process.stdout.write('\x1B[H');
}

function runDashboard() {
  clearScreen();
  
  const now = Date.now();
  const ACTIVE_THRESHOLD = 5 * 60 * 1000; // 5 minutes
  
  console.log('🚨 IC MESH CRISIS DASHBOARD');
  console.log('═'.repeat(50));
  console.log(`⏰ ${new Date().toISOString()}`);
  console.log();
  
  // Service status
  const nodes = db.prepare(`
    SELECT nodeId, name, lastSeen, capabilities, jobsCompleted, owner 
    FROM nodes 
    ORDER BY lastSeen DESC
  `).all();
  
  let activeNodes = 0;
  let customerCapableNodes = 0;
  
  nodes.forEach(node => {
    const isActive = (now - node.lastSeen) <= ACTIVE_THRESHOLD;
    const capabilities = JSON.parse(node.capabilities || '[]');
    const canServeCustomers = capabilities.some(cap => 
      ['transcribe', 'transcription', 'whisper', 'ocr', 'tesseract', 'pdf-extract'].includes(cap)
    );
    
    if (isActive) {
      activeNodes++;
      if (canServeCustomers) customerCapableNodes++;
    }
  });
  
  // Job queue status
  const pendingJobs = db.prepare(`
    SELECT type, COUNT(*) as count 
    FROM jobs 
    WHERE status = 'pending' 
    GROUP BY type 
    ORDER BY count DESC
  `).all();
  
  const totalPending = pendingJobs.reduce((sum, job) => sum + job.count, 0);
  
  // Service status indicator
  let serviceStatus = '🟢 OPERATIONAL';
  let statusColor = '\x1b[32m'; // Green
  
  if (customerCapableNodes === 0 && totalPending > 0) {
    serviceStatus = '🔥 COMPLETE OUTAGE';
    statusColor = '\x1b[31m'; // Red
  } else if (customerCapableNodes === 1) {
    serviceStatus = '⚠️ DEGRADED (Single Node)';
    statusColor = '\x1b[33m'; // Yellow
  }
  
  console.log(`${statusColor}${serviceStatus}\x1b[0m`);
  console.log(`📊 Nodes: ${customerCapableNodes} customer-capable / ${activeNodes} active / ${nodes.length} total`);
  console.log(`📋 Queue: ${totalPending} pending jobs`);
  console.log(`💰 At Risk: ${calculateRevenue(totalPending)}`);
  console.log();
  
  // Critical offline nodes
  if (customerCapableNodes === 0) {
    console.log('🎯 CRITICAL OFFLINE NODES:');
    console.log('─'.repeat(40));
    
    nodes.forEach(node => {
      const minutesOffline = Math.floor((now - node.lastSeen) / 60000);
      const capabilities = JSON.parse(node.capabilities || '[]');
      const canServeCustomers = capabilities.some(cap => 
        ['transcribe', 'transcription', 'whisper', 'ocr', 'tesseract', 'pdf-extract'].includes(cap)
      );
      
      if (!canServeCustomers || (now - node.lastSeen) <= ACTIVE_THRESHOLD) return;
      
      console.log(`${node.nodeId.substring(0,8)} (${node.name || 'unnamed'})`);
      console.log(`  ⏱️ Offline: ${formatDuration(minutesOffline)}`);
      console.log(`  👤 Owner: ${node.owner || 'unknown'}`);
      console.log(`  ⚡ Performance: ${node.jobsCompleted} jobs`);
      console.log(`  🔧 Capabilities: ${capabilities.join(', ')}`);
      console.log();
    });
  }
  
  // Job queue breakdown
  if (totalPending > 0) {
    console.log('📋 PENDING JOBS:');
    console.log('─'.repeat(25));
    pendingJobs.forEach(job => {
      const revenue = calculateRevenue(job.count);
      console.log(`  ${job.type}: ${job.count} jobs (${revenue})`);
    });
    console.log();
  }
  
  // Recovery actions
  if (customerCapableNodes === 0) {
    console.log('🚀 RECOVERY ACTIONS:');
    console.log('─'.repeat(30));
    
    // Find best recovery targets
    const recoveryTargets = nodes.filter(node => {
      const capabilities = JSON.parse(node.capabilities || '[]');
      const canServeCustomers = capabilities.some(cap => 
        ['transcribe', 'transcription', 'whisper', 'ocr', 'tesseract', 'pdf-extract'].includes(cap)
      );
      return canServeCustomers && (now - node.lastSeen) > ACTIVE_THRESHOLD;
    }).sort((a, b) => b.jobsCompleted - a.jobsCompleted);
    
    recoveryTargets.slice(0, 3).forEach((node, i) => {
      const minutesOffline = Math.floor((now - node.lastSeen) / 60000);
      const capabilities = JSON.parse(node.capabilities || '[]');
      const owner = node.owner || 'unknown';
      
      console.log(`${i + 1}. ${node.nodeId.substring(0,8)} (${node.name || 'unnamed'})`);
      console.log(`   Owner: ${owner} | Offline: ${formatDuration(minutesOffline)}`);
      console.log(`   Performance: ${node.jobsCompleted} jobs`);
      if (owner === 'drake') {
        console.log(`   Action: Contact Drake - \`claw skill mesh-transcribe\``);
      } else {
        console.log(`   Action: Contact ${owner} for node revival`);
      }
      console.log();
    });
  }
  
  console.log('─'.repeat(50));
  console.log('Press Ctrl+C to exit | Refreshing every 30s...');
}

// Run dashboard
runDashboard();

// Auto-refresh every 30 seconds
const interval = setInterval(runDashboard, 30000);

// Clean exit
process.on('SIGINT', () => {
  clearInterval(interval);
  console.log('\n\n🏁 Crisis dashboard stopped.');
  process.exit(0);
});

db.close();