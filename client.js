#!/usr/bin/env node
/**
 * IC Mesh — Node Client
 * 
 * Runs on each node (Mac Mini, laptop, server).
 * Checks in with the coordination server, picks up jobs, reports results.
 * 
 * Usage:
 *   IC_MESH_SERVER=https://moilol.com:8333 \
 *   IC_NODE_NAME=hilo-coffee-shop \
 *   IC_NODE_OWNER=drake \
 *   node client.js
 */

const os = require('os');
const { execSync } = require('child_process');

const MESH_SERVER = process.env.IC_MESH_SERVER || 'http://localhost:8333';
const NODE_NAME = process.env.IC_NODE_NAME || os.hostname();
const NODE_OWNER = process.env.IC_NODE_OWNER || os.userInfo().username;
const NODE_REGION = process.env.IC_NODE_REGION || 'unknown';
const CHECKIN_INTERVAL = 60000; // 60 seconds
const JOB_POLL_INTERVAL = 10000; // 10 seconds

let nodeId = null;

// ===== System Info =====

function getSystemInfo() {
  const cpus = os.cpus();
  const totalMem = Math.round(os.totalmem() / 1024 / 1024);
  const freeMem = Math.round(os.freemem() / 1024 / 1024);
  const loadAvg = os.loadavg()[0];
  const cpuIdle = Math.max(0, Math.round((1 - loadAvg / cpus.length) * 100));
  
  return {
    cpuCores: cpus.length,
    cpuModel: cpus[0]?.model || 'unknown',
    ramMB: totalMem,
    ramFreeMB: freeMem,
    cpuIdle,
    diskFreeGB: getDiskFree(),
    gpuVRAM: 0 // TODO: detect GPU
  };
}

function getDiskFree() {
  try {
    const out = execSync("df -BG / | tail -1 | awk '{print $4}'", { encoding: 'utf8' });
    return parseInt(out) || 0;
  } catch { return 0; }
}

function getCapabilities() {
  const caps = [];
  
  // Check for Ollama
  try { execSync('which ollama', { encoding: 'utf8' }); caps.push('ollama'); } catch {}
  
  // Check for Whisper
  try { execSync('which whisper', { encoding: 'utf8' }); caps.push('whisper'); } catch {}
  
  // Check for ffmpeg
  try { execSync('which ffmpeg', { encoding: 'utf8' }); caps.push('ffmpeg'); } catch {}
  
  // Check for GPU (nvidia)
  try { execSync('which nvidia-smi', { encoding: 'utf8' }); caps.push('gpu-nvidia'); } catch {}
  
  // Check for Metal (Apple Silicon)
  try {
    const arch = execSync('uname -m', { encoding: 'utf8' }).trim();
    if (arch === 'arm64' && process.platform === 'darwin') caps.push('gpu-metal');
  } catch {}
  
  return caps;
}

function getOllamaModels() {
  try {
    const out = execSync('ollama list 2>/dev/null', { encoding: 'utf8' });
    return out.split('\n').slice(1).filter(Boolean).map(line => line.split(/\s+/)[0]).filter(Boolean);
  } catch { return []; }
}

// ===== Network Communication =====

async function meshFetch(path, options = {}) {
  const url = `${MESH_SERVER}${path}`;
  try {
    const resp = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-Node-Id': nodeId || '',
        ...options.headers
      }
    });
    return await resp.json();
  } catch (e) {
    console.error(`  ✗ Mesh server unreachable: ${e.message}`);
    return null;
  }
}

// ===== Core Loop =====

async function checkin() {
  const sysInfo = getSystemInfo();
  const capabilities = getCapabilities();
  const models = getOllamaModels();
  
  const data = {
    nodeId,
    name: NODE_NAME,
    owner: NODE_OWNER,
    region: NODE_REGION,
    capabilities,
    models,
    ...sysInfo
  };
  
  const result = await meshFetch('/nodes/register', {
    method: 'POST',
    body: JSON.stringify(data)
  });
  
  if (result?.ok) {
    if (!nodeId) {
      nodeId = result.node.nodeId;
      console.log(`◉ Registered as node: ${nodeId}`);
      console.log(`  Name: ${NODE_NAME}`);
      console.log(`  Capabilities: ${capabilities.join(', ') || 'none detected'}`);
      console.log(`  Models: ${models.join(', ') || 'none'}`);
      console.log(`  RAM: ${sysInfo.ramMB}MB (${sysInfo.ramFreeMB}MB free)`);
      console.log(`  CPU: ${sysInfo.cpuCores} cores (${sysInfo.cpuIdle}% idle)`);
    }
  }
}

async function pollJobs() {
  if (!nodeId) return;
  
  const result = await meshFetch(`/jobs/available?nodeId=${nodeId}`);
  if (!result?.jobs?.length) return;
  
  for (const job of result.jobs) {
    console.log(`◉ Job available: ${job.type} (${job.jobId})`);
    
    // Claim it
    const claimed = await meshFetch(`/jobs/${job.jobId}/claim`, {
      method: 'POST',
      body: JSON.stringify({ nodeId })
    });
    
    if (!claimed?.ok) {
      console.log(`  ✗ Failed to claim (someone else got it)`);
      continue;
    }
    
    console.log(`  ✓ Claimed. Executing...`);
    
    // Execute the job
    try {
      const result = await executeJob(job);
      
      await meshFetch(`/jobs/${job.jobId}/complete`, {
        method: 'POST',
        body: JSON.stringify({ nodeId, data: result })
      });
      
      console.log(`  ✓ Completed: ${job.type}`);
    } catch (e) {
      console.error(`  ✗ Job failed: ${e.message}`);
    }
  }
}

async function executeJob(job) {
  switch (job.type) {
    case 'inference':
      return await runInference(job.payload);
    case 'transcribe':
      return await runTranscribe(job.payload);
    case 'ping':
      return { pong: true, node: NODE_NAME, time: Date.now() };
    default:
      throw new Error(`Unknown job type: ${job.type}`);
  }
}

async function runInference(payload) {
  const model = payload.model || 'llama3.1:8b';
  const prompt = payload.prompt || '';
  
  try {
    const resp = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: false })
    });
    const data = await resp.json();
    return { response: data.response, model, tokens: data.eval_count || 0 };
  } catch (e) {
    throw new Error(`Ollama inference failed: ${e.message}`);
  }
}

async function runTranscribe(payload) {
  // TODO: implement whisper transcription
  throw new Error('Transcription not yet implemented');
}

// ===== Main =====

async function main() {
  console.log('');
  console.log('┌──────────────────────────────────┐');
  console.log('│  ◉ IC MESH — Node Client v0.1.0  │');
  console.log('└──────────────────────────────────┘');
  console.log(`  Server: ${MESH_SERVER}`);
  console.log(`  Node:   ${NODE_NAME}`);
  console.log(`  Owner:  ${NODE_OWNER}`);
  console.log('');
  
  // Initial checkin
  await checkin();
  
  // Periodic checkin
  setInterval(checkin, CHECKIN_INTERVAL);
  
  // Poll for jobs
  setInterval(pollJobs, JOB_POLL_INTERVAL);
  
  console.log(`\n◉ Node running. Checking in every ${CHECKIN_INTERVAL/1000}s, polling jobs every ${JOB_POLL_INTERVAL/1000}s`);
  console.log('  Press Ctrl+C to leave the mesh.\n');
}

main().catch(console.error);
