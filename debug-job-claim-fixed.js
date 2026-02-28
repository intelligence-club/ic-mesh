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

async function debugJobClaimFixed() {
  console.log('🔍 Debugging Job Claim Issue - FIXED VERSION\n');
  
  try {
    // 1. Create a node with the correct capability ('whisper' instead of 'transcription')
    console.log('1. Creating test node with WHISPER capability...');
    const nodeName = 'debug-node-fixed-' + Date.now();
    const nodeData = {
      name: nodeName,
      capabilities: ['whisper'], // This should match what the server expects
      reputation: 1000,
      location: 'test-debug-fixed'
    };
    
    const registerRes = await request('POST', '/nodes/register', nodeData);
    console.log(`   - Registration status: ${registerRes.status}`);
    
    if (registerRes.status !== 200) {
      console.log(`   - Registration failed:`, registerRes.data);
      return;
    }
    
    const nodeId = registerRes.data.node.nodeId;
    console.log(`   - Node ID: ${nodeId}\n`);
    
    // 2. Create a job
    console.log('2. Creating test job...');
    const jobData = {
      type: 'transcribe',
      payload: { audio_url: 'https://example.com/debug-test-fixed.wav' },
      requirements: { capability: 'transcription' } // Job still requests 'transcription'
    };
    
    const createRes = await request('POST', '/jobs', jobData);
    console.log(`   - Job creation status: ${createRes.status}`);
    
    if (createRes.status !== 200) {
      console.log(`   - Job creation failed:`, createRes.data);
      return;
    }
    
    const jobId = createRes.data.job.jobId;
    console.log(`   - Job ID: ${jobId}\n`);
    
    // 3. Check available jobs with nodeId parameter
    console.log('3. Checking available jobs with nodeId...');
    const availableJobs = await request('GET', `/jobs/available?nodeId=${nodeId}`);
    console.log(`   - Available job count: ${availableJobs.data.count}`);
    const ourJob = availableJobs.data.jobs.find(j => j.jobId === jobId);
    console.log(`   - Our job found in available: ${ourJob ? 'yes' : 'no'}\n`);
    
    if (ourJob) {
      console.log('4. Attempting to claim job...');
      const claimRes = await request('POST', `/jobs/${jobId}/claim`, {
        nodeId: nodeId
      });
      
      console.log(`   - Claim status: ${claimRes.status}`);
      console.log(`   - Claim response:`, claimRes.data);
      
      if (claimRes.status === 200) {
        console.log('   ✅ Job claimed successfully!');
      } else {
        console.log('   ❌ Job claim still failed');
      }
    } else {
      console.log('4. Job still not available - checking node capabilities in DB...');
      
      // Let's verify what capabilities the node actually has stored
      const nodesRes = await request('GET', '/nodes');
      const ourNode = nodesRes.data.nodes.find(n => n.nodeId === nodeId);
      console.log(`   - Node capabilities in DB: ${JSON.stringify(ourNode?.capabilities)}`);
      
      // Test both ways - what if we register with both capabilities?
      console.log('\n5. Testing with BOTH transcription and whisper capabilities...');
      const nodeData2 = {
        name: 'debug-dual-caps-' + Date.now(),
        capabilities: ['transcription', 'whisper'],
        reputation: 1000,
        location: 'test-dual'
      };
      
      const registerRes2 = await request('POST', '/nodes/register', nodeData2);
      if (registerRes2.status === 200) {
        const nodeId2 = registerRes2.data.node.nodeId;
        console.log(`   - Dual-capability node ID: ${nodeId2}`);
        
        const availableJobs2 = await request('GET', `/jobs/available?nodeId=${nodeId2}`);
        console.log(`   - Available jobs for dual-cap node: ${availableJobs2.data.count}`);
      }
    }
    
  } catch (error) {
    console.error('Error during debug:', error.message);
  }
}

debugJobClaimFixed();