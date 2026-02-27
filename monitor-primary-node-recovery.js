#!/usr/bin/env node
/**
 * Monitor for primary transcription node recovery
 * Watches for unnamed node (5ef95d698bdfa57a) to reconnect
 * Based on historical pattern of auto-reconnection within 5-60 minutes
 */

const Database = require('better-sqlite3');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'mesh.db');

// Target node details
const PRIMARY_NODE_ID = '5ef95d698bdfa57a';
const PRIMARY_NODE_NAME = 'unnamed';
const REQUIRED_CAPABILITIES = ['transcription', 'transcribe'];

// Timing configuration  
const CHECK_INTERVAL_SECONDS = 30;
const NODE_TIMEOUT_MINUTES = 5; // Consider node offline after this many minutes
const MAX_MONITOR_MINUTES = 90; // Stop monitoring after this timeout

function formatTimestamp(timestamp) {
  return new Date(timestamp).toISOString().replace('T', ' ').substring(0, 19);
}

function checkPrimaryNodeStatus() {
  try {
    const db = new Database(DB_PATH, { readonly: true });
    
    // Get primary node status
    const node = db.prepare(`
      SELECT nodeId, name, capabilities, lastSeen, jobsCompleted,
             datetime(lastSeen/1000, 'unixepoch') as lastSeenDate
      FROM nodes 
      WHERE nodeId = ?
    `).get(PRIMARY_NODE_ID);

    if (!node) {
      console.log(`❌ PRIMARY NODE NOT FOUND: ${PRIMARY_NODE_ID}`);
      return { status: 'missing', node: null };
    }

    const now = Date.now();
    const minutesOffline = Math.floor((now - node.lastSeen) / 1000 / 60);
    const isOnline = minutesOffline <= NODE_TIMEOUT_MINUTES;

    const status = {
      status: isOnline ? 'online' : 'offline',
      node: node,
      minutesOffline: minutesOffline,
      isRecovered: isOnline
    };

    // Check for pending transcription jobs that could be processed
    const pendingTranscribeJobs = db.prepare(`
      SELECT COUNT(*) as count 
      FROM jobs 
      WHERE status = 'pending' 
      AND (requirements LIKE '%"transcription"%' OR requirements LIKE '%"transcribe"%')
    `).get().count;

    status.pendingJobs = pendingTranscribeJobs;

    db.close();
    return status;
    
  } catch (error) {
    console.error('❌ Database error:', error.message);
    return { status: 'error', error: error.message };
  }
}

function displayStatus(result) {
  const timestamp = new Date().toISOString().substring(11, 19);
  
  if (result.status === 'error') {
    console.log(`[${timestamp}] ❌ ERROR: ${result.error}`);
    return;
  }
  
  if (result.status === 'missing') {
    console.log(`[${timestamp}] ❌ PRIMARY NODE MISSING FROM DATABASE`);
    return;
  }
  
  const { node, minutesOffline, isRecovered, pendingJobs } = result;
  const statusIcon = isRecovered ? '✅' : '❌';
  const statusText = isRecovered ? 'ONLINE' : `OFFLINE (${minutesOffline}m)`;
  
  console.log(`[${timestamp}] ${statusIcon} ${node.name} (${node.nodeId.substring(0,8)}): ${statusText}`);
  console.log(`            Last seen: ${node.lastSeenDate} UTC`);
  console.log(`            Jobs completed: ${node.jobsCompleted}`);
  console.log(`            Pending transcribe jobs: ${pendingJobs}`);
  
  if (isRecovered) {
    console.log(`\n🎉 RECOVERY DETECTED! Primary transcription service restored.`);
    console.log(`📊 Service Status: OPERATIONAL (${node.jobsCompleted} jobs completed)`);
    console.log(`🔄 Can process ${pendingJobs} pending transcription jobs\n`);
    return true; // Signal recovery detected
  }
  
  return false;
}

function main() {
  console.log('🔍 MONITORING PRIMARY NODE RECOVERY');
  console.log('===================================');
  console.log(`Target: ${PRIMARY_NODE_NAME} (${PRIMARY_NODE_ID})`);
  console.log(`Capabilities: ${REQUIRED_CAPABILITIES.join(', ')}`);
  console.log(`Check interval: ${CHECK_INTERVAL_SECONDS}s`);
  console.log(`Node timeout: ${NODE_TIMEOUT_MINUTES}m`);
  console.log(`Max monitor time: ${MAX_MONITOR_MINUTES}m\n`);

  let monitorStart = Date.now();
  let checkCount = 0;

  const monitor = () => {
    checkCount++;
    const result = checkPrimaryNodeStatus();
    const recovered = displayStatus(result);
    
    if (recovered) {
      console.log('🏁 Monitoring complete - service recovered!');
      process.exit(0);
    }
    
    // Check if we've exceeded max monitoring time
    const monitorMinutes = (Date.now() - monitorStart) / 1000 / 60;
    if (monitorMinutes > MAX_MONITOR_MINUTES) {
      console.log(`\n⏰ Max monitoring time exceeded (${MAX_MONITOR_MINUTES}m)`);
      console.log('🔔 Consider manual intervention or contacting node operator');
      console.log('📋 See SERVICE-STATUS-REPORT for escalation procedures');
      process.exit(1);
    }
    
    // Schedule next check
    setTimeout(monitor, CHECK_INTERVAL_SECONDS * 1000);
  };

  // Initial check
  monitor();
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n🛑 Monitoring stopped by user');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n\n🛑 Monitoring stopped');
  process.exit(0);
});

if (require.main === module) {
  main();
}