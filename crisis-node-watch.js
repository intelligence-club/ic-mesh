#!/usr/bin/env node

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, 'data/mesh.db'));

let lastNodeCount = 0;
let lastCheck = new Date();

function checkNodeStatus() {
    const now = new Date();
    
    db.get(`
        SELECT COUNT(*) as activeNodes 
        FROM nodes 
        WHERE (julianday('now') - julianday(lastSeen)) * 1440 <= 5
    `, (err, result) => {
        if (err) {
            console.error('Database error:', err);
            return;
        }
        
        const activeNodes = result.activeNodes;
        const timestamp = now.toISOString().slice(11, 19);
        
        if (activeNodes > lastNodeCount) {
            console.log(`\n🟢 ${timestamp} - NODE RECONNECTION DETECTED!`);
            console.log(`   Active nodes: ${lastNodeCount} → ${activeNodes}`);
            
            // Get details of reconnected nodes
            db.all(`
                SELECT nodeId, name, owner, capabilities,
                       ROUND((julianday('now') - julianday(lastSeen)) * 1440, 1) as minutesAgo
                FROM nodes 
                WHERE (julianday('now') - julianday(lastSeen)) * 1440 <= 5
                ORDER BY lastSeen DESC
            `, (err, nodes) => {
                if (!err && nodes.length > 0) {
                    console.log('   Recently active nodes:');
                    nodes.forEach(node => {
                        const capabilities = JSON.parse(node.capabilities || '[]').join(', ');
                        console.log(`   • ${node.nodeId} (${node.name || 'unnamed'}) - ${capabilities} (${node.minutesAgo}m ago)`);
                    });
                }
            });
            
            // Check pending job count  
            db.get(`SELECT COUNT(*) as pending FROM jobs WHERE status = 'pending'`, (err, result) => {
                if (!err) {
                    console.log(`   📋 Pending jobs: ${result.pending}`);
                }
            });
        } else if (activeNodes === 0 && lastNodeCount === 0) {
            // Still in crisis - periodic status
            process.stdout.write(`\r🔴 ${timestamp} - CRISIS CONTINUES: 0 active nodes`);
        } else {
            // Normal monitoring  
            process.stdout.write(`\r🟡 ${timestamp} - Active nodes: ${activeNodes}`);
        }
        
        lastNodeCount = activeNodes;
        lastCheck = now;
    });
}

console.log('🔍 Crisis Node Reconnection Monitor Starting');
console.log('   Monitoring for node reconnections during service outage');
console.log('   Press Ctrl+C to stop\n');

// Check immediately
checkNodeStatus();

// Then check every 15 seconds during crisis
const interval = setInterval(checkNodeStatus, 15000);

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n\n🔍 Crisis monitoring stopped');
    clearInterval(interval);
    db.close();
    process.exit(0);
});