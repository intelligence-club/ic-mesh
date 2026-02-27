#!/usr/bin/env node
/**
 * Cleanup Corrupted Timestamps - Fix invalid job timestamps
 * 
 * Fixes jobs with corrupted timestamps (far future dates like year 58123)
 * that prevent proper queue processing and monitoring.
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../data/mesh.db');

function run() {
  console.log('🧹 Corrupted Timestamp Cleanup Tool\n');

  const db = new sqlite3.Database(dbPath);

  // Check for corrupted timestamps (anything after year 2030)
  // Valid range: 1640995200000 (2022-01-01) to 1893456000000 (2030-01-01)
  const corruptedThreshold = 1893456000000; // 2030-01-01
  
  db.serialize(() => {
    // Count corrupted jobs
    db.get(`
      SELECT 
        COUNT(*) as total_corrupted,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_corrupted,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_corrupted,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_corrupted
      FROM jobs 
      WHERE createdAt > ?
    `, [corruptedThreshold], (err, row) => {
      if (err) {
        console.error('❌ Error checking corrupted jobs:', err.message);
        process.exit(1);
      }

      console.log('📊 Corrupted Timestamp Analysis:');
      console.log(`   Total corrupted jobs: ${row.total_corrupted}`);
      console.log(`   Pending: ${row.pending_corrupted}`);
      console.log(`   Completed: ${row.completed_corrupted}`);
      console.log(`   Failed: ${row.failed_corrupted}\n`);

      if (row.total_corrupted === 0) {
        console.log('✅ No corrupted timestamps found');
        db.close();
        return;
      }

      // Show sample of corrupted jobs
      db.all(`
        SELECT jobId, type, status, createdAt, datetime(createdAt/1000, 'unixepoch') as date_str
        FROM jobs 
        WHERE createdAt > ?
        LIMIT 5
      `, [corruptedThreshold], (err, rows) => {
        if (err) {
          console.error('❌ Error fetching sample:', err.message);
          process.exit(1);
        }

        console.log('📋 Sample corrupted jobs:');
        rows.forEach(row => {
          console.log(`   ${row.jobId} | ${row.type} | ${row.status} | ${row.date_str}`);
        });
        console.log();

        // Decision: Delete corrupted pending jobs, keep corrupted completed/failed for forensics
        console.log('🧹 Cleanup Strategy:');
        console.log('   - DELETE corrupted pending jobs (unprocessable)');
        console.log('   - KEEP corrupted completed/failed jobs (forensic value)');
        console.log('   - UPDATE job IDs to avoid conflicts\n');

        // Delete corrupted pending jobs
        db.run(`
          DELETE FROM jobs 
          WHERE status = 'pending' AND createdAt > ?
        `, [corruptedThreshold], function(err) {
          if (err) {
            console.error('❌ Error deleting corrupted pending jobs:', err.message);
            process.exit(1);
          }

          console.log(`✅ Deleted ${this.changes} corrupted pending jobs`);

          // Update corrupted completed/failed jobs with forensic markers
          db.run(`
            UPDATE jobs 
            SET jobId = 'CORRUPTED_' || jobId,
                createdAt = ?
            WHERE status != 'pending' AND createdAt > ?
          `, [Date.now(), corruptedThreshold], function(err) {
            if (err) {
              console.error('❌ Error updating corrupted jobs:', err.message);
              process.exit(1);
            }

            console.log(`✅ Updated ${this.changes} corrupted completed/failed jobs with forensic markers`);

            // Final verification
            db.get(`
              SELECT COUNT(*) as remaining_corrupted
              FROM jobs 
              WHERE createdAt > ?
            `, [corruptedThreshold], (err, row) => {
              if (err) {
                console.error('❌ Error in final verification:', err.message);
                process.exit(1);
              }

              console.log(`\n🎯 Cleanup Complete:`);
              console.log(`   - Remaining corrupted timestamps: ${row.remaining_corrupted}`);
              console.log(`   - All corrupted pending jobs removed`);
              console.log(`   - Corrupted completed/failed jobs preserved with markers`);

              db.close();
              console.log('\n✅ Database cleanup successful');
            });
          });
        });
      });
    });
  });
}

if (require.main === module) {
  run();
}

module.exports = { run };