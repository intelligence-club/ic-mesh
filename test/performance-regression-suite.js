#!/usr/bin/env node
/**
 * Performance Regression Test Suite
 * 
 * Automated performance testing to catch regressions before deployment.
 * Tracks key metrics and compares against historical baselines.
 * 
 * Capabilities:
 * - API endpoint response time benchmarking
 * - WebSocket connection performance testing
 * - Database query performance validation
 * - Memory usage and leak detection
 * - CPU utilization monitoring
 * - Concurrent connection handling
 * - Load balancing effectiveness
 * - Historical performance trend analysis
 */

const http = require('http');
const WebSocket = require('ws');
const { performance } = require('perf_hooks');
const fs = require('fs');
const path = require('path');

class PerformanceRegressionSuite {
    constructor(baseUrl = 'http://localhost:8333') {
        this.baseUrl = baseUrl;
        this.wsUrl = baseUrl.replace('http', 'ws');
        this.results = {
            timestamp: new Date().toISOString(),
            version: this.getVersionInfo(),
            metrics: {},
            baselines: this.loadBaselines(),
            regressions: [],
            passed: true
        };
    }

    async runFullSuite() {
        console.log('🚀 PERFORMANCE REGRESSION TEST SUITE');
        console.log('====================================');

        try {
            await this.testApiResponseTimes();
            await this.testWebSocketPerformance();
            await this.testDatabasePerformance();
            await this.testConcurrentConnections();
            await this.testMemoryUsage();
            await this.testLoadHandling();
            
            this.analyzeRegressions();
            this.generateReport();
            this.updateBaselines();

        } catch (error) {
            console.error('❌ Performance test suite failed:', error.message);
            this.results.passed = false;
            this.results.error = error.message;
        }

        return this.results;
    }

    async testApiResponseTimes() {
        console.log('\\n⚡ API RESPONSE TIME TESTING');
        
        const endpoints = [
            { path: '/status', method: 'GET', name: 'status' },
            { path: '/nodes', method: 'GET', name: 'nodes-list' },
            { path: '/jobs', method: 'POST', name: 'job-creation', body: { type: 'test', payload: '{}' } },
            { path: '/handlers', method: 'GET', name: 'handlers' }
        ];

        const responseTimeResults = {};

        for (const endpoint of endpoints) {
            const times = [];
            
            // Run multiple iterations for statistical significance
            for (let i = 0; i < 10; i++) {
                const start = performance.now();
                
                try {
                    await this.makeRequest(endpoint.method, endpoint.path, endpoint.body);
                    const end = performance.now();
                    times.push(end - start);
                } catch (error) {
                    console.log(`   ⚠️  ${endpoint.name}: Request failed - ${error.message}`);
                    times.push(null);
                }
                
                // Small delay between requests
                await this.sleep(50);
            }

            const validTimes = times.filter(t => t !== null);
            const stats = this.calculateStats(validTimes);
            
            responseTimeResults[endpoint.name] = stats;
            
            console.log(`   ${endpoint.name}: ${stats.avg.toFixed(2)}ms avg (${stats.min.toFixed(2)}-${stats.max.toFixed(2)}ms)`);
            
            // Check for regressions
            this.checkRegression('api-response-' + endpoint.name, stats.avg, 'ms');
        }

        this.results.metrics.apiResponseTimes = responseTimeResults;
    }

    async testWebSocketPerformance() {
        console.log('\\n🔌 WEBSOCKET PERFORMANCE TESTING');

        const metrics = {
            connectionTime: [],
            messageLatency: [],
            connectionStability: 0
        };

        // Test connection establishment speed
        for (let i = 0; i < 5; i++) {
            const start = performance.now();
            
            try {
                const ws = await this.createWebSocketConnection();
                const end = performance.now();
                metrics.connectionTime.push(end - start);
                
                // Test message round-trip time
                const messageStart = performance.now();
                ws.send(JSON.stringify({ type: 'ping', timestamp: messageStart }));
                
                await new Promise(resolve => {
                    ws.on('message', (data) => {
                        const messageEnd = performance.now();
                        metrics.messageLatency.push(messageEnd - messageStart);
                        resolve();
                    });
                });
                
                ws.close();
                metrics.connectionStability++;
                
            } catch (error) {
                console.log(`   ⚠️  WebSocket connection ${i + 1} failed: ${error.message}`);
            }

            await this.sleep(100);
        }

        const connectionStats = this.calculateStats(metrics.connectionTime);
        const latencyStats = this.calculateStats(metrics.messageLatency);

        console.log(`   Connection time: ${connectionStats.avg.toFixed(2)}ms avg`);
        console.log(`   Message latency: ${latencyStats.avg.toFixed(2)}ms avg`);
        console.log(`   Connection stability: ${metrics.connectionStability}/5 successful`);

        this.results.metrics.webSocket = {
            connectionTime: connectionStats,
            messageLatency: latencyStats,
            stability: metrics.connectionStability / 5
        };

        this.checkRegression('websocket-connection', connectionStats.avg, 'ms');
        this.checkRegression('websocket-latency', latencyStats.avg, 'ms');
    }

    async testDatabasePerformance() {
        console.log('\\n💾 DATABASE PERFORMANCE TESTING');

        const dbMetrics = {
            queryResponseTime: [],
            insertPerformance: [],
            selectPerformance: []
        };

        try {
            // Test various database operations via API
            const operations = [
                { name: 'nodes-query', endpoint: '/nodes', expectedTime: 50 },
                { name: 'jobs-query', endpoint: '/jobs', expectedTime: 100 },
                { name: 'handlers-query', endpoint: '/handlers', expectedTime: 30 }
            ];

            for (const op of operations) {
                const times = [];
                
                for (let i = 0; i < 5; i++) {
                    const start = performance.now();
                    await this.makeRequest('GET', op.endpoint);
                    const end = performance.now();
                    times.push(end - start);
                    await this.sleep(10);
                }

                const stats = this.calculateStats(times);
                dbMetrics.queryResponseTime.push({
                    operation: op.name,
                    stats,
                    expected: op.expectedTime
                });

                console.log(`   ${op.name}: ${stats.avg.toFixed(2)}ms (expected <${op.expectedTime}ms)`);
                
                if (stats.avg > op.expectedTime) {
                    console.log(`   ⚠️  ${op.name} slower than expected!`);
                }
            }

        } catch (error) {
            console.log(`   ⚠️  Database performance test failed: ${error.message}`);
        }

        this.results.metrics.database = dbMetrics;
    }

    async testConcurrentConnections() {
        console.log('\\n🔀 CONCURRENT CONNECTION TESTING');

        const concurrencyLevels = [5, 10, 20];
        const concurrencyResults = {};

        for (const level of concurrencyLevels) {
            console.log(`   Testing ${level} concurrent connections...`);
            
            const start = performance.now();
            const promises = [];
            
            for (let i = 0; i < level; i++) {
                promises.push(this.makeRequest('GET', '/status').catch(e => ({ error: e.message })));
            }

            const results = await Promise.all(promises);
            const end = performance.now();
            
            const successful = results.filter(r => !r.error).length;
            const totalTime = end - start;
            const avgResponseTime = totalTime / level;

            concurrencyResults[level] = {
                totalTime,
                avgResponseTime,
                successRate: successful / level,
                successful,
                total: level
            };

            console.log(`   Level ${level}: ${successful}/${level} success, ${avgResponseTime.toFixed(2)}ms avg`);
            
            this.checkRegression(`concurrency-${level}`, avgResponseTime, 'ms');

            await this.sleep(200); // Cool down between tests
        }

        this.results.metrics.concurrency = concurrencyResults;
    }

    async testMemoryUsage() {
        console.log('\\n🧠 MEMORY USAGE TESTING');

        const memoryMetrics = {
            baseline: process.memoryUsage(),
            peaks: [],
            leakDetection: []
        };

        // Baseline memory
        console.log(`   Baseline memory: ${Math.round(memoryMetrics.baseline.heapUsed / 1024 / 1024)}MB`);

        // Simulate load and monitor memory
        for (let cycle = 0; cycle < 3; cycle++) {
            const beforeLoad = process.memoryUsage();
            
            // Generate load
            const promises = [];
            for (let i = 0; i < 50; i++) {
                promises.push(this.makeRequest('GET', '/status').catch(() => {}));
            }
            await Promise.all(promises);

            const afterLoad = process.memoryUsage();
            memoryMetrics.peaks.push(afterLoad);

            // Force garbage collection if available
            if (global.gc) {
                global.gc();
            }

            const afterGC = process.memoryUsage();
            memoryMetrics.leakDetection.push({
                cycle,
                beforeLoad: beforeLoad.heapUsed,
                afterLoad: afterLoad.heapUsed,
                afterGC: afterGC.heapUsed,
                retained: afterGC.heapUsed - beforeLoad.heapUsed
            });

            console.log(`   Cycle ${cycle + 1}: ${Math.round(afterLoad.heapUsed / 1024 / 1024)}MB peak, ${Math.round(afterGC.heapUsed / 1024 / 1024)}MB after GC`);

            await this.sleep(500);
        }

        // Check for memory leaks
        const avgRetained = memoryMetrics.leakDetection.reduce((sum, cycle) => sum + cycle.retained, 0) / memoryMetrics.leakDetection.length;
        const leakThreshold = 5 * 1024 * 1024; // 5MB threshold

        if (avgRetained > leakThreshold) {
            console.log(`   ⚠️  Potential memory leak detected: ${Math.round(avgRetained / 1024 / 1024)}MB avg retained`);
        } else {
            console.log(`   ✅ No significant memory leaks detected`);
        }

        this.results.metrics.memory = memoryMetrics;
    }

    async testLoadHandling() {
        console.log('\\n📈 LOAD HANDLING TESTING');

        const loadTests = [
            { name: 'sustained-load', requests: 100, duration: 10000 },
            { name: 'burst-load', requests: 50, duration: 1000 }
        ];

        const loadResults = {};

        for (const test of loadTests) {
            console.log(`   Running ${test.name}: ${test.requests} requests over ${test.duration}ms`);
            
            const start = performance.now();
            const results = [];
            const interval = test.duration / test.requests;

            for (let i = 0; i < test.requests; i++) {
                const requestStart = performance.now();
                
                this.makeRequest('GET', '/status')
                    .then(() => {
                        const requestEnd = performance.now();
                        results.push({
                            success: true,
                            time: requestEnd - requestStart,
                            index: i
                        });
                    })
                    .catch(error => {
                        results.push({
                            success: false,
                            error: error.message,
                            index: i
                        });
                    });

                await this.sleep(interval);
            }

            // Wait for all requests to complete
            await this.sleep(2000);
            
            const successful = results.filter(r => r.success);
            const avgResponseTime = successful.length > 0 ? 
                successful.reduce((sum, r) => sum + r.time, 0) / successful.length : 0;

            loadResults[test.name] = {
                totalRequests: test.requests,
                successfulRequests: successful.length,
                failedRequests: results.length - successful.length,
                successRate: successful.length / test.requests,
                avgResponseTime
            };

            console.log(`   ${test.name}: ${successful.length}/${test.requests} success (${(successful.length / test.requests * 100).toFixed(1)}%)`);
            
            this.checkRegression(`load-${test.name}-success-rate`, successful.length / test.requests, 'ratio');
        }

        this.results.metrics.loadHandling = loadResults;
    }

    analyzeRegressions() {
        console.log('\\n📊 REGRESSION ANALYSIS');

        if (this.results.regressions.length === 0) {
            console.log('   ✅ No performance regressions detected');
            return;
        }

        console.log(`   ⚠️  Found ${this.results.regressions.length} performance regressions:`);
        this.results.regressions.forEach(regression => {
            const change = ((regression.current - regression.baseline) / regression.baseline * 100).toFixed(1);
            console.log(`   - ${regression.metric}: ${regression.current.toFixed(2)}${regression.unit} vs ${regression.baseline.toFixed(2)}${regression.unit} baseline (+${change}%)`);
        });

        // Determine if regressions are acceptable
        const criticalRegressions = this.results.regressions.filter(r => {
            const changePercent = (r.current - r.baseline) / r.baseline * 100;
            return changePercent > 50; // More than 50% slower is critical
        });

        if (criticalRegressions.length > 0) {
            console.log(`   🚨 ${criticalRegressions.length} CRITICAL regressions detected!`);
            this.results.passed = false;
        }
    }

    checkRegression(metric, value, unit) {
        const baseline = this.results.baselines[metric];
        if (!baseline) {
            console.log(`   ℹ️  No baseline for ${metric}, establishing: ${value.toFixed(2)}${unit}`);
            return;
        }

        const threshold = baseline * 1.25; // 25% regression threshold
        if (value > threshold) {
            this.results.regressions.push({
                metric,
                current: value,
                baseline,
                unit,
                threshold
            });
        }
    }

    generateReport() {
        console.log('\\n📋 PERFORMANCE REPORT GENERATION');

        const reportPath = path.join(__dirname, '../reports/performance-regression-report.json');
        const summaryPath = path.join(__dirname, '../reports/performance-summary.md');

        // Ensure reports directory exists
        const reportsDir = path.dirname(reportPath);
        if (!fs.existsSync(reportsDir)) {
            fs.mkdirSync(reportsDir, { recursive: true });
        }

        // Save detailed JSON report
        fs.writeFileSync(reportPath, JSON.stringify(this.results, null, 2));

        // Generate markdown summary
        const summary = this.generateMarkdownSummary();
        fs.writeFileSync(summaryPath, summary);

        console.log(`   📄 Detailed report: ${reportPath}`);
        console.log(`   📝 Summary report: ${summaryPath}`);

        // Console summary
        const status = this.results.passed ? '✅ PASSED' : '❌ FAILED';
        console.log(`\\n🎯 OVERALL RESULT: ${status}`);
        console.log(`   Regressions detected: ${this.results.regressions.length}`);
        console.log(`   Test timestamp: ${this.results.timestamp}`);
    }

    generateMarkdownSummary() {
        return `# Performance Regression Test Report

**Test Date:** ${this.results.timestamp}  
**Version:** ${this.results.version}  
**Status:** ${this.results.passed ? '✅ PASSED' : '❌ FAILED'}  

## Summary

- **API Response Times:** ${Object.keys(this.results.metrics.apiResponseTimes || {}).length} endpoints tested
- **WebSocket Performance:** ${this.results.metrics.webSocket ? 'Tested' : 'Not tested'}
- **Database Performance:** ${this.results.metrics.database ? 'Tested' : 'Not tested'}
- **Concurrency Testing:** ${Object.keys(this.results.metrics.concurrency || {}).length} levels tested
- **Memory Usage:** ${this.results.metrics.memory ? 'Monitored' : 'Not tested'}
- **Load Handling:** ${Object.keys(this.results.metrics.loadHandling || {}).length} scenarios tested

## Regressions Detected

${this.results.regressions.length === 0 ? 
'✅ No performance regressions detected.' : 
this.results.regressions.map(r => {
    const change = ((r.current - r.baseline) / r.baseline * 100).toFixed(1);
    return `- **${r.metric}:** ${r.current.toFixed(2)}${r.unit} (baseline: ${r.baseline.toFixed(2)}${r.unit}, +${change}%)`;
}).join('\\n')}

## Key Metrics

${this.results.metrics.apiResponseTimes ? Object.entries(this.results.metrics.apiResponseTimes).map(([name, stats]) => 
`- **${name}:** ${stats.avg.toFixed(2)}ms avg`).join('\\n') : ''}

${this.results.metrics.webSocket ? `
### WebSocket Performance
- **Connection Time:** ${this.results.metrics.webSocket.connectionTime.avg.toFixed(2)}ms
- **Message Latency:** ${this.results.metrics.webSocket.messageLatency.avg.toFixed(2)}ms
- **Connection Stability:** ${(this.results.metrics.webSocket.stability * 100).toFixed(1)}%
` : ''}

---
*Generated by Performance Regression Suite*`;
    }

    updateBaselines() {
        if (!this.results.passed) {
            console.log('   ⚠️  Not updating baselines due to failed tests');
            return;
        }

        const baselinesPath = path.join(__dirname, '../performance-baselines.json');
        const newBaselines = { ...this.results.baselines };

        // Update baselines from current metrics
        if (this.results.metrics.apiResponseTimes) {
            Object.entries(this.results.metrics.apiResponseTimes).forEach(([name, stats]) => {
                newBaselines[`api-response-${name}`] = stats.avg;
            });
        }

        if (this.results.metrics.webSocket) {
            newBaselines['websocket-connection'] = this.results.metrics.webSocket.connectionTime.avg;
            newBaselines['websocket-latency'] = this.results.metrics.webSocket.messageLatency.avg;
        }

        if (this.results.metrics.concurrency) {
            Object.entries(this.results.metrics.concurrency).forEach(([level, metrics]) => {
                newBaselines[`concurrency-${level}`] = metrics.avgResponseTime;
            });
        }

        fs.writeFileSync(baselinesPath, JSON.stringify(newBaselines, null, 2));
        console.log('   ✅ Performance baselines updated');
    }

    loadBaselines() {
        const baselinesPath = path.join(__dirname, '../performance-baselines.json');
        try {
            return JSON.parse(fs.readFileSync(baselinesPath, 'utf8'));
        } catch (error) {
            console.log('   ℹ️  No existing baselines found, will establish new ones');
            return {};
        }
    }

    getVersionInfo() {
        try {
            const pkg = require('../package.json');
            return pkg.version || 'unknown';
        } catch (error) {
            return 'unknown';
        }
    }

    calculateStats(values) {
        if (values.length === 0) return { avg: 0, min: 0, max: 0, count: 0 };
        
        const sorted = values.sort((a, b) => a - b);
        return {
            avg: values.reduce((sum, v) => sum + v, 0) / values.length,
            min: sorted[0],
            max: sorted[sorted.length - 1],
            median: sorted[Math.floor(sorted.length / 2)],
            count: values.length
        };
    }

    async makeRequest(method, path, body = null) {
        return new Promise((resolve, reject) => {
            const url = new URL(path, this.baseUrl);
            const options = {
                method,
                headers: { 'Content-Type': 'application/json' },
                timeout: 5000
            };

            const req = http.request(url, options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    if (res.statusCode >= 400) {
                        reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                    } else {
                        resolve({ statusCode: res.statusCode, data });
                    }
                });
            });

            req.on('error', reject);
            req.on('timeout', () => reject(new Error('Request timeout')));

            if (body) {
                req.write(JSON.stringify(body));
            }

            req.end();
        });
    }

    async createWebSocketConnection() {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(this.wsUrl);
            const timeout = setTimeout(() => {
                ws.close();
                reject(new Error('WebSocket connection timeout'));
            }, 5000);

            ws.on('open', () => {
                clearTimeout(timeout);
                resolve(ws);
            });

            ws.on('error', (error) => {
                clearTimeout(timeout);
                reject(error);
            });
        });
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// CLI execution
if (require.main === module) {
    const suite = new PerformanceRegressionSuite();
    suite.runFullSuite()
        .then(results => {
            console.log('\\n🏁 Performance regression testing complete!');
            process.exit(results.passed ? 0 : 1);
        })
        .catch(error => {
            console.error('❌ Performance testing failed:', error);
            process.exit(1);
        });
}

module.exports = PerformanceRegressionSuite;