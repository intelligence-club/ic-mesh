#!/usr/bin/env node
/**
 * IC Mesh Database Analytics & Maintenance Script
 * 
 * Provides insights and maintenance for the IC Mesh database:
 * - Usage analytics and trends
 * - Performance metrics
 * - Data cleanup and optimization
 * - Health monitoring
 * - Export capabilities
 * 
 * Usage:
 *   node scripts/database-analytics.js [command] [options]
 *   
 * Commands:
 *   stats         - Show database statistics
 *   trends        - Show usage trends over time
 *   performance   - Show performance metrics
 *   cleanup       - Clean up old/stale data
 *   export        - Export data for analysis
 *   health        - Database health check
 *   optimize      - Optimize database performance
 */

const fs = require('fs');
const path = require('path');

// Configuration
const config = {
  dbPath: process.env.DB_PATH || 'data/mesh.db',
  retentionDays: parseInt(process.env.RETENTION_DAYS) || 90,
  exportPath: process.env.EXPORT_PATH || 'data/exports',
  timezone: process.env.TZ || 'UTC'
};

class DatabaseAnalytics {
  constructor() {
    this.db = null;
  }

  async init() {
    // Dynamic import for SQLite (async import pattern)
    try {
      const Database = (await import('better-sqlite3')).default;
      this.db = new Database(config.dbPath);
      this.db.pragma('journal_mode = WAL');
    } catch (error) {
      console.error('❌ Database initialization failed:', error.message);
      console.log('💡 Ensure better-sqlite3 is installed: npm install better-sqlite3');
      process.exit(1);
    }
  }

  close() {
    if (this.db) {
      this.db.close();
    }
  }

  // Get comprehensive database statistics
  getStats() {
    console.log('📊 IC MESH DATABASE STATISTICS');
    console.log('═'.repeat(50));

    try {
      // Table sizes
      const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
      console.log('\n📋 Table Statistics:');
      
      for (const table of tables) {
        try {
          const count = this.db.prepare(`SELECT COUNT(*) as count FROM ${table.name}`).get();
          const size = this.db.prepare(`SELECT page_count * page_size as size FROM pragma_page_count('${table.name}'), pragma_page_size`).get();
          console.log(`  ${table.name.padEnd(20)} ${count.count.toString().padStart(8)} rows  ${this.formatBytes(size.size || 0)}`);
        } catch (err) {
          console.log(`  ${table.name.padEnd(20)} ${'ERROR'.padStart(8)} rows  ${err.message}`);
        }
      }

      // Node statistics
      try {
        const nodeStats = this.db.prepare(`
          SELECT 
            COUNT(*) as total_nodes,
            SUM(CASE WHEN status = 'online' THEN 1 ELSE 0 END) as online_nodes,
            SUM(CASE WHEN status = 'busy' THEN 1 ELSE 0 END) as busy_nodes,
            AVG(balance_ints) as avg_balance
          FROM nodes
        `).get();

        console.log('\n🖥️  Node Statistics:');
        console.log(`  Total Nodes:     ${nodeStats.total_nodes}`);
        console.log(`  Online:          ${nodeStats.online_nodes}`);
        console.log(`  Busy:            ${nodeStats.busy_nodes}`);
        console.log(`  Avg Balance:     ${Math.round(nodeStats.avg_balance || 0)} ints`);
      } catch (err) {
        console.log('\n🖥️  Node Statistics: ERROR -', err.message);
      }

      // Job statistics
      try {
        const jobStats = this.db.prepare(`
          SELECT 
            COUNT(*) as total_jobs,
            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_jobs,
            SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_jobs,
            SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing_jobs,
            AVG(cost_ints) as avg_cost
          FROM jobs
        `).get();

        console.log('\n📋 Job Statistics:');
        console.log(`  Total Jobs:      ${jobStats.total_jobs}`);
        console.log(`  Completed:       ${jobStats.completed_jobs}`);
        console.log(`  Pending:         ${jobStats.pending_jobs}`);
        console.log(`  Processing:      ${jobStats.processing_jobs}`);
        console.log(`  Avg Cost:        ${Math.round(jobStats.avg_cost || 0)} ints`);
      } catch (err) {
        console.log('\n📋 Job Statistics: ERROR -', err.message);
      }

      // Transaction statistics
      try {
        const transactionStats = this.db.prepare(`
          SELECT 
            COUNT(*) as total_transactions,
            SUM(amount_ints) as total_volume,
            AVG(amount_ints) as avg_transaction
          FROM transactions
        `).get();

        console.log('\n💰 Transaction Statistics:');
        console.log(`  Total Transactions: ${transactionStats.total_transactions}`);
        console.log(`  Total Volume:       ${transactionStats.total_volume || 0} ints`);
        console.log(`  Avg Transaction:    ${Math.round(transactionStats.avg_transaction || 0)} ints`);
      } catch (err) {
        console.log('\n💰 Transaction Statistics: ERROR -', err.message);
      }

      // Database file info
      const dbStats = fs.statSync(config.dbPath);
      console.log('\n💾 Database File:');
      console.log(`  Size:            ${this.formatBytes(dbStats.size)}`);
      console.log(`  Modified:        ${dbStats.mtime.toISOString()}`);
      console.log(`  Location:        ${config.dbPath}`);

    } catch (error) {
      console.error('❌ Error getting statistics:', error.message);
    }
  }

  // Get usage trends
  getTrends(days = 7) {
    console.log(`📈 IC MESH USAGE TRENDS (Last ${days} days)`);
    console.log('═'.repeat(50));

    try {
      const trends = this.db.prepare(`
        SELECT 
          DATE(created_at) as date,
          COUNT(*) as jobs_count,
          SUM(cost_ints) as daily_volume,
          COUNT(DISTINCT customer_id) as unique_customers
        FROM jobs 
        WHERE created_at > datetime('now', '-${days} days')
        GROUP BY DATE(created_at)
        ORDER BY date ASC
      `).all();

      console.log('\nDaily Activity:');
      console.log('Date       | Jobs | Volume | Customers');
      console.log('-----------|------|--------|----------');
      
      for (const day of trends) {
        const date = day.date || 'Unknown';
        const jobs = day.jobs_count.toString().padStart(4);
        const volume = (day.daily_volume || 0).toString().padStart(6);
        const customers = day.unique_customers.toString().padStart(9);
        console.log(`${date} | ${jobs} | ${volume} | ${customers}`);
      }

      if (trends.length === 0) {
        console.log('No recent activity data found.');
      }

    } catch (error) {
      console.error('❌ Error getting trends:', error.message);
    }
  }

  // Performance metrics
  getPerformance() {
    console.log('⚡ IC MESH PERFORMANCE METRICS');
    console.log('═'.repeat(50));

    try {
      // Query performance stats
      console.log('\n🔍 Database Performance:');
      
      const pragmas = [
        { name: 'cache_size', label: 'Cache Size' },
        { name: 'page_size', label: 'Page Size' },
        { name: 'journal_mode', label: 'Journal Mode' },
        { name: 'synchronous', label: 'Synchronous' },
        { name: 'temp_store', label: 'Temp Store' }
      ];

      for (const pragma of pragmas) {
        try {
          const result = this.db.pragma(pragma.name);
          console.log(`  ${pragma.label.padEnd(15)}: ${result}`);
        } catch (err) {
          console.log(`  ${pragma.label.padEnd(15)}: ERROR`);
        }
      }

      // Average job processing times
      try {
        const processingTimes = this.db.prepare(`
          SELECT 
            handler,
            AVG(julianday(completed_at) - julianday(started_at)) * 24 * 60 * 60 as avg_seconds,
            COUNT(*) as job_count
          FROM jobs 
          WHERE completed_at IS NOT NULL 
            AND started_at IS NOT NULL 
            AND created_at > datetime('now', '-7 days')
          GROUP BY handler
          ORDER BY avg_seconds ASC
        `).all();

        console.log('\n⏱️  Average Processing Times (Last 7 days):');
        console.log('Handler          | Avg Time | Jobs');
        console.log('-----------------|----------|------');
        
        for (const handler of processingTimes) {
          const name = (handler.handler || 'unknown').padEnd(16);
          const avgTime = `${Math.round(handler.avg_seconds)}s`.padStart(8);
          const count = handler.job_count.toString().padStart(5);
          console.log(`${name} | ${avgTime} | ${count}`);
        }
      } catch (err) {
        console.log('\n⏱️  Processing Times: ERROR -', err.message);
      }

    } catch (error) {
      console.error('❌ Error getting performance metrics:', error.message);
    }
  }

  // Database health check
  healthCheck() {
    console.log('🔍 IC MESH DATABASE HEALTH CHECK');
    console.log('═'.repeat(50));

    try {
      // Integrity check
      console.log('\n🔧 Running integrity check...');
      const integrity = this.db.pragma('integrity_check');
      if (integrity === 'ok' || (Array.isArray(integrity) && integrity[0] === 'ok')) {
        console.log('✅ Database integrity: OK');
      } else {
        console.log('❌ Database integrity: ISSUES FOUND');
        console.log(integrity);
      }

      // Check for orphaned records
      try {
        const orphanJobs = this.db.prepare(`
          SELECT COUNT(*) as count 
          FROM jobs 
          WHERE node_id NOT IN (SELECT id FROM nodes)
        `).get();
        
        if (orphanJobs.count > 0) {
          console.log(`⚠️  Found ${orphanJobs.count} orphaned jobs (referencing non-existent nodes)`);
        } else {
          console.log('✅ No orphaned jobs found');
        }
      } catch (err) {
        console.log('⚠️  Could not check for orphaned jobs:', err.message);
      }

      // Check for stuck jobs
      try {
        const stuckJobs = this.db.prepare(`
          SELECT COUNT(*) as count 
          FROM jobs 
          WHERE status = 'processing' 
            AND started_at < datetime('now', '-1 hour')
        `).get();
        
        if (stuckJobs.count > 0) {
          console.log(`⚠️  Found ${stuckJobs.count} potentially stuck jobs (processing >1 hour)`);
        } else {
          console.log('✅ No stuck jobs found');
        }
      } catch (err) {
        console.log('⚠️  Could not check for stuck jobs:', err.message);
      }

      // Check disk space
      const dbStats = fs.statSync(config.dbPath);
      const dbSizeMB = dbStats.size / (1024 * 1024);
      
      if (dbSizeMB > 1000) {  // >1GB
        console.log(`⚠️  Database is large: ${this.formatBytes(dbStats.size)}`);
        console.log('   Consider running cleanup or archiving old data');
      } else {
        console.log(`✅ Database size is reasonable: ${this.formatBytes(dbStats.size)}`);
      }

    } catch (error) {
      console.error('❌ Error during health check:', error.message);
    }
  }

  // Cleanup old data
  cleanup(dryRun = false) {
    const action = dryRun ? 'DRY RUN' : 'EXECUTING';
    console.log(`🧹 IC MESH DATABASE CLEANUP (${action})`);
    console.log('═'.repeat(50));

    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - config.retentionDays);
      const cutoffISO = cutoffDate.toISOString();

      // Count what would be cleaned up
      const oldJobs = this.db.prepare(`
        SELECT COUNT(*) as count 
        FROM jobs 
        WHERE created_at < ? AND status = 'completed'
      `).get(cutoffISO);

      const oldTransactions = this.db.prepare(`
        SELECT COUNT(*) as count 
        FROM transactions 
        WHERE created_at < ?
      `).get(cutoffISO);

      console.log(`\n📋 Data older than ${config.retentionDays} days (before ${cutoffISO.split('T')[0]}):`);
      console.log(`  Completed jobs:  ${oldJobs.count}`);
      console.log(`  Transactions:    ${oldTransactions.count}`);

      if (!dryRun && (oldJobs.count > 0 || oldTransactions.count > 0)) {
        console.log('\n🗑️  Cleaning up...');
        
        const jobsDeleted = this.db.prepare(`
          DELETE FROM jobs 
          WHERE created_at < ? AND status = 'completed'
        `).run(cutoffISO);

        const transactionsDeleted = this.db.prepare(`
          DELETE FROM transactions 
          WHERE created_at < ?
        `).run(cutoffISO);

        console.log(`✅ Deleted ${jobsDeleted.changes} completed jobs`);
        console.log(`✅ Deleted ${transactionsDeleted.changes} transactions`);

        // Vacuum to reclaim space
        console.log('\n🔧 Vacuuming database to reclaim space...');
        this.db.pragma('vacuum');
        console.log('✅ Database vacuumed');
      } else if (oldJobs.count === 0 && oldTransactions.count === 0) {
        console.log('\n✅ No old data to clean up');
      } else {
        console.log('\n💡 Use --cleanup (without --dry-run) to execute cleanup');
      }

    } catch (error) {
      console.error('❌ Error during cleanup:', error.message);
    }
  }

  // Export data for analysis
  export(format = 'json') {
    console.log('📤 IC MESH DATA EXPORT');
    console.log('═'.repeat(50));

    try {
      // Ensure export directory exists
      if (!fs.existsSync(config.exportPath)) {
        fs.mkdirSync(config.exportPath, { recursive: true });
      }

      const timestamp = new Date().toISOString().split('T')[0];
      const exportFile = path.join(config.exportPath, `ic-mesh-export-${timestamp}.${format}`);

      // Export summary data
      const exportData = {
        timestamp: new Date().toISOString(),
        summary: {
          nodes: this.db.prepare('SELECT COUNT(*) as count FROM nodes').get(),
          jobs: this.db.prepare('SELECT COUNT(*) as count FROM jobs').get(),
          transactions: this.db.prepare('SELECT COUNT(*) as count FROM transactions').get()
        },
        nodes: this.db.prepare('SELECT * FROM nodes').all(),
        recent_jobs: this.db.prepare(`
          SELECT * FROM jobs 
          WHERE created_at > datetime('now', '-30 days') 
          ORDER BY created_at DESC
        `).all(),
        daily_stats: this.db.prepare(`
          SELECT 
            DATE(created_at) as date,
            COUNT(*) as jobs,
            SUM(cost_ints) as volume
          FROM jobs 
          WHERE created_at > datetime('now', '-30 days')
          GROUP BY DATE(created_at)
          ORDER BY date DESC
        `).all()
      };

      if (format === 'json') {
        fs.writeFileSync(exportFile, JSON.stringify(exportData, null, 2));
      } else if (format === 'csv') {
        // Simple CSV export of daily stats
        const csvLines = ['Date,Jobs,Volume'];
        for (const stat of exportData.daily_stats) {
          csvLines.push(`${stat.date},${stat.jobs},${stat.volume || 0}`);
        }
        fs.writeFileSync(exportFile, csvLines.join('\n'));
      }

      console.log(`✅ Data exported to: ${exportFile}`);
      console.log(`📊 Exported ${exportData.recent_jobs.length} recent jobs`);
      console.log(`📈 Exported ${exportData.daily_stats.length} days of statistics`);

    } catch (error) {
      console.error('❌ Error during export:', error.message);
    }
  }

  // Utility function to format bytes
  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }
}

// Main execution
async function main() {
  const analytics = new DatabaseAnalytics();
  
  try {
    await analytics.init();
    
    const command = process.argv[2] || 'stats';
    const flags = process.argv.slice(3);
    
    switch (command) {
      case 'stats':
        analytics.getStats();
        break;
        
      case 'trends':
        const days = parseInt(flags.find(f => f.startsWith('--days='))?.split('=')[1]) || 7;
        analytics.getTrends(days);
        break;
        
      case 'performance':
        analytics.getPerformance();
        break;
        
      case 'health':
        analytics.healthCheck();
        break;
        
      case 'cleanup':
        const dryRun = flags.includes('--dry-run');
        analytics.cleanup(dryRun);
        break;
        
      case 'export':
        const format = flags.find(f => f.startsWith('--format='))?.split('=')[1] || 'json';
        analytics.export(format);
        break;
        
      default:
        console.log(`
🔧 IC Mesh Database Analytics & Maintenance

Usage: node scripts/database-analytics.js [command] [options]

Commands:
  stats              Show database statistics
  trends [--days=N]  Show usage trends (default: 7 days)
  performance        Show performance metrics
  health             Database health check
  cleanup [--dry-run] Clean up old data
  export [--format=json|csv] Export data for analysis

Examples:
  node scripts/database-analytics.js stats
  node scripts/database-analytics.js trends --days=30
  node scripts/database-analytics.js cleanup --dry-run
  node scripts/database-analytics.js export --format=csv
        `);
        break;
    }
    
  } catch (error) {
    console.error('❌ Fatal error:', error.message);
    process.exit(1);
  } finally {
    analytics.close();
  }
}

// Handle cleanup on exit
process.on('SIGINT', () => {
  console.log('\n👋 Interrupted, cleaning up...');
  process.exit(0);
});

if (require.main === module) {
  main();
}

module.exports = DatabaseAnalytics;