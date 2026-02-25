#!/usr/bin/env node
/**
 * IC Mesh Performance Monitor
 * 
 * Tracks system performance metrics and identifies potential bottlenecks:
 * - Memory usage patterns
 * - Database query performance
 * - WebSocket connection health
 * - Job processing throughput
 * - API endpoint response times
 * 
 * Usage:
 *   node scripts/performance-monitor.js [options]
 *   
 * Options:
 *   --interval=<seconds>  Monitoring interval (default: 30)
 *   --duration=<minutes>  How long to monitor (default: continuous)
 *   --output=<file>       Save metrics to file (default: console)
 *   --alerts             Enable performance alerts
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const Database = require('better-sqlite3');

// Configuration
const MONITOR_INTERVAL = parseInt(process.argv.find(arg => arg.startsWith('--interval='))?.split('=')[1]) || 30;
const MONITOR_DURATION = parseInt(process.argv.find(arg => arg.startsWith('--duration='))?.split('=')[1]) || null;
const OUTPUT_FILE = process.argv.find(arg => arg.startsWith('--output='))?.split('=')[1] || null;
const ENABLE_ALERTS = process.argv.includes('--alerts');

const METRICS_FILE = OUTPUT_FILE || path.join(__dirname, '..', 'data', 'performance-metrics.jsonl');
const ALERT_THRESHOLDS = {
  memoryUsagePercent: 90,
  queryTimeMs: 1000,
  wsConnectionCount: 100,
  jobQueueLength: 50,
  responseTimeMs: 5000
};

let isMonitoring = false;
let startTime = Date.now();

function log(message, data = null) {
  const timestamp = new Date().toISOString();
  if (data) {
    console.log(`[${timestamp}] ${message}:`, JSON.stringify(data, null, 2));
  } else {
    console.log(`[${timestamp}] ${message}`);
  }
}

function saveMetric(metric) {
  if (!OUTPUT_FILE && !fs.existsSync(path.dirname(METRICS_FILE))) {
    fs.mkdirSync(path.dirname(METRICS_FILE), { recursive: true });
  }
  
  const metricLine = JSON.stringify({
    timestamp: new Date().toISOString(),
    ...metric
  }) + '\n';
  
  try {
    if (OUTPUT_FILE) {
      fs.appendFileSync(OUTPUT_FILE, metricLine);
    } else {
      fs.appendFileSync(METRICS_FILE, metricLine);
    }
  } catch (error) {
    console.error(`[WARN] Failed to save metrics to file: ${error.message}`);
    // Continue monitoring even if file save fails
    // Optionally log metrics to console as fallback
    if (process.env.NODE_ENV !== 'production') {
      console.log('[FALLBACK] Metric data:', JSON.stringify(metric, null, 2));
    }
  }
}

function getSystemMetrics() {
  const memUsage = process.memoryUsage();
  const cpuUsage = process.cpuUsage();
  
  return {
    memory: {
      rss: memUsage.rss,
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      external: memUsage.external,
      usagePercent: (memUsage.heapUsed / memUsage.heapTotal) * 100
    },
    cpu: {
      user: cpuUsage.user,
      system: cpuUsage.system
    },
    uptime: process.uptime()
  };
}

function getDatabaseMetrics() {
  const dbPath = path.join(__dirname, '..', 'data', 'mesh.db');
  
  if (!fs.existsSync(dbPath)) {
    return { available: false };
  }
  
  try {
    const db = new Database(dbPath, { readonly: true });
    
    // Measure query performance
    const queryStart = Date.now();
    const jobCount = db.prepare('SELECT COUNT(*) as count FROM jobs').get();
    const nodeCount = db.prepare('SELECT COUNT(*) as count FROM nodes WHERE lastSeen > datetime("now", "-5 minutes")').get();
    const queryTime = Date.now() - queryStart;
    
    // Get database size
    const stat = fs.statSync(dbPath);
    
    // Get table sizes
    const tableStats = db.prepare(`
      SELECT name, 
             (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=m.name) as exists
      FROM sqlite_master m WHERE type='table'
    `).all();
    
    db.close();
    
    return {
      available: true,
      queryTimeMs: queryTime,
      sizeBytes: stat.size,
      sizeMB: Math.round(stat.size / 1024 / 1024 * 100) / 100,
      tables: tableStats.length,
      jobs: {
        total: jobCount.count,
        pending: 0 // Could add more specific queries
      },
      nodes: {
        active: nodeCount.count
      }
    };
  } catch (error) {
    return {
      available: false,
      error: error.message
    };
  }
}

function getNetworkMetrics() {
  return new Promise((resolve) => {
    // Test API endpoint response time
    const startTime = Date.now();
    const req = http.request({
      hostname: 'localhost',
      port: 8333,
      path: '/status',
      method: 'GET',
      timeout: 5000
    }, (res) => {
      const responseTime = Date.now() - startTime;
      let data = '';
      
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const status = JSON.parse(data);
          resolve({
            available: true,
            responseTimeMs: responseTime,
            statusCode: res.statusCode,
            wsConnections: status.websocket?.connections || 0,
            meshStatus: status
          });
        } catch (error) {
          resolve({
            available: true,
            responseTimeMs: responseTime,
            statusCode: res.statusCode,
            parseError: error.message
          });
        }
      });
    });
    
    req.on('error', (error) => {
      resolve({
        available: false,
        error: error.message,
        responseTimeMs: Date.now() - startTime
      });
    });
    
    req.on('timeout', () => {
      req.destroy();
      resolve({
        available: false,
        error: 'Timeout',
        responseTimeMs: Date.now() - startTime
      });
    });
    
    req.end();
  });
}

function checkAlert(metric, value, threshold, message) {
  if (ENABLE_ALERTS && value > threshold) {
    const alert = {
      type: 'PERFORMANCE_ALERT',
      metric,
      value,
      threshold,
      message,
      timestamp: new Date().toISOString()
    };
    
    console.warn(`🚨 ALERT: ${message}`);
    saveMetric({ alert });
    
    return true;
  }
  return false;
}

async function collectMetrics() {
  log('📊 Collecting performance metrics...');
  
  const metrics = {
    system: getSystemMetrics(),
    database: getDatabaseMetrics(),
    network: await getNetworkMetrics()
  };
  
  // Check for alerts
  if (ENABLE_ALERTS) {
    checkAlert('memory', metrics.system.memory.usagePercent, ALERT_THRESHOLDS.memoryUsagePercent, 
      `High memory usage: ${metrics.system.memory.usagePercent.toFixed(1)}%`);
      
    if (metrics.database.available && metrics.database.queryTimeMs) {
      checkAlert('database', metrics.database.queryTimeMs, ALERT_THRESHOLDS.queryTimeMs,
        `Slow database queries: ${metrics.database.queryTimeMs}ms`);
    }
    
    if (metrics.network.available && metrics.network.responseTimeMs) {
      checkAlert('response', metrics.network.responseTimeMs, ALERT_THRESHOLDS.responseTimeMs,
        `Slow API responses: ${metrics.network.responseTimeMs}ms`);
    }
    
    if (metrics.network.wsConnections) {
      checkAlert('connections', metrics.network.wsConnections, ALERT_THRESHOLDS.wsConnectionCount,
        `High WebSocket connections: ${metrics.network.wsConnections}`);
    }
  }
  
  // Save metrics
  saveMetric({ performance: metrics });
  
  // Console output
  if (!OUTPUT_FILE) {
    console.log('\n=== PERFORMANCE METRICS ===');
    console.log(`Memory: ${metrics.system.memory.usagePercent.toFixed(1)}% (${Math.round(metrics.system.memory.heapUsed / 1024 / 1024)}MB used)`);
    console.log(`Database: ${metrics.database.available ? `${metrics.database.sizeMB}MB, ${metrics.database.queryTimeMs}ms query` : 'Unavailable'}`);
    console.log(`API: ${metrics.network.available ? `${metrics.network.responseTimeMs}ms response, ${metrics.network.wsConnections || 0} WS connections` : 'Unavailable'}`);
    console.log(`Jobs: ${metrics.database.jobs?.total || 0} total, ${metrics.database.nodes?.active || 0} active nodes`);
    console.log('===========================\n');
  }
  
  return metrics;
}

function generateReport() {
  if (!fs.existsSync(METRICS_FILE)) {
    log('No metrics file found');
    return;
  }
  
  const lines = fs.readFileSync(METRICS_FILE, 'utf8').trim().split('\n');
  const metrics = lines.map(line => {
    try {
      return JSON.parse(line);
    } catch (e) {
      return null;
    }
  }).filter(Boolean);
  
  if (metrics.length === 0) {
    log('No valid metrics found');
    return;
  }
  
  const performanceMetrics = metrics
    .filter(m => m.performance)
    .map(m => ({ timestamp: m.timestamp, ...m.performance }));
    
  const alerts = metrics.filter(m => m.alert);
  
  log('\n=== PERFORMANCE REPORT ===');
  log(`Metrics collected: ${performanceMetrics.length}`);
  log(`Alerts triggered: ${alerts.length}`);
  
  if (performanceMetrics.length > 0) {
    const memoryUsages = performanceMetrics.map(m => m.system.memory.usagePercent);
    const responseTimes = performanceMetrics.filter(m => m.network.responseTimeMs).map(m => m.network.responseTimeMs);
    const queryTimes = performanceMetrics.filter(m => m.database.queryTimeMs).map(m => m.database.queryTimeMs);
    
    log(`Memory usage: avg ${(memoryUsages.reduce((a, b) => a + b, 0) / memoryUsages.length).toFixed(1)}%, max ${Math.max(...memoryUsages).toFixed(1)}%`);
    
    if (responseTimes.length > 0) {
      log(`API response: avg ${(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length).toFixed(0)}ms, max ${Math.max(...responseTimes)}ms`);
    }
    
    if (queryTimes.length > 0) {
      log(`DB queries: avg ${(queryTimes.reduce((a, b) => a + b, 0) / queryTimes.length).toFixed(0)}ms, max ${Math.max(...queryTimes)}ms`);
    }
  }
  
  if (alerts.length > 0) {
    log('\n=== RECENT ALERTS ===');
    alerts.slice(-5).forEach(alert => {
      log(`${alert.timestamp}: ${alert.alert.message}`);
    });
  }
  
  log('==========================\n');
}

async function startMonitoring() {
  if (isMonitoring) {
    log('Monitoring already running');
    return;
  }
  
  isMonitoring = true;
  startTime = Date.now();
  
  log(`🚀 Starting performance monitoring (interval: ${MONITOR_INTERVAL}s${MONITOR_DURATION ? `, duration: ${MONITOR_DURATION}m` : ', continuous'})`);
  log(`📊 Metrics ${OUTPUT_FILE ? `saved to: ${OUTPUT_FILE}` : 'displayed on console'}`);
  
  if (ENABLE_ALERTS) {
    log('🚨 Performance alerts enabled');
  }
  
  // Initial metrics collection
  await collectMetrics();
  
  const interval = setInterval(async () => {
    if (!isMonitoring) {
      clearInterval(interval);
      return;
    }
    
    await collectMetrics();
    
    // Check if duration limit reached
    if (MONITOR_DURATION) {
      const elapsed = (Date.now() - startTime) / (1000 * 60); // minutes
      if (elapsed >= MONITOR_DURATION) {
        log(`⏱️ Monitoring duration (${MONITOR_DURATION}m) completed`);
        stopMonitoring();
        clearInterval(interval);
      }
    }
  }, MONITOR_INTERVAL * 1000);
  
  // Handle cleanup on exit
  process.on('SIGINT', () => {
    log('📊 Stopping monitoring...');
    clearInterval(interval);
    stopMonitoring();
    process.exit(0);
  });
}

function stopMonitoring() {
  isMonitoring = false;
  log('✅ Performance monitoring stopped');
  generateReport();
}

// Command line interface
const command = process.argv[2] || 'start';

switch (command) {
  case 'start':
    startMonitoring();
    break;
    
  case 'report':
    generateReport();
    break;
    
  case 'test':
    collectMetrics().then(() => {
      log('✅ Test metrics collection completed');
    });
    break;
    
  case 'help':
  default:
    console.log(`
IC Mesh Performance Monitor

Usage: node scripts/performance-monitor.js [command] [options]

Commands:
  start     - Start continuous performance monitoring (default)
  report    - Generate report from collected metrics
  test      - Run single metrics collection test

Options:
  --interval=<seconds>  Monitoring interval (default: 30)
  --duration=<minutes>  Monitoring duration (default: continuous) 
  --output=<file>       Save metrics to file (default: console + ${METRICS_FILE})
  --alerts              Enable performance alerts

Examples:
  node scripts/performance-monitor.js start --interval=10 --duration=60 --alerts
  node scripts/performance-monitor.js start --output=metrics.jsonl
  node scripts/performance-monitor.js report
  node scripts/performance-monitor.js test

Alert Thresholds:
  Memory usage: ${ALERT_THRESHOLDS.memoryUsagePercent}%
  Query time: ${ALERT_THRESHOLDS.queryTimeMs}ms
  Response time: ${ALERT_THRESHOLDS.responseTimeMs}ms
  WebSocket connections: ${ALERT_THRESHOLDS.wsConnectionCount}
`);
}