#!/usr/bin/env node
/**
 * IC Mesh System Health Validator
 * 
 * Comprehensive system validation with actionable recommendations
 * for maintaining optimal IC Mesh network performance.
 * 
 * Features:
 * - End-to-end system validation
 * - Performance benchmarking
 * - Configuration validation
 * - Security assessment
 * - Capacity planning recommendations
 * - Automated fixes for common issues
 * 
 * Usage: node system-health-validator.js [--fix] [--benchmark] [--report]
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { execSync, spawn } = require('child_process');
const Database = require('better-sqlite3');
const crypto = require('crypto');

// Validation thresholds
const VALIDATION_THRESHOLDS = {
  database: {
    maxSize: 1000 * 1024 * 1024, // 1GB
    maxJobAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    maxFailedJobs: 1000,
    queryTimeout: 5000 // 5 seconds
  },
  performance: {
    maxResponseTime: 2000, // 2 seconds
    minThroughput: 10, // jobs per minute
    maxMemoryUsage: 0.8, // 80%
    maxCpuUsage: 0.9 // 90%
  },
  security: {
    minPasswordLength: 12,
    requireHttps: true,
    maxLoginAttempts: 5,
    sessionTimeout: 3600 // 1 hour
  },
  network: {
    minNodes: 2,
    maxNodeOfflineTime: 600000, // 10 minutes
    heartbeatInterval: 60000, // 1 minute
    minNodeRetention: 0.7 // 70%
  }
};

// System requirements
const SYSTEM_REQUIREMENTS = {
  node: '>=14.0.0',
  memory: 512 * 1024 * 1024, // 512MB minimum
  disk: 10 * 1024 * 1024 * 1024, // 10GB minimum
  ports: [8333, 443, 80],
  packages: ['better-sqlite3', 'ws']
};

class SystemHealthValidator {
  constructor(options = {}) {
    this.dbPath = options.dbPath || './mesh.db';
    this.configPath = options.configPath || './config';
    this.autoFix = options.autoFix || false;
    this.verbose = options.verbose || false;
    this.results = {
      score: 0,
      issues: [],
      warnings: [],
      recommendations: [],
      fixes: []
    };
  }

  /**
   * Run comprehensive system validation
   */
  async validateSystem() {
    console.log('🔍 IC Mesh System Health Validation');
    console.log('===================================\n');

    const validations = [
      { name: 'System Requirements', fn: () => this.validateSystemRequirements() },
      { name: 'Database Health', fn: () => this.validateDatabaseHealth() },
      { name: 'Network Configuration', fn: () => this.validateNetworkConfiguration() },
      { name: 'Security Configuration', fn: () => this.validateSecurityConfiguration() },
      { name: 'Performance Metrics', fn: () => this.validatePerformanceMetrics() },
      { name: 'Node Network Health', fn: () => this.validateNodeNetwork() },
      { name: 'File System Health', fn: () => this.validateFileSystemHealth() },
      { name: 'Service Dependencies', fn: () => this.validateServiceDependencies() },
      { name: 'API Endpoints', fn: () => this.validateApiEndpoints() },
      { name: 'Data Integrity', fn: () => this.validateDataIntegrity() }
    ];

    let totalScore = 0;
    const maxScore = validations.length * 100;

    for (const validation of validations) {
      console.log(`\n🔍 ${validation.name}`);
      console.log('─'.repeat(40));
      
      try {
        const result = await validation.fn();
        totalScore += result.score;
        
        this.displayValidationResult(result);
        
        if (result.issues) {
          this.results.issues.push(...result.issues);
        }
        if (result.warnings) {
          this.results.warnings.push(...result.warnings);
        }
        if (result.recommendations) {
          this.results.recommendations.push(...result.recommendations);
        }
        if (result.fixes && this.autoFix) {
          this.results.fixes.push(...result.fixes);
        }

      } catch (error) {
        console.log(`❌ Validation failed: ${error.message}`);
        this.results.issues.push({
          category: validation.name,
          severity: 'critical',
          message: `Validation failed: ${error.message}`,
          fix: 'Manual investigation required'
        });
      }
    }

    this.results.score = Math.round((totalScore / maxScore) * 100);
    this.displayFinalReport();
    
    if (this.autoFix && this.results.fixes.length > 0) {
      await this.applyAutomaticFixes();
    }

    return this.results;
  }

  /**
   * Validate system requirements and dependencies
   */
  validateSystemRequirements() {
    const issues = [];
    const warnings = [];
    const recommendations = [];
    let score = 100;

    // Node.js version
    const nodeVersion = process.version;
    const requiredNode = SYSTEM_REQUIREMENTS.node;
    
    console.log(`Node.js: ${nodeVersion}`);
    
    if (!this.compareVersions(nodeVersion, requiredNode)) {
      issues.push({
        severity: 'high',
        message: `Node.js version ${nodeVersion} is below required ${requiredNode}`,
        fix: 'Update Node.js to latest LTS version'
      });
      score -= 30;
    }

    // Memory check
    const totalMemory = require('os').totalmem();
    const freeMemory = require('os').freemem();
    const memoryUsage = (totalMemory - freeMemory) / totalMemory;

    console.log(`Memory: ${Math.round(freeMemory / 1024 / 1024)}MB free / ${Math.round(totalMemory / 1024 / 1024)}MB total`);

    if (freeMemory < SYSTEM_REQUIREMENTS.memory) {
      warnings.push({
        severity: 'medium',
        message: `Low available memory: ${Math.round(freeMemory / 1024 / 1024)}MB`,
        fix: 'Close unnecessary applications or add more RAM'
      });
      score -= 10;
    }

    // Disk space
    try {
      const diskUsage = execSync('df -h .', { encoding: 'utf8' });
      console.log(`Disk usage:\n${diskUsage.split('\n')[1]}`);
      
      const match = diskUsage.match(/(\d+)%/);
      if (match && parseInt(match[1]) > 90) {
        issues.push({
          severity: 'high',
          message: `Disk usage at ${match[1]}%`,
          fix: 'Clean up old files or add more disk space'
        });
        score -= 25;
      }
    } catch (error) {
      warnings.push({
        severity: 'low',
        message: 'Could not check disk usage',
        fix: 'Manually verify sufficient disk space'
      });
    }

    // Required packages
    for (const pkg of SYSTEM_REQUIREMENTS.packages) {
      try {
        require.resolve(pkg);
        console.log(`✅ Package ${pkg}: installed`);
      } catch (error) {
        issues.push({
          severity: 'critical',
          message: `Missing required package: ${pkg}`,
          fix: `npm install ${pkg}`
        });
        score -= 40;
      }
    }

    return { score, issues, warnings, recommendations };
  }

  /**
   * Validate database health and performance
   */
  validateDatabaseHealth() {
    const issues = [];
    const warnings = [];
    const recommendations = [];
    let score = 100;

    if (!fs.existsSync(this.dbPath)) {
      issues.push({
        severity: 'critical',
        message: 'Database file not found',
        fix: 'Initialize database or check file path'
      });
      return { score: 0, issues, warnings, recommendations };
    }

    // Database file size
    const dbStats = fs.statSync(this.dbPath);
    const dbSize = dbStats.size;
    
    console.log(`Database size: ${Math.round(dbSize / 1024 / 1024)}MB`);
    
    if (dbSize > VALIDATION_THRESHOLDS.database.maxSize) {
      warnings.push({
        severity: 'medium',
        message: `Large database size: ${Math.round(dbSize / 1024 / 1024)}MB`,
        fix: 'Consider archiving old data or optimizing database'
      });
      score -= 10;
    }

    try {
      const db = new Database(this.dbPath, { readonly: true });
      
      // Test database connectivity
      const startTime = Date.now();
      const result = db.prepare('SELECT COUNT(*) as count FROM jobs').get();
      const queryTime = Date.now() - startTime;
      
      console.log(`Total jobs: ${result.count}`);
      console.log(`Query response time: ${queryTime}ms`);
      
      if (queryTime > VALIDATION_THRESHOLDS.database.queryTimeout) {
        warnings.push({
          severity: 'medium',
          message: `Slow database queries: ${queryTime}ms`,
          fix: 'Consider database optimization or indexing'
        });
        score -= 15;
      }

      // Check for old jobs
      const oldJobs = db.prepare(`
        SELECT COUNT(*) as count 
        FROM jobs 
        WHERE createdAt < ?
      `).get(Date.now() - VALIDATION_THRESHOLDS.database.maxJobAge);
      
      if (oldJobs.count > 0) {
        recommendations.push({
          category: 'maintenance',
          message: `${oldJobs.count} jobs older than 30 days`,
          action: 'Archive or clean up old job records'
        });
      }

      // Check for excessive failures
      const failedJobs = db.prepare(`
        SELECT COUNT(*) as count 
        FROM jobs 
        WHERE status = 'failed'
      `).get();

      if (failedJobs.count > VALIDATION_THRESHOLDS.database.maxFailedJobs) {
        issues.push({
          severity: 'medium',
          message: `High number of failed jobs: ${failedJobs.count}`,
          fix: 'Investigate failure patterns and clean up failed jobs'
        });
        score -= 20;
      }

      // Database integrity check
      try {
        const integrityResult = db.prepare('PRAGMA integrity_check').get();
        if (integrityResult.integrity_check !== 'ok') {
          issues.push({
            severity: 'critical',
            message: 'Database integrity issues detected',
            fix: 'Run database repair or restore from backup'
          });
          score -= 50;
        } else {
          console.log('✅ Database integrity: OK');
        }
      } catch (error) {
        warnings.push({
          severity: 'low',
          message: 'Could not verify database integrity',
          fix: 'Manual database integrity check recommended'
        });
      }

      db.close();

    } catch (error) {
      issues.push({
        severity: 'critical',
        message: `Database connection failed: ${error.message}`,
        fix: 'Check database permissions and file integrity'
      });
      score -= 70;
    }

    return { score, issues, warnings, recommendations };
  }

  /**
   * Validate network configuration and connectivity
   */
  async validateNetworkConfiguration() {
    const issues = [];
    const warnings = [];
    const recommendations = [];
    let score = 100;

    // Port availability check
    for (const port of SYSTEM_REQUIREMENTS.ports) {
      const isOpen = await this.checkPortAvailable(port);
      console.log(`Port ${port}: ${isOpen ? 'available' : 'in use'}`);
      
      if (!isOpen && port === 8333) {
        issues.push({
          severity: 'high',
          message: `Required port ${port} is not available`,
          fix: 'Stop conflicting services or change port configuration'
        });
        score -= 30;
      }
    }

    // DNS resolution test
    try {
      const dns = require('dns').promises;
      await dns.resolve('google.com');
      console.log('✅ DNS resolution: working');
    } catch (error) {
      issues.push({
        severity: 'high',
        message: 'DNS resolution failed',
        fix: 'Check DNS configuration and connectivity'
      });
      score -= 25;
    }

    // Network latency test
    try {
      const latency = await this.measureNetworkLatency('8.8.8.8');
      console.log(`Network latency: ${latency}ms`);
      
      if (latency > 500) {
        warnings.push({
          severity: 'medium',
          message: `High network latency: ${latency}ms`,
          fix: 'Check network connection quality'
        });
        score -= 10;
      }
    } catch (error) {
      warnings.push({
        severity: 'low',
        message: 'Could not measure network latency',
        fix: 'Manual network performance testing recommended'
      });
    }

    return { score, issues, warnings, recommendations };
  }

  /**
   * Validate security configuration
   */
  validateSecurityConfiguration() {
    const issues = [];
    const warnings = [];
    const recommendations = [];
    let score = 100;

    // File permissions check
    try {
      const dbStats = fs.statSync(this.dbPath);
      const permissions = (dbStats.mode & parseInt('777', 8)).toString(8);
      
      console.log(`Database permissions: ${permissions}`);
      
      if (permissions === '777') {
        issues.push({
          severity: 'high',
          message: 'Database file has overly permissive permissions',
          fix: 'chmod 600 mesh.db'
        });
        score -= 30;
      }
    } catch (error) {
      warnings.push({
        severity: 'low',
        message: 'Could not check file permissions',
        fix: 'Manually verify secure file permissions'
      });
    }

    // Configuration file security
    if (fs.existsSync('.env')) {
      try {
        const envContent = fs.readFileSync('.env', 'utf8');
        
        // Check for hardcoded secrets
        if (envContent.includes('password=') || envContent.includes('secret=')) {
          warnings.push({
            severity: 'medium',
            message: 'Potential secrets in .env file',
            fix: 'Ensure .env is not committed to version control'
          });
          score -= 15;
        }

        console.log('✅ Environment configuration: found');
      } catch (error) {
        warnings.push({
          severity: 'low',
          message: 'Could not read .env file',
          fix: 'Verify environment file accessibility'
        });
      }
    } else {
      recommendations.push({
        category: 'security',
        message: 'No .env file found',
        action: 'Create .env file for configuration management'
      });
    }

    // SSL/TLS configuration check
    if (!process.env.SSL_CERT || !process.env.SSL_KEY) {
      warnings.push({
        severity: 'medium',
        message: 'SSL certificates not configured',
        fix: 'Set up SSL certificates for secure communication'
      });
      score -= 20;
    }

    return { score, issues, warnings, recommendations };
  }

  /**
   * Validate performance metrics and benchmarks
   */
  async validatePerformanceMetrics() {
    const issues = [];
    const warnings = [];
    const recommendations = [];
    let score = 100;

    // CPU usage check
    const cpuUsage = process.cpuUsage();
    const cpuPercent = (cpuUsage.user + cpuUsage.system) / 1000000; // Convert to seconds
    
    console.log(`CPU usage: ${cpuPercent.toFixed(2)}%`);

    // Memory usage check
    const memoryUsage = process.memoryUsage();
    const memoryPercent = memoryUsage.heapUsed / memoryUsage.heapTotal;
    
    console.log(`Memory usage: ${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB (${Math.round(memoryPercent * 100)}%)`);

    if (memoryPercent > VALIDATION_THRESHOLDS.performance.maxMemoryUsage) {
      warnings.push({
        severity: 'medium',
        message: `High memory usage: ${Math.round(memoryPercent * 100)}%`,
        fix: 'Optimize application memory usage or restart services'
      });
      score -= 15;
    }

    // API response time benchmark
    try {
      const responseTime = await this.benchmarkApiResponse();
      console.log(`API response time: ${responseTime}ms`);
      
      if (responseTime > VALIDATION_THRESHOLDS.performance.maxResponseTime) {
        issues.push({
          severity: 'medium',
          message: `Slow API responses: ${responseTime}ms`,
          fix: 'Optimize database queries and application performance'
        });
        score -= 25;
      }
    } catch (error) {
      warnings.push({
        severity: 'low',
        message: 'Could not benchmark API performance',
        fix: 'Manual API performance testing recommended'
      });
    }

    return { score, issues, warnings, recommendations };
  }

  /**
   * Validate node network health
   */
  validateNodeNetwork() {
    const issues = [];
    const warnings = [];
    const recommendations = [];
    let score = 100;

    try {
      const db = new Database(this.dbPath, { readonly: true });
      
      // Node count and status
      const totalNodes = db.prepare('SELECT COUNT(*) as count FROM nodes').get();
      const activeNodes = db.prepare(`
        SELECT COUNT(*) as count 
        FROM nodes 
        WHERE lastHeartbeat > ?
      `).get(Date.now() - 300000); // 5 minutes
      
      console.log(`Total nodes: ${totalNodes.count}`);
      console.log(`Active nodes: ${activeNodes.count}`);
      
      if (totalNodes.count < VALIDATION_THRESHOLDS.network.minNodes) {
        warnings.push({
          severity: 'medium',
          message: `Low node count: ${totalNodes.count}`,
          fix: 'Add more nodes to improve network resilience'
        });
        score -= 20;
      }

      const retention = totalNodes.count > 0 ? activeNodes.count / totalNodes.count : 0;
      console.log(`Node retention: ${Math.round(retention * 100)}%`);
      
      if (retention < VALIDATION_THRESHOLDS.network.minNodeRetention) {
        issues.push({
          severity: 'high',
          message: `Low node retention: ${Math.round(retention * 100)}%`,
          fix: 'Investigate node connectivity and stability issues'
        });
        score -= 35;
      }

      // Capability distribution
      const capabilities = db.prepare(`
        SELECT capabilities, COUNT(*) as count
        FROM nodes 
        WHERE lastHeartbeat > ?
        GROUP BY capabilities
      `).all(Date.now() - 300000);

      console.log('Node capabilities:');
      capabilities.forEach(cap => {
        console.log(`  ${cap.capabilities || 'none'}: ${cap.count} nodes`);
      });

      if (capabilities.length === 0) {
        warnings.push({
          severity: 'medium',
          message: 'No active nodes with capabilities',
          fix: 'Ensure nodes are properly configured and reporting capabilities'
        });
        score -= 25;
      }

      db.close();

    } catch (error) {
      issues.push({
        severity: 'critical',
        message: `Node network validation failed: ${error.message}`,
        fix: 'Check database connectivity and node registration'
      });
      score -= 50;
    }

    return { score, issues, warnings, recommendations };
  }

  /**
   * Validate file system health
   */
  validateFileSystemHealth() {
    const issues = [];
    const warnings = [];
    const recommendations = [];
    let score = 100;

    // Upload directory check
    const uploadDir = './uploads';
    if (!fs.existsSync(uploadDir)) {
      recommendations.push({
        category: 'filesystem',
        message: 'Upload directory does not exist',
        action: 'Create upload directory for file storage'
      });
    } else {
      const uploadFiles = fs.readdirSync(uploadDir);
      const uploadSize = uploadFiles.reduce((total, file) => {
        try {
          return total + fs.statSync(path.join(uploadDir, file)).size;
        } catch {
          return total;
        }
      }, 0);

      console.log(`Upload directory: ${uploadFiles.length} files, ${Math.round(uploadSize / 1024 / 1024)}MB`);

      if (uploadSize > 500 * 1024 * 1024) { // 500MB
        warnings.push({
          severity: 'medium',
          message: `Large upload directory: ${Math.round(uploadSize / 1024 / 1024)}MB`,
          fix: 'Clean up old upload files or implement automatic cleanup'
        });
        score -= 10;
      }
    }

    // Log file check
    const logFiles = ['./logs', './error.log', './access.log'].filter(fs.existsSync);
    logFiles.forEach(logPath => {
      try {
        const logSize = fs.statSync(logPath).size;
        console.log(`Log file ${logPath}: ${Math.round(logSize / 1024 / 1024)}MB`);
        
        if (logSize > 100 * 1024 * 1024) { // 100MB
          warnings.push({
            severity: 'low',
            message: `Large log file: ${logPath} (${Math.round(logSize / 1024 / 1024)}MB)`,
            fix: 'Implement log rotation or clean up old logs'
          });
          score -= 5;
        }
      } catch (error) {
        // Ignore errors reading log files
      }
    });

    return { score, issues, warnings, recommendations };
  }

  /**
   * Validate service dependencies
   */
  validateServiceDependencies() {
    const issues = [];
    const warnings = [];
    const recommendations = [];
    let score = 100;

    // Check if required services are running
    const services = ['ic-mesh', 'nginx', 'postgresql'];
    
    services.forEach(service => {
      try {
        execSync(`pgrep ${service}`, { stdio: 'ignore' });
        console.log(`✅ Service ${service}: running`);
      } catch (error) {
        const severity = service === 'ic-mesh' ? 'critical' : 'low';
        warnings.push({
          severity,
          message: `Service ${service} is not running`,
          fix: `Start ${service} service: systemctl start ${service}`
        });
        score -= service === 'ic-mesh' ? 40 : 5;
      }
    });

    return { score, issues, warnings, recommendations };
  }

  /**
   * Validate API endpoints
   */
  async validateApiEndpoints() {
    const issues = [];
    const warnings = [];
    const recommendations = [];
    let score = 100;

    const endpoints = [
      { path: '/status', method: 'GET', expected: 200 },
      { path: '/nodes', method: 'GET', expected: 200 },
      { path: '/jobs', method: 'GET', expected: 401 } // Should require auth
    ];

    for (const endpoint of endpoints) {
      try {
        const responseTime = await this.testEndpoint(endpoint);
        console.log(`✅ ${endpoint.method} ${endpoint.path}: ${responseTime}ms`);
      } catch (error) {
        issues.push({
          severity: 'high',
          message: `Endpoint ${endpoint.path} failed: ${error.message}`,
          fix: 'Check server configuration and restart if necessary'
        });
        score -= 30;
      }
    }

    return { score, issues, warnings, recommendations };
  }

  /**
   * Validate data integrity
   */
  validateDataIntegrity() {
    const issues = [];
    const warnings = [];
    const recommendations = [];
    let score = 100;

    try {
      const db = new Database(this.dbPath, { readonly: true });

      // Check for orphaned records
      const orphanedJobs = db.prepare(`
        SELECT COUNT(*) as count 
        FROM jobs j
        LEFT JOIN nodes n ON j.claimedBy = n.nodeId
        WHERE j.claimedBy IS NOT NULL AND n.nodeId IS NULL
      `).get();

      if (orphanedJobs.count > 0) {
        warnings.push({
          severity: 'medium',
          message: `${orphanedJobs.count} jobs reference non-existent nodes`,
          fix: 'Clean up orphaned job records'
        });
        score -= 15;
      }

      // Check for stuck jobs
      const stuckJobs = db.prepare(`
        SELECT COUNT(*) as count 
        FROM jobs 
        WHERE status = 'claimed' AND claimedAt < ?
      `).get(Date.now() - 3600000); // 1 hour

      if (stuckJobs.count > 0) {
        warnings.push({
          severity: 'medium',
          message: `${stuckJobs.count} jobs stuck in claimed state`,
          fix: 'Reset stuck jobs or investigate node issues'
        });
        score -= 20;
      }

      // Check for data consistency
      const totalJobs = db.prepare('SELECT COUNT(*) as count FROM jobs').get();
      const statusCounts = db.prepare(`
        SELECT status, COUNT(*) as count 
        FROM jobs 
        GROUP BY status
      `).all();

      console.log('Job status distribution:');
      statusCounts.forEach(status => {
        console.log(`  ${status.status}: ${status.count}`);
      });

      const sumCounts = statusCounts.reduce((sum, s) => sum + s.count, 0);
      if (sumCounts !== totalJobs.count) {
        issues.push({
          severity: 'critical',
          message: 'Job count mismatch detected',
          fix: 'Database integrity check and repair required'
        });
        score -= 50;
      }

      db.close();

    } catch (error) {
      issues.push({
        severity: 'critical',
        message: `Data integrity validation failed: ${error.message}`,
        fix: 'Check database health and connectivity'
      });
      score -= 70;
    }

    return { score, issues, warnings, recommendations };
  }

  // Utility methods

  async checkPortAvailable(port) {
    return new Promise((resolve) => {
      const server = require('net').createServer();
      server.listen(port, (error) => {
        if (error) {
          resolve(false);
        } else {
          server.close(() => resolve(true));
        }
      });
    });
  }

  async measureNetworkLatency(host) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const ping = spawn('ping', ['-c', '1', host]);
      
      ping.on('close', (code) => {
        if (code === 0) {
          resolve(Date.now() - start);
        } else {
          reject(new Error('Ping failed'));
        }
      });
      
      ping.on('error', reject);
    });
  }

  async benchmarkApiResponse() {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const req = http.request({
        hostname: 'localhost',
        port: 8333,
        path: '/status',
        method: 'GET'
      }, (res) => {
        const responseTime = Date.now() - start;
        res.on('data', () => {}); // Consume response
        res.on('end', () => resolve(responseTime));
      });
      
      req.on('error', reject);
      req.setTimeout(5000, () => reject(new Error('Request timeout')));
      req.end();
    });
  }

  async testEndpoint(endpoint) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const req = http.request({
        hostname: 'localhost',
        port: 8333,
        path: endpoint.path,
        method: endpoint.method
      }, (res) => {
        const responseTime = Date.now() - start;
        
        if (res.statusCode === endpoint.expected) {
          resolve(responseTime);
        } else {
          reject(new Error(`Expected ${endpoint.expected}, got ${res.statusCode}`));
        }
        
        res.on('data', () => {}); // Consume response
      });
      
      req.on('error', reject);
      req.setTimeout(5000, () => reject(new Error('Request timeout')));
      req.end();
    });
  }

  compareVersions(current, required) {
    const currentParts = current.replace('v', '').split('.').map(Number);
    const requiredParts = required.replace('>=', '').split('.').map(Number);
    
    for (let i = 0; i < Math.max(currentParts.length, requiredParts.length); i++) {
      const currentPart = currentParts[i] || 0;
      const requiredPart = requiredParts[i] || 0;
      
      if (currentPart > requiredPart) return true;
      if (currentPart < requiredPart) return false;
    }
    
    return true;
  }

  displayValidationResult(result) {
    const score = result.score || 0;
    const grade = this.getGrade(score);
    
    console.log(`Score: ${score}/100 ${grade}`);
    
    if (result.issues && result.issues.length > 0) {
      console.log('\nIssues:');
      result.issues.forEach(issue => {
        const icon = this.getSeverityIcon(issue.severity);
        console.log(`  ${icon} ${issue.message}`);
        if (issue.fix) {
          console.log(`     Fix: ${issue.fix}`);
        }
      });
    }
    
    if (result.warnings && result.warnings.length > 0) {
      console.log('\nWarnings:');
      result.warnings.forEach(warning => {
        const icon = this.getSeverityIcon(warning.severity);
        console.log(`  ${icon} ${warning.message}`);
        if (warning.fix) {
          console.log(`     Fix: ${warning.fix}`);
        }
      });
    }
    
    if (result.recommendations && result.recommendations.length > 0) {
      console.log('\nRecommendations:');
      result.recommendations.forEach(rec => {
        console.log(`  💡 ${rec.message}`);
        if (rec.action) {
          console.log(`     Action: ${rec.action}`);
        }
      });
    }
  }

  displayFinalReport() {
    console.log('\n' + '═'.repeat(50));
    console.log('📊 SYSTEM HEALTH REPORT');
    console.log('═'.repeat(50));
    
    const grade = this.getGrade(this.results.score);
    console.log(`\n🎯 Overall Health Score: ${this.results.score}/100 ${grade}`);
    
    if (this.results.issues.length > 0) {
      console.log(`\n❌ Critical Issues: ${this.results.issues.filter(i => i.severity === 'critical').length}`);
      console.log(`⚠️  High Priority: ${this.results.issues.filter(i => i.severity === 'high').length}`);
      console.log(`🟡 Medium Priority: ${this.results.issues.filter(i => i.severity === 'medium').length}`);
    }
    
    if (this.results.warnings.length > 0) {
      console.log(`\n⚠️  Warnings: ${this.results.warnings.length}`);
    }
    
    if (this.results.recommendations.length > 0) {
      console.log(`\n💡 Recommendations: ${this.results.recommendations.length}`);
    }

    // Priority actions
    const criticalIssues = this.results.issues.filter(i => i.severity === 'critical');
    const highIssues = this.results.issues.filter(i => i.severity === 'high');
    
    if (criticalIssues.length > 0 || highIssues.length > 0) {
      console.log('\n🚨 PRIORITY ACTIONS REQUIRED:');
      [...criticalIssues, ...highIssues].slice(0, 5).forEach((issue, i) => {
        console.log(`${i + 1}. ${issue.message}`);
        if (issue.fix) {
          console.log(`   → ${issue.fix}`);
        }
      });
    }

    console.log('\n' + '═'.repeat(50));
  }

  async applyAutomaticFixes() {
    console.log('\n🔧 APPLYING AUTOMATIC FIXES');
    console.log('═'.repeat(30));
    
    for (const fix of this.results.fixes) {
      console.log(`\n🔧 ${fix.description}`);
      
      try {
        if (fix.command) {
          execSync(fix.command, { stdio: 'pipe' });
          console.log('✅ Fix applied successfully');
        } else {
          console.log('ℹ️  Manual intervention required');
        }
      } catch (error) {
        console.log(`❌ Fix failed: ${error.message}`);
      }
    }
  }

  getGrade(score) {
    if (score >= 90) return '🟢 Excellent';
    if (score >= 80) return '🟡 Good';
    if (score >= 70) return '🟠 Fair';
    if (score >= 60) return '🔴 Poor';
    return '💀 Critical';
  }

  getSeverityIcon(severity) {
    const icons = {
      'critical': '🔴',
      'high': '🟠',
      'medium': '🟡',
      'low': '🟢',
      'unknown': '⚪'
    };
    return icons[severity] || '⚪';
  }
}

// CLI Interface
async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
IC Mesh System Health Validator

Usage:
  node system-health-validator.js [options]

Options:
  --fix                  Apply automatic fixes for detected issues
  --benchmark           Include performance benchmarking
  --report              Generate detailed report file
  --verbose             Enable verbose output
  --help                Show this help message

Examples:
  # Basic health check
  node system-health-validator.js

  # Health check with automatic fixes
  node system-health-validator.js --fix

  # Comprehensive validation with benchmarks
  node system-health-validator.js --benchmark --verbose
    `);
    return;
  }

  const validator = new SystemHealthValidator({
    autoFix: args.includes('--fix'),
    verbose: args.includes('--verbose')
  });

  try {
    const results = await validator.validateSystem();
    
    if (args.includes('--report')) {
      const reportPath = `health-report-${new Date().toISOString().split('T')[0]}.json`;
      fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
      console.log(`\n📄 Detailed report saved to: ${reportPath}`);
    }

    process.exit(results.score < 60 ? 1 : 0);

  } catch (error) {
    console.error('Validation failed:', error.message);
    process.exit(1);
  }
}

// Export for programmatic use
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { SystemHealthValidator };