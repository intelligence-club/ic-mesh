#!/usr/bin/env node

/**
 * Test Job Cleanup Utility
 * Removes old test jobs created by health checks and testing
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = './data/mesh.db';

function cleanupTestJobs() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH);
    
    // Clean up test jobs older than 1 hour
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    
    db.run(`
      DELETE FROM jobs 
      WHERE (
        (type = 'transcribe' AND payload LIKE '%test%') OR
        (type = 'transcribe' AND payload LIKE '%timestamp%') OR
        (requester = 'health-check%') OR
        (claimedBy LIKE 'health-check%')
      ) AND createdAt < ?
    `, [oneHourAgo], function(err) {
      if (err) {
        console.error('❌ Error cleaning test jobs:', err);
        reject(err);
        return;
      }
      
      console.log(`🧹 Cleaned up ${this.changes} test jobs`);
      
      // Also clean up test nodes if any
      db.run(`
        DELETE FROM nodes 
        WHERE name LIKE 'Health Check Node%' 
        AND registeredAt < ?
      `, [oneHourAgo], function(err) {
        if (err) {
          console.log('⚠️  Warning: Could not clean test nodes:', err.message);
        } else if (this.changes > 0) {
          console.log(`🧹 Cleaned up ${this.changes} test nodes`);
        }
        
        db.close();
        resolve(this.changes);
      });
    });
  });
}

if (require.main === module) {
  console.log('🧹 Cleaning up old test jobs...');
  cleanupTestJobs()
    .then(() => {
      console.log('✅ Cleanup completed');
    })
    .catch(error => {
      console.error('💥 Cleanup failed:', error);
      process.exit(1);
    });
}

module.exports = { cleanupTestJobs };