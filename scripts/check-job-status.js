#!/usr/bin/env node

const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '../data/mesh.db');
const db = new Database(dbPath);

console.log('📊 Job Status Summary:');
console.log('===================');

// Job status counts
const statusCounts = db.prepare(`
  SELECT status, COUNT(*) as count 
  FROM jobs 
  GROUP BY status 
  ORDER BY count DESC
`).all();

statusCounts.forEach(row => {
  console.log(`  ${row.status}: ${row.count}`);
});

console.log('\n🔄 Recent Jobs (last 10):');
console.log('========================');

const recentJobs = db.prepare(`
  SELECT jobId, type, status, claimedBy, createdAt 
  FROM jobs 
  ORDER BY createdAt DESC 
  LIMIT 10
`).all();

recentJobs.forEach(job => {
  const jobIdShort = job.jobId.slice(0, 8);
  const claimedBy = job.claimedBy ? job.claimedBy.slice(0, 8) : 'none';
  console.log(`  ${jobIdShort}... (${job.type}) - ${job.status} - claimed:${claimedBy}`);
});

db.close();