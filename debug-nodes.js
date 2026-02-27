#!/usr/bin/env node

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'mesh.db');
const db = new sqlite3.Database(dbPath);

const now = Date.now();
const fiveMinutesAgo = now - (5 * 60 * 1000);

console.log('🔍 Node Debug Analysis');
console.log(`Current time: ${now} (${new Date(now).toISOString()})`);
console.log(`5 minutes ago: ${fiveMinutesAgo} (${new Date(fiveMinutesAgo).toISOString()})`);
console.log('');

db.all("SELECT nodeId, name, capabilities, lastSeen FROM nodes ORDER BY lastSeen DESC", (err, rows) => {
    if (err) {
        console.error('Database error:', err);
        return;
    }
    
    console.log('📋 All nodes:');
    rows.forEach(node => {
        const lastSeenDate = new Date(node.lastSeen);
        const isRecent = node.lastSeen > fiveMinutesAgo;
        const ageSeconds = (now - node.lastSeen) / 1000;
        
        console.log(`  ${node.nodeId.substring(0,8)}: ${node.name || 'unnamed'}`);
        console.log(`    Last seen: ${node.lastSeen} (${lastSeenDate.toISOString()})`);
        console.log(`    Age: ${ageSeconds.toFixed(1)}s ${isRecent ? '✅ RECENT' : '❌ OLD'}`);
        console.log(`    Capabilities: ${node.capabilities}`);
        console.log('');
    });
    
    db.close();
});