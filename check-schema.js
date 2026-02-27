#!/usr/bin/env node
const Database = require('better-sqlite3');
const db = new Database('data/mesh.db');

console.log('📊 Database Schema Analysis');
console.log('============================');

// Check nodes table schema
try {
    const nodesInfo = db.prepare("PRAGMA table_info(nodes)").all();
    console.log('\n📱 Nodes table columns:');
    nodesInfo.forEach(col => {
        console.log(`  ${col.name} (${col.type}) - ${col.notnull ? 'NOT NULL' : 'nullable'}`);
    });
    
    // Check actual node data
    const nodeCount = db.prepare("SELECT COUNT(*) as count FROM nodes").get();
    console.log(`\n📊 Total nodes: ${nodeCount.count}`);
    
    if (nodeCount.count > 0) {
        const sampleNodes = db.prepare("SELECT * FROM nodes LIMIT 3").all();
        console.log('\n📱 Sample nodes:');
        sampleNodes.forEach((node, i) => {
            console.log(`  Node ${i + 1}:`, Object.keys(node).map(k => `${k}=${node[k]}`).join(', '));
        });
    }
} catch (error) {
    console.error('Error checking nodes table:', error.message);
}

// Check jobs table schema  
try {
    const jobsInfo = db.prepare("PRAGMA table_info(jobs)").all();
    console.log('\n💼 Jobs table columns:');
    jobsInfo.forEach(col => {
        console.log(`  ${col.name} (${col.type}) - ${col.notnull ? 'NOT NULL' : 'nullable'}`);
    });
    
    const jobCount = db.prepare("SELECT COUNT(*) as count FROM jobs").get();
    console.log(`\n📊 Total jobs: ${jobCount.count}`);
    
} catch (error) {
    console.error('Error checking jobs table:', error.message);
}

db.close();