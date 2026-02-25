#!/usr/bin/env node
/**
 * Node Retention Monitor - Track node connection patterns
 */

const Database = require('better-sqlite3');
const fs = require('fs');

const db = new Database('mesh.db', { verbose: console.log });

function analyzeNodeRetention() {
    console.log('📊 Node Retention Analysis');
    console.log('==========================');

    // Get all nodes and their activity
    const nodes = db.prepare(`
        SELECT 
            nodeId,
            ip as ipAddress,
            capabilities,
            registeredAt,
            lastHeartbeat,
            CASE 
                WHEN lastHeartbeat > (unixepoch() * 1000 - 300000) THEN 'active'
                ELSE 'offline'
            END as status
        FROM nodes 
        ORDER BY registeredAt DESC
    `).all();

    console.log(`\n📱 Total nodes registered: ${nodes.length}`);
    
    // Count by status
    const statusCounts = {};
    nodes.forEach(node => {
        statusCounts[node.status] = (statusCounts[node.status] || 0) + 1;
    });
    
    console.log('\n📊 Status Distribution:');
    Object.entries(statusCounts).forEach(([status, count]) => {
        console.log(`  ${status}: ${count} nodes`);
    });

    // Analyze session durations
    console.log('\n⏱️  Recent Node Sessions:');
    const recentNodes = nodes.slice(0, 10);
    
    recentNodes.forEach(node => {
        const created = new Date(node.createdAt);
        const lastSeen = new Date(node.lastSeen);
        const sessionMinutes = Math.round((lastSeen - created) / 1000 / 60);
        
        console.log(`  ${node.nodeId.substring(0, 8)}: ${sessionMinutes}m session (${node.status})`);
    });

    // Check for jobs claimed by disconnected nodes
    const abandonedJobs = db.prepare(`
        SELECT 
            j.jobId,
            j.claimedBy,
            j.status,
            j.claimedAt,
            n.status as nodeStatus
        FROM jobs j
        LEFT JOIN nodes n ON j.claimedBy = n.nodeId
        WHERE j.status = 'claimed' AND (n.status != 'active' OR n.status IS NULL)
    `).all();

    if (abandonedJobs.length > 0) {
        console.log(`\n⚠️  Abandoned jobs: ${abandonedJobs.length}`);
        abandonedJobs.forEach(job => {
            console.log(`  Job ${job.jobId.substring(0, 8)} claimed by disconnected node`);
        });
    }

    // Node capability analysis
    const capabilityMap = {};
    nodes.filter(n => n.status === 'active').forEach(node => {
        if (node.capabilities) {
            try {
                const caps = JSON.parse(node.capabilities);
                caps.forEach(cap => {
                    capabilityMap[cap] = (capabilityMap[cap] || 0) + 1;
                });
            } catch (e) {
                // Skip invalid JSON
            }
        }
    });

    if (Object.keys(capabilityMap).length > 0) {
        console.log('\n🔧 Active Node Capabilities:');
        Object.entries(capabilityMap)
            .sort((a, b) => b[1] - a[1])
            .forEach(([cap, count]) => {
                console.log(`  ${cap}: ${count} nodes`);
            });
    }

    console.log('\n✨ Analysis complete');
}

// Run the analysis
try {
    analyzeNodeRetention();
} catch (error) {
    console.error('Error analyzing node retention:', error);
    process.exit(1);
}