const Database = require('better-sqlite3');

function cleanTestJobs() {
  console.log('🧹 Cleaning test job pollution...');
  
  const db = new Database('data/mesh.db');

  // Find test jobs (example.com URLs, rate-test patterns, etc.)
  const testJobs = db.prepare(`
    SELECT jobId, type, payload, requester 
    FROM jobs 
    WHERE status = 'pending' 
    AND (
      payload LIKE '%example.com%' 
      OR payload LIKE '%rate-test%'
      OR payload LIKE '%test%'
      OR requester = ''
      OR requester = 'test'
    )
  `).all();

  console.log(`Found ${testJobs.length} test jobs to clean up`);

  if (testJobs.length > 0) {
    console.log('Test jobs to be deleted:');
    testJobs.slice(0, 5).forEach((job, i) => {
      console.log(`  ${i+1}. ${job.type} - ${job.jobId}`);
    });
    if (testJobs.length > 5) {
      console.log(`  ... and ${testJobs.length - 5} more`);
    }
    
    // Delete test jobs
    const deleteResult = db.prepare(`
      DELETE FROM jobs 
      WHERE status = 'pending' 
      AND (
        payload LIKE '%example.com%' 
        OR payload LIKE '%rate-test%'
        OR payload LIKE '%test%'
        OR requester = ''
        OR requester = 'test'
      )
    `).run();
    
    console.log(`✅ Deleted ${deleteResult.changes} test jobs`);
  }

  // Show clean status
  console.log('\n📊 Clean Queue Status:');
  const statusCounts = db.prepare('SELECT status, COUNT(*) as count FROM jobs GROUP BY status').all();
  statusCounts.forEach(row => {
    console.log(`  - ${row.status}: ${row.count} jobs`);
  });

  const pendingByType = db.prepare('SELECT type, COUNT(*) as count FROM jobs WHERE status = ? GROUP BY type').all('pending');
  if (pendingByType.length > 0) {
    console.log('\nRemaining pending jobs:');
    pendingByType.forEach(row => {
      console.log(`  - ${row.type}: ${row.count} jobs`);
    });
  } else {
    console.log('\n✅ No pending jobs remaining');
  }

  db.close();
  console.log('\n✅ Test job cleanup completed');
}

cleanTestJobs();