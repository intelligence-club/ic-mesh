#!/usr/bin/env node

const Database = require('better-sqlite3');
const db = new Database('./data/mesh.db');

console.log('🔧 Fixing corrupted node timestamps...\n');

// Get all nodes with their current timestamps
const nodes = db.prepare("SELECT nodeId, name, lastSeen FROM nodes ORDER BY lastSeen DESC").all();

const now = Date.now();
const oneWeekAgo = now - (7 * 24 * 60 * 60 * 1000); // 7 days ago
let fixedCount = 0;

console.log('Current state:');
nodes.forEach(node => {
  const date = new Date(node.lastSeen);
  const isValid = node.lastSeen > 1000000000000 && node.lastSeen <= now; // Valid range
  console.log(`  ${node.name} (${node.nodeId.substring(0, 8)}): ${date.toISOString()} ${isValid ? '✅' : '❌'}`);
  
  if (!isValid) {
    // Fix corrupted timestamps - set to one week ago as a reasonable "offline" time
    db.prepare("UPDATE nodes SET lastSeen = ? WHERE nodeId = ?").run(oneWeekAgo, node.nodeId);
    fixedCount++;
  }
});

console.log(`\n✅ Fixed ${fixedCount} corrupted timestamps`);

// Verify the fix
console.log('\nAfter repair:');
const fixedNodes = db.prepare("SELECT nodeId, name, lastSeen FROM nodes ORDER BY lastSeen DESC").all();
fixedNodes.forEach(node => {
  const date = new Date(node.lastSeen);
  console.log(`  ${node.name} (${node.nodeId.substring(0, 8)}): ${date.toISOString()}`);
});

db.close();
console.log('\n🎉 Node timestamp repair complete!');