#!/usr/bin/env node

/**
 * IC Mesh Advanced Node Monitor
 * 
 * Comprehensive node monitoring system with intelligent alerting
 * for preventing service outages like the 2026-02-27 crisis.
 * 
 * Features:
 * - Real-time capacity monitoring
 * - Predictive node disconnection alerts
 * - Critical capability gap detection
 * - Automated contact attempt recommendations
 * - Service availability scoring
 */

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

class AdvancedNodeMonitor {
    constructor(options = {}) {
        this.dbPath = options.dbPath || path.resolve(process.cwd(), 'data', 'mesh.db');
        this.alertThresholds = {
            criticalNodes: 2,           // Alert if less than 2 active nodes
            highValueNodeOffline: 5,    // Alert if node with 50+ jobs goes offline for 5+ minutes
            capabilityGap: 1,          // Alert if any capability has 0 nodes for 1+ minute
            queueBacklog: 10,          // Alert if 10+ jobs pending with limited capacity
            responseTimeThreshold: 300, // Alert if node hasn't responded in 5 minutes
        };
        this.criticalCapabilities = ['transcribe', 'whisper', 'tesseract', 'pdf-extract', 'ocr'];
        this.monitoring = false;
        this.alerts = [];
        this.lastStatus = {};
    }

    async connectDB() {
        return new Promise((resolve, reject) => {
            this.db = new sqlite3.Database(this.dbPath, sqlite3.OPEN_READONLY, (err) => {
                if (err) {
                    reject(new Error(`Database connection failed: ${err.message}`));
                } else {
                    resolve();
                }
            });
        });
    }

    async closeDB() {
        return new Promise((resolve) => {
            if (this.db) {
                this.db.close((err) => {
                    if (err) console.error('Database close error:', err);
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }

    async queryDB(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    async getNetworkStatus() {
        try {
            // Get node status
            const nodes = await this.queryDB(`
                SELECT 
                    nodeId, capabilities, lastSeen, registeredAt,
                    json_extract(flags, '$.quarantined') as quarantined,
                    CASE 
                        WHEN lastSeen IS NULL THEN 0
                        WHEN lastSeen > (strftime('%s', 'now') - 300) * 1000 THEN 1
                        ELSE 0 
                    END as isActive,
                    CASE 
                        WHEN lastSeen IS NULL THEN NULL
                        ELSE ROUND((strftime('%s', 'now') * 1000 - lastSeen) / 60000.0, 1)
                    END as minutesOffline
                FROM nodes 
                ORDER BY lastSeen DESC
            `);

            // Get job performance per node
            const nodeJobs = await this.queryDB(`
                SELECT 
                    claimedBy as nodeId,
                    COUNT(*) as totalJobs,
                    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completedJobs,
                    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failedJobs,
                    AVG(CASE WHEN completedAt IS NOT NULL AND claimedAt IS NOT NULL 
                            THEN (completedAt - claimedAt) / 1000.0 ELSE NULL END) as avgProcessingTime
                FROM jobs 
                WHERE claimedBy IS NOT NULL
                GROUP BY claimedBy
            `);

            // Get pending jobs by capability
            const pendingByCapability = await this.queryDB(`
                SELECT 
                    type as handler,
                    COUNT(*) as pendingCount,
                    MIN(createdAt) as oldestJob,
                    ROUND((strftime('%s', 'now') * 1000 - MIN(createdAt)) / 60000.0, 1) as oldestMinutes
                FROM jobs 
                WHERE status = 'pending'
                GROUP BY type
            `);

            // Get overall queue status
            const queueStats = await this.queryDB(`
                SELECT 
                    COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
                    COUNT(CASE WHEN status = 'claimed' THEN 1 END) as claimed,
                    COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
                    COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
                    COUNT(*) as total
                FROM jobs
            `);

            // Merge node performance data
            const nodeMap = new Map();
            nodeJobs.forEach(job => {
                nodeMap.set(job.nodeId, {
                    ...job,
                    successRate: job.totalJobs > 0 ? Math.round((job.completedJobs / job.totalJobs) * 100) : 0
                });
            });

            nodes.forEach(node => {
                const perf = nodeMap.get(node.nodeId) || {};
                Object.assign(node, perf);
                
                // Parse capabilities
                node.capabilitiesList = node.capabilities ? JSON.parse(node.capabilities) : [];
            });

            return {
                timestamp: Date.now(),
                nodes: nodes,
                pendingByCapability: pendingByCapability,
                queueStats: queueStats[0] || {},
                activeNodes: nodes.filter(n => n.isActive && !n.quarantined),
                totalNodes: nodes.length,
                healthyNodes: nodes.filter(n => n.isActive && !n.quarantined && (n.successRate || 0) >= 80),
                criticalNodes: nodes.filter(n => (n.totalJobs || 0) >= 50), // High-value nodes
            };
        } catch (error) {
            throw new Error(`Failed to get network status: ${error.message}`);
        }
    }

    analyzeNetworkHealth(status) {
        const issues = [];
        const warnings = [];
        const recommendations = [];

        // Critical: No active nodes
        if (status.activeNodes.length === 0) {
            issues.push({
                severity: 'CRITICAL',
                type: 'SERVICE_OUTAGE',
                message: 'Complete service outage - no active nodes available',
                impact: 'All customer jobs blocked',
                pendingJobs: status.queueStats.pending || 0
            });
        }

        // Critical: Too few active nodes
        else if (status.activeNodes.length < this.alertThresholds.criticalNodes) {
            issues.push({
                severity: 'HIGH',
                type: 'LOW_CAPACITY',
                message: `Only ${status.activeNodes.length} active node(s) - capacity crisis risk`,
                impact: 'Single point of failure for customer jobs',
                activeNodes: status.activeNodes.length
            });
        }

        // Check for capability gaps
        for (const capability of this.criticalCapabilities) {
            const activeNodesWithCapability = status.activeNodes.filter(node => 
                node.capabilitiesList && node.capabilitiesList.includes(capability)
            );
            
            const pendingJobs = status.pendingByCapability.find(p => p.handler === capability);
            
            if (activeNodesWithCapability.length === 0 && pendingJobs && pendingJobs.pendingCount > 0) {
                issues.push({
                    severity: 'HIGH',
                    type: 'CAPABILITY_GAP',
                    capability: capability,
                    message: `No active nodes for ${capability} - ${pendingJobs.pendingCount} jobs blocked`,
                    impact: `${pendingJobs.pendingCount} customer jobs cannot be processed`,
                    pendingCount: pendingJobs.pendingCount,
                    oldestMinutes: pendingJobs.oldestMinutes
                });
            } else if (activeNodesWithCapability.length === 1 && pendingJobs && pendingJobs.pendingCount > 5) {
                warnings.push({
                    severity: 'MEDIUM',
                    type: 'SINGLE_CAPABILITY_NODE',
                    capability: capability,
                    message: `Only 1 active node for ${capability} with ${pendingJobs.pendingCount} pending jobs`,
                    impact: 'Single point of failure risk',
                    nodeId: activeNodesWithCapability[0].nodeId
                });
            }
        }

        // Check for high-value node disconnections
        for (const node of status.criticalNodes) {
            if (!node.isActive && node.minutesOffline && node.minutesOffline >= this.alertThresholds.highValueNodeOffline) {
                const severity = node.minutesOffline >= 60 ? 'HIGH' : 'MEDIUM';
                issues.push({
                    severity: severity,
                    type: 'HIGH_VALUE_NODE_OFFLINE',
                    nodeId: node.nodeId,
                    message: `High-value node ${node.nodeId} offline ${node.minutesOffline}min (${node.totalJobs || 0} jobs completed)`,
                    impact: 'Loss of experienced, reliable capacity',
                    offlineMinutes: node.minutesOffline,
                    totalJobs: node.totalJobs || 0,
                    successRate: node.successRate || 0
                });
            }
        }

        // Check queue backlog with limited capacity
        if (status.queueStats.pending >= this.alertThresholds.queueBacklog && status.activeNodes.length <= 2) {
            warnings.push({
                severity: 'MEDIUM',
                type: 'QUEUE_BACKLOG',
                message: `${status.queueStats.pending} jobs pending with only ${status.activeNodes.length} active nodes`,
                impact: 'Customer delays likely, revenue at risk',
                pendingJobs: status.queueStats.pending,
                activeNodes: status.activeNodes.length
            });
        }

        // Generate recommendations
        if (issues.some(i => i.type === 'SERVICE_OUTAGE' || i.type === 'LOW_CAPACITY')) {
            recommendations.push({
                priority: 'IMMEDIATE',
                action: 'CONTACT_OPERATORS',
                message: 'Contact node operators immediately for emergency capacity restoration',
                details: 'Check Discord, email, or direct contact methods for known operators'
            });
        }

        const capabilityGaps = issues.filter(i => i.type === 'CAPABILITY_GAP');
        if (capabilityGaps.length > 0) {
            recommendations.push({
                priority: 'HIGH',
                action: 'RESTORE_CAPABILITIES',
                message: `Restore missing capabilities: ${capabilityGaps.map(c => c.capability).join(', ')}`,
                details: 'Contact operators with these specific capabilities or recruit new operators'
            });
        }

        if (status.criticalNodes.some(n => !n.isActive)) {
            recommendations.push({
                priority: 'MEDIUM',
                action: 'RECOVER_HIGH_VALUE_NODES',
                message: 'Attempt to reconnect high-value nodes that went offline',
                details: 'These nodes have proven reliability and experience'
            });
        }

        return {
            issues: issues.sort((a, b) => {
                const severityOrder = { 'CRITICAL': 3, 'HIGH': 2, 'MEDIUM': 1, 'LOW': 0 };
                return severityOrder[b.severity] - severityOrder[a.severity];
            }),
            warnings,
            recommendations,
            healthScore: this.calculateHealthScore(status, issues, warnings)
        };
    }

    calculateHealthScore(status, issues, warnings) {
        let score = 100;

        // Deduct points for issues
        issues.forEach(issue => {
            switch (issue.severity) {
                case 'CRITICAL': score -= 50; break;
                case 'HIGH': score -= 25; break;
                case 'MEDIUM': score -= 10; break;
                case 'LOW': score -= 5; break;
            }
        });

        warnings.forEach(warning => {
            score -= 5;
        });

        // Bonus points for good metrics
        if (status.activeNodes.length >= 3) score += 5;
        if (status.healthyNodes.length >= 2) score += 5;
        if (status.queueStats.pending <= 5) score += 5;

        return Math.max(0, Math.min(100, Math.round(score)));
    }

    formatReport(status, analysis) {
        const timestamp = new Date(status.timestamp).toISOString();
        let report = [];

        report.push(`🔍 IC MESH NETWORK HEALTH REPORT`);
        report.push(`═══════════════════════════════════════════════════════════`);
        report.push(`📊 Timestamp: ${timestamp}`);
        report.push(`🌡️  Health Score: ${analysis.healthScore}/100`);
        report.push(``);

        // Network overview
        report.push(`📊 NETWORK OVERVIEW`);
        report.push(`─────────────────────────────────────────────────────────`);
        report.push(`Active Nodes:    ${status.activeNodes.length}/${status.totalNodes}`);
        report.push(`Healthy Nodes:   ${status.healthyNodes.length} (≥80% success rate)`);
        report.push(`Critical Nodes:  ${status.criticalNodes.length} (≥50 jobs completed)`);
        report.push(`Pending Jobs:    ${status.queueStats.pending || 0}`);
        report.push(`Queue Health:    ${status.queueStats.completed || 0} completed, ${status.queueStats.failed || 0} failed`);
        report.push(``);

        // Critical issues
        if (analysis.issues.length > 0) {
            report.push(`🚨 CRITICAL ISSUES (${analysis.issues.length})`);
            report.push(`─────────────────────────────────────────────────────────`);
            analysis.issues.forEach((issue, i) => {
                const icon = issue.severity === 'CRITICAL' ? '🔴' : issue.severity === 'HIGH' ? '🟠' : '🟡';
                report.push(`${i+1}. ${icon} ${issue.severity}: ${issue.message}`);
                report.push(`   Impact: ${issue.impact}`);
                if (issue.nodeId) report.push(`   Node: ${issue.nodeId}`);
                if (issue.capability) report.push(`   Capability: ${issue.capability}`);
                if (issue.pendingCount) report.push(`   Blocked Jobs: ${issue.pendingCount}`);
                report.push(``);
            });
        }

        // Warnings
        if (analysis.warnings.length > 0) {
            report.push(`⚠️  WARNINGS (${analysis.warnings.length})`);
            report.push(`─────────────────────────────────────────────────────────`);
            analysis.warnings.forEach((warning, i) => {
                report.push(`${i+1}. 🟡 ${warning.message}`);
                report.push(`   Impact: ${warning.impact}`);
                report.push(``);
            });
        }

        // Recommendations
        if (analysis.recommendations.length > 0) {
            report.push(`💡 RECOMMENDATIONS (${analysis.recommendations.length})`);
            report.push(`─────────────────────────────────────────────────────────`);
            analysis.recommendations.forEach((rec, i) => {
                const icon = rec.priority === 'IMMEDIATE' ? '🔥' : rec.priority === 'HIGH' ? '⚡' : '📋';
                report.push(`${i+1}. ${icon} ${rec.priority}: ${rec.message}`);
                report.push(`   ${rec.details}`);
                report.push(``);
            });
        }

        // Node details
        if (status.nodes.length > 0) {
            report.push(`🖥️  NODE DETAILS`);
            report.push(`─────────────────────────────────────────────────────────`);
            status.nodes.forEach(node => {
                const statusIcon = node.isActive ? '🟢' : '🔴';
                const quarantineIcon = node.quarantined ? '🔒' : '';
                const performance = node.totalJobs ? ` (${node.successRate || 0}% success, ${node.totalJobs} jobs)` : ' (new node)';
                const offline = node.minutesOffline ? ` - offline ${node.minutesOffline}m` : '';
                
                report.push(`${statusIcon} ${quarantineIcon} ${node.nodeId}${performance}${offline}`);
                if (node.capabilitiesList && node.capabilitiesList.length > 0) {
                    report.push(`   Capabilities: ${node.capabilitiesList.join(', ')}`);
                }
                report.push(``);
            });
        }

        // Capability analysis
        if (status.pendingByCapability.length > 0) {
            report.push(`⚙️  CAPABILITY ANALYSIS`);
            report.push(`─────────────────────────────────────────────────────────`);
            status.pendingByCapability.forEach(cap => {
                const activeCount = status.activeNodes.filter(n => 
                    n.capabilitiesList && n.capabilitiesList.includes(cap.handler)
                ).length;
                const statusIcon = activeCount === 0 ? '🔴' : activeCount === 1 ? '🟡' : '🟢';
                report.push(`${statusIcon} ${cap.handler}: ${cap.pendingCount} pending jobs, ${activeCount} active nodes`);
                if (cap.oldestMinutes) {
                    report.push(`   Oldest job: ${cap.oldestMinutes} minutes ago`);
                }
                report.push(``);
            });
        }

        return report.join('\n');
    }

    async generateAlert() {
        try {
            await this.connectDB();
            const status = await this.getNetworkStatus();
            const analysis = this.analyzeNetworkHealth(status);
            
            // Only generate alerts for critical or high severity issues
            const criticalIssues = analysis.issues.filter(i => 
                i.severity === 'CRITICAL' || i.severity === 'HIGH'
            );

            if (criticalIssues.length > 0) {
                const alertData = {
                    timestamp: Date.now(),
                    severity: criticalIssues[0].severity,
                    issues: criticalIssues,
                    healthScore: analysis.healthScore,
                    activeNodes: status.activeNodes.length,
                    totalNodes: status.totalNodes,
                    pendingJobs: status.queueStats.pending || 0
                };

                // Create alert file
                const alertFile = path.join(process.cwd(), 'data', `node-alert-${Date.now()}.json`);
                fs.writeFileSync(alertFile, JSON.stringify(alertData, null, 2));

                console.log('🚨 NETWORK ALERT GENERATED');
                console.log(`Alert file: ${alertFile}`);
                console.log(`Severity: ${alertData.severity}`);
                console.log(`Issues: ${criticalIssues.length}`);
                console.log(`Health Score: ${alertData.healthScore}/100`);
                
                return alertData;
            }

            return null;
        } finally {
            await this.closeDB();
        }
    }

    async monitor(intervalMs = 30000) {
        console.log(`🔍 Starting advanced node monitoring (${intervalMs}ms intervals)`);
        this.monitoring = true;

        while (this.monitoring) {
            try {
                await this.connectDB();
                const status = await this.getNetworkStatus();
                const analysis = this.analyzeNetworkHealth(status);
                
                // Check for new critical issues
                const criticalIssues = analysis.issues.filter(i => 
                    i.severity === 'CRITICAL' || i.severity === 'HIGH'
                );

                if (criticalIssues.length > 0) {
                    console.log(`\n⚠️  ${new Date().toISOString()}: ${criticalIssues.length} critical issues detected`);
                    console.log(`Health Score: ${analysis.healthScore}/100`);
                    criticalIssues.forEach(issue => {
                        console.log(`${issue.severity}: ${issue.message}`);
                    });
                } else {
                    console.log(`✅ ${new Date().toISOString()}: Network healthy (${analysis.healthScore}/100)`);
                }

                await this.closeDB();
                
                // Wait for next check
                await new Promise(resolve => setTimeout(resolve, intervalMs));
                
            } catch (error) {
                console.error(`Monitoring error: ${error.message}`);
                await this.closeDB();
                
                // Wait before retrying
                await new Promise(resolve => setTimeout(resolve, intervalMs));
            }
        }
    }

    stopMonitoring() {
        this.monitoring = false;
        console.log('🛑 Stopping advanced node monitoring');
    }
}

// CLI interface
async function main() {
    const args = process.argv.slice(2);
    const command = args[0] || 'status';

    const monitor = new AdvancedNodeMonitor();

    try {
        switch (command) {
            case 'status':
                await monitor.connectDB();
                const status = await monitor.getNetworkStatus();
                const analysis = await monitor.analyzeNetworkHealth(status);
                console.log(monitor.formatReport(status, analysis));
                await monitor.closeDB();
                break;

            case 'alert':
                const alertData = await monitor.generateAlert();
                if (!alertData) {
                    console.log('✅ No alerts generated - network is healthy');
                }
                break;

            case 'monitor':
                const interval = parseInt(args[1]) || 30000;
                await monitor.monitor(interval);
                break;

            case 'help':
            default:
                console.log('IC Mesh Advanced Node Monitor');
                console.log('');
                console.log('Usage:');
                console.log('  node advanced-node-monitor.js status    # Generate network health report');
                console.log('  node advanced-node-monitor.js alert     # Generate alert if critical issues exist');
                console.log('  node advanced-node-monitor.js monitor [interval] # Continuous monitoring');
                console.log('  node advanced-node-monitor.js help      # Show this help');
                console.log('');
                console.log('Examples:');
                console.log('  node advanced-node-monitor.js status');
                console.log('  node advanced-node-monitor.js monitor 60000  # Monitor every 60 seconds');
                break;
        }
    } catch (error) {
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
}

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down gracefully...');
    process.exit(0);
});

if (require.main === module) {
    main();
}

module.exports = AdvancedNodeMonitor;