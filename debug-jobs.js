#!/usr/bin/env node
/**
 * IC Mesh Job Debugging Tool
 * 
 * Analyzes recent jobs to understand test failures
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'mesh.db');

function debugJobs() {
  try {
    const db = new Database(DB_PATH);
    
    // Get recent jobs (last 50)
    const recentJobs = db.prepare(`
      SELECT jobId, type, status, claimedBy, createdAt, claimedAt, completedAt, 
             substr(payload, 1, 100) as payload_excerpt
      FROM jobs 
      ORDER BY createdAt DESC 
      LIMIT 50
    `).all();
    
    console.log('📊 Recent Jobs Analysis:');
    console.log(`Total recent jobs: ${recentJobs.length}`);
    
    // Status breakdown
    const statusCounts = {};
    recentJobs.forEach(job => {
      statusCounts[job.status] = (statusCounts[job.status] || 0) + 1;
    });
    
    console.log('\nStatus breakdown:');
    Object.entries(statusCounts).forEach(([status, count]) => {
      console.log(`  ${status}: ${count}`);
    });
    
    // Test-related jobs
    const testJobs = recentJobs.filter(job => 
      job.payload_excerpt.includes('test.wav') || 
      job.payload_excerpt.includes('example.com')
    );
    
    console.log(`\nTest-related jobs: ${testJobs.length}`);
    
    if (testJobs.length > 0) {
      console.log('\nTest jobs details:');
      testJobs.slice(0, 10).forEach(job => {
        const createdAge = Math.round((Date.now() - job.createdAt) / 1000);
        console.log(`  ${job.jobId.slice(0, 8)}: ${job.status} (${job.type}) - ${createdAge}s ago`);
        if (job.claimedBy) {
          const claimedAge = Math.round((Date.now() - job.claimedAt) / 1000);
          console.log(`    Claimed by ${job.claimedBy.slice(0, 8)} ${claimedAge}s ago`);
        }
      });
    }
    
    // Recent nodes
    const recentNodes = db.prepare(`
      SELECT nodeId, name, capabilities, lastSeen
      FROM nodes 
      WHERE nodeId LIKE '%test%' OR nodeId LIKE '%claiming%' OR nodeId LIKE '%completion%'
      ORDER BY lastSeen DESC
    `).all();
    
    console.log(`\nTest-related nodes: ${recentNodes.length}`);
    if (recentNodes.length > 0) {
      recentNodes.forEach(node => {
        const seenAge = node.lastSeen ? Math.round((Date.now() - node.lastSeen) / 1000) : 'never';
        console.log(`  ${node.nodeId.slice(0, 16)}: ${node.capabilities} - seen ${seenAge}s ago`);
      });
    }
    
    db.close();
    
  } catch (error) {
    console.error('❌ Debug failed:', error.message);
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  debugJobs();
}

module.exports = { debugJobs };