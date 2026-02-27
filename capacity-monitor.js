#!/usr/bin/env node
/**
 * IC Mesh Capacity Monitor
 * Real-time capacity analysis and bottleneck detection
 * Usage: node capacity-monitor.js [--watch] [--alert]
 */

const Database = require('better-sqlite3');
const path = require('path');

class CapacityMonitor {
    constructor(dbPath = './data/mesh.db') {
        this.db = new Database(dbPath);
        this.alertThresholds = {
            pendingJobsHigh: 20,
            capacityUtilization: 80, // percentage
            nodeOfflineMinutes: 15,
            queueDepthCritical: 50
        };
    }

    analyze() {
        const analysis = {
            timestamp: new Date().toISOString(),
            jobs: this.analyzeJobs(),
            nodes: this.analyzeNodes(),
            capacity: this.analyzeCapacity(),
            bottlenecks: [],
            recommendations: []
        };

        // Detect bottlenecks
        this.detectBottlenecks(analysis);
        
        return analysis;
    }

    analyzeJobs() {
        const jobs = {
            pending: this.db.prepare('SELECT COUNT(*) as count FROM jobs WHERE status = ?').get('pending').count,
            claimed: this.db.prepare('SELECT COUNT(*) as count FROM jobs WHERE status = ?').get('claimed').count,
            completed: this.db.prepare('SELECT COUNT(*) as count FROM jobs WHERE status = ?').get('completed').count,
            failed: this.db.prepare('SELECT COUNT(*) as count FROM jobs WHERE status = ?').get('failed').count
        };

        // Analyze pending jobs by type and capability requirements
        const pendingByType = this.db.prepare(`
            SELECT type, COUNT(*) as count 
            FROM jobs WHERE status = 'pending' 
            GROUP BY type
        `).all();

        const pendingByCapability = this.db.prepare(`
            SELECT 
                json_extract(requirements, '$.capability') as capability,
                COUNT(*) as count
            FROM jobs 
            WHERE status = 'pending' AND json_extract(requirements, '$.capability') IS NOT NULL
            GROUP BY capability
        `).all();

        jobs.breakdown = {
            byType: pendingByType,
            byCapability: pendingByCapability
        };

        // Analyze queue age
        const oldestPending = this.db.prepare(`
            SELECT MIN(createdAt) as oldest FROM jobs WHERE status = 'pending'
        `).get();
        
        if (oldestPending.oldest) {
            jobs.queueAge = Math.round((Date.now() - oldestPending.oldest) / 60000); // minutes
        }

        return jobs;
    }

    analyzeNodes() {
        const nodes = {
            total: 0,
            online: 0,
            offline: 0,
            quarantined: 0,
            details: []
        };

        const nodeData = this.db.prepare(`
            SELECT nodeId, name, owner, capabilities, flags, lastSeen, jobsCompleted
            FROM nodes ORDER BY lastSeen DESC
        `).all();

        nodeData.forEach(node => {
            const minutesSinceLastSeen = Math.round((Date.now() - node.lastSeen) / 60000);
            const flags = JSON.parse(node.flags || '{}');
            const capabilities = JSON.parse(node.capabilities || '[]');
            
            let status;
            if (flags.quarantined) {
                status = 'quarantined';
                nodes.quarantined++;
            } else if (minutesSinceLastSeen > this.alertThresholds.nodeOfflineMinutes) {
                status = 'offline';
                nodes.offline++;
            } else {
                status = 'online';
                nodes.online++;
            }
            
            nodes.total++;
            nodes.details.push({
                nodeId: node.nodeId.substring(0, 8),
                name: node.name,
                owner: node.owner,
                status,
                capabilities,
                lastSeenMinutes: minutesSinceLastSeen,
                jobsCompleted: node.jobsCompleted
            });
        });

        return nodes;
    }

    analyzeCapacity() {
        // Calculate capacity for each job type
        const capacity = {};
        
        const pendingByCapability = this.db.prepare(`
            SELECT 
                json_extract(requirements, '$.capability') as capability,
                COUNT(*) as demand
            FROM jobs 
            WHERE status = 'pending' AND json_extract(requirements, '$.capability') IS NOT NULL
            GROUP BY capability
        `).all();

        const onlineNodes = this.db.prepare(`
            SELECT nodeId, name, capabilities, flags, lastSeen
            FROM nodes 
        `).all().filter(node => {
            const flags = JSON.parse(node.flags || '{}');
            const minutesSinceLastSeen = Math.round((Date.now() - node.lastSeen) / 60000);
            return !flags.quarantined && minutesSinceLastSeen <= this.alertThresholds.nodeOfflineMinutes;
        });

        pendingByCapability.forEach(demand => {
            const capability = demand.capability;
            const nodesWithCapability = onlineNodes.filter(node => {
                const capabilities = JSON.parse(node.capabilities || '[]');
                return capabilities.includes(capability);
            });

            capacity[capability] = {
                demand: demand.demand,
                supply: nodesWithCapability.length,
                nodes: nodesWithCapability.map(n => ({
                    nodeId: n.nodeId.substring(0, 8),
                    name: n.name
                })),
                utilization: nodesWithCapability.length > 0 ? (demand.demand / nodesWithCapability.length) : Infinity
            };
        });

        return capacity;
    }

    detectBottlenecks(analysis) {
        const { jobs, nodes, capacity } = analysis;

        // High pending jobs
        if (jobs.pending > this.alertThresholds.pendingJobsHigh) {
            analysis.bottlenecks.push({
                type: 'high_pending_jobs',
                severity: 'warning',
                message: `${jobs.pending} pending jobs (threshold: ${this.alertThresholds.pendingJobsHigh})`,
                metric: jobs.pending
            });
        }

        // Capacity bottlenecks
        Object.entries(capacity).forEach(([capability, cap]) => {
            if (cap.supply === 0) {
                analysis.bottlenecks.push({
                    type: 'zero_capacity',
                    severity: 'critical',
                    message: `No available nodes for '${capability}' capability (${cap.demand} jobs pending)`,
                    capability,
                    demand: cap.demand
                });
                analysis.recommendations.push(`Add nodes with '${capability}' capability or restore offline nodes`);
            } else if (cap.utilization > this.alertThresholds.capacityUtilization) {
                analysis.bottlenecks.push({
                    type: 'capacity_overload',
                    severity: 'warning',
                    message: `High utilization for '${capability}': ${cap.demand} jobs / ${cap.supply} nodes (${Math.round(cap.utilization)}x capacity)`,
                    capability,
                    utilization: cap.utilization
                });
                analysis.recommendations.push(`Scale up '${capability}' capacity or optimize job processing`);
            }
        });

        // Offline nodes with useful capabilities
        nodes.details.filter(node => node.status === 'offline').forEach(node => {
            analysis.bottlenecks.push({
                type: 'node_offline',
                severity: 'warning',
                message: `Node '${node.name}' offline for ${node.lastSeenMinutes}m (capabilities: ${node.capabilities.join(', ')})`,
                node: node.nodeId,
                offlineMinutes: node.lastSeenMinutes
            });
            analysis.recommendations.push(`Investigate and restore '${node.name}' node`);
        });

        // Queue age
        if (jobs.queueAge > 60) { // older than 1 hour
            analysis.bottlenecks.push({
                type: 'stale_queue',
                severity: 'warning',
                message: `Oldest pending job is ${jobs.queueAge} minutes old`,
                ageMinutes: jobs.queueAge
            });
        }
    }

    formatReport(analysis) {
        let report = '';
        report += `🔍 IC Mesh Capacity Analysis - ${analysis.timestamp}\n`;
        report += `${'='.repeat(60)}\n\n`;

        // Jobs summary
        report += `📊 JOB QUEUE STATUS:\n`;
        report += `  Pending: ${analysis.jobs.pending} | Claimed: ${analysis.jobs.claimed} | Completed: ${analysis.jobs.completed} | Failed: ${analysis.jobs.failed}\n`;
        if (analysis.jobs.queueAge) {
            report += `  Oldest pending job: ${analysis.jobs.queueAge} minutes\n`;
        }
        
        if (analysis.jobs.breakdown.byCapability.length > 0) {
            report += `\n  Pending by capability:\n`;
            analysis.jobs.breakdown.byCapability.forEach(cap => {
                report += `    ${cap.capability}: ${cap.count} jobs\n`;
            });
        }

        // Nodes summary  
        report += `\n🖥️  NODE STATUS:\n`;
        report += `  Total: ${analysis.nodes.total} | Online: ${analysis.nodes.online} | Offline: ${analysis.nodes.offline} | Quarantined: ${analysis.nodes.quarantined}\n\n`;
        
        analysis.nodes.details.forEach(node => {
            const statusIcon = node.status === 'online' ? '🟢' : node.status === 'quarantined' ? '🔴' : '🟡';
            report += `  ${statusIcon} ${node.name} (${node.nodeId}): ${node.status.toUpperCase()}\n`;
            report += `     Capabilities: ${node.capabilities.join(', ')}\n`;
            report += `     Last seen: ${node.lastSeenMinutes}m ago | Jobs completed: ${node.jobsCompleted}\n`;
        });

        // Capacity analysis
        if (Object.keys(analysis.capacity).length > 0) {
            report += `\n⚖️  CAPACITY ANALYSIS:\n`;
            Object.entries(analysis.capacity).forEach(([capability, cap]) => {
                const utilizationText = cap.supply > 0 ? `${Math.round(cap.utilization * 10) / 10}x` : 'NO CAPACITY';
                const statusIcon = cap.supply === 0 ? '🔴' : cap.utilization > 5 ? '🟡' : '🟢';
                report += `  ${statusIcon} ${capability}: ${cap.demand} jobs / ${cap.supply} nodes = ${utilizationText}\n`;
                if (cap.nodes.length > 0) {
                    report += `     Available nodes: ${cap.nodes.map(n => n.name).join(', ')}\n`;
                }
            });
        }

        // Bottlenecks
        if (analysis.bottlenecks.length > 0) {
            report += `\n🚨 BOTTLENECKS DETECTED:\n`;
            analysis.bottlenecks.forEach(bottleneck => {
                const severityIcon = bottleneck.severity === 'critical' ? '🔴' : '🟡';
                report += `  ${severityIcon} ${bottleneck.message}\n`;
            });
        }

        // Recommendations
        if (analysis.recommendations.length > 0) {
            report += `\n💡 RECOMMENDATIONS:\n`;
            [...new Set(analysis.recommendations)].forEach(rec => {
                report += `  • ${rec}\n`;
            });
        }

        return report;
    }

    watch(intervalMs = 30000) {
        console.log(`🔄 Starting capacity monitor (checking every ${intervalMs/1000}s)...`);
        console.log('Press Ctrl+C to stop.\n');

        const check = () => {
            try {
                const analysis = this.analyze();
                console.clear();
                console.log(this.formatReport(analysis));
                
                // Alert on critical bottlenecks
                const criticalBottlenecks = analysis.bottlenecks.filter(b => b.severity === 'critical');
                if (criticalBottlenecks.length > 0) {
                    console.log(`\n🚨 CRITICAL ALERTS: ${criticalBottlenecks.length} issues need immediate attention!`);
                }
            } catch (error) {
                console.error('Error during capacity analysis:', error.message);
            }
        };

        check(); // Initial check
        const interval = setInterval(check, intervalMs);
        
        process.on('SIGINT', () => {
            clearInterval(interval);
            this.db.close();
            console.log('\n👋 Capacity monitor stopped.');
            process.exit(0);
        });
    }

    close() {
        this.db.close();
    }
}

// CLI interface
if (require.main === module) {
    const args = process.argv.slice(2);
    const watchMode = args.includes('--watch');
    const dbPath = args.find(arg => arg.startsWith('--db='))?.split('=')[1];
    
    const monitor = new CapacityMonitor(dbPath);
    
    if (watchMode) {
        monitor.watch(30000); // 30 second intervals
    } else {
        try {
            const analysis = monitor.analyze();
            console.log(monitor.formatReport(analysis));
            
            // Exit with error code if critical bottlenecks exist
            const criticalBottlenecks = analysis.bottlenecks.filter(b => b.severity === 'critical');
            if (criticalBottlenecks.length > 0) {
                process.exit(1);
            }
        } catch (error) {
            console.error('Error:', error.message);
            process.exit(1);
        } finally {
            monitor.close();
        }
    }
}

module.exports = CapacityMonitor;