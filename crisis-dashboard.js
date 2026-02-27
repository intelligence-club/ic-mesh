#!/usr/bin/env node

/**
 * CRISIS DASHBOARD - Real-Time Service Outage Monitoring
 * 
 * Enhanced monitoring specifically designed for service outages.
 * Provides minute-by-minute updates and tracks recovery progress.
 * 
 * Features:
 * - Real-time service status updates
 * - Node reconnection detection
 * - Customer impact tracking
 * - Recovery progress monitoring
 * - Automated alerts for status changes
 * 
 * Usage:
 *   node crisis-dashboard.js          # Continuous monitoring during crisis
 *   node crisis-dashboard.js --once   # Single status check
 */

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

class CrisisDashboard {
    constructor() {
        this.dbPath = './data/mesh.db';
        this.crisisLogPath = './crisis-log.json';
        this.startTime = Date.now();
        this.lastStatus = null;
        
        // Initialize crisis log
        this.initializeCrisisLog();
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

    initializeCrisisLog() {
        if (!fs.existsSync(this.crisisLogPath)) {
            const initialLog = {
                crisisStart: new Date().toISOString(),
                events: [],
                lastUpdate: null,
                recoveryProgress: {
                    nodesRecovered: 0,
                    jobsProcessed: 0,
                    serviceRestored: false
                }
            };
            fs.writeFileSync(this.crisisLogPath, JSON.stringify(initialLog, null, 2));
        }
    }

    logCrisisEvent(event) {
        const crisisLog = JSON.parse(fs.readFileSync(this.crisisLogPath, 'utf8'));
        crisisLog.events.push({
            timestamp: new Date().toISOString(),
            ...event
        });
        crisisLog.lastUpdate = new Date().toISOString();
        fs.writeFileSync(this.crisisLogPath, JSON.stringify(crisisLog, null, 2));
    }

    async getServiceStatus() {
        const [nodes, jobs] = await Promise.all([
            this.getNodesStatus(),
            this.getJobsStatus()
        ]);

        const activeNodes = nodes.filter(n => n.status === 'active').length;
        const totalNodes = nodes.length;
        const pendingJobs = jobs.pending;
        const completedJobs = jobs.completed;

        const serviceStatus = activeNodes > 0 ? 'OPERATIONAL' : 'OUTAGE';
        
        return {
            serviceStatus,
            activeNodes,
            totalNodes,
            pendingJobs,
            completedJobs,
            nodes,
            timestamp: new Date().toISOString()
        };
    }

    async getNodesStatus() {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    nodeId,
                    owner,
                    capabilities,
                    lastSeen,
                    (SELECT COUNT(*) FROM jobs WHERE claimedBy = nodeId AND status = 'completed') as jobsCompleted,
                    (julianday('now') - julianday(lastSeen/1000, 'unixepoch')) * 24 * 60 as minutesOffline
                FROM nodes 
                ORDER BY jobsCompleted DESC
            `;

            this.db.all(query, [], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    const nodes = rows.map(row => ({
                        nodeId: row.nodeId.substring(0, 8),
                        owner: row.owner || 'unknown',
                        capabilities: JSON.parse(row.capabilities || '[]'),
                        jobsCompleted: row.jobsCompleted || 0,
                        minutesOffline: Math.round(row.minutesOffline || 0),
                        status: row.minutesOffline < 5 ? 'active' : 'offline'
                    }));
                    resolve(nodes);
                }
            });
        });
    }

    async getJobsStatus() {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    status,
                    COUNT(*) as count,
                    SUM(creditAmount) as totalCredits
                FROM jobs 
                GROUP BY status
            `;

            this.db.all(query, [], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    const stats = {
                        pending: 0,
                        completed: 0,
                        failed: 0,
                        pendingValue: 0,
                        completedValue: 0
                    };

                    rows.forEach(row => {
                        if (row.status === 'pending') {
                            stats.pending = row.count;
                            stats.pendingValue = (row.totalCredits || 0) / 100; // Convert to dollars
                        } else if (row.status === 'completed') {
                            stats.completed = row.count;
                            stats.completedValue = (row.totalCredits || 0) / 100;
                        } else if (row.status === 'failed') {
                            stats.failed = row.count;
                        }
                    });

                    resolve(stats);
                }
            });
        });
    }

    async detectStatusChanges(currentStatus) {
        if (!this.lastStatus) {
            this.lastStatus = currentStatus;
            return [];
        }

        const changes = [];

        // Check for node status changes
        const lastNodeIds = new Set(this.lastStatus.nodes.map(n => n.nodeId));
        const currentNodeIds = new Set(currentStatus.nodes.map(n => n.nodeId));

        // Node reconnections
        currentStatus.nodes.forEach(node => {
            if (node.status === 'active') {
                const lastNode = this.lastStatus.nodes.find(n => n.nodeId === node.nodeId);
                if (!lastNode || lastNode.status === 'offline') {
                    changes.push({
                        type: 'node_reconnected',
                        nodeId: node.nodeId,
                        owner: node.owner,
                        capabilities: node.capabilities,
                        message: `🟢 Node ${node.nodeId} (${node.owner}) RECONNECTED`
                    });
                }
            }
        });

        // Node disconnections
        this.lastStatus.nodes.forEach(node => {
            if (node.status === 'active') {
                const currentNode = currentStatus.nodes.find(n => n.nodeId === node.nodeId);
                if (!currentNode || currentNode.status === 'offline') {
                    changes.push({
                        type: 'node_disconnected',
                        nodeId: node.nodeId,
                        owner: node.owner,
                        capabilities: node.capabilities,
                        message: `🔴 Node ${node.nodeId} (${node.owner}) DISCONNECTED`
                    });
                }
            }
        });

        // Service status changes
        if (this.lastStatus.serviceStatus !== currentStatus.serviceStatus) {
            if (currentStatus.serviceStatus === 'OPERATIONAL') {
                changes.push({
                    type: 'service_restored',
                    message: `🎉 SERVICE RESTORED - ${currentStatus.activeNodes} nodes active`
                });
            } else if (currentStatus.serviceStatus === 'OUTAGE') {
                changes.push({
                    type: 'service_outage',
                    message: `🚨 COMPLETE SERVICE OUTAGE - All nodes offline`
                });
            }
        }

        // Log all changes
        changes.forEach(change => this.logCrisisEvent(change));

        this.lastStatus = currentStatus;
        return changes;
    }

    formatCrisisReport(status, changes) {
        const outageMinutes = Math.round((Date.now() - this.startTime) / 60000);
        
        console.log(`🚨 CRISIS DASHBOARD - Service Outage Monitoring`);
        console.log(`════════════════════════════════════════════════`);
        console.log(`Time: ${new Date().toISOString()}`);
        console.log(`Monitoring Duration: ${outageMinutes} minutes`);
        console.log();

        // Service Status
        const statusIcon = status.serviceStatus === 'OUTAGE' ? '🔴' : '🟢';
        console.log(`🌐 SERVICE STATUS: ${statusIcon} ${status.serviceStatus}`);
        console.log(`────────────────────────────────────────────────`);
        console.log(`Active Nodes: ${status.activeNodes}/${status.totalNodes}`);
        console.log(`Pending Jobs: ${status.pendingJobs} ($${status.pendingJobs * 0.25}-$${status.pendingJobs * 0.50} revenue blocked)`);
        console.log(`Completed Jobs: ${status.completedJobs}`);
        console.log();

        // Recent Changes
        if (changes.length > 0) {
            console.log(`🔄 RECENT CHANGES (Last Check)`);
            console.log(`────────────────────────────────────────────────`);
            changes.forEach(change => {
                console.log(`   ${change.message}`);
            });
            console.log();
        }

        // Critical Nodes
        if (status.nodes.length > 0) {
            console.log(`⭐ NODE STATUS`);
            console.log(`────────────────────────────────────────────────`);
            
            // Sort by jobs completed (most valuable nodes first)
            const sortedNodes = [...status.nodes].sort((a, b) => b.jobsCompleted - a.jobsCompleted);
            
            sortedNodes.forEach(node => {
                const statusIcon = node.status === 'active' ? '🟢' : '🔴';
                const offlineTime = node.status === 'offline' ? ` (${node.minutesOffline}m offline)` : '';
                console.log(`   ${statusIcon} ${node.nodeId} (${node.owner}): ${node.jobsCompleted} jobs${offlineTime}`);
                console.log(`      Capabilities: ${node.capabilities.join(', ')}`);
            });
            console.log();
        }

        // Recovery Instructions
        if (status.serviceStatus === 'OUTAGE') {
            console.log(`🔧 RECOVERY ACTIONS NEEDED`);
            console.log(`────────────────────────────────────────────────`);
            
            const criticalNodes = status.nodes
                .filter(n => n.jobsCompleted > 10 && n.status === 'offline')
                .sort((a, b) => b.jobsCompleted - a.jobsCompleted);
            
            criticalNodes.forEach((node, index) => {
                console.log(`   ${index + 1}. Contact ${node.owner} to restore ${node.nodeId}`);
                console.log(`      Impact: ${node.jobsCompleted} jobs completed, ${node.capabilities.join(', ')} capabilities`);
                if (node.owner === 'drake') {
                    console.log(`      Command: claw skill mesh-transcribe`);
                }
            });
            
            if (criticalNodes.length === 0) {
                console.log(`   No known contact methods for offline nodes.`);
                console.log(`   Monitor for automatic reconnection.`);
            }
            console.log();
        }

        console.log(`Next check in 30 seconds...`);
        console.log();
    }

    async runContinuousMonitoring() {
        console.log(`🚨 Starting Crisis Dashboard - Service Outage Monitor`);
        console.log(`Press Ctrl+C to stop monitoring\n`);

        while (true) {
            try {
                const status = await this.getServiceStatus();
                const changes = await this.detectStatusChanges(status);
                
                this.formatCrisisReport(status, changes);

                // If service is restored, we can reduce monitoring frequency
                if (status.serviceStatus === 'OPERATIONAL') {
                    console.log(`✅ Service restored! Continuing monitoring at reduced frequency...`);
                    await new Promise(resolve => setTimeout(resolve, 60000)); // 1 minute
                } else {
                    await new Promise(resolve => setTimeout(resolve, 30000)); // 30 seconds during outage
                }
                
            } catch (error) {
                console.error(`❌ Monitoring error:`, error.message);
                await new Promise(resolve => setTimeout(resolve, 10000)); // 10 seconds on error
            }
        }
    }

    async runOnceCheck() {
        const status = await this.getServiceStatus();
        const changes = await this.detectStatusChanges(status);
        this.formatCrisisReport(status, changes);
        return status;
    }

    async close() {
        if (this.db) {
            this.db.close();
        }
    }
}

async function main() {
    const dashboard = new CrisisDashboard();
    
    try {
        await dashboard.init();
        
        const args = process.argv.slice(2);
        
        if (args.includes('--once')) {
            await dashboard.runOnceCheck();
        } else {
            // Set up graceful shutdown
            process.on('SIGINT', async () => {
                console.log('\n🛑 Crisis monitoring stopped');
                await dashboard.close();
                process.exit(0);
            });
            
            await dashboard.runContinuousMonitoring();
        }
        
    } catch (error) {
        console.error('❌ Crisis Dashboard Error:', error);
        process.exit(1);
    } finally {
        await dashboard.close();
    }
}

if (require.main === module) {
    main();
}

module.exports = CrisisDashboard;