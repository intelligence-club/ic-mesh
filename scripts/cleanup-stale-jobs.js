#!/usr/bin/env node
/**
 * IC Mesh Stale Job Cleanup
 * Removes old pending jobs that are unlikely to be processed
 * 
 * Criteria:
 * - Jobs older than 24 hours in pending status
 * - Jobs requiring capabilities with no active nodes
 * 
 * Usage: node scripts/cleanup-stale-jobs.js [--dry-run] [--age-hours=24]
 */

const Database = require('better-sqlite3');
const path = require('path');

// Configuration
const DRY_RUN = process.argv.includes('--dry-run');
const ageMatch = process.argv.find(arg => arg.startsWith('--age-hours='));
const MAX_AGE_HOURS = ageMatch ? parseInt(ageMatch.split('=')[1]) : 24;

console.log('🧹 IC Mesh Stale Job Cleanup');
console.log(`📅 Removing jobs older than ${MAX_AGE_HOURS} hours`);
console.log(`🔬 Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE (will delete)'}`);
console.log('');

// Database setup
const dbPath = path.join('/home/openclaw/.openclaw/workspace/ic-mesh/data/mesh.db');
const db = new Database(dbPath);

// Calculate cutoff time
const cutoffTime = Date.now() - (MAX_AGE_HOURS * 60 * 60 * 1000);
const cutoffDate = new Date(cutoffTime).toISOString();

console.log(`⏰ Cutoff time: ${cutoffDate}`);
console.log('');

// Analysis phase
console.log('📊 Analysis Phase');
console.log('================');

// Get stale job counts by type
const staleJobs = db.prepare(`
  SELECT type, COUNT(*) as count
  FROM jobs 
  WHERE status = 'pending' AND createdAt < ?
  GROUP BY type
  ORDER BY count DESC
`).all(cutoffTime);

console.log('📈 Stale jobs by type:');
let totalStale = 0;
staleJobs.forEach(job => {
  console.log(`  ${job.type}: ${job.count}`);
  totalStale += job.count;
});
console.log(`  TOTAL: ${totalStale}`);
console.log('');

// Check what capabilities are needed for stale jobs
const staleCapabilities = db.prepare(`
  SELECT 
    JSON_EXTRACT(requirements, '$.capability') as capability,
    COUNT(*) as count
  FROM jobs 
  WHERE status = 'pending' 
    AND createdAt < ?
    AND JSON_EXTRACT(requirements, '$.capability') IS NOT NULL
  GROUP BY capability
  ORDER BY count DESC
`).all(cutoffTime);

console.log('🔧 Required capabilities for stale jobs:');
staleCapabilities.forEach(cap => {
  console.log(`  ${cap.capability}: ${cap.count} jobs`);
});
console.log('');

// Check active nodes and their capabilities
const activeNodes = db.prepare(`
  SELECT nodeId, capabilities
  FROM nodes 
  WHERE lastSeen > ?
`).all(Date.now() - (10 * 60 * 1000)); // active in last 10 minutes

console.log('🖥️  Currently active nodes (last 10min):');
const availableCapabilities = new Set();
if (activeNodes.length === 0) {
  console.log('  None');
} else {
  activeNodes.forEach(node => {
    let caps;
    try {
      caps = JSON.parse(node.capabilities || '[]');
    } catch(e) {
      caps = [];
    }
    console.log(`  ${node.nodeId}: ${JSON.stringify(caps)}`);
    caps.forEach(cap => availableCapabilities.add(cap));
  });
}
console.log('');

// Identify jobs that can't be processed due to missing capabilities
console.log('🚨 Capability Gap Analysis:');
const impossibleJobs = [];
staleCapabilities.forEach(item => {
  const capability = item.capability;
  const aliases = {
    'transcription': 'whisper',
    'transcribe': 'whisper', 
    'ocr': 'tesseract',
    'pdf-extract': 'tesseract',
    'inference': 'ollama',
    'generate-image': 'stable-diffusion'
  };
  
  const aliased = aliases[capability] || capability;
  const canProcess = availableCapabilities.has(capability) || availableCapabilities.has(aliased);
  
  if (!canProcess) {
    impossibleJobs.push(item);
    console.log(`  ❌ ${capability} (${item.count} jobs) - no active nodes`);
  } else {
    console.log(`  ✅ ${capability} (${item.count} jobs) - can be processed`);
  }
});
console.log('');

// Cleanup phase
if (totalStale === 0) {
  console.log('✅ No stale jobs found. Database is clean!');
  db.close();
  process.exit(0);
}

console.log('🧹 Cleanup Phase');
console.log('===============');

if (DRY_RUN) {
  console.log('🔍 DRY RUN MODE - No changes will be made');
  console.log(`📝 Would remove ${totalStale} stale jobs older than ${MAX_AGE_HOURS} hours`);
} else {
  console.log(`🗑️  Removing ${totalStale} stale jobs...`);
  
  // Delete stale jobs
  const deleteResult = db.prepare(`
    DELETE FROM jobs 
    WHERE status = 'pending' AND createdAt < ?
  `).run(cutoffTime);
  
  console.log(`✅ Removed ${deleteResult.changes} stale jobs`);
  
  // Log the cleanup operation
  const logEntry = {
    timestamp: new Date().toISOString(),
    action: 'stale_job_cleanup',
    criteria: `older_than_${MAX_AGE_HOURS}h`,
    removed_jobs: deleteResult.changes,
    cutoff_time: cutoffDate
  };
  
  console.log('📝 Cleanup completed:');
  console.log(`  Removed: ${deleteResult.changes} jobs`);
  console.log(`  Criteria: older than ${MAX_AGE_HOURS} hours`);
  console.log(`  Cutoff: ${cutoffDate}`);
}

console.log('');
console.log('📈 Final Status Check:');

// Final job counts
const finalCounts = db.prepare(`
  SELECT status, COUNT(*) as count 
  FROM jobs 
  GROUP BY status
`).all();

console.log('📊 Updated job distribution:');
finalCounts.forEach(status => {
  console.log(`  ${status.status}: ${status.count}`);
});

db.close();

console.log('');
console.log('✅ Stale job cleanup complete');