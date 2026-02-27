#!/usr/bin/env node
/**
 * IC Mesh Status Dashboard
 * 
 * Quick overview of mesh state, jobs, and nodes
 */

const http = require('http');

const BASE_URL = process.env.MESH_URL || 'http://localhost:8333';

async function request(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const req = http.get(url, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => reject(new Error('Timeout')));
  });
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatUptime(seconds) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}

async function main() {
  console.log('📊 IC Mesh Status Dashboard\n');

  try {
    // Network status
    const status = await request('/status');
    if (status.status !== 200) {
      console.log('❌ Mesh server not responding');
      process.exit(1);
    }

    const { data: meshStatus } = status;
    console.log('🌐 Network Status:');
    console.log(`   Active nodes: ${meshStatus.nodes?.active || 0} / ${meshStatus.nodes?.total || 0}`);
    console.log(`   Jobs: ${meshStatus.jobs?.completed || 0} completed, ${meshStatus.jobs?.pending || 0} pending`);
    console.log(`   Total compute: ${(meshStatus.economics?.totalComputeMinutes || 0).toFixed(1)} minutes`);
    console.log(`   Uptime: ${formatUptime(meshStatus.uptime || 0)}`);
    console.log(`   Server: ${BASE_URL}`);
    
    // Node details
    const nodes = await request('/nodes');
    if (nodes.status === 200 && nodes.data.nodes) {
      console.log('\n🖥️  Active Nodes:');
      
      const nodeList = Object.values(nodes.data.nodes);
      if (nodeList.length === 0) {
        console.log('   No active nodes');
      } else {
        for (const node of nodeList.slice(0, 5)) {
          const caps = node.capabilities || [];
          const lastSeen = new Date(node.lastSeen);
          const age = Math.floor((Date.now() - lastSeen.getTime()) / 1000);
          
          console.log(`   ${node.nodeId.slice(0, 12)}... (${node.name || 'unnamed'})`);
          console.log(`     Capabilities: ${caps.join(', ') || 'none'}`);
          console.log(`     Resources: ${node.resources?.cpuCores || 0} CPU, ${formatBytes((node.resources?.ramMB || 0) * 1024 * 1024)} RAM`);
          console.log(`     Last seen: ${age}s ago (${node.status || 'unknown'})`);
          console.log(`     Jobs completed: ${node.jobsCompleted || 0}`);
          console.log();
        }
        
        if (nodeList.length > 5) {
          console.log(`   ... and ${nodeList.length - 5} more nodes`);
        }
      }
    }

    // Recent jobs
    const availableJobs = await request('/jobs/available');
    if (availableJobs.status === 200 && availableJobs.data.jobs) {
      console.log('📋 Available Jobs:');
      
      if (availableJobs.data.jobs.length === 0) {
        console.log('   No pending jobs');
      } else {
        for (const job of availableJobs.data.jobs.slice(0, 3)) {
          const age = Math.floor((Date.now() - job.createdAt) / 1000);
          console.log(`   ${job.jobId.slice(0, 8)}... (${job.type})`);
          console.log(`     Created: ${age}s ago`);
          const payloadSize = JSON.stringify(job.payload).length;
          console.log(`     Payload: ${payloadSize} bytes (${job.type})`);
          console.log();
        }
        
        if (availableJobs.data.jobs.length > 3) {
          console.log(`   ... and ${availableJobs.data.jobs.length - 3} more jobs`);
        }
      }
      
      console.log(`\n📊 Total available: ${availableJobs.data.count} jobs`);
    }

    // Handler info
    const handlers = await request('/handlers');
    if (handlers.status === 200 && handlers.data.handlers) {
      console.log('\n🔧 Available Handlers:');
      
      const handlerList = Object.keys(handlers.data.handlers);
      if (handlerList.length === 0) {
        console.log('   No handlers registered');
      } else {
        for (const handlerType of handlerList) {
          const handler = handlers.data.handlers[handlerType];
          console.log(`   ${handlerType}: ${handler.description || 'No description'}`);
        }
      }
    }

    console.log('\n✨ Use npm run health for JSON status');

  } catch (error) {
    console.log(`❌ Error: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}