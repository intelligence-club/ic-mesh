#!/usr/bin/env node

const fetch = require('node-fetch');

const BASE_URL = 'http://localhost:8333';

async function request(method, path, body = null) {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  
  if (body) {
    options.body = JSON.stringify(body);
  }
  
  const response = await fetch(BASE_URL + path, options);
  const data = await response.json();
  
  return {
    status: response.status,
    data
  };
}

async function debugJobClaim() {
  console.log('🔍 Debugging Job Claim Issue\n');
  
  try {
    // 1. Check system status
    console.log('1. System Status:');
    const status = await request('GET', '/status');
    console.log(`   - Active nodes: ${status.data.nodes.active}`);
    console.log(`   - Pending jobs: ${status.data.jobs.pending}`);
    console.log(`   - Total jobs: ${status.data.jobs.total}\n`);
    
    // 2. Create a unique node
    console.log('2. Creating test node...');
    const nodeName = 'debug-node-' + Date.now();
    const nodeData = {
      name: nodeName,
      capabilities: ['transcription'],
      reputation: 1000,
      location: 'test-debug'
    };
    
    const registerRes = await request('POST', '/nodes/register', nodeData);
    console.log(`   - Registration status: ${registerRes.status}`);
    
    if (registerRes.status !== 200) {
      console.log(`   - Registration failed:`, registerRes.data);
      return;
    }
    
    const nodeId = registerRes.data.node.nodeId;
    console.log(`   - Node ID: ${nodeId}\n`);
    
    // 3. Create a job
    console.log('3. Creating test job...');
    const jobData = {
      type: 'transcribe',
      payload: { audio_url: 'https://example.com/debug-test.wav' },
      requirements: { capability: 'transcription' }
    };
    
    const createRes = await request('POST', '/jobs', jobData);
    console.log(`   - Job creation status: ${createRes.status}`);
    
    if (createRes.status !== 200) {
      console.log(`   - Job creation failed:`, createRes.data);
      return;
    }
    
    const jobId = createRes.data.job.jobId;
    console.log(`   - Job ID: ${jobId}\n`);
    
    // 4. Check job status before claiming
    console.log('4. Checking job status before claim...');
    const jobStatus = await request('GET', `/jobs/${jobId}`);
    console.log(`   - Job status: ${jobStatus.data.job.status}`);
    console.log(`   - Job claimed by: ${jobStatus.data.job.claimedBy || 'none'}\n`);
    
    // 5. Check available jobs
    console.log('5. Checking available jobs...');
    const availableJobs = await request('GET', '/jobs/available');
    console.log(`   - Available job count: ${availableJobs.data.count}`);
    const ourJob = availableJobs.data.jobs.find(j => j.jobId === jobId);
    console.log(`   - Our job found in available: ${ourJob ? 'yes' : 'no'}\n`);
    
    // 6. Try to claim the job
    console.log('6. Attempting to claim job...');
    const claimRes = await request('POST', `/jobs/${jobId}/claim`, {
      nodeId: nodeId
    });
    
    console.log(`   - Claim status: ${claimRes.status}`);
    console.log(`   - Claim response:`, claimRes.data);
    
    if (claimRes.status === 200) {
      console.log('   ✅ Job claimed successfully!');
    } else {
      console.log('   ❌ Job claim failed');
      
      // Check job status after failed claim
      const postClaimStatus = await request('GET', `/jobs/${jobId}`);
      console.log(`   - Post-claim job status: ${postClaimStatus.data.job.status}`);
      console.log(`   - Post-claim claimed by: ${postClaimStatus.data.job.claimedBy || 'none'}`);
    }
    
  } catch (error) {
    console.error('Error during debug:', error.message);
  }
}

debugJobClaim();