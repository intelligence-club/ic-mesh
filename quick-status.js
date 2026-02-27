#!/usr/bin/env node

const Database = require('better-sqlite3');
const db = new Database('data/mesh.db');

console.log('\n📊 MESH STATUS REPORT');
console.log('=====================================');

// Get pending jobs by type
const pendingByType = db.prepare(`
  SELECT handler, COUNT(*) as count 
  FROM jobs 
  WHERE status = 'pending' 
  GROUP BY handler 
  ORDER BY count DESC
`).all();

console.log('\n🔄 PENDING JOBS BY TYPE:');
pendingByType.forEach(row => {
  console.log(`  ${row.handler}: ${row.count} jobs`);
});

// Get active nodes
const activeNodes = db.prepare(`
  SELECT nodeId, name, capabilities, lastSeen,
         datetime(lastSeen/1000, 'unixepoch') as lastSeenHuman
  FROM nodes 
  WHERE datetime(lastSeen/1000, 'unixepoch') > datetime('now', '-5 minutes')
  ORDER BY lastSeen DESC
`).all();

console.log('\n🟢 ACTIVE NODES (last 5 min):');
if (activeNodes.length === 0) {
  console.log('  ❌ NO ACTIVE NODES');
} else {
  activeNodes.forEach(node => {
    console.log(`  ${node.nodeId.slice(0,8)} (${node.name || 'unnamed'}): ${node.capabilities} [${node.lastSeenHuman}]`);
  });
}

// Get all registered nodes
const allNodes = db.prepare(`
  SELECT nodeId, name, capabilities, lastSeen,
         datetime(lastSeen/1000, 'unixepoch') as lastSeenHuman,
         ROUND((julianday('now') - julianday(lastSeen/1000, 'unixepoch')) * 24 * 60) as minutesAgo
  FROM nodes 
  ORDER BY lastSeen DESC
`).all();

console.log('\n📋 ALL REGISTERED NODES:');
allNodes.forEach(node => {
  const status = node.minutesAgo < 5 ? '🟢' : node.minutesAgo < 60 ? '🟡' : '🔴';
  console.log(`  ${status} ${node.nodeId.slice(0,8)} (${node.name || 'unnamed'}): ${node.minutesAgo}min ago [${node.capabilities}]`);
});

// Get capabilities needed for pending jobs
const neededCapabilities = db.prepare(`
  SELECT DISTINCT capability_required as capability
  FROM jobs 
  WHERE status = 'pending' AND capability_required IS NOT NULL
`).all();

console.log('\n🎯 CAPABILITIES NEEDED:');
if (neededCapabilities.length > 0) {
  neededCapabilities.forEach(cap => {
    console.log(`  - ${cap.capability}`);
  });
} else {
  // Check handlers that need specific capabilities
  console.log('  (checking common handler → capability mappings)');
  const handlers = pendingByType.map(p => p.handler);
  if (handlers.includes('transcribe')) console.log('  - transcription (for transcribe jobs)');
  if (handlers.includes('pdf-extract')) console.log('  - tesseract (for pdf-extract jobs)');
  if (handlers.includes('ocr')) console.log('  - tesseract (for ocr jobs)');
}

db.close();