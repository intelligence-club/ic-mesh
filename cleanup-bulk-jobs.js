#!/usr/bin/env node

const Database = require('better-sqlite3');
const db = new Database('./data/mesh.db', { readonly: false });

console.log('🧹 Bulk Job Cleanup - Removing Test Job Batches\n');

// First, let's understand the job creation patterns better
const jobsByHour = db.prepare(`
  SELECT 
    datetime(createdAt/1000, 'unixepoch', 'start of hour') as hour,
    COUNT(*) as count,
    MIN(jobId) as sample_job
  FROM jobs 
  WHERE status = 'pending'
  GROUP BY datetime(createdAt/1000, 'unixepoch', 'start of hour')
  ORDER BY count DESC
`).all();

console.log('📊 Pending Jobs by Creation Hour:');
jobsByHour.forEach(row => {
  console.log(`  ${row.hour}: ${row.count} jobs (sample: ${row.sample_job})`);
});

// Identify bulk batches (>100 jobs in the same hour)
const bulkBatches = jobsByHour.filter(row => row.count > 100);

if (bulkBatches.length > 0) {
  console.log('\n🎯 Identified bulk test batches to clean:');
  bulkBatches.forEach(batch => {
    console.log(`  ${batch.hour}: ${batch.count} jobs`);
  });
  
  let totalCleaned = 0;
  
  for (const batch of bulkBatches) {
    const startTime = new Date(batch.hour).getTime();
    const endTime = startTime + (60 * 60 * 1000); // +1 hour
    
    console.log(`\n🧽 Cleaning batch from ${batch.hour}...`);
    
    // Mark bulk jobs as 'test-cleanup'
    const result = db.prepare(`
      UPDATE jobs 
      SET status = 'test-cleanup' 
      WHERE status = 'pending' 
      AND createdAt >= ? 
      AND createdAt < ?
    `).run(startTime, endTime);
    
    console.log(`  ✅ Cleaned ${result.changes} test jobs`);
    totalCleaned += result.changes;
  }
  
  console.log(`\n🎉 Total cleanup: ${totalCleaned} test jobs moved to 'test-cleanup' status`);
  
} else {
  console.log('\n✅ No bulk test batches found (no hours with >100 jobs)');
}

// Get final stats
const finalStats = {
  pending: db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'pending'").get().count,
  testCleanup: db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'test-cleanup'").get().count,
  completed: db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'completed'").get().count,
  failed: db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'failed'").get().count
};

console.log(`\n📊 Final Job Queue Status:`);
console.log(`  Pending: ${finalStats.pending}`);
console.log(`  Test cleanup: ${finalStats.testCleanup}`);
console.log(`  Completed: ${finalStats.completed}`);
console.log(`  Failed: ${finalStats.failed}`);

db.close();