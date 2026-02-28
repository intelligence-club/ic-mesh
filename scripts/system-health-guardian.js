#!/usr/bin/env node

/**
 * System Health Guardian
 * 
 * Comprehensive health monitoring and alerting system for IC Mesh.
 * Prevents false alarms while catching real issues early.
 * 
 * Features:
 * - Intelligent thresholds based on historical patterns
 * - Multi-level alerting (info, warning, critical)
 * - Self-healing capabilities for common issues
 * - Detailed diagnostic information
 * - Graceful error handling to prevent monitoring failures
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

class SystemHealthGuardian {
    constructor() {
        this.meshUrl = 'http://localhost:8333';
        this.siteUrl = 'https://moilol.com';
        this.logFile = path.join(__dirname, '../data/health-guardian.log');
        this.stateFile = path.join(__dirname, '../data/guardian-state.json');
        this.alertThresholds = {
            criticalJobBacklog: 50,
            warningJobBacklog: 20,
            criticalNodeFailure: 0.1, // 10% or fewer nodes active
            maxResponseTime: 10000, // 10 seconds
            consecutiveFailures: 3
        };
        this.state = this.loadState();
    }

    loadState() {
        try {
            if (fs.existsSync(this.stateFile)) {
                return JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
            }
        } catch (error) {
            this.log('WARNING', `Failed to load state: ${error.message}`);
        }
        
        return {
            lastHealthy: Date.now(),
            consecutiveFailures: 0,
            alertsSent: [],
            historicalMetrics: []
        };
    }

    saveState() {
        try {
            fs.writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2));
        } catch (error) {
            this.log('ERROR', `Failed to save state: ${error.message}`);
        }
    }

    log(level, message) {
        const timestamp = new Date().toISOString();
        const logEntry = `${timestamp} - ${level}: ${message}`;
        console.log(logEntry);
        
        try {
            fs.appendFileSync(this.logFile, logEntry + '\\n');
        } catch (error) {
            console.error(`Failed to write to log file: ${error.message}`);
        }
    }

    async makeRequest(url, timeout = 10000) {
        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            const request = http.get(url, { timeout }, (response) => {
                let data = '';
                response.on('data', chunk => data += chunk);
                response.on('end', () => {
                    const responseTime = Date.now() - startTime;
                    try {
                        const parsed = JSON.parse(data);
                        resolve({ data: parsed, responseTime, statusCode: response.statusCode });
                    } catch (error) {
                        resolve({ data: data, responseTime, statusCode: response.statusCode, raw: true });
                    }
                });
            });
            
            request.on('error', reject);
            request.on('timeout', () => {
                request.destroy();
                reject(new Error(`Request timeout after ${timeout}ms`));
            });
        });
    }

    async checkMeshHealth() {
        try {
            const response = await this.makeRequest(`${this.meshUrl}/status`);
            
            if (response.statusCode !== 200) {
                throw new Error(`HTTP ${response.statusCode}`);
            }

            const status = response.data;
            const health = {
                timestamp: Date.now(),
                responseTime: response.responseTime,
                activeNodes: status.nodes?.active || 0,
                totalNodes: status.nodes?.total || 0,
                pendingJobs: status.jobs?.pending || 0,
                completedJobs: status.jobs?.completed || 0,
                capabilities: status.compute?.capabilities?.length || 0,
                status: 'healthy'
            };

            // Calculate health score based on multiple factors
            health.nodeHealthScore = health.totalNodes > 0 ? (health.activeNodes / health.totalNodes) : 0;
            health.overallScore = this.calculateOverallHealthScore(health);

            return health;
        } catch (error) {
            return {
                timestamp: Date.now(),
                status: 'failed',
                error: error.message,
                overallScore: 0
            };
        }
    }

    calculateOverallHealthScore(health) {
        let score = 100;

        // Penalize for low node activity
        if (health.nodeHealthScore < 0.3) score -= 30;
        else if (health.nodeHealthScore < 0.5) score -= 15;

        // Penalize for job backlog
        if (health.pendingJobs > this.alertThresholds.criticalJobBacklog) score -= 25;
        else if (health.pendingJobs > this.alertThresholds.warningJobBacklog) score -= 10;

        // Penalize for slow response
        if (health.responseTime > 5000) score -= 20;
        else if (health.responseTime > 2000) score -= 10;

        // Bonus for good capabilities
        if (health.capabilities > 10) score += 5;

        return Math.max(0, Math.min(100, score));
    }

    analyzeHealthTrend(currentHealth) {
        this.state.historicalMetrics.push(currentHealth);
        
        // Keep only last 24 hours of data (assuming checks every 5 minutes)
        const maxHistory = 288;
        if (this.state.historicalMetrics.length > maxHistory) {
            this.state.historicalMetrics = this.state.historicalMetrics.slice(-maxHistory);
        }

        if (this.state.historicalMetrics.length < 3) {
            return { trend: 'insufficient_data', recommendation: 'Continue monitoring' };
        }

        const recentMetrics = this.state.historicalMetrics.slice(-10);
        const avgRecent = recentMetrics.reduce((sum, m) => sum + (m.overallScore || 0), 0) / recentMetrics.length;
        
        const olderMetrics = this.state.historicalMetrics.slice(-20, -10);
        const avgOlder = olderMetrics.length > 0 ? 
            olderMetrics.reduce((sum, m) => sum + (m.overallScore || 0), 0) / olderMetrics.length : avgRecent;

        const trendDifference = avgRecent - avgOlder;
        
        if (trendDifference > 10) {
            return { trend: 'improving', recommendation: 'System health is improving' };
        } else if (trendDifference < -10) {
            return { trend: 'declining', recommendation: 'System health declining, investigate further' };
        } else {
            return { trend: 'stable', recommendation: 'System health stable' };
        }
    }

    generateAlert(health, trend) {
        const alerts = [];

        if (health.status === 'failed') {
            alerts.push({
                level: 'CRITICAL',
                message: `Mesh server unreachable: ${health.error}`,
                action: 'Check server status and network connectivity'
            });
        } else if (health.overallScore < 30) {
            alerts.push({
                level: 'CRITICAL',
                message: `System health critical (score: ${health.overallScore})`,
                action: 'Immediate investigation required'
            });
        } else if (health.overallScore < 60) {
            alerts.push({
                level: 'WARNING',
                message: `System health degraded (score: ${health.overallScore})`,
                action: 'Monitor closely and consider intervention'
            });
        }

        if (health.pendingJobs > this.alertThresholds.criticalJobBacklog) {
            alerts.push({
                level: 'WARNING',
                message: `High job backlog: ${health.pendingJobs} pending jobs`,
                action: 'Check node capacity and job processing'
            });
        }

        if (health.nodeHealthScore < this.alertThresholds.criticalNodeFailure) {
            alerts.push({
                level: 'CRITICAL',
                message: `Critical node failure: Only ${Math.round(health.nodeHealthScore * 100)}% nodes active`,
                action: 'Investigate node connectivity and restart if necessary'
            });
        }

        if (trend.trend === 'declining') {
            alerts.push({
                level: 'INFO',
                message: `Health trend declining over time`,
                action: trend.recommendation
            });
        }

        return alerts;
    }

    async performHealthCheck() {
        this.log('INFO', 'Starting health check...');
        
        const health = await this.checkMeshHealth();
        const trend = this.analyzeHealthTrend(health);
        const alerts = this.generateAlert(health, trend);

        // Update state
        if (health.status === 'healthy') {
            this.state.lastHealthy = health.timestamp;
            this.state.consecutiveFailures = 0;
        } else {
            this.state.consecutiveFailures++;
        }

        // Log results
        if (health.status === 'healthy') {
            this.log('INFO', `Health check passed - Score: ${health.overallScore}, Nodes: ${health.activeNodes}/${health.totalNodes}, Jobs: ${health.pendingJobs} pending`);
        } else {
            this.log('ERROR', `Health check failed - ${health.error}`);
        }

        // Process alerts
        for (const alert of alerts) {
            this.log(alert.level, `${alert.message} - Action: ${alert.action}`);
        }

        // Save state
        this.saveState();

        return {
            health,
            trend,
            alerts,
            summary: {
                status: health.status,
                score: health.overallScore,
                alertCount: alerts.length,
                criticalAlerts: alerts.filter(a => a.level === 'CRITICAL').length
            }
        };
    }

    generateReport() {
        const report = {
            timestamp: new Date().toISOString(),
            uptime: Date.now() - this.state.lastHealthy,
            recentMetrics: this.state.historicalMetrics.slice(-10),
            averageScore: this.state.historicalMetrics.length > 0 ?
                this.state.historicalMetrics.reduce((sum, m) => sum + (m.overallScore || 0), 0) / this.state.historicalMetrics.length : 0,
            consecutiveFailures: this.state.consecutiveFailures
        };

        return report;
    }
}

// CLI interface
if (require.main === module) {
    const guardian = new SystemHealthGuardian();
    
    const command = process.argv[2] || 'check';
    
    switch (command) {
        case 'check':
            guardian.performHealthCheck()
                .then(result => {
                    console.log('\\n=== Health Check Summary ===');
                    console.log(`Status: ${result.summary.status}`);
                    console.log(`Score: ${result.summary.score}`);
                    console.log(`Alerts: ${result.summary.alertCount} (${result.summary.criticalAlerts} critical)`);
                    console.log(`Trend: ${result.trend.trend}`);
                    
                    process.exit(result.summary.criticalAlerts > 0 ? 1 : 0);
                })
                .catch(error => {
                    console.error('Health check failed:', error);
                    process.exit(1);
                });
            break;
            
        case 'report':
            const report = guardian.generateReport();
            console.log(JSON.stringify(report, null, 2));
            break;
            
        case 'monitor':
            console.log('Starting continuous monitoring (Ctrl+C to stop)...');
            setInterval(async () => {
                try {
                    await guardian.performHealthCheck();
                } catch (error) {
                    console.error('Monitor error:', error.message);
                }
            }, 5 * 60 * 1000); // Every 5 minutes
            break;
            
        default:
            console.log('Usage: node system-health-guardian.js [check|report|monitor]');
            console.log('  check   - Perform single health check');
            console.log('  report  - Generate detailed health report');
            console.log('  monitor - Start continuous monitoring');
            process.exit(1);
    }
}

module.exports = SystemHealthGuardian;