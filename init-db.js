#!/usr/bin/env node

const Database = require('better-sqlite3');

const DB_PATH = './mesh.db';
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

console.log('🔧 Initializing database...');

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
    gpuVRAMFree INTEGER DEFAULT 0,
    loadAvg TEXT DEFAULT '[]',
    lastHeartbeat INTEGER,
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
    error TEXT,
    files TEXT DEFAULT '[]',
    computeMinutes REAL DEFAULT 0,
    priority INTEGER DEFAULT 50,
    progress TEXT
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
    resolution_notes TEXT,
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

console.log('✅ Database initialized successfully');

// Check statistics
const stats = {
  nodes: db.prepare('SELECT COUNT(*) as count FROM nodes').get().count,
  jobs: db.prepare('SELECT COUNT(*) as count FROM jobs').get().count,
  tickets: db.prepare('SELECT COUNT(*) as count FROM tickets').get().count,
  ledger: db.prepare('SELECT COUNT(*) as count FROM ledger').get().count
};

console.log('📊 Database Statistics:');
console.log(`  Nodes: ${stats.nodes}`);
console.log(`  Jobs: ${stats.jobs}`);
console.log(`  Tickets: ${stats.tickets}`);
console.log(`  Ledger entries: ${stats.ledger}`);

db.close();