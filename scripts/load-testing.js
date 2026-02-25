#!/usr/bin/env node
/**
 * Load Testing & Performance Verification Toolkit
 * 
 * Comprehensive performance testing suite for IC Mesh infrastructure
 * including API endpoints, WebSocket connections, database operations,
 * and system resource utilization under various load conditions.
 * 
 * Features:
 * - API endpoint load testing with realistic scenarios
 * - WebSocket connection stress testing
 * - Database performance benchmarking
 * - Resource utilization monitoring
 * - Bottleneck identification and analysis
 * - Performance regression detection
 * - Scalability planning and recommendations
 * - Real-world scenario simulation
 * - Performance reporting and visualization
 * - SLA compliance verification
 */

const http = require('http');
const https = require('https');
const { WebSocket } = require('ws');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const os = require('os');

class LoadTester {
  constructor(config = {}) {
    this.config = {
      baseUrl: config.baseUrl || process.env.TEST_URL || 'http://localhost:8333',
      wsUrl: config.wsUrl || process.env.WS_URL || 'ws://localhost:8333/ws',
      maxConcurrency: config.maxConcurrency || 100,
      testDuration: config.testDuration || 60000, // 1 minute
      rampUpTime: config.rampUpTime || 10000, // 10 seconds
      thinkTime: config.thinkTime || 1000, // 1 second between requests
      ...config
    };

    this.metrics = {
      requests: [],
      wsConnections: [],
      errors: [],
      system: [],
      performance: {
        throughput: 0,
        latency: { min: 0, max: 0, avg: 0, p95: 0, p99: 0 },
        errorRate: 0,
        concurrentUsers: 0
      }
    };

    this.activeConnections = new Map();
    this.testStartTime = 0;
    this.testEndTime = 0;
    this.isRunning = false;
  }

  // ===== LOAD TEST SCENARIOS =====
  async runLoadTest(scenario = 'comprehensive') {
    console.log('🚀 Starting Load Testing & Performance Verification');
    console.log('==================================================\n');

    this.testStartTime = Date.now();
    this.isRunning = true;

    try {
      console.log(`📊 Test Configuration:`);
      console.log(`   Base URL: ${this.config.baseUrl}`);
      console.log(`   Max Concurrency: ${this.config.maxConcurrency}`);
      console.log(`   Test Duration: ${this.config.testDuration}ms`);
      console.log(`   Ramp-up Time: ${this.config.rampUpTime}ms`);
      console.log(`   Scenario: ${scenario}\n`);

      // Start system monitoring
      this.startSystemMonitoring();

      switch (scenario) {
        case 'comprehensive':
          await this.runComprehensiveTest();
          break;
        case 'api-stress':
          await this.runAPIStressTest();
          break;
        case 'websocket-stress':
          await this.runWebSocketStressTest();
          break;
        case 'database-stress':
          await this.runDatabaseStressTest();
          break;
        case 'spike-test':
          await this.runSpikeTest();
          break;
        case 'endurance':
          await this.runEnduranceTest();
          break;
        default:
          await this.runComprehensiveTest();
      }

      await this.cleanup();
      await this.generateReport();

    } catch (error) {
      console.error(`❌ Load test failed: ${error.message}`);
      await this.cleanup();
    } finally {
      this.isRunning = false;
      this.testEndTime = Date.now();
    }
  }

  async runComprehensiveTest() {
    console.log('🎯 Running Comprehensive Load Test');
    console.log('==================================\n');

    const phases = [
      { name: 'Warm-up', users: 10, duration: 15000 },
      { name: 'Steady State', users: 50, duration: 30000 },
      { name: 'Peak Load', users: this.config.maxConcurrency, duration: 20000 },
      { name: 'Cool-down', users: 25, duration: 15000 }
    ];

    for (const phase of phases) {
      console.log(`📈 Phase: ${phase.name} (${phase.users} concurrent users, ${phase.duration}ms)`);
      
      await this.runPhase(phase.users, phase.duration, {
        apiLoad: 0.6,     // 60% API requests
        wsLoad: 0.3,      // 30% WebSocket traffic
        jobSubmission: 0.1 // 10% job submissions
      });

      // Brief rest between phases
      await this.sleep(2000);
    }
  }

  async runAPIStressTest() {
    console.log('🔥 API Stress Test - Maximum Throughput');
    console.log('=======================================\n');

    const endpoints = [
      { path: '/status', weight: 0.3, method: 'GET' },
      { path: '/nodes', weight: 0.2, method: 'GET' },
      { path: '/jobs/available', weight: 0.2, method: 'GET' },
      { path: '/jobs', weight: 0.2, method: 'POST', payload: this.generateJobPayload },
      { path: '/nodes/register', weight: 0.1, method: 'POST', payload: this.generateNodePayload }
    ];

    await this.executeStressTest('API', async (userId) => {
      const endpoint = this.selectWeightedEndpoint(endpoints);
      return await this.makeAPIRequest(endpoint, userId);
    });
  }

  async runWebSocketStressTest() {
    console.log('⚡ WebSocket Stress Test - Connection Stability');
    console.log('===============================================\n');

    await this.executeStressTest('WebSocket', async (userId) => {
      return await this.establishWebSocketConnection(userId);
    });
  }

  async runDatabaseStressTest() {
    console.log('💾 Database Stress Test - Query Performance');
    console.log('===========================================\n');

    const dbOperations = [
      { name: 'node_query', weight: 0.3 },
      { name: 'job_query', weight: 0.3 },
      { name: 'job_create', weight: 0.2 },
      { name: 'ledger_update', weight: 0.2 }
    ];

    await this.executeStressTest('Database', async (userId) => {
      const operation = this.selectWeightedOperation(dbOperations);
      return await this.executeDatabaseOperation(operation, userId);
    });
  }

  async runSpikeTest() {
    console.log('📈 Spike Test - Sudden Load Increase');
    console.log('====================================\n');

    console.log('💡 Baseline load (10 users)...');
    await this.runPhase(10, 10000, { apiLoad: 1.0 });

    console.log('🚀 SPIKE! Jumping to maximum load...');
    await this.runPhase(this.config.maxConcurrency, 30000, { apiLoad: 1.0 });

    console.log('📉 Returning to baseline...');
    await this.runPhase(10, 10000, { apiLoad: 1.0 });
  }

  async runEnduranceTest() {
    console.log('⏰ Endurance Test - Extended Load');
    console.log('=================================\n');

    const enduranceDuration = 300000; // 5 minutes
    console.log(`🔄 Running sustained load for ${enduranceDuration/1000} seconds...`);

    await this.runPhase(50, enduranceDuration, { 
      apiLoad: 0.5, 
      wsLoad: 0.3, 
      jobSubmission: 0.2 
    });
  }

  // ===== CORE LOAD TESTING ENGINE =====
  async executeStressTest(testType, userFunction) {
    const users = [];
    const startTime = Date.now();

    // Ramp up users gradually
    const rampUpInterval = this.config.rampUpTime / this.config.maxConcurrency;
    
    for (let i = 0; i < this.config.maxConcurrency; i++) {
      setTimeout(async () => {
        const userId = `${testType}_user_${i}`;
        users.push(this.runVirtualUser(userId, userFunction));
      }, i * rampUpInterval);
    }

    // Wait for test duration
    await this.sleep(this.config.testDuration);
    
    // Signal all users to stop
    this.isRunning = false;
    
    // Wait for all users to complete
    await Promise.allSettled(users);
    
    const endTime = Date.now();
    console.log(`✅ ${testType} stress test completed in ${endTime - startTime}ms\n`);
  }

  async runPhase(concurrentUsers, duration, loadDistribution) {
    const users = [];
    const startTime = Date.now();
    
    this.isRunning = true;

    for (let i = 0; i < concurrentUsers; i++) {
      const userId = `phase_user_${i}`;
      users.push(this.runVirtualUser(userId, async (uid) => {
        return await this.executeUserScenario(uid, loadDistribution);
      }));
      
      // Gradual ramp-up
      if (i > 0 && i % 10 === 0) {
        await this.sleep(100);
      }
    }

    // Run for specified duration
    await this.sleep(duration);
    
    this.isRunning = false;
    await Promise.allSettled(users);
    
    console.log(`   ✅ Phase completed: ${concurrentUsers} users, ${Date.now() - startTime}ms\n`);
  }

  async runVirtualUser(userId, userFunction) {
    const userMetrics = {
      userId,
      requests: 0,
      errors: 0,
      totalLatency: 0,
      startTime: Date.now()
    };

    try {
      while (this.isRunning) {
        const requestStart = Date.now();
        
        try {
          const result = await userFunction(userId);
          const latency = Date.now() - requestStart;
          
          userMetrics.requests++;
          userMetrics.totalLatency += latency;
          
          this.recordMetric('request', {
            userId,
            latency,
            timestamp: Date.now(),
            success: true,
            result
          });

          // Think time between requests
          if (this.config.thinkTime > 0) {
            await this.sleep(this.config.thinkTime);
          }
          
        } catch (error) {
          userMetrics.errors++;
          this.recordMetric('error', {
            userId,
            error: error.message,
            timestamp: Date.now()
          });
        }
      }
    } finally {
      userMetrics.endTime = Date.now();
      this.recordMetric('user_session', userMetrics);
    }
  }

  async executeUserScenario(userId, loadDistribution) {
    const random = Math.random();
    
    if (random < loadDistribution.apiLoad) {
      return await this.executeRandomAPICall(userId);
    } else if (random < loadDistribution.apiLoad + loadDistribution.wsLoad) {
      return await this.executeWebSocketAction(userId);
    } else {
      return await this.executeJobSubmission(userId);
    }
  }

  // ===== API TESTING FUNCTIONS =====
  async executeRandomAPICall(userId) {
    const endpoints = [
      { path: '/status', method: 'GET' },
      { path: '/nodes', method: 'GET' },
      { path: '/jobs/available', method: 'GET' }
    ];

    const endpoint = endpoints[Math.floor(Math.random() * endpoints.length)];
    return await this.makeAPIRequest(endpoint, userId);
  }

  async makeAPIRequest(endpoint, userId) {
    return new Promise((resolve, reject) => {
      const url = new URL(endpoint.path, this.config.baseUrl);
      const options = {
        method: endpoint.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': userId
        }
      };

      const request = http.request(url, options, (response) => {
        let data = '';
        response.on('data', chunk => data += chunk);
        response.on('end', () => {
          resolve({
            statusCode: response.statusCode,
            headers: response.headers,
            body: data,
            endpoint: endpoint.path
          });
        });
      });

      request.on('error', reject);
      request.setTimeout(10000, () => {
        request.destroy();
        reject(new Error('Request timeout'));
      });

      if (endpoint.payload) {
        const payload = typeof endpoint.payload === 'function' 
          ? endpoint.payload(userId) 
          : endpoint.payload;
        request.write(JSON.stringify(payload));
      }

      request.end();
    });
  }

  // ===== WEBSOCKET TESTING =====
  async executeWebSocketAction(userId) {
    if (this.activeConnections.has(userId)) {
      // Send message on existing connection
      const ws = this.activeConnections.get(userId);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'node.heartbeat',
          nodeId: userId,
          timestamp: Date.now()
        }));
        return { action: 'heartbeat_sent', userId };
      }
    } else {
      // Establish new connection
      return await this.establishWebSocketConnection(userId);
    }
  }

  async establishWebSocketConnection(userId) {
    return new Promise((resolve, reject) => {
      const wsUrl = `${this.config.wsUrl}?nodeId=${userId}`;
      const ws = new WebSocket(wsUrl);
      
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('WebSocket connection timeout'));
      }, 10000);

      ws.on('open', () => {
        clearTimeout(timeout);
        this.activeConnections.set(userId, ws);
        
        ws.on('message', (data) => {
          this.recordMetric('ws_message', {
            userId,
            message: data.toString(),
            timestamp: Date.now()
          });
        });

        ws.on('close', () => {
          this.activeConnections.delete(userId);
        });

        resolve({ action: 'connection_established', userId });
      });

      ws.on('error', (error) => {
        clearTimeout(timeout);
        this.activeConnections.delete(userId);
        reject(error);
      });
    });
  }

  // ===== JOB SUBMISSION TESTING =====
  async executeJobSubmission(userId) {
    const jobTypes = ['transcribe', 'ocr', 'pdf-extract'];
    const jobType = jobTypes[Math.floor(Math.random() * jobTypes.length)];
    
    const jobPayload = {
      type: jobType,
      payload: this.generateJobPayload(jobType, userId),
      requirements: { capability: jobType }
    };

    return await this.makeAPIRequest({
      path: '/jobs',
      method: 'POST',
      payload: jobPayload
    }, userId);
  }

  generateJobPayload(jobType = 'transcribe', userId) {
    const payloads = {
      transcribe: {
        audio_url: `https://example.com/test-audio-${userId}-${Date.now()}.wav`,
        language: 'en',
        format: 'json'
      },
      ocr: {
        image_url: `https://example.com/test-image-${userId}-${Date.now()}.jpg`,
        language: 'eng',
        format: 'txt'
      },
      'pdf-extract': {
        pdf_url: `https://example.com/test-doc-${userId}-${Date.now()}.pdf`,
        extract_tables: true,
        format: 'json'
      }
    };

    return payloads[jobType] || payloads.transcribe;
  }

  generateNodePayload(userId) {
    return {
      nodeId: `test-node-${userId}-${Date.now()}`,
      capabilities: ['transcription', 'ocr'],
      cpuCores: 4,
      ramMB: 8192,
      region: 'test'
    };
  }

  // ===== DATABASE PERFORMANCE TESTING =====
  async executeDatabaseOperation(operation, userId) {
    // Simulate database operations by making API calls that trigger DB queries
    switch (operation.name) {
      case 'node_query':
        return await this.makeAPIRequest({ path: '/nodes', method: 'GET' }, userId);
        
      case 'job_query':
        return await this.makeAPIRequest({ path: '/jobs/available', method: 'GET' }, userId);
        
      case 'job_create':
        return await this.executeJobSubmission(userId);
        
      case 'ledger_update':
        // Simulate ledger operation through job completion
        return await this.makeAPIRequest({ path: '/status', method: 'GET' }, userId);
        
      default:
        return await this.makeAPIRequest({ path: '/status', method: 'GET' }, userId);
    }
  }

  // ===== SYSTEM MONITORING =====
  startSystemMonitoring() {
    this.systemMonitorInterval = setInterval(() => {
      this.recordSystemMetrics();
    }, 5000); // Every 5 seconds
  }

  recordSystemMetrics() {
    const usage = process.cpuUsage();
    const memUsage = process.memoryUsage();
    
    this.recordMetric('system', {
      timestamp: Date.now(),
      cpu: {
        user: usage.user / 1000000, // Convert to milliseconds
        system: usage.system / 1000000
      },
      memory: {
        rss: memUsage.rss / 1024 / 1024, // Convert to MB
        heapUsed: memUsage.heapUsed / 1024 / 1024,
        heapTotal: memUsage.heapTotal / 1024 / 1024,
        external: memUsage.external / 1024 / 1024
      },
      loadAverage: os.loadavg(),
      uptime: process.uptime()
    });
  }

  // ===== PERFORMANCE ANALYSIS =====
  analyzePerformance() {
    console.log('📊 Performance Analysis');
    console.log('=======================\n');

    const requests = this.metrics.requests;
    const errors = this.metrics.errors;

    if (requests.length === 0) {
      console.log('❌ No request data to analyze\n');
      return null;
    }

    // Calculate latency statistics
    const latencies = requests.map(r => r.latency).sort((a, b) => a - b);
    const totalRequests = requests.length;
    const successfulRequests = requests.filter(r => r.success).length;
    const testDurationSeconds = (this.testEndTime - this.testStartTime) / 1000;

    const performance = {
      totalRequests,
      successfulRequests,
      errorCount: errors.length,
      errorRate: (errors.length / totalRequests) * 100,
      testDuration: testDurationSeconds,
      throughput: totalRequests / testDurationSeconds,
      latency: {
        min: latencies[0] || 0,
        max: latencies[latencies.length - 1] || 0,
        avg: latencies.reduce((sum, l) => sum + l, 0) / latencies.length,
        p50: this.percentile(latencies, 50),
        p95: this.percentile(latencies, 95),
        p99: this.percentile(latencies, 99)
      }
    };

    // Display results
    console.log(`⚡ Throughput: ${performance.throughput.toFixed(2)} requests/second`);
    console.log(`📊 Total Requests: ${performance.totalRequests}`);
    console.log(`✅ Successful: ${performance.successfulRequests}`);
    console.log(`❌ Errors: ${performance.errorCount} (${performance.errorRate.toFixed(2)}%)`);
    console.log('');
    
    console.log('⏱️ Latency Distribution:');
    console.log(`   Min: ${performance.latency.min}ms`);
    console.log(`   Avg: ${performance.latency.avg.toFixed(2)}ms`);
    console.log(`   P50: ${performance.latency.p50}ms`);
    console.log(`   P95: ${performance.latency.p95}ms`);
    console.log(`   P99: ${performance.latency.p99}ms`);
    console.log(`   Max: ${performance.latency.max}ms\n`);

    this.metrics.performance = performance;
    
    return performance;
  }

  identifyBottlenecks() {
    console.log('🔍 Bottleneck Analysis');
    console.log('======================\n');

    const bottlenecks = [];
    const performance = this.metrics.performance;

    // Latency bottlenecks
    if (performance.latency.p95 > 1000) {
      bottlenecks.push({
        type: 'HIGH_LATENCY',
        severity: 'HIGH',
        description: 'P95 latency exceeds 1000ms',
        impact: 'Poor user experience',
        recommendation: 'Optimize database queries and add caching'
      });
    }

    // Throughput bottlenecks
    if (performance.throughput < 10) {
      bottlenecks.push({
        type: 'LOW_THROUGHPUT',
        severity: 'MEDIUM',
        description: 'Throughput below 10 requests/second',
        impact: 'Limited scalability',
        recommendation: 'Optimize request handling and add horizontal scaling'
      });
    }

    // Error rate bottlenecks
    if (performance.errorRate > 5) {
      bottlenecks.push({
        type: 'HIGH_ERROR_RATE',
        severity: 'CRITICAL',
        description: `Error rate ${performance.errorRate.toFixed(1)}% exceeds 5% threshold`,
        impact: 'Service reliability issues',
        recommendation: 'Investigate and fix error causes immediately'
      });
    }

    // System resource bottlenecks
    const systemMetrics = this.metrics.system;
    if (systemMetrics.length > 0) {
      const avgMemUsage = systemMetrics.reduce((sum, m) => sum + m.memory.heapUsed, 0) / systemMetrics.length;
      if (avgMemUsage > 512) { // 512MB threshold
        bottlenecks.push({
          type: 'HIGH_MEMORY_USAGE',
          severity: 'MEDIUM',
          description: `Average memory usage ${avgMemUsage.toFixed(1)}MB exceeds threshold`,
          impact: 'Potential memory leaks or inefficient memory usage',
          recommendation: 'Profile memory usage and optimize allocation'
        });
      }
    }

    // Display bottlenecks
    if (bottlenecks.length === 0) {
      console.log('✅ No significant bottlenecks detected\n');
    } else {
      bottlenecks.forEach((bottleneck, i) => {
        console.log(`${i + 1}. ${bottleneck.type} (${bottleneck.severity})`);
        console.log(`   📋 ${bottleneck.description}`);
        console.log(`   💥 Impact: ${bottleneck.impact}`);
        console.log(`   💡 Recommendation: ${bottleneck.recommendation}\n`);
      });
    }

    return bottlenecks;
  }

  // ===== SLA COMPLIANCE CHECKING =====
  checkSLACompliance() {
    console.log('📋 SLA Compliance Check');
    console.log('=======================\n');

    const slaTargets = {
      availability: 99.5, // 99.5% uptime
      latencyP95: 500,    // P95 latency under 500ms
      latencyP99: 1000,   // P99 latency under 1000ms
      errorRate: 1.0,     // Error rate under 1%
      throughput: 50      // Minimum 50 requests/second
    };

    const performance = this.metrics.performance;
    const compliance = {};

    // Calculate availability (simplified)
    const uptime = performance.errorRate < 50 ? 100 : (100 - performance.errorRate);
    compliance.availability = {
      target: slaTargets.availability,
      actual: uptime,
      compliant: uptime >= slaTargets.availability
    };

    // Check latency targets
    compliance.latencyP95 = {
      target: slaTargets.latencyP95,
      actual: performance.latency.p95,
      compliant: performance.latency.p95 <= slaTargets.latencyP95
    };

    compliance.latencyP99 = {
      target: slaTargets.latencyP99,
      actual: performance.latency.p99,
      compliant: performance.latency.p99 <= slaTargets.latencyP99
    };

    // Check error rate
    compliance.errorRate = {
      target: slaTargets.errorRate,
      actual: performance.errorRate,
      compliant: performance.errorRate <= slaTargets.errorRate
    };

    // Check throughput
    compliance.throughput = {
      target: slaTargets.throughput,
      actual: performance.throughput,
      compliant: performance.throughput >= slaTargets.throughput
    };

    // Display compliance results
    Object.entries(compliance).forEach(([metric, data]) => {
      const status = data.compliant ? '✅ PASS' : '❌ FAIL';
      const unit = metric.includes('latency') ? 'ms' : 
                  metric === 'errorRate' ? '%' : 
                  metric === 'throughput' ? 'req/s' : '%';
      
      console.log(`${status} ${metric}: ${data.actual.toFixed(2)}${unit} (target: ${data.target}${unit})`);
    });

    const overallCompliance = Object.values(compliance).every(c => c.compliant);
    console.log(`\n🎯 Overall SLA Compliance: ${overallCompliance ? '✅ PASS' : '❌ FAIL'}\n`);

    return { compliance, overall: overallCompliance };
  }

  // ===== SCALABILITY RECOMMENDATIONS =====
  generateScalabilityRecommendations() {
    console.log('🚀 Scalability Recommendations');
    console.log('==============================\n');

    const performance = this.metrics.performance;
    const recommendations = [];

    // Based on current performance, suggest scaling strategies
    if (performance.throughput < 100) {
      recommendations.push({
        priority: 'HIGH',
        title: 'Horizontal Scaling Implementation',
        description: 'Current throughput suggests need for load balancing across multiple instances',
        impact: 'Could increase throughput by 300-500%',
        effort: 'Medium',
        timeline: '2-3 weeks'
      });
    }

    if (performance.latency.p95 > 200) {
      recommendations.push({
        priority: 'MEDIUM',
        title: 'Database Query Optimization',
        description: 'High P95 latency indicates database performance bottlenecks',
        impact: 'Could reduce latency by 40-60%',
        effort: 'Low-Medium',
        timeline: '1-2 weeks'
      });
    }

    if (performance.errorRate > 2) {
      recommendations.push({
        priority: 'CRITICAL',
        title: 'Error Handling and Resilience',
        description: 'High error rate requires immediate attention to stability',
        impact: 'Critical for production readiness',
        effort: 'High',
        timeline: '1 week'
      });
    }

    recommendations.push({
      priority: 'LOW',
      title: 'Caching Layer Implementation',
      description: 'Add Redis or similar for frequently accessed data',
      impact: 'Could reduce database load by 50-70%',
      effort: 'Medium',
      timeline: '2-4 weeks'
    });

    recommendations.push({
      priority: 'MEDIUM',
      title: 'CDN for Static Assets',
      description: 'Implement CDN for file uploads and downloads',
      impact: 'Reduced server load and improved global performance',
      effort: 'Low',
      timeline: '1 week'
    });

    // Display recommendations
    recommendations.forEach((rec, i) => {
      console.log(`${i + 1}. ${rec.title} (${rec.priority})`);
      console.log(`   📋 ${rec.description}`);
      console.log(`   💥 Impact: ${rec.impact}`);
      console.log(`   ⚡ Effort: ${rec.effort}, Timeline: ${rec.timeline}\n`);
    });

    return recommendations;
  }

  // ===== REPORTING =====
  async generateReport() {
    console.log('📄 Load Testing Report Generation');
    console.log('=================================\n');

    const performance = this.analyzePerformance();
    if (!performance) return;

    const bottlenecks = this.identifyBottlenecks();
    const slaCompliance = this.checkSLACompliance();
    const scalabilityRecs = this.generateScalabilityRecommendations();

    const report = {
      timestamp: new Date().toISOString(),
      testConfiguration: this.config,
      testDuration: this.testEndTime - this.testStartTime,
      performance,
      bottlenecks,
      slaCompliance,
      scalabilityRecommendations: scalabilityRecs,
      rawMetrics: {
        requestCount: this.metrics.requests.length,
        errorCount: this.metrics.errors.length,
        wsConnectionCount: this.metrics.wsConnections.length,
        systemMetricCount: this.metrics.system.length
      },
      summary: this.generateExecutiveSummary(performance, slaCompliance, bottlenecks)
    };

    // Export report
    const reportPath = path.join(__dirname, '..', 'data', 
      `load-test-report-${new Date().toISOString().split('T')[0]}.json`);
    
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    
    console.log(`📊 Load testing report exported to: ${reportPath}`);
    console.log('\n🎯 Test Summary:');
    console.log(`   Duration: ${(report.testDuration / 1000).toFixed(1)}s`);
    console.log(`   Requests: ${performance.totalRequests}`);
    console.log(`   Throughput: ${performance.throughput.toFixed(2)} req/s`);
    console.log(`   Error Rate: ${performance.errorRate.toFixed(2)}%`);
    console.log(`   P95 Latency: ${performance.latency.p95}ms`);
    console.log(`   SLA Compliance: ${slaCompliance.overall ? 'PASS' : 'FAIL'}\n`);

    return report;
  }

  generateExecutiveSummary(performance, slaCompliance, bottlenecks) {
    const criticalIssues = bottlenecks.filter(b => b.severity === 'CRITICAL').length;
    const highIssues = bottlenecks.filter(b => b.severity === 'HIGH').length;

    let recommendation;
    if (criticalIssues > 0) {
      recommendation = 'IMMEDIATE ACTION REQUIRED - Critical performance issues detected';
    } else if (!slaCompliance.overall) {
      recommendation = 'SLA targets not met - Performance optimization needed';
    } else if (highIssues > 0) {
      recommendation = 'Performance is acceptable but optimization recommended';
    } else {
      recommendation = 'System performance is healthy and meeting targets';
    }

    return {
      grade: this.calculatePerformanceGrade(performance, slaCompliance),
      recommendation,
      readiness: criticalIssues === 0 && slaCompliance.overall ? 'Production Ready' : 'Needs Optimization',
      nextSteps: this.getNextSteps(bottlenecks, slaCompliance)
    };
  }

  calculatePerformanceGrade(performance, slaCompliance) {
    const complianceScore = Object.values(slaCompliance.compliance)
      .reduce((score, metric) => score + (metric.compliant ? 1 : 0), 0) / 
      Object.keys(slaCompliance.compliance).length * 100;

    if (complianceScore >= 90) return 'A';
    if (complianceScore >= 80) return 'B'; 
    if (complianceScore >= 70) return 'C';
    if (complianceScore >= 60) return 'D';
    return 'F';
  }

  getNextSteps(bottlenecks, slaCompliance) {
    const steps = [];
    
    if (bottlenecks.some(b => b.severity === 'CRITICAL')) {
      steps.push('Address critical performance bottlenecks immediately');
    }
    
    if (!slaCompliance.overall) {
      steps.push('Optimize system to meet SLA targets');
    }
    
    steps.push('Implement performance monitoring in production');
    steps.push('Schedule regular load testing');
    
    return steps;
  }

  // ===== UTILITY METHODS =====
  recordMetric(type, data) {
    if (!this.metrics[type]) {
      this.metrics[type] = [];
    }
    this.metrics[type].push(data);
  }

  percentile(sortedArray, percentile) {
    const index = Math.ceil((percentile / 100) * sortedArray.length) - 1;
    return sortedArray[Math.max(0, index)] || 0;
  }

  selectWeightedEndpoint(endpoints) {
    const random = Math.random();
    let cumulative = 0;
    
    for (const endpoint of endpoints) {
      cumulative += endpoint.weight;
      if (random <= cumulative) {
        return endpoint;
      }
    }
    
    return endpoints[0]; // Fallback
  }

  selectWeightedOperation(operations) {
    return this.selectWeightedEndpoint(operations);
  }

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async cleanup() {
    console.log('🧹 Cleaning up test resources...');
    
    // Close all WebSocket connections
    this.activeConnections.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    });
    this.activeConnections.clear();

    // Stop system monitoring
    if (this.systemMonitorInterval) {
      clearInterval(this.systemMonitorInterval);
    }

    console.log('✅ Cleanup completed\n');
  }
}

// ===== CLI INTERFACE =====
async function main() {
  const args = process.argv.slice(2);
  const scenario = args[0] || 'comprehensive';
  
  // Parse additional configuration from command line
  const config = {
    maxConcurrency: parseInt(args.find(arg => arg.startsWith('--users='))?.split('=')[1]) || 50,
    testDuration: parseInt(args.find(arg => arg.startsWith('--duration='))?.split('=')[1]) || 60000,
    baseUrl: args.find(arg => arg.startsWith('--url='))?.split('=')[1] || process.env.TEST_URL
  };

  const loadTester = new LoadTester(config);

  console.log('⚡ IC Mesh Load Testing & Performance Verification');
  console.log('=================================================\n');

  const validScenarios = ['comprehensive', 'api-stress', 'websocket-stress', 'database-stress', 'spike-test', 'endurance'];
  
  if (scenario === 'help' || !validScenarios.includes(scenario)) {
    console.log('Usage: node load-testing.js [scenario] [options]');
    console.log('Scenarios:');
    console.log('  comprehensive     - Complete load test with multiple phases (default)');
    console.log('  api-stress        - API endpoint stress testing');
    console.log('  websocket-stress  - WebSocket connection stress testing');
    console.log('  database-stress   - Database performance testing');
    console.log('  spike-test        - Sudden load increase testing');
    console.log('  endurance         - Extended duration testing');
    console.log('\nOptions:');
    console.log('  --users=N         - Maximum concurrent users (default: 50)');
    console.log('  --duration=MS     - Test duration in milliseconds (default: 60000)');
    console.log('  --url=URL         - Base URL for testing (default: http://localhost:8333)');
    return;
  }

  try {
    await loadTester.runLoadTest(scenario);
  } catch (error) {
    console.error(`❌ Load test failed: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = LoadTester;