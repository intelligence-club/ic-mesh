#!/usr/bin/env node
/**
 * Database Optimization Script for IC Mesh
 * 
 * Adds strategic indexes to improve query performance
 */

const Database = require('better-sqlite3');
const fs = require('fs');

class DatabaseOptimizer {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = new Database(dbPath);
  }

  async optimize() {
    console.log('🔧 Optimizing IC Mesh Database Performance...\n');

    // Analyze current state
    await this.analyzeCurrentState();
    
    // Add strategic indexes
    await this.addStrategicIndexes();
    
    // Vacuum if needed
    await this.vacuumIfNeeded();
    
    console.log('✅ Database optimization complete!\n');
    this.db.close();
  }

  async analyzeCurrentState() {
    console.log('📊 Current Database State:');
    
    const stats = fs.statSync(this.dbPath);
    const pages = this.db.pragma('page_count')[0];
    const freePages = this.db.pragma('freelist_count')[0];
    const fragmentation = (freePages.freelist_count / pages.page_count) * 100;
    
    console.log(`  Size: ${(stats.size / 1024 / 1024).toFixed(2)}MB`);
    console.log(`  Pages: ${pages.page_count}`);
    console.log(`  Fragmentation: ${fragmentation.toFixed(1)}%`);
    
    // Count existing indexes
    const indexes = this.db.prepare(`
      SELECT COUNT(*) as count FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'
    `).get();
    
    console.log(`  Custom indexes: ${indexes.count}`);
    console.log();
  }

  async addStrategicIndexes() {
    console.log('🗂️  Adding Strategic Indexes:');
    
    const indexDefinitions = [
      // Ledger table optimizations
      {
        name: 'idx_ledger_nodeid_timestamp',
        table: 'ledger',
        sql: 'CREATE INDEX IF NOT EXISTS idx_ledger_nodeid_timestamp ON ledger(nodeId, timestamp)',
        rationale: 'Optimize node earning queries'
      },
      {
        name: 'idx_ledger_timestamp_type',
        table: 'ledger', 
        sql: 'CREATE INDEX IF NOT EXISTS idx_ledger_timestamp_type ON ledger(timestamp, type)',
        rationale: 'Optimize earnings/cost analysis'
      },
      
      // Tickets table optimizations
      {
        name: 'idx_tickets_created_status',
        table: 'tickets',
        sql: 'CREATE INDEX IF NOT EXISTS idx_tickets_created_status ON tickets(created, status)',
        rationale: 'Optimize support ticket queries'
      },
      {
        name: 'idx_tickets_email',
        table: 'tickets',
        sql: 'CREATE INDEX IF NOT EXISTS idx_tickets_email ON tickets(email)',
        rationale: 'Fast user ticket lookup'
      },
      
      // Jobs table additional optimizations
      {
        name: 'idx_jobs_type_status',
        table: 'jobs',
        sql: 'CREATE INDEX IF NOT EXISTS idx_jobs_type_status ON jobs(type, status)',
        rationale: 'Optimize job type filtering'
      },
      {
        name: 'idx_jobs_created_status',
        table: 'jobs',
        sql: 'CREATE INDEX IF NOT EXISTS idx_jobs_created_status ON jobs(createdAt, status)',
        rationale: 'Optimize recent job queries'
      },
      
      // Payouts table optimizations
      {
        name: 'idx_payouts_nodeid_status',
        table: 'payouts',
        sql: 'CREATE INDEX IF NOT EXISTS idx_payouts_nodeid_status ON payouts(nodeId, status)',
        rationale: 'Optimize payout status checks'
      },
      {
        name: 'idx_payouts_created',
        table: 'payouts',
        sql: 'CREATE INDEX IF NOT EXISTS idx_payouts_created ON payouts(createdAt)',
        rationale: 'Optimize payout history queries'
      }
    ];
    
    let created = 0;
    let skipped = 0;
    
    for (const index of indexDefinitions) {
      try {
        // Check if table exists first
        const tableExists = this.db.prepare(`
          SELECT COUNT(*) as count FROM sqlite_master WHERE type = 'table' AND name = ?
        `).get(index.table);
        
        if (tableExists.count === 0) {
          console.log(`  ⏭️  Skipping ${index.name} - table ${index.table} doesn't exist`);
          skipped++;
          continue;
        }
        
        // Check if index already exists
        const indexExists = this.db.prepare(`
          SELECT COUNT(*) as count FROM sqlite_master WHERE type = 'index' AND name = ?
        `).get(index.name);
        
        if (indexExists.count > 0) {
          console.log(`  ⏭️  Index ${index.name} already exists`);
          skipped++;
          continue;
        }
        
        // Create the index
        this.db.exec(index.sql);
        console.log(`  ✅ Created ${index.name} - ${index.rationale}`);
        created++;
        
      } catch (error) {
        console.log(`  ❌ Failed to create ${index.name}: ${error.message}`);
      }
    }
    
    console.log(`\n  Summary: ${created} created, ${skipped} skipped\n`);
  }

  async vacuumIfNeeded() {
    console.log('🧹 Checking if VACUUM is needed:');
    
    const pages = this.db.pragma('page_count')[0];
    const freePages = this.db.pragma('freelist_count')[0];
    const fragmentation = (freePages.freelist_count / pages.page_count) * 100;
    
    if (fragmentation > 5) {
      console.log(`  Fragmentation: ${fragmentation.toFixed(1)}% - Running VACUUM...`);
      
      const start = Date.now();
      this.db.exec('VACUUM');
      const duration = Date.now() - start;
      
      console.log(`  ✅ VACUUM completed in ${duration}ms`);
      
      // Check improvement
      const newPages = this.db.pragma('page_count')[0];
      const newFreePages = this.db.pragma('freelist_count')[0];
      const newFragmentation = (newFreePages.freelist_count / newPages.page_count) * 100;
      
      console.log(`  Fragmentation reduced: ${fragmentation.toFixed(1)}% → ${newFragmentation.toFixed(1)}%`);
    } else {
      console.log(`  Fragmentation: ${fragmentation.toFixed(1)}% - No VACUUM needed`);
    }
    console.log();
  }

  static async analyzeSlowQueries(dbPath) {
    console.log('🐌 Analyzing Potentially Slow Queries:');
    
    const db = new Database(dbPath);
    
    const slowQueries = [
      {
        name: 'Unindexed job search by type',
        sql: 'EXPLAIN QUERY PLAN SELECT * FROM jobs WHERE type = ? AND status = ?',
        params: ['transcribe', 'pending']
      },
      {
        name: 'Node earnings calculation', 
        sql: 'EXPLAIN QUERY PLAN SELECT SUM(computeMinutes) FROM ledger WHERE nodeId = ?',
        params: ['test-node']
      },
      {
        name: 'Recent tickets lookup',
        sql: 'EXPLAIN QUERY PLAN SELECT * FROM tickets WHERE email = ? ORDER BY created DESC',
        params: ['test@example.com']
      }
    ];
    
    slowQueries.forEach(query => {
      try {
        const plan = db.prepare(query.sql).all(...query.params);
        console.log(`\n  ${query.name}:`);
        plan.forEach(step => {
          const detail = step.detail || 'N/A';
          if (detail.includes('SCAN TABLE')) {
            console.log(`    ⚠️  Table scan detected: ${detail}`);
          } else if (detail.includes('USING INDEX')) {
            console.log(`    ✅ Using index: ${detail}`);
          } else {
            console.log(`    ℹ️  ${detail}`);
          }
        });
      } catch (error) {
        console.log(`    ❌ Query failed: ${error.message}`);
      }
    });
    
    console.log();
    db.close();
  }
}

// CLI interface
if (require.main === module) {
  const dbPath = process.argv[2] || './data/mesh.db';
  const analyze = process.argv.includes('--analyze');
  
  if (!fs.existsSync(dbPath)) {
    console.error(`Database not found: ${dbPath}`);
    process.exit(1);
  }
  
  if (analyze) {
    DatabaseOptimizer.analyzeSlowQueries(dbPath);
  } else {
    const optimizer = new DatabaseOptimizer(dbPath);
    optimizer.optimize();
  }
}

module.exports = DatabaseOptimizer;