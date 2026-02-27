#!/usr/bin/env node

/**
 * Critical Capability Monitor
 * Detects when essential capabilities become unavailable
 * Triggers alerts for service outage prevention
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'mesh.db');
const CRITICAL_CAPABILITIES = ['ocr', 'pdf-extract', 'transcribe', 'whisper'];
const OFFLINE_THRESHOLD_MINUTES = 30; // Consider nodes offline after 30min

// Alert thresholds
const THRESHOLDS = {
  CRITICAL: 0,    // No nodes available for capability
  WARNING: 1,     // Only 1 node available (no redundancy)
  HEALTHY: 2      // 2+ nodes available
};

class CapabilityMonitor {
  constructor() {
    this.db = new sqlite3.Database(DB_PATH);
  }

  async getCapabilityCoverage() {
    return new Promise((resolve, reject) => {
      const query = `
        WITH active_nodes AS (
          SELECT 
            nodeId, 
            capabilities,
            (strftime('%s', 'now') - lastSeen / 1000) / 60 as minutes_offline
          FROM nodes 
          WHERE (strftime('%s', 'now') - lastSeen / 1000) / 60 <= ?
        ),
        capability_nodes AS (
          SELECT 
            nodeId,
            TRIM(value) as capability
          FROM active_nodes, json_each(active_nodes.capabilities)
        ),
        pending_jobs AS (
          SELECT 
            type as job_type,
            COUNT(*) as pending_count
          FROM jobs 
          WHERE status = 'pending'
          GROUP BY type
        )
        SELECT 
          c.capability,
          COUNT(DISTINCT cn.nodeId) as active_nodes,
          COALESCE(pj.pending_count, 0) as pending_jobs,
          GROUP_CONCAT(DISTINCT cn.nodeId) as node_ids
        FROM (
          SELECT 'ocr' as capability UNION ALL
          SELECT 'pdf-extract' UNION ALL  
          SELECT 'transcribe' UNION ALL
          SELECT 'whisper'
        ) c
        LEFT JOIN capability_nodes cn ON c.capability = cn.capability
        LEFT JOIN pending_jobs pj ON c.capability = pj.job_type
        GROUP BY c.capability
        ORDER BY active_nodes ASC, pending_jobs DESC
      `;

      this.db.all(query, [OFFLINE_THRESHOLD_MINUTES], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  async getPendingJobsAge() {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT 
          type as capability,
          COUNT(*) as job_count,
          MIN((strftime('%s', 'now') - createdAt / 1000) / 60) as min_age_minutes,
          MAX((strftime('%s', 'now') - createdAt / 1000) / 60) as max_age_minutes,
          AVG((strftime('%s', 'now') - createdAt / 1000) / 60) as avg_age_minutes
        FROM jobs 
        WHERE status = 'pending'
        GROUP BY type
        ORDER BY max_age_minutes DESC
      `;

      this.db.all(query, [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  analyzeAlertLevel(coverage) {
    let alerts = [];
    let maxLevel = 'HEALTHY';

    for (const cap of coverage) {
      const { capability, active_nodes, pending_jobs } = cap;
      
      if (!CRITICAL_CAPABILITIES.includes(capability)) continue;

      let level, message;
      
      if (active_nodes === 0 && pending_jobs > 0) {
        level = 'CRITICAL';
        message = `🚨 CRITICAL: ${capability} capability UNAVAILABLE with ${pending_jobs} pending jobs`;
        maxLevel = 'CRITICAL';
      } else if (active_nodes === 0) {
        level = 'WARNING';
        message = `⚠️  WARNING: ${capability} capability UNAVAILABLE (no pending jobs)`;
        if (maxLevel !== 'CRITICAL') maxLevel = 'WARNING';
      } else if (active_nodes === 1 && pending_jobs > 0) {
        level = 'WARNING';
        message = `⚠️  WARNING: ${capability} has only 1 node with ${pending_jobs} pending jobs (no redundancy)`;
        if (maxLevel !== 'CRITICAL') maxLevel = 'WARNING';
      } else if (active_nodes >= 2) {
        level = 'HEALTHY';
        message = `✅ HEALTHY: ${capability} has ${active_nodes} nodes available`;
      }

      alerts.push({ level, capability, active_nodes, pending_jobs, message });
    }

    return { maxLevel, alerts };
  }

  formatReport(coverage, jobsAge, alertAnalysis) {
    const timestamp = new Date().toISOString();
    const { maxLevel, alerts } = alertAnalysis;

    let report = `🔍 CRITICAL CAPABILITY MONITOR REPORT\n`;
    report += `════════════════════════════════════════\n`;
    report += `Timestamp: ${timestamp}\n`;
    report += `Overall Status: ${this.getStatusEmoji(maxLevel)} ${maxLevel}\n\n`;

    // Capability Coverage Table
    report += `📊 CAPABILITY COVERAGE\n`;
    report += `─────────────────────────────────────────\n`;
    coverage.forEach(cap => {
      const status = cap.active_nodes === 0 ? '🚨' : cap.active_nodes === 1 ? '⚠️ ' : '✅';
      report += `${status} ${cap.capability.padEnd(12)} | ${cap.active_nodes} nodes | ${cap.pending_jobs} pending\n`;
    });

    // Alerts Section
    report += `\n🚨 ALERTS BY SEVERITY\n`;
    report += `─────────────────────────────────────────\n`;
    const criticalAlerts = alerts.filter(a => a.level === 'CRITICAL');
    const warningAlerts = alerts.filter(a => a.level === 'WARNING');
    const healthyAlerts = alerts.filter(a => a.level === 'HEALTHY');

    if (criticalAlerts.length > 0) {
      criticalAlerts.forEach(alert => report += `${alert.message}\n`);
    }
    if (warningAlerts.length > 0) {
      warningAlerts.forEach(alert => report += `${alert.message}\n`);
    }
    if (healthyAlerts.length === alerts.length) {
      report += `✅ All critical capabilities have healthy coverage\n`;
    }

    // Job Age Analysis  
    if (jobsAge.length > 0) {
      report += `\n⏰ PENDING JOB AGE ANALYSIS\n`;
      report += `─────────────────────────────────────────\n`;
      jobsAge.forEach(job => {
        const ageStatus = job.max_age_minutes > 240 ? '🚨' : job.max_age_minutes > 60 ? '⚠️ ' : '⏳';
        report += `${ageStatus} ${job.capability.padEnd(12)} | ${job.job_count} jobs | oldest: ${Math.round(job.max_age_minutes)}min\n`;
      });
    }

    return { report, maxLevel, criticalAlerts: criticalAlerts.length, warningAlerts: warningAlerts.length };
  }

  getStatusEmoji(level) {
    switch(level) {
      case 'CRITICAL': return '🚨';
      case 'WARNING': return '⚠️ ';
      case 'HEALTHY': return '✅';
      default: return '❓';
    }
  }

  async generateReport() {
    try {
      const [coverage, jobsAge] = await Promise.all([
        this.getCapabilityCoverage(),
        this.getPendingJobsAge()
      ]);

      const alertAnalysis = this.analyzeAlertLevel(coverage);
      const result = this.formatReport(coverage, jobsAge, alertAnalysis);
      
      return {
        ...result,
        timestamp: new Date().toISOString(),
        data: { coverage, jobsAge, alertAnalysis }
      };
    } catch (error) {
      return {
        report: `❌ ERROR: Failed to generate report - ${error.message}`,
        maxLevel: 'ERROR',
        error: error.message
      };
    }
  }

  close() {
    this.db.close();
  }
}

// CLI Usage
if (require.main === module) {
  const args = process.argv.slice(2);
  const outputFormat = args.includes('--json') ? 'json' : 'text';
  const exitOnAlert = args.includes('--exit-on-alert');

  const monitor = new CapabilityMonitor();
  
  monitor.generateReport().then(result => {
    if (outputFormat === 'json') {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(result.report);
    }

    monitor.close();

    // Exit with appropriate code for automation/alerting
    if (exitOnAlert) {
      if (result.maxLevel === 'CRITICAL') process.exit(2);
      if (result.maxLevel === 'WARNING') process.exit(1);
      process.exit(0);
    }
  }).catch(error => {
    console.error('❌ Monitor failed:', error);
    monitor.close();
    process.exit(3);
  });
}