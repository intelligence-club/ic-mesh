#!/usr/bin/env node
/**
 * IC Mesh Server with Performance Monitoring - Example Integration
 * 
 * This example shows how to integrate the PerformanceMonitor module
 * into the existing IC Mesh server with minimal changes.
 * 
 * Key integration points:
 * 1. Initialize performance monitor
 * 2. Track HTTP requests
 * 3. Track database queries
 * 4. Monitor WebSocket connections
 * 5. Set up alerting
 * 6. Generate periodic reports
 */

const http = require('http');
const PerformanceMonitor = require('../lib/performance-monitor');

// Initialize performance monitor with production-ready settings
const perfMonitor = new PerformanceMonitor({
  alertThresholds: {
    responseTime: 2000,    // Alert on requests > 2 seconds
    memoryUsage: 0.85,     // Alert when memory > 85%
    dbQueryTime: 1000,     // Alert on DB queries > 1 second
    wsConnectionCount: 500 // Alert when > 500 WebSocket connections
  },
  collectInterval: 60000   // Collect system metrics every minute
});

// Set up alert handling
perfMonitor.on('alert', (alert) => {
  console.error(`🚨 PERFORMANCE ALERT [${alert.severity.toUpperCase()}]: ${alert.message}`);
  
  // In production, you might send these to:
  // - Slack/Discord
  // - Email
  // - PagerDuty
  // - Logging service
  
  if (alert.severity === 'error') {
    // Handle critical alerts immediately
    console.error(`   📊 Alert data:`, JSON.stringify(alert.data, null, 2));
  }
});

// Track WebSocket connections
let wsConnectionCount = 0;

// Example: HTTP request tracking middleware
function trackHTTPRequests(req, res) {
  const startTime = Date.now();
  const originalEnd = res.end;
  
  res.end = function(...args) {
    const endTime = Date.now();
    const endpoint = `${req.method} ${req.url.split('?')[0]}`;
    const responseSize = res.getHeader('content-length') || 0;
    
    perfMonitor.trackRequest(endpoint, startTime, endTime, res.statusCode, responseSize);
    originalEnd.apply(this, args);
  };
}

// Example: Database query wrapper
function trackDatabaseQuery(queryName, queryFunction) {
  return function(...args) {
    const startTime = Date.now();
    
    try {
      const result = queryFunction.apply(this, args);
      const duration = Date.now() - startTime;
      
      perfMonitor.trackDatabaseQuery(queryName, duration);
      return result;
      
    } catch (error) {
      const duration = Date.now() - startTime;
      perfMonitor.trackDatabaseQuery(queryName, duration, error);
      throw error;
    }
  };
}

// Example: WebSocket connection tracking
function trackWebSocketConnection() {
  wsConnectionCount++;
  perfMonitor.updateWebSocketMetrics(wsConnectionCount);
}

function trackWebSocketDisconnection() {
  wsConnectionCount = Math.max(0, wsConnectionCount - 1);
  perfMonitor.updateWebSocketMetrics(wsConnectionCount);
}

// Example: Job processing tracking
function trackJobProcessing(jobId, processingFunction, queueSize) {
  return async function(...args) {
    const startTime = Date.now();
    let success = true;
    
    try {
      const result = await processingFunction.apply(this, args);
      return result;
      
    } catch (error) {
      success = false;
      throw error;
      
    } finally {
      const duration = Date.now() - startTime;
      perfMonitor.trackJobProcessing(jobId, duration, success, queueSize);
    }
  };
}

// Example: Simple HTTP server with monitoring
const server = http.createServer((req, res) => {
  // Track all requests
  trackHTTPRequests(req, res);
  
  // Simple router
  const url = new URL(req.url, `http://${req.headers.host}`);
  
  if (url.pathname === '/status') {
    // Simulate database query
    const queryStart = Date.now();
    // In real server: const status = db.prepare('SELECT ...').get();
    setTimeout(() => {
      perfMonitor.trackDatabaseQuery('SELECT status', Date.now() - queryStart);
    }, 10);
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      timestamp: Date.now(),
      monitoring: 'enabled'
    }));
    
  } else if (url.pathname === '/performance-report') {
    // Return performance monitoring report
    const report = perfMonitor.getPerformanceReport();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(report, null, 2));
    
  } else if (url.pathname === '/performance-metrics') {
    // Return raw metrics for external monitoring systems
    const metrics = perfMonitor.exportMetrics();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(metrics, null, 2));
    
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

// Set up periodic performance reporting
setInterval(() => {
  const report = perfMonitor.getPerformanceReport();
  
  console.log('\n📊 Performance Summary:');
  console.log(`   Health Score: ${report.healthScore}/100`);
  console.log(`   Total Requests: ${report.requests.total}`);
  console.log(`   Avg Response Time: ${report.requests.averageResponseTime.toFixed(1)}ms`);
  console.log(`   Memory Usage: ${report.system.memoryUsagePercent}%`);
  console.log(`   Uptime: ${report.system.uptimeHours}h`);
  
  if (report.alerts.length > 0) {
    console.log(`   🚨 Recent Alerts: ${report.alerts.length}`);
  }
  
}, 5 * 60 * 1000); // Every 5 minutes

// Example integration patterns for existing IC Mesh components

// 1. Database statements wrapper
const mockDatabase = {
  prepare: (query) => ({
    get: trackDatabaseQuery(`SELECT: ${query.substring(0, 50)}`, () => ({ result: 'mock' })),
    all: trackDatabaseQuery(`SELECT ALL: ${query.substring(0, 50)}`, () => [{ result: 'mock' }]),
    run: trackDatabaseQuery(`MODIFY: ${query.substring(0, 50)}`, () => ({ changes: 1 }))
  })
};

// 2. WebSocket server wrapper
function createMonitoredWebSocketServer() {
  return {
    on: (event, handler) => {
      if (event === 'connection') {
        return handler; // Would wrap handler to track connections
      }
      return handler;
    },
    // Other WebSocket server methods...
  };
}

// 3. Job processing wrapper
function createMonitoredJobProcessor() {
  let queueSize = 0;
  
  return {
    processJob: async (jobId, jobData) => {
      queueSize = Math.max(0, queueSize - 1); // Job taken from queue
      
      const trackedProcessor = trackJobProcessing(
        jobId,
        async () => {
          // Simulate job processing
          await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 500));
          return { success: true, result: 'processed' };
        },
        queueSize
      );
      
      return await trackedProcessor();
    },
    
    addToQueue: (jobId) => {
      queueSize++;
      perfMonitor.trackJobProcessing(jobId, 0, true, queueSize); // Just update queue size
    }
  };
}

// Start the example server
const PORT = process.env.PORT || 8334; // Different port to avoid conflicts

server.listen(PORT, () => {
  console.log(`🚀 IC Mesh Server with Performance Monitoring running on port ${PORT}`);
  console.log(`📊 Performance reports available at:`);
  console.log(`   http://localhost:${PORT}/performance-report`);
  console.log(`   http://localhost:${PORT}/performance-metrics`);
  console.log(`\n💡 Integration examples:`);
  console.log(`   - HTTP requests are automatically tracked`);
  console.log(`   - Database queries use trackDatabaseQuery wrapper`);
  console.log(`   - WebSocket connections tracked with helper functions`);
  console.log(`   - Job processing wrapped with performance monitoring`);
  console.log(`   - Alerts logged to console (configure for production)`);
  console.log(`   - Periodic performance summaries every 5 minutes`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('\n🛑 Shutting down performance monitoring...');
  perfMonitor.destroy();
  server.close();
});

process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down performance monitoring...');
  perfMonitor.destroy();
  server.close();
  process.exit(0);
});

module.exports = { perfMonitor, server };