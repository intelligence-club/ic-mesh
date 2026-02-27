#!/usr/bin/env node
/**
 * Infrastructure Health Monitor - Real-time monitoring of IC Mesh
 */

const serverUrl = 'http://localhost:8333';

async function getStatus() {
  try {
    const response = await fetch(`${serverUrl}/status`);
    return await response.json();
  } catch (error) {
    return { error: error.message };
  }
}

async function getNodes() {
  try {
    const response = await fetch(`${serverUrl}/nodes`);
    return await response.json();
  } catch (error) {
    return { error: error.message };
  }
}

function formatUptime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
}

function formatTimestamp(timestamp) {
  return new Date(timestamp).toLocaleTimeString();
}

async function displayStatus() {
  console.clear();
  console.log('🔍 IC MESH INFRASTRUCTURE MONITOR');
  console.log('═══════════════════════════════════════');
  
  const status = await getStatus();
  const nodes = await getNodes();
  
  if (status.error) {
    console.log('❌ Server not responding:', status.error);
    return;
  }
  
  // Server Health
  console.log('📊 SERVER STATUS:');
  console.log(`   Network: ${status.network} v${status.version}`);
  console.log(`   Status: ${status.status} (uptime: ${formatUptime(status.uptime)})`);
  console.log(`   WebSocket: ${status.websocket.connected} connections`);
  
  // Jobs Overview
  console.log('\n📋 JOB QUEUE:');
  const jobStats = status.jobs;
  const completionRate = ((jobStats.completed / jobStats.total) * 100).toFixed(1);
  console.log(`   Total: ${jobStats.total} | Completed: ${jobStats.completed} (${completionRate}%)`);
  console.log(`   Pending: ${jobStats.pending} jobs waiting`);
  
  // Progress tracking (simple estimate)
  const progressBar = '█'.repeat(Math.floor(completionRate / 5)) + '░'.repeat(20 - Math.floor(completionRate / 5));
  console.log(`   Progress: [${progressBar}] ${completionRate}%`);
  
  // Node Status
  console.log('\n🖥️  COMPUTE NODES:');
  console.log(`   Active: ${status.nodes.active}/${status.nodes.total}`);
  console.log(`   Capabilities: ${status.compute.capabilities.join(', ')}`);
  console.log(`   Resources: ${status.compute.totalCores} cores, ${status.compute.totalRAM_GB.toFixed(1)}GB RAM`);
  
  if (nodes.nodes) {
    console.log('\n🟢 ACTIVE NODES:');
    Object.values(nodes.nodes).forEach(node => {
      const lastSeen = formatTimestamp(node.lastSeen);
      const ramUsage = ((node.resources.ramMB - node.resources.ramFreeMB) / node.resources.ramMB * 100).toFixed(0);
      console.log(`   ${node.name}: ${node.capabilities.join('+')} | ${node.jobsCompleted} jobs | ${ramUsage}% RAM | Last seen: ${lastSeen}`);
    });
  }
  
  // Economics
  if (status.economics) {
    console.log('\n💰 ECONOMICS:');
    console.log(`   Compute Minutes: ${status.economics.totalComputeMinutes.toFixed(2)}`);
    console.log(`   Treasury: ${status.economics.treasuryMinutes.toFixed(2)} minutes`);
  }
  
  console.log('\n⏰ Last updated:', new Date().toLocaleTimeString());
  console.log('   Press Ctrl+C to exit');
}

// Display status once for quick check
displayStatus().then(() => {
  console.log('\n💡 Run with "watch" for continuous monitoring:');
  console.log('   watch -n 10 node monitor-infrastructure.js');
}).catch(console.error);