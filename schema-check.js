#!/usr/bin/env node

const Database = require('better-sqlite3');
const db = new Database('data/mesh.db');

console.log('\n📊 DATABASE SCHEMA CHECK');
console.log('=====================================');

// Get table structure
const jobsSchema = db.prepare("PRAGMA table_info(jobs)").all();
console.log('\n📋 JOBS TABLE SCHEMA:');
jobsSchema.forEach(col => {
  console.log(`  ${col.name}: ${col.type} ${col.notnull ? 'NOT NULL' : ''} ${col.dflt_value ? `DEFAULT ${col.dflt_value}` : ''}`);
});

// Get sample jobs
const sampleJobs = db.prepare("SELECT * FROM jobs LIMIT 3").all();
console.log('\n📄 SAMPLE JOBS:');
sampleJobs.forEach((job, i) => {
  console.log(`\nJob ${i+1}:`);
  Object.keys(job).forEach(key => {
    console.log(`  ${key}: ${job[key]}`);
  });
});

// Get job counts by status
const jobCounts = db.prepare("SELECT status, COUNT(*) as count FROM jobs GROUP BY status").all();
console.log('\n📊 JOB COUNTS BY STATUS:');
jobCounts.forEach(row => {
  console.log(`  ${row.status}: ${row.count}`);
});

db.close();