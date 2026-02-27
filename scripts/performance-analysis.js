#!/usr/bin/env node
/**
 * IC Mesh Performance Analysis Tool
 * 
 * Analyzes the performance of the IC Mesh coordination server by:
 * - Collecting real-time metrics from the running server
 * - Running performance tests against key endpoints
 * - Analyzing database query performance
 * - Generating detailed performance reports
 * - Identifying bottlenecks and optimization opportunities
 * 
 * Usage:
 *   node scripts/performance-analysis.js                    # Quick analysis
 *   node scripts/performance-analysis.js --detailed         # Detailed analysis with load testing
 *   node scripts/performance-analysis.js --monitor          # Continuous monitoring mode
 *   node scripts/performance-analysis.js --report           # Generate JSON report only
 */

const http = require('http');
const fs = require('fs').promises;
const path = require('path');

class PerformanceAnalyzer {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || 'http://localhost:8333';
    this.testDuration = options.testDuration || 30000; // 30 seconds
    this.concurrentRequests = options.concurrentRequests || 10;
    this.detailed = options.detailed || false;
    this.monitor = options.monitor || false;
    
    this.results = {
      timestamp: Date.now(),
      serverInfo: {},
      endpointTests: {},
      loadTests: {},
      databaseAnalysis: {},
      recommendations: [],
      healthScore: 0
    };
  }

  async analyze() {
    console.log('🔍 Starting IC Mesh Performance Analysis...\n');

    try {
      // 1. Check server connectivity
      await this.checkServerHealth();
      
      // 2. Test key endpoints
      await this.testEndpointPerformance();
      
      // 3. Detailed analysis if requested
      if (this.detailed) {
        await this.runLoadTests();
        await this.analyzeDatabasePerformance();
      }

      // 4. Generate recommendations
      this.generateRecommendations();
      
      // 5. Calculate health score
      this.calculateHealthScore();

      // 6. Generate report
      await this.generateReport();

      if (this.monitor) {
        console.log('\n📊 Entering continuous monitoring mode (Ctrl+C to exit)...');
        await this.startMonitoring();
      }

    } catch (error) {
      console.error('❌ Analysis failed:', error.message);
      process.exit(1);
    }
  }

  async checkServerHealth() {
    console.log('🏥 Checking server health...');
    
    const startTime = Date.now();
    try {
      const response = await this.makeRequest('GET', '/status');
      const endTime = Date.now();
      
      this.results.serverInfo = {
        responsive: true,
        responseTime: endTime - startTime,
        status: response.data,
        timestamp: Date.now()
      };

      console.log(`✅ Server responsive (${this.results.serverInfo.responseTime}ms)`);
      console.log(`📊 Nodes: ${response.data.nodes}, Jobs: ${response.data.jobs}\n`);
      
    } catch (error) {
      this.results.serverInfo = {
        responsive: false,
        error: error.message,
        timestamp: Date.now()
      };
      throw new Error(`Server health check failed: ${error.message}`);
    }
  }

  async testEndpointPerformance() {
    console.log('🎯 Testing endpoint performance...');

    const endpoints = [
      { method: 'GET', path: '/status', name: 'Status' },
      { method: 'GET', path: '/nodes', name: 'Nodes List' },
      { method: 'GET', path: '/jobs/available', name: 'Available Jobs' },
      { method: 'POST', path: '/nodes/register', name: 'Node Registration', data: {
        nodeId: `perf-test-${Date.now()}`,
        capabilities: ['test'],
        reputation: 1000,
        location: 'performance-test'
      }},
      { method: 'POST', path: '/jobs', name: 'Job Creation', data: {
        type: 'test',
        payload: { test: true },
        requirements: { capability: 'test' }
      }}
    ];

    for (const endpoint of endpoints) {
      await this.testSingleEndpoint(endpoint);
      // Small delay between tests
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log(''); // Empty line for formatting
  }

  async testSingleEndpoint(endpoint) {
    const results = {
      name: endpoint.name,
      method: endpoint.method,
      path: endpoint.path,
      attempts: 0,
      successes: 0,
      failures: 0,
      times: [],
      errors: [],
      avgTime: 0,
      minTime: Infinity,
      maxTime: 0
    };

    const attempts = this.detailed ? 20 : 5;
    
    for (let i = 0; i < attempts; i++) {
      results.attempts++;
      const startTime = Date.now();
      
      try {
        await this.makeRequest(endpoint.method, endpoint.path, endpoint.data);
        const endTime = Date.now();
        const duration = endTime - startTime;
        
        results.successes++;
        results.times.push(duration);
        results.minTime = Math.min(results.minTime, duration);
        results.maxTime = Math.max(results.maxTime, duration);
        
      } catch (error) {
        results.failures++;
        results.errors.push(error.message);
      }
    }

    if (results.times.length > 0) {
      results.avgTime = results.times.reduce((sum, time) => sum + time, 0) / results.times.length;
      results.p95Time = this.calculatePercentile(results.times, 95);
      results.p99Time = this.calculatePercentile(results.times, 99);
    }

    this.results.endpointTests[endpoint.name] = results;

    // Report results
    const successRate = ((results.successes / results.attempts) * 100).toFixed(1);
    const status = results.successes === results.attempts ? '✅' : '⚠️';
    
    console.log(`${status} ${endpoint.name}: ${results.avgTime.toFixed(1)}ms avg, ${successRate}% success`);
    
    if (results.failures > 0) {
      console.log(`   ❌ ${results.failures} failures: ${results.errors[0]}`);
    }
  }

  async runLoadTests() {
    console.log('\n🔥 Running load tests...');

    // Test concurrent requests to /status endpoint
    const concurrentTest = await this.runConcurrentTest('/status', 'GET');
    this.results.loadTests.concurrent = concurrentTest;

    // Test sustained load
    const sustainedTest = await this.runSustainedTest('/status', 'GET');
    this.results.loadTests.sustained = sustainedTest;

    console.log(`📈 Concurrent (${this.concurrentRequests}): ${concurrentTest.avgTime.toFixed(1)}ms avg`);
    console.log(`⏱️ Sustained (${this.testDuration/1000}s): ${sustainedTest.requestsPerSecond.toFixed(1)} req/s`);
  }

  async runConcurrentTest(endpoint, method) {
    const promises = [];
    const startTime = Date.now();
    
    for (let i = 0; i < this.concurrentRequests; i++) {
      promises.push(this.makeRequest(method, endpoint));
    }

    const results = await Promise.allSettled(promises);
    const endTime = Date.now();
    
    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.length - successful;
    
    return {
      concurrent: this.concurrentRequests,
      successful,
      failed,
      totalTime: endTime - startTime,
      avgTime: (endTime - startTime) / this.concurrentRequests,
      successRate: (successful / results.length) * 100
    };
  }

  async runSustainedTest(endpoint, method) {
    const startTime = Date.now();
    let requestCount = 0;
    let successCount = 0;
    let failCount = 0;
    const responseTimes = [];

    while (Date.now() - startTime < this.testDuration) {
      const reqStart = Date.now();
      
      try {
        await this.makeRequest(method, endpoint);
        successCount++;
        responseTimes.push(Date.now() - reqStart);
      } catch (error) {
        failCount++;
      }
      
      requestCount++;
      
      // Small delay to prevent overwhelming
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    const totalTime = Date.now() - startTime;
    const requestsPerSecond = requestCount / (totalTime / 1000);
    const avgResponseTime = responseTimes.length > 0 
      ? responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length 
      : 0;

    return {
      duration: totalTime,
      totalRequests: requestCount,
      successful: successCount,
      failed: failCount,
      requestsPerSecond,
      avgResponseTime,
      successRate: (successCount / requestCount) * 100
    };
  }

  async analyzeDatabasePerformance() {
    console.log('\n💾 Analyzing database performance...');
    
    // This would require database query monitoring - simulate for now
    this.results.databaseAnalysis = {
      connectionPoolSize: 'Not monitored',
      averageQueryTime: 'Not monitored',
      slowQueries: 'Not monitored',
      recommendation: 'Add database performance monitoring'
    };

    console.log('📝 Database analysis requires monitoring integration');
  }

  generateRecommendations() {
    const recommendations = [];

    // Check response times
    Object.values(this.results.endpointTests).forEach(test => {
      if (test.avgTime > 1000) {
        recommendations.push({
          type: 'performance',
          severity: 'high',
          message: `${test.name} endpoint is slow (${test.avgTime.toFixed(1)}ms average)`,
          suggestion: 'Consider adding caching or optimizing the underlying queries'
        });
      } else if (test.avgTime > 500) {
        recommendations.push({
          type: 'performance',
          severity: 'medium',
          message: `${test.name} endpoint could be faster (${test.avgTime.toFixed(1)}ms average)`,
          suggestion: 'Monitor for potential optimizations'
        });
      }

      if (test.failures > 0) {
        recommendations.push({
          type: 'reliability',
          severity: 'high',
          message: `${test.name} endpoint has failures (${test.failures}/${test.attempts})`,
          suggestion: 'Investigate error causes and add proper error handling'
        });
      }
    });

    // Check load test results
    if (this.results.loadTests.concurrent) {
      const concurrent = this.results.loadTests.concurrent;
      if (concurrent.successRate < 95) {
        recommendations.push({
          type: 'scalability',
          severity: 'high',
          message: `Concurrent request success rate is low (${concurrent.successRate.toFixed(1)}%)`,
          suggestion: 'Server may have concurrency issues - consider connection pooling or rate limiting'
        });
      }
    }

    if (this.results.loadTests.sustained) {
      const sustained = this.results.loadTests.sustained;
      if (sustained.requestsPerSecond < 10) {
        recommendations.push({
          type: 'scalability',
          severity: 'medium',
          message: `Sustained throughput is low (${sustained.requestsPerSecond.toFixed(1)} req/s)`,
          suggestion: 'Consider performance profiling and optimization'
        });
      }
    }

    // General recommendations
    recommendations.push({
      type: 'monitoring',
      severity: 'medium',
      message: 'Performance monitoring is not integrated',
      suggestion: 'Integrate the performance monitor module for continuous monitoring'
    });

    this.results.recommendations = recommendations;
  }

  calculateHealthScore() {
    let score = 100;

    // Deduct points for slow endpoints
    Object.values(this.results.endpointTests).forEach(test => {
      if (test.avgTime > 1000) score -= 20;
      else if (test.avgTime > 500) score -= 10;
      
      if (test.failures > 0) score -= 15;
    });

    // Deduct points for poor load performance
    if (this.results.loadTests.concurrent) {
      const concurrent = this.results.loadTests.concurrent;
      if (concurrent.successRate < 95) score -= 20;
      else if (concurrent.successRate < 98) score -= 10;
    }

    // Minimum score is 0
    this.results.healthScore = Math.max(0, score);
  }

  async generateReport() {
    const reportPath = path.join(__dirname, '../performance-report.json');
    await fs.writeFile(reportPath, JSON.stringify(this.results, null, 2));

    // Console report
    console.log('\n📋 Performance Analysis Report');
    console.log('================================');
    
    console.log(`\n🎯 Overall Health Score: ${this.results.healthScore}/100`);
    
    if (this.results.recommendations.length > 0) {
      console.log('\n💡 Recommendations:');
      this.results.recommendations.forEach((rec, i) => {
        const severity = rec.severity === 'high' ? '🔴' : rec.severity === 'medium' ? '🟡' : '🟢';
        console.log(`${i + 1}. ${severity} ${rec.message}`);
        console.log(`   💬 ${rec.suggestion}`);
      });
    }

    console.log(`\n📄 Detailed report saved to: ${reportPath}`);
  }

  async startMonitoring() {
    setInterval(async () => {
      try {
        console.log(`\n⏰ ${new Date().toISOString()}`);
        
        // Quick health check
        const startTime = Date.now();
        const response = await this.makeRequest('GET', '/status');
        const responseTime = Date.now() - startTime;
        
        console.log(`🏥 Health: ${responseTime}ms | Nodes: ${response.data.nodes} | Jobs: ${response.data.jobs}`);
        
        // Alert on slow responses
        if (responseTime > 1000) {
          console.log(`⚠️ SLOW RESPONSE: ${responseTime}ms (threshold: 1000ms)`);
        }
        
      } catch (error) {
        console.log(`❌ Health check failed: ${error.message}`);
      }
    }, 10000); // Every 10 seconds
  }

  // Utility methods
  async makeRequest(method, path, data = null) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, this.baseUrl);
      const options = {
        method,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'IC-Mesh-Performance-Analyzer/1.0'
        }
      };

      const req = http.request(url, options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const parsed = body ? JSON.parse(body) : null;
            resolve({ 
              status: res.statusCode, 
              data: parsed,
              headers: res.headers
            });
          } catch {
            resolve({ 
              status: res.statusCode, 
              data: body,
              headers: res.headers
            });
          }
        });
      });

      req.on('error', reject);

      if (data) {
        req.write(JSON.stringify(data));
      }

      req.end();

      // Timeout after 30 seconds
      setTimeout(() => {
        req.destroy();
        reject(new Error('Request timeout'));
      }, 30000);
    });
  }

  calculatePercentile(values, percentile) {
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[index] || 0;
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const options = {
    detailed: args.includes('--detailed'),
    monitor: args.includes('--monitor'),
    report: args.includes('--report')
  };

  const analyzer = new PerformanceAnalyzer(options);
  
  if (options.report) {
    // Quick analysis for report only
    await analyzer.checkServerHealth();
    await analyzer.testEndpointPerformance();
    analyzer.generateRecommendations();
    analyzer.calculateHealthScore();
    await analyzer.generateReport();
  } else {
    await analyzer.analyze();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('❌ Performance analysis failed:', error.message);
    process.exit(1);
  });
}

module.exports = PerformanceAnalyzer;