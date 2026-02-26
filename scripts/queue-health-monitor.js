#!/usr/bin/env node
/**
 * Queue Health Monitor - Real-time job queue analysis and alerts
 * Monitors for stuck jobs, capacity issues, and processing anomalies
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../mesh.db');

class QueueHealthMonitor {
  constructor() {
    this.db = new sqlite3.Database(dbPath);
    this.alerts = [];
  }

  async analyzeQueue() {
    console.log('🏥 Queue Health Monitor\n');
    
    const metrics = await this.gatherMetrics();
    this.assessHealth(metrics);
    this.reportAlerts();
    
    this.db.close();
  }

  async gatherMetrics() {
    const [jobs, nodes, stuckJobs, ageDistribution] = await Promise.all([
      this.getJobCounts(),
      this.getNodeStatus(),
      this.getStuckJobs(),
      this.getJobAgeDistribution()
    ]);
    
    return { jobs, nodes, stuckJobs, ageDistribution };
  }

  async getJobCounts() {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT status, COUNT(*) as count 
         FROM jobs 
         GROUP BY status`,
        (err, rows) => {
          if (err) reject(err);
          
          const counts = {};
          rows.forEach(row => {
            counts[row.status] = row.count;
          });
          
          resolve(counts);
        }
      );
    });
  }

  async getNodeStatus() {
    return new Promise((resolve, reject) => {
      const fiveMinAgo = Date.now() - (5 * 60 * 1000);
      
      this.db.all(
        `SELECT 
           COUNT(*) as total,
           SUM(CASE WHEN lastHeartbeat > ? THEN 1 ELSE 0 END) as active,
           SUM(CASE WHEN capabilities LIKE '%whisper%' THEN 1 ELSE 0 END) as withWhisper,
           SUM(CASE WHEN capabilities LIKE '%ollama%' THEN 1 ELSE 0 END) as withOllama
         FROM nodes`,
        [fiveMinAgo],
        (err, rows) => {
          if (err) reject(err);
          resolve(rows[0] || {});
        }
      );
    });
  }

  async getStuckJobs() {
    return new Promise((resolve, reject) => {
      const thirtyMinAgo = Date.now() - (30 * 60 * 1000);
      
      this.db.all(
        `SELECT jobId, type, claimedBy, claimedAt,
                (? - claimedAt) / 60000 as minutesStuck
         FROM jobs 
         WHERE status = 'claimed' 
           AND claimedAt < ?
         ORDER BY claimedAt ASC`,
        [Date.now(), thirtyMinAgo],
        (err, rows) => {
          if (err) reject(err);
          resolve(rows || []);
        }
      );
    });
  }

  async getJobAgeDistribution() {
    return new Promise((resolve, reject) => {
      const now = Date.now();
      
      this.db.all(
        `SELECT 
           COUNT(*) as total,
           SUM(CASE WHEN (? - createdAt) < 300000 THEN 1 ELSE 0 END) as under5min,
           SUM(CASE WHEN (? - createdAt) BETWEEN 300000 AND 1800000 THEN 1 ELSE 0 END) as fiveTo30min,
           SUM(CASE WHEN (? - createdAt) > 1800000 THEN 1 ELSE 0 END) as over30min
         FROM jobs 
         WHERE status = 'pending'`,
        [now, now, now],
        (err, rows) => {
          if (err) reject(err);
          resolve(rows[0] || {});
        }
      );
    });
  }

  assessHealth(metrics) {
    console.log('📊 Current Queue Metrics:');
    console.log(`  Pending: ${metrics.jobs.pending || 0}`);
    console.log(`  Claimed: ${metrics.jobs.claimed || 0}`);
    console.log(`  Completed: ${metrics.jobs.completed || 0}`);
    console.log(`  Failed: ${metrics.jobs.failed || 0}`);
    console.log();
    
    console.log('🖥️  Node Status:');
    console.log(`  Total registered: ${metrics.nodes.total}`);
    console.log(`  Currently active: ${metrics.nodes.active}`);
    console.log(`  With Whisper: ${metrics.nodes.withWhisper}`);
    console.log(`  With Ollama: ${metrics.nodes.withOllama}`);
    console.log();
    
    // Health assessments
    this.assessQueueBacklog(metrics);
    this.assessStuckJobs(metrics);
    this.assessCapacity(metrics);
    this.assessJobAge(metrics);
  }

  assessQueueBacklog(metrics) {
    const pending = metrics.jobs.pending || 0;
    const active = metrics.nodes.active || 0;
    
    if (pending === 0) {
      console.log('✅ Queue Status: No backlog - excellent');
    } else if (pending < 10) {
      console.log('🟡 Queue Status: Small backlog - normal');
    } else if (pending < 50) {
      console.log('🟠 Queue Status: Moderate backlog - monitor closely');
      this.alerts.push(`Moderate queue backlog: ${pending} jobs pending`);
    } else {
      console.log('🔴 Queue Status: Large backlog - action needed!');
      this.alerts.push(`HIGH PRIORITY: Large queue backlog: ${pending} jobs pending`);
    }
    
    if (active === 0 && pending > 0) {
      console.log('🚨 CRITICAL: No active nodes but jobs pending!');
      this.alerts.push('CRITICAL: No active nodes available to process pending jobs');
    }
    
    console.log();
  }

  assessStuckJobs(metrics) {
    const stuckCount = metrics.stuckJobs.length;
    
    if (stuckCount === 0) {
      console.log('✅ Job Processing: No stuck jobs');
    } else {
      console.log(`🔴 Job Processing: ${stuckCount} stuck jobs detected!`);
      
      metrics.stuckJobs.slice(0, 3).forEach(job => {
        console.log(`  • ${job.jobId.substring(0,8)}... (${job.type}) stuck ${Math.round(job.minutesStuck)}min on node ${(job.claimedBy || 'unknown').substring(0,8)}...`);
      });
      
      if (stuckCount > 3) {
        console.log(`  • ...and ${stuckCount - 3} more`);
      }
      
      this.alerts.push(`${stuckCount} jobs stuck in claimed state >30 minutes`);
    }
    
    console.log();
  }

  assessCapacity(metrics) {
    const pending = metrics.jobs.pending || 0;
    const active = metrics.nodes.active || 0;
    const withWhisper = metrics.nodes.withWhisper || 0;
    
    if (active === 0) {
      console.log('🔴 Capacity: ZERO ACTIVE NODES');
      return;
    }
    
    const jobsPerNode = pending / active;
    
    if (jobsPerNode < 5) {
      console.log('✅ Capacity: Adequate for current demand');
    } else if (jobsPerNode < 15) {
      console.log('🟡 Capacity: Moderate load per node');
    } else {
      console.log('🔴 Capacity: High load per node - scaling needed');
      this.alerts.push(`High capacity load: ${jobsPerNode.toFixed(1)} jobs per active node`);
    }
    
    // Check for capability mismatches
    if (pending > 10 && withWhisper === 0) {
      console.log('⚠️  Capability Gap: Many pending jobs but no Whisper-capable nodes');
      this.alerts.push('No Whisper-capable nodes available for transcription jobs');
    }
    
    console.log();
  }

  assessJobAge(metrics) {
    const { total, under5min, fiveTo30min, over30min } = metrics.ageDistribution;
    
    if (total === 0) {
      console.log('✅ Job Age: No pending jobs');
      return;
    }
    
    console.log('⏰ Pending Job Age Distribution:');
    console.log(`  <5 minutes: ${under5min || 0} jobs`);
    console.log(`  5-30 minutes: ${fiveTo30min || 0} jobs`);
    console.log(`  >30 minutes: ${over30min || 0} jobs`);
    
    if (over30min > 0) {
      const percentage = ((over30min / total) * 100).toFixed(1);
      console.log(`🔴 ${percentage}% of jobs are over 30 minutes old!`);
      this.alerts.push(`${over30min} jobs pending >30 minutes - possible processing issue`);
    } else if (fiveTo30min > 0) {
      console.log('🟡 Some jobs waiting 5-30 minutes - normal during busy periods');
    } else {
      console.log('✅ All jobs are fresh (<5 minutes)');
    }
    
    console.log();
  }

  reportAlerts() {
    if (this.alerts.length === 0) {
      console.log('🎉 Overall Health: EXCELLENT - No issues detected\n');
      return;
    }
    
    console.log('🚨 HEALTH ALERTS:\n');
    this.alerts.forEach((alert, i) => {
      console.log(`${i + 1}. ${alert}`);
    });
    
    console.log('\n💡 Recommended Actions:');
    
    if (this.alerts.some(a => a.includes('No active nodes'))) {
      console.log('  • URGENT: Investigate why no nodes are online');
      console.log('  • Check Discord/Telegram for operator reports');
      console.log('  • Verify server connectivity');
    }
    
    if (this.alerts.some(a => a.includes('stuck'))) {
      console.log('  • Reset stuck jobs: node scripts/reset-stuck-jobs.js');
      console.log('  • Check problematic nodes for issues');
    }
    
    if (this.alerts.some(a => a.includes('backlog'))) {
      console.log('  • Recruit additional operators');
      console.log('  • Review quarantined nodes for potential unquarantine');
      console.log('  • Consider temporary rate increases to attract capacity');
    }
    
    console.log();
  }

  async generateReport() {
    // Generate a JSON report for programmatic use
    const metrics = await this.gatherMetrics();
    const report = {
      timestamp: Date.now(),
      health: this.alerts.length === 0 ? 'HEALTHY' : 'ISSUES',
      metrics,
      alerts: this.alerts
    };
    
    return report;
  }
}

// CLI execution
if (require.main === module) {
  const args = process.argv.slice(2);
  const monitor = new QueueHealthMonitor();
  
  if (args.includes('--json')) {
    monitor.generateReport().then(report => {
      console.log(JSON.stringify(report, null, 2));
      monitor.db.close();
    }).catch(console.error);
  } else {
    monitor.analyzeQueue().catch(console.error);
  }
}

module.exports = QueueHealthMonitor;