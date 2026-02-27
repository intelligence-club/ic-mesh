#!/usr/bin/env node
/**
 * Revenue Optimizer - Automates job claiming for idle nodes
 * 
 * Identifies nodes with available jobs and helps them claim work automatically
 * Addresses the gap where nodes are online but not processing jobs
 */

const https = require('https');

const API_BASE = 'https://moilol.com/mesh';

async function apiCall(endpoint, method = 'GET', data = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(API_BASE + endpoint);
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json'
      }
    };
    
    const req = https.request(url, options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          resolve({ error: 'Invalid JSON', body });
        }
      });
    });
    
    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

async function getNodes() {
  const response = await apiCall('/nodes');
  return response.nodes || {};
}

async function getAvailableJobs(nodeId) {
  const response = await apiCall(`/jobs/available?nodeId=${nodeId}`);
  return response.jobs || [];
}

async function claimJob(jobId, nodeId) {
  const response = await apiCall(`/jobs/${jobId}/claim`, 'POST', { nodeId });
  return response.ok ? response.job : null;
}

async function getJobStatus(jobId) {
  const response = await apiCall(`/jobs/${jobId}`);
  return response.job || null;
}

function calculateRevenue(jobs) {
  const rates = {
    'transcribe': 2.50,     // High-value transcription
    'ocr': 0.75,           // Medium-value OCR  
    'pdf-extract': 1.00,    // Medium-value PDF
    'inference': 1.50,      // AI inference
    'generate-image': 2.00  // Image generation
  };
  
  let total = 0;
  let breakdown = {};
  
  for (const job of jobs) {
    const rate = rates[job.type] || 0.50;
    total += rate;
    breakdown[job.type] = (breakdown[job.type] || 0) + rate;
  }
  
  return { total, breakdown };
}

async function optimizeRevenue() {
  console.log('🚀 IC Mesh Revenue Optimizer');
  console.log('============================');
  console.log(`📅 ${new Date().toISOString()}\n`);
  
  try {
    // Get all active nodes
    const nodes = await getNodes();
    const nodeIds = Object.keys(nodes);
    
    if (nodeIds.length === 0) {
      console.log('❌ No nodes found');
      return;
    }
    
    console.log(`🔍 Found ${nodeIds.length} registered nodes\n`);
    
    let totalRevenuePotential = 0;
    let totalJobsClaimed = 0;
    
    for (const nodeId of nodeIds) {
      const node = nodes[nodeId];
      console.log(`📊 Analyzing node: ${node.name || nodeId}`);
      console.log(`   Capabilities: [${node.capabilities.join(', ')}]`);
      console.log(`   Status: ${node.status}`);
      
      if (node.status !== 'online') {
        console.log('   ⏭️  Skipping offline node\n');
        continue;
      }
      
      // Get available jobs for this node
      const availableJobs = await getAvailableJobs(nodeId);
      console.log(`   Available jobs: ${availableJobs.length}`);
      
      if (availableJobs.length === 0) {
        console.log('   ✅ No jobs available\n');
        continue;
      }
      
      // Calculate revenue potential
      const revenue = calculateRevenue(availableJobs);
      totalRevenuePotential += revenue.total;
      
      console.log(`   💰 Revenue potential: $${revenue.total.toFixed(2)}`);
      console.log(`   📋 Job breakdown:`);
      for (const [type, amount] of Object.entries(revenue.breakdown)) {
        const count = availableJobs.filter(job => job.type === type).length;
        console.log(`      ${type}: ${count} jobs ($${amount.toFixed(2)})`);
      }
      
      // AUTO-CLAIM OPTIMIZATION: Claim up to 3 highest-value jobs
      const sortedJobs = availableJobs.sort((a, b) => {
        const rateA = { 'transcribe': 2.50, 'generate-image': 2.00, 'inference': 1.50, 'pdf-extract': 1.00, 'ocr': 0.75 }[a.type] || 0.50;
        const rateB = { 'transcribe': 2.50, 'generate-image': 2.00, 'inference': 1.50, 'pdf-extract': 1.00, 'ocr': 0.75 }[b.type] || 0.50;
        return rateB - rateA;
      });
      
      console.log(`   ⚡ Auto-claiming top ${Math.min(3, sortedJobs.length)} jobs...`);
      
      let claimedCount = 0;
      for (let i = 0; i < Math.min(3, sortedJobs.length); i++) {
        const job = sortedJobs[i];
        try {
          const claimed = await claimJob(job.jobId, nodeId);
          if (claimed) {
            console.log(`      ✅ Claimed ${job.type} job ${job.jobId.substring(0, 8)}`);
            claimedCount++;
            totalJobsClaimed++;
          } else {
            console.log(`      ❌ Failed to claim ${job.type} job ${job.jobId.substring(0, 8)}`);
          }
        } catch (error) {
          console.log(`      ❌ Error claiming job: ${error.message}`);
        }
      }
      
      console.log(`   📈 Claimed ${claimedCount} jobs for immediate processing\n`);
    }
    
    // Summary
    console.log('🎯 OPTIMIZATION SUMMARY');
    console.log('=======================');
    console.log(`💰 Total revenue potential: $${totalRevenuePotential.toFixed(2)}`);
    console.log(`⚡ Jobs auto-claimed: ${totalJobsClaimed}`);
    console.log(`🚀 Next step: Nodes should process claimed jobs automatically\n`);
    
    if (totalJobsClaimed > 0) {
      console.log('✅ Revenue optimization successful!');
      console.log('   Claimed jobs will be processed by nodes');
      console.log('   Revenue should start flowing within minutes');
    } else {
      console.log('ℹ️  No jobs were claimed in this optimization round');
      console.log('   This could mean nodes are already busy or no work is available');
    }
    
  } catch (error) {
    console.error('❌ Revenue optimization failed:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  optimizeRevenue();
}

module.exports = { optimizeRevenue, calculateRevenue };