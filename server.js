#!/usr/bin/env node
/**
 * IC Mesh — Coordination Server
 * 
 * The central hub that coordinates the Intelligence Club compute mesh.
 * Runs on our server (157.245.189.193). Nodes check in here.
 * 
 * Components:
 * 1. Node Registry — who's online, what can they do
 * 2. Job Queue — tasks waiting to be claimed
 * 3. Compute Broker — routes jobs to best available node  
 * 4. Ledger — tracks compute credits/debits
 * 
 * API:
 *   POST /nodes/register    — node checks in
 *   GET  /nodes             — list active nodes
 *   POST /jobs              — submit a job
 *   GET  /jobs/available    — get claimable jobs (for nodes)
 *   POST /jobs/:id/claim    — node claims a job
 *   POST /jobs/:id/complete — node reports job done
 *   GET  /ledger/:nodeId    — get node's compute balance
 *   GET  /status            — network status
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = 8333; // mesh port
const DATA_DIR = path.join(__dirname, 'data');
const NODES_FILE = path.join(DATA_DIR, 'nodes.json');
const JOBS_FILE = path.join(DATA_DIR, 'jobs.json');
const LEDGER_FILE = path.join(DATA_DIR, 'ledger.json');

// Ensure data dir
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ===== STATE =====
let nodes = loadJSON(NODES_FILE, {});
let jobs = loadJSON(JOBS_FILE, {});
let ledger = loadJSON(LEDGER_FILE, {});

function loadJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}

function save(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function genId() {
  return crypto.randomBytes(8).toString('hex');
}

// ===== NODE REGISTRY =====

function registerNode(data) {
  const id = data.nodeId || genId();
  const now = Date.now();
  
  nodes[id] = {
    nodeId: id,
    name: data.name || 'unnamed',
    ip: data.ip || 'unknown',
    capabilities: data.capabilities || [],  // ['ollama', 'whisper', 'gpu', 'ffmpeg']
    models: data.models || [],              // ['llama3.1:8b', 'mistral:7b']
    resources: {
      cpuCores: data.cpuCores || 0,
      ramMB: data.ramMB || 0,
      ramFreeMB: data.ramFreeMB || 0,
      cpuIdle: data.cpuIdle || 0,           // percentage
      gpuVRAM: data.gpuVRAM || 0,
      diskFreeGB: data.diskFreeGB || 0
    },
    owner: data.owner || 'unknown',
    region: data.region || 'unknown',
    lastSeen: now,
    registeredAt: nodes[id]?.registeredAt || now,
    status: 'online',
    jobsCompleted: nodes[id]?.jobsCompleted || 0,
    computeMinutes: nodes[id]?.computeMinutes || 0
  };
  
  save(NODES_FILE, nodes);
  return nodes[id];
}

function getActiveNodes() {
  const cutoff = Date.now() - 120000; // 2 min timeout
  const active = {};
  for (const [id, node] of Object.entries(nodes)) {
    if (node.lastSeen > cutoff) {
      active[id] = { ...node, status: 'online' };
    } else {
      node.status = 'offline';
    }
  }
  return active;
}

// ===== JOB QUEUE =====

function submitJob(data) {
  const id = genId();
  const now = Date.now();
  
  jobs[id] = {
    jobId: id,
    type: data.type,                        // 'inference', 'transcribe', 'generate', 'custom'
    payload: data.payload || {},             // job-specific data
    requester: data.requester,              // nodeId of requesting node
    requirements: data.requirements || {},   // { capability: 'ollama', model: 'llama3.1:8b', minRAM: 8000 }
    status: 'pending',                      // pending, claimed, running, completed, failed
    claimedBy: null,
    createdAt: now,
    claimedAt: null,
    completedAt: null,
    result: null,
    computeMs: 0,                           // how long it took
    creditAmount: 0                         // how much to credit the worker
  };
  
  save(JOBS_FILE, jobs);
  return jobs[id];
}

function getAvailableJobs(nodeId) {
  const available = [];
  const node = nodes[nodeId];
  
  for (const [id, job] of Object.entries(jobs)) {
    if (job.status !== 'pending') continue;
    
    // Check if node meets requirements
    const req = job.requirements;
    if (req.capability && node && !node.capabilities.includes(req.capability)) continue;
    if (req.model && node && !node.models.includes(req.model)) continue;
    if (req.minRAM && node && node.resources.ramFreeMB < req.minRAM) continue;
    
    available.push(job);
  }
  
  return available;
}

function claimJob(jobId, nodeId) {
  const job = jobs[jobId];
  if (!job || job.status !== 'pending') return null;
  
  job.status = 'claimed';
  job.claimedBy = nodeId;
  job.claimedAt = Date.now();
  
  save(JOBS_FILE, jobs);
  return job;
}

function completeJob(jobId, nodeId, result) {
  const job = jobs[jobId];
  if (!job || job.claimedBy !== nodeId) return null;
  
  const now = Date.now();
  job.status = 'completed';
  job.completedAt = now;
  job.result = result.data || null;
  job.computeMs = now - job.claimedAt;
  
  // Calculate credits (1 credit = 1 minute of compute)
  const computeMinutes = job.computeMs / 60000;
  job.creditAmount = computeMinutes;
  
  // Update ledger
  if (!ledger[nodeId]) ledger[nodeId] = { earned: 0, spent: 0, jobs: 0 };
  if (!ledger[job.requester]) ledger[job.requester] = { earned: 0, spent: 0, jobs: 0 };
  
  const networkCut = computeMinutes * 0.20; // 20% to IC
  const workerPay = computeMinutes - networkCut;
  
  ledger[nodeId].earned += workerPay;
  ledger[nodeId].jobs += 1;
  ledger[job.requester].spent += computeMinutes;
  
  if (!ledger['ic-treasury']) ledger['ic-treasury'] = { earned: 0, spent: 0, jobs: 0 };
  ledger['ic-treasury'].earned += networkCut;
  
  // Update node stats
  if (nodes[nodeId]) {
    nodes[nodeId].jobsCompleted = (nodes[nodeId].jobsCompleted || 0) + 1;
    nodes[nodeId].computeMinutes = (nodes[nodeId].computeMinutes || 0) + computeMinutes;
  }
  
  save(JOBS_FILE, jobs);
  save(LEDGER_FILE, ledger);
  save(NODES_FILE, nodes);
  
  return job;
}

// ===== COMPUTE BROKER =====

function findBestNode(requirements) {
  const active = getActiveNodes();
  let bestNode = null;
  let bestScore = -1;
  
  for (const [id, node] of Object.entries(active)) {
    // Check hard requirements
    if (requirements.capability && !node.capabilities.includes(requirements.capability)) continue;
    if (requirements.model && !node.models.includes(requirements.model)) continue;
    if (requirements.minRAM && node.resources.ramFreeMB < requirements.minRAM) continue;
    
    // Score by: idle CPU (40%), free RAM (30%), jobs completed reliability (30%)
    const cpuScore = (node.resources.cpuIdle || 0) / 100;
    const ramScore = Math.min((node.resources.ramFreeMB || 0) / 16000, 1);
    const reliabilityScore = Math.min((node.jobsCompleted || 0) / 100, 1);
    
    const score = cpuScore * 0.4 + ramScore * 0.3 + reliabilityScore * 0.3;
    
    if (score > bestScore) {
      bestScore = score;
      bestNode = node;
    }
  }
  
  return bestNode;
}

// ===== HTTP SERVER =====

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const method = req.method;
  const pathname = url.pathname;
  
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Node-Id, X-Node-Secret');
  if (method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  
  try {
    // ---- Node Registry ----
    if (method === 'POST' && pathname === '/nodes/register') {
      const data = await parseBody(req);
      data.ip = req.socket.remoteAddress;
      const node = registerNode(data);
      return json(res, { ok: true, node });
    }
    
    if (method === 'GET' && pathname === '/nodes') {
      return json(res, { nodes: getActiveNodes(), total: Object.keys(getActiveNodes()).length });
    }
    
    // ---- Job Queue ----
    if (method === 'POST' && pathname === '/jobs') {
      const data = await parseBody(req);
      
      // Auto-route: find best node if not specified
      if (!data.targetNode) {
        const best = findBestNode(data.requirements || {});
        if (best) data.suggestedNode = best.nodeId;
      }
      
      const job = submitJob(data);
      return json(res, { ok: true, job });
    }
    
    if (method === 'GET' && pathname === '/jobs/available') {
      const nodeId = url.searchParams.get('nodeId') || req.headers['x-node-id'];
      const available = getAvailableJobs(nodeId);
      return json(res, { jobs: available, count: available.length });
    }
    
    if (method === 'POST' && pathname.match(/^\/jobs\/[a-f0-9]+\/claim$/)) {
      const jobId = pathname.split('/')[2];
      const data = await parseBody(req);
      const job = claimJob(jobId, data.nodeId);
      if (!job) return json(res, { error: 'Job not available' }, 409);
      return json(res, { ok: true, job });
    }
    
    if (method === 'POST' && pathname.match(/^\/jobs\/[a-f0-9]+\/complete$/)) {
      const jobId = pathname.split('/')[2];
      const data = await parseBody(req);
      const job = completeJob(jobId, data.nodeId, data);
      if (!job) return json(res, { error: 'Not your job' }, 403);
      return json(res, { ok: true, job });
    }
    
    // ---- Ledger ----
    if (method === 'GET' && pathname.match(/^\/ledger\/.+$/)) {
      const nodeId = pathname.split('/')[2];
      const entry = ledger[nodeId] || { earned: 0, spent: 0, jobs: 0 };
      return json(res, { nodeId, ...entry, balance: entry.earned - entry.spent });
    }
    
    // ---- Network Status ----
    if (method === 'GET' && pathname === '/status') {
      const active = getActiveNodes();
      const activeCount = Object.keys(active).length;
      const totalJobs = Object.values(jobs).length;
      const completedJobs = Object.values(jobs).filter(j => j.status === 'completed').length;
      const totalComputeMin = Object.values(ledger).reduce((sum, l) => sum + (l.earned || 0), 0);
      const treasury = ledger['ic-treasury'] || { earned: 0 };
      
      // Aggregate capabilities
      const allCaps = new Set();
      const allModels = new Set();
      let totalRAM = 0;
      let totalCores = 0;
      
      for (const node of Object.values(active)) {
        (node.capabilities || []).forEach(c => allCaps.add(c));
        (node.models || []).forEach(m => allModels.add(m));
        totalRAM += node.resources?.ramMB || 0;
        totalCores += node.resources?.cpuCores || 0;
      }
      
      return json(res, {
        network: 'Intelligence Club Mesh',
        version: '0.1.0',
        status: activeCount > 0 ? 'online' : 'no nodes',
        nodes: {
          active: activeCount,
          total: Object.keys(nodes).length
        },
        compute: {
          totalCores,
          totalRAM_GB: Math.round(totalRAM / 1024 * 10) / 10,
          capabilities: [...allCaps],
          models: [...allModels]
        },
        jobs: {
          total: totalJobs,
          completed: completedJobs,
          pending: Object.values(jobs).filter(j => j.status === 'pending').length
        },
        economics: {
          totalComputeMinutes: Math.round(totalComputeMin * 100) / 100,
          treasuryMinutes: Math.round(treasury.earned * 100) / 100
        },
        uptime: process.uptime()
      });
    }
    
    // ---- Dashboard ----
    if (method === 'GET' && pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(getDashboardHTML());
    }
    
    json(res, { error: 'not found' }, 404);
    
  } catch (e) {
    console.error('Error:', e);
    json(res, { error: e.message }, 500);
  }
});

function getDashboardHTML() {
  const active = getActiveNodes();
  const activeCount = Object.keys(active).length;
  
  return `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<title>IC Mesh — Network Dashboard</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #0a0e17; color: #c8d6e5; font-family: 'Courier New', monospace; padding: 2rem; }
  h1 { color: #2d86ff; font-size: 1.2rem; letter-spacing: 0.2em; margin-bottom: 2rem; font-weight: 400; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
  .stat { border: 1px solid rgba(45,134,255,0.2); padding: 1.5rem; text-align: center; }
  .stat .num { font-size: 2rem; color: #22c55e; display: block; }
  .stat .label { font-size: 0.7rem; color: #6b7c93; letter-spacing: 0.1em; text-transform: uppercase; margin-top: 0.5rem; }
  .node { border: 1px solid rgba(45,134,255,0.15); padding: 1rem; margin-bottom: 0.5rem; }
  .node .name { color: #e0e8f0; }
  .node .info { color: #6b7c93; font-size: 0.8rem; margin-top: 0.5rem; }
  .online { color: #22c55e; }
  .offline { color: #ef4444; }
  h2 { color: #2d86ff; font-size: 0.9rem; letter-spacing: 0.15em; margin: 2rem 0 1rem; font-weight: 400; }
  .refresh { color: #4a5568; font-size: 0.7rem; margin-top: 2rem; }
</style>
</head><body>
<h1>◉ IC MESH — NETWORK DASHBOARD</h1>
<div class="stats">
  <div class="stat"><span class="num">${activeCount}</span><span class="label">Active Nodes</span></div>
  <div class="stat"><span class="num">${Object.keys(nodes).length}</span><span class="label">Total Registered</span></div>
  <div class="stat"><span class="num">${Object.values(jobs).filter(j => j.status === 'completed').length}</span><span class="label">Jobs Completed</span></div>
  <div class="stat"><span class="num">${Math.round((ledger['ic-treasury']?.earned || 0) * 100) / 100}</span><span class="label">Treasury (min)</span></div>
</div>
<h2>NODES</h2>
${Object.values(nodes).map(n => `
<div class="node">
  <span class="name">${n.name}</span>
  <span class="${n.lastSeen > Date.now() - 120000 ? 'online' : 'offline'}"> ◉ ${n.lastSeen > Date.now() - 120000 ? 'ONLINE' : 'OFFLINE'}</span>
  <div class="info">
    ${n.capabilities.join(', ')} | ${n.resources.cpuCores} cores | ${Math.round(n.resources.ramMB/1024)}GB RAM | 
    ${n.jobsCompleted} jobs | ${Math.round(n.computeMinutes*100)/100} compute min |
    Last seen: ${new Date(n.lastSeen).toLocaleString()}
  </div>
</div>`).join('') || '<div class="node"><span class="info">No nodes registered yet. Start a client to join the mesh.</span></div>'}
<p class="refresh">Auto-refreshes every 30s · <a href="/status" style="color:#2d86ff">API Status</a></p>
<script>setTimeout(() => location.reload(), 30000);</script>
</body></html>`;
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`◉ IC Mesh server live on port ${PORT}`);
  console.log(`  Dashboard: http://localhost:${PORT}`);
  console.log(`  Status:    http://localhost:${PORT}/status`);
  console.log(`  Nodes:     ${Object.keys(nodes).length} registered`);
});
