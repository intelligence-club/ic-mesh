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
const connect = require('./lib/stripe-connect');
const RateLimiter = require('./lib/rate-limit');

const rateLimiter = new RateLimiter();

// ===== ERROR HANDLING UTILITIES =====
function logError(context, error, details = {}) {
  console.error(`[ERROR] ${context}:`, {
    message: error.message,
    stack: error.stack?.split('\n').slice(0, 3).join('\n'),
    ...details
  });
}

function safeJsonParse(str, defaultValue = {}, context = 'unknown') {
  try {
    return JSON.parse(str || '{}');
  } catch (e) {
    logError(`JSON parse in ${context}`, e, { input: str?.substring(0, 100) });
    return defaultValue;
  }
}

const PORT = process.env.PORT || 8333;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_PATH = process.env.DATABASE_PATH || path.join(DATA_DIR, 'mesh.db');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ===== DATABASE =====
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

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
    computeMinutes REAL DEFAULT 0
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
    creditAmount REAL DEFAULT 0,
    refunded INTEGER DEFAULT 0,
    ints_cost INTEGER DEFAULT 0,
    error_message TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
  CREATE INDEX IF NOT EXISTS idx_jobs_claimedBy ON jobs(claimedBy);

  CREATE TABLE IF NOT EXISTS ledger (
    nodeId TEXT PRIMARY KEY,
    earned REAL DEFAULT 0,
    spent REAL DEFAULT 0,
    jobs INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS payouts (
    nodeId TEXT PRIMARY KEY,
    earned_ints INTEGER DEFAULT 0,
    cashed_out_ints INTEGER DEFAULT 0,
    jobs_paid INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS cashouts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nodeId TEXT NOT NULL,
    amount_ints INTEGER NOT NULL,
    amount_usd REAL NOT NULL,
    payout_email TEXT,
    payout_method TEXT DEFAULT 'pending',
    status TEXT DEFAULT 'pending',
    created TEXT DEFAULT (datetime('now')),
    processed TEXT
  );

  CREATE TABLE IF NOT EXISTS tickets (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    api_key TEXT,
    category TEXT,
    priority TEXT DEFAULT 'normal',
    subject TEXT,
    body TEXT,
    job_id TEXT,
    status TEXT DEFAULT 'open',
    auto_resolved INTEGER DEFAULT 0,
    resolution TEXT,
    actions_taken TEXT,
    created TEXT DEFAULT (datetime('now')),
    updated TEXT DEFAULT (datetime('now')),
    resolved_at TEXT,
    escalated_to TEXT
  );

  CREATE TABLE IF NOT EXISTS ticket_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id TEXT NOT NULL,
    sender TEXT,
    body TEXT,
    created TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS user_credits (
    email TEXT PRIMARY KEY,
    balance_ints INTEGER DEFAULT 0,
    last_updated TEXT DEFAULT (datetime('now'))
  );
`);

// ===== PREPARED STATEMENTS =====
const stmts = {
  upsertNode: db.prepare(`
    INSERT INTO nodes (nodeId, name, ip, capabilities, models, cpuCores, ramMB, ramFreeMB, cpuIdle, gpuVRAM, diskFreeGB, owner, region, lastSeen, registeredAt)
    VALUES (@nodeId, @name, @ip, @capabilities, @models, @cpuCores, @ramMB, @ramFreeMB, @cpuIdle, @gpuVRAM, @diskFreeGB, @owner, @region, @lastSeen, @registeredAt)
    ON CONFLICT(nodeId) DO UPDATE SET
      name=@name, ip=@ip, capabilities=@capabilities, models=@models,
      cpuCores=@cpuCores, ramMB=@ramMB, ramFreeMB=@ramFreeMB, cpuIdle=@cpuIdle,
      gpuVRAM=@gpuVRAM, diskFreeGB=@diskFreeGB, owner=@owner, region=@region, lastSeen=@lastSeen
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
  
  upsertLedger: db.prepare(`
    INSERT INTO ledger (nodeId, earned, spent, jobs) VALUES (?, ?, ?, ?)
    ON CONFLICT(nodeId) DO UPDATE SET earned = earned + ?, spent = spent + ?, jobs = jobs + ?
  `),
  getLedger: db.prepare('SELECT * FROM ledger WHERE nodeId = ?'),
  
  // Integer-based payouts (ints)
  upsertPayout: db.prepare(`
    INSERT INTO payouts (nodeId, earned_ints, jobs_paid) VALUES (?, ?, ?)
    ON CONFLICT(nodeId) DO UPDATE SET earned_ints = earned_ints + excluded.earned_ints, jobs_paid = jobs_paid + excluded.jobs_paid
  `),
  getPayout: db.prepare('SELECT * FROM payouts WHERE nodeId = ?'),
  getAllPayouts: db.prepare('SELECT * FROM payouts ORDER BY earned_ints DESC'),
  
  updateNodeStats: db.prepare('UPDATE nodes SET jobsCompleted = jobsCompleted + 1, computeMinutes = computeMinutes + ? WHERE nodeId = ?'),
  findNodeByNameOwner: db.prepare('SELECT nodeId FROM nodes WHERE name = ? AND owner = ?'),
  getClaimedStale: db.prepare("SELECT * FROM jobs WHERE status = 'claimed' AND claimedAt < ?"),
  
  // Ticket system
  getTicket: db.prepare('SELECT * FROM tickets WHERE id = ?'),
  insertTicket: db.prepare(`
    INSERT INTO tickets (id, email, api_key, category, priority, subject, body, job_id, status, created)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', datetime('now'))
  `),
  markJobRefunded: db.prepare("UPDATE jobs SET refunded = 1 WHERE jobId = ?"),
  
  // User credits/balance system (for refunds)
  addInts: db.prepare(`
    INSERT INTO user_credits (email, balance_ints, last_updated) 
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(email) DO UPDATE SET 
      balance_ints = balance_ints + excluded.balance_ints,
      last_updated = datetime('now')
  `),
  getUserBalance: db.prepare('SELECT * FROM user_credits WHERE email = ?')
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
        } catch(e) {
          // Skip duplicates during migration, but log other errors
          if (!e.message.includes('UNIQUE constraint failed')) {
            logError('Job migration', e, { jobId: j.jobId });
          }
        }
      }
      console.log(`  Migrated ${Object.keys(jobs).length} jobs from JSON`);
    }
    
    if (fs.existsSync(ledgerFile)) {
      const ledger = JSON.parse(fs.readFileSync(ledgerFile, 'utf8'));
      for (const [id, l] of Object.entries(ledger)) {
        stmts.upsertLedger.run(id, l.earned || 0, l.spent || 0, l.jobs || 0, 0, 0, 0);
      }
      console.log(`  Migrated ${Object.keys(ledger).length} ledger entries from JSON`);
    }
  } catch(e) {
    console.log('  JSON migration skipped:', e.message);
  }
}

// Migrate existing JSON data if DB is fresh
migrateFromJSON();

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
    lastSeen: now, registeredAt: now
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
  // Verify node has required capabilities before allowing claim
  const job = stmts.getJob.get(jobId);
  if (!job || job.status !== 'pending') return null;
  const req = JSON.parse(job.requirements || '{}');
  if (req.capability) {
    const node = stmts.getNode.get(nodeId);
    const caps = node ? JSON.parse(node.capabilities || '[]') : [];
    if (!caps.includes(req.capability)) {
      console.log(`  ⚠ Node ${nodeId.slice(0,8)} rejected claim on ${jobId.slice(0,8)}: missing capability '${req.capability}'`);
      return null;
    }
  }
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
  
  // Parse job payload to get price_ints if set by the payment system
  let priceInts = 0;
  const payload = safeJsonParse(job.payload, {}, 'job completion payload');
  priceInts = parseInt(payload.price_ints) || 0;
  
  // Revenue split: 80% node, 15% treasury, 5% infra (all integer ints)
  const nodeCut = Math.floor(priceInts * 80 / 100);
  const treasuryCut = Math.floor(priceInts * 15 / 100);
  const infraCut = priceInts - nodeCut - treasuryCut; // remainder to infra (avoids rounding loss)
  
  stmts.completeJob.run(now, JSON.stringify(result.data || null), computeMs, priceInts, jobId, nodeId);
  stmts.updateNodeStats.run(computeMinutes, nodeId);
  
  // Legacy ledger (compute minutes)
  const networkCut = computeMinutes * 0.20;
  const workerPay = computeMinutes - networkCut;
  stmts.upsertLedger.run(nodeId, 0, 0, 0, workerPay, 0, 1);
  if (job.requester) stmts.upsertLedger.run(job.requester, 0, 0, 0, 0, computeMinutes, 0);
  stmts.upsertLedger.run('ic-treasury', 0, 0, 0, networkCut, 0, 0);
  
  // Integer payouts (ints) — the real money tracking
  if (priceInts > 0) {
    stmts.upsertPayout.run(nodeId, nodeCut, 1);
    stmts.upsertPayout.run('ic-treasury', treasuryCut, 0);
    stmts.upsertPayout.run('ic-infra', infraCut, 0);
    console.log(`  💰 SPLIT: ${priceInts} ints → node ${nodeCut} / treasury ${treasuryCut} / infra ${infraCut}`);
  }
  
  const completed = jobToJSON(stmts.getJob.get(jobId));
  
  // Notify via WebSocket
  broadcastEvent('job.completed', { jobId, type: completed.type, computeMs, nodeId, payout: { node: nodeCut, treasury: treasuryCut, infra: infraCut } });
  
  return completed;
}

// ===== WEBSOCKET =====
const wsClients = new Map(); // nodeId -> WebSocket

function setupWebSocket(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });
  
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const nodeId = url.searchParams.get('nodeId') || 'unknown';
    
    wsClients.set(nodeId, ws);
    console.log(`  ⚡ WS connected: ${nodeId} (${wsClients.size} total)`);
    
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        handleWsMessage(nodeId, msg, ws);
      } catch(e) {
        logError('WebSocket message parsing', e, { nodeId, data: data.toString().substring(0, 100) });
      }
    });
    
    ws.on('close', () => {
      wsClients.delete(nodeId);
      console.log(`  ⚡ WS disconnected: ${nodeId} (${wsClients.size} total)`);
    });
    
    ws.on('error', (error) => {
      logError('WebSocket connection', error, { nodeId });
      wsClients.delete(nodeId);
    });
    
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
  for (const [nodeId, ws] of wsClients) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    const node = stmts.getNode.get(nodeId);
    if (!node) continue;
    const caps = JSON.parse(node.capabilities || '[]');
    if (req.capability && !caps.includes(req.capability)) continue;
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Node-Id, X-Node-Secret');
  if (method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  // Rate limiting
  const clientIp = req.socket.remoteAddress || 'unknown';
  const rlGroup = method === 'POST' && pathname === '/upload' ? 'upload'
    : method === 'POST' && pathname === '/jobs' ? 'jobs-post'
    : method === 'POST' && pathname === '/nodes/register' ? 'nodes-register'
    : 'default';
  const rl = rateLimiter.check(clientIp, rlGroup);
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retryAfter));
    return json(res, { error: 'Rate limit exceeded', retry_after: rl.retryAfter }, 429);
  }
  
  try {
    // ---- Presigned Upload URL (client → Spaces direct) ----
    if (method === 'POST' && pathname === '/upload/presign') {
      const data = await parseBody(req);
      const { filename, content_type } = data;
      if (!filename) return json(res, { error: 'filename required' }, 400);
      
      const id = crypto.randomBytes(8).toString('hex');
      const ext = path.extname(filename) || '.bin';
      const key = `uploads/${id}${ext}`;
      const ct = content_type || 'application/octet-stream';
      
      const storage = require('./lib/storage');
      storage.initSpaces();
      const uploadUrl = await storage.getPresignedUploadUrl(key, ct);
      const downloadUrl = await storage.getPresignedUrl(key);
      
      if (!uploadUrl) {
        return json(res, { error: 'Spaces not configured, use POST /upload instead' }, 503);
      }
      
      return json(res, {
        upload_url: uploadUrl,
        download_url: downloadUrl,
        key,
        method: 'PUT',
        content_type: ct,
        expires_in: 3600,
        instructions: 'PUT your file to upload_url with Content-Type header. Use download_url or key in job payloads.'
      });
    }

    // ---- File Upload ----
    if (method === 'POST' && pathname === '/upload') {
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
          logError('File upload processing', e, { 
            contentType: req.headers['content-type'], 
            size: Buffer.concat(chunks).length 
          });
          json(res, { error: e.message }, 500);
        }
      });
      return;
    }

    // ---- Stripe Connect onboarding return redirect ----
    if (method === 'GET' && pathname === '/onboard') {
      const u = new URL(req.url, 'https://moilol.com');
      const nodeId = u.searchParams.get('nodeId') || '';
      const complete = u.searchParams.get('complete');
      const refresh = u.searchParams.get('refresh');
      // Redirect to the main site's onboard page with params
      const target = complete 
        ? `https://moilol.com/onboard.html?nodeId=${encodeURIComponent(nodeId)}&complete=true`
        : `https://moilol.com/onboard.html?nodeId=${encodeURIComponent(nodeId)}&refresh=true`;
      res.writeHead(302, { Location: target });
      return res.end();
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
      const data = await parseBody(req);
      data.ip = req.socket.remoteAddress;
      const node = registerNode(data);
      return json(res, { ok: true, node });
    }
    
    if (method === 'GET' && pathname === '/nodes') {
      const active = getActiveNodes();
      return json(res, { nodes: active, total: Object.keys(active).length });
    }
    
    // ---- Job Queue ----
    if (method === 'POST' && pathname === '/jobs') {
      const data = await parseBody(req);
      // Validate job type
      const VALID_JOB_TYPES = ['transcribe', 'generate-image', 'ffmpeg', 'inference', 'ocr', 'pdf-extract'];
      if (!data.type || !VALID_JOB_TYPES.includes(data.type)) {
        return json(res, { error: `Invalid job type. Must be one of: ${VALID_JOB_TYPES.join(', ')}`, valid_types: VALID_JOB_TYPES }, 400);
      }
      if (!data.payload || typeof data.payload !== 'object') {
        return json(res, { error: 'payload object required' }, 400);
      }
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
      const nodeId = url.searchParams.get('nodeId') || req.headers['x-node-id'];
      return json(res, { jobs: getAvailableJobs(nodeId), count: 0 });
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
    
    // ---- Job Failure ----
    if (method === 'POST' && pathname.match(/^\/jobs\/[a-f0-9]+\/fail$/)) {
      const jobId = pathname.split('/')[2];
      const data = await parseBody(req);
      const job = stmts.getJob.get(jobId);
      if (!job) return json(res, { error: 'Job not found' }, 404);
      if (data.nodeId && job.claimedBy !== data.nodeId) return json(res, { error: 'Not your job' }, 403);
      stmts.failJob.run(JSON.stringify({ error: data.error || 'Client reported failure' }), jobId);
      return json(res, { ok: true, job: jobToJSON(stmts.getJob.get(jobId)) });
    }

    // ---- Ledger ----
    if (method === 'GET' && pathname.match(/^\/ledger\/.+$/)) {
      const nodeId = pathname.split('/')[2];
      const entry = stmts.getLedger.get(nodeId) || { earned: 0, spent: 0, jobs: 0 };
      return json(res, { nodeId, ...entry, balance: entry.earned - entry.spent });
    }

    // ---- Payouts (ints) ----
    if (method === 'GET' && pathname === '/payouts') {
      const all = stmts.getAllPayouts.all();
      const total = all.reduce((sum, p) => sum + p.earned_ints, 0);
      return json(res, { payouts: all, total_ints: total, total_usd: (total * 0.001).toFixed(2) });
    }
    if (method === 'GET' && pathname.match(/^\/payouts\/.+$/)) {
      const nodeId = pathname.split('/')[2];
      const entry = stmts.getPayout.get(nodeId) || { earned_ints: 0, cashed_out_ints: 0, jobs_paid: 0 };
      const available = entry.earned_ints - (entry.cashed_out_ints || 0);
      return json(res, {
        nodeId,
        earned_ints: entry.earned_ints,
        cashed_out_ints: entry.cashed_out_ints || 0,
        available_ints: available,
        available_usd: (available * 0.0008).toFixed(2),
        earned_usd: (entry.earned_ints * 0.0008).toFixed(2),
        jobs_paid: entry.jobs_paid
      });
    }

    // ---- Node onboarding (Stripe Connect) ----
    if (method === 'POST' && pathname === '/nodes/onboard') {
      const data = await parseBody(req);
      const { nodeId, email, country } = data;
      if (!nodeId || !email) return json(res, { error: 'nodeId and email required' }, 400);
      
      const node = stmts.getNode.get(nodeId);
      if (!node) return json(res, { error: 'Node not found. Register first.' }, 404);
      
      // If already has Stripe account, return new onboarding link
      if (node.stripe_account_id) {
        try {
          const status = await connect.checkAccountStatus(node.stripe_account_id);
          if (status.payouts_enabled) {
            return json(res, { ok: true, status: 'already_onboarded', payouts_enabled: true, email: status.email });
          }
          // Need to complete onboarding
          const url = await connect.createOnboardingLink(node.stripe_account_id, nodeId);
          return json(res, { ok: true, status: 'incomplete', onboarding_url: url });
        } catch (e) {
          return json(res, { error: 'Stripe error: ' + e.message }, 500);
        }
      }
      
      // Create new Stripe Connect account
      try {
        const result = await connect.createConnectedAccount(nodeId, email, country || 'US');
        db.prepare('UPDATE nodes SET stripe_account_id = ?, payout_email = ? WHERE nodeId = ?').run(result.stripe_account_id, email, nodeId);
        console.log(`◉ STRIPE CONNECT: ${node.name} (${nodeId.slice(0,8)}) → ${result.stripe_account_id}`);
        return json(res, { ok: true, ...result });
      } catch (e) {
        console.log(`⚠ Stripe Connect error: ${e.message}`);
        return json(res, { error: 'Stripe onboarding failed: ' + e.message }, 500);
      }
    }

    // ---- Node onboarding status ----
    if (method === 'GET' && pathname.match(/^\/nodes\/[^/]+\/stripe$/)) {
      const nodeId = pathname.split('/')[2];
      const node = stmts.getNode.get(nodeId);
      if (!node) return json(res, { error: 'Node not found' }, 404);
      if (!node.stripe_account_id) return json(res, { status: 'not_onboarded', message: 'POST /nodes/onboard to set up payouts' });
      try {
        const status = await connect.checkAccountStatus(node.stripe_account_id);
        return json(res, { nodeId, stripe_account_id: node.stripe_account_id, ...status });
      } catch (e) {
        return json(res, { error: e.message }, 500);
      }
    }

    // ---- Cashout request (with Stripe Connect auto-transfer) ----
    if (method === 'POST' && pathname === '/cashout') {
      const data = await parseBody(req);
      const { nodeId, amount_ints, payout_email } = data;

      if (!nodeId) return json(res, { error: 'nodeId required' }, 400);

      const entry = stmts.getPayout.get(nodeId);
      if (!entry) return json(res, { error: 'No earnings found for this node' }, 404);

      const available = entry.earned_ints - (entry.cashed_out_ints || 0);
      const requestedInts = amount_ints ? Math.min(parseInt(amount_ints), available) : available;

      if (requestedInts < connect.MIN_CASHOUT_INTS) {
        return json(res, {
          error: `Minimum cashout is ${connect.MIN_CASHOUT_INTS} ints ($${(connect.MIN_CASHOUT_INTS * connect.SELL_RATE).toFixed(2)})`,
          available_ints: available,
          minimum_ints: connect.MIN_CASHOUT_INTS
        }, 400);
      }

      const amountUsd = +(requestedInts * connect.SELL_RATE).toFixed(2);
      const node = stmts.getNode.get(nodeId);

      // Try Stripe Connect transfer if onboarded
      let transferResult = null;
      if (node?.stripe_account_id) {
        try {
          const status = await connect.checkAccountStatus(node.stripe_account_id);
          if (status.payouts_enabled) {
            transferResult = await connect.transferToNode(node.stripe_account_id, requestedInts, nodeId);
            console.log(`◉ STRIPE TRANSFER: ${nodeId.slice(0,8)} → ${requestedInts} ints ($${amountUsd}) → ${transferResult.transfer_id}`);
          }
        } catch (e) {
          console.log(`⚠ Stripe transfer failed: ${e.message}`);
          // Fall through to manual cashout
        }
      }

      // Record the cashout
      const payoutMethod = transferResult ? 'stripe_connect' : 'pending';
      const cashoutStatus = transferResult ? 'completed' : 'pending';
      db.prepare(`INSERT INTO cashouts (nodeId, amount_ints, amount_usd, payout_email, payout_method, status) VALUES (?, ?, ?, ?, ?, ?)`).run(
        nodeId, requestedInts, amountUsd, payout_email || node?.payout_email || '', payoutMethod, cashoutStatus
      );
      db.prepare(`UPDATE payouts SET cashed_out_ints = COALESCE(cashed_out_ints, 0) + ? WHERE nodeId = ?`).run(requestedInts, nodeId);

      console.log(`◉ CASHOUT: ${nodeId.slice(0,8)} → ${requestedInts} ints ($${amountUsd}) [${payoutMethod}]`);

      return json(res, {
        ok: true,
        cashout: {
          amount_ints: requestedInts,
          amount_usd: amountUsd.toFixed(2),
          payout_method: payoutMethod,
          transfer_id: transferResult?.transfer_id || null,
          status: cashoutStatus,
          message: transferResult 
            ? 'Payment transferred via Stripe. Funds will arrive in your bank within 2 business days.'
            : 'Cashout request submitted. Complete Stripe onboarding for instant payouts, or payment will be processed manually within 48 hours.'
        },
        remaining_ints: available - requestedInts
      });
    }

    // ---- Cashout history ----
    if (method === 'GET' && pathname.match(/^\/cashouts\/.+$/)) {
      const nodeId = pathname.split('/')[2];
      const cashouts = db.prepare('SELECT * FROM cashouts WHERE nodeId = ? ORDER BY created DESC LIMIT 50').all(nodeId);
      // Enrich with Stripe transfer history if onboarded
      let stripeTransfers = [];
      const node = stmts.getNode.get(nodeId);
      if (node?.stripe_account_id) {
        try {
          stripeTransfers = await connect.getTransferHistory(node.stripe_account_id, 20);
        } catch {}
      }
      return json(res, { nodeId, cashouts, stripe_transfers: stripeTransfers });
    }

    // ---- Admin: process cashout ----
    if (method === 'POST' && pathname.match(/^\/cashouts\/\d+\/process$/)) {
      const cashoutId = pathname.split('/')[2];
      const data = await parseBody(req);
      if (req.headers['x-admin-key'] !== (process.env.ADMIN_KEY || 'ic-admin-2026')) {
        return json(res, { error: 'Unauthorized' }, 401);
      }
      db.prepare(`UPDATE cashouts SET status = ?, processed = datetime('now'), payout_method = ? WHERE id = ?`).run(
        data.status || 'completed', data.method || 'manual', cashoutId
      );
      console.log(`◉ CASHOUT PROCESSED: #${cashoutId} → ${data.status || 'completed'}`);
      return json(res, { ok: true, cashout_id: cashoutId, status: data.status || 'completed' });
    }
    
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
      
      const treasury = stmts.getLedger.get('ic-treasury') || { earned: 0 };
      
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
        economics: {
          totalComputeMinutes: Math.round((treasury.earned / 0.20) * 100) / 100,
          treasuryMinutes: Math.round(treasury.earned * 100) / 100
        },
        websocket: { connected: wsClients.size },
        uptime: process.uptime()
      });
    }
    
    // ---- Support Ticket System ----
    if (method === 'POST' && pathname === '/support') {
      const data = await parseBody(req);
      const { email, subject, body, category, priority, api_key, job_id } = data;
      
      // Validate required fields
      if (!email || !subject || !body) {
        return json(res, { error: 'Missing required fields: email, subject, body' }, 400);
      }
      
      // Generate ticket ID
      const ticketId = 'TK-' + crypto.randomBytes(6).toString('hex').toUpperCase();
      
      try {
        // Insert ticket into database
        stmts.insertTicket.run(
          ticketId,
          email,
          api_key || null,
          category || 'general',
          priority || 'normal',
          subject,
          body,
          job_id || null
        );
        
        console.log(`🎫 Support ticket created: ${ticketId} from ${email}`);
        
        return json(res, {
          success: true,
          ticket_id: ticketId,
          message: 'Support ticket created successfully. We will respond within 24 hours.',
          status: 'open'
        });
      } catch (error) {
        console.error('Failed to create support ticket:', error);
        return json(res, { error: 'Failed to create support ticket' }, 500);
      }
    }
    if (method === 'POST' && pathname === '/api/support') {
      const data = await parseBody(req);
      const { email, api_key, category, subject, body, job_id, priority } = data;
      
      if (!email || !subject || !body) {
        return json(res, { error: 'email, subject, and body required' }, 400);
      }
      
      // Generate ticket ID
      const ticketNum = db.prepare('SELECT COUNT(*) as count FROM tickets').get().count + 1;
      const ticket_id = `IC-${ticketNum.toString().padStart(5, '0')}`;
      
      // Auto-resolve logic
      let auto_resolved = false;
      let resolution = null;
      let actions_taken = [];
      let refund_ints = 0;
      
      // Check for job-related issues
      if (job_id) {
        const job = stmts.getJob.get(job_id);
        if (job && job.status === 'failed' && !job.refunded) {
          // Auto-refund failed jobs
          const ints = parseInt(job.ints_cost || 0);
          if (ints > 0) {
            stmts.addInts.run(email, ints);
            stmts.markJobRefunded.run(job_id);
            actions_taken.push({ action: 'refund', amount_ints: ints, job_id: job_id });
            refund_ints = ints;
            auto_resolved = true;
            resolution = `Auto-refunded ${ints} ints for failed job ${job_id}. The job failed due to: ${job.error_message || 'timeout'}. You can retry the job or contact support if this keeps happening.`;
          }
        }
      }
      
      // Store ticket
      const now = new Date().toISOString();
      db.prepare(`
        INSERT OR REPLACE INTO tickets 
        (id, email, api_key, category, priority, subject, body, job_id, status, auto_resolved, resolution, actions_taken, created, updated)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        ticket_id, email, api_key, category || 'other', priority || 'normal', 
        subject, body, job_id, auto_resolved ? 'auto_resolved' : 'open',
        auto_resolved ? 1 : 0, resolution, JSON.stringify(actions_taken), now, now
      );
      
      // Add initial message
      db.prepare(`
        INSERT INTO ticket_messages (ticket_id, sender, body, created)
        VALUES (?, ?, ?, ?)
      `).run(ticket_id, 'customer', body, now);
      
      if (auto_resolved && resolution) {
        db.prepare(`
          INSERT INTO ticket_messages (ticket_id, sender, body, created)
          VALUES (?, ?, ?, ?)
        `).run(ticket_id, 'agent', resolution, now);
      }
      
      console.log(`Support ticket ${ticket_id} created for ${email} - ${auto_resolved ? 'auto-resolved' : 'needs review'}`);
      
      return json(res, {
        ticket_id,
        status: auto_resolved ? 'auto_resolved' : 'open',
        message: resolution || 'Thank you for contacting support. We\'ve received your ticket and will respond within 24 hours.',
        auto_resolved,
        refund_ints
      });
    }

    // ---- Get ticket details ----
    if (method === 'GET' && pathname.match(/^\/api\/tickets\/[^/]+$/)) {
      const ticketId = pathname.split('/')[3];
      const ticket = stmts.getTicket.get(ticketId);
      if (!ticket) return json(res, { error: 'Ticket not found' }, 404);
      
      const messages = db.prepare('SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY created ASC').all(ticketId);
      
      return json(res, {
        ticket: {
          id: ticket.id,
          email: ticket.email,
          category: ticket.category,
          priority: ticket.priority,
          subject: ticket.subject,
          job_id: ticket.job_id,
          status: ticket.status,
          auto_resolved: ticket.auto_resolved,
          resolution: ticket.resolution,
          actions_taken: ticket.actions_taken ? JSON.parse(ticket.actions_taken) : [],
          created: ticket.created,
          updated: ticket.updated,
          resolved_at: ticket.resolved_at
        },
        messages: messages.map(m => ({
          id: m.id,
          sender: m.sender,
          body: m.body,
          created: m.created
        }))
      });
    }

    // ---- List tickets (admin only) ----
    if (method === 'GET' && pathname === '/api/tickets') {
      const adminKey = req.headers['x-admin-key'] || req.headers['authorization']?.replace('Bearer ', '');
      if (adminKey !== (process.env.ADMIN_KEY || 'ic-admin-2026')) {
        return json(res, { error: 'Unauthorized' }, 401);
      }
      
      const status = url.searchParams.get('status') || null;
      const limit = parseInt(url.searchParams.get('limit')) || 50;
      const offset = parseInt(url.searchParams.get('offset')) || 0;
      
      let query = 'SELECT * FROM tickets';
      let params = [];
      if (status) {
        query += ' WHERE status = ?';
        params.push(status);
      }
      query += ' ORDER BY created DESC LIMIT ? OFFSET ?';
      params.push(limit, offset);
      
      const tickets = db.prepare(query).all(...params);
      const total = db.prepare('SELECT COUNT(*) as count FROM tickets' + (status ? ' WHERE status = ?' : '')).get(...(status ? [status] : [])).count;
      
      return json(res, {
        tickets: tickets.map(t => ({
          id: t.id,
          email: t.email,
          category: t.category,
          priority: t.priority,
          subject: t.subject,
          job_id: t.job_id,
          status: t.status,
          auto_resolved: t.auto_resolved,
          created: t.created,
          updated: t.updated
        })),
        total,
        limit,
        offset
      });
    }

    // ---- Add message to ticket ----
    if (method === 'POST' && pathname.match(/^\/api\/tickets\/[^/]+\/messages$/)) {
      const ticketId = pathname.split('/')[3];
      const data = await parseBody(req);
      const { sender, body } = data;
      
      if (!sender || !body) {
        return json(res, { error: 'sender and body required' }, 400);
      }
      
      const ticket = stmts.getTicket.get(ticketId);
      if (!ticket) return json(res, { error: 'Ticket not found' }, 404);
      
      const now = new Date().toISOString();
      const messageId = db.prepare(`
        INSERT INTO ticket_messages (ticket_id, sender, body, created)
        VALUES (?, ?, ?, ?)
      `).run(ticketId, sender, body, now).lastInsertRowid;
      
      // Update ticket timestamp
      db.prepare('UPDATE tickets SET updated = ? WHERE id = ?').run(now, ticketId);
      
      console.log(`📨 Message added to ticket ${ticketId} by ${sender}`);
      
      return json(res, {
        message_id: messageId,
        ticket_id: ticketId,
        sender,
        body,
        created: now
      });
    }

    // ---- Update ticket status ----
    if (method === 'PATCH' && pathname.match(/^\/api\/tickets\/[^/]+$/)) {
      const ticketId = pathname.split('/')[3];
      const data = await parseBody(req);
      const { status, resolution, escalated_to } = data;
      
      const ticket = stmts.getTicket.get(ticketId);
      if (!ticket) return json(res, { error: 'Ticket not found' }, 404);
      
      const now = new Date().toISOString();
      const updates = { updated: now };
      
      if (status) updates.status = status;
      if (resolution) updates.resolution = resolution;
      if (escalated_to) updates.escalated_to = escalated_to;
      if (status === 'resolved' || status === 'closed') updates.resolved_at = now;
      
      const setClause = Object.keys(updates).map(k => `${k} = ?`).join(', ');
      const values = [...Object.values(updates), ticketId];
      
      db.prepare(`UPDATE tickets SET ${setClause} WHERE id = ?`).run(...values);
      
      console.log(`🎫 Ticket ${ticketId} updated: ${Object.keys(updates).join(', ')}`);
      
      return json(res, {
        ticket_id: ticketId,
        updates,
        message: `Ticket ${ticketId} updated successfully`
      });
    }

    // ---- Get ticket messages ----
    if (method === 'GET' && pathname.match(/^\/api\/tickets\/[^/]+\/messages$/)) {
      const ticketId = pathname.split('/')[3];
      const ticket = stmts.getTicket.get(ticketId);
      if (!ticket) return json(res, { error: 'Ticket not found' }, 404);
      
      const messages = db.prepare('SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY created ASC').all(ticketId);
      
      return json(res, {
        ticket_id: ticketId,
        messages: messages.map(m => ({
          id: m.id,
          sender: m.sender,
          body: m.body,
          created: m.created
        }))
      });
    }
    
    // ---- Operator Dashboard ----
    if (method === 'GET' && pathname.startsWith('/operator/')) {
      const nodeId = pathname.split('/')[2];
      if (!nodeId) {
        return json(res, { error: 'Node ID required' }, 400);
      }
      
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(getOperatorDashboardHTML(nodeId));
    }
    
    // ---- Main Dashboard ----
    if (method === 'GET' && pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(getDashboardHTML());
    }
    
    json(res, { error: 'Route not found', code: 'ROUTE_NOT_FOUND', path: pathname, method, hint: 'See https://github.com/intelligence-club/ic-mesh#payments--operator-payouts for available endpoints' }, 404);
    
  } catch (e) {
    logError('HTTP request handler', e, { 
      method, 
      pathname, 
      userAgent: req.headers['user-agent']?.substring(0, 50)
    });
    // Don't leak internal errors to clients
    const safeMsg = e.message?.includes('constraint') || e.message?.includes('SQLITE') || e.message?.includes('database')
      ? 'Internal server error'
      : e.message || 'Internal server error';
    json(res, { error: safeMsg }, 500);
  }
});

// ===== DASHBOARD =====
function getDashboardHTML() {
  const active = getActiveNodes();
  const activeCount = Object.keys(active).length;
  const allNodes = stmts.getAllNodes.all();
  const jobCounts = {};
  for (const row of stmts.countJobs.all()) jobCounts[row.status] = row.count;
  const treasury = stmts.getLedger.get('ic-treasury') || { earned: 0 };

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
  <div class="stat"><span class="num">${Math.round((treasury.earned || 0) * 100) / 100}</span><span class="label">Treasury (min)</span></div>
</div>
<h2>NODES</h2>
${allNodes.map(r => {
  const n = nodeToJSON(r);
  const isOnline = n.status === 'online';
  const hasWs = wsClients.has(n.nodeId);
  return `<div class="node">
  <span class="name">${n.name}</span>
  <span class="${isOnline ? 'online' : 'offline'}"> ◉ ${isOnline ? 'ONLINE' : 'OFFLINE'}</span>
  ${hasWs ? '<span class="ws"> ⚡ WS</span>' : ''}
  <div class="info">
    ${n.capabilities.join(', ')} | ${n.resources.cpuCores} cores | ${Math.round(n.resources.ramMB/1024)}GB RAM | 
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

function getOperatorDashboardHTML(nodeId) {
  // Get node data
  const node = stmts.getNodeById.get(nodeId);
  if (!node) {
    return `<!DOCTYPE html><html><head><title>Node Not Found</title></head>
    <body style="font-family: monospace; padding: 2rem; background: #0a0e17; color: #c8d6e5;">
    <h1 style="color: #ef4444;">Node Not Found</h1>
    <p>Node ID "${nodeId}" does not exist or has not registered with this mesh.</p>
    <a href="/" style="color: #2d86ff;">← Back to Network Dashboard</a>
    </body></html>`;
  }
  
  const n = nodeToJSON(node);
  const isOnline = n.status === 'online';
  const hasWs = wsClients.has(n.nodeId);
  
  // Get recent jobs for this node
  const recentJobs = stmts.getJobsByNode ? stmts.getJobsByNode.all(nodeId, 50) : 
    db.prepare('SELECT * FROM jobs WHERE completedBy = ? ORDER BY created DESC LIMIT 50').all(nodeId);
  
  // Calculate earnings
  const earnings = stmts.getLedger.get(nodeId) || { earned: 0, withdrawn: 0 };
  const pendingBalance = Math.round((earnings.earned - (earnings.withdrawn || 0)) * 100) / 100;
  
  // Job stats for this node
  const jobStats = {
    total: recentJobs.length,
    completed: recentJobs.filter(j => j.status === 'completed').length,
    failed: recentJobs.filter(j => j.status === 'failed').length,
    pending: recentJobs.filter(j => j.status === 'pending' || j.status === 'claimed').length
  };
  
  return `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<title>Node ${n.name} — IC Mesh Operator Dashboard</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #0a0e17; color: #c8d6e5; font-family: 'Courier New', monospace; padding: 2rem; }
  h1 { color: #2d86ff; font-size: 1.4rem; letter-spacing: 0.1em; margin-bottom: 0.5rem; font-weight: 400; }
  .subtitle { color: #6b7c93; font-size: 0.9rem; margin-bottom: 2rem; }
  .nav { margin-bottom: 2rem; }
  .nav a { color: #2d86ff; text-decoration: none; font-size: 0.8rem; }
  .nav a:hover { text-decoration: underline; }
  .status { margin-bottom: 2rem; padding: 1.5rem; border: 1px solid ${isOnline ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}; }
  .status h2 { color: ${isOnline ? '#22c55e' : '#ef4444'}; font-size: 1rem; margin-bottom: 1rem; }
  .status-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; }
  .status-item { }
  .status-item .label { color: #6b7c93; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.1em; }
  .status-item .value { color: #e0e8f0; font-size: 1.1rem; margin-top: 0.25rem; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
  .stat { border: 1px solid rgba(45,134,255,0.2); padding: 1.5rem; text-align: center; }
  .stat .num { font-size: 2rem; color: #22c55e; display: block; }
  .stat .label { font-size: 0.7rem; color: #6b7c93; letter-spacing: 0.1em; text-transform: uppercase; margin-top: 0.5rem; }
  .earnings { border: 1px solid rgba(34,197,94,0.3); padding: 1.5rem; margin-bottom: 2rem; background: rgba(34,197,94,0.05); }
  .earnings h2 { color: #22c55e; font-size: 1rem; margin-bottom: 1rem; }
  .earnings-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem; }
  .job { border: 1px solid rgba(45,134,255,0.1); padding: 1rem; margin-bottom: 0.5rem; font-size: 0.8rem; }
  .job-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; }
  .job-id { color: #2d86ff; }
  .job-type { color: #a78bfa; text-transform: uppercase; font-size: 0.7rem; }
  .job-status { padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.6rem; text-transform: uppercase; }
  .job-status.completed { background: rgba(34,197,94,0.2); color: #22c55e; }
  .job-status.failed { background: rgba(239,68,68,0.2); color: #ef4444; }
  .job-status.pending { background: rgba(249,115,22,0.2); color: #f59e0b; }
  .job-status.claimed { background: rgba(168,85,247,0.2); color: #a78bfa; }
  .job-details { color: #6b7c93; font-size: 0.7rem; }
  h2 { color: #2d86ff; font-size: 0.9rem; letter-spacing: 0.15em; margin: 2rem 0 1rem; font-weight: 400; }
  .refresh { color: #4a5568; font-size: 0.7rem; margin-top: 2rem; text-align: center; }
  .refresh a { color: #2d86ff; }
</style>
</head><body>
<div class="nav"><a href="/">← Back to Network Dashboard</a></div>
<h1>◉ NODE: ${n.name}</h1>
<div class="subtitle">Operator Dashboard | ${nodeId}</div>

<div class="status">
  <h2>${isOnline ? '🟢 ONLINE' : '🔴 OFFLINE'}</h2>
  <div class="status-grid">
    <div class="status-item">
      <div class="label">Status</div>
      <div class="value">${isOnline ? 'Active' : 'Disconnected'}${hasWs ? ' ⚡ WebSocket' : ''}</div>
    </div>
    <div class="status-item">
      <div class="label">Owner</div>
      <div class="value">${n.owner || 'Unknown'}</div>
    </div>
    <div class="status-item">
      <div class="label">Region</div>
      <div class="value">${n.region || 'Unknown'}</div>
    </div>
    <div class="status-item">
      <div class="label">Capabilities</div>
      <div class="value">${n.capabilities?.join(', ') || 'None'}</div>
    </div>
    <div class="status-item">
      <div class="label">Resources</div>
      <div class="value">${n.resources?.cpuCores || 'Unknown'} cores, ${Math.round((n.resources?.ramMB || 0)/1024)}GB RAM</div>
    </div>
    <div class="status-item">
      <div class="label">Last Checkin</div>
      <div class="value">${n.lastCheckIn ? new Date(n.lastCheckIn).toLocaleString() : 'Never'}</div>
    </div>
  </div>
</div>

<div class="earnings">
  <h2>💰 EARNINGS & PAYOUTS</h2>
  <div class="earnings-grid">
    <div class="stat">
      <span class="num">${pendingBalance}</span>
      <span class="label">Pending Balance (min)</span>
    </div>
    <div class="stat">
      <span class="num">${Math.round((earnings.earned || 0) * 100) / 100}</span>
      <span class="label">Total Earned</span>
    </div>
    <div class="stat">
      <span class="num">${Math.round((earnings.withdrawn || 0) * 100) / 100}</span>
      <span class="label">Withdrawn</span>
    </div>
    <div class="stat">
      <span class="num">${n.jobsCompleted || 0}</span>
      <span class="label">Jobs Completed</span>
    </div>
  </div>
</div>

<div class="stats">
  <div class="stat">
    <span class="num">${jobStats.completed}</span>
    <span class="label">Completed</span>
  </div>
  <div class="stat">
    <span class="num">${jobStats.pending}</span>
    <span class="label">Active/Pending</span>
  </div>
  <div class="stat">
    <span class="num">${jobStats.failed}</span>
    <span class="label">Failed</span>
  </div>
  <div class="stat">
    <span class="num">${Math.round((n.computeMinutes || 0) * 100) / 100}</span>
    <span class="label">Compute Minutes</span>
  </div>
</div>

<h2>RECENT JOBS</h2>
${recentJobs.length ? recentJobs.map(job => `
<div class="job">
  <div class="job-header">
    <span class="job-id">${job.jobId}</span>
    <span class="job-type">${job.type}</span>
    <span class="job-status ${job.status}">${job.status}</span>
  </div>
  <div class="job-details">
    Created: ${new Date(job.created).toLocaleString()} | 
    ${job.duration ? `Duration: ${Math.round(job.duration/1000)}s` : ''} | 
    ${job.priceInts ? `Value: ${Math.round(job.priceInts/100 * 10)/10} min` : ''}
  </div>
</div>
`).join('') : '<div class="job"><div class="job-details">No recent jobs found.</div></div>'}

<div class="refresh">
  <a href="">Refresh</a> | Auto-refreshes every 30s | 
  <a href="/status">JSON API</a> | 
  <a href="/operator/${nodeId}">Permalink</a>
</div>

<script>
setTimeout(() => location.reload(), 30000);
</script>
</body></html>`;
}

// ===== START =====
setupWebSocket(server);

// Init Spaces storage (falls back to local if not configured)
storage.initSpaces().then(ok => {
  if (!ok) console.log('  📁 Storage: local disk (set DO_SPACES_KEY/SECRET for Spaces)');
});

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
    }
  }
}, 60000);

// Cleanup expired uploads every hour
setInterval(async () => {
  try {
    const deleted = await storage.cleanupExpired();
    if (deleted > 0) console.log(`  🧹 Cleaned up ${deleted} expired uploads`);
  } catch(e) {
    logError('Upload cleanup', e);
  }
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
