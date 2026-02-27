#!/usr/bin/env node

/**
 * Enhanced Capacity Monitor
 * Real-time monitoring of IC Mesh capacity with intelligent alerting
 * 
 * Features:
 * - Continuous monitoring of node status and job queue
 * - Capability-based analysis (which job types are blocked)
 * - Smart alerts when critical nodes reconnect
 * - Health scoring with actionable insights
 * - Automatic recovery suggestions
 */

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

class CapacityMonitor {
    constructor() {
        this.dbPath = path.join(__dirname, '..', 'data', 'mesh.db');
        this.db = null;
        this.lastAlert = 0;
        this.alertCooldown = 5 * 60 * 1000; // 5 minutes
        this.monitoringActive = false;
    }

    async init() {
        return new Promise((resolve, reject) => {
            this.db = new sqlite3.Database(this.dbPath, (err) => {
                if (err) {
                    console.error('❌ Database connection failed:', err.message);
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    async getSystemStatus() {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    -- Job statistics
                    (SELECT COUNT(*) FROM jobs WHERE status = 'pending') as pending_jobs,
                    (SELECT COUNT(*) FROM jobs WHERE status = 'claimed') as claimed_jobs,
                    (SELECT COUNT(*) FROM jobs WHERE status = 'completed') as completed_jobs,
                    (SELECT COUNT(*) FROM jobs WHERE status = 'failed') as failed_jobs,
                    
                    -- Node statistics
                    (SELECT COUNT(*) FROM nodes) as total_nodes,
                    (SELECT COUNT(*) FROM nodes WHERE lastSeen > (strftime('%s', 'now') - 300)) as active_nodes
            `;

            this.db.get(query, (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    async getJobsByType() {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT type, COUNT(*) as count 
                FROM jobs 
                WHERE status = 'pending' 
                GROUP BY type 
                ORDER BY count DESC
            `;

            this.db.all(query, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    async getActiveNodes() {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT nodeId, owner, capabilities, lastSeen,
                       (SELECT COUNT(*) FROM jobs WHERE nodeId = n.nodeId AND status = 'completed') as completed_jobs,
                       (SELECT COUNT(*) FROM jobs WHERE nodeId = n.nodeId AND status = 'failed') as failed_jobs
                FROM nodes n 
                WHERE lastSeen > (strftime('%s', 'now') - 300)
                ORDER BY lastSeen DESC
            `;

            this.db.all(query, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    async getOfflineNodes() {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT nodeId, owner, capabilities, lastSeen,
                       (SELECT COUNT(*) FROM jobs WHERE nodeId = n.nodeId AND status = 'completed') as completed_jobs,
                       (SELECT COUNT(*) FROM jobs WHERE nodeId = n.nodeId AND status = 'failed') as failed_jobs,
                       ROUND((strftime('%s', 'now') - lastSeen) / 60.0) as minutes_offline
                FROM nodes n 
                WHERE lastSeen <= (strftime('%s', 'now') - 300)
                ORDER BY completed_jobs DESC, lastSeen DESC
            `;

            this.db.all(query, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    calculateHealthScore(status, activeNodes, offlineNodes) {
        const totalJobs = status.pending_jobs + status.claimed_jobs + status.completed_jobs + status.failed_jobs;
        const successRate = totalJobs > 0 ? (status.completed_jobs / totalJobs) * 100 : 100;
        
        const capacityScore = activeNodes.length > 0 ? Math.min(100, (activeNodes.length / Math.max(1, status.total_nodes)) * 100) : 0;
        const queueScore = status.pending_jobs === 0 ? 100 : Math.max(0, 100 - (status.pending_jobs * 2));
        
        const overallScore = Math.round((successRate * 0.4) + (capacityScore * 0.4) + (queueScore * 0.2));
        
        return {
            overall: overallScore,
            success: Math.round(successRate),
            capacity: Math.round(capacityScore),
            queue: Math.round(queueScore)
        };
    }

    getHealthIndicator(score) {
        if (score >= 90) return '🟢 EXCELLENT';
        if (score >= 75) return '🟡 GOOD';
        if (score >= 50) return '🟠 DEGRADED';
        if (score >= 25) return '🔴 POOR';
        return '💀 CRITICAL';
    }

    getCapabilityGaps(pendingJobs, activeNodes) {
        const activeCapabilities = new Set();
        activeNodes.forEach(node => {
            if (node.capabilities) {
                JSON.parse(node.capabilities).forEach(cap => activeCapabilities.add(cap));
            }
        });

        const neededCapabilities = new Set();
        const gaps = [];

        for (const job of pendingJobs) {
            const requiredCaps = this.getRequiredCapabilities(job.type);
            requiredCaps.forEach(cap => neededCapabilities.add(cap));
            
            const hasCapability = requiredCaps.some(cap => activeCapabilities.has(cap));
            if (!hasCapability) {
                gaps.push({
                    jobType: job.type,
                    count: job.count,
                    requiredCapabilities: requiredCaps
                });
            }
        }

        return {
            missingCapabilities: Array.from(neededCapabilities).filter(cap => !activeCapabilities.has(cap)),
            blockedJobs: gaps
        };
    }

    getRequiredCapabilities(jobType) {
        const capabilityMap = {
            'transcribe': ['transcription', 'whisper'],
            'ocr': ['tesseract', 'ocr'],
            'pdf-extract': ['pdf-extract', 'tesseract'],
            'stable-diffusion': ['stable-diffusion'],
            'ollama': ['ollama']
        };

        return capabilityMap[jobType] || [jobType];
    }

    async generateActionableInsights(status, activeNodes, offlineNodes, pendingJobs) {
        const insights = [];
        const gaps = this.getCapabilityGaps(pendingJobs, activeNodes);

        // High-impact offline nodes
        const criticalOfflineNodes = offlineNodes
            .filter(node => node.completed_jobs > 5 && node.minutes_offline < 1440) // < 24 hours
            .sort((a, b) => b.completed_jobs - a.completed_jobs)
            .slice(0, 3);

        if (criticalOfflineNodes.length > 0) {
            insights.push({
                type: 'critical_nodes_offline',
                priority: 'HIGH',
                message: `${criticalOfflineNodes.length} high-value nodes recently offline`,
                details: criticalOfflineNodes.map(node => 
                    `${node.nodeId.substring(0, 8)} (${node.owner}): ${node.completed_jobs} jobs, ${node.minutes_offline}min ago`
                ),
                action: 'Contact node owners for reconnection'
            });
        }

        // Capability gaps
        if (gaps.blockedJobs.length > 0) {
            const totalBlocked = gaps.blockedJobs.reduce((sum, gap) => sum + gap.count, 0);
            insights.push({
                type: 'capability_gaps',
                priority: 'MEDIUM',
                message: `${totalBlocked} jobs blocked by missing capabilities`,
                details: gaps.blockedJobs.map(gap => 
                    `${gap.count} ${gap.jobType} jobs need: ${gap.requiredCapabilities.join(' or ')}`
                ),
                action: 'Recruit nodes with missing capabilities or restore offline nodes'
            });
        }

        // Queue backlog
        if (status.pending_jobs > 20) {
            insights.push({
                type: 'queue_backlog',
                priority: 'MEDIUM',
                message: `${status.pending_jobs} jobs pending`,
                details: pendingJobs.map(job => `${job.count} ${job.type} jobs`),
                action: 'Scale up processing capacity'
            });
        }

        // Single point of failure
        if (activeNodes.length === 1 && status.pending_jobs > 0) {
            insights.push({
                type: 'single_point_failure',
                priority: 'HIGH',
                message: 'Only 1 active node - single point of failure',
                details: [`Active: ${activeNodes[0].nodeId.substring(0, 8)} (${activeNodes[0].owner})`],
                action: 'Restore additional nodes for redundancy'
            });
        }

        return insights;
    }

    async displayStatus() {
        try {
            const status = await this.getSystemStatus();
            const activeNodes = await this.getActiveNodes();
            const offlineNodes = await this.getOfflineNodes();
            const pendingJobs = await this.getJobsByType();
            
            const health = this.calculateHealthScore(status, activeNodes, offlineNodes);
            const insights = await this.generateActionableInsights(status, activeNodes, offlineNodes, pendingJobs);

            console.log('');
            console.log('🔍 IC MESH ENHANCED CAPACITY MONITOR');
            console.log('══════════════════════════════════════════════════');
            console.log(`📊 System Health: ${this.getHealthIndicator(health.overall)} (${health.overall}/100)`);
            console.log(`   Success Rate: ${health.success}% | Capacity: ${health.capacity}% | Queue: ${health.queue}%`);
            console.log('');

            console.log('📈 CURRENT STATUS');
            console.log('──────────────────────────────');
            console.log(`Jobs:        ${status.pending_jobs} pending | ${status.claimed_jobs} claimed | ${status.completed_jobs} completed | ${status.failed_jobs} failed`);
            console.log(`Nodes:       ${status.active_nodes}/${status.total_nodes} active`);
            console.log('');

            if (pendingJobs.length > 0) {
                console.log('📋 PENDING JOBS BY TYPE');
                console.log('──────────────────────────────');
                pendingJobs.forEach(job => {
                    console.log(`   ${job.type}: ${job.count} jobs`);
                });
                console.log('');
            }

            if (activeNodes.length > 0) {
                console.log('🟢 ACTIVE NODES');
                console.log('──────────────────────────────');
                activeNodes.forEach(node => {
                    const caps = node.capabilities ? JSON.parse(node.capabilities).join(', ') : 'none';
                    const successRate = node.completed_jobs + node.failed_jobs > 0 
                        ? Math.round((node.completed_jobs / (node.completed_jobs + node.failed_jobs)) * 100)
                        : 100;
                    console.log(`   ${node.nodeId.substring(0, 8)} (${node.owner}): ${node.completed_jobs} jobs, ${successRate}% success`);
                    console.log(`      Capabilities: ${caps}`);
                });
                console.log('');
            }

            if (offlineNodes.length > 0) {
                console.log('🔴 OFFLINE NODES (Top 5)');
                console.log('──────────────────────────────');
                offlineNodes.slice(0, 5).forEach(node => {
                    const caps = node.capabilities ? JSON.parse(node.capabilities).join(', ') : 'none';
                    const successRate = node.completed_jobs + node.failed_jobs > 0 
                        ? Math.round((node.completed_jobs / (node.completed_jobs + node.failed_jobs)) * 100)
                        : 100;
                    console.log(`   ${node.nodeId.substring(0, 8)} (${node.owner}): ${node.completed_jobs} jobs, ${successRate}% success`);
                    console.log(`      Offline: ${node.minutes_offline} minutes | Capabilities: ${caps}`);
                });
                console.log('');
            }

            if (insights.length > 0) {
                console.log('💡 ACTIONABLE INSIGHTS');
                console.log('──────────────────────────────');
                insights.forEach((insight, i) => {
                    const priority = insight.priority === 'HIGH' ? '🔥' : insight.priority === 'MEDIUM' ? '⚠️' : 'ℹ️';
                    console.log(`${i + 1}. ${priority} ${insight.message}`);
                    insight.details.forEach(detail => console.log(`      • ${detail}`));
                    console.log(`      → Action: ${insight.action}`);
                    console.log('');
                });
            }

            return { status, health, insights };

        } catch (error) {
            console.error('❌ Error in capacity monitor:', error.message);
            throw error;
        }
    }

    async startMonitoring(interval = 30000) {
        console.log(`🔄 Starting enhanced capacity monitoring (${interval/1000}s intervals)`);
        this.monitoringActive = true;

        const monitor = async () => {
            if (!this.monitoringActive) return;
            
            try {
                const result = await this.displayStatus();
                
                // Alert logic for critical situations
                const now = Date.now();
                if (now - this.lastAlert > this.alertCooldown) {
                    const criticalInsights = result.insights.filter(i => i.priority === 'HIGH');
                    if (criticalInsights.length > 0 && result.health.overall < 50) {
                        console.log('🚨 CRITICAL ALERT: System requires immediate attention');
                        this.lastAlert = now;
                    }
                }
                
                console.log('─'.repeat(50));
                console.log(`Next check in ${interval/1000}s... (Ctrl+C to stop)`);
                console.log('');

            } catch (error) {
                console.error('❌ Monitoring error:', error.message);
            }

            setTimeout(monitor, interval);
        };

        await monitor();
    }

    stop() {
        this.monitoringActive = false;
        console.log('⏹️  Monitoring stopped');
    }

    close() {
        if (this.db) {
            this.db.close();
        }
    }
}

// CLI Interface
async function main() {
    const args = process.argv.slice(2);
    const command = args[0] || 'status';
    
    const monitor = new CapacityMonitor();
    
    try {
        await monitor.init();
        
        switch (command) {
            case 'status':
                await monitor.displayStatus();
                break;
                
            case 'monitor':
                const interval = args[1] ? parseInt(args[1]) * 1000 : 30000;
                process.on('SIGINT', () => {
                    monitor.stop();
                    monitor.close();
                    process.exit(0);
                });
                await monitor.startMonitoring(interval);
                break;
                
            case 'once':
                const result = await monitor.displayStatus();
                console.log(`\n📊 Health Score: ${result.health.overall}/100`);
                break;
                
            default:
                console.log('Usage: enhanced-capacity-monitor.js [status|monitor|once] [interval_seconds]');
                console.log('');
                console.log('Commands:');
                console.log('  status  - Show current system status (default)');
                console.log('  monitor - Start continuous monitoring');
                console.log('  once    - Show status once with health score');
                console.log('');
                console.log('Examples:');
                console.log('  node enhanced-capacity-monitor.js');
                console.log('  node enhanced-capacity-monitor.js monitor 60');
                console.log('  node enhanced-capacity-monitor.js once');
        }
        
    } catch (error) {
        console.error('❌ Monitor failed:', error.message);
        process.exit(1);
    } finally {
        monitor.close();
    }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n👋 Shutting down monitor...');
    process.exit(0);
});

if (require.main === module) {
    main();
}

module.exports = CapacityMonitor;