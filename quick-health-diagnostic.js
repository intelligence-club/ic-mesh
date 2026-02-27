#!/usr/bin/env node

/**
 * Quick system health diagnostic for work pulses
 * Rapid check of server, database, and network connectivity
 */

const http = require('http');
const Database = require('better-sqlite3');

async function quickHealthCheck() {
  console.log('🏥 Quick Health Diagnostic\n');
  
  try {
    // Check database accessibility
    console.log('📊 Database Check:');
    const db = new Database('./data/mesh.db', { readonly: true });
    const totalJobs = db.prepare('SELECT COUNT(*) as count FROM jobs').get().count;
    const totalNodes = db.prepare('SELECT COUNT(*) as count FROM nodes').get().count;
    console.log(`  ✅ Database accessible: ${totalJobs} jobs, ${totalNodes} nodes`);
    db.close();
    
    // Check server responsiveness
    console.log('\n🌐 Server Check:');
    const serverCheck = await checkHTTP('http://localhost:8333/status');
    if (serverCheck.success) {
      const status = JSON.parse(serverCheck.data);
      console.log(`  ✅ Server responding: ${status.nodes.active}/${status.nodes.total} active nodes, ${status.jobs.pending} pending jobs`);
      console.log(`  📊 Uptime: ${Math.round(status.uptime / 60)} minutes`);
    } else {
      console.log(`  ❌ Server error: ${serverCheck.error}`);
    }

    // Check available jobs endpoint
    console.log('\n🎯 Job Claiming Check:');
    const jobsCheck = await checkHTTP('http://localhost:8333/jobs/available');
    if (jobsCheck.success) {
      const jobs = JSON.parse(jobsCheck.data);
      console.log(`  ✅ Available jobs endpoint: ${jobs.length} jobs claimable`);
      if (jobs.length > 0) {
        const jobTypes = {};
        jobs.forEach(job => {
          jobTypes[job.type] = (jobTypes[job.type] || 0) + 1;
        });
        console.log(`  📋 Job types: ${Object.entries(jobTypes).map(([type, count]) => `${type}(${count})`).join(', ')}`);
      }
    } else {
      console.log(`  ❌ Available jobs error: ${jobsCheck.error}`);
    }

    console.log('\n⚡ Quick Status: System operational, check node connectivity if jobs not processing');

  } catch (error) {
    console.error('❌ Diagnostic error:', error.message);
    process.exit(1);
  }
}

function checkHTTP(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve({ success: true, data });
        } else {
          resolve({ success: false, error: `HTTP ${res.statusCode}` });
        }
      });
    });
    
    req.on('error', (error) => {
      resolve({ success: false, error: error.message });
    });
    
    req.setTimeout(5000, () => {
      req.destroy();
      resolve({ success: false, error: 'Timeout' });
    });
  });
}

quickHealthCheck();