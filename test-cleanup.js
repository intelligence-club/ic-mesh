#!/usr/bin/env node
/**
 * IC Mesh Test Database Cleanup
 * 
 * Cleans test data from database to prevent test conflicts.
 * Run this before running tests to ensure clean state.
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'mesh.db');

function cleanupTestData() {
  try {
    const db = new Database(DB_PATH);
    
    console.log('🧹 Cleaning test data...');
    
    // Delete test nodes (those with test-related nodeIds)
    const testNodesDeleted = db.prepare(`
      DELETE FROM nodes 
      WHERE nodeId LIKE '%test%' 
         OR nodeId LIKE '%claiming-node%' 
         OR nodeId LIKE '%completion-node%' 
         OR nodeId LIKE '%ledger-node%' 
         OR nodeId LIKE '%duplicate-node%'
    `).run();
    
    // Delete test jobs (those with test-related data)
    const testJobsDeleted = db.prepare(`
      DELETE FROM jobs 
      WHERE payload LIKE '%test.wav%' 
         OR payload LIKE '%example.com%'
         OR type = 'invalid-task-type'
         OR requester = 'test-client'
    `).run();
    
    // Delete test ledger entries
    const testLedgerDeleted = db.prepare(`
      DELETE FROM ledger 
      WHERE nodeId LIKE '%test%' 
         OR nodeId LIKE '%claiming-node%' 
         OR nodeId LIKE '%completion-node%' 
         OR nodeId LIKE '%ledger-node%'
    `).run();
    
    // Delete test payouts
    const testPayoutsDeleted = db.prepare(`
      DELETE FROM payouts 
      WHERE nodeId LIKE '%test%' 
         OR nodeId LIKE '%claiming-node%' 
         OR nodeId LIKE '%completion-node%'
    `).run();
    
    // Delete test tickets
    const testTicketsDeleted = db.prepare(`
      DELETE FROM tickets 
      WHERE email LIKE '%test%' 
         OR body LIKE '%test%'
    `).run();
    
    db.close();
    
    console.log(`✅ Cleanup complete:`);
    console.log(`   - Nodes: ${testNodesDeleted.changes}`);
    console.log(`   - Jobs: ${testJobsDeleted.changes}`);
    console.log(`   - Ledger entries: ${testLedgerDeleted.changes}`);
    console.log(`   - Payouts: ${testPayoutsDeleted.changes}`);
    console.log(`   - Tickets: ${testTicketsDeleted.changes}`);
    
    return {
      nodes: testNodesDeleted.changes,
      jobs: testJobsDeleted.changes,
      ledger: testLedgerDeleted.changes,
      payouts: testPayoutsDeleted.changes,
      tickets: testTicketsDeleted.changes
    };
    
  } catch (error) {
    console.error('❌ Cleanup failed:', error.message);
    throw error;
  }
}

// Run cleanup if called directly
if (require.main === module) {
  cleanupTestData();
}

module.exports = { cleanupTestData };