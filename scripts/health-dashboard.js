#!/usr/bin/env node
/**
 * Health Dashboard - Quick operational overview
 * Provides essential metrics for work pulse sessions
 */

const sqlite3 = require('sqlite3').verbose();

class HealthDashboard {
    constructor() {
        this.db = new sqlite3.Database('data/mesh.db', sqlite3.OPEN_READONLY, (err) => {
            if (err) {
                console.error('❌ Database connection failed:', err.message);
                process.exit(1);
            }
        });
    }

    async generateDashboard() {
        console.log('📊 IC Mesh Health Dashboard');
        console.log('===========================');
        console.log(`Generated: ${new Date().toISOString()}\n`);

        const [jobStats, nodeStats, oldestJobs, recentActivity] = await Promise.all([
            this.getJobStats(),
            this.getNodeStats(), 
            this.getOldestPendingJobs(),
            this.getRecentActivity()
        ]);

        this.displayJobStats(jobStats);
        this.displayNodeStats(nodeStats);
        this.displayOldestJobs(oldestJobs);
        this.displayRecentActivity(recentActivity);
        this.generateAlerts(jobStats, nodeStats, oldestJobs);

        this.db.close();
    }

    async getJobStats() {
        return new Promise((resolve) => {
            this.db.all(`
                SELECT 
                    status,
                    type,
                    COUNT(*) as count,
                    AVG((strftime('%s', 'now') * 1000 - createdAt) / 60000) as avg_age_minutes
                FROM jobs 
                WHERE status IN ('pending', 'claimed')
                GROUP BY status, type
                ORDER BY status, count DESC
            `, (err, rows) => {
                resolve(err ? [] : rows);
            });
        });
    }

    async getNodeStats() {
        return new Promise((resolve) => {
            this.db.all(`
                SELECT 
                    nodeId,
                    owner,
                    capabilities,
                    (strftime('%s', 'now') * 1000 - lastSeen) / 60000 as minutes_since_seen,
                    jobsCompleted
                FROM nodes 
                ORDER BY lastSeen DESC
            `, (err, rows) => {
                resolve(err ? [] : rows);
            });
        });
    }

    async getOldestPendingJobs() {
        return new Promise((resolve) => {
            this.db.all(`
                SELECT 
                    type,
                    (strftime('%s', 'now') * 1000 - createdAt) / 60000 as age_minutes,
                    COUNT(*) as jobs_this_old
                FROM jobs 
                WHERE status = 'pending'
                GROUP BY type
                HAVING age_minutes > 60
                ORDER BY age_minutes DESC
                LIMIT 5
            `, (err, rows) => {
                resolve(err ? [] : rows);
            });
        });
    }

    async getRecentActivity() {
        return new Promise((resolve) => {
            this.db.get(`
                SELECT 
                    COUNT(*) as completed_last_hour,
                    AVG(computeMs / 1000.0) as avg_compute_seconds
                FROM jobs 
                WHERE status = 'completed' 
                AND completedAt > strftime('%s', 'now') * 1000 - 3600000
            `, (err, row) => {
                resolve(err ? {} : row);
            });
        });
    }

    displayJobStats(stats) {
        console.log('📋 JOB QUEUE STATUS:');
        if (stats.length === 0) {
            console.log('  ✅ No pending or claimed jobs');
            return;
        }

        let pendingCount = 0;
        let claimedCount = 0;
        const typeBreakdown = {};

        stats.forEach(stat => {
            if (stat.status === 'pending') {
                pendingCount += stat.count;
                typeBreakdown[stat.type] = (typeBreakdown[stat.type] || 0) + stat.count;
            } else if (stat.status === 'claimed') {
                claimedCount += stat.count;
            }
            
            const avgAge = Math.round(stat.avg_age_minutes);
            const status = stat.status === 'pending' ? '⏳' : '🔄';
            console.log(`  ${status} ${stat.type}: ${stat.count} jobs (avg: ${avgAge}min old)`);
        });

        console.log(`\n  Summary: ${pendingCount} pending, ${claimedCount} claimed`);
    }

    displayNodeStats(nodes) {
        console.log('\n🖥️  NODE STATUS:');
        
        const activeNodes = nodes.filter(n => n.minutes_since_seen < 5);
        const recentNodes = nodes.filter(n => n.minutes_since_seen >= 5 && n.minutes_since_seen < 60);
        const offlineNodes = nodes.filter(n => n.minutes_since_seen >= 60);

        console.log(`  Total: ${nodes.length} | Active: ${activeNodes.length} | Recent: ${recentNodes.length} | Offline: ${offlineNodes.length}`);

        if (activeNodes.length > 0) {
            console.log('\n  🟢 ACTIVE NODES (< 5min):');
            activeNodes.forEach(node => {
                const caps = node.capabilities ? JSON.parse(node.capabilities) : [];
                console.log(`    ${node.nodeId.substring(0, 8)}: ${caps.join(', ')} (${node.jobsCompleted} jobs)`);
            });
        }

        if (offlineNodes.length > 0 && offlineNodes.length <= 3) {
            console.log('\n  🔴 OFFLINE NODES:');
            offlineNodes.slice(0, 3).forEach(node => {
                const hours = Math.round(node.minutes_since_seen / 60);
                const caps = node.capabilities ? JSON.parse(node.capabilities) : [];
                console.log(`    ${node.nodeId.substring(0, 8)}: ${caps.join(', ')} (${hours}h ago, ${node.jobsCompleted} jobs)`);
            });
        }
    }

    displayOldestJobs(oldJobs) {
        if (oldJobs.length === 0) return;

        console.log('\n⏰ AGING JOBS (> 1 hour):');
        oldJobs.forEach(job => {
            const hours = Math.round(job.age_minutes / 60);
            console.log(`  ${job.type}: ${job.jobs_this_old} jobs (oldest: ${hours}h)`);
        });
    }

    displayRecentActivity(activity) {
        if (!activity.completed_last_hour) return;

        console.log('\n📈 RECENT ACTIVITY (last hour):');
        console.log(`  Completed: ${activity.completed_last_hour} jobs`);
        if (activity.avg_compute_seconds) {
            console.log(`  Avg compute time: ${activity.avg_compute_seconds.toFixed(1)}s`);
        }
    }

    generateAlerts(jobStats, nodeStats, oldestJobs) {
        console.log('\n🚨 ALERTS:');
        
        const alerts = [];
        const pendingJobs = jobStats.filter(s => s.status === 'pending').reduce((sum, s) => sum + s.count, 0);
        const activeNodes = nodeStats.filter(n => n.minutes_since_seen < 5).length;
        
        if (pendingJobs > 50) {
            alerts.push(`${pendingJobs} pending jobs (high backlog)`);
        }
        
        if (activeNodes === 0) {
            alerts.push('No active nodes (complete outage)');
        } else if (activeNodes === 1) {
            alerts.push('Single active node (capacity risk)');
        }
        
        const criticallyOldJobs = oldestJobs.filter(j => j.age_minutes > 1440); // 24h
        if (criticallyOldJobs.length > 0) {
            alerts.push(`Jobs pending > 24h (customer impact)`);
        }

        if (alerts.length === 0) {
            console.log('  ✅ No critical alerts');
        } else {
            alerts.forEach(alert => console.log(`  🚨 ${alert}`));
        }
    }
}

// Run dashboard
if (require.main === module) {
    const dashboard = new HealthDashboard();
    dashboard.generateDashboard().catch(console.error);
}

module.exports = HealthDashboard;