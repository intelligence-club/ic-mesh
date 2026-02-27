#!/usr/bin/env node
/**
 * Test Job Claiming API
 * 
 * Directly tests the job claiming workflow to verify it works correctly.
 */

const sqlite3 = require('sqlite3').verbose();
const http = require('http');
const path = require('path');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'data', 'mesh.db');

function makeRequest(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });
    
    req.on('error', reject);
    
    if (data) {
      req.write(JSON.stringify(data));
    }
    
    req.end();
  });
}

async function testJobClaiming() {
  console.log('🧪 Testing Job Claiming API Workflow');
  console.log('=====================================');

  const transcriptionNodeId = '1669e7240871e9f4';
  
  try {
    // Step 1: Check available jobs for the transcription node
    console.log('1️⃣ Checking available jobs for transcription node...');
    
    const availableJobsResponse = await makeRequest({
      hostname: 'localhost',
      port: 8333,
      path: `/jobs/available?nodeId=${transcriptionNodeId}`,
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    
    console.log(`   Status: ${availableJobsResponse.status}`);
    
    if (availableJobsResponse.status === 200 && Array.isArray(availableJobsResponse.data)) {
      const jobs = availableJobsResponse.data;
      console.log(`   ✅ Found ${jobs.length} available jobs`);
      
      jobs.slice(0, 3).forEach((job, i) => {
        console.log(`      Job ${i+1}: ${job.jobId?.substring(0,8)} (${job.type})`);
      });
      
      if (jobs.length > 0) {
        // Step 2: Try to claim the first available job
        const firstJob = jobs[0];
        console.log(`\n2️⃣ Attempting to claim job ${firstJob.jobId?.substring(0,8)}...`);
        
        const claimResponse = await makeRequest({
          hostname: 'localhost',
          port: 8333,
          path: `/jobs/${firstJob.jobId}/claim`,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        }, {
          nodeId: transcriptionNodeId
        });
        
        console.log(`   Status: ${claimResponse.status}`);
        
        if (claimResponse.status === 200) {
          console.log('   ✅ Job claimed successfully!');
          console.log(`   Response:`, claimResponse.data);
          
          // Check if the job status changed to 'claimed'
          await checkJobStatus(firstJob.jobId);
        } else {
          console.log('   ❌ Job claiming failed');
          console.log(`   Response:`, claimResponse.data);
        }
      }
    } else {
      console.log('   ❌ No available jobs or API error');
      console.log(`   Response:`, availableJobsResponse.data);
    }

  } catch (error) {
    console.error('💥 Test failed:', error.message);
  }
}

async function checkJobStatus(jobId) {
  console.log(`\n3️⃣ Checking job status after claiming...`);
  
  try {
    const statusResponse = await makeRequest({
      hostname: 'localhost',
      port: 8333,
      path: `/jobs/${jobId}`,
      method: 'GET'
    });
    
    console.log(`   Status: ${statusResponse.status}`);
    
    if (statusResponse.status === 200) {
      const job = statusResponse.data;
      console.log(`   Job status: ${job.status}`);
      console.log(`   Claimed by: ${job.claimedBy?.substring(0,8) || 'none'}`);
      
      if (job.status === 'claimed') {
        console.log('   ✅ Job status correctly updated to "claimed"');
      } else {
        console.log(`   ⚠️  Expected status "claimed", got "${job.status}"`);
      }
    } else {
      console.log('   ❌ Failed to get job status');
    }
  } catch (error) {
    console.error('   💥 Status check failed:', error.message);
  }
}

// Run the test
if (require.main === module) {
  testJobClaiming().then(() => {
    console.log('\n✅ Job claiming API test completed');
    process.exit(0);
  });
}