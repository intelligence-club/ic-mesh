#!/usr/bin/env node

const Database = require('better-sqlite3');
const db = new Database('./data/mesh.db', { readonly: true });

console.log('🔍 Job Queue Analysis\n');

// Job types breakdown
const jobTypes = db.prepare("SELECT type, COUNT(*) as count FROM jobs WHERE status = 'pending' GROUP BY type ORDER BY count DESC").all();
console.log('📊 Pending Jobs by Type:');
jobTypes.forEach(row => {
  console.log(`  ${row.type}: ${row.count}`);
});

// Recent job creation pattern (last few hours)
const recentJobs = db.prepare(`
  SELECT 
    datetime(createdAt/1000, 'unixepoch') as created_hour,
    COUNT(*) as count 
  FROM jobs 
  WHERE status = 'pending' 
  AND createdAt > ? 
  GROUP BY datetime(createdAt/1000, 'unixepoch', 'start of hour')
  ORDER BY created_hour DESC
  LIMIT 10
`).all(Date.now() - (24 * 60 * 60 * 1000));

console.log('\n⏰ Recent Job Creation (last 24h):');
recentJobs.forEach(row => {
  console.log(`  ${row.created_hour}: ${row.count} jobs`);
});

// Check if jobs are being claimed but not completed
const claimedJobs = db.prepare("SELECT COUNT(*) as count FROM jobs WHERE claimedBy IS NOT NULL AND status = 'pending'").get();
console.log(`\n🤝 Claimed but incomplete jobs: ${claimedJobs.count}`);

// Sample some recent pending jobs
const sampleJobs = db.prepare(`
  SELECT jobId, type, requester, datetime(createdAt/1000, 'unixepoch') as created, claimedBy
  FROM jobs 
  WHERE status = 'pending' 
  ORDER BY createdAt DESC 
  LIMIT 5
`).all();

console.log('\n📋 Recent Pending Jobs Sample:');
sampleJobs.forEach(job => {
  const claimed = job.claimedBy ? ` (claimed by ${job.claimedBy})` : '';
  console.log(`  ${job.jobId}: ${job.type} - ${job.created}${claimed}`);
});

// Active nodes
const activeNodes = db.prepare("SELECT COUNT(*) as count FROM nodes WHERE lastSeen > ?").get(Date.now() - (5 * 60 * 1000));
console.log(`\n🖥️  Active nodes (last 5 min): ${activeNodes.count}`);

db.close();