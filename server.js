#!/usr/bin/env node
/**
 * IC Mesh — Coordination Server v0.3
 * 
 * SQLite for persistence, WebSocket for real-time, HTTP for compatibility.
 * 
 * API (HTTP — unchanged):
 *   POST /nodes/register    — node checks in
 *   GET  /nodes             — list active nodes
 *   POST /jobs              — submit a job
 *   GET  /jobs/:id          — get job status/result
 *   GET  /jobs/available    — get claimable jobs (for nodes)
 *   POST /jobs/:id/claim    — node claims a job
 *   POST /jobs/:id/complete — node reports job done
 *   GET  /ledger/:nodeId    — get node's compute balance
 *   GET  /status            — network status
 *   POST /upload            — upload file for job payload
 *   GET  /files/:name       — download uploaded file
 * 
 * WebSocket (new):
 *   ws://host:8333/ws?nodeId=<id>
 *   Messages: job.dispatch, job.progress, node.heartbeat, mesh.stats
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { WebSocketServer, WebSocket } = require('ws');

const storage = require('./lib/storage');
const Reputation = require('./lib/reputation');
const Ints = require('./lib/ints');
const AHP = require('./lib/ahp');
const Interviewer = require('./lib/interviewer');
const Agreements = require('./lib/agreements');
const RateLimiter = require('./lib/rate-limit');
const { verify: verifySignature } = require('./lib/node-auth');

// ===== AUTH TOKEN =====
const MESH_TOKEN_FILE = path.join(__dirname, 'data', 'mesh-token');
function loadOrGenerateToken() {
  const envToken = process.env.IC_MESH_TOKEN;
  if (envToken) return envToken;
  try {
    const t = fs.readFileSync(MESH_TOKEN_FILE, 'utf8').trim();
    if (t.length >= 16) return t;
  } catch {}
  const t = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(MESH_TOKEN_FILE, t, { mode: 0o600 });
  console.log(`◉ Generated mesh token → ${MESH_TOKEN_FILE}`);
  return t;
}
const MESH_TOKEN = loadOrGenerateToken();

// ===== RATE LIMITER =====
const rateLimiter = new RateLimiter();

// ===== XSS HELPER =====
function escapeHtml(str) {
  if (typeof str !== 'string') str = String(str == null ? '' : str);
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ===== AUTH HELPER =====
function requireAuth(req, res) {
  const authHeader = req.headers['authorization'] || '';
  const tokenHeader = req.headers['x-mesh-token'] || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const token = bearer || tokenHeader;
  if (!token || token !== MESH_TOKEN) {
    json(res, { error: 'Authentication required' }, 401);
    return false;
  }
  return true;
}

// ===== RATE LIMIT HELPER =====
function checkRateLimit(req, res, group = 'default') {
  const ip = req.socket.remoteAddress || 'unknown';
  const result = rateLimiter.check(ip, group);
  if (!result.allowed) {
    res.setHeader('Retry-After', String(result.retryAfter));
    json(res, { error: 'Rate limit exceeded' }, 429);
    return false;
  }
  return true;
}

const PORT = 8333;
const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_PATH = path.join(DATA_DIR, 'mesh.db');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ===== DATABASE =====
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

// Reputation system (standalone module — uses same DB)
const reputation = new Reputation(db);

// Ought currency (zero-sum integer ledger — uses same DB)
const ints = new Ints(db);

db.exec(`
  CREATE TABLE IF NOT EXISTS nodes (
    nodeId TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    ip TEXT,
    capabilities TEXT DEFAULT '[]',
    models TEXT DEFAULT '[]',
    cpuCores INTEGER DEFAULT 0,
    ramMB INTEGER DEFAULT 0,
    ramFreeMB INTEGER DEFAULT 0,
    cpuIdle INTEGER DEFAULT 0,
    gpuVRAM INTEGER DEFAULT 0,
    diskFreeGB INTEGER DEFAULT 0,
    owner TEXT DEFAULT 'unknown',
    region TEXT DEFAULT 'unknown',
    lastSeen INTEGER NOT NULL,
    registeredAt INTEGER NOT NULL,
    jobsCompleted INTEGER DEFAULT 0,
    computeMinutes REAL DEFAULT 0,
    publicKey TEXT
  );

  CREATE TABLE IF NOT EXISTS jobs (
    jobId TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    payload TEXT DEFAULT '{}',
    requester TEXT,
    requirements TEXT DEFAULT '{}',
    status TEXT DEFAULT 'pending',
    claimedBy TEXT,
    createdAt INTEGER NOT NULL,
    claimedAt INTEGER,
    completedAt INTEGER,
    result TEXT,
    computeMs INTEGER DEFAULT 0,
    creditAmount REAL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
  CREATE INDEX IF NOT EXISTS idx_jobs_claimedBy ON jobs(claimedBy);

  -- legacy ledger table removed; ints system is sole source of truth
`);

// Migration: add publicKey column if missing
try {
  db.prepare("SELECT publicKey FROM nodes LIMIT 1").get();
} catch {
  db.exec("ALTER TABLE nodes ADD COLUMN publicKey TEXT");
  console.log('  Migrated: added publicKey column to nodes');
}

// ===== PREPARED STATEMENTS =====
const stmts = {
  upsertNode: db.prepare(`
    INSERT INTO nodes (nodeId, name, ip, capabilities, models, cpuCores, ramMB, ramFreeMB, cpuIdle, gpuVRAM, diskFreeGB, owner, region, lastSeen, registeredAt, publicKey)
    VALUES (@nodeId, @name, @ip, @capabilities, @models, @cpuCores, @ramMB, @ramFreeMB, @cpuIdle, @gpuVRAM, @diskFreeGB, @owner, @region, @lastSeen, @registeredAt, @publicKey)
    ON CONFLICT(nodeId) DO UPDATE SET
      name=@name, ip=@ip, capabilities=@capabilities, models=@models,
      cpuCores=@cpuCores, ramMB=@ramMB, ramFreeMB=@ramFreeMB, cpuIdle=@cpuIdle,
      gpuVRAM=@gpuVRAM, diskFreeGB=@diskFreeGB, owner=@owner, region=@region, lastSeen=@lastSeen,
      publicKey=COALESCE(@publicKey, publicKey)
  `),
  getNode: db.prepare('SELECT * FROM nodes WHERE nodeId = ?'),
  getActiveNodes: db.prepare('SELECT * FROM nodes WHERE lastSeen > ?'),
  getAllNodes: db.prepare('SELECT * FROM nodes'),
  
  insertJob: db.prepare(`
    INSERT INTO jobs (jobId, type, payload, requester, requirements, status, createdAt)
    VALUES (@jobId, @type, @payload, @requester, @requirements, 'pending', @createdAt)
  `),
  getJob: db.prepare('SELECT * FROM jobs WHERE jobId = ?'),
  getPendingJobs: db.prepare("SELECT * FROM jobs WHERE status = 'pending' ORDER BY createdAt ASC"),
  claimJob: db.prepare("UPDATE jobs SET status = 'claimed', claimedBy = ?, claimedAt = ? WHERE jobId = ? AND status = 'pending'"),
  completeJob: db.prepare("UPDATE jobs SET status = 'completed', completedAt = ?, result = ?, computeMs = ?, creditAmount = ? WHERE jobId = ? AND claimedBy = ?"),
  failJob: db.prepare("UPDATE jobs SET status = 'failed', result = ? WHERE jobId = ?"),
  countJobs: db.prepare("SELECT status, COUNT(*) as count FROM jobs GROUP BY status"),
  
  updateNodeStats: db.prepare('UPDATE nodes SET jobsCompleted = jobsCompleted + 1, computeMinutes = computeMinutes + ? WHERE nodeId = ?'),
  findNodeByNameOwner: db.prepare('SELECT nodeId FROM nodes WHERE name = ? AND owner = ?'),
  getClaimedStale: db.prepare("SELECT * FROM jobs WHERE status = 'claimed' AND claimedAt < ?"),
};

function migrateFromJSON() {
  const count = db.prepare('SELECT COUNT(*) as c FROM nodes').get().c;
  if (count > 0) return; // already has data
  
  try {
    const nodesFile = path.join(DATA_DIR, 'nodes.json');
    const jobsFile = path.join(DATA_DIR, 'jobs.json');
    const ledgerFile = path.join(DATA_DIR, 'ledger.json');
    
    if (fs.existsSync(nodesFile)) {
      const nodes = JSON.parse(fs.readFileSync(nodesFile, 'utf8'));
      for (const n of Object.values(nodes)) {
        stmts.upsertNode.run({
          nodeId: n.nodeId, name: n.name || 'unknown', ip: n.ip || '',
          capabilities: JSON.stringify(n.capabilities || []),
          models: JSON.stringify(n.models || []),
          cpuCores: n.resources?.cpuCores || 0, ramMB: n.resources?.ramMB || 0,
          ramFreeMB: n.resources?.ramFreeMB || 0, cpuIdle: n.resources?.cpuIdle || 0,
          gpuVRAM: n.resources?.gpuVRAM || 0, diskFreeGB: n.resources?.diskFreeGB || 0,
          owner: n.owner || 'unknown', region: n.region || 'unknown',
          lastSeen: n.lastSeen || Date.now(), registeredAt: n.registeredAt || Date.now()
        });
      }
      console.log(`  Migrated ${Object.keys(nodes).length} nodes from JSON`);
    }
    
    if (fs.existsSync(jobsFile)) {
      const jobs = JSON.parse(fs.readFileSync(jobsFile, 'utf8'));
      for (const j of Object.values(jobs)) {
        try {
          stmts.insertJob.run({
            jobId: j.jobId, type: j.type,
            payload: JSON.stringify(j.payload || {}),
            requester: j.requester || '',
            requirements: JSON.stringify(j.requirements || {}),
            createdAt: j.createdAt || Date.now()
          });
          if (j.status === 'completed') {
            stmts.completeJob.run(j.completedAt, JSON.stringify(j.result), j.computeMs || 0, j.creditAmount || 0, j.jobId, j.claimedBy);
          } else if (j.status === 'claimed') {
            stmts.claimJob.run(j.claimedBy, j.claimedAt, j.jobId);
          }
        } catch(e) {} // skip dupes
      }
      console.log(`  Migrated ${Object.keys(jobs).length} jobs from JSON`);
    }
    
    // Legacy ledger migration removed — ints system is sole source of truth
  } catch(e) {
    console.log('  JSON migration skipped:', e.message);
  }
}

// Migrate existing JSON data if DB is fresh
migrateFromJSON();

// AHP: Agent Hiring Protocol modules (after tables exist)
const ahp = new AHP(db, reputation, ints);
const interviewer = new Interviewer(db, reputation, ints);
const agreements = new Agreements(db);

// ===== HELPER FUNCTIONS =====
function genId() { return crypto.randomBytes(8).toString('hex'); }

function nodeToJSON(row) {
  return {
    nodeId: row.nodeId, name: row.name, ip: row.ip,
    capabilities: JSON.parse(row.capabilities || '[]'),
    models: JSON.parse(row.models || '[]'),
    resources: {
      cpuCores: row.cpuCores, ramMB: row.ramMB, ramFreeMB: row.ramFreeMB,
      cpuIdle: row.cpuIdle, gpuVRAM: row.gpuVRAM, diskFreeGB: row.diskFreeGB
    },
    owner: row.owner, region: row.region,
    lastSeen: row.lastSeen, registeredAt: row.registeredAt,
    status: row.lastSeen > Date.now() - 120000 ? 'online' : 'offline',
    jobsCompleted: row.jobsCompleted, computeMinutes: row.computeMinutes
  };
}

function jobToJSON(row) {
  return {
    jobId: row.jobId, type: row.type,
    payload: JSON.parse(row.payload || '{}'),
    requester: row.requester,
    requirements: JSON.parse(row.requirements || '{}'),
    status: row.status, claimedBy: row.claimedBy,
    createdAt: row.createdAt, claimedAt: row.claimedAt,
    completedAt: row.completedAt,
    result: row.result ? JSON.parse(row.result) : null,
    computeMs: row.computeMs, creditAmount: row.creditAmount
  };
}

function registerNode(data) {
  // Dedup: if client sends an ID we know, use it. Otherwise match by name+owner.
  let id = data.nodeId;
  if (!id || !stmts.getNode.get(id)) {
    const existing = stmts.findNodeByNameOwner.get(data.name || 'unnamed', data.owner || 'unknown');
    id = existing ? existing.nodeId : genId();
  }
  const now = Date.now();
  stmts.upsertNode.run({
    nodeId: id, name: data.name || 'unnamed', ip: data.ip || 'unknown',
    capabilities: JSON.stringify(data.capabilities || []),
    models: JSON.stringify(data.models || []),
    cpuCores: data.cpuCores || 0, ramMB: data.ramMB || 0,
    ramFreeMB: data.ramFreeMB || 0, cpuIdle: data.cpuIdle || 0,
    gpuVRAM: data.gpuVRAM || 0, diskFreeGB: data.diskFreeGB || 0,
    owner: data.owner || 'unknown', region: data.region || 'unknown',
    lastSeen: now, registeredAt: now,
    publicKey: data.publicKey || null
  });
  return nodeToJSON(stmts.getNode.get(id));
}

function getActiveNodes() {
  const cutoff = Date.now() - 120000;
  const rows = stmts.getActiveNodes.all(cutoff);
  const result = {};
  for (const r of rows) result[r.nodeId] = nodeToJSON(r);
  return result;
}

function submitJob(data) {
  const id = genId();
  stmts.insertJob.run({
    jobId: id, type: data.type,
    payload: JSON.stringify(data.payload || {}),
    requester: data.requester || '',
    requirements: JSON.stringify(data.requirements || {}),
    createdAt: Date.now()
  });
  
  // Push to connected WebSocket nodes
  broadcastToEligibleNodes(jobToJSON(stmts.getJob.get(id)));
  
  return jobToJSON(stmts.getJob.get(id));
}

function getAvailableJobs(nodeId) {
  const pending = stmts.getPendingJobs.all();
  const node = stmts.getNode.get(nodeId);
  const nodeCaps = node ? JSON.parse(node.capabilities || '[]') : [];
  const nodeModels = node ? JSON.parse(node.models || '[]') : [];
  
  return pending.filter(row => {
    const req = JSON.parse(row.requirements || '{}');
    if (req.capability && !nodeCaps.includes(req.capability)) return false;
    if (req.model && !nodeModels.includes(req.model)) return false;
    if (req.minRAM && node && node.ramFreeMB < req.minRAM) return false;
    return true;
  }).map(jobToJSON);
}

function claimJob(jobId, nodeId) {
  const info = stmts.claimJob.run(nodeId, Date.now(), jobId);
  if (info.changes === 0) return null;
  return jobToJSON(stmts.getJob.get(jobId));
}

function completeJob(jobId, nodeId, result) {
  const job = stmts.getJob.get(jobId);
  if (!job || job.claimedBy !== nodeId) return null;
  
  const now = Date.now();
  const computeMs = now - job.claimedAt;
  const computeMinutes = computeMs / 60000;
  
  stmts.completeJob.run(now, JSON.stringify(result.data || null), computeMs, 0, jobId, nodeId);
  stmts.updateNodeStats.run(computeMinutes, nodeId);
  
  const completed = jobToJSON(stmts.getJob.get(jobId));
  
  // Record reputation event
  try {
    reputation.recordEvent({
      nodeId,
      type: 'job_completed',
      jobId,
      jobType: completed.type,
      details: { claimed_time: computeMs, actual_time: computeMs }
    });
  } catch (e) { console.error('  ✗ Reputation event failed:', e.message); }
  
  // Settle payment via ints with 20% network fee (unified — replaces legacy ledger)
  try {
    if (job.requester && job.requester !== nodeId) {
      const settlement = ints.settleJobWithFee(job.requester, nodeId, computeMs, jobId, completed.type, 0.20);
      console.log(`  ◎ Settled: ${settlement.totalAmount} ints (${settlement.workerAmount} → ${nodeId}, ${settlement.feeAmount} → treasury)`);
      // Track in agreements if applicable
      try { agreements.recordJobCompleted(nodeId, settlement.workerAmount); } catch (e) {}
    }
  } catch (e) { console.error('  ✗ Ints settlement failed:', e.message); }
  
  // Notify via WebSocket
  broadcastEvent('job.completed', { jobId, type: completed.type, computeMs, nodeId });
  
  return completed;
}

// ===== WEBSOCKET =====
const wsClients = new Map(); // nodeId -> WebSocket

function setupWebSocket(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });
  
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const nodeId = url.searchParams.get('nodeId') || 'unknown';
    const wsToken = url.searchParams.get('token') || '';
    
    // Authenticate WebSocket connections
    if (wsToken !== MESH_TOKEN) {
      ws.close(4001, 'Authentication required');
      return;
    }
    
    // Validate nodeId exists (except dashboard)
    if (nodeId !== 'dashboard' && !stmts.getNode.get(nodeId)) {
      ws.close(4002, 'Unknown node');
      return;
    }
    
    wsClients.set(nodeId, ws);
    console.log(`  ⚡ WS connected: ${nodeId} (${wsClients.size} total)`);
    
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        handleWsMessage(nodeId, msg, ws);
      } catch(e) {}
    });
    
    ws.on('close', () => {
      wsClients.delete(nodeId);
      console.log(`  ⚡ WS disconnected: ${nodeId} (${wsClients.size} total)`);
    });
    
    ws.on('error', () => wsClients.delete(nodeId));
    
    // Send pending jobs immediately
    const available = getAvailableJobs(nodeId);
    if (available.length > 0) {
      ws.send(JSON.stringify({ type: 'jobs.available', jobs: available }));
    }
  });
  
  return wss;
}

function handleWsMessage(nodeId, msg, ws) {
  switch(msg.type) {
    case 'node.heartbeat':
      // Update node resources
      if (msg.payload) {
        const data = { ...msg.payload, nodeId, ip: '' };
        registerNode(data);
      }
      break;
    case 'job.claim':
      const claimed = claimJob(msg.jobId, nodeId);
      ws.send(JSON.stringify({ type: 'job.claim.result', jobId: msg.jobId, ok: !!claimed }));
      break;
    case 'job.result':
      const completed = completeJob(msg.jobId, nodeId, { data: msg.result });
      ws.send(JSON.stringify({ type: 'job.complete.result', jobId: msg.jobId, ok: !!completed }));
      break;
    case 'job.progress':
      broadcastEvent('job.progress', { jobId: msg.jobId, progress: msg.progress, nodeId });
      break;
  }
}

function broadcastToEligibleNodes(job) {
  const req = job.requirements || {};
  // Collect eligible nodes, prioritize those with active agreements
  const eligible = [];
  for (const [nodeId, ws] of wsClients) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    const node = stmts.getNode.get(nodeId);
    if (!node) continue;
    const caps = JSON.parse(node.capabilities || '[]');
    if (req.capability && !caps.includes(req.capability)) continue;
    const hasAgreement = agreements.hasActiveAgreement(nodeId);
    eligible.push({ nodeId, ws, hasAgreement });
  }
  // Sort: agreement nodes first
  eligible.sort((a, b) => (b.hasAgreement ? 1 : 0) - (a.hasAgreement ? 1 : 0));
  for (const { ws } of eligible) {
    ws.send(JSON.stringify({ type: 'job.dispatch', job }));
  }
}

function broadcastEvent(type, data) {
  const msg = JSON.stringify({ type, ...data, timestamp: Date.now() });
  for (const [, ws] of wsClients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Node-Id, X-Node-Secret, X-Mesh-Token, Authorization, X-Signature, X-Timestamp');
  if (method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  
  try {
    // ---- File Upload ----
    if (method === 'POST' && pathname === '/upload') {
      if (!requireAuth(req, res)) return;
      if (!checkRateLimit(req, res, 'upload')) return;
      // Reject oversized uploads before buffering
      const contentLength = parseInt(req.headers['content-length'] || '0', 10);
      if (contentLength > 50 * 1024 * 1024) return json(res, { error: 'File too large (max 50MB)' }, 413);
      // Validate Content-Type
      const ct = (req.headers['content-type'] || '').toLowerCase();
      if (!ct.startsWith('multipart/form-data') && !ct.startsWith('audio/') && !ct.startsWith('image/') && !ct.startsWith('video/') && ct !== 'application/octet-stream') {
        return json(res, { error: 'Invalid Content-Type' }, 400);
      }
      const chunks = [];
      req.on('data', c => { chunks.push(c); if (Buffer.concat(chunks).length > 50 * 1024 * 1024) req.destroy(); });
      req.on('end', async () => {
        try {
          const body = Buffer.concat(chunks);
          const bodyStr = body.toString('latin1');
          const filenameMatch = bodyStr.match(/filename="([^"]+)"/);
          const origFilename = filenameMatch ? filenameMatch[1] : 'upload.bin';
          
          const boundaryMatch = bodyStr.match(/^--(----[^\r\n]+)/);
          if (boundaryMatch) {
            const boundary = boundaryMatch[1];
            const headerEnd = body.indexOf('\r\n\r\n') + 4;
            const footerStart = body.lastIndexOf(Buffer.from(`\r\n--${boundary}`));
            if (headerEnd > 4 && footerStart > headerEnd) {
              const fileData = body.slice(headerEnd, footerStart);
              const result = await storage.uploadFile(fileData, origFilename);
              console.log(`  ↑ Upload: ${result.filename} (${(result.size / 1024 / 1024).toFixed(1)}MB) [${result.storage}]`);
              return json(res, { ok: true, url: result.url, filename: result.filename, size: result.size, storage: result.storage });
            }
          }
          json(res, { error: 'Could not parse upload' }, 400);
        } catch(e) {
          json(res, { error: e.message }, 500);
        }
      });
      return;
    }

    // ---- File Serving ----
    if (method === 'GET' && pathname.startsWith('/files/')) {
      const filename = pathname.split('/').pop();
      const filePath = path.join(UPLOAD_DIR, filename);
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
      if (!requireAuth(req, res)) return;
      if (!checkRateLimit(req, res, 'nodes-register')) return;
      const data = await parseBody(req);
      data.ip = req.socket.remoteAddress;
      const node = registerNode(data);
      // Track uptime for reputation (throttled to 1 event per 5 min per node)
      try {
        const last = checkinTracker.get(node.nodeId) || 0;
        if (Date.now() - last > 300000) {
          reputation.recordEvent({ nodeId: node.nodeId, type: 'uptime_checkin' });
          checkinTracker.set(node.nodeId, Date.now());
        }
      } catch (e) {}
      return json(res, { ok: true, node });
    }
    
    if (method === 'GET' && pathname === '/nodes') {
      if (!requireAuth(req, res)) return;
      const active = getActiveNodes();
      return json(res, { nodes: active, total: Object.keys(active).length });
    }
    
    // ---- Job Queue ----
    if (method === 'POST' && pathname === '/jobs') {
      if (!requireAuth(req, res)) return;
      if (!checkRateLimit(req, res, 'jobs-post')) return;
      const data = await parseBody(req);
      const job = submitJob(data);
      return json(res, { ok: true, job });
    }
    
    if (method === 'GET' && pathname.match(/^\/jobs\/[a-f0-9]+$/) && !pathname.includes('/available')) {
      const jobId = pathname.split('/')[2];
      const row = stmts.getJob.get(jobId);
      if (!row) return json(res, { error: 'Job not found' }, 404);
      return json(res, { job: jobToJSON(row) });
    }
    
    if (method === 'GET' && pathname === '/jobs/available') {
      if (!requireAuth(req, res)) return;
      const nodeId = url.searchParams.get('nodeId') || req.headers['x-node-id'];
      return json(res, { jobs: getAvailableJobs(nodeId), count: 0 });
    }
    
    if (method === 'POST' && pathname.match(/^\/jobs\/[a-f0-9]+\/claim$/)) {
      if (!requireAuth(req, res)) return;
      const jobId = pathname.split('/')[2];
      const data = await parseBody(req);
      // Verify node signature if node has a public key
      const node = data.nodeId ? stmts.getNode.get(data.nodeId) : null;
      if (node && node.publicKey) {
        const sigData = { jobId, nodeId: data.nodeId, timestamp: data.timestamp };
        if (!data.signature || !verifySignature(node.publicKey, sigData, data.signature)) {
          return json(res, { error: 'Invalid signature' }, 403);
        }
      }
      const job = claimJob(jobId, data.nodeId);
      if (!job) return json(res, { error: 'Job not available' }, 409);
      return json(res, { ok: true, job });
    }
    
    if (method === 'POST' && pathname.match(/^\/jobs\/[a-f0-9]+\/complete$/)) {
      if (!requireAuth(req, res)) return;
      const jobId = pathname.split('/')[2];
      const data = await parseBody(req);
      // Verify node signature
      const node = data.nodeId ? stmts.getNode.get(data.nodeId) : null;
      if (node && node.publicKey) {
        const sigData = { jobId, nodeId: data.nodeId, timestamp: data.timestamp };
        if (!data.signature || !verifySignature(node.publicKey, sigData, data.signature)) {
          return json(res, { error: 'Invalid signature' }, 403);
        }
      }
      const job = completeJob(jobId, data.nodeId, data);
      if (!job) return json(res, { error: 'Not your job' }, 403);
      return json(res, { ok: true, job });
    }
    
    // ---- Job Failure ----
    if (method === 'POST' && pathname.match(/^\/jobs\/[a-f0-9]+\/fail$/)) {
      if (!requireAuth(req, res)) return;
      const jobId = pathname.split('/')[2];
      const data = await parseBody(req);
      // Verify node signature
      const nodeRow = data.nodeId ? stmts.getNode.get(data.nodeId) : null;
      if (nodeRow && nodeRow.publicKey) {
        const sigData = { jobId, nodeId: data.nodeId, timestamp: data.timestamp };
        if (!data.signature || !verifySignature(nodeRow.publicKey, sigData, data.signature)) {
          return json(res, { error: 'Invalid signature' }, 403);
        }
      }
      const job = stmts.getJob.get(jobId);
      if (!job) return json(res, { error: 'Job not found' }, 404);
      if (data.nodeId && job.claimedBy !== data.nodeId) return json(res, { error: 'Not your job' }, 403);
      stmts.failJob.run(JSON.stringify({ error: data.error || 'Client reported failure' }), jobId);
      try {
        reputation.recordEvent({
          nodeId: job.claimedBy || data.nodeId,
          type: 'job_failed',
          jobId,
          jobType: job.type,
          details: { error: data.error }
        });
      } catch (e) { console.error('  ✗ Reputation event failed:', e.message); }
      return json(res, { ok: true, job: jobToJSON(stmts.getJob.get(jobId)) });
    }

    // ---- Reputation ----
    if (method === 'GET' && pathname.match(/^\/reputation\/leaderboard$/)) {
      if (!requireAuth(req, res)) return;
      const limit = parseInt(url.searchParams.get('limit')) || 20;
      return json(res, { leaderboard: reputation.getLeaderboard({ limit }) });
    }

    if (method === 'GET' && pathname.match(/^\/reputation\/[a-f0-9]+\/history$/)) {
      if (!requireAuth(req, res)) return;
      const nodeId = pathname.split('/')[2];
      const limit = parseInt(url.searchParams.get('limit')) || 50;
      return json(res, { events: reputation.getHistory(nodeId, { limit }) });
    }

    if (method === 'GET' && pathname.match(/^\/reputation\/[a-f0-9]+\/evidence$/)) {
      if (!requireAuth(req, res)) return;
      const nodeId = pathname.split('/')[2];
      return json(res, reputation.getEvidence(nodeId));
    }

    if (method === 'GET' && pathname.match(/^\/reputation\/[a-f0-9]+$/)) {
      if (!requireAuth(req, res)) return;
      const nodeId = pathname.split('/')[2];
      return json(res, reputation.getScore(nodeId));
    }

    // ---- Ought Currency ----
    if (method === 'GET' && pathname === '/ints/stats') {
      if (!requireAuth(req, res)) return;
      return json(res, ints.getNetworkStats());
    }

    if (method === 'GET' && pathname === '/ints/audit') {
      if (!requireAuth(req, res)) return;
      return json(res, ints.audit());
    }

    if (method === 'GET' && pathname.match(/^\/ints\/[a-zA-Z0-9_-]+\/ledger$/)) {
      if (!requireAuth(req, res)) return;
      const accountId = pathname.split('/')[2];
      const limit = parseInt(url.searchParams.get('limit')) || 50;
      return json(res, { accountId, transactions: ints.getLedger(accountId, { limit }) });
    }

    if (method === 'GET' && pathname.match(/^\/ints\/[a-zA-Z0-9_-]+$/)) {
      if (!requireAuth(req, res)) return;
      const accountId = pathname.split('/')[2];
      if (accountId === 'stats' || accountId === 'audit') { /* handled above */ }
      else return json(res, ints.getAccount(accountId));
    }

    // ---- AHP: Profiles ----
    if (method === 'GET' && pathname === '/.well-known/ahp-profile.json') {
      const profile = ahp.getServerProfile();
      profile.network.wsConnected = wsClients.size;
      return json(res, profile);
    }

    if (method === 'GET' && pathname === '/ahp/profiles') {
      // If authenticated, return full profiles; otherwise strip sensitive info
      const authHeader = req.headers['authorization'] || '';
      const tokenHeader = req.headers['x-mesh-token'] || '';
      const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      const hasAuth = (bearer || tokenHeader) === MESH_TOKEN;
      let profiles = ahp.getAllProfiles();
      if (!hasAuth) {
        profiles = profiles.map(p => {
          const { ip, ...rest } = p;
          if (rest.resources) { delete rest.resources.ramMB; delete rest.resources.diskFreeGB; }
          return rest;
        });
      }
      return json(res, { profiles });
    }

    if (method === 'GET' && pathname.match(/^\/ahp\/profiles\/[a-f0-9]+$/)) {
      const nodeId = pathname.split('/')[3];
      const profile = ahp.getProfile(nodeId);
      if (!profile) return json(res, { error: 'Node not found' }, 404);
      return json(res, profile);
    }

    // ---- AHP: Interviews ----
    if (method === 'POST' && pathname === '/ahp/interviews') {
      if (!requireAuth(req, res)) return;
      const data = await parseBody(req);
      if (!data.nodeId) return json(res, { error: 'nodeId required' }, 400);
      try {
        const interview = interviewer.startInterview(data.nodeId, data.position || {});
        return json(res, { ok: true, interview });
      } catch (e) {
        return json(res, { error: e.message }, 400);
      }
    }

    if (method === 'POST' && pathname.match(/^\/ahp\/interviews\/int_[a-f0-9]+\/respond$/)) {
      if (!requireAuth(req, res)) return;
      const interviewId = pathname.split('/')[3];
      const data = await parseBody(req);
      try {
        const interview = interviewer.submitResponses(interviewId, data.responses || []);
        return json(res, { ok: true, interview });
      } catch (e) {
        return json(res, { error: e.message }, 400);
      }
    }

    if (method === 'GET' && pathname === '/ahp/interviews') {
      if (!requireAuth(req, res)) return;
      const status = url.searchParams.get('status');
      const requestingNodeId = req.headers['x-node-id'] || url.searchParams.get('nodeId');
      let interviews = interviewer.listInterviews({ status });
      // Scope to requesting node if nodeId provided
      if (requestingNodeId) {
        interviews = interviews.filter(i => i.nodeId === requestingNodeId);
      }
      return json(res, { interviews });
    }

    if (method === 'GET' && pathname.match(/^\/ahp\/interviews\/int_[a-f0-9]+$/)) {
      if (!requireAuth(req, res)) return;
      const interviewId = pathname.split('/')[3];
      const interview = interviewer.getInterview(interviewId);
      if (!interview) return json(res, { error: 'Interview not found' }, 404);
      return json(res, interview);
    }

    // ---- AHP: Agreements ----
    if (method === 'POST' && pathname === '/ahp/agreements') {
      if (!requireAuth(req, res)) return;
      const data = await parseBody(req);
      if (!data.nodeId) return json(res, { error: 'nodeId required' }, 400);
      try {
        const agreement = agreements.create(data);
        return json(res, { ok: true, agreement });
      } catch (e) {
        return json(res, { error: e.message }, 400);
      }
    }

    if (method === 'GET' && pathname === '/ahp/agreements') {
      const nodeId = url.searchParams.get('nodeId');
      const status = url.searchParams.get('status');
      return json(res, { agreements: agreements.list({ nodeId, status }) });
    }

    if (method === 'GET' && pathname.match(/^\/ahp\/agreements\/agr_[a-f0-9]+$/)) {
      const agreementId = pathname.split('/')[3];
      const agreement = agreements.get(agreementId);
      if (!agreement) return json(res, { error: 'Agreement not found' }, 404);
      return json(res, agreement);
    }

    if (method === 'PATCH' && pathname.match(/^\/ahp\/agreements\/agr_[a-f0-9]+$/)) {
      if (!requireAuth(req, res)) return;
      const agreementId = pathname.split('/')[3];
      const data = await parseBody(req);
      try {
        if (data.status === 'terminated') {
          const agreement = agreements.terminate(agreementId, data.reason || 'Manual termination');
          return json(res, { ok: true, agreement });
        }
        return json(res, { error: 'Only status=terminated supported via PATCH' }, 400);
      } catch (e) {
        return json(res, { error: e.message }, 400);
      }
    }

    // Legacy ledger endpoint removed — use /ints/:accountId instead
    
    // ---- Handler Registry ----
    if (method === 'GET' && pathname === '/handlers') {
      const active = getActiveNodes();
      const handlerMap = {};
      for (const node of Object.values(active)) {
        for (const cap of node.capabilities || []) {
          if (!handlerMap[cap]) handlerMap[cap] = { nodes: 0, descriptions: [] };
          handlerMap[cap].nodes++;
        }
      }
      return json(res, { handlers: handlerMap, total: Object.keys(handlerMap).length });
    }

    // ---- Network Status ----
    if (method === 'GET' && pathname === '/status') {
      const active = getActiveNodes();
      const activeCount = Object.keys(active).length;
      const allNodes = stmts.getAllNodes.all();
      const jobCounts = {};
      for (const row of stmts.countJobs.all()) jobCounts[row.status] = row.count;
      
      const allCaps = new Set();
      const allModels = new Set();
      let totalRAM = 0, totalCores = 0;
      for (const node of Object.values(active)) {
        (node.capabilities || []).forEach(c => allCaps.add(c));
        (node.models || []).forEach(m => allModels.add(m));
        totalRAM += node.resources?.ramMB || 0;
        totalCores += node.resources?.cpuCores || 0;
      }
      
      return json(res, {
        network: 'Intelligence Club Mesh',
        version: '0.3.0',
        status: activeCount > 0 ? 'online' : 'no nodes',
        nodes: { active: activeCount, total: allNodes.length },
        compute: {
          totalCores, totalRAM_GB: Math.round(totalRAM / 1024 * 10) / 10,
          capabilities: [...allCaps], models: [...allModels]
        },
        jobs: {
          total: Object.values(jobCounts).reduce((a, b) => a + b, 0),
          completed: jobCounts.completed || 0,
          pending: jobCounts.pending || 0
        },
        websocket: { connected: wsClients.size },
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

// ===== DASHBOARD =====
function getDashboardHTML() {
  const active = getActiveNodes();
  const activeCount = Object.keys(active).length;
  const allNodes = stmts.getAllNodes.all();
  const jobCounts = {};
  for (const row of stmts.countJobs.all()) jobCounts[row.status] = row.count;
  const activeAgreements = agreements.countActive();
  const intsStats = ints.getNetworkStats();
  const treasuryAccount = ints.getAccount('ic-treasury');
  const activeInterviews = interviewer.listInterviews({ status: 'pending' });

  return `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<title>IC Mesh — Network Dashboard</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #0a0e17; color: #c8d6e5; font-family: 'Courier New', monospace; padding: 2rem; }
  h1 { color: #2d86ff; font-size: 1.2rem; letter-spacing: 0.2em; margin-bottom: 0.5rem; font-weight: 400; }
  .version { color: #6b7c93; font-size: 0.7rem; margin-bottom: 2rem; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
  .stat { border: 1px solid rgba(45,134,255,0.2); padding: 1.5rem; text-align: center; }
  .stat .num { font-size: 2rem; color: #22c55e; display: block; }
  .stat .label { font-size: 0.7rem; color: #6b7c93; letter-spacing: 0.1em; text-transform: uppercase; margin-top: 0.5rem; }
  .node { border: 1px solid rgba(45,134,255,0.15); padding: 1rem; margin-bottom: 0.5rem; }
  .node .name { color: #e0e8f0; }
  .node .info { color: #6b7c93; font-size: 0.8rem; margin-top: 0.5rem; }
  .online { color: #22c55e; }
  .offline { color: #ef4444; }
  .ws { color: #a78bfa; }
  h2 { color: #2d86ff; font-size: 0.9rem; letter-spacing: 0.15em; margin: 2rem 0 1rem; font-weight: 400; }
  .refresh { color: #4a5568; font-size: 0.7rem; margin-top: 2rem; }
  #events { max-height: 200px; overflow-y: auto; font-size: 0.75rem; color: #6b7c93; border: 1px solid rgba(45,134,255,0.1); padding: 0.5rem; }
</style>
</head><body>
<h1>◉ IC MESH — NETWORK DASHBOARD</h1>
<div class="version">v0.3.0 — SQLite + WebSocket | ${wsClients.size} WS connections</div>
<div class="stats">
  <div class="stat"><span class="num">${activeCount}</span><span class="label">Active Nodes</span></div>
  <div class="stat"><span class="num">${allNodes.length}</span><span class="label">Total Registered</span></div>
  <div class="stat"><span class="num">${jobCounts.completed || 0}</span><span class="label">Jobs Completed</span></div>
  <div class="stat"><span class="num">${jobCounts.pending || 0}</span><span class="label">Pending</span></div>
  <div class="stat"><span class="num">${wsClients.size}</span><span class="label">WS Connected</span></div>
  <div class="stat"><span class="num">${activeAgreements}</span><span class="label">Active Agreements</span></div>
  <div class="stat"><span class="num">${treasuryAccount.balance}</span><span class="label">Treasury (ints)</span></div>
  <div class="stat"><span class="num">${intsStats.totalOughtTransacted}</span><span class="label">Total Transacted</span></div>
</div>
${activeInterviews.length > 0 ? `<h2>ACTIVE INTERVIEWS</h2>
${activeInterviews.map(i => `<div class="node"><span class="name">Interview ${escapeHtml(i.interviewId)}</span> <span class="online">● ${escapeHtml(i.status.toUpperCase())}</span><div class="info">Node: ${escapeHtml(i.nodeId)} | Questions: ${i.questions.length} | Started: ${new Date(i.createdAt).toLocaleString()}</div></div>`).join('')}` : ''}
<h2>NODES</h2>
${allNodes.map(r => {
  const n = nodeToJSON(r);
  const isOnline = n.status === 'online';
  const hasWs = wsClients.has(n.nodeId);
  return `<div class="node">
  <span class="name">${escapeHtml(n.name)}</span>
  <span class="${isOnline ? 'online' : 'offline'}"> ◉ ${isOnline ? 'ONLINE' : 'OFFLINE'}</span>
  ${hasWs ? '<span class="ws"> ⚡ WS</span>' : ''}
  <div class="info">
    ${escapeHtml(n.capabilities.join(', '))} | ${n.resources.cpuCores} cores | ${Math.round(n.resources.ramMB/1024)}GB RAM | 
    ${n.jobsCompleted} jobs | ${Math.round(n.computeMinutes*100)/100} compute min
  </div>
</div>`;
}).join('') || '<div class="node"><span class="info">No nodes registered yet.</span></div>'}
<h2>LIVE EVENTS</h2>
<div id="events"><em>Connect via WebSocket to see live events</em></div>
<p class="refresh">Auto-refreshes every 15s · <a href="/status" style="color:#2d86ff">API</a> · <a href="/ws" style="color:#a78bfa">WebSocket</a></p>
<script>
setTimeout(() => location.reload(), 15000);
try {
  const ws = new WebSocket('ws://' + location.host + '/ws?nodeId=dashboard');
  const el = document.getElementById('events');
  ws.onmessage = (e) => {
    const div = document.createElement('div');
    div.textContent = new Date().toLocaleTimeString() + ' ' + e.data;
    el.prepend(div);
    while (el.children.length > 50) el.removeChild(el.lastChild);
  };
} catch(e) {}
</script>
</body></html>`;
}

// ===== START =====
setupWebSocket(server);

// Init Spaces storage (falls back to local if not configured)
storage.initSpaces().then(ok => {
  if (!ok) console.log('  📁 Storage: local disk (set DO_SPACES_KEY/SECRET for Spaces)');
});

// Reputation: record uptime on checkin, decay scores daily
const checkinTracker = new Map(); // nodeId -> lastCheckinTimestamp
setInterval(() => {
  try { reputation.decayScores(); } catch (e) { console.error('Reputation decay error:', e.message); }
}, 86400000); // Daily

// Reap stale claimed jobs every 60s (no zombies)
const JOB_CLAIM_TTL = { ping: 30000, inference: 600000, transcribe: 900000, generate: 1200000, default: 600000 };
setInterval(() => {
  const cutoff = Date.now() - 600000; // conservative: 10 min default
  const stale = stmts.getClaimedStale.all(cutoff);
  for (const job of stale) {
    const ttl = JOB_CLAIM_TTL[job.type] || JOB_CLAIM_TTL.default;
    if (Date.now() - job.claimedAt > ttl) {
      console.log(`◉ Reaper: job ${job.jobId} (${job.type}) timed out after ${Math.round((Date.now() - job.claimedAt)/1000)}s`);
      stmts.failJob.run(JSON.stringify({ error: `Reaped: no completion after ${Math.round(ttl/1000)}s` }), job.jobId);
      try {
        reputation.recordEvent({
          nodeId: job.claimedBy,
          type: 'job_timeout',
          jobId: job.jobId,
          jobType: job.type,
          details: { claimedAt: job.claimedAt, ttl }
        });
      } catch (e) {}
    }
  }
}, 60000);

// Expire old agreements every hour
setInterval(() => {
  try {
    const expired = agreements.expireAgreements();
    if (expired > 0) console.log(`  📋 Expired ${expired} agreements`);
  } catch (e) {}
}, 3600000);

// Cleanup expired uploads every hour
setInterval(async () => {
  try {
    const deleted = await storage.cleanupExpired();
    if (deleted > 0) console.log(`  🧹 Cleaned up ${deleted} expired uploads`);
  } catch(e) {}
}, 3600000);

server.listen(PORT, '0.0.0.0', () => {
  const nodeCount = stmts.getAllNodes.all().length;
  const jobCount = db.prepare('SELECT COUNT(*) as c FROM jobs').get().c;
  console.log(`◉ IC Mesh server v0.3.0 live on port ${PORT}`);
  console.log(`  Storage: SQLite (${DB_PATH})`);
  console.log(`  Transport: HTTP + WebSocket`);
  console.log(`  Nodes: ${nodeCount} registered`);
  console.log(`  Jobs: ${jobCount} total`);
  console.log(`  Dashboard: http://localhost:${PORT}`);
});
