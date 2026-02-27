#!/usr/bin/env node

const Database = require('better-sqlite3');
const db = new Database('./data/mesh.db', { readonly: true });

console.log('🔍 Quick Queue Analysis\n');

// Get current queue status
const pendingJobs = db.prepare("SELECT type, COUNT(*) as count FROM jobs WHERE status = 'pending' GROUP BY type").all();
console.log('📋 Pending Jobs by Type:');
pendingJobs.forEach(job => {
    console.log(`  ${job.type}: ${job.count}`);
});

// Get active nodes with capabilities  
const activeNodes = db.prepare(`
    SELECT nodeId, name, capabilities, lastSeen,
           (julianday('now') - julianday(datetime(lastSeen, 'unixepoch'))) * 24 * 60 as minutes_ago
    FROM nodes 
    WHERE minutes_ago < 5 
    ORDER BY lastSeen DESC
`).all();

console.log('\n🟢 Active Nodes (last 5 min):');
activeNodes.forEach(node => {
    const caps = node.capabilities ? JSON.parse(node.capabilities) : [];
    console.log(`  ${node.name} (${node.nodeId.slice(0,8)}): ${caps.join(', ')}`);
});

// Check quarantine status - using flags column 
const quarantinedNodes = db.prepare("SELECT nodeId, name, flags FROM nodes WHERE flags LIKE '%quarantined%'").all();
if (quarantinedNodes.length > 0) {
    console.log('\n🔒 Quarantined Nodes:');
    quarantinedNodes.forEach(node => {
        console.log(`  ${node.name} (${node.nodeId.slice(0,8)})`);
    });
}

db.close();