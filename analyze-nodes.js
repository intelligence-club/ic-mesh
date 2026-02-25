#!/usr/bin/env node
/**
 * Node retention analysis tool
 * Examines node registration and activity patterns
 */

const Database = require('better-sqlite3');
const path = require('path');

// Use the same path logic as server.js
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_PATH = process.env.DATABASE_PATH || path.join(DATA_DIR, 'mesh.db');

const db = new Database(DB_PATH);

console.log('🔍 IC Mesh Node Retention Analysis\n');

// Get all nodes with relevant data
const nodes = db.prepare(`
  SELECT nodeId, name, owner, registeredAt, lastSeen, jobsCompleted,
         CASE 
           WHEN lastSeen > (strftime('%s', 'now') - 3600) * 1000 THEN 'active'
           WHEN lastSeen > (strftime('%s', 'now') - 86400) * 1000 THEN 'recent' 
           ELSE 'inactive'
         END as activity_status,
         ((lastSeen - registeredAt) / 1000 / 60) as minutes_active
  FROM nodes 
  ORDER BY registeredAt DESC
`).all();

console.log(`📊 Total nodes registered: ${nodes.length}`);
console.log(`📊 Active nodes: ${nodes.filter(n => n.activity_status === 'active').length}`);
console.log(`📊 Recently active: ${nodes.filter(n => n.activity_status === 'recent').length}`);
console.log(`📊 Inactive nodes: ${nodes.filter(n => n.activity_status === 'inactive').length}`);
console.log();

console.log('📋 Node Details:');
nodes.forEach(node => {
  const registered = new Date(node.registeredAt).toISOString().slice(0, 19);
  const lastSeen = new Date(node.lastSeen).toISOString().slice(0, 19);
  const activeMinutes = Math.round(node.minutes_active || 0);
  
  console.log(`${node.activity_status === 'active' ? '🟢' : node.activity_status === 'recent' ? '🟡' : '🔴'} ${node.name || 'unnamed'} (${node.nodeId.slice(0, 8)})`);
  console.log(`   Owner: ${node.owner || 'unknown'}`);
  console.log(`   Registered: ${registered}`);
  console.log(`   Last seen: ${lastSeen}`);
  console.log(`   Jobs completed: ${node.jobsCompleted || 0}`);
  console.log(`   Active duration: ${activeMinutes} minutes`);
  console.log();
});

// Analyze retention patterns
const activeThreshold = Date.now() - (60 * 60 * 1000); // 1 hour ago
const recentThreshold = Date.now() - (24 * 60 * 60 * 1000); // 24 hours ago

const retentionAnalysis = {
  total: nodes.length,
  stillActive: nodes.filter(n => n.lastSeen > activeThreshold).length,
  recentlyActive: nodes.filter(n => n.lastSeen > recentThreshold && n.lastSeen <= activeThreshold).length,
  droppedOut: nodes.filter(n => n.lastSeen <= recentThreshold).length
};

console.log('🎯 Retention Analysis:');
console.log(`   Still active (< 1h): ${retentionAnalysis.stillActive} (${(retentionAnalysis.stillActive/retentionAnalysis.total*100).toFixed(1)}%)`);
console.log(`   Recently active (1h-24h): ${retentionAnalysis.recentlyActive} (${(retentionAnalysis.recentlyActive/retentionAnalysis.total*100).toFixed(1)}%)`);
console.log(`   Dropped out (> 24h): ${retentionAnalysis.droppedOut} (${(retentionAnalysis.droppedOut/retentionAnalysis.total*100).toFixed(1)}%)`);
console.log();

// Average session duration for dropped nodes
const droppedNodes = nodes.filter(n => n.lastSeen <= recentThreshold);
if (droppedNodes.length > 0) {
  const avgSessionDuration = droppedNodes.reduce((sum, n) => sum + (n.minutes_active || 0), 0) / droppedNodes.length;
  console.log(`📉 Dropped nodes average session: ${Math.round(avgSessionDuration)} minutes`);
}

db.close();