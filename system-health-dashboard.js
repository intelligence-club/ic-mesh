#!/usr/bin/env node

/**
 * IC Mesh System Health Dashboard
 * 
 * Consolidated real-time system health monitoring with integrated diagnostics.
 * Provides a single view of all critical system metrics, ongoing issues,
 * and automated diagnostic suggestions.
 * 
 * Features:
 * - Real-time system metrics aggregation
 * - Historical trend analysis 
 * - Automated issue diagnosis
 * - Performance bottleneck identification
 * - Resource utilization tracking
 * - Alert threshold management
 * - Integration with existing monitoring tools
 * 
 * Usage:
 *   node system-health-dashboard.js                 # Full dashboard view
 *   node system-health-dashboard.js --live          # Live updating dashboard  
 *   node system-health-dashboard.js --alerts        # Alert status only
 *   node system-health-dashboard.js --performance   # Performance metrics only
 *   node system-health-dashboard.js --export        # Export metrics to JSON
 */

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

class SystemHealthDashboard {
    constructor() {
        this.dbPath = './data/mesh.db';
        this.metricsPath = './data/system-metrics.json';
        this.alertsPath = './data/active-alerts.json';
        this.healthHistoryPath = './data/health-history.json';
        this.configPath = './config/health-config.json';
        
        // Default health thresholds
        this.defaultThresholds = {
            criticalPendingJobs: 50,
            highPendingJobs: 20,
            minActiveNodes: 2,
            maxNodeOfflineMinutes: 30,
            minJobCompletionRate: 0.85,
            maxMemoryUsagePercent: 90,
            maxCpuUsagePercent: 85,
            minDiskFreeGB: 5,
            maxResponseTimeMs: 2000
        };
        
        this.loadConfig();
        this.loadHealthHistory();
    }

    async init() {
        return new Promise((resolve, reject) => {
            this.db = new sqlite3.Database(this.dbPath, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    loadConfig() {
        try {
            if (fs.existsSync(this.configPath)) {
                const config = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
                this.thresholds = { ...this.defaultThresholds, ...config.thresholds };
                this.alertConfig = config.alerts || { enabled: true, channels: [] };
            } else {
                this.thresholds = this.defaultThresholds;
                this.alertConfig = { enabled: true, channels: [] };
                this.saveConfig();
            }
        } catch (error) {
            console.error('Failed to load config, using defaults:', error.message);
            this.thresholds = this.defaultThresholds;
            this.alertConfig = { enabled: true, channels: [] };
        }
    }

    saveConfig() {
        try {
            const config = {
                thresholds: this.thresholds,
                alerts: this.alertConfig,
                lastUpdated: new Date().toISOString()
            };
            fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2));
        } catch (error) {
            console.error('Failed to save config:', error.message);
        }
    }

    loadHealthHistory() {
        try {
            if (fs.existsSync(this.healthHistoryPath)) {
                this.healthHistory = JSON.parse(fs.readFileSync(this.healthHistoryPath, 'utf8'));
            } else {
                this.healthHistory = {
                    snapshots: [],
                    trends: {},
                    incidents: []
                };
            }
        } catch (error) {
            console.error('Failed to load health history:', error.message);
            this.healthHistory = { snapshots: [], trends: {}, incidents: [] };
        }
    }

    saveHealthHistory() {
        try {
            // Keep only last 1000 snapshots to manage file size
            if (this.healthHistory.snapshots.length > 1000) {
                this.healthHistory.snapshots = this.healthHistory.snapshots.slice(-1000);
            }
            
            fs.writeFileSync(this.healthHistoryPath, JSON.stringify(this.healthHistory, null, 2));
        } catch (error) {
            console.error('Failed to save health history:', error.message);
        }
    }

    async collectSystemMetrics() {
        const timestamp = new Date().toISOString();
        const metrics = {
            timestamp,
            system: {},
            mesh: {},
            performance: {},
            alerts: []
        };

        try {
            // Collect mesh network metrics
            metrics.mesh = await this.collectMeshMetrics();
            
            // Collect system performance metrics
            metrics.performance = await this.collectPerformanceMetrics();
            
            // Collect system resource metrics
            metrics.system = await this.collectSystemResourceMetrics();
            
            // Generate alerts based on thresholds
            metrics.alerts = await this.generateAlerts(metrics);
            
            // Calculate overall health score
            metrics.healthScore = this.calculateHealthScore(metrics);
            
            // Record in history
            if (!this.healthHistory.snapshots) {
                this.healthHistory.snapshots = [];
            }
            this.healthHistory.snapshots.push(metrics);
            this.updateTrends(metrics);
            
            return metrics;
        } catch (error) {
            console.error('Failed to collect system metrics:', error.message);
            metrics.error = error.message;
            return metrics;
        }
    }

    async collectMeshMetrics() {
        const mesh = {};
        
        // Jobs metrics
        const jobStats = await this.queryDatabase(`
            SELECT 
                status,
                COUNT(*) as count,
                AVG(computeMs) as avgComputeMs,
                SUM(creditAmount) as totalCredits
            FROM jobs 
            GROUP BY status
        `);
        
        mesh.jobs = {
            total: jobStats.reduce((sum, stat) => sum + stat.count, 0),
            byStatus: {}
        };
        
        jobStats.forEach(stat => {
            mesh.jobs.byStatus[stat.status] = {
                count: stat.count,
                avgComputeMs: stat.avgComputeMs || 0,
                totalCredits: stat.totalCredits || 0
            };
        });

        // Pending jobs by type
        const pendingByType = await this.queryDatabase(`
            SELECT type, COUNT(*) as count 
            FROM jobs 
            WHERE status = 'pending' 
            GROUP BY type
        `);
        mesh.pendingJobsByType = {};
        pendingByType.forEach(job => {
            mesh.pendingJobsByType[job.type] = job.count;
        });

        // Node metrics
        const nodeStats = await this.queryDatabase(`
            SELECT 
                COUNT(*) as totalNodes,
                SUM(CASE WHEN (strftime('%s', 'now') - lastSeen) < 300 THEN 1 ELSE 0 END) as activeNodes,
                SUM(jobsCompleted) as totalJobsCompleted,
                SUM(computeMinutes) as totalComputeMinutes,
                AVG(cpuCores) as avgCpuCores,
                SUM(cpuCores) as totalCpuCores,
                AVG(ramMB) as avgRamMB,
                SUM(ramMB) as totalRamMB
            FROM nodes
        `);
        
        mesh.nodes = nodeStats[0] || {};
        
        // Active capabilities
        const activeCapabilities = await this.queryDatabase(`
            SELECT capabilities 
            FROM nodes 
            WHERE (strftime('%s', 'now') - lastSeen) < 300
            AND capabilities != '[]'
        `);
        
        const capabilitySet = new Set();
        activeCapabilities.forEach(node => {
            try {
                const caps = JSON.parse(node.capabilities || '[]');
                caps.forEach(cap => capabilitySet.add(cap));
            } catch (e) {
                // Skip invalid JSON
            }
        });
        
        mesh.activeCapabilities = Array.from(capabilitySet);
        
        return mesh;
    }

    async collectPerformanceMetrics() {
        const performance = {};
        
        try {
            // Database performance
            const dbStart = Date.now();
            await this.queryDatabase("SELECT COUNT(*) FROM jobs");
            performance.dbResponseTime = Date.now() - dbStart;
            
            // Recent job processing rates  
            const recentJobs = await this.queryDatabase(`
                SELECT 
                    COUNT(*) as completed,
                    AVG(computeMs) as avgProcessingTime,
                    MIN(completedAt) as oldestCompletion,
                    MAX(completedAt) as newestCompletion
                FROM jobs 
                WHERE status = 'completed' 
                AND completedAt > strftime('%s', 'now') - 3600
            `);
            
            const recentStats = recentJobs[0];
            if (recentStats && recentStats.completed > 0) {
                const timeSpanHours = (recentStats.newestCompletion - recentStats.oldestCompletion) / 3600;
                performance.jobsPerHour = timeSpanHours > 0 ? recentStats.completed / timeSpanHours : 0;
                performance.avgProcessingTime = recentStats.avgProcessingTime;
            } else {
                performance.jobsPerHour = 0;
                performance.avgProcessingTime = 0;
            }
            
            // Success rate calculation
            const successStats = await this.queryDatabase(`
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
                    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
                FROM jobs 
                WHERE createdAt > strftime('%s', 'now') - 86400
            `);
            
            const stats = successStats[0];
            performance.successRate = stats.total > 0 ? stats.completed / stats.total : 0;
            performance.failureRate = stats.total > 0 ? stats.failed / stats.total : 0;
            
        } catch (error) {
            console.error('Failed to collect performance metrics:', error.message);
            performance.error = error.message;
        }
        
        return performance;
    }

    async collectSystemResourceMetrics() {
        const system = {};
        
        try {
            // Memory usage
            const meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
            const memTotal = parseInt(meminfo.match(/MemTotal:\s+(\d+)/)?.[1] || 0) * 1024;
            const memAvailable = parseInt(meminfo.match(/MemAvailable:\s+(\d+)/)?.[1] || 0) * 1024;
            const memUsed = memTotal - memAvailable;
            
            system.memory = {
                totalBytes: memTotal,
                usedBytes: memUsed,
                availableBytes: memAvailable,
                usagePercent: memTotal > 0 ? (memUsed / memTotal) * 100 : 0
            };
            
            // Disk usage
            const { stdout: dfOutput } = await execAsync("df -BG /");
            const dfLines = dfOutput.trim().split('\n');
            if (dfLines.length >= 2) {
                const parts = dfLines[1].split(/\s+/);
                if (parts.length >= 6) {
                    system.disk = {
                        totalGB: parseInt(parts[1].replace('G', '')),
                        usedGB: parseInt(parts[2].replace('G', '')),
                        availableGB: parseInt(parts[3].replace('G', '')),
                        usagePercent: parseInt(parts[4].replace('%', ''))
                    };
                }
            }
            
            // CPU load
            const loadavg = fs.readFileSync('/proc/loadavg', 'utf8').split(' ');
            system.cpu = {
                load1min: parseFloat(loadavg[0]),
                load5min: parseFloat(loadavg[1]),
                load15min: parseFloat(loadavg[2])
            };
            
            // System uptime
            const uptime = fs.readFileSync('/proc/uptime', 'utf8').split(' ')[0];
            system.uptimeSeconds = parseFloat(uptime);
            
        } catch (error) {
            console.error('Failed to collect system resource metrics:', error.message);
            system.error = error.message;
        }
        
        return system;
    }

    calculateHealthScore(metrics) {
        let score = 100;
        let factors = [];
        
        // Penalize for pending jobs
        const pendingJobs = metrics.mesh.jobs?.byStatus?.pending?.count || 0;
        if (pendingJobs > this.thresholds.criticalPendingJobs) {
            score -= 30;
            factors.push(`High pending jobs: ${pendingJobs}`);
        } else if (pendingJobs > this.thresholds.highPendingJobs) {
            score -= 15;
            factors.push(`Moderate pending jobs: ${pendingJobs}`);
        }
        
        // Penalize for low active nodes
        const activeNodes = metrics.mesh.nodes?.activeNodes || 0;
        if (activeNodes < this.thresholds.minActiveNodes) {
            score -= 25;
            factors.push(`Low active nodes: ${activeNodes}`);
        }
        
        // Penalize for poor success rate
        const successRate = metrics.performance?.successRate || 1;
        if (successRate < this.thresholds.minJobCompletionRate) {
            score -= 20;
            factors.push(`Low success rate: ${(successRate * 100).toFixed(1)}%`);
        }
        
        // Penalize for high resource usage
        const memUsage = metrics.system.memory?.usagePercent || 0;
        const diskUsage = metrics.system.disk?.usagePercent || 0;
        
        if (memUsage > this.thresholds.maxMemoryUsagePercent) {
            score -= 10;
            factors.push(`High memory usage: ${memUsage.toFixed(1)}%`);
        }
        
        if (diskUsage > 90) {
            score -= 15;
            factors.push(`High disk usage: ${diskUsage}%`);
        }
        
        // Penalize for slow database performance
        const dbResponseTime = metrics.performance?.dbResponseTime || 0;
        if (dbResponseTime > this.thresholds.maxResponseTimeMs) {
            score -= 10;
            factors.push(`Slow DB response: ${dbResponseTime}ms`);
        }
        
        return {
            score: Math.max(0, score),
            factors,
            level: this.getHealthLevel(Math.max(0, score))
        };
    }

    getHealthLevel(score) {
        if (score >= 90) return 'EXCELLENT';
        if (score >= 75) return 'GOOD';
        if (score >= 60) return 'FAIR';
        if (score >= 40) return 'POOR';
        return 'CRITICAL';
    }

    async generateAlerts(metrics) {
        const alerts = [];
        const timestamp = new Date().toISOString();
        
        // Critical pending jobs alert
        const pendingJobs = metrics.mesh.jobs?.byStatus?.pending?.count || 0;
        if (pendingJobs > this.thresholds.criticalPendingJobs) {
            alerts.push({
                severity: 'CRITICAL',
                type: 'HIGH_PENDING_JOBS',
                message: `${pendingJobs} jobs pending (threshold: ${this.thresholds.criticalPendingJobs})`,
                value: pendingJobs,
                threshold: this.thresholds.criticalPendingJobs,
                timestamp
            });
        }
        
        // Low active nodes alert
        const activeNodes = metrics.mesh.nodes?.activeNodes || 0;
        if (activeNodes < this.thresholds.minActiveNodes) {
            alerts.push({
                severity: 'HIGH',
                type: 'LOW_ACTIVE_NODES',
                message: `Only ${activeNodes} active nodes (minimum: ${this.thresholds.minActiveNodes})`,
                value: activeNodes,
                threshold: this.thresholds.minActiveNodes,
                timestamp
            });
        }
        
        // Resource usage alerts
        const memUsage = metrics.system.memory?.usagePercent || 0;
        if (memUsage > this.thresholds.maxMemoryUsagePercent) {
            alerts.push({
                severity: 'MEDIUM',
                type: 'HIGH_MEMORY_USAGE',
                message: `Memory usage at ${memUsage.toFixed(1)}% (threshold: ${this.thresholds.maxMemoryUsagePercent}%)`,
                value: memUsage,
                threshold: this.thresholds.maxMemoryUsagePercent,
                timestamp
            });
        }
        
        // Missing capabilities alert
        const blockedCapabilities = this.findBlockedCapabilities(metrics);
        if (blockedCapabilities.length > 0) {
            alerts.push({
                severity: 'HIGH',
                type: 'BLOCKED_CAPABILITIES',
                message: `Capabilities blocked: ${blockedCapabilities.join(', ')}`,
                value: blockedCapabilities,
                timestamp
            });
        }
        
        return alerts;
    }

    findBlockedCapabilities(metrics) {
        const blocked = [];
        const activeCapabilities = new Set(metrics.mesh.activeCapabilities || []);
        const pendingByType = metrics.mesh.pendingJobsByType || {};
        
        // Check for job types with no matching capabilities
        Object.keys(pendingByType).forEach(jobType => {
            const hasCapability = activeCapabilities.has(jobType) || 
                                 activeCapabilities.has(this.getCapabilityAlias(jobType));
            
            if (!hasCapability && pendingByType[jobType] > 0) {
                blocked.push(`${jobType} (${pendingByType[jobType]} jobs)`);
            }
        });
        
        return blocked;
    }

    getCapabilityAlias(jobType) {
        const aliases = {
            'transcribe': 'transcription',
            'transcription': 'whisper',
            'ocr': 'tesseract'
        };
        return aliases[jobType] || jobType;
    }

    updateTrends(currentMetrics) {
        if (!this.healthHistory.trends) {
            this.healthHistory.trends = {};
        }
        
        const trends = this.healthHistory.trends;
        const timestamp = Date.now();
        
        // Initialize trend arrays if needed
        const trendMetrics = [
            'healthScore.score',
            'mesh.jobs.byStatus.pending.count',
            'mesh.nodes.activeNodes',
            'performance.successRate',
            'system.memory.usagePercent'
        ];
        
        trendMetrics.forEach(metric => {
            if (!trends[metric]) {
                trends[metric] = [];
            }
            
            const value = this.getNestedValue(currentMetrics, metric);
            if (value !== undefined && value !== null) {
                trends[metric].push({ timestamp, value });
                
                // Keep only last 200 data points per metric
                if (trends[metric].length > 200) {
                    trends[metric] = trends[metric].slice(-200);
                }
            }
        });
    }

    getNestedValue(obj, path) {
        return path.split('.').reduce((current, key) => {
            return current && current[key] !== undefined ? current[key] : undefined;
        }, obj);
    }

    displayDashboard(metrics) {
        console.clear();
        console.log('🖥️  IC MESH SYSTEM HEALTH DASHBOARD');
        console.log('=====================================');
        console.log(`📅 ${new Date(metrics.timestamp).toLocaleString()}`);
        console.log(`🏥 Health: ${metrics.healthScore.level} (${metrics.healthScore.score}/100)`);
        
        if (metrics.healthScore.factors.length > 0) {
            console.log(`⚠️  Issues: ${metrics.healthScore.factors.join(', ')}`);
        }
        
        console.log('\n🌐 MESH NETWORK STATUS');
        console.log('---------------------');
        console.log(`📊 Total Jobs: ${metrics.mesh.jobs.total}`);
        console.log(`⏳ Pending: ${metrics.mesh.jobs.byStatus.pending?.count || 0}`);
        console.log(`✅ Completed: ${metrics.mesh.jobs.byStatus.completed?.count || 0}`);
        console.log(`❌ Failed: ${metrics.mesh.jobs.byStatus.failed?.count || 0}`);
        
        if (Object.keys(metrics.mesh.pendingJobsByType).length > 0) {
            console.log('\n📋 Pending by Type:');
            Object.entries(metrics.mesh.pendingJobsByType).forEach(([type, count]) => {
                console.log(`   ${type}: ${count}`);
            });
        }
        
        console.log('\n🖥️  NODE STATUS');
        console.log('---------------');
        console.log(`🟢 Active: ${metrics.mesh.nodes.activeNodes}/${metrics.mesh.nodes.totalNodes}`);
        console.log(`⚡ Total CPU Cores: ${metrics.mesh.nodes.totalCpuCores || 0}`);
        console.log(`💾 Total RAM: ${((metrics.mesh.nodes.totalRamMB || 0) / 1024).toFixed(1)} GB`);
        
        if (metrics.mesh.activeCapabilities.length > 0) {
            console.log(`🔧 Capabilities: ${metrics.mesh.activeCapabilities.join(', ')}`);
        }
        
        console.log('\n📈 PERFORMANCE');
        console.log('--------------');
        console.log(`🚀 Jobs/hour: ${(metrics.performance.jobsPerHour || 0).toFixed(1)}`);
        console.log(`✅ Success rate: ${((metrics.performance.successRate || 0) * 100).toFixed(1)}%`);
        console.log(`⏱️  Avg processing: ${(metrics.performance.avgProcessingTime || 0).toFixed(0)}ms`);
        console.log(`💿 DB response: ${metrics.performance.dbResponseTime}ms`);
        
        console.log('\n💻 SYSTEM RESOURCES');
        console.log('------------------');
        if (metrics.system.memory) {
            const memGB = metrics.system.memory.usedBytes / (1024**3);
            const memTotalGB = metrics.system.memory.totalBytes / (1024**3);
            console.log(`💾 Memory: ${memGB.toFixed(1)}/${memTotalGB.toFixed(1)} GB (${metrics.system.memory.usagePercent.toFixed(1)}%)`);
        }
        
        if (metrics.system.disk) {
            console.log(`💿 Disk: ${metrics.system.disk.usedGB}/${metrics.system.disk.totalGB} GB (${metrics.system.disk.usagePercent}%)`);
        }
        
        if (metrics.system.cpu) {
            console.log(`⚡ Load: ${metrics.system.cpu.load1min} ${metrics.system.cpu.load5min} ${metrics.system.cpu.load15min}`);
        }
        
        if (metrics.system.uptimeSeconds) {
            const uptimeHours = (metrics.system.uptimeSeconds / 3600).toFixed(1);
            console.log(`⏰ Uptime: ${uptimeHours} hours`);
        }
        
        // Display active alerts
        if (metrics.alerts.length > 0) {
            console.log('\n🚨 ACTIVE ALERTS');
            console.log('---------------');
            metrics.alerts.forEach(alert => {
                const icon = alert.severity === 'CRITICAL' ? '🔥' : alert.severity === 'HIGH' ? '⚠️' : '⚡';
                console.log(`${icon} ${alert.severity}: ${alert.message}`);
            });
        }
        
        console.log(`\n🔄 Last updated: ${new Date().toLocaleTimeString()}`);
    }

    displayAlertsOnly(metrics) {
        console.log('🚨 IC MESH ALERTS STATUS');
        console.log('========================');
        
        if (metrics.alerts.length === 0) {
            console.log('✅ No active alerts');
            return;
        }
        
        metrics.alerts.forEach(alert => {
            const icon = alert.severity === 'CRITICAL' ? '🔥' : alert.severity === 'HIGH' ? '⚠️' : '⚡';
            console.log(`${icon} ${alert.severity}: ${alert.message}`);
            
            if (alert.type === 'BLOCKED_CAPABILITIES') {
                console.log('   💡 Action: Contact node operators to restore capabilities');
            } else if (alert.type === 'HIGH_PENDING_JOBS') {
                console.log('   💡 Action: Scale up node capacity or investigate processing delays');
            } else if (alert.type === 'LOW_ACTIVE_NODES') {
                console.log('   💡 Action: Check node connectivity and restart offline nodes');
            }
        });
    }

    displayPerformanceOnly(metrics) {
        console.log('📈 IC MESH PERFORMANCE METRICS');
        console.log('==============================');
        
        console.log(`🚀 Throughput: ${(metrics.performance.jobsPerHour || 0).toFixed(1)} jobs/hour`);
        console.log(`✅ Success Rate: ${((metrics.performance.successRate || 0) * 100).toFixed(1)}%`);
        console.log(`❌ Failure Rate: ${((metrics.performance.failureRate || 0) * 100).toFixed(1)}%`);
        console.log(`⏱️  Processing Time: ${(metrics.performance.avgProcessingTime || 0).toFixed(0)}ms avg`);
        console.log(`💿 Database Response: ${metrics.performance.dbResponseTime}ms`);
        console.log(`🏥 Health Score: ${metrics.healthScore.score}/100 (${metrics.healthScore.level})`);
        
        // Show trends if available
        const trends = this.healthHistory.trends;
        if (trends['performance.successRate'] && trends['performance.successRate'].length >= 2) {
            const recent = trends['performance.successRate'].slice(-10);
            const trend = this.calculateTrend(recent);
            const trendIcon = trend > 0.01 ? '📈' : trend < -0.01 ? '📉' : '➡️';
            console.log(`📊 Success Rate Trend: ${trendIcon} ${trend > 0 ? '+' : ''}${(trend * 100).toFixed(1)}%`);
        }
    }

    calculateTrend(dataPoints) {
        if (dataPoints.length < 2) return 0;
        
        const first = dataPoints[0].value;
        const last = dataPoints[dataPoints.length - 1].value;
        return last - first;
    }

    async exportMetrics(metrics) {
        const exportData = {
            timestamp: metrics.timestamp,
            healthScore: metrics.healthScore,
            summary: {
                totalJobs: metrics.mesh.jobs.total,
                pendingJobs: metrics.mesh.jobs.byStatus.pending?.count || 0,
                activeNodes: metrics.mesh.nodes.activeNodes,
                successRate: metrics.performance.successRate,
                alertCount: metrics.alerts.length
            },
            fullMetrics: metrics
        };
        
        const filename = `health-export-${Date.now()}.json`;
        fs.writeFileSync(filename, JSON.stringify(exportData, null, 2));
        console.log(`📊 Metrics exported to ${filename}`);
        
        return filename;
    }

    async runLiveDashboard() {
        console.log('🔄 Starting live dashboard (Ctrl+C to exit)...\n');
        
        const updateInterval = 5000; // 5 seconds
        
        const updateDashboard = async () => {
            try {
                const metrics = await this.collectSystemMetrics();
                this.displayDashboard(metrics);
                this.saveHealthHistory();
            } catch (error) {
                console.error('Dashboard update failed:', error.message);
            }
        };
        
        // Initial display
        await updateDashboard();
        
        // Set up periodic updates
        const intervalId = setInterval(updateDashboard, updateInterval);
        
        // Handle graceful shutdown
        process.on('SIGINT', () => {
            clearInterval(intervalId);
            console.log('\n👋 Dashboard stopped');
            this.close();
            process.exit(0);
        });
        
        // Keep the process running
        return new Promise(() => {}); // Never resolves - runs until SIGINT
    }

    async queryDatabase(sql) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    close() {
        if (this.db) {
            this.db.close();
        }
    }
}

// Command line interface
async function main() {
    const dashboard = new SystemHealthDashboard();
    
    try {
        await dashboard.init();
        
        const args = process.argv.slice(2);
        const command = args[0];

        switch (command) {
            case '--live':
                await dashboard.runLiveDashboard();
                break;
                
            case '--alerts':
                const alertMetrics = await dashboard.collectSystemMetrics();
                dashboard.displayAlertsOnly(alertMetrics);
                break;
                
            case '--performance':
                const perfMetrics = await dashboard.collectSystemMetrics();
                dashboard.displayPerformanceOnly(perfMetrics);
                break;
                
            case '--export':
                const exportMetrics = await dashboard.collectSystemMetrics();
                await dashboard.exportMetrics(exportMetrics);
                break;
                
            default:
                // Full dashboard (single snapshot)
                const metrics = await dashboard.collectSystemMetrics();
                dashboard.displayDashboard(metrics);
                dashboard.saveHealthHistory();
                break;
        }
    } catch (error) {
        console.error('System health dashboard failed:', error.message);
        process.exit(1);
    } finally {
        dashboard.close();
    }
}

if (require.main === module) {
    main();
}

module.exports = SystemHealthDashboard;