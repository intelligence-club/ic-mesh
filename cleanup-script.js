const Database = require('better-sqlite3');

function investigateDatabase() {
  const db = new Database('data/mesh.db');

  console.log('🔍 Database Investigation & Cleanup');
  console.log('===================================');

  // Get job status counts
  const statusCounts = db.prepare('SELECT status, COUNT(*) as count FROM jobs GROUP BY status').all();
  console.log('\nJob status breakdown:');
  statusCounts.forEach(row => {
    console.log(`  - ${row.status}: ${row.count} jobs`);
  });

  // Get pending jobs by type
  const pendingByType = db.prepare('SELECT type, COUNT(*) as count FROM jobs WHERE status = ? GROUP BY type').all('pending');
  console.log('\nPending jobs by type:');
  pendingByType.forEach(row => {
    console.log(`  - ${row.type}: ${row.count} pending`);
  });

  // Check for stuck claimed jobs
  const claimedJobs = db.prepare('SELECT jobId, type, claimedBy, claimedAt FROM jobs WHERE status = ?').all('claimed');
  console.log(`\nClaimed jobs: ${claimedJobs.length}`);
  
  if (claimedJobs.length > 0) {
    const now = Date.now();
    let resetCount = 0;
    
    claimedJobs.forEach(job => {
      const hoursAgo = Math.floor((now - job.claimedAt) / 1000 / 60 / 60);
      console.log(`  - ${job.jobId}: ${job.type}, claimed ${hoursAgo}h ago`);
      
      if (hoursAgo > 1) {
        console.log(`    🔄 Resetting stuck job to pending`);
        db.prepare('UPDATE jobs SET status = ?, claimedBy = NULL, claimedAt = NULL WHERE jobId = ?')
          .run('pending', job.jobId);
        resetCount++;
      }
    });
    
    if (resetCount > 0) {
      console.log(`✅ Reset ${resetCount} stuck jobs to pending`);
    }
  }

  // Check node activity
  const now = Date.now();
  const nodes = db.prepare('SELECT nodeId, name, owner, lastSeen, jobsCompleted FROM nodes ORDER BY lastSeen DESC').all();
  console.log(`\n🖥️  Node Status (${nodes.length} total):`);
  
  let activeNodes = 0;
  nodes.forEach(node => {
    const minutesAgo = Math.floor((now - node.lastSeen) / 1000 / 60);
    const hoursAgo = Math.floor(minutesAgo / 60);
    const daysAgo = Math.floor(hoursAgo / 24);
    
    let timeStr;
    if (minutesAgo < 60) {
      timeStr = `${minutesAgo}m ago`;
    } else if (hoursAgo < 24) {
      timeStr = `${hoursAgo}h ago`;
    } else {
      timeStr = `${daysAgo}d ago`;
    }
    
    const status = minutesAgo < 5 ? '🟢 ONLINE' : '🔴 OFFLINE';
    if (minutesAgo < 5) activeNodes++;
    
    console.log(`  - ${node.name} (${node.nodeId.substring(0,8)}): ${status} (${timeStr}, ${node.jobsCompleted} jobs)`);
  });

  console.log(`\nActive nodes: ${activeNodes}/${nodes.length}`);

  db.close();
  console.log('\n✅ Investigation completed');
}

investigateDatabase();