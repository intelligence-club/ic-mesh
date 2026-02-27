#!/usr/bin/env node
/**
 * Performance Monitoring Integration Test
 * 
 * Tests the PerformanceMonitor module functionality and provides
 * examples of how to integrate it with the IC Mesh server.
 * 
 * This test verifies:
 * - Basic performance tracking
 * - Alert generation
 * - Metric collection
 * - Health score calculation
 * - Integration patterns
 */

const PerformanceMonitor = require('../lib/performance-monitor');
const assert = require('assert');

class PerformanceMonitoringTest {
  constructor() {
    this.tests = [];
    this.passed = 0;
    this.failed = 0;
  }

  test(name, fn) {
    this.tests.push({ name, fn });
  }

  async run() {
    console.log('🧪 Performance Monitoring Test Suite\n');
    
    for (const { name, fn } of this.tests) {
      try {
        await fn();
        this.passed++;
        console.log(`✅ ${name}`);
      } catch (error) {
        this.failed++;
        console.log(`❌ ${name}`);
        console.log(`   Error: ${error.message}`);
      }

      // Brief delay between tests
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    console.log(`\n📊 Results: ${this.passed} passed, ${this.failed} failed`);
    process.exit(this.failed > 0 ? 1 : 0);
  }
}

// ===== TESTS =====

const suite = new PerformanceMonitoringTest();

suite.test('PerformanceMonitor initializes correctly', async () => {
  const monitor = new PerformanceMonitor({
    maxMetricsHistory: 100,
    alertThresholds: {
      responseTime: 1000,
      memoryUsage: 0.8
    }
  });

  assert(monitor.metrics, 'Should have metrics object');
  assert(monitor.options.alertThresholds.responseTime === 1000, 'Should set custom threshold');
  
  monitor.destroy();
});

suite.test('Request tracking works correctly', async () => {
  const monitor = new PerformanceMonitor();
  
  // Track some requests
  monitor.trackRequest('GET /status', Date.now() - 100, Date.now(), 200);
  monitor.trackRequest('GET /status', Date.now() - 50, Date.now(), 200);
  monitor.trackRequest('POST /jobs', Date.now() - 200, Date.now(), 201);

  const statusMetric = monitor.metrics.requests.get('GET /status_200');
  assert(statusMetric, 'Should track status requests');
  assert(statusMetric.count === 2, 'Should count multiple requests');
  assert(statusMetric.avgTime > 0, 'Should calculate average time');

  const jobsMetric = monitor.metrics.requests.get('POST /jobs_201');
  assert(jobsMetric, 'Should track different endpoints');
  assert(jobsMetric.count === 1, 'Should track single request');

  monitor.destroy();
});

suite.test('Database query tracking works', async () => {
  const monitor = new PerformanceMonitor();
  
  monitor.trackDatabaseQuery('SELECT * FROM jobs', 50);
  monitor.trackDatabaseQuery('SELECT * FROM nodes', 100);
  monitor.trackDatabaseQuery('INSERT INTO jobs', 200);

  assert(monitor.metrics.database.queryCount === 3, 'Should count queries');
  assert(monitor.metrics.database.totalTime === 350, 'Should sum query times');
  assert(monitor.metrics.database.queries.length === 3, 'Should store query details');

  monitor.destroy();
});

suite.test('Alert generation works', async () => {
  const monitor = new PerformanceMonitor({
    alertThresholds: {
      responseTime: 100,  // Very low threshold for testing
      dbQueryTime: 50
    }
  });

  let alertReceived = false;
  monitor.on('alert', (alert) => {
    alertReceived = true;
    assert(alert.type, 'Alert should have type');
    assert(alert.message, 'Alert should have message');
    assert(alert.timestamp, 'Alert should have timestamp');
  });

  // Should trigger slow request alert
  monitor.trackRequest('GET /slow', Date.now() - 200, Date.now(), 200);
  
  // Should trigger slow query alert  
  monitor.trackDatabaseQuery('SLOW SELECT', 100);

  // Give alerts time to process
  await new Promise(resolve => setTimeout(resolve, 10));

  assert(alertReceived, 'Should receive alerts');
  assert(monitor.metrics.alerts.length > 0, 'Should store alerts');

  monitor.destroy();
});

suite.test('WebSocket metrics tracking works', async () => {
  const monitor = new PerformanceMonitor();
  
  monitor.updateWebSocketMetrics(10, 5.2, 2);
  
  assert(monitor.metrics.websockets.connections === 10, 'Should track connections');
  assert(monitor.metrics.websockets.messagesPerSecond === 5.2, 'Should track message rate');
  assert(monitor.metrics.websockets.errors === 2, 'Should track errors');

  monitor.destroy();
});

suite.test('Job processing metrics work', async () => {
  const monitor = new PerformanceMonitor();
  
  monitor.trackJobProcessing('job1', 1500, true, 5);
  monitor.trackJobProcessing('job2', 2000, false, 4);

  assert(monitor.metrics.jobs.queueSize === 4, 'Should update queue size');
  assert(monitor.metrics.jobs.averageProcessingTime > 0, 'Should calculate average time');

  monitor.destroy();
});

suite.test('Performance report generation works', async () => {
  const monitor = new PerformanceMonitor();
  
  // Add some test data
  monitor.trackRequest('GET /test', Date.now() - 100, Date.now(), 200);
  monitor.trackDatabaseQuery('SELECT test', 50);
  monitor.updateWebSocketMetrics(5, 2.1, 0);
  monitor.trackJobProcessing('test-job', 1000, true, 3);

  const report = monitor.getPerformanceReport();

  assert(report.timestamp, 'Should have timestamp');
  assert(report.uptime >= 0, 'Should have uptime');
  assert(report.requests, 'Should have request metrics');
  assert(report.database, 'Should have database metrics');
  assert(report.websockets, 'Should have websocket metrics');
  assert(report.jobs, 'Should have job metrics');
  assert(report.system, 'Should have system metrics');
  assert(typeof report.healthScore === 'number', 'Should have health score');

  monitor.destroy();
});

suite.test('Health score calculation works', async () => {
  const monitor = new PerformanceMonitor({
    alertThresholds: {
      responseTime: 1000,
      memoryUsage: 0.8
    }
  });
  
  // Add good performance data
  monitor.trackRequest('GET /fast', Date.now() - 10, Date.now(), 200);
  monitor.trackRequest('GET /fast', Date.now() - 15, Date.now(), 200);

  const report = monitor.getPerformanceReport();
  assert(report.healthScore >= 80, `Health score should be good with fast requests, got ${report.healthScore}`);

  monitor.destroy();
});

suite.test('Export metrics works', async () => {
  const monitor = new PerformanceMonitor();
  
  monitor.trackRequest('GET /export', Date.now() - 50, Date.now(), 200);
  monitor.trackDatabaseQuery('SELECT export', 25);

  const exported = monitor.exportMetrics();

  assert(exported.timestamp, 'Should have timestamp');
  assert(exported.requests, 'Should export requests');
  assert(exported.database, 'Should export database metrics');
  assert(exported.websockets, 'Should export websocket metrics');
  assert(exported.jobs, 'Should export job metrics');
  assert(exported.system, 'Should export system metrics');

  monitor.destroy();
});

suite.test('Memory usage monitoring works', async () => {
  const monitor = new PerformanceMonitor({
    alertThresholds: {
      memoryUsage: 0.01  // Very low threshold to trigger alert
    }
  });

  let memoryAlertReceived = false;
  monitor.on('alert', (alert) => {
    if (alert.type === 'HIGH_MEMORY_USAGE') {
      memoryAlertReceived = true;
    }
  });

  // Force system metrics collection
  monitor.collectSystemMetrics();

  // Give alert time to process
  await new Promise(resolve => setTimeout(resolve, 10));

  assert(monitor.metrics.system.memoryUsage > 0, 'Should track memory usage');
  
  monitor.destroy();
});

suite.test('Error handling works correctly', async () => {
  const monitor = new PerformanceMonitor();
  
  // Track error responses
  monitor.trackRequest('GET /error', Date.now() - 50, Date.now(), 500);
  monitor.trackRequest('GET /normal', Date.now() - 30, Date.now(), 200);

  const errorMetric = monitor.metrics.requests.get('GET /error_500');
  assert(errorMetric.errors === 1, 'Should count errors');

  const normalMetric = monitor.metrics.requests.get('GET /normal_200');  
  assert(normalMetric.errors === 0, 'Should not count success as error');

  monitor.destroy();
});

suite.test('Integration example works', async () => {
  // Example of how to integrate with Express-like middleware
  const monitor = new PerformanceMonitor({
    alertThresholds: {
      responseTime: 500,
      memoryUsage: 0.8
    }
  });

  // Simulate middleware pattern
  function createTrackingMiddleware() {
    return (req, res, next) => {
      const startTime = Date.now();
      
      // Mock response object
      const originalEnd = res.end || (() => {});
      res.end = function() {
        const endTime = Date.now();
        const endpoint = `${req.method} ${req.url}`;
        monitor.trackRequest(endpoint, startTime, endTime, res.statusCode || 200);
        originalEnd.call(this);
      };
      
      if (next) next();
      return res;
    };
  }

  const trackingMiddleware = createTrackingMiddleware();

  // Simulate some requests
  const mockRequests = [
    { method: 'GET', url: '/status' },
    { method: 'POST', url: '/jobs' },
    { method: 'GET', url: '/nodes' }
  ];

  for (const reqData of mockRequests) {
    const req = reqData;
    const res = { statusCode: 200, end: () => {} };
    
    trackingMiddleware(req, res);
    
    // Simulate response time
    await new Promise(resolve => setTimeout(resolve, 10));
    res.end();
  }

  // Verify tracking worked
  assert(monitor.metrics.requests.size >= 3, 'Should track all requests');
  
  monitor.destroy();
});

// Run the tests
suite.run().catch(error => {
  console.error('Test suite failed:', error);
  process.exit(1);
});