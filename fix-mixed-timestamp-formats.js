#!/usr/bin/env node

/**
 * Fix Mixed Timestamp Formats
 * Problem: createdAt in seconds, claimedAt/completedAt in milliseconds
 * This causes wildly incorrect performance calculations
 */

const Database = require('better-sqlite3');

const db = new Database('./data/mesh.db');

console.log('🔧 IC Mesh Mixed Timestamp Format Fix');
console.log('=====================================');

// Check the current timestamp inconsistencies
console.log('\n1. Analyzing timestamp format inconsistencies...');

const analysis = db.prepare(`
  SELECT 
    COUNT(*) as total,
    COUNT(CASE WHEN createdAt < 2000000000 THEN 1 END) as created_seconds,
    COUNT(CASE WHEN createdAt >= 2000000000 THEN 1 END) as created_milliseconds,
    COUNT(CASE WHEN claimedAt < 2000000000 THEN 1 END) as claimed_seconds, 
    COUNT(CASE WHEN claimedAt >= 2000000000 THEN 1 END) as claimed_milliseconds,
    COUNT(CASE WHEN completedAt < 2000000000 THEN 1 END) as completed_seconds,
    COUNT(CASE WHEN completedAt >= 2000000000 THEN 1 END) as completed_milliseconds
  FROM jobs
`).get();

console.log(`   Total jobs: ${analysis.total}`);
console.log(`   createdAt in seconds: ${analysis.created_seconds}`);
console.log(`   createdAt in milliseconds: ${analysis.created_milliseconds}`);
console.log(`   claimedAt in seconds: ${analysis.claimed_seconds}`);
console.log(`   claimedAt in milliseconds: ${analysis.claimed_milliseconds}`);
console.log(`   completedAt in seconds: ${analysis.completed_seconds}`);
console.log(`   completedAt in milliseconds: ${analysis.completed_milliseconds}`);

// Show some examples of the problematic cases
console.log('\n2. Examples of timestamp inconsistencies:');
const examples = db.prepare(`
  SELECT jobId, createdAt, claimedAt, completedAt, 
         (completedAt - createdAt) as raw_duration_calc,
         (completedAt - createdAt) / (1000 * 60 * 60) as duration_hours
  FROM jobs 
  WHERE status = 'completed' AND completedAt IS NOT NULL
  ORDER BY (completedAt - createdAt) DESC
  LIMIT 3
`).all();

examples.forEach(job => {
  console.log(`   ${job.jobId}: ${job.duration_hours.toFixed(1)} hours (${job.createdAt} → ${job.completedAt})`);
});

// Fix the timestamps by converting createdAt from seconds to milliseconds
console.log('\n3. Fixing timestamp format inconsistencies...');

const transaction = db.transaction(() => {
  // Update createdAt values that appear to be in seconds (< 2000000000) to milliseconds
  const result = db.prepare(`
    UPDATE jobs 
    SET createdAt = createdAt * 1000 
    WHERE createdAt < 2000000000 AND createdAt > 0
  `).run();
  
  return result.changes;
});

const changesApplied = transaction();

console.log(`   Fixed ${changesApplied} timestamp formats`);

// Verify the fix
console.log('\n4. Verifying performance calculations after fix...');

const verification = db.prepare(`
  SELECT 
    AVG(completedAt - createdAt) / 1000.0 as avg_seconds,
    MIN(completedAt - createdAt) / 1000.0 as min_seconds,
    MAX(completedAt - createdAt) / 1000.0 as max_seconds
  FROM jobs 
  WHERE status = 'completed' AND completedAt IS NOT NULL
`).get();

function formatDuration(seconds) {
  if (!seconds) return 'N/A';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hours > 0) return `${hours}h ${minutes}m ${secs}s`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

if (verification.avg_seconds) {
  console.log(`   Average processing time: ${formatDuration(verification.avg_seconds)}`);
  console.log(`   Fastest: ${formatDuration(verification.min_seconds)}`);  
  console.log(`   Slowest: ${formatDuration(verification.max_seconds)}`);
} else {
  console.log('   No completed jobs with valid timestamps found');
}

console.log('\n✅ Timestamp format fix completed successfully');

db.close();