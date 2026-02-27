#!/usr/bin/env node
/**
 * Node Health Monitor - Real-time health tracking for IC Mesh operators
 * 
 * Monitors active nodes and alerts on disconnections/performance issues
 * Can run continuously or as one-shot health check
 * 
 * Usage:
 *   node node-health-monitor.js              -- one-shot health check
 *   node node-health-monitor.js --continuous -- run continuously 
 *   node node-health-monitor.js --alert      -- only show problems
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class NodeHealthMonitor {
    constructor(options = {}) {
        this.dbPath = path.join(__dirname, 'data', 'mesh.db');
        this.continuous = options.continuous || false;
        this.alertsOnly = options.alertsOnly || false;
        this.interval = options.interval || 30000; // 30 seconds
        this.db = null;
    }

    async connect() {
        return new Promise((resolve, reject) => {
            this.db = new sqlite3.Database(this.dbPath, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    async getActiveNodes() {
        return new Promise((resolve, reject) => {
            const cutoff = Date.now() - (5 * 60 * 1000); // 5 minutes ago
            
            const query = `
                SELECT 
                    nodeId,
                    owner,
                    capabilities,
                    lastSeen,
                    registeredAt,
                    (julianday('now') - julianday(lastSeen/1000, 'unixepoch')) * 24 * 60 as minutesOffline,
                    (SELECT COUNT(*) FROM jobs WHERE nodeId = nodes.nodeId AND status = 'completed') as completedJobs,
                    (SELECT COUNT(*) FROM jobs WHERE nodeId = nodes.nodeId AND status = 'claimed' AND claimedAt < ?) as stuckJobs
                FROM nodes 
                ORDER BY lastSeen DESC
            `;
            
            this.db.all(query, [cutoff], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    async getJobQueue() {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    capability,
                    COUNT(*) as pendingJobs,
                    MIN(createdAt) as oldestJob,
                    (julianday('now') - julianday(MIN(createdAt)/1000, 'unixepoch')) * 24 * 60 as oldestJobMinutes
                FROM jobs 
                WHERE status = 'pending'
                GROUP BY capability
                ORDER BY COUNT(*) DESC
            `;
            
            this.db.all(query, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    formatDuration(minutes) {
        if (minutes < 1) return `${Math.round(minutes * 60)}s`;
        if (minutes < 60) return `${Math.round(minutes)}m`;
        if (minutes < 1440) return `${(minutes / 60).toFixed(1)}h`;
        return `${(minutes / 1440).toFixed(1)}d`;
    }

    assessNodeHealth(node) {
        const issues = [];
        const warnings = [];
        
        // Check if node is offline
        if (node.minutesOffline > 5) {
            if (node.minutesOffline > 60) {
                issues.push(`Offline for ${this.formatDuration(node.minutesOffline)}`);
            } else {
                warnings.push(`Offline for ${this.formatDuration(node.minutesOffline)}`);
            }
        }
        
        // Check for stuck jobs
        if (node.stuckJobs > 0) {
            issues.push(`${node.stuckJobs} stuck jobs`);
        }
        
        // Check productivity
        const uptimeHours = (Date.now() - node.registeredAt) / (1000 * 60 * 60);
        const jobsPerHour = node.completedJobs / Math.max(uptimeHours, 0.1);
        
        if (node.completedJobs > 0 && jobsPerHour < 0.5) {
            warnings.push(`Low productivity: ${jobsPerHour.toFixed(2)} jobs/hour`);
        }
        
        return { issues, warnings, jobsPerHour };
    }

    async performHealthCheck() {
        const timestamp = new Date().toISOString();
        const nodes = await this.getActiveNodes();
        const queue = await this.getJobQueue();
        
        if (!this.alertsOnly) {
            console.log(`\n🏥 NODE HEALTH CHECK - ${timestamp}`);
            console.log('═'.repeat(60));
        }
        
        // Analyze nodes
        let activeNodes = 0;
        let problematicNodes = 0;
        const alerts = [];
        
        for (const node of nodes) {
            const health = this.assessNodeHealth(node);
            const isActive = node.minutesOffline <= 5;
            
            if (isActive) activeNodes++;
            
            const hasProblems = health.issues.length > 0;
            if (hasProblems) problematicNodes++;
            
            // Only show if not alerts-only, or if there are problems
            if (!this.alertsOnly || hasProblems || health.warnings.length > 0) {
                const status = isActive ? '🟢' : node.minutesOffline > 60 ? '🔴' : '🟡';
                const owner = node.owner ? `(${node.owner})` : '';
                const capabilities = node.capabilities ? JSON.parse(node.capabilities).slice(0, 3).join(',') : 'none';
                
                console.log(`${status} ${node.nodeId} ${owner}`);
                console.log(`   Capabilities: ${capabilities}`);
                console.log(`   Jobs: ${node.completedJobs} completed, rate: ${health.jobsPerHour.toFixed(2)}/hour`);
                
                if (health.issues.length > 0) {
                    console.log(`   🚨 Issues: ${health.issues.join(', ')}`);
                    alerts.push(`${node.nodeId}: ${health.issues.join(', ')}`);
                }
                
                if (health.warnings.length > 0) {
                    console.log(`   ⚠️  Warnings: ${health.warnings.join(', ')}`);
                }
                
                console.log();
            }
        }
        
        // Network summary
        if (!this.alertsOnly || alerts.length > 0) {
            console.log(`📊 NETWORK STATUS`);
            console.log(`   Active nodes: ${activeNodes}/${nodes.length}`);
            console.log(`   Problematic: ${problematicNodes}`);
            
            const totalPending = queue.reduce((sum, q) => sum + q.pendingJobs, 0);
            console.log(`   Pending jobs: ${totalPending}`);
            
            if (queue.length > 0 && (!this.alertsOnly || totalPending > 10)) {
                console.log(`   Queue breakdown:`);
                queue.slice(0, 5).forEach(q => {
                    const age = this.formatDuration(q.oldestJobMinutes);
                    console.log(`     ${q.capability}: ${q.pendingJobs} jobs (oldest: ${age})`);
                });
            }
        }
        
        // Critical alerts
        if (alerts.length > 0) {
            console.log(`\n🚨 CRITICAL ALERTS:`);
            alerts.forEach(alert => console.log(`   • ${alert}`));
        }
        
        return {
            activeNodes,
            totalNodes: nodes.length,
            problematicNodes,
            totalPendingJobs: queue.reduce((sum, q) => sum + q.pendingJobs, 0),
            alerts: alerts.length
        };
    }

    async run() {
        await this.connect();
        
        if (this.continuous) {
            console.log(`🔄 Starting continuous health monitoring (${this.interval/1000}s interval)`);
            if (this.alertsOnly) {
                console.log('   Running in alerts-only mode (will only show problems)');
            }
            
            while (true) {
                try {
                    await this.performHealthCheck();
                    await new Promise(resolve => setTimeout(resolve, this.interval));
                } catch (error) {
                    console.error('Health check error:', error.message);
                    await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5s on error
                }
            }
        } else {
            const summary = await this.performHealthCheck();
            this.db.close();
            
            // Exit code for automation
            process.exit(summary.alerts > 0 || summary.activeNodes === 0 ? 1 : 0);
        }
    }
}

// CLI handling
if (require.main === module) {
    const args = process.argv.slice(2);
    const options = {
        continuous: args.includes('--continuous'),
        alertsOnly: args.includes('--alert')
    };
    
    const monitor = new NodeHealthMonitor(options);
    monitor.run().catch(error => {
        console.error('Monitor failed:', error.message);
        process.exit(1);
    });
}

module.exports = NodeHealthMonitor;