#!/usr/bin/env node
/**
 * IC Mesh — Coordination Server
 * 
 * The central hub that coordinates the Intelligence Club compute mesh.
 * 
 * Safety features:
 * - Node deduplication by name+owner (no ghost nodes)
 * - Job timeout reaper (claimed jobs auto-fail after TTL)
 * - Failed job tracking and re-queue support
 * - Version tracking per node (for update awareness)
 * 
 * API:
 *   POST /nodes/register    — node checks in (deduplicates by name+owner)
 *   GET  /nodes             — list active nodes
 *   POST /jobs              — submit a job
 *   GET  /jobs/available    — get claimable jobs (for nodes)
 *   GET  /jobs/:id          — get job status/result
 *   POST /jobs/:id/claim    — node claims a job
 *   POST /jobs/:id/complete — node reports job done
 *   POST /jobs/:id/fail     — node reports job failed
 *   GET  /ledger/:nodeId    — get node's compute balance
 *   GET  /status            — network status (includes version info)
 *   POST /upload            — upload a file (images, audio)
 *   GET  /files/:name       — download uploaded file
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = 8333;
const DATA_DIR = path.join(__dirname, 'data');
const NODES_FILE = path.join(DATA_DIR, 'nodes.json');
const JOBS_FILE = path.join(DATA_DIR, 'jobs.json');
const LEDGER_FILE = path.join(DATA_DIR, 'ledger.json');

// Job TTLs — if claimed but not completed/failed within this time, auto-fail
const JOB_CLAIM_TTL = {
  ping: 30_000,
  inference: 600_000,    // 10 min
  transcribe: 900_000,   // 15 min
  generate: 1_200_000,   // 20 min
  default: 600_000       // 10 min
};

const REAPER_INTERVAL = 60_000; // Check for stale jobs every 60s
const NODE_TIMEOUT = 180_000;   // 3 min without checkin = offline

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

// ===== NODE REGISTRY (with dedup) =====

/**
 * Find existing node by name+owner combo.
 * This prevents duplicate registrations when a client restarts.
 */
function findNodeByIdentity(name, owner) {
  for (const [id, node] of Object.entries(nodes)) {
    if (node.name === name && node.owner === owner) {
      return id;
    }
  }
  return null;
}

function registerNode(data) {
  const now = Date.now();

  // Dedup: if client sends a nodeId, use it. Otherwise look up by name+owner.
  let id = data.nodeId;
  if (!id || !nodes[id]) {
    // Client might have a stale ID or no ID — find by identity
    const existingId = findNodeByIdentity(data.name, data.owner);
    if (existingId) {
      id = existingId;
    } else {
      id = genId();
    }
  }

  const existing = nodes[id] || {};

  nodes[id] = {
    nodeId: id,
    name: data.name || 'unnamed',
    ip: data.ip || 'unknown',
    capabilities: data.capabilities || [],
    models: data.models || [],
    version: data.version || 'unknown',
    resources: {
      cpuCores: data.cpuCores || 0,
      ramMB: data.ramMB || 0,
      ramFreeMB: data.ramFreeMB || 0,
      cpuIdle: data.cpuIdle || 0,
      gpuVRAM: data.gpuVRAM || 0,
      diskFreeGB: data.diskFreeGB || 0
    },
    owner: data.owner || 'unknown',
    region: data.region || 'unknown',
    lastSeen: now,
    registeredAt: existing.registeredAt || now,
    status: 'online',
    jobsCompleted: existing.jobsCompleted || 0,
    jobsFailed: existing.jobsFailed || 0,
    computeMinutes: existing.computeMinutes || 0
  };

  save(NODES_FILE, nodes);
  return nodes[id];
}

function getActiveNodes() {
  const cutoff = Date.now() - NODE_TIMEOUT;
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
    type: data.type,
    payload: data.payload || {},
    requester: data.requester,
    requirements: data.requirements || {},
    status: 'pending',
    claimedBy: null,
    createdAt: now,
    claimedAt: null,
    completedAt: null,
    result: null,
    error: null,
    attempts: 0,
    maxAttempts: data.maxAttempts || 2,
    computeMs: 0,
    creditAmount: 0
  };

  save(JOBS_FILE, jobs);
  return jobs[id];
}

function getAvailableJobs(nodeId) {
  const available = [];
  const node = nodes[nodeId];

  for (const [id, job] of Object.entries(jobs)) {
    if (job.status !== 'pending') continue;

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
  job.attempts += 1;

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

  const computeMinutes = job.computeMs / 60000;
  job.creditAmount = computeMinutes;

  if (!ledger[nodeId]) ledger[nodeId] = { earned: 0, spent: 0, jobs: 0 };
  if (!ledger[job.requester]) ledger[job.requester] = { earned: 0, spent: 0, jobs: 0 };

  const networkCut = computeMinutes * 0.20;
  const workerPay = computeMinutes - networkCut;

  ledger[nodeId].earned += workerPay;
  ledger[nodeId].jobs += 1;
  ledger[job.requester].spent += computeMinutes;

  if (!ledger['ic-treasury']) ledger['ic-treasury'] = { earned: 0, spent: 0, jobs: 0 };
  ledger['ic-treasury'].earned += networkCut;

  if (nodes[nodeId]) {
    nodes[nodeId].jobsCompleted = (nodes[nodeId].jobsCompleted || 0) + 1;
    nodes[nodeId].computeMinutes = (nodes[nodeId].computeMinutes || 0) + computeMinutes;
  }

  save(JOBS_FILE, jobs);
  save(LEDGER_FILE, ledger);
  save(NODES_FILE, nodes);

  return job;
}

function failJob(jobId, nodeId, error) {
  const job = jobs[jobId];
  if (!job) return null;
  // Allow fail from the claiming node or from the reaper (nodeId=null)
  if (nodeId && job.claimedBy !== nodeId) return null;

  const now = Date.now();

  // Track failure on node
  if (job.claimedBy && nodes[job.claimedBy]) {
    nodes[job.claimedBy].jobsFailed = (nodes[job.claimedBy].jobsFailed || 0) + 1;
    save(NODES_FILE, nodes);
  }

  // If retries remain, re-queue. Otherwise mark failed.
  if (job.attempts < job.maxAttempts) {
    job.status = 'pending';
    job.claimedBy = null;
    job.claimedAt = null;
    job.error = error || 'unknown';
    console.log(`  ⟳ Job ${jobId} re-queued (attempt ${job.attempts}/${job.maxAttempts}): ${error}`);
  } else {
    job.status = 'failed';
    job.completedAt = now;
    job.error = error || 'unknown';
    console.log(`  ✗ Job ${jobId} permanently failed after ${job.attempts} attempts: ${error}`);
  }

  save(JOBS_FILE, jobs);
  return job;
}

// ===== JOB REAPER =====

function reapStaleJobs() {
  const now = Date.now();
  let reaped = 0;

  for (const [id, job] of Object.entries(jobs)) {
    if (job.status !== 'claimed') continue;

    const ttl = JOB_CLAIM_TTL[job.type] || JOB_CLAIM_TTL.default;
    if (now - job.claimedAt > ttl) {
      console.log(`◉ Reaper: job ${id} (${job.type}) timed out after ${Math.round((now - job.claimedAt)/1000)}s`);
      failJob(id, null, `Timed out (no completion after ${Math.round(ttl/1000)}s)`);
      reaped++;
    }
  }

  if (reaped > 0) console.log(`◉ Reaper: cleared ${reaped} stale job(s)`);
}

// ===== COMPUTE BROKER =====

function findBestNode(requirements) {
  const active = getActiveNodes();
  let bestNode = null;
  let bestScore = -1;

  for (const [id, node] of Object.entries(active)) {
    if (requirements.capability && !node.capabilities.includes(requirements.capability)) continue;
    if (requirements.model && !node.models.includes(requirements.model)) continue;
    if (requirements.minRAM && node.resources.ramFreeMB < requirements.minRAM) continue;

    const cpuScore = (node.resources.cpuIdle || 0) / 100;
    const ramScore = Math.min((node.resources.ramFreeMB || 0) / 16000, 1);
    const reliabilityScore = Math.min((node.jobsCompleted || 0) / 100, 1);
    // Penalize nodes with high failure rates
    const failRate = (node.jobsFailed || 0) / Math.max((node.jobsCompleted || 0) + (node.jobsFailed || 0), 1);
    const failPenalty = 1 - failRate;

    const score = (cpuScore * 0.35 + ramScore * 0.25 + reliabilityScore * 0.2 + failPenalty * 0.2);

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
    // ---- File Upload ----
    if (method === 'POST' && pathname === '/upload') {
      const chunks = [];
      req.on('data', c => { chunks.push(c); if (Buffer.concat(chunks).length > 50 * 1024 * 1024) req.destroy(); });
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        const bodyStr = body.toString('latin1');
        const filenameMatch = bodyStr.match(/filename="([^"]+)"/);
        const ext = filenameMatch ? path.extname(filenameMatch[1]) : '.bin';
        const id = crypto.randomBytes(8).toString('hex');
        const filename = `upload-${id}${ext}`;

        const boundaryMatch = bodyStr.match(/^--(----[^\r\n]+)/);
        if (boundaryMatch) {
          const boundary = boundaryMatch[1];
          const headerEnd = body.indexOf('\r\n\r\n') + 4;
          const footerStart = body.lastIndexOf(Buffer.from(`\r\n--${boundary}`));
          if (headerEnd > 4 && footerStart > headerEnd) {
            const fileData = body.slice(headerEnd, footerStart);
            const uploadDir = path.join(DATA_DIR, 'uploads');
            if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
            fs.writeFileSync(path.join(uploadDir, filename), fileData);
            console.log(`  ↑ Upload: ${filename} (${(fileData.length / 1024 / 1024).toFixed(1)}MB)`);
            const pubBase = process.env.IC_MESH_PUBLIC_URL || `http://localhost:${PORT}`;
            return json(res, { ok: true, url: `${pubBase}/files/${filename}`, filename, size: fileData.length });
          }
        }
        json(res, { error: 'Could not parse upload' }, 400);
      });
      return;
    }

    // ---- File Serving ----
    if (method === 'GET' && pathname.startsWith('/files/')) {
      const filename = path.basename(pathname); // sanitize
      const filePath = path.join(DATA_DIR, 'uploads', filename);
      if (!fs.existsSync(filePath)) return json(res, { error: 'Not found' }, 404);
      const stat = fs.statSync(filePath);
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': stat.size,
        'Content-Disposition': `attachment; filename="${filename}"`
      });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

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

    if (method === 'GET' && pathname.match(/^\/jobs\/[a-f0-9]+$/)) {
      const jobId = pathname.split('/')[2];
      const job = jobs[jobId];
      if (!job) return json(res, { error: 'Job not found' }, 404);
      return json(res, { job });
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

    if (method === 'POST' && pathname.match(/^\/jobs\/[a-f0-9]+\/fail$/)) {
      const jobId = pathname.split('/')[2];
      const data = await parseBody(req);
      const job = failJob(jobId, data.nodeId, data.error || 'Client reported failure');
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
      const failedJobs = Object.values(jobs).filter(j => j.status === 'failed').length;
      const pendingJobs = Object.values(jobs).filter(j => j.status === 'pending').length;
      const claimedJobs = Object.values(jobs).filter(j => j.status === 'claimed').length;
      const totalComputeMin = Object.values(ledger).reduce((sum, l) => sum + (l.earned || 0), 0);
      const treasury = ledger['ic-treasury'] || { earned: 0 };

      const allCaps = new Set();
      const allModels = new Set();
      const versions = {};
      let totalRAM = 0;
      let totalCores = 0;

      for (const node of Object.values(active)) {
        (node.capabilities || []).forEach(c => allCaps.add(c));
        (node.models || []).forEach(m => allModels.add(m));
        totalRAM += node.resources?.ramMB || 0;
        totalCores += node.resources?.cpuCores || 0;
        if (node.version) versions[node.name] = node.version;
      }

      return json(res, {
        network: 'Intelligence Club Mesh',
        version: '0.2.0',
        status: activeCount > 0 ? 'online' : 'no nodes',
        nodes: {
          active: activeCount,
          total: Object.keys(nodes).length,
          versions
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
          failed: failedJobs,
          pending: pendingJobs,
          claimed: claimedJobs
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
  const failedJobs = Object.values(jobs).filter(j => j.status === 'failed').length;

  return `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<title>IC Mesh — Network Dashboard</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #0a0e17; color: #c8d6e5; font-family: 'Courier New', monospace; padding: 2rem; }
  h1 { color: #2d86ff; font-size: 1.2rem; letter-spacing: 0.2em; margin-bottom: 2rem; font-weight: 400; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
  .stat { border: 1px solid rgba(45,134,255,0.2); padding: 1.5rem; text-align: center; }
  .stat .num { font-size: 2rem; color: #22c55e; display: block; }
  .stat .num.warn { color: #f59e0b; }
  .stat .num.bad { color: #ef4444; }
  .stat .label { font-size: 0.7rem; color: #6b7c93; letter-spacing: 0.1em; text-transform: uppercase; margin-top: 0.5rem; }
  .node { border: 1px solid rgba(45,134,255,0.15); padding: 1rem; margin-bottom: 0.5rem; }
  .node .name { color: #e0e8f0; font-weight: bold; }
  .node .info { color: #6b7c93; font-size: 0.8rem; margin-top: 0.5rem; }
  .node .version { color: #4a5568; font-size: 0.75rem; }
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
  <div class="stat"><span class="num">${Object.values(jobs).filter(j => j.status === 'completed').length}</span><span class="label">Jobs Done</span></div>
  <div class="stat"><span class="num${failedJobs > 0 ? ' bad' : ''}">${failedJobs}</span><span class="label">Jobs Failed</span></div>
  <div class="stat"><span class="num">${Math.round((ledger['ic-treasury']?.earned || 0) * 100) / 100}</span><span class="label">Treasury (min)</span></div>
</div>
<h2>NODES</h2>
${Object.values(nodes).sort((a,b) => b.lastSeen - a.lastSeen).map(n => {
  const isOnline = n.lastSeen > Date.now() - NODE_TIMEOUT;
  return `
<div class="node">
  <span class="name">${n.name}</span>
  <span class="${isOnline ? 'online' : 'offline'}"> ◉ ${isOnline ? 'ONLINE' : 'OFFLINE'}</span>
  <span class="version">${n.version || ''}</span>
  <div class="info">
    ${(n.capabilities || []).join(', ')} | ${n.resources?.cpuCores || '?'} cores | ${Math.round((n.resources?.ramMB || 0)/1024)}GB RAM |
    ${n.jobsCompleted || 0} done${n.jobsFailed ? ` / ${n.jobsFailed} failed` : ''} |
    ${Math.round((n.computeMinutes || 0)*100)/100} compute min |
    Last: ${new Date(n.lastSeen).toLocaleString()}
  </div>
</div>`;
}).join('') || '<div class="node"><span class="info">No nodes registered yet.</span></div>'}
<p class="refresh">Auto-refreshes every 30s · <a href="/status" style="color:#2d86ff">API</a></p>
<script>setTimeout(() => location.reload(), 30000);</script>
</body></html>`;
}

// ===== Start =====

server.listen(PORT, '0.0.0.0', () => {
  console.log(`◉ IC Mesh server v0.2.0 live on port ${PORT}`);
  console.log(`  Dashboard: http://localhost:${PORT}`);
  console.log(`  Nodes:     ${Object.keys(nodes).length} registered`);
  console.log(`  Reaper:    every ${REAPER_INTERVAL/1000}s`);
});

// Start the job reaper
setInterval(reapStaleJobs, REAPER_INTERVAL);
