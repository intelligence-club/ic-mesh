#!/usr/bin/env node
/**
 * Database Performance Monitor for IC Mesh
 * 
 * Analyzes database performance, query patterns, and suggests optimizations
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

class DatabasePerformanceMonitor {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = new Database(dbPath);
  }

  async analyzePerformance() {
    console.log('🔍 IC Mesh Database Performance Analysis\n');

    // Database size and integrity
    this.analyzeDatabaseSize();
    this.checkIntegrity();
    
    // Table analysis
    await this.analyzeTableStats();
    await this.analyzeIndexes();
    
    // Query performance
    this.testCommonQueries();
    
    // Recommendations
    this.generateRecommendations();
    
    this.db.close();
  }

  analyzeDatabaseSize() {
    console.log('📊 Database Size Analysis:');
    
    const stats = fs.statSync(this.dbPath);
    const pages = this.db.pragma('page_count')[0];
    const pageSize = this.db.pragma('page_size')[0];
    const freePages = this.db.pragma('freelist_count')[0];
    
    console.log(`  File size: ${formatBytes(stats.size)}`);
    console.log(`  Page count: ${pages.page_count}`);
    console.log(`  Page size: ${formatBytes(pageSize.page_size)}`);
    console.log(`  Free pages: ${freePages.freelist_count}`);
    console.log(`  Fragmentation: ${((freePages.freelist_count / pages.page_count) * 100).toFixed(1)}%`);
    console.log();
  }

  checkIntegrity() {
    console.log('🔒 Database Integrity Check:');
    const start = Date.now();
    const result = this.db.pragma('integrity_check')[0];
    const duration = Date.now() - start;
    
    console.log(`  Status: ${result.integrity_check}`);
    console.log(`  Check time: ${formatDuration(duration)}`);
    console.log();
  }

  async analyzeTableStats() {
    console.log('📋 Table Statistics:');
    
    const tables = ['jobs', 'nodes', 'ledger', 'tickets', 'payouts'];
    const stats = [];
    
    for (const table of tables) {
      try {
        const start = Date.now();
        const count = this.db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get();
        const duration = Date.now() - start;
        
        stats.push({
          table,
          rows: count.count,
          queryTime: duration
        });
      } catch (error) {
        stats.push({
          table,
          rows: 'N/A',
          queryTime: 0,
          error: error.message
        });
      }
    }
    
    stats.forEach(stat => {
      if (stat.error) {
        console.log(`  ${stat.table}: ${stat.error}`);
      } else {
        console.log(`  ${stat.table}: ${stat.rows.toLocaleString()} rows (${formatDuration(stat.queryTime)})`);
      }
    });
    console.log();
  }

  async analyzeIndexes() {
    console.log('🗂️  Index Analysis:');
    
    try {
      const indexes = this.db.prepare(`
        SELECT name, tbl_name, sql 
        FROM sqlite_master 
        WHERE type = 'index' 
        AND name NOT LIKE 'sqlite_%'
      `).all();
      
      if (indexes.length === 0) {
        console.log('  ⚠️  No custom indexes found');
      } else {
        console.log(`  Found ${indexes.length} custom indexes:`);
        indexes.forEach(idx => {
          console.log(`    - ${idx.name} on ${idx.tbl_name}`);
        });
      }
    } catch (error) {
      console.log(`  Error analyzing indexes: ${error.message}`);
    }
    console.log();
  }

  testCommonQueries() {
    console.log('⚡ Query Performance Tests:');
    
    const queries = [
      {
        name: 'Get pending jobs',
        sql: `SELECT COUNT(*) FROM jobs WHERE status = 'pending'`
      },
      {
        name: 'Get active nodes',
        sql: `SELECT COUNT(*) FROM nodes WHERE lastSeen > datetime('now', '-5 minutes')`
      },
      {
        name: 'Recent job completions',
        sql: `SELECT COUNT(*) FROM jobs WHERE status = 'completed' AND createdAt > datetime('now', '-1 hour')`
      },
      {
        name: 'Node earnings',
        sql: `SELECT SUM(computeMinutes) FROM ledger WHERE nodeId IS NOT NULL AND timestamp > datetime('now', '-1 day')`
      }
    ];
    
    queries.forEach(query => {
      try {
        const start = Date.now();
        const result = this.db.prepare(query.sql).get();
        const duration = Date.now() - start;
        
        console.log(`  ${query.name}: ${formatDuration(duration)}`);
        
        if (duration > 100) {
          console.log(`    ⚠️  Slow query detected (>${duration}ms)`);
        }
      } catch (error) {
        console.log(`  ${query.name}: ERROR - ${error.message}`);
      }
    });
    console.log();
  }

  generateRecommendations() {
    console.log('💡 Performance Recommendations:');
    
    const recommendations = [];
    
    // Check for missing indexes on commonly queried columns
    const tables = this.db.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    `).all();
    
    const indexes = this.db.prepare(`
      SELECT tbl_name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'
    `).all();
    
    const tablesWithIndexes = new Set(indexes.map(i => i.tbl_name));
    
    tables.forEach(table => {
      if (!tablesWithIndexes.has(table.name)) {
        recommendations.push(`Consider adding indexes to ${table.name} table for common queries`);
      }
    });
    
    // Check database size efficiency
    const stats = fs.statSync(this.dbPath);
    if (stats.size > 10 * 1024 * 1024) { // > 10MB
      recommendations.push('Database is growing large - consider archiving old records');
    }
    
    // Check fragmentation
    const pages = this.db.pragma('page_count')[0];
    const freePages = this.db.pragma('freelist_count')[0];
    const fragmentation = (freePages.freelist_count / pages.page_count) * 100;
    
    if (fragmentation > 10) {
      recommendations.push('Database has high fragmentation - consider running VACUUM');
    }
    
    if (recommendations.length === 0) {
      console.log('  ✅ No immediate performance issues detected');
    } else {
      recommendations.forEach((rec, index) => {
        console.log(`  ${index + 1}. ${rec}`);
      });
    }
    console.log();
  }

  static async quickCheck(dbPath) {
    const monitor = new DatabasePerformanceMonitor(dbPath);
    
    console.log('⚡ Quick Performance Check:');
    
    const start = Date.now();
    const integrity = monitor.db.pragma('integrity_check')[0];
    const integrityTime = Date.now() - start;
    
    const stats = fs.statSync(dbPath);
    
    console.log(`  Database: ${formatBytes(stats.size)}`);
    console.log(`  Integrity: ${integrity.integrity_check} (${formatDuration(integrityTime)})`);
    
    // Quick query test
    const queryStart = Date.now();
    try {
      const jobCount = monitor.db.prepare('SELECT COUNT(*) as count FROM jobs').get();
      const queryTime = Date.now() - queryStart;
      console.log(`  Jobs table: ${jobCount.count} rows (${formatDuration(queryTime)})`);
    } catch (error) {
      console.log(`  Query test: ERROR - ${error.message}`);
    }
    
    monitor.db.close();
    console.log();
  }
}

// CLI interface
if (require.main === module) {
  const dbPath = process.argv[2] || './data/mesh.db';
  const quick = process.argv.includes('--quick');
  
  if (!fs.existsSync(dbPath)) {
    console.error(`Database not found: ${dbPath}`);
    process.exit(1);
  }
  
  if (quick) {
    DatabasePerformanceMonitor.quickCheck(dbPath);
  } else {
    const monitor = new DatabasePerformanceMonitor(dbPath);
    monitor.analyzePerformance();
  }
}

module.exports = DatabasePerformanceMonitor;