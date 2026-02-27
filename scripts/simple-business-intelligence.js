#!/usr/bin/env node
/**
 * Simple Business Intelligence - Working version for current schema
 */

const sqlite3 = require('sqlite3');

class SimpleBusinessIntelligence {
  constructor() {
    this.db = new sqlite3.Database('data/mesh.db');
  }

  async generateReport() {
    console.log('💰 IC Mesh Simple Business Intelligence');
    console.log('======================================\n');

    try {
      await this.analyzeJobs();
      await this.analyzeNodes();
      await this.analyzeRevenue();
      console.log('\n✅ Report completed successfully');
    } catch (error) {
      console.error('❌ Error generating report:', error.message);
    } finally {
      this.db.close();
    }
  }

  async analyzeJobs() {
    return new Promise((resolve, reject) => {
      this.db.all(`
        SELECT 
          type,
          status,
          COUNT(*) as count,
          COALESCE(SUM(creditAmount), 0) as total_value,
          AVG(creditAmount) as avg_value
        FROM jobs 
        GROUP BY type, status
        ORDER BY type, status
      `, (err, rows) => {
        if (err) {
          reject(err);
          return;
        }

        console.log('📊 JOB ANALYSIS:');
        console.log('================');
        
        const jobSummary = {};
        let totalJobs = 0;
        let totalValue = 0;

        rows.forEach(row => {
          if (!jobSummary[row.type]) {
            jobSummary[row.type] = { completed: 0, pending: 0, value: 0 };
          }
          
          jobSummary[row.type][row.status] = row.count;
          jobSummary[row.type].value += row.total_value;
          totalJobs += row.count;
          totalValue += row.total_value;
        });

        Object.entries(jobSummary).forEach(([type, stats]) => {
          const successRate = stats.completed / (stats.completed + (stats.failed || 0)) * 100 || 0;
          console.log(`  ${type}:`);
          console.log(`    Completed: ${stats.completed || 0}`);
          console.log(`    Pending: ${stats.pending || 0}`);
          console.log(`    Value: $${stats.value.toFixed(2)}`);
          console.log(`    Success Rate: ${successRate.toFixed(1)}%`);
        });

        console.log(`\n  TOTALS: ${totalJobs} jobs, $${totalValue.toFixed(2)} total value`);
        resolve();
      });
    });
  }

  async analyzeNodes() {
    return new Promise((resolve, reject) => {
      const now = Date.now();
      
      this.db.all(`
        SELECT 
          nodeId,
          name,
          jobsCompleted,
          computeMinutes,
          capabilities,
          lastSeen,
          registeredAt
        FROM nodes 
        ORDER BY jobsCompleted DESC
      `, (err, rows) => {
        if (err) {
          reject(err);
          return;
        }

        console.log('\n🖥️  NODE PERFORMANCE:');
        console.log('====================');

        let totalJobs = 0;
        let totalMinutes = 0;
        let activeNodes = 0;

        rows.forEach(node => {
          const minutesAgo = Math.floor((now - node.lastSeen) / 60000);
          const isActive = minutesAgo < 5;
          const capabilities = JSON.parse(node.capabilities || '[]');
          
          if (isActive) activeNodes++;
          totalJobs += node.jobsCompleted || 0;
          totalMinutes += node.computeMinutes || 0;

          console.log(`  ${node.name || 'unnamed'} (${node.nodeId.substring(0, 8)})`);
          console.log(`    Status: ${isActive ? '🟢 Active' : `🔴 Offline (${minutesAgo}m ago)`}`);
          console.log(`    Jobs: ${node.jobsCompleted || 0}`);
          console.log(`    Compute: ${(node.computeMinutes || 0).toFixed(2)} minutes`);
          console.log(`    Capabilities: [${capabilities.join(', ')}]`);
        });

        console.log(`\n  NETWORK: ${activeNodes}/${rows.length} active, ${totalJobs} total jobs, ${totalMinutes.toFixed(2)} compute minutes`);
        resolve();
      });
    });
  }

  async analyzeRevenue() {
    return new Promise((resolve, reject) => {
      this.db.get(`
        SELECT 
          COALESCE(SUM(creditAmount), 0) as total_revenue,
          COUNT(*) as paid_jobs,
          AVG(creditAmount) as avg_job_value
        FROM jobs 
        WHERE creditAmount > 0 AND status = 'completed'
      `, (err, row) => {
        if (err) {
          reject(err);
          return;
        }

        console.log('\n💰 REVENUE ANALYSIS:');
        console.log('===================');
        console.log(`  Total Revenue: $${row.total_revenue.toFixed(2)}`);
        console.log(`  Paid Jobs: ${row.paid_jobs}`);
        console.log(`  Average Job Value: $${(row.avg_job_value || 0).toFixed(2)}`);

        // Calculate potential revenue (pending paid jobs)
        this.db.get(`
          SELECT 
            COALESCE(SUM(creditAmount), 0) as pending_revenue,
            COUNT(*) as pending_paid_jobs
          FROM jobs 
          WHERE creditAmount > 0 AND status = 'pending'
        `, (err, pendingRow) => {
          if (!err) {
            console.log(`  Pending Revenue: $${pendingRow.pending_revenue.toFixed(2)} (${pendingRow.pending_paid_jobs} jobs)`);
          }
          resolve();
        });
      });
    });
  }
}

// CLI usage
if (require.main === module) {
  const bi = new SimpleBusinessIntelligence();
  bi.generateReport();
}

module.exports = SimpleBusinessIntelligence;