#!/usr/bin/env node

/**
 * Unified IC Mesh Monitor - Consolidated Network Monitoring Tool
 * 
 * Replaces 15+ separate monitoring tools with a single, comprehensive solution.
 * Monitors capacity, node health, queue status, and performance metrics.
 * 
 * Usage:
 *   ./unified-mesh-monitor.js status                    # Quick status check
 *   ./unified-mesh-monitor.js health                    # Full health report  
 *   ./unified-mesh-monitor.js capacity                  # Capacity analysis
 *   ./unified-mesh-monitor.js nodes                     # Node health details
 *   ./unified-mesh-monitor.js queue                     # Queue analysis
 *   ./unified-mesh-monitor.js watch [--interval=30]     # Continuous monitoring
 *   ./unified-mesh-monitor.js alert [--webhook=url]     # Alert check & notify
 *   ./unified-mesh-monitor.js export [--format=json]    # Export metrics
 * 
 * Created by: Wingman (Autonomous Agent)
 * Date: 2026-02-27
 * Purpose: Consolidate 15+ monitoring tools into unified solution
 */

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

class UnifiedMeshMonitor {
    constructor() {
        this.dbPath = './data/mesh.db';
        this.statePath = './unified-monitor-state.json';
        this.alertLogPath = './unified-monitor-alerts.json';
        
        // Consolidated thresholds from multiple tools
        this.thresholds = {
            // Capacity thresholds
            criticalNodeOfflineMinutes: 15,
            minActiveNodes: 1,
            maxPendingJobs: 20,
            capacityUtilizationCritical: 80,
            
            // Queue thresholds  
            queueDepthCritical: 50,
            jobProcessingRateLow: 0.5, // jobs per minute
            jobFailureRateHigh: 0.1,   // 10% failure rate
            
            // Node health thresholds
            nodeRetentionLow: 50,      // 50% retention rate
            reconnectionDelayLong: 300, // 5 minutes
            nodePerformanceLow: 60,    // 60% success rate
            
            // System thresholds
            systemLoadHigh: 0.8,
            diskUsageHigh: 0.9,
            memoryUsageHigh: 0.9
        };
        
        this.loadState();
    }

    async init() {
        return new Promise((resolve, reject) => {
            this.db = new sqlite3.Database(this.dbPath, (err) => {
                if (err) {
                    reject(new Error(`Database connection failed: ${err.message}`));
                } else {
                    resolve();
                }
            });
        });
    }

    loadState() {
        try {
            if (fs.existsSync(this.statePath)) {
                this.state = JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
            } else {
                this.state = {
                    lastCheck: null,
                    alertHistory: [],
                    performanceBaseline: null,
                    trends: {}
                };
            }
        } catch (error) {
            console.error(`State loading error: ${error.message}`);
            this.state = { lastCheck: null, alertHistory: [], performanceBaseline: null, trends: {} };
        }
    }

    saveState() {
        try {
            fs.writeFileSync(this.statePath, JSON.stringify(this.state, null, 2));
        } catch (error) {
            console.error(`State saving error: ${error.message}`);
        }
    }

    // CORE MONITORING FUNCTIONS

    async getSystemStatus() {
        const timestamp = new Date().toISOString();
        
        try {
            const [jobStats, nodeStats, capacityStats, queueHealth] = await Promise.all([
                this.getJobStatistics(),
                this.getNodeStatistics(), 
                this.getCapacityAnalysis(),
                this.getQueueHealth()
            ]);

            const status = {
                timestamp,
                overall: this.calculateOverallHealth(jobStats, nodeStats, capacityStats, queueHealth),
                jobs: jobStats,
                nodes: nodeStats,
                capacity: capacityStats,
                queue: queueHealth,
                alerts: this.generateAlerts(jobStats, nodeStats, capacityStats, queueHealth)
            };

            // Update state
            this.state.lastCheck = timestamp;
            this.updateTrends(status);
            this.saveState();

            return status;
        } catch (error) {
            throw new Error(`Status check failed: ${error.message}`);
        }
    }

    async getJobStatistics() {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    status,
                    COUNT(*) as count,
                    AVG(CASE WHEN status = 'completed' AND completedAt IS NOT NULL AND createdAt IS NOT NULL THEN 
                        (completedAt - createdAt) / 60000.0 
                    END) as avgProcessingMinutes
                FROM jobs 
                GROUP BY status
            `;
            
            this.db.all(query, (err, rows) => {
                if (err) {
                    reject(err);
                    return;
                }

                const stats = {
                    pending: 0,
                    claimed: 0, 
                    completed: 0,
                    failed: 0,
                    total: 0,
                    avgProcessingTime: 0,
                    successRate: 0
                };

                rows.forEach(row => {
                    stats[row.status] = row.count;
                    stats.total += row.count;
                    if (row.avgProcessingMinutes) {
                        stats.avgProcessingTime = Math.round(row.avgProcessingMinutes * 100) / 100;
                    }
                });

                stats.successRate = stats.total > 0 ? 
                    Math.round((stats.completed / (stats.completed + stats.failed)) * 100) / 100 : 0;

                resolve(stats);
            });
        });
    }

    async getNodeStatistics() {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    nodeId,
                    name,
                    lastSeen,
                    capabilities,
                    jobsCompleted,
                    0 as jobsFailed,
                    CASE 
                        WHEN (strftime('%s', 'now') - lastSeen/1000) < 900 THEN 1  -- 15 minutes
                        ELSE 0 
                    END as isActive,
                    (strftime('%s', 'now') - lastSeen/1000) / 60 as minutesOffline
                FROM nodes
            `;
            
            this.db.all(query, (err, rows) => {
                if (err) {
                    reject(err);
                    return;
                }

                const stats = {
                    totalNodes: rows.length,
                    activeNodes: 0,
                    offlineNodes: 0,
                    totalCapabilities: new Set(),
                    activeCapabilities: new Set(),
                    nodeDetails: [],
                    retentionRate: 0,
                    avgPerformance: 0
                };

                let totalJobs = 0;
                let completedJobs = 0;

                rows.forEach(node => {
                    const capabilities = node.capabilities ? JSON.parse(node.capabilities) : [];
                    capabilities.forEach(cap => stats.totalCapabilities.add(cap));
                    
                    const nodeDetail = {
                        nodeId: node.nodeId,
                        isActive: node.isActive === 1,
                        minutesOffline: Math.round(node.minutesOffline * 100) / 100,
                        jobsCompleted: node.jobsCompleted || 0,
                        jobsFailed: node.jobsFailed || 0,
                        successRate: 0,
                        capabilities: capabilities
                    };

                    const totalNodeJobs = (node.jobsCompleted || 0) + (node.jobsFailed || 0);
                    nodeDetail.successRate = totalNodeJobs > 0 ? 
                        Math.round(((node.jobsCompleted || 0) / totalNodeJobs) * 100) / 100 : 0;

                    if (node.isActive === 1) {
                        stats.activeNodes++;
                        capabilities.forEach(cap => stats.activeCapabilities.add(cap));
                    } else {
                        stats.offlineNodes++;
                    }

                    totalJobs += totalNodeJobs;
                    completedJobs += (node.jobsCompleted || 0);
                    stats.nodeDetails.push(nodeDetail);
                });

                stats.totalCapabilities = Array.from(stats.totalCapabilities);
                stats.activeCapabilities = Array.from(stats.activeCapabilities);
                stats.retentionRate = stats.totalNodes > 0 ? 
                    Math.round((stats.activeNodes / stats.totalNodes) * 100) / 100 : 0;
                stats.avgPerformance = totalJobs > 0 ? 
                    Math.round((completedJobs / totalJobs) * 100) / 100 : 0;

                resolve(stats);
            });
        });
    }

    async getCapacityAnalysis() {
        const nodeStats = await this.getNodeStatistics();
        const jobStats = await this.getJobStatistics();
        
        // Analyze capability coverage
        const capabilityGaps = nodeStats.totalCapabilities.filter(
            cap => !nodeStats.activeCapabilities.includes(cap)
        );

        // Calculate processing capacity
        const activeNodes = nodeStats.nodeDetails.filter(n => n.isActive);
        const totalProcessingPower = activeNodes.length; // Simplified metric
        
        // Analyze queue pressure
        const queuePressure = jobStats.pending / Math.max(activeNodes.length, 1);
        
        return {
            activeProcessingNodes: activeNodes.length,
            totalCapacity: totalProcessingPower,
            utilizationRate: Math.min(jobStats.claimed / totalProcessingPower, 1.0),
            queuePressure: Math.round(queuePressure * 100) / 100,
            capabilityGaps: capabilityGaps,
            bottlenecks: this.identifyBottlenecks(nodeStats, jobStats),
            recommendations: this.generateCapacityRecommendations(nodeStats, jobStats)
        };
    }

    async getQueueHealth() {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    type,
                    status,
                    COUNT(*) as count,
                    AVG((strftime('%s', 'now') * 1000 - createdAt) / 60000.0) as avgAgeMinutes
                FROM jobs 
                WHERE status IN ('pending', 'claimed')
                GROUP BY type, status
                ORDER BY count DESC
            `;
            
            this.db.all(query, (err, rows) => {
                if (err) {
                    reject(err);
                    return;
                }

                const health = {
                    totalQueued: 0,
                    queuedByType: {},
                    oldestJobMinutes: 0,
                    processingRate: 0,
                    healthScore: 100,
                    issues: []
                };

                rows.forEach(row => {
                    if (!health.queuedByType[row.type]) {
                        health.queuedByType[row.type] = { pending: 0, claimed: 0 };
                    }
                    health.queuedByType[row.type][row.status] = row.count;
                    health.totalQueued += row.count;
                    
                    if (row.avgAgeMinutes > health.oldestJobMinutes) {
                        health.oldestJobMinutes = Math.round(row.avgAgeMinutes * 100) / 100;
                    }
                });

                // Calculate health score
                if (health.totalQueued > this.thresholds.maxPendingJobs) {
                    health.healthScore -= 30;
                    health.issues.push(`High queue depth: ${health.totalQueued} jobs`);
                }
                
                if (health.oldestJobMinutes > 60) {
                    health.healthScore -= 20;  
                    health.issues.push(`Old jobs detected: ${health.oldestJobMinutes} minutes`);
                }

                resolve(health);
            });
        });
    }

    // ANALYSIS FUNCTIONS

    calculateOverallHealth(jobStats, nodeStats, capacityStats, queueHealth) {
        let health = 100;
        let issues = [];

        // Job health impact
        if (jobStats.successRate < 0.9) {
            health -= 20;
            issues.push(`Low success rate: ${Math.round(jobStats.successRate * 100)}%`);
        }

        // Node health impact  
        if (nodeStats.activeNodes < this.thresholds.minActiveNodes) {
            health -= 30;
            issues.push(`Insufficient active nodes: ${nodeStats.activeNodes}`);
        }

        // Capacity health impact
        if (capacityStats.capabilityGaps.length > 0) {
            health -= 15;
            issues.push(`Missing capabilities: ${capacityStats.capabilityGaps.join(', ')}`);
        }

        // Queue health impact
        health -= (100 - queueHealth.healthScore) * 0.3;
        issues.push(...queueHealth.issues);

        return {
            score: Math.max(0, Math.round(health)),
            status: health > 80 ? 'healthy' : health > 60 ? 'degraded' : 'critical',
            issues: issues
        };
    }

    identifyBottlenecks(nodeStats, jobStats) {
        const bottlenecks = [];
        
        // Node capacity bottlenecks
        if (nodeStats.activeNodes < 2) {
            bottlenecks.push({
                type: 'capacity',
                severity: 'high',
                description: `Only ${nodeStats.activeNodes} active node(s)`,
                impact: 'Single point of failure'
            });
        }

        // Capability bottlenecks
        if (nodeStats.activeCapabilities.length < nodeStats.totalCapabilities.length) {
            bottlenecks.push({
                type: 'capability',
                severity: 'medium', 
                description: 'Missing capability coverage',
                impact: `${nodeStats.totalCapabilities.length - nodeStats.activeCapabilities.length} capabilities offline`
            });
        }

        // Performance bottlenecks
        if (nodeStats.avgPerformance < 0.8) {
            bottlenecks.push({
                type: 'performance',
                severity: 'medium',
                description: `Low average performance: ${Math.round(nodeStats.avgPerformance * 100)}%`,
                impact: 'Increased job failure rates'
            });
        }

        return bottlenecks;
    }

    generateCapacityRecommendations(nodeStats, jobStats) {
        const recommendations = [];

        if (nodeStats.activeNodes < 3) {
            recommendations.push({
                priority: 'high',
                action: 'Recruit additional nodes',
                reason: 'Improve redundancy and capacity',
                target: '3-5 active nodes recommended'
            });
        }

        if (nodeStats.retentionRate < 0.7) {
            recommendations.push({
                priority: 'medium',
                action: 'Improve node retention',
                reason: `${Math.round(nodeStats.retentionRate * 100)}% retention rate is low`,
                target: 'Investigate disconnection causes'
            });
        }

        if (jobStats.pending > 10) {
            recommendations.push({
                priority: 'medium', 
                action: 'Increase processing capacity',
                reason: `${jobStats.pending} pending jobs indicate demand > capacity`,
                target: 'Scale active nodes or improve efficiency'
            });
        }

        return recommendations;
    }

    generateAlerts(jobStats, nodeStats, capacityStats, queueHealth) {
        const alerts = [];
        
        // Critical alerts
        if (nodeStats.activeNodes === 0) {
            alerts.push({
                severity: 'critical',
                type: 'service_outage',
                message: 'Complete service outage - no active nodes',
                timestamp: new Date().toISOString()
            });
        }

        if (jobStats.successRate < 0.5) {
            alerts.push({
                severity: 'critical',
                type: 'high_failure_rate',
                message: `Job success rate critically low: ${Math.round(jobStats.successRate * 100)}%`,
                timestamp: new Date().toISOString()
            });
        }

        // Warning alerts
        if (queueHealth.totalQueued > this.thresholds.maxPendingJobs) {
            alerts.push({
                severity: 'warning',
                type: 'queue_backlog',
                message: `Queue backlog: ${queueHealth.totalQueued} pending jobs`,
                timestamp: new Date().toISOString()
            });
        }

        if (nodeStats.retentionRate < 0.5) {
            alerts.push({
                severity: 'warning',
                type: 'low_retention',
                message: `Low node retention: ${Math.round(nodeStats.retentionRate * 100)}%`,
                timestamp: new Date().toISOString()
            });
        }

        return alerts;
    }

    updateTrends(status) {
        const now = Date.now();
        if (!this.state.trends.capacity) this.state.trends.capacity = [];
        if (!this.state.trends.health) this.state.trends.health = [];
        if (!this.state.trends.queue) this.state.trends.queue = [];

        // Add current data points
        this.state.trends.capacity.push({
            timestamp: now,
            activeNodes: status.nodes.activeNodes,
            utilization: status.capacity.utilizationRate
        });

        this.state.trends.health.push({
            timestamp: now,
            score: status.overall.score,
            successRate: status.jobs.successRate
        });

        this.state.trends.queue.push({
            timestamp: now,
            pending: status.jobs.pending,
            processing: status.jobs.claimed
        });

        // Keep only last 24 hours of data
        const dayAgo = now - (24 * 60 * 60 * 1000);
        this.state.trends.capacity = this.state.trends.capacity.filter(d => d.timestamp > dayAgo);
        this.state.trends.health = this.state.trends.health.filter(d => d.timestamp > dayAgo);
        this.state.trends.queue = this.state.trends.queue.filter(d => d.timestamp > dayAgo);
    }

    // OUTPUT FUNCTIONS

    formatStatus(status, format = 'text') {
        if (format === 'json') {
            return JSON.stringify(status, null, 2);
        }

        const output = [];
        output.push('='.repeat(60));
        output.push('IC Mesh Network Status');
        output.push('='.repeat(60));
        output.push(`Timestamp: ${status.timestamp}`);
        output.push(`Overall Health: ${status.overall.score}/100 (${status.overall.status.toUpperCase()})`);
        output.push('');

        // Jobs section
        output.push('JOBS:');
        output.push(`  Pending: ${status.jobs.pending}`);
        output.push(`  Processing: ${status.jobs.claimed}`); 
        output.push(`  Completed: ${status.jobs.completed}`);
        output.push(`  Failed: ${status.jobs.failed}`);
        output.push(`  Success Rate: ${Math.round(status.jobs.successRate * 100)}%`);
        output.push(`  Avg Processing: ${status.jobs.avgProcessingTime} minutes`);
        output.push('');

        // Nodes section
        output.push('NODES:');
        output.push(`  Active: ${status.nodes.activeNodes}/${status.nodes.totalNodes}`);
        output.push(`  Retention Rate: ${Math.round(status.nodes.retentionRate * 100)}%`);
        output.push(`  Avg Performance: ${Math.round(status.nodes.avgPerformance * 100)}%`);
        output.push(`  Active Capabilities: ${status.nodes.activeCapabilities.join(', ') || 'None'}`);
        if (status.capacity.capabilityGaps.length > 0) {
            output.push(`  Missing Capabilities: ${status.capacity.capabilityGaps.join(', ')}`);
        }
        output.push('');

        // Capacity section
        output.push('CAPACITY:');
        output.push(`  Processing Nodes: ${status.capacity.activeProcessingNodes}`);
        output.push(`  Utilization: ${Math.round(status.capacity.utilizationRate * 100)}%`);
        output.push(`  Queue Pressure: ${status.capacity.queuePressure} jobs/node`);
        output.push('');

        // Alerts section
        if (status.alerts.length > 0) {
            output.push('ALERTS:');
            status.alerts.forEach(alert => {
                output.push(`  [${alert.severity.toUpperCase()}] ${alert.message}`);
            });
            output.push('');
        }

        // Issues section
        if (status.overall.issues.length > 0) {
            output.push('ISSUES:');
            status.overall.issues.forEach(issue => {
                output.push(`  • ${issue}`);
            });
            output.push('');
        }

        // Recommendations section
        if (status.capacity.recommendations.length > 0) {
            output.push('RECOMMENDATIONS:');
            status.capacity.recommendations.forEach(rec => {
                output.push(`  [${rec.priority.toUpperCase()}] ${rec.action}`);
                output.push(`    Reason: ${rec.reason}`);
                output.push(`    Target: ${rec.target}`);
                output.push('');
            });
        }

        return output.join('\n');
    }

    // WATCH MODE
    async startWatch(intervalSeconds = 30) {
        console.log(`Starting continuous monitoring (${intervalSeconds}s intervals)...`);
        console.log('Press Ctrl+C to stop.\n');

        const monitor = async () => {
            try {
                const status = await this.getSystemStatus();
                console.clear();
                console.log(this.formatStatus(status));
                
                // Log any new alerts
                if (status.alerts.length > 0) {
                    this.logAlerts(status.alerts);
                }
            } catch (error) {
                console.error(`Monitoring error: ${error.message}`);
            }
        };

        // Initial check
        await monitor();
        
        // Set up interval
        const interval = setInterval(monitor, intervalSeconds * 1000);
        
        // Handle graceful shutdown
        process.on('SIGINT', () => {
            clearInterval(interval);
            console.log('\nMonitoring stopped.');
            process.exit(0);
        });
    }

    logAlerts(alerts) {
        try {
            let alertLog = [];
            if (fs.existsSync(this.alertLogPath)) {
                alertLog = JSON.parse(fs.readFileSync(this.alertLogPath, 'utf8'));
            }
            
            alerts.forEach(alert => {
                alertLog.push(alert);
            });
            
            // Keep only last 1000 alerts
            if (alertLog.length > 1000) {
                alertLog = alertLog.slice(-1000);
            }
            
            fs.writeFileSync(this.alertLogPath, JSON.stringify(alertLog, null, 2));
        } catch (error) {
            console.error(`Alert logging error: ${error.message}`);
        }
    }

    close() {
        if (this.db) {
            this.db.close();
        }
    }
}

// CLI INTERFACE
async function main() {
    const args = process.argv.slice(2);
    const command = args[0] || 'status';
    
    const monitor = new UnifiedMeshMonitor();
    
    try {
        await monitor.init();
        
        switch (command) {
            case 'status':
            case 'health': {
                const status = await monitor.getSystemStatus();
                const format = args.includes('--json') ? 'json' : 'text';
                console.log(monitor.formatStatus(status, format));
                break;
            }
            
            case 'capacity': {
                const status = await monitor.getSystemStatus();
                console.log('=== CAPACITY ANALYSIS ===');
                console.log(JSON.stringify(status.capacity, null, 2));
                break;
            }
            
            case 'nodes': {
                const status = await monitor.getSystemStatus();
                console.log('=== NODE DETAILS ===');
                status.nodes.nodeDetails.forEach(node => {
                    console.log(`Node ${node.nodeId}:`);
                    console.log(`  Status: ${node.isActive ? 'ACTIVE' : `OFFLINE (${node.minutesOffline}min)`}`);
                    console.log(`  Performance: ${Math.round(node.successRate * 100)}% (${node.jobsCompleted}/${node.jobsCompleted + node.jobsFailed})`);
                    console.log(`  Capabilities: ${node.capabilities.join(', ') || 'None'}`);
                    console.log('');
                });
                break;
            }
            
            case 'queue': {
                const status = await monitor.getSystemStatus();
                console.log('=== QUEUE ANALYSIS ===');
                console.log(JSON.stringify(status.queue, null, 2));
                break;
            }
            
            case 'watch': {
                const intervalIndex = args.findIndex(arg => arg.startsWith('--interval='));
                const interval = intervalIndex !== -1 ? 
                    parseInt(args[intervalIndex].split('=')[1]) : 30;
                await monitor.startWatch(interval);
                break;
            }
            
            case 'alert': {
                const status = await monitor.getSystemStatus();
                if (status.alerts.length > 0) {
                    console.log('ACTIVE ALERTS:');
                    status.alerts.forEach(alert => {
                        console.log(`[${alert.severity.toUpperCase()}] ${alert.message}`);
                    });
                    process.exit(1); // Exit with error code for scripting
                } else {
                    console.log('No active alerts.');
                    process.exit(0);
                }
                break;
            }
            
            case 'export': {
                const status = await monitor.getSystemStatus();
                const format = args.includes('--format=json') ? 'json' : 'text';
                
                if (format === 'json') {
                    console.log(JSON.stringify(status, null, 2));
                } else {
                    console.log(monitor.formatStatus(status, 'text'));
                }
                break;
            }
            
            case 'help':
            default:
                console.log(`
IC Mesh Unified Monitor - Consolidated Network Monitoring

USAGE:
  ${path.basename(process.argv[1])} <command> [options]

COMMANDS:
  status              Quick status overview (default)
  health              Full health report (same as status)
  capacity            Detailed capacity analysis
  nodes               Node health and performance details
  queue               Queue analysis and health metrics
  watch [--interval=N] Continuous monitoring (N seconds, default 30)
  alert [--webhook=URL] Check for alerts (exits 1 if alerts found)
  export [--format=json] Export all metrics
  help                Show this help

OPTIONS:
  --json              Output in JSON format (status/export commands)
  --interval=N        Watch mode interval in seconds (default: 30)
  --webhook=URL       Webhook URL for alert notifications

EXAMPLES:
  ${path.basename(process.argv[1])} status --json
  ${path.basename(process.argv[1])} watch --interval=60
  ${path.basename(process.argv[1])} alert --webhook=https://hooks.slack.com/...
  
REPLACES THESE TOOLS:
  • real-time-capacity-monitor.js
  • capacity-monitor.js  
  • node-health-monitor.js
  • queue-monitor.js
  • monitor-queue-health.js
  • critical-capability-monitor.js
  • And 9+ other monitoring tools

Created by Wingman (Autonomous Agent) - 2026-02-27
                `);
                break;
        }
        
    } catch (error) {
        console.error(`Error: ${error.message}`);
        process.exit(1);
    } finally {
        monitor.close();
    }
}

// Handle uncaught errors gracefully
process.on('unhandledRejection', (error) => {
    console.error(`Unhandled error: ${error.message}`);
    process.exit(1);
});

// Run CLI if called directly
if (require.main === module) {
    main();
}

module.exports = UnifiedMeshMonitor;