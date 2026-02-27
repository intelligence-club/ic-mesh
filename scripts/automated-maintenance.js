#!/usr/bin/env node

/**
 * Automated Maintenance System for IC Mesh
 * 
 * Performs routine maintenance tasks to keep the system healthy:
 * - Database cleanup (old failed jobs, test pollution)
 * - Log rotation and cleanup
 * - Health monitoring and alerting
 * - Performance optimization
 * - Security auditing
 * 
 * Can be run manually or scheduled via cron for hands-off operation
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Configuration
const CONFIG = {
  // Database cleanup thresholds
  MAX_FAILED_JOBS_AGE_HOURS: 24,      // Remove failed jobs older than 24h
  MAX_COMPLETED_JOBS_AGE_DAYS: 7,     // Archive completed jobs older than 7 days
  MAX_TOTAL_JOBS: 1000,               // Keep database under 1000 jobs
  
  // Log management
  MAX_LOG_FILE_SIZE_MB: 50,           // Rotate logs over 50MB
  MAX_LOG_FILES: 5,                   // Keep 5 historical log files
  
  // Performance thresholds
  MAX_RESPONSE_TIME_MS: 500,          // Alert if API response > 500ms
  MIN_DISK_SPACE_GB: 5,               // Alert if disk space < 5GB
  
  // Notification settings
  ALERT_EMAIL: process.env.ALERT_EMAIL || null,
  WEBHOOK_URL: process.env.MAINTENANCE_WEBHOOK || null,
  
  // Safety limits
  DRY_RUN: process.argv.includes('--dry-run'),
  VERBOSE: process.argv.includes('--verbose') || process.argv.includes('-v')
};

class MaintenanceSystem {
  constructor() {
    this.startTime = Date.now();
    this.results = {
      tasksCompleted: 0,
      warnings: [],
      errors: [],
      metrics: {}
    };
  }
  
  log(message, level = 'info') {
    const timestamp = new Date().toISOString();
    const prefix = {
      info: '✅',
      warn: '⚠️ ',
      error: '❌',
      debug: '🔍'
    }[level] || 'ℹ️ ';
    
    if (level !== 'debug' || CONFIG.VERBOSE) {
      console.log(`${prefix} [${timestamp}] ${message}`);
    }
    
    if (level === 'warn') this.results.warnings.push(message);
    if (level === 'error') this.results.errors.push(message);
  }
  
  async runTask(name, taskFn) {
    this.log(`Starting: ${name}`, 'debug');
    const startTime = Date.now();
    
    try {
      if (CONFIG.DRY_RUN) {
        this.log(`[DRY RUN] Would execute: ${name}`, 'debug');
        return { success: true, dryRun: true };
      }
      
      const result = await taskFn();
      const duration = Date.now() - startTime;
      
      this.log(`Completed: ${name} (${duration}ms)`);
      this.results.tasksCompleted++;
      
      return { success: true, duration, ...result };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.log(`Failed: ${name} - ${error.message}`, 'error');
      return { success: false, error: error.message, duration };
    }
  }
  
  // Database maintenance tasks
  async cleanupDatabase() {
    const dbPath = path.join(__dirname, '..', 'mesh.db');
    if (!fs.existsSync(dbPath)) {
      return { message: 'No database found', cleaned: 0 };
    }
    
    const Database = require('better-sqlite3');
    const db = new Database(dbPath);
    
    try {
      // Get current stats
      const beforeStats = {
        total: db.prepare('SELECT COUNT(*) as count FROM jobs').get().count,
        failed: db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'failed'").get().count,
        completed: db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'completed'").get().count
      };
      
      let cleanedCount = 0;
      
      // Remove old failed jobs
      const failedCutoff = Date.now() - (CONFIG.MAX_FAILED_JOBS_AGE_HOURS * 60 * 60 * 1000);
      const cleanFailedResult = db.prepare(`
        DELETE FROM jobs 
        WHERE status = 'failed' 
        AND createdAt < ?
      `).run(failedCutoff);
      cleanedCount += cleanFailedResult.changes;
      
      // Archive old completed jobs (move to archive table if over limit)
      const completedCutoff = Date.now() - (CONFIG.MAX_COMPLETED_JOBS_AGE_DAYS * 24 * 60 * 60 * 1000);
      const oldCompleted = db.prepare(`
        SELECT COUNT(*) as count FROM jobs 
        WHERE status = 'completed' 
        AND createdAt < ?
      `).get(completedCutoff);
      
      if (oldCompleted.count > 0) {
        // Create archive table if it doesn't exist
        db.prepare(`
          CREATE TABLE IF NOT EXISTS jobs_archive (
            jobId TEXT PRIMARY KEY,
            type TEXT,
            payload TEXT,
            status TEXT,
            createdAt INTEGER,
            completedAt INTEGER,
            nodeId TEXT,
            earnings REAL,
            archived_at INTEGER DEFAULT (unixepoch() * 1000)
          )
        `).run();
        
        // Move old completed jobs to archive
        db.prepare(`
          INSERT OR IGNORE INTO jobs_archive 
          SELECT *, ? as archived_at FROM jobs 
          WHERE status = 'completed' AND createdAt < ?
        `).run(Date.now(), completedCutoff);
        
        // Delete from main table
        const archiveResult = db.prepare(`
          DELETE FROM jobs 
          WHERE status = 'completed' 
          AND createdAt < ?
        `).run(completedCutoff);
        cleanedCount += archiveResult.changes;
      }
      
      // If still over total job limit, remove oldest completed jobs
      const currentTotal = db.prepare('SELECT COUNT(*) as count FROM jobs').get().count;
      if (currentTotal > CONFIG.MAX_TOTAL_JOBS) {
        const excessCount = currentTotal - CONFIG.MAX_TOTAL_JOBS;
        const excessResult = db.prepare(`
          DELETE FROM jobs 
          WHERE jobId IN (
            SELECT jobId FROM jobs 
            WHERE status = 'completed' 
            ORDER BY createdAt ASC 
            LIMIT ?
          )
        `).run(excessCount);
        cleanedCount += excessResult.changes;
      }
      
      // Vacuum database to reclaim space
      db.prepare('VACUUM').run();
      
      const afterStats = {
        total: db.prepare('SELECT COUNT(*) as count FROM jobs').get().count,
        failed: db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'failed'").get().count,
        completed: db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'completed'").get().count
      };
      
      this.results.metrics.database = {
        before: beforeStats,
        after: afterStats,
        cleaned: cleanedCount
      };
      
      return {
        message: `Cleaned ${cleanedCount} jobs (${beforeStats.total} → ${afterStats.total})`,
        cleaned: cleanedCount,
        before: beforeStats,
        after: afterStats
      };
      
    } finally {
      db.close();
    }
  }
  
  // Log file management
  async rotateLogs() {
    const logDir = path.join(__dirname, '..', 'logs');
    if (!fs.existsSync(logDir)) {
      return { message: 'No logs directory found', rotated: 0 };
    }
    
    let rotatedCount = 0;
    const logFiles = fs.readdirSync(logDir).filter(f => f.endsWith('.log'));
    
    for (const logFile of logFiles) {
      const logPath = path.join(logDir, logFile);
      const stats = fs.statSync(logPath);
      const sizeMB = stats.size / 1024 / 1024;
      
      if (sizeMB > CONFIG.MAX_LOG_FILE_SIZE_MB) {
        // Rotate log file
        const baseName = path.basename(logFile, '.log');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const rotatedName = `${baseName}-${timestamp}.log`;
        
        fs.renameSync(logPath, path.join(logDir, rotatedName));
        fs.writeFileSync(logPath, ''); // Create new empty log
        
        rotatedCount++;
        this.log(`Rotated log: ${logFile} (${sizeMB.toFixed(1)}MB → ${rotatedName})`);
      }
    }
    
    // Clean up old rotated logs
    const rotatedLogs = fs.readdirSync(logDir)
      .filter(f => f.includes('-') && f.endsWith('.log'))
      .map(f => ({
        name: f,
        path: path.join(logDir, f),
        mtime: fs.statSync(path.join(logDir, f)).mtime
      }))
      .sort((a, b) => b.mtime - a.mtime);
    
    let deletedCount = 0;
    if (rotatedLogs.length > CONFIG.MAX_LOG_FILES) {
      const toDelete = rotatedLogs.slice(CONFIG.MAX_LOG_FILES);
      for (const log of toDelete) {
        fs.unlinkSync(log.path);
        deletedCount++;
        this.log(`Deleted old log: ${log.name}`);
      }
    }
    
    return {
      message: `Log maintenance: ${rotatedCount} rotated, ${deletedCount} deleted`,
      rotated: rotatedCount,
      deleted: deletedCount
    };
  }
  
  // System health checks
  async checkSystemHealth() {
    const health = {
      api: null,
      database: null,
      disk: null,
      memory: null
    };
    
    // API response time check
    try {
      const startTime = Date.now();
      execSync('curl -s -m 5 http://localhost:8333/health', { stdio: 'pipe' });
      health.api = {
        responseTime: Date.now() - startTime,
        status: 'healthy'
      };
      
      if (health.api.responseTime > CONFIG.MAX_RESPONSE_TIME_MS) {
        this.log(`API response time high: ${health.api.responseTime}ms`, 'warn');
      }
    } catch (error) {
      health.api = { status: 'unhealthy', error: error.message };
      this.log(`API health check failed: ${error.message}`, 'warn');
    }
    
    // Database connectivity
    try {
      const dbPath = path.join(__dirname, '..', 'mesh.db');
      if (fs.existsSync(dbPath)) {
        const Database = require('better-sqlite3');
        const db = new Database(dbPath, { readonly: true });
        const result = db.prepare('SELECT COUNT(*) as count FROM jobs').get();
        db.close();
        
        health.database = {
          status: 'healthy',
          jobCount: result.count
        };
      } else {
        health.database = { status: 'missing', message: 'Database file not found' };
      }
    } catch (error) {
      health.database = { status: 'error', error: error.message };
      this.log(`Database health check failed: ${error.message}`, 'warn');
    }
    
    // Disk space check
    try {
      const df = execSync('df . | tail -1', { encoding: 'utf8' });
      const parts = df.trim().split(/\s+/);
      const availableKB = parseInt(parts[3]);
      const availableGB = availableKB / 1024 / 1024;
      
      health.disk = {
        availableGB: Math.round(availableGB * 10) / 10,
        status: availableGB > CONFIG.MIN_DISK_SPACE_GB ? 'healthy' : 'low'
      };
      
      if (availableGB <= CONFIG.MIN_DISK_SPACE_GB) {
        this.log(`Low disk space: ${health.disk.availableGB}GB remaining`, 'warn');
      }
    } catch (error) {
      health.disk = { status: 'error', error: error.message };
    }
    
    // Memory usage
    try {
      const free = execSync('free -m | grep "^Mem"', { encoding: 'utf8' });
      const parts = free.trim().split(/\s+/);
      const total = parseInt(parts[1]);
      const used = parseInt(parts[2]);
      const available = parseInt(parts[6]);
      
      health.memory = {
        totalMB: total,
        usedMB: used,
        availableMB: available,
        usagePercent: Math.round((used / total) * 100),
        status: available > 512 ? 'healthy' : 'low'
      };
      
      if (health.memory.usagePercent > 90) {
        this.log(`High memory usage: ${health.memory.usagePercent}%`, 'warn');
      }
    } catch (error) {
      health.memory = { status: 'error', error: error.message };
    }
    
    this.results.metrics.health = health;
    return { message: 'Health check completed', health };
  }
  
  // Security audit
  async securityAudit() {
    const issues = [];
    
    // Check for exposed config files
    const sensitiveFiles = ['.env', 'node-config.json', 'config.json'];
    for (const file of sensitiveFiles) {
      const filePath = path.join(__dirname, '..', file);
      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        // Check if file is readable by others (octal 044)
        if (stats.mode & 0o044) {
          issues.push(`${file} is readable by others (permissions: ${stats.mode.toString(8)})`);
        }
      }
    }
    
    // Check for default credentials
    const envPath = path.join(__dirname, '..', '.env');
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8');
      if (envContent.includes('password123') || envContent.includes('admin') || envContent.includes('secret')) {
        issues.push('Possible default credentials found in .env file');
      }
    }
    
    // Check for large log files (potential DoS)
    const logDir = path.join(__dirname, '..', 'logs');
    if (fs.existsSync(logDir)) {
      const logFiles = fs.readdirSync(logDir);
      for (const logFile of logFiles) {
        const logPath = path.join(logDir, logFile);
        const stats = fs.statSync(logPath);
        if (stats.size > 100 * 1024 * 1024) { // > 100MB
          issues.push(`Large log file detected: ${logFile} (${Math.round(stats.size / 1024 / 1024)}MB)`);
        }
      }
    }
    
    if (issues.length > 0) {
      for (const issue of issues) {
        this.log(`Security issue: ${issue}`, 'warn');
      }
    }
    
    return {
      message: `Security audit: ${issues.length} issues found`,
      issues,
      status: issues.length === 0 ? 'clean' : 'issues_found'
    };
  }
  
  // Performance optimization
  async optimizePerformance() {
    const optimizations = [];
    
    // Clear temp files
    const tempDir = path.join(__dirname, '..', 'temp');
    if (fs.existsSync(tempDir)) {
      const tempFiles = fs.readdirSync(tempDir);
      let deletedCount = 0;
      
      for (const file of tempFiles) {
        const filePath = path.join(tempDir, file);
        const stats = fs.statSync(filePath);
        
        // Delete files older than 1 hour
        if (Date.now() - stats.mtime.getTime() > 60 * 60 * 1000) {
          fs.unlinkSync(filePath);
          deletedCount++;
        }
      }
      
      if (deletedCount > 0) {
        optimizations.push(`Cleaned ${deletedCount} temporary files`);
      }
    }
    
    // Restart services if memory usage is high
    const health = this.results.metrics.health;
    if (health && health.memory && health.memory.usagePercent > 85) {
      optimizations.push('High memory usage detected - consider service restart');
    }
    
    return {
      message: `Performance optimization: ${optimizations.length} actions taken`,
      optimizations
    };
  }
  
  // Generate maintenance report
  generateReport() {
    const duration = Date.now() - this.startTime;
    const report = {
      timestamp: new Date().toISOString(),
      duration: `${Math.round(duration / 1000)}s`,
      summary: {
        tasksCompleted: this.results.tasksCompleted,
        warnings: this.results.warnings.length,
        errors: this.results.errors.length
      },
      metrics: this.results.metrics,
      warnings: this.results.warnings,
      errors: this.results.errors,
      dryRun: CONFIG.DRY_RUN
    };
    
    // Save report to file
    const reportPath = path.join(__dirname, '..', 'logs', `maintenance-${Date.now()}.json`);
    try {
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
      this.log(`Report saved: ${reportPath}`);
    } catch (error) {
      this.log(`Failed to save report: ${error.message}`, 'error');
    }
    
    return report;
  }
  
  // Main execution
  async run() {
    this.log(`🔧 Starting automated maintenance ${CONFIG.DRY_RUN ? '(DRY RUN)' : ''}`);
    
    // Run all maintenance tasks
    await this.runTask('Database Cleanup', () => this.cleanupDatabase());
    await this.runTask('Log Rotation', () => this.rotateLogs());
    await this.runTask('Health Check', () => this.checkSystemHealth());
    await this.runTask('Security Audit', () => this.securityAudit());
    await this.runTask('Performance Optimization', () => this.optimizePerformance());
    
    // Generate final report
    const report = this.generateReport();
    
    // Print summary
    this.log('🎉 Maintenance completed');
    this.log(`📊 Summary: ${report.summary.tasksCompleted} tasks, ${report.summary.warnings} warnings, ${report.summary.errors} errors`);
    
    if (report.summary.errors > 0) {
      this.log('❌ Errors occurred during maintenance', 'error');
      process.exit(1);
    }
    
    if (report.summary.warnings > 0) {
      this.log('⚠️  Warnings generated during maintenance', 'warn');
    }
    
    return report;
  }
}

// CLI execution
if (require.main === module) {
  const maintenance = new MaintenanceSystem();
  maintenance.run().catch(error => {
    console.error('💥 Maintenance failed:', error);
    process.exit(1);
  });
}

module.exports = MaintenanceSystem;