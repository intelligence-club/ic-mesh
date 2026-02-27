#!/usr/bin/env node

/**
 * Database Maintenance Utility
 * Performs routine maintenance tasks on the IC Mesh database
 */

const Database = require('better-sqlite3');
const fs = require('fs');

function performMaintenance(options = {}) {
  const db = new Database('./data/mesh.db');
  const timestamp = new Date().toISOString();
  
  console.log(`🔧 IC Mesh Database Maintenance - ${timestamp.split('T')[0]}`);
  console.log('═'.repeat(50));
  
  let maintenanceLog = [];
  
  try {
    // 1. Database integrity check
    console.log(`\n🔍 INTEGRITY CHECK`);
    console.log('─'.repeat(20));
    
    const integrityResult = db.prepare("PRAGMA integrity_check").get();
    if (integrityResult.integrity_check === 'ok') {
      console.log(`✅ Database integrity: OK`);
      maintenanceLog.push(`${timestamp}: Database integrity check passed`);
    } else {
      console.log(`❌ Database integrity: ${integrityResult.integrity_check}`);
      maintenanceLog.push(`${timestamp}: Database integrity issue: ${integrityResult.integrity_check}`);
    }
    
    // 2. Clean old completed jobs (optional, with safety checks)
    if (options.cleanOldJobs) {
      console.log(`\n🧹 CLEANUP OLD JOBS`);
      console.log('─'.repeat(20));
      
      const cutoffDate = Date.now() - (options.retentionDays || 30) * 24 * 60 * 60 * 1000;
      const oldJobs = db.prepare(`
        SELECT COUNT(*) as count 
        FROM jobs 
        WHERE status = 'completed' 
        AND completedAt < ?
      `).get(cutoffDate);
      
      if (oldJobs.count > 0) {
        console.log(`📦 Found ${oldJobs.count} old completed jobs (>${options.retentionDays || 30} days)`);
        
        if (options.dryRun) {
          console.log(`🔍 DRY RUN: Would delete ${oldJobs.count} jobs`);
          maintenanceLog.push(`${timestamp}: DRY RUN - Would clean ${oldJobs.count} old jobs`);
        } else {
          const result = db.prepare(`
            DELETE FROM jobs 
            WHERE status = 'completed' 
            AND completedAt < ?
          `).run(cutoffDate);
          
          console.log(`✅ Cleaned ${result.changes} old completed jobs`);
          maintenanceLog.push(`${timestamp}: Cleaned ${result.changes} old completed jobs`);
        }
      } else {
        console.log(`✨ No old jobs to clean`);
      }
    }
    
    // 3. Reset stuck jobs (claimed by offline nodes)
    console.log(`\n🔄 STUCK JOB RECOVERY`);
    console.log('─'.repeat(20));
    
    const stuckJobs = db.prepare(`
      SELECT j.jobId, j.claimedBy, j.type, 
             n.lastSeen,
             (? - n.lastSeen) / (1000 * 60) as minutesOffline
      FROM jobs j
      JOIN nodes n ON j.claimedBy = n.nodeId
      WHERE j.status = 'claimed' 
      AND n.lastSeen < ?
    `).all(Date.now(), Date.now() - (10 * 60 * 1000)); // 10 minute threshold
    
    if (stuckJobs.length > 0) {
      console.log(`🚨 Found ${stuckJobs.length} jobs stuck with offline nodes:`);
      
      stuckJobs.forEach(job => {
        console.log(`   ${job.jobId}: ${job.type} (node offline ${Math.round(job.minutesOffline)}min)`);
      });
      
      if (options.resetStuckJobs) {
        const resetResult = db.prepare(`
          UPDATE jobs 
          SET status = 'pending', 
              claimedBy = NULL, 
              claimedAt = NULL
          WHERE status = 'claimed' 
          AND claimedBy IN (
            SELECT nodeId FROM nodes 
            WHERE lastSeen < ?
          )
        `).run(Date.now() - (10 * 60 * 1000));
        
        console.log(`✅ Reset ${resetResult.changes} stuck jobs to pending`);
        maintenanceLog.push(`${timestamp}: Reset ${resetResult.changes} stuck jobs`);
      } else {
        console.log(`⚠️  Use --reset-stuck-jobs to fix these`);
      }
    } else {
      console.log(`✅ No stuck jobs found`);
    }
    
    // 4. Database statistics
    console.log(`\n📊 DATABASE STATISTICS`);
    console.log('─'.repeat(20));
    
    const stats = {
      totalJobs: db.prepare("SELECT COUNT(*) as count FROM jobs").get().count,
      pendingJobs: db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'pending'").get().count,
      completedJobs: db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'completed'").get().count,
      failedJobs: db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'failed'").get().count,
      totalNodes: db.prepare("SELECT COUNT(*) as count FROM nodes").get().count,
      activeNodes: db.prepare("SELECT COUNT(*) as count FROM nodes WHERE lastSeen > ?").get(Date.now() - (5 * 60 * 1000)).count
    };
    
    Object.entries(stats).forEach(([key, value]) => {
      const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
      console.log(`📈 ${label}: ${value}`);
    });
    
    // 5. Database size and optimization
    console.log(`\n💾 DATABASE OPTIMIZATION`);
    console.log('─'.repeat(20));
    
    const pageCount = db.prepare("PRAGMA page_count").get().page_count;
    const pageSize = db.prepare("PRAGMA page_size").get().page_size;
    const dbSizeMB = (pageCount * pageSize) / (1024 * 1024);
    
    console.log(`💽 Database size: ${dbSizeMB.toFixed(2)} MB (${pageCount} pages)`);
    
    if (options.vacuum) {
      console.log(`🔧 Running VACUUM to optimize database...`);
      db.prepare("VACUUM").run();
      
      const newPageCount = db.prepare("PRAGMA page_count").get().page_count;
      const newSizeMB = (newPageCount * pageSize) / (1024 * 1024);
      const savedMB = dbSizeMB - newSizeMB;
      
      console.log(`✅ VACUUM complete: ${newSizeMB.toFixed(2)} MB (saved ${savedMB.toFixed(2)} MB)`);
      maintenanceLog.push(`${timestamp}: VACUUM completed, saved ${savedMB.toFixed(2)} MB`);
    }
    
    // 6. Write maintenance log
    if (maintenanceLog.length > 0) {
      const logFile = './maintenance.log';
      const logEntry = maintenanceLog.join('\n') + '\n';
      fs.appendFileSync(logFile, logEntry);
      console.log(`📝 Maintenance logged to ${logFile}`);
    }
    
    console.log(`\n✅ Maintenance complete - ${new Date().toISOString()}`);
    console.log('═'.repeat(50));
    
  } catch (error) {
    console.error(`❌ Maintenance error: ${error.message}`);
    maintenanceLog.push(`${timestamp}: ERROR - ${error.message}`);
  } finally {
    db.close();
  }
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const options = {};
  
  // Parse command line options
  if (args.includes('--clean-old-jobs')) options.cleanOldJobs = true;
  if (args.includes('--reset-stuck-jobs')) options.resetStuckJobs = true;
  if (args.includes('--vacuum')) options.vacuum = true;
  if (args.includes('--dry-run')) options.dryRun = true;
  
  const retentionIndex = args.indexOf('--retention-days');
  if (retentionIndex !== -1 && args[retentionIndex + 1]) {
    options.retentionDays = parseInt(args[retentionIndex + 1]);
  }
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`IC Mesh Database Maintenance Utility
    
Usage: ./database-maintenance.js [options]

Options:
  --clean-old-jobs      Clean completed jobs older than retention period
  --retention-days N    Set retention period (default: 30 days)
  --reset-stuck-jobs    Reset jobs stuck with offline nodes
  --vacuum              Optimize database with VACUUM
  --dry-run             Show what would be done without making changes
  --help, -h            Show this help message

Examples:
  ./database-maintenance.js                          # Basic health check
  ./database-maintenance.js --reset-stuck-jobs       # Fix stuck jobs
  ./database-maintenance.js --vacuum                 # Optimize database
  ./database-maintenance.js --clean-old-jobs --retention-days 7  # Clean old jobs
`);
    process.exit(0);
  }
  
  performMaintenance(options);
}

module.exports = { performMaintenance };