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
const { validateDbPath } = require('./lib/db-utils');

const storage = require('./lib/storage');
const connect = require('./lib/stripe-connect');
const EnhancedRateLimiter = require('./lib/enhanced-rate-limit');
const logger = require('./lib/logger');

const rateLimiter = new EnhancedRateLimiter({
  whitelistFile: './config/rate-limit-whitelist.json',
  logFile: './logs/rate-limits.log',
  enableLogging: true
});

// ===== ERROR HANDLING UTILITIES =====
function logError(context, error, details = {}) {
  logger.error(context, error.message, {
    error: error.name,
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
const validDbPath = validateDbPath(DB_PATH);
if (!validDbPath) {
  console.error('🚨 SECURITY: Invalid database path provided');
  process.exit(1);
}
const db = new Database(validDbPath);
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
    error_message TEXT,
    progress TEXT,
    retryCount INTEGER DEFAULT 0
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

  CREATE TABLE IF NOT EXISTS founding_operators (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nodeId TEXT NOT NULL UNIQUE,
    slot_number INTEGER NOT NULL UNIQUE,
    joined_at INTEGER NOT NULL,
    email TEXT NOT NULL UNIQUE,
    benefits TEXT DEFAULT '{}',
    status TEXT DEFAULT 'active',
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
  );
`);

// Add progress column if missing (migration)
try { db.exec('ALTER TABLE jobs ADD COLUMN progress TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE nodes ADD COLUMN manifests TEXT DEFAULT \'{}\''); } catch(e) {}

// === Benchmarks table (Protocol v2: Proof primitive) ===
db.exec(`
  CREATE TABLE IF NOT EXISTS benchmarks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nodeId TEXT NOT NULL,
    capability TEXT NOT NULL,
    rtf REAL,
    duration_ms INTEGER,
    passed INTEGER DEFAULT 0,
    warm INTEGER DEFAULT 0,
    output_sample TEXT,
    timestamp INTEGER NOT NULL,
    UNIQUE(nodeId, capability, timestamp)
  );
  CREATE INDEX IF NOT EXISTS idx_benchmarks_node_cap ON benchmarks(nodeId, capability);
`);

// === Benchmark stats view (rolling window) ===
const getBenchmarkStats = db.prepare(`
  SELECT nodeId, capability,
    COUNT(*) as sample_count,
    AVG(rtf) as avg_rtf,
    MIN(rtf) as min_rtf,
    MAX(rtf) as max_rtf,
    MAX(timestamp) as last_updated,
    SUM(CASE WHEN passed = 1 THEN 1 ELSE 0 END) as passed_count
  FROM benchmarks
  WHERE nodeId = ? AND capability = ?
  ORDER BY timestamp DESC
  LIMIT 20
`);

const insertBenchmark = db.prepare(`
  INSERT INTO benchmarks (nodeId, capability, rtf, duration_ms, passed, warm, output_sample, timestamp)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const getRecentBenchmarks = db.prepare(`
  SELECT * FROM benchmarks
  WHERE nodeId = ? AND capability = ?
  ORDER BY timestamp DESC
  LIMIT 20
`);

// === Affinity map (in-memory, TTL-based) ===
const affinityMap = new Map(); // affinity_key -> { nodeId, lastSeen, jobCount }
const AFFINITY_TTL_MS = 30 * 60 * 1000; // 30 minutes

function getAffinityNode(affinityKey) {
  if (!affinityKey) return null;
  const entry = affinityMap.get(affinityKey);
  if (!entry) return null;
  if (Date.now() - entry.lastSeen > AFFINITY_TTL_MS) {
    affinityMap.delete(affinityKey);
    return null;
  }
  return entry.nodeId;
}

function updateAffinity(affinityKey, nodeId) {
  if (!affinityKey) return;
  const existing = affinityMap.get(affinityKey);
  affinityMap.set(affinityKey, {
    nodeId,
    lastSeen: Date.now(),
    jobCount: (existing?.nodeId === nodeId ? (existing.jobCount || 0) : 0) + 1
  });
}

// Clean stale affinity entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of affinityMap) {
    if (now - entry.lastSeen > AFFINITY_TTL_MS) affinityMap.delete(key);
  }
}, 5 * 60 * 1000);

// ===== PREPARED STATEMENTS =====
const stmts = {
  upsertNode: db.prepare(`
    INSERT INTO nodes (nodeId, name, ip, capabilities, models, manifests, cpuCores, ramMB, ramFreeMB, cpuIdle, gpuVRAM, diskFreeGB, owner, region, lastSeen, registeredAt)
    VALUES (@nodeId, @name, @ip, @capabilities, @models, @manifests, @cpuCores, @ramMB, @ramFreeMB, @cpuIdle, @gpuVRAM, @diskFreeGB, @owner, @region, @lastSeen, @registeredAt)
    ON CONFLICT(nodeId) DO UPDATE SET
      name=@name, ip=@ip, capabilities=@capabilities, models=@models, manifests=@manifests,
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
      logger.system('JSON migration', 'nodes', {
        count: Object.keys(nodes).length,
        source: 'nodes.json'
      });
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
      logger.system('JSON migration', 'jobs', {
        count: Object.keys(jobs).length,
        source: 'jobs.json'
      });
    }
    
    if (fs.existsSync(ledgerFile)) {
      const ledger = JSON.parse(fs.readFileSync(ledgerFile, 'utf8'));
      for (const [id, l] of Object.entries(ledger)) {
        stmts.upsertLedger.run(id, l.earned || 0, l.spent || 0, l.jobs || 0, 0, 0, 0);
      }
      logger.system('JSON migration', 'ledger', {
        count: Object.keys(ledger).length,
        source: 'ledger.json'
      });
    }
  } catch(e) {
    logger.system('JSON migration skipped', 'migration', {
      error: e.message,
      reason: 'migration_error'
    });
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
    manifests: JSON.parse(row.manifests || '{}'),
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
    progress: row.progress ? JSON.parse(row.progress) : null,
    computeMs: row.computeMs, creditAmount: row.creditAmount,
    retryCount: row.retryCount || 0
  };
}

function verifyNodeSignature(body, signature, publicKeyPem) {
  if (!signature || !publicKeyPem) return false;
  try {
    const key = crypto.createPublicKey(publicKeyPem);
    return crypto.verify(null, Buffer.from(body), key, Buffer.from(signature, 'base64'));
  } catch { return false; }
}

function registerNode(data, reqHeaders, rawBody) {
  // SECURITY: Basic validation for node registration
  const ip = data.ip || 'unknown';
  
  // Rate limiting: prevent rapid registrations from same IP
  // Allow higher limits for localhost (for testing)
  const maxRegistrations = ip === '127.0.0.1' || ip === '::1' || ip === 'localhost' ? 50 : 10;
  const recentRegistrations = db.prepare(`
    SELECT COUNT(*) as count FROM nodes 
    WHERE ip = ? AND registeredAt > ?
  `).get(ip, Date.now() - 300000); // 5 minutes
  
  if (recentRegistrations.count >= maxRegistrations) {
    logger.error('registration-rate-limit', `Too many registrations from IP ${ip}`, { ip, count: recentRegistrations.count });
    throw new Error('Registration rate limit exceeded. Please wait before registering more nodes.');
  }
  
  // Validate required fields
  if (!data.name || data.name.length < 1 || data.name.length > 64) {
    throw new Error('Node name is required and must be 1-64 characters');
  }
  
  // Sanitize text fields to prevent XSS
  data.name = (data.name || '').replace(/[<>'"&;]/g, '').slice(0, 64);
  const sanitizedOwner = (data.owner || 'unknown').replace(/[<>'"&;]/g, '').slice(0, 64);
  const sanitizedRegion = (data.region || 'unknown').replace(/[<>'"&;]/g, '').slice(0, 64);
  
  // Dedup: if client sends an ID we know, use it. Otherwise match by name+owner.
  let id = data.nodeId;
  if (!id || !stmts.getNode.get(id)) {
    const existing = stmts.findNodeByNameOwner.get(data.name, sanitizedOwner);
    id = existing ? existing.nodeId : genId();
  }
  const now = Date.now();
  // SECURITY: Validate and sanitize numeric fields
  const cpuCores = Math.max(0, Math.min(128, parseInt(data.cpuCores) || 0));
  const ramMB = Math.max(0, Math.min(1048576, parseInt(data.ramMB) || 0)); // 1TB max
  const ramFreeMB = Math.max(0, Math.min(ramMB, parseInt(data.ramFreeMB) || 0));
  const cpuIdle = Math.max(0, Math.min(100, parseFloat(data.cpuIdle) || 0));
  const gpuVRAM = Math.max(0, Math.min(131072, parseInt(data.gpuVRAM) || 0)); // 128GB max
  const diskFreeGB = Math.max(0, Math.min(1048576, parseInt(data.diskFreeGB) || 0)); // 1PB max
  
  // SECURITY: Ed25519 node identity verification
  const existingNode = stmts.getNode.get(id);
  if (data.publicKey && reqHeaders?.['x-node-signature'] && rawBody) {
    const sigValid = verifyNodeSignature(rawBody, reqHeaders['x-node-signature'], data.publicKey);
    if (!sigValid) {
      throw new Error('Node signature verification failed');
    }
    // If existing node has a different key, reject (key pinning)
    if (existingNode?.publicKey && existingNode.publicKey !== data.publicKey) {
      logger.error('node-key-mismatch', `Key mismatch for node ${id}`, { nodeId: id });
      throw new Error('Public key mismatch — node identity conflict. If you regenerated keys, contact hub admin.');
    }
  }

  stmts.upsertNode.run({
    nodeId: id, name: data.name, ip: data.ip || 'unknown',
    capabilities: JSON.stringify(data.capabilities || []),
    models: JSON.stringify(data.models || []),
    manifests: JSON.stringify(data.manifests || {}),
    cpuCores, ramMB, ramFreeMB, cpuIdle, gpuVRAM, diskFreeGB,
    owner: sanitizedOwner, region: sanitizedRegion,
    lastSeen: now, registeredAt: now
  });
  // Store public key if provided and verified
  if (data.publicKey) {
    try { db.prepare('UPDATE nodes SET publicKey = ? WHERE nodeId = ?').run(data.publicKey, id); } catch {}
  }

  // Founding Operator Logic
  try {
    const existingFounding = db.prepare(`
      SELECT 1 FROM founding_operators WHERE nodeId = ?
    `).get(id);

    if (!existingFounding) {
      const currentFoundingCount = db.prepare(`
        SELECT COUNT(*) as count FROM founding_operators WHERE status = 'active'
      `).get().count;
      
      if (currentFoundingCount < 50) {
        // This node qualifies as a founding operator
        const joinOrder = currentFoundingCount + 1;
        
        db.prepare(`
          INSERT INTO founding_operators (nodeId, slot_number, joined_at, email, benefits, created_at)
          VALUES (?, ?, ?, ?, '{"multiplier": 2.0, "priority_routing": true}', ?)
        `).run(id, joinOrder, now, data.owner || 'unknown', now);
        
        logger.info('founding-operator-added', `Node ${id} registered as founding operator #${joinOrder}`, {
          nodeId: id, joinOrder, owner: data.owner
        });
      }
    }
  } catch (err) {
    logger.error('founding-operator-check', err.message, { nodeId: id });
  }

  // === Benchmark-on-registration (Protocol v2) ===
  // If node has capabilities we can benchmark and no recent samples, queue a benchmark job
  try {
    const nodeCaps = data.capabilities || [];
    const benchmarkableCaps = ['whisper']; // Capabilities we have reference files for
    for (const cap of benchmarkableCaps) {
      if (!nodeCaps.includes(cap) && !nodeCaps.includes(aliasCapability(cap))) continue;
      
      const recentSamples = getRecentBenchmarks.all(id, cap);
      const lastBenchmark = recentSamples[0]?.timestamp || 0;
      const hoursSinceLastBenchmark = (now - lastBenchmark) / 3600000;
      
      // Submit benchmark if: no samples, or stale (> 6 hours)
      if (recentSamples.length === 0 || hoursSinceLastBenchmark > 6) {
        // Use the server's public URL if behind proxy, otherwise localhost
        const benchmarkUrl = process.env.IC_MESH_PUBLIC_URL 
          ? `${process.env.IC_MESH_PUBLIC_URL}/files/benchmark-whisper-5sec.wav`
          : `http://localhost:${PORT}/files/benchmark-whisper-5sec.wav`;
        const existingBenchmarkJob = db.prepare(
          "SELECT 1 FROM jobs WHERE type = '_benchmark' AND claimedBy = ? AND status IN ('pending', 'claimed') LIMIT 1"
        ).get(id);
        
        if (!existingBenchmarkJob) {
          submitJob({
            type: 'transcribe',
            payload: {
              url: benchmarkUrl,
              _benchmark: true,
              _benchmark_capability: cap,
              duration_seconds: 5 // known duration for RTF calculation
            },
            requirements: { capability: cap },
            requester: '_benchmark'
          });
          logger.info(`Benchmark job queued for ${data.name || id}`, { nodeId: id, capability: cap });
        }
      }
    }
  } catch (e) {
    // Non-critical: don't fail registration over benchmark
    logger.warn(`Benchmark queue failed: ${e.message}`, { nodeId: id });
  }

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
    requester: data.requester || data.payload?.email || data.email || '',
    requirements: JSON.stringify(data.requirements || {}),
    createdAt: Date.now()
  });
  
  // Push to connected WebSocket nodes
  broadcastToEligibleNodes(jobToJSON(stmts.getJob.get(id)));
  
  return jobToJSON(stmts.getJob.get(id));
}

// Capability alias mapping to handle naming variations
function aliasCapability(capability) {
  const aliases = {
    'transcription': 'whisper',
    'transcribe': 'whisper', 
    'ocr': 'tesseract',
    'pdf-extract': 'tesseract',
    'inference': 'ollama',
    'generate-image': 'stable-diffusion'
  };
  return aliases[capability] || capability;
}

function getAvailableJobs(nodeId) {
  const pending = stmts.getPendingJobs.all();
  const node = stmts.getNode.get(nodeId);
  logger.debug(`getAvailableJobs called`, { nodeId, pendingCount: pending.length, nodeFound: !!node });
  
  // Check if node is quarantined
  if (node) {
    const flags = JSON.parse(node.flags || '{}');
    if (flags.quarantined) {
      // Return empty array for quarantined nodes
      return [];
    }
  }
  
  const nodeCaps = node ? JSON.parse(node.capabilities || '[]') : [];
  const nodeModels = node ? JSON.parse(node.models || '[]') : [];
  
  const filtered = pending.filter(row => {
    const req = JSON.parse(row.requirements || '{}');
    if (req.capability) {
      const requiredCap = aliasCapability(req.capability);
      if (!nodeCaps.includes(requiredCap) && !nodeCaps.includes(req.capability)) return false;
    }
    if (req.model && !nodeModels.includes(req.model)) return false;
    if (req.minRAM && node && node.ramFreeMB < req.minRAM) return false;
    return true;
  });

  // Sort: affinity-matched jobs first, then by creation time
  filtered.sort((a, b) => {
    const reqA = JSON.parse(a.requirements || '{}');
    const reqB = JSON.parse(b.requirements || '{}');
    const payloadA = JSON.parse(a.payload || '{}');
    const payloadB = JSON.parse(b.payload || '{}');
    const affinityA = reqA.affinity_key || payloadA.affinity_key;
    const affinityB = reqB.affinity_key || payloadB.affinity_key;
    const matchA = affinityA && getAffinityNode(affinityA) === nodeId ? 1 : 0;
    const matchB = affinityB && getAffinityNode(affinityB) === nodeId ? 1 : 0;
    if (matchA !== matchB) return matchB - matchA; // affinity matches first
    return a.createdAt - b.createdAt; // then oldest first
  });

  return filtered.map(jobToJSON);
}

function claimJob(jobId, nodeId) {
  // Verify node has required capabilities before allowing claim
  const job = stmts.getJob.get(jobId);
  if (!job || job.status !== 'pending') return null;
  
  // Check if node is quarantined
  const node = stmts.getNode.get(nodeId);
  if (node) {
    const flags = JSON.parse(node.flags || '{}');
    if (flags.quarantined) {
      logger.jobEvent(jobId.slice(0, 8), 'claim rejected', {
        nodeId: nodeId.slice(0, 8),
        reason: 'node_quarantined',
        quarantinedAt: flags.quarantinedAt
      });
      return null;
    }
  }
  
  const req = JSON.parse(job.requirements || '{}');
  if (req.capability) {
    const caps = node ? JSON.parse(node.capabilities || '[]') : [];
    const requiredCap = aliasCapability(req.capability);
    if (!caps.includes(requiredCap)) {
      logger.jobEvent(jobId.slice(0, 8), 'claim rejected', {
        nodeId: nodeId.slice(0, 8),
        reason: 'missing_capability',
        requiredCapability: req.capability,
        aliasedCapability: requiredCap,
        nodeCapabilities: caps
      });
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
  const rawPriceInts = parseInt(payload.price_ints) || 0;
  
  // SECURITY: Validate price_ints to prevent overflow and manipulation
  const MAX_PRICE_INTS = 100000000; // $1000 max (100M ints = $1000 at 0.01/int)
  if (rawPriceInts < 0) {
    logger.error('negative-price-attack', `Rejected negative price_ints: ${rawPriceInts}`, { nodeId, jobId });
    return null; // Reject job completion with negative price
  }
  if (rawPriceInts > MAX_PRICE_INTS) {
    logger.error('price-overflow-attack', `Rejected excessive price_ints: ${rawPriceInts}`, { nodeId, jobId });
    return null; // Reject job completion with excessive price
  }
  priceInts = rawPriceInts;
  
  // Revenue split: 80% node, 15% treasury, 5% infra (all integer ints)
  const nodeCut = Math.floor(priceInts * 80 / 100);
  const treasuryCut = Math.floor(priceInts * 15 / 100);
  const infraCut = priceInts - nodeCut - treasuryCut; // remainder to infra (avoids rounding loss)
  
  // SECURITY: Validate completion data to prevent malicious injection
  let completionData = result.data || null;
  if (completionData !== null) {
    // Basic validation - reject if too large or contains suspicious content
    const dataStr = JSON.stringify(completionData);
    if (dataStr.length > 10485760) { // 10MB max
      logger.error('completion-data-too-large', `Rejected large completion data: ${dataStr.length} bytes`, { nodeId, jobId });
      return null;
    }
    
    // Check for basic script injection attempts
    const suspiciousPatterns = [
      /<script[^>]*>/i, 
      /javascript:/i, 
      /on\w+\s*=/i, 
      /<iframe[^>]*>/i,
      /data:text\/html/i
    ];
    
    if (suspiciousPatterns.some(pattern => pattern.test(dataStr))) {
      logger.error('completion-data-injection', `Rejected suspicious completion data`, { nodeId, jobId, patterns: 'detected' });
      return null;
    }
  }
  
  stmts.completeJob.run(now, JSON.stringify(completionData), computeMs, priceInts, jobId, nodeId);
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
    logger.jobEvent(jobId.slice(0, 8), 'payment split', {
      totalInts: priceInts,
      nodeCut,
      treasuryCut,
      infraCut,
      nodeId: nodeId.slice(0, 8),
      type: 'payment_split'
    });
  }
  
  const completed = jobToJSON(stmts.getJob.get(jobId));

  // Store benchmark/performance data as a Proof (Protocol v2)
  try {
    const reqs = safeJsonParse(job.requirements, {}, 'job requirements');
    const rawCap = reqs.capability || job.type;
    const capability = aliasCapability(rawCap); // Store under canonical name
    // RTF: if we know input duration, compute realtime factor
    const inputDuration = payload.duration_seconds || payload.duration || null;
    const rtf = inputDuration ? (inputDuration / (computeMs / 1000)) : null;
    const isBenchmark = !!payload._benchmark;
    const isWarm = !isBenchmark; // Real jobs are "warm", benchmark jobs are "cold"
    
    if (capability && computeMs > 0) {
      insertBenchmark.run(
        nodeId, capability, rtf, computeMs,
        1, // passed (completed successfully)
        isWarm ? 1 : 0, // warm = real job, cold = benchmark
        isBenchmark ? JSON.stringify(result.data || null)?.slice(0, 500) : null,
        now
      );
    }

    // Update affinity
    const affinityKey = reqs.affinity_key || payload.affinity_key;
    updateAffinity(affinityKey, nodeId);
  } catch (e) {
    // Non-critical: don't fail job completion over benchmark logging
  }
  
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
    logger.nodeEvent(nodeId, 'WebSocket connected', {
      totalConnections: wsClients.size,
      type: 'ws_connect'
    });
    
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
      logger.nodeEvent(nodeId, 'WebSocket disconnected', {
        totalConnections: wsClients.size,
        type: 'ws_disconnect'
      });
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
        registerNode(data, null, null);
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
      // Store progress in DB with timestamp for staleness detection
      try {
        const progData = { ...msg.progress, _updated: Date.now() };
        db.prepare('UPDATE jobs SET progress = ? WHERE jobId = ?').run(JSON.stringify(progData), msg.jobId);
      } catch(e) {}
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
    if (req.capability) {
      const requiredCap = aliasCapability(req.capability);
      if (!caps.includes(requiredCap)) continue;
    }
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
function parseBody(req, returnRaw = false) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        resolve(returnRaw ? { parsed, raw: body } : parsed);
      }
      catch { resolve(returnRaw ? { parsed: {}, raw: body } : {}); }
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Node-Id, X-Node-Secret, X-Api-Key, Authorization');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', 'default-src \'self\'; script-src \'self\'; style-src \'self\'; img-src \'self\' data: https:; connect-src \'self\';');
  if (method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  // Rate limiting - proxy-aware IP detection
  function getClientIp(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() 
      || req.headers['x-real-ip'] 
      || req.socket.remoteAddress 
      || 'unknown';
  }
  const clientIp = getClientIp(req);
  const rlGroup = method === 'POST' && pathname === '/upload' ? 'upload'
    : method === 'POST' && pathname === '/jobs' ? 'jobs-post'
    : method === 'POST' && pathname === '/nodes/register' ? 'nodes-register'
    : 'default';
  const rl = rateLimiter.check(clientIp, rlGroup);
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retryAfter));
    return json(res, { 
      error: 'Rate limit exceeded', 
      detail: `Too many requests from ${clientIp}`, 
      retry_after: rl.retryAfter,
      suggestion: `Wait ${rl.retryAfter} seconds before retrying`
    }, 429);
  }
  
  try {
    // ---- Presigned Upload URL (client → Spaces direct) ----
    if (method === 'POST' && pathname === '/upload/presign') {
      const data = await parseBody(req);
      const { filename, content_type } = data;
      if (!filename) return json(res, { error: 'Filename is required', detail: 'Include filename in request body', example: { filename: 'audio.wav' } }, 400);
      
      const id = crypto.randomBytes(8).toString('hex');
      const ext = path.extname(filename) || '.bin';
      const key = `uploads/${id}${ext}`;
      const ct = content_type || 'application/octet-stream';
      
      const storage = require('./lib/storage');
      storage.initSpaces();
      const uploadUrl = await storage.getPresignedUploadUrl(key, ct);
      const downloadUrl = await storage.getPresignedUrl(key);
      
      if (!uploadUrl) {
        return json(res, { error: 'DigitalOcean Spaces not configured', detail: 'Presigned URLs unavailable without Spaces setup', alternative: 'Use POST /upload for direct file upload instead' }, 503);
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
              logger.info(`File uploaded: ${result.filename}`, {
                sizeMB: (result.size / 1024 / 1024).toFixed(1),
                storage: result.storage,
                type: 'file_upload'
              });
              return json(res, { ok: true, url: result.url, filename: result.filename, size: result.size, storage: result.storage });
            }
          }
          json(res, { error: 'Invalid file upload format', detail: 'File upload could not be parsed', suggestion: 'Ensure Content-Type is multipart/form-data and file is properly attached' }, 400);
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
      if (!fs.existsSync(filePath)) return json(res, { error: 'File not found', detail: `No file named '${filename}' exists`, suggestion: 'Check filename or upload the file first' }, 404);
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
      try {
        const { parsed: data, raw: rawBody } = await parseBody(req, true);
        data.ip = getClientIp(req);
        const node = registerNode(data, req.headers, rawBody);
        return json(res, { ok: true, node });
      } catch (error) {
        logger.error('node-registration-failed', error.message, { ip: getClientIp(req) });
        return json(res, { error: error.message }, 400);
      }
    }
    
    if (method === 'GET' && pathname === '/nodes') {
      const active = getActiveNodes();
      return json(res, { nodes: active, total: Object.keys(active).length });
    }

    // ---- Estimate Endpoint (Protocol v2) ----
    if (method === 'POST' && pathname === '/estimate') {
      const data = await parseBody(req);
      const { capability, duration_seconds, file_size_mb, model, affinity_key } = data;
      
      if (!capability) return json(res, { 
        error: 'capability is required', 
        detail: 'Specify what type of job you want to estimate', 
        valid_capabilities: [...registeredTypes].sort(),
        example: { capability: 'transcribe', duration_seconds: 300, file_size_mb: 10 }
      }, 400);
      
      const cutoff = Date.now() - 120000;
      const activeNodes = stmts.getActiveNodes.all(cutoff);
      const resolvedCap = aliasCapability(capability);
      
      const estimates = [];
      for (const node of activeNodes) {
        const caps = JSON.parse(node.capabilities || '[]');
        if (!caps.includes(resolvedCap) && !caps.includes(capability)) continue;
        
        // Check quarantine
        const flags = JSON.parse(node.flags || '{}');
        if (flags.quarantined) continue;
        
        // Get benchmark data (stored under canonical name via aliasCapability)
        const samples = getRecentBenchmarks.all(node.nodeId, resolvedCap);
        const stats = getBenchmarkStats.get(node.nodeId, resolvedCap);
        
        // Compute RTF stats
        let p50_rtf = null, p95_rtf = null, confidence = 'none';
        if (samples.length > 0) {
          const rtfs = samples.filter(s => s.rtf != null).map(s => s.rtf).sort((a, b) => a - b);
          if (rtfs.length > 0) {
            p50_rtf = rtfs[Math.floor(rtfs.length * 0.5)];
            p95_rtf = rtfs[Math.floor(rtfs.length * 0.95)];
          }
          const lastTs = Math.max(...samples.map(s => s.timestamp));
          const staleness = Date.now() - lastTs;
          
          if (samples.length >= 10 && staleness < 6 * 3600000) confidence = 'high';
          else if (samples.length >= 3 && staleness < 24 * 3600000) confidence = 'medium';
          else confidence = 'low';
        }
        
        // Compute estimated time
        let estimatedComputeSeconds = null;
        if (p50_rtf && duration_seconds) {
          estimatedComputeSeconds = Math.round(duration_seconds / p50_rtf);
        }
        
        // Transfer time estimate (rough: assume 10 MB/s for remote, 0 for shared storage)
        const manifests = JSON.parse(node.manifests || '{}');
        const hasSharedStorage = data.storage_pool && 
          Object.values(manifests).some(m => m.storage?.mounts?.some(s => s.id === data.storage_pool));
        const estimatedTransferSeconds = hasSharedStorage ? 0 :
          (file_size_mb ? Math.round(file_size_mb / 10) : null);
        
        // Affinity match
        const affinityMatch = affinity_key ? getAffinityNode(affinity_key) === node.nodeId : false;
        
        // Current load (rough: use cpuIdle)
        const currentLoad = Math.max(0, Math.min(1, 1 - (node.cpuIdle || 50) / 100));
        
        estimates.push({
          node_id: node.nodeId,
          node_name: node.name,
          estimated_compute_seconds: estimatedComputeSeconds,
          estimated_transfer_seconds: estimatedTransferSeconds,
          estimated_total_seconds: (estimatedComputeSeconds || 0) + (estimatedTransferSeconds || 0) || null,
          confidence,
          benchmark_samples: samples.length,
          p50_rtf,
          p95_rtf,
          has_shared_storage: !!hasSharedStorage,
          current_load: Math.round(currentLoad * 100) / 100,
          affinity_match: affinityMatch
        });
      }
      
      // Sort: best total time first, break ties by confidence then load
      const confidenceOrder = { high: 3, medium: 2, low: 1, none: 0 };
      estimates.sort((a, b) => {
        // Nodes with estimates first
        if (a.estimated_total_seconds && !b.estimated_total_seconds) return -1;
        if (!a.estimated_total_seconds && b.estimated_total_seconds) return 1;
        if (a.estimated_total_seconds && b.estimated_total_seconds) {
          const diff = a.estimated_total_seconds - b.estimated_total_seconds;
          if (Math.abs(diff) > 5) return diff; // >5s difference is meaningful
        }
        // Then by confidence
        const confDiff = (confidenceOrder[b.confidence] || 0) - (confidenceOrder[a.confidence] || 0);
        if (confDiff !== 0) return confDiff;
        // Then by load
        return a.current_load - b.current_load;
      });
      
      const bestNode = estimates[0]?.node_id || null;
      const estimatedCost = duration_seconds ? Math.max(1, Math.round(duration_seconds)) : null;
      
      return json(res, {
        estimates,
        best_node: bestNode,
        estimated_cost_ints: estimatedCost,
        nodes_evaluated: estimates.length
      });
    }

    // ---- Benchmark Data (Protocol v2) ----
    if (method === 'GET' && pathname.startsWith('/benchmarks/')) {
      const parts = pathname.split('/');
      const nodeId = parts[2];
      const capability = parts[3];
      
      if (!nodeId) return json(res, { error: 'nodeId required: /benchmarks/:nodeId[/:capability]' }, 400);
      
      if (capability) {
        const samples = getRecentBenchmarks.all(nodeId, aliasCapability(capability));
        const stats = getBenchmarkStats.get(nodeId, aliasCapability(capability));
        
        let status = 'new';
        if (samples.length >= 3) {
          const lastTs = Math.max(...samples.map(s => s.timestamp));
          status = (Date.now() - lastTs > 24 * 3600000) ? 'stale' : 'benchmarked';
        } else if (samples.length > 0) {
          status = 'benchmarking';
        }
        if (samples.length > 0 && !samples[0].passed) status = 'failed';
        
        return json(res, {
          node_id: nodeId,
          capability,
          status,
          samples: samples.map(s => ({
            rtf: s.rtf,
            duration_ms: s.duration_ms,
            passed: !!s.passed,
            warm: !!s.warm,
            timestamp: s.timestamp
          })),
          stats: stats ? {
            sample_count: stats.sample_count,
            avg_rtf: stats.avg_rtf ? Math.round(stats.avg_rtf * 100) / 100 : null,
            min_rtf: stats.min_rtf ? Math.round(stats.min_rtf * 100) / 100 : null,
            max_rtf: stats.max_rtf ? Math.round(stats.max_rtf * 100) / 100 : null,
            accuracy_rate: stats.sample_count > 0 ? Math.round(stats.passed_count / stats.sample_count * 100) / 100 : null,
            last_updated: stats.last_updated
          } : null
        });
      } else {
        // All benchmarks for a node
        const all = db.prepare(`
          SELECT capability, COUNT(*) as samples, AVG(rtf) as avg_rtf, MAX(timestamp) as last_updated,
            SUM(CASE WHEN passed = 1 THEN 1 ELSE 0 END) as passed
          FROM benchmarks WHERE nodeId = ? GROUP BY capability
        `).all(nodeId);
        
        return json(res, {
          node_id: nodeId,
          capabilities: all.map(row => ({
            capability: row.capability,
            samples: row.samples,
            avg_rtf: row.avg_rtf ? Math.round(row.avg_rtf * 100) / 100 : null,
            accuracy_rate: row.samples > 0 ? Math.round(row.passed / row.samples * 100) / 100 : null,
            last_updated: row.last_updated
          }))
        });
      }
    }

    // ---- Affinity Map (debug endpoint) ----
    if (method === 'GET' && pathname === '/affinity') {
      const entries = {};
      for (const [key, val] of affinityMap) {
        entries[key] = { ...val, age_seconds: Math.round((Date.now() - val.lastSeen) / 1000) };
      }
      return json(res, { affinity: entries, count: affinityMap.size });
    }

    // ---- Job Queue ----
    if (method === 'POST' && pathname === '/jobs') {
      const data = await parseBody(req);
      
      // Authentication: require API key or internal origin
      const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
      const isInternal = clientIp === '127.0.0.1' || clientIp === '::1' || clientIp === '::ffff:127.0.0.1';
      
      if (!isInternal && !apiKey) {
        return json(res, { 
          error: 'Authentication required',
          detail: 'Provide an API key via X-Api-Key header or Authorization: Bearer <key>',
          signup: 'https://moilol.com/account.html'
        }, 401);
      }
      
      // Validate API key if provided (non-internal)
      if (apiKey && !isInternal) {
        // Forward to site server for key validation
        try {
          const keyCheck = await new Promise((resolve, reject) => {
            const kr = http.request({ hostname: '127.0.0.1', port: 443, path: '/api/auth/verify-key', method: 'POST',
              headers: { 'Content-Type': 'application/json' }, rejectUnauthorized: false
            }, (kres) => { let d = ''; kres.on('data', c => d += c); kres.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } }); });
            kr.on('error', () => resolve({}));
            kr.end(JSON.stringify({ key: apiKey }));
          });
          if (!keyCheck.valid) {
            logger.warn(`Invalid API key rejected: ${apiKey.slice(0, 8)}`, {
              ip: clientIp,
              status: 'invalid_key_rejected'
            });
            return json(res, { 
              error: 'Invalid API key', 
              code: 'INVALID_API_KEY',
              signup: 'https://moilol.com/account.html'
            }, 401);
          }
        } catch {}
      }
      
      // Validate job type — built-in + any type registered by active nodes
      const BUILTIN_JOB_TYPES = ['transcribe', 'generate-image', 'ffmpeg', 'inference', 'ocr', 'pdf-extract', 'ping'];
      const registeredTypes = new Set(BUILTIN_JOB_TYPES);
      // Add any capability declared by active nodes (enables custom handler types)
      try {
        const activeNodes = stmts.getActiveNodes.all(Date.now() - 120000);
        for (const n of activeNodes) {
          for (const cap of JSON.parse(n.capabilities || '[]')) registeredTypes.add(cap);
          // Also add aliases from manifests
          const manifests = JSON.parse(n.manifests || '{}');
          for (const m of Object.values(manifests)) {
            if (m.aliases) for (const a of m.aliases) registeredTypes.add(a);
          }
        }
      } catch {}
      if (!data.type || !registeredTypes.has(data.type)) {
        return json(res, { error: `Unknown job type '${data.type}'. Known types: ${[...registeredTypes].sort().join(', ')}`, valid_types: [...registeredTypes].sort() }, 400);
      }
      if (!data.payload || typeof data.payload !== 'object') {
        const examples = {
          ping: { type: 'ping', payload: { target: 'test' } },
          transcribe: { type: 'transcribe', payload: { url: 'https://example.com/audio.wav' }, requirements: { capability: 'whisper' } },
          ocr: { type: 'ocr', payload: { url: 'https://example.com/image.png' }, requirements: { capability: 'tesseract' }, note: 'Must be an image file (PNG/JPG/TIFF/BMP)' },
          ffmpeg: { type: 'ffmpeg', payload: { url: 'https://example.com/video.mp4' }, requirements: { capability: 'ffmpeg' } }
        };
        return json(res, { 
          error: 'Job payload must be an object', 
          detail: 'Provide job-specific parameters in the payload field',
          example: examples[data.type] || { type: data.type, payload: { url: 'https://example.com/file' } }
        }, 400);
      }
      
      // SECURITY: Rate limit job submissions (30/min per IP)
      if (!global._jobRateLimit) global._jobRateLimit = {};
      const jobNow = Date.now();
      const jobHistory = (global._jobRateLimit[clientIp] || []).filter(t => jobNow - t < 60000);
      if (jobHistory.length >= 30) {
        return json(res, { error: 'Job submission rate limit exceeded (30/min). Please wait.' }, 429);
      }
      global._jobRateLimit[clientIp] = [...jobHistory, jobNow];
      
      // SECURITY: Validate URLs in payload — block SSRF, file://, and dangerous protocols
      if (data.payload?.url) {
        try {
          const jobUrl = new URL(data.payload.url);
          // Block non-HTTP protocols
          if (!['http:', 'https:'].includes(jobUrl.protocol)) {
            return json(res, { error: `URL protocol '${jobUrl.protocol}' not allowed. Use http: or https:`, detail: 'Only HTTP(S) URLs are accepted' }, 400);
          }
          const h = jobUrl.hostname;
          const blocked = [/^localhost$/i, /^127\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^169\.254\./, /^0\./, /^::1$/, /^fc00/i, /^fe80/i, /metadata/i];
          if (blocked.some(p => p.test(h))) {
            return json(res, { error: 'URL blocked: internal/private addresses not allowed', detail: 'Job URLs must point to publicly accessible resources' }, 400);
          }
        } catch { /* non-URL payloads are fine */ }
      }
      
      // Capability-specific payload validation
      const cap = data.requirements?.capability;
      if (cap === 'tesseract' || data.type === 'ocr') {
        if (data.payload.url) {
          const ext = data.payload.url.split('?')[0].split('.').pop().toLowerCase();
          if (!['png', 'jpg', 'jpeg', 'tiff', 'tif', 'bmp', 'webp', 'gif'].includes(ext)) {
            return json(res, {
              error: `OCR requires an image file, got .${ext}`,
              detail: 'Tesseract accepts: PNG, JPG, TIFF, BMP, WebP, GIF',
              suggestion: 'Upload an image file and use the returned URL in payload.url'
            }, 400);
          }
        }
      }
      
      // SECURITY: Validate price_ints in payload to prevent payment manipulation
      if (data.payload && typeof data.payload.price_ints !== 'undefined') {
        const priceInts = parseInt(data.payload.price_ints);
        const MAX_PRICE_INTS = 100000000; // $1000 max (100M ints = $1000 at 0.01/int)
        
        if (isNaN(priceInts) || priceInts < 0) {
          return json(res, { 
            error: 'Invalid price_ints value',
            detail: 'price_ints must be a positive integer',
            value: data.payload.price_ints
          }, 400);
        }
        
        if (priceInts > MAX_PRICE_INTS) {
          return json(res, { 
            error: 'Price too high',
            detail: `Maximum price is ${MAX_PRICE_INTS} ints ($${MAX_PRICE_INTS/100})`,
            value: priceInts,
            max: MAX_PRICE_INTS
          }, 400);
        }
      }
      
      // Sanitize payload — strip dangerous characters from string values
      const sanitizeObj = (obj) => {
        if (typeof obj === 'string') return obj.replace(/<script/gi, '&lt;script').replace(/javascript:/gi, '');
        if (Array.isArray(obj)) return obj.map(sanitizeObj);
        if (obj && typeof obj === 'object') {
          const clean = {};
          for (const [k, v] of Object.entries(obj)) clean[k] = sanitizeObj(v);
          return clean;
        }
        return obj;
      };
      data.payload = sanitizeObj(data.payload);
      
      const job = submitJob(data);
      return json(res, { ok: true, job });
    }
    
    if (method === 'GET' && pathname.match(/^\/jobs\/[a-f0-9]+$/) && !pathname.includes('/available')) {
      const jobId = pathname.split('/')[2];
      const row = stmts.getJob.get(jobId);
      if (!row) return json(res, { error: 'Job not found', detail: `No job exists with ID '${jobId}'`, suggestion: 'Check the job ID or submit a new job' }, 404);
      return json(res, { job: jobToJSON(row) });
    }
    
    if (method === 'GET' && pathname === '/jobs/available') {
      const nodeId = url.searchParams.get('nodeId') || req.headers['x-node-id'];
      const jobs = getAvailableJobs(nodeId);
      return json(res, { jobs, count: jobs.length });
    }
    
    if (method === 'POST' && pathname.match(/^\/jobs\/[a-f0-9]+\/claim$/)) {
      const jobId = pathname.split('/')[2];
      const data = await parseBody(req);
      const job = claimJob(jobId, data.nodeId);
      if (!job) return json(res, { error: 'Job not available for claiming', detail: 'Job may be already claimed, completed, or not exist', suggestion: 'Check job status with GET /jobs/{id}' }, 409);
      return json(res, { ok: true, job });
    }
    
    // Progress update from node (HTTP polling clients)
    if (method === 'POST' && pathname.match(/^\/jobs\/[a-f0-9]+\/progress$/)) {
      const jobId = pathname.split('/')[2];
      const data = await parseBody(req);
      try {
        const progData = { ...(data.progress || data), _updated: Date.now() };
        db.prepare('UPDATE jobs SET progress = ? WHERE jobId = ?').run(JSON.stringify(progData), jobId);
      } catch(e) {}
      broadcastEvent('job.progress', { jobId, progress: data.progress || data, nodeId: data.nodeId });
      return json(res, { ok: true });
    }

    if (method === 'POST' && pathname.match(/^\/jobs\/[a-f0-9]+\/complete$/)) {
      const jobId = pathname.split('/')[2];
      const data = await parseBody(req);
      const job = completeJob(jobId, data.nodeId, data);
      if (!job) return json(res, { error: 'Job access denied', detail: 'You can only fail jobs that your node claimed', suggestion: 'Check job ownership or claim status' }, 403);
      return json(res, { ok: true, job });
    }
    
    // ---- Job Failure ----
    if (method === 'POST' && pathname.match(/^\/jobs\/[a-f0-9]+\/fail$/)) {
      const jobId = pathname.split('/')[2];
      const data = await parseBody(req);
      const job = stmts.getJob.get(jobId);
      if (!job) return json(res, { error: 'Job not found for failure reporting', detail: `No job exists with ID '${jobId}'`, suggestion: 'Verify the job ID is correct' }, 404);
      if (data.nodeId && job.claimedBy !== data.nodeId) return json(res, { error: 'Job ownership mismatch', detail: `Job ${jobId} is not claimed by node ${data.nodeId}`, current_owner: job.claimedBy }, 403);
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

    // ---- Earnings by email (aggregate across all nodes) ----
    if (method === 'GET' && pathname === '/earnings') {
      const email = url.searchParams.get('email');
      if (!email) return json(res, { error: 'Email parameter required', detail: 'Include email in request body for Stripe Connect onboarding', example: { email: 'node@example.com' } }, 400);
      const nodes = db.prepare('SELECT nodeId, name FROM nodes WHERE payout_email = ?').all(email.toLowerCase().trim());
      let totalEarned = 0, totalCashedOut = 0, totalJobs = 0;
      const nodeEarnings = [];
      for (const n of nodes) {
        const entry = stmts.getPayout.get(n.nodeId) || { earned_ints: 0, cashed_out_ints: 0, jobs_paid: 0 };
        totalEarned += entry.earned_ints;
        totalCashedOut += entry.cashed_out_ints || 0;
        totalJobs += entry.jobs_paid || 0;
        if (entry.earned_ints > 0) {
          nodeEarnings.push({ nodeId: n.nodeId, name: n.name, earned_ints: entry.earned_ints, cashed_out_ints: entry.cashed_out_ints || 0, jobs_paid: entry.jobs_paid || 0 });
        }
      }
      const available = totalEarned - totalCashedOut;
      return json(res, {
        email,
        total_earned_ints: totalEarned,
        total_cashed_out_ints: totalCashedOut,
        available_ints: available,
        available_usd: (available * 0.0008).toFixed(2),
        earned_usd: (totalEarned * 0.0008).toFixed(2),
        total_jobs: totalJobs,
        nodes: nodeEarnings
      });
    }

    // ---- Founding Operator Status ----
    if (method === 'GET' && pathname.match(/^\/founding-status\/([a-f0-9]+)$/)) {
      const nodeId = pathname.split('/')[2];
      
      try {
        const foundingInfo = db.prepare(`
          SELECT slot_number as joinOrder, benefits, joined_at as registeredAt
          FROM founding_operators 
          WHERE nodeId = ? AND status = 'active'
        `).get(nodeId);
        
        const totalFounding = db.prepare(`
          SELECT COUNT(*) as count 
          FROM founding_operators 
          WHERE status = 'active'
        `).get().count;
        
        const maxFounding = 50;
        
        if (foundingInfo) {
          return json(res, {
            isFounding: true,
            joinOrder: foundingInfo.joinOrder,
            earningMultiplier: JSON.parse(foundingInfo.benefits || '{"multiplier": 2.0}').multiplier,
            totalFounding,
            maxFounding,
            spotsRemaining: maxFounding - totalFounding,
            registeredAt: foundingInfo.registeredAt
          });
        } else {
          return json(res, {
            isFounding: false,
            joinOrder: null,
            earningMultiplier: 1.0,
            totalFounding,
            maxFounding,
            spotsRemaining: maxFounding - totalFounding,
            eligibleForFounding: totalFounding < maxFounding
          });
        }
      } catch (err) {
        logError('founding-status-lookup', err, { nodeId });
        return json(res, { error: 'Database error' }, 500);
      }
    }

    // ---- Node onboarding (Stripe Connect) ----
    if (method === 'POST' && pathname === '/nodes/onboard') {
      const data = await parseBody(req);
      const { nodeId, email, country } = data;
      if (!nodeId || !email) return json(res, { error: 'Node onboarding requires nodeId and email', detail: 'Both fields are mandatory for Stripe Connect setup', example: { nodeId: 'node-123', email: 'operator@example.com' } }, 400);
      
      const node = stmts.getNode.get(nodeId);
      if (!node) return json(res, { error: 'Node not found', detail: 'Node must be registered before Stripe onboarding', suggestion: 'Use POST /nodes/register to register your node first' }, 404);
      
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
        logger.nodeEvent(nodeId.slice(0, 8), 'Stripe Connect success', {
          nodeName: node.name,
          stripeAccountId: result.stripe_account_id,
          email: email,
          country: country || 'US'
        });
        return json(res, { ok: true, ...result });
      } catch (e) {
        logger.info(`Stripe Connect error: ${nodeId.slice(0, 8)}`, {
          error: e.message,
          email: email,
          country: country || 'US'
        });
        return json(res, { error: 'Stripe onboarding failed: ' + e.message }, 500);
      }
    }

    // ---- Link existing Stripe account to another node (multi-node operators) ----
    if (method === 'POST' && pathname === '/nodes/link-stripe') {
      const data = await parseBody(req);
      const { nodeId, sourceNodeId } = data;
      if (!nodeId || !sourceNodeId) return json(res, { error: 'Missing required parameters', detail: 'Both nodeId and sourceNodeId are required for cashout requests', example: { nodeId: 'abc123', sourceNodeId: 'def456' } }, 400);
      const target = stmts.getNode.get(nodeId);
      const source = stmts.getNode.get(sourceNodeId);
      if (!target) return json(res, { error: 'Target node not found' }, 404);
      if (!source) return json(res, { error: 'Source node not found' }, 404);
      if (!source.stripe_account_id) return json(res, { error: 'Source node has no Stripe account' }, 400);
      // Verify same owner
      if (source.owner !== target.owner) return json(res, { error: 'Nodes must have the same owner' }, 403);
      db.prepare('UPDATE nodes SET stripe_account_id = ?, payout_email = ? WHERE nodeId = ?')
        .run(source.stripe_account_id, source.payout_email || '', nodeId);
      logger.nodeEvent(nodeId.slice(0, 8), 'Stripe account linked', {
        targetNode: target.name,
        sourceNode: source.name,
        sourceNodeId: sourceNodeId.slice(0, 8),
        stripeAccountId: source.stripe_account_id
      });
      return json(res, { ok: true, nodeId, linked_from: sourceNodeId, stripe_account_id: source.stripe_account_id });
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

      if (!nodeId) return json(res, { 
        error: 'nodeId required', 
        detail: 'Include your node identifier to request cashout',
        example: { nodeId: 'your-node-id', amount_ints: 1000 },
        help: 'Find your nodeId in the operator dashboard at /operate/:nodeId'
      }, 400);

      const entry = stmts.getPayout.get(nodeId);
      if (!entry) return json(res, { 
        error: 'No earnings found for this node', 
        detail: `Node ${nodeId} has not completed any paid jobs yet`,
        suggestion: 'Complete some jobs first to earn payouts',
        help: 'Check your node connection and available jobs at /jobs/available'
      }, 404);

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
            logger.nodeEvent(nodeId.slice(0, 8), 'Stripe transfer completed', {
              amount: requestedInts,
              amountUsd: amountUsd,
              transferId: transferResult.transfer_id,
              stripeAccountId: node.stripe_account_id
            });
          }
        } catch (e) {
          logger.warn('Stripe transfer failed', { error: e.message, nodeId, amount_usd: amountUsd });
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

      logger.info('Cashout processed', { 
        nodeId: nodeId.slice(0,8), 
        amount_ints: requestedInts, 
        amount_usd: amountUsd, 
        payout_method: payoutMethod 
      });

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
      if (req.headers['x-admin-key'] !== (process.env.ADMIN_KEY)) {
        return json(res, { error: 'Admin authorization required for cashout processing', detail: 'Valid X-Admin-Key header required', help: 'Contact system administrator for access credentials' }, 401);
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
    // ---- Machine Onboarding API (Protocol v2) ----
    // One endpoint, everything an agent needs to connect a node
    if (method === 'GET' && pathname === '/api/onboard') {
      const urlMod = require('url');
      const query = urlMod.parse(req.url, true).query;
      const capabilities = (query.capabilities || '').split(',').filter(Boolean);
      
      const activeNodes = getActiveNodes();
      const activeCount = Object.keys(activeNodes).length;
      
      // Build config template
      const hubUrl = process.env.IC_MESH_PUBLIC_URL || `https://moilol.com/mesh`;
      
      const configTemplate = {
        meshServer: hubUrl,
        nodeName: '${HOSTNAME}',
        nodeOwner: '${YOUR_NAME}',
        nodeRegion: 'unknown',
        limits: { maxCpuPercent: 80, maxRamPercent: 70, maxConcurrentJobs: 3 },
        handlers: {},
        schedule: { enabled: false }
      };

      const envVars = {
        IC_MESH_SERVER: hubUrl,
        IC_NODE_NAME: '${HOSTNAME}',
        IC_NODE_OWNER: '${YOUR_NAME}',
        IC_NODE_REGION: 'unknown'
      };

      // Handler YAML URLs for requested capabilities
      const handlerUrls = {};
      const knownHandlers = ['whisper', 'ollama', 'stable-diffusion', 'comfyui', 'tesseract'];
      const requestedCaps = capabilities.length > 0 ? capabilities : knownHandlers;
      for (const cap of requestedCaps) {
        if (knownHandlers.includes(cap)) {
          handlerUrls[cap] = `https://raw.githubusercontent.com/intelligence-club/ic-mesh/main/handlers/${cap}.yaml`;
        }
      }

      // Reference benchmark files
      const benchmarkFiles = {
        whisper: `${hubUrl}/files/benchmark-whisper-5sec.wav`
      };

      // Quick-start commands
      const quickstart = {
        install: [
          'git clone https://github.com/intelligence-club/ic-mesh.git',
          'cd ic-mesh && npm install --production'
        ],
        check: 'node client.js --check',
        start: `IC_MESH_SERVER=${hubUrl} IC_NODE_NAME=$(hostname) IC_NODE_OWNER=YOUR_NAME node client.js`,
        start_background: `IC_MESH_SERVER=${hubUrl} IC_NODE_NAME=$(hostname) IC_NODE_OWNER=YOUR_NAME nohup node client.js > mesh-node.log 2>&1 &`
      };

      // API reference for clients (job submission)
      const clientApi = {
        submit_job: {
          method: 'POST',
          url: `${hubUrl}/jobs`,
          headers: { 'Content-Type': 'application/json' },
          body: {
            type: 'transcribe',
            payload: { url: 'https://example.com/audio.wav' },
            requirements: { capability: 'whisper' }
          },
          note: 'Returns { ok: true, job: { jobId, status } }',
          examples: {
            ping: { type: 'ping', payload: { target: 'test' }, requirements: {} },
            ocr: { type: 'ocr', payload: { url: 'https://example.com/image.png' }, requirements: { capability: 'tesseract' }, note: 'Input MUST be an image (PNG/JPG/TIFF/BMP), not text' },
            transcribe: { type: 'transcribe', payload: { url: 'https://example.com/audio.wav' }, requirements: { capability: 'whisper' } },
            ffmpeg: { type: 'ffmpeg', payload: { url: 'https://example.com/video.mp4' }, requirements: { capability: 'ffmpeg' }, note: 'Returns ffprobe JSON info. For conversion, add payload.command' }
          }
        },
        check_job: {
          method: 'GET',
          url: `${hubUrl}/jobs/{jobId}`,
          note: 'Poll until status is "completed" or "failed"'
        },
        upload_file: {
          method: 'POST',
          url: `${hubUrl}/upload`,
          content_type: 'multipart/form-data',
          note: 'Returns { ok: true, url, filename, size }'
        },
        estimate: {
          method: 'POST',
          url: `${hubUrl}/estimate`,
          body: { capability: 'whisper', duration_seconds: 60 },
          note: 'Returns per-node estimates with confidence levels'
        },
        nodes: {
          method: 'GET',
          url: `${hubUrl}/nodes`,
          note: 'List all active nodes and their capabilities'
        },
        benchmarks: {
          method: 'GET',
          url: `${hubUrl}/benchmarks/{nodeId}`,
          note: 'Benchmark data for a specific node'
        }
      };

      return json(res, {
        protocol: 'IC Mesh Protocol v2.0',
        hub: hubUrl,
        setup: {
          description: 'Fastest path from zero to running node',
          one_liner: `git clone https://github.com/intelligence-club/ic-mesh.git && cd ic-mesh && npm install --production && node client.js --setup ${hubUrl}`,
          steps: [
            `git clone https://github.com/intelligence-club/ic-mesh.git`,
            `cd ic-mesh && npm install --production`,
            `node client.js --setup ${hubUrl}`,
            `node client.js --check`,
            `node client.js --self-test`,
            `node client.js`
          ]
        },
        auth: {
          provider: {
            method: 'none (open registration)',
            description: 'Nodes register by calling POST /nodes/register. No API key needed. Node receives a unique nodeId on first registration, persisted to .node-id file.',
            trust_model: 'Reputation-based. New nodes can claim jobs immediately. Failed jobs reduce reputation score.'
          },
          client: {
            method: 'API key (for paid jobs)',
            description: 'Free jobs (ping, test) need no auth. Paid jobs require an API key + ints balance.',
            flow: [
              '1. POST /api/keys { email } → returns api_key',
              '2. POST /api/buy-credits { email, pack: "5000" } → Stripe checkout → ints credited',
              '3. POST /api/transcribe (with X-API-Key header) → job submitted, ints deducted'
            ],
            note: 'API keys and ints are managed by the payment server (moilol.com), not the mesh hub. The mesh hub handles job dispatch; the payment server handles billing.'
          }
        },
        network_status: {
          nodes_active: activeCount,
          capabilities: [...new Set(Object.values(activeNodes).flatMap(n => n.capabilities))].filter(c => !['ping', 'ffmpeg', 'TEST_MODE'].includes(c)).sort(),
          all_capabilities: [...new Set(Object.values(activeNodes).flatMap(n => n.capabilities))].sort(),
          accepting_jobs: true
        },
        routing: {
          strategy: 'race-to-claim',
          description: 'Nodes poll for jobs matching their capabilities. First valid claim wins.',
          debug_endpoint: `${hubUrl}/routing`,
          factors: ['capability match', 'affinity key (30min TTL)', 'poll timing']
        },
        provider: {
          description: 'Connect your hardware as a compute node',
          quickstart,
          config_template: configTemplate,
          env_vars: envVars,
          handler_yamls: handlerUrls,
          benchmark_files: benchmarkFiles,
          min_node_version: '16',
          required_packages: ['ws', 'better-sqlite3', 'yaml'],
          optional_packages: { 'node-fetch': '2.x (only needed for Node < 18)' },
          revenue_split: '80% operator / 15% treasury / 5% infrastructure',
          docs: 'https://github.com/intelligence-club/ic-mesh/blob/main/PROTOCOL.md'
        },
        client: {
          description: 'Submit jobs to the mesh network',
          api: clientApi,
          pricing: {
            unit: 'ints (1 int ≈ 1 second of compute)',
            buy_rate: '$0.001 per int',
            sell_rate: '$0.0008 per int (operator payout)',
            example: '60 seconds of transcription ≈ 60 ints ≈ $0.06'
          },
          credits: {
            get_api_key: { method: 'POST', url: 'https://moilol.com/api/keys', body: { email: 'you@example.com' } },
            buy_credits: { method: 'POST', url: 'https://moilol.com/api/buy-credits', body: { email: 'you@example.com', pack: '5000' } },
            check_balance: { method: 'GET', url: 'https://moilol.com/api/balance?email=you@example.com' }
          }
        },
        spec: 'https://github.com/intelligence-club/ic-mesh/blob/main/PROTOCOL.md',
        source: 'https://github.com/intelligence-club/ic-mesh'
      });
    }

    if (method === 'GET' && pathname === '/status') {
      const active = getActiveNodes();
      const activeCount = Object.keys(active).length;
      const allNodes = stmts.getAllNodes.all();
      const jobCounts = {};
      for (const row of stmts.countJobs.all()) jobCounts[row.status] = row.count;
      
      const treasury = stmts.getLedger.get('ic-treasury') || { earned: 0 };
      
      const allCaps = new Set();
      const allModels = new Set();
      const modelsByService = {};
      let totalRAM = 0, totalCores = 0;
      for (const node of Object.values(active)) {
        (node.capabilities || []).forEach(c => allCaps.add(c));
        const nodeModels = node.models || [];
        if (Array.isArray(nodeModels)) {
          nodeModels.forEach(m => allModels.add(m));
        } else if (typeof nodeModels === 'object') {
          for (const [svc, mList] of Object.entries(nodeModels)) {
            if (Array.isArray(mList)) {
              if (!modelsByService[svc]) modelsByService[svc] = new Set();
              mList.forEach(m => { allModels.add(`${svc}:${m}`); modelsByService[svc].add(m); });
            }
          }
        }
        totalRAM += node.resources?.ramMB || 0;
        totalCores += node.resources?.cpuCores || 0;
      }
      // Convert sets to arrays
      for (const k of Object.keys(modelsByService)) modelsByService[k] = [...modelsByService[k]];
      
      return json(res, {
        network: 'Intelligence Club Mesh',
        version: '0.3.0',
        status: activeCount > 0 ? 'online' : 'no nodes',
        nodes: { active: activeCount, total: allNodes.length },
        compute: {
          totalCores, totalRAM_GB: Math.round(totalRAM / 1024 * 10) / 10,
          capabilities: [...allCaps], models: [...allModels], modelsByService
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
        uptime: Math.round(process.uptime()),
        routing: {
          strategy: 'race-to-claim',
          description: 'Nodes poll for available jobs and claim them. First valid claim wins.',
          factors: ['capability match', 'affinity (session locality)', 'creation order (oldest first)']
        }
      });
    }

    // Job routing visibility — explains why jobs go where they go
    if (method === 'GET' && pathname === '/routing') {
      const active = getActiveNodes();
      const recentJobs = db.prepare(`
        SELECT j.jobId, j.type, j.status, j.claimedBy, j.createdAt, j.completedAt,
          (SELECT name FROM nodes WHERE nodeId = j.claimedBy) as node_name
        FROM jobs j ORDER BY j.createdAt DESC LIMIT 20
      `).all();

      // Success rates per node (last 100 jobs)
      const nodeStats = db.prepare(`
        SELECT claimedBy as nodeId,
          (SELECT name FROM nodes WHERE nodeId = jobs.claimedBy) as name,
          COUNT(*) as total,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
          ROUND(AVG(CASE WHEN computeMs > 0 THEN computeMs END)) as avg_compute_ms
        FROM jobs WHERE claimedBy IS NOT NULL
        GROUP BY claimedBy ORDER BY total DESC
      `).all();

      return json(res, {
        strategy: {
          type: 'race-to-claim',
          description: 'Nodes poll GET /jobs/available every 10s. Hub returns jobs matching node capabilities. First POST /jobs/{id}/claim wins.',
          factors: [
            'Capability match — node must have required capability',
            'Affinity — jobs with affinity_key prefer previously-used nodes (30min TTL)',
            'Poll timing — nodes with lower latency to hub claim faster',
            'Capacity — hub filters by CPU/RAM thresholds'
          ],
          why_one_node_gets_everything: 'If one node polls faster (e.g., localhost or lower latency), it wins the race. This is by design — first capable node wins. Future: hub-side dispatch with load balancing.'
        },
        node_stats: nodeStats.map(n => ({
          nodeId: n.nodeId?.slice(0, 12) + '...',
          name: n.name,
          jobs_total: n.total,
          jobs_completed: n.completed,
          jobs_failed: n.failed,
          success_rate: n.total > 0 ? Math.round(n.completed / n.total * 100) + '%' : 'n/a',
          avg_compute_ms: n.avg_compute_ms
        })),
        recent_jobs: recentJobs.map(j => ({
          jobId: j.jobId?.slice(0, 12) + '...',
          type: j.type,
          status: j.status,
          claimed_by: j.node_name || j.claimedBy?.slice(0, 12),
          age_seconds: Math.round((Date.now() - j.createdAt) / 1000)
        })),
        active_nodes: Object.entries(active).map(([id, n]) => ({
          nodeId: id.slice(0, 12) + '...',
          name: n.name,
          capabilities: (n.capabilities || []).filter(c => !['ping', 'ffmpeg'].includes(c)),
          poll_mode: n.wsConnected ? 'websocket' : 'http'
        }))
      });
    }
    
    // ---- Support Ticket System ----
    if (method === 'POST' && pathname === '/support') {
      const data = await parseBody(req);
      const { email, subject, body, category, priority, api_key, job_id } = data;
      
      // Validate required fields
      if (!email || !subject || !body) {
        return json(res, { error: 'Support ticket requires email, subject, and body', detail: 'All three fields are mandatory for ticket creation', example: { email: 'user@example.com', subject: 'API Issue', body: 'Description of the problem' } }, 400);
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
        return json(res, { error: 'Ticket creation requires email, subject, and body', detail: 'All three fields must be provided', example: { email: 'user@example.com', subject: 'Billing Question', body: 'I need help with my account balance' } }, 400);
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

    // ---- API Key Creation ----
    if (method === 'POST' && (pathname === '/api/create_api_key' || pathname === '/auth/create-api-key')) {
      try {
        // Generate API key: ic_ prefix + 64 hex characters
        const keyBytes = crypto.randomBytes(32);
        const api_key = 'ic_' + keyBytes.toString('hex');
        const created = new Date().toISOString();
        
        return json(res, {
          api_key: api_key,
          created: created,
          note: 'Store this API key securely. It will not be shown again.',
          usage: 'Include in X-Api-Key header or Authorization: Bearer <key>',
          expires: 'Never (until manually revoked)'
        });
      } catch (error) {
        console.error('Failed to create API key:', error);
        return json(res, { error: 'Failed to create API key' }, 500);
      }
    }

    // ---- List tickets (admin only) ----
    if (method === 'GET' && pathname === '/api/tickets') {
      const providedKey = req.headers['x-admin-key'];
      const expectedKey = process.env.ADMIN_KEY;
      
      if (!expectedKey) {
        return json(res, { error: 'Admin key not configured', detail: 'Server misconfiguration', help: 'Contact system administrator' }, 500);
      }
      
      if (!providedKey || providedKey !== expectedKey) {
        return json(res, { error: 'Admin authorization required for ticket access', detail: 'Valid X-Admin-Key header required', help: 'Contact system administrator for access credentials' }, 401);
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
        return json(res, { error: 'Message requires sender and body', detail: 'Both fields needed to add a message to the ticket', example: { sender: 'user@example.com', body: 'Thank you for the help!' } }, 400);
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
        return json(res, { error: 'Node ID required for payout computation', detail: 'Specify nodeId parameter to calculate earnings', example: { nodeId: 'node-123' } }, 400);
      }
      
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(getOperatorDashboardHTML(nodeId));
    }
    
    // ---- Main Dashboard ----
    if (method === 'GET' && pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(getDashboardHTML());
    }
    
    json(res, { 
      error: 'API endpoint not found', 
      code: 'ROUTE_NOT_FOUND', 
      requested: `${method} ${pathname}`,
      available_endpoints: {
        jobs: 'POST /jobs, GET /jobs/{id}, GET /jobs/available',
        nodes: 'POST /nodes/register, GET /nodes',
        files: 'POST /upload, GET /files/{filename}',
        admin: 'GET /status, GET /health',
        websocket: 'ws://host:port/ws?nodeId=your-id'
      },
      documentation: 'https://github.com/intelligence-club/ic-mesh#api-reference'
    }, 404);
    
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

// Reap stale claimed jobs every 30s (no zombies)
// Layer 1: Hard timeout per job type
// Layer 2: If no progress update in 120s, assume dead
// Layer 3: Max retries — fail permanently after too many attempts
const JOB_CLAIM_TTL = { ping: 30000, inference: 300000, transcribe: 600000, 'generate-image': 600000, generate: 600000, default: 300000 };
const PROGRESS_SILENCE_TTL = 120000; // 2 minutes without progress = dead
const MAX_RETRIES = 3; // After 3 failed claims, mark job as failed

function requeueOrFail(job, reason) {
  const retries = (job.retryCount || 0) + 1;
  if (retries >= MAX_RETRIES) {
    console.log(`◉ Reaper: job ${job.jobId.slice(0,8)} (${job.type}) PERMANENTLY FAILED after ${retries} retries — ${reason}`);
    db.prepare("UPDATE jobs SET status = 'failed', error_message = ?, retryCount = ? WHERE jobId = ?")
      .run(`Failed after ${retries} attempts: ${reason}`, retries, job.jobId);
  } else {
    console.log(`◉ Reaper: job ${job.jobId.slice(0,8)} (${job.type}) ${reason} — requeuing (retry ${retries}/${MAX_RETRIES})`);
    db.prepare("UPDATE jobs SET status = 'pending', claimedBy = NULL, claimedAt = NULL, progress = NULL, retryCount = ? WHERE jobId = ?")
      .run(retries, job.jobId);
  }
}

setInterval(() => {
  const claimed = stmts.getClaimedStale.all(Date.now() - 60000); // check anything claimed > 60s ago
  for (const job of claimed) {
    const ttl = JOB_CLAIM_TTL[job.type] || JOB_CLAIM_TTL.default;
    const age = Date.now() - job.claimedAt;
    
    // Hard timeout
    if (age > ttl) {
      requeueOrFail(job, `HARD TIMEOUT after ${Math.round(age/1000)}s`);
      continue;
    }
    
    // Progress silence check — if claimed > 2 min ago and never sent progress, reclaim
    if (age > PROGRESS_SILENCE_TTL) {
      const hasProgress = job.progress && job.progress !== 'null';
      if (!hasProgress) {
        requeueOrFail(job, `NO PROGRESS for ${Math.round(age/1000)}s`);
        continue;
      }
      
      // Has progress — check when last updated
      try {
        const prog = JSON.parse(job.progress);
        if (prog._updated && Date.now() - prog._updated > PROGRESS_SILENCE_TTL) {
          requeueOrFail(job, `STALE PROGRESS for ${Math.round((Date.now() - prog._updated)/1000)}s`);
        }
      } catch {}
    }
  }
}, 30000);

// Reap stale PENDING jobs every hour (24h TTL — if no node claims it, it's dead)
const PENDING_JOB_TTL = 24 * 60 * 60 * 1000; // 24 hours
setInterval(() => {
  const cutoff = Date.now() - PENDING_JOB_TTL;
  const stalePending = db.prepare("SELECT jobId, type, createdAt FROM jobs WHERE status = 'pending' AND createdAt < ?").all(cutoff);
  for (const job of stalePending) {
    console.log(`◉ Reaper: pending job ${job.jobId} (${job.type}) expired after 24h unclaimed`);
    stmts.failJob.run(JSON.stringify({ error: 'Expired: no node claimed this job within 24 hours' }), job.jobId);
  }
  if (stalePending.length > 0) console.log(`  🧹 Reaped ${stalePending.length} stale pending jobs`);
}, 3600000);

// Cleanup expired uploads every hour
setInterval(async () => {
  try {
    const deleted = await storage.cleanupExpired();
    if (deleted > 0) console.log(`  🧹 Cleaned up ${deleted} expired uploads`);
  } catch(e) {
    logError('Upload cleanup', e);
  }
}, 3600000);

// Enhanced server startup with error handling and port fallback
async function startServer(port, retries = 3) {
  return new Promise((resolve, reject) => {
    const server_attempt = server.listen(port, '0.0.0.0', () => {
      const nodeCount = stmts.getAllNodes.all().length;
      const jobCount = db.prepare('SELECT COUNT(*) as c FROM jobs').get().c;
      console.log(`◉ IC Mesh server v0.3.0 live on port ${port}`);
      console.log(`  Storage: SQLite (${DB_PATH})`);
      console.log(`  Transport: HTTP + WebSocket`);
      console.log(`  Nodes: ${nodeCount} registered`);
      console.log(`  Jobs: ${jobCount} total`);
      console.log(`  Dashboard: http://localhost:${port}`);
      resolve(port);
    });

    server_attempt.on('error', async (err) => {
      if (err.code === 'EADDRINUSE') {
        logger.warn('Server startup', `Port ${port} is busy, ${retries} retries left`);
        console.log(`⚠️  Port ${port} is in use`);
        
        if (retries > 0) {
          console.log(`   Trying port ${port + 1}...`);
          try {
            const fallback_port = await startServer(port + 1, retries - 1);
            resolve(fallback_port);
          } catch (fallback_err) {
            reject(fallback_err);
          }
        } else {
          console.error(`❌ Unable to find available port after multiple attempts`);
          console.error(`   Try stopping other services or set PORT environment variable`);
          logger.error('Server startup', 'All port attempts failed', { initial_port: PORT, last_attempted: port });
          reject(err);
        }
      } else {
        logger.error('Server startup', err.message, { port, error_code: err.code });
        console.error(`❌ Server failed to start: ${err.message}`);
        reject(err);
      }
    });
  });
}

// Graceful shutdown handling
process.on('SIGINT', () => {
  console.log('\n📋 Shutting down IC Mesh server...');
  logger.info('Server shutdown', 'Graceful shutdown initiated');
  server.close(() => {
    console.log('✅ Server stopped');
    if (wss) wss.close();
    if (db) db.close();
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('\n📋 Received SIGTERM, shutting down...');
  logger.info('Server shutdown', 'SIGTERM received');
  server.close(() => {
    if (wss) wss.close();
    if (db) db.close();
    process.exit(0);
  });
});

// Start server with enhanced error handling
startServer(PORT).catch(err => {
  console.error('Fatal: Server startup failed:', err.message);
  logger.error('Server startup', 'Fatal startup failure', { error: err.message });
  process.exit(1);
});
