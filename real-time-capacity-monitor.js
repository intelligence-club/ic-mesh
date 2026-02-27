#!/usr/bin/env node

/**
 * Real-Time Capacity Monitor - Continuous Network Health Surveillance
 * 
 * Monitors IC Mesh network capacity in real-time and generates alerts
 * when critical nodes disconnect or capacity drops below thresholds.
 * 
 * Usage:
 *   node real-time-capacity-monitor.js              # Run continuous monitoring
 *   node real-time-capacity-monitor.js --check      # Single health check
 *   node real-time-capacity-monitor.js --alert      # Check and alert on issues
 */

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

class RealTimeCapacityMonitor {
    constructor() {
        this.dbPath = './data/mesh.db';
        this.alertLogPath = './capacity-alerts.json';
        this.monitoringState = './monitoring-state.json';
        this.thresholds = {
            criticalNodeOfflineMinutes: 15,    // Alert if critical nodes offline > 15 min
            minActiveNodes: 1,                 // Alert if < 1 active node
            maxPendingJobs: 20,               // Alert if > 20 pending jobs
            criticalJobCompletionRate: 50     // Alert if completed < 50 jobs per critical node
        };
        this.loadMonitoringState();
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

    loadMonitoringState() {
        try {
            if (fs.existsSync(this.monitoringState)) {
                this.state = JSON.parse(fs.readFileSync(this.monitoringState, 'utf8'));
            } else {
                this.state = {
                    lastCheck: null,
                    criticalNodes: {},
                    lastAlerts: [],
                    nodeStates: {}
                };
            }
        } catch (error) {
            console.warn('⚠️  Could not load monitoring state, starting fresh');
            this.state = { lastCheck: null, criticalNodes: {}, lastAlerts: [], nodeStates: {} };
        }
    }

    saveMonitoringState() {
        fs.writeFileSync(this.monitoringState, JSON.stringify(this.state, null, 2));
    }

    async getCurrentNetworkState() {
        const nodes = await this.getNodeStates();
        const jobs = await this.getJobStats();
        const capabilities = await this.getCapabilityStats();
        
        return {
            timestamp: new Date().toISOString(),
            nodes,
            jobs,
            capabilities,
            summary: {
                activeNodes: nodes.filter(n => n.isActive).length,
                totalNodes: nodes.length,
                pendingJobs: jobs.pending,
                completedJobs: jobs.completed,
                serviceAvailability: nodes.filter(n => n.isActive).length > 0 ? 'available' : 'outage'
            }
        };
    }

    async getNodeStates() {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    nodeId,
                    name,
                    owner,
                    registeredAt,
                    lastSeen,
                    datetime(lastSeen/1000, 'unixepoch') as last_active_time,
                    CAST((julianday('now') - julianday(datetime(lastSeen/1000, 'unixepoch'))) * 1440 AS INTEGER) as minutes_offline,
                    capabilities,
                    jobsCompleted,
                    computeMinutes
                FROM nodes 
                ORDER BY lastSeen DESC
            `;
            
            this.db.all(query, (err, nodes) => {
                if (err) {
                    reject(err);
                } else {
                    const processedNodes = nodes.map(node => ({
                        ...node,
                        isActive: node.minutes_offline < 5,
                        isCritical: this.isNodeCritical(node),
                        status: this.getNodeStatus(node),
                        capabilities: JSON.parse(node.capabilities || '[]')
                    }));
                    resolve(processedNodes);
                }
            });
        });
    }

    async getJobStats() {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    status,
                    COUNT(*) as count,
                    type
                FROM jobs 
                GROUP BY status, type
                ORDER BY count DESC
            `;
            
            this.db.all(query, (err, jobStats) => {
                if (err) {
                    reject(err);
                } else {
                    const summary = { pending: 0, completed: 0, failed: 0, byType: {} };
                    
                    jobStats.forEach(stat => {
                        summary[stat.status] = (summary[stat.status] || 0) + stat.count;
                        if (!summary.byType[stat.type]) summary.byType[stat.type] = {};
                        summary.byType[stat.type][stat.status] = stat.count;
                    });
                    
                    resolve(summary);
                }
            });
        });
    }

    async getCapabilityStats() {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    nodeId,
                    capabilities,
                    CAST((julianday('now') - julianday(datetime(lastSeen/1000, 'unixepoch'))) * 1440 AS INTEGER) as minutes_offline
                FROM nodes
            `;
            
            this.db.all(query, (err, nodes) => {
                if (err) {
                    reject(err);
                } else {
                    const capabilityMap = {};
                    const activeCapabilities = {};
                    
                    nodes.forEach(node => {
                        const caps = JSON.parse(node.capabilities || '[]');
                        const isActive = node.minutes_offline < 5;
                        
                        caps.forEach(cap => {
                            if (!capabilityMap[cap]) {
                                capabilityMap[cap] = { total: 0, active: 0 };
                            }
                            capabilityMap[cap].total++;
                            if (isActive) {
                                capabilityMap[cap].active++;
                                activeCapabilities[cap] = true;
                            }
                        });
                    });
                    
                    resolve({
                        byCapability: capabilityMap,
                        activeCapabilities: Object.keys(activeCapabilities),
                        criticalGaps: Object.entries(capabilityMap).filter(([cap, stats]) => stats.active === 0 && stats.total > 0)
                    });
                }
            });
        });
    }

    isNodeCritical(node) {
        // Define critical node criteria
        const criticalJobsThreshold = 20;
        const criticalCapabilities = ['tesseract', 'ollama', 'stable-diffusion'];
        
        // High job completion count
        if (node.jobsCompleted >= criticalJobsThreshold) return true;
        
        // Has critical capabilities
        const capabilities = JSON.parse(node.capabilities || '[]');
        if (capabilities.some(cap => criticalCapabilities.includes(cap))) return true;
        
        return false;
    }

    getNodeStatus(node) {
        if (node.minutes_offline < 5) return 'active';
        if (node.minutes_offline < 60) return 'recently_disconnected';
        if (node.minutes_offline < 1440) return 'daily_churn';
        return 'offline';
    }

    detectCapacityAlerts(networkState) {
        const alerts = [];
        
        // Critical: Zero active nodes
        if (networkState.summary.activeNodes === 0) {
            alerts.push({
                severity: 'critical',
                type: 'complete_outage',
                message: `COMPLETE SERVICE OUTAGE: 0/${networkState.summary.totalNodes} nodes active`,
                details: {
                    pendingJobs: networkState.summary.pendingJobs,
                    impact: 'All customer jobs blocked'
                }
            });
        }
        
        // Critical: High-value nodes offline
        const criticalNodesOffline = networkState.nodes.filter(n => 
            n.isCritical && n.status !== 'active' && n.minutes_offline <= this.thresholds.criticalNodeOfflineMinutes
        );
        
        criticalNodesOffline.forEach(node => {
            alerts.push({
                severity: 'high',
                type: 'critical_node_offline',
                message: `Critical node "${node.name || node.nodeId}" offline for ${node.minutes_offline} minutes`,
                details: {
                    nodeId: node.nodeId,
                    jobsCompleted: node.jobsCompleted,
                    capabilities: node.capabilities,
                    owner: node.owner,
                    lastSeen: node.last_active_time
                }
            });
        });
        
        // Critical: Capability gaps
        networkState.capabilities.criticalGaps.forEach(([capability, stats]) => {
            alerts.push({
                severity: 'high',
                type: 'capability_gap',
                message: `Critical capability "${capability}" has 0/${stats.total} active nodes`,
                details: {
                    capability,
                    totalNodes: stats.total,
                    activeNodes: stats.active
                }
            });
        });
        
        // High: Job backlog
        if (networkState.summary.pendingJobs > this.thresholds.maxPendingJobs) {
            alerts.push({
                severity: 'medium',
                type: 'job_backlog',
                message: `Job backlog: ${networkState.summary.pendingJobs} pending jobs`,
                details: {
                    pendingJobs: networkState.summary.pendingJobs,
                    activeNodes: networkState.summary.activeNodes,
                    jobsPerNode: networkState.summary.activeNodes > 0 ? 
                        Math.round(networkState.summary.pendingJobs / networkState.summary.activeNodes) : 'infinite'
                }
            });
        }
        
        return alerts;
    }

    detectNodeStateChanges(networkState) {
        const changes = [];
        
        networkState.nodes.forEach(node => {
            const previousState = this.state.nodeStates[node.nodeId];
            
            if (!previousState) {
                // New node
                changes.push({
                    type: 'node_registered',
                    nodeId: node.nodeId,
                    name: node.name,
                    capabilities: node.capabilities
                });
            } else {
                // Status change
                if (previousState.status !== node.status) {
                    changes.push({
                        type: 'status_change',
                        nodeId: node.nodeId,
                        name: node.name,
                        from: previousState.status,
                        to: node.status,
                        minutesOffline: node.minutes_offline
                    });
                }
                
                // Job completion progress (only track significant increases)
                if (node.jobsCompleted > (previousState.jobsCompleted || 0) + 5) {
                    changes.push({
                        type: 'productivity_milestone',
                        nodeId: node.nodeId,
                        name: node.name,
                        newJobCount: node.jobsCompleted,
                        previousJobCount: previousState.jobsCompleted || 0
                    });
                }
            }
            
            // Update state
            this.state.nodeStates[node.nodeId] = {
                status: node.status,
                lastSeen: node.lastSeen,
                jobsCompleted: node.jobsCompleted,
                capabilities: node.capabilities
            };
        });
        
        return changes;
    }

    async generateCapacityReport(networkState, alerts, changes) {
        console.log('🔍 REAL-TIME CAPACITY MONITORING REPORT');
        console.log('════════════════════════════════════════');
        console.log(`Timestamp: ${networkState.timestamp}\n`);
        
        // Network summary
        console.log('🌐 NETWORK STATUS');
        console.log('────────────────────────────────────────');
        const status = networkState.summary.serviceAvailability === 'available' ? '🟢' : '🔴';
        console.log(`${status} Service: ${networkState.summary.serviceAvailability.toUpperCase()}`);
        console.log(`📊 Nodes: ${networkState.summary.activeNodes}/${networkState.summary.totalNodes} active`);
        console.log(`📋 Jobs: ${networkState.summary.pendingJobs} pending, ${networkState.summary.completedJobs} completed`);
        
        // Active capabilities
        if (networkState.capabilities.activeCapabilities.length > 0) {
            console.log(`🔧 Active capabilities: ${networkState.capabilities.activeCapabilities.join(', ')}`);
        } else {
            console.log(`🔧 Active capabilities: NONE (complete capability loss)`);
        }
        
        // Alerts
        if (alerts.length > 0) {
            console.log('\n🚨 CAPACITY ALERTS');
            console.log('────────────────────────────────────────');
            alerts.forEach((alert, i) => {
                const icon = alert.severity === 'critical' ? '🔴' : alert.severity === 'high' ? '🟡' : '🟠';
                console.log(`${i + 1}. ${icon} [${alert.severity.toUpperCase()}] ${alert.message}`);
                if (alert.details) {
                    Object.entries(alert.details).forEach(([key, value]) => {
                        console.log(`   ${key}: ${JSON.stringify(value)}`);
                    });
                }
            });
        }
        
        // Node changes
        if (changes.length > 0) {
            console.log('\n🔄 NODE STATE CHANGES');
            console.log('────────────────────────────────────────');
            changes.forEach((change, i) => {
                switch (change.type) {
                    case 'node_registered':
                        console.log(`${i + 1}. ✅ New node: ${change.name || change.nodeId}`);
                        console.log(`   Capabilities: ${change.capabilities.join(', ')}`);
                        break;
                    case 'status_change':
                        const icon = change.to === 'active' ? '🟢' : '🔴';
                        console.log(`${i + 1}. ${icon} ${change.name}: ${change.from} → ${change.to}`);
                        if (change.minutesOffline) {
                            console.log(`   Offline for: ${change.minutesOffline} minutes`);
                        }
                        break;
                    case 'productivity_milestone':
                        console.log(`${i + 1}. 🎯 ${change.name}: reached ${change.newJobCount} jobs (+${change.newJobCount - change.previousJobCount})`);
                        break;
                }
            });
        }
        
        // Critical nodes status
        const criticalNodes = networkState.nodes.filter(n => n.isCritical);
        if (criticalNodes.length > 0) {
            console.log('\n⭐ CRITICAL NODES STATUS');
            console.log('────────────────────────────────────────');
            criticalNodes.forEach(node => {
                const statusIcon = node.isActive ? '🟢' : '🔴';
                console.log(`${statusIcon} ${node.name || node.nodeId} (${node.owner})`);
                console.log(`   Jobs completed: ${node.jobsCompleted}`);
                console.log(`   Status: ${node.status} (${node.minutes_offline}m offline)`);
                console.log(`   Capabilities: ${node.capabilities.join(', ')}`);
            });
        }
        
        return { networkState, alerts, changes };
    }

    async runCheck(options = {}) {
        const startTime = Date.now();
        
        try {
            await this.init();
            
            const networkState = await this.getCurrentNetworkState();
            const alerts = this.detectCapacityAlerts(networkState);
            const changes = this.detectNodeStateChanges(networkState);
            
            // Update monitoring state
            this.state.lastCheck = new Date().toISOString();
            this.state.lastAlerts = alerts;
            this.saveMonitoringState();
            
            if (options.quiet && alerts.length === 0 && changes.length === 0) {
                console.log(`✅ Capacity check passed (${Date.now() - startTime}ms)`);
                return { status: 'healthy', networkState, alerts, changes };
            }
            
            await this.generateCapacityReport(networkState, alerts, changes);
            
            // Save alert log
            if (alerts.length > 0) {
                const alertLog = {
                    timestamp: new Date().toISOString(),
                    alerts,
                    networkState: networkState.summary
                };
                this.saveAlert(alertLog);
            }
            
            return { 
                status: alerts.length > 0 ? 'alerts' : 'healthy', 
                networkState, 
                alerts, 
                changes 
            };
            
        } catch (error) {
            console.error('❌ Error during capacity check:', error.message);
            return { status: 'error', error: error.message };
        } finally {
            this.close();
        }
    }

    saveAlert(alertLog) {
        try {
            let alerts = [];
            if (fs.existsSync(this.alertLogPath)) {
                alerts = JSON.parse(fs.readFileSync(this.alertLogPath, 'utf8'));
            }
            
            alerts.push(alertLog);
            
            // Keep only last 100 alerts
            if (alerts.length > 100) {
                alerts = alerts.slice(-100);
            }
            
            fs.writeFileSync(this.alertLogPath, JSON.stringify(alerts, null, 2));
        } catch (error) {
            console.warn('⚠️  Could not save alert log:', error.message);
        }
    }

    close() {
        if (this.db) {
            this.db.close();
        }
    }
}

// CLI execution
async function main() {
    const args = process.argv.slice(2);
    const options = {
        check: args.includes('--check'),
        alert: args.includes('--alert'),
        quiet: args.includes('--quiet'),
        continuous: args.includes('--continuous')
    };

    const monitor = new RealTimeCapacityMonitor();
    
    try {
        if (options.continuous) {
            console.log('🔄 Starting continuous capacity monitoring...');
            console.log('Press Ctrl+C to stop\n');
            
            setInterval(async () => {
                await monitor.runCheck({ quiet: true });
            }, 60000); // Check every minute
            
            // Initial check
            await monitor.runCheck();
            
        } else {
            const result = await monitor.runCheck(options);
            process.exit(result.status === 'error' ? 1 : 0);
        }
    } catch (error) {
        console.error('❌ Error running capacity monitor:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = RealTimeCapacityMonitor;