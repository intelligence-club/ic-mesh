#!/usr/bin/env node

/**
 * Recovery Progress Monitor - Track job processing after service restoration
 * Monitors queue clearing rate and node stability after crisis recovery
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'mesh.db');

async function checkRecoveryProgress() {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY, (err) => {
            if (err) {
                reject(err);
                return;
            }
        });

        const startTime = Date.now();
        
        // Get current job queue status
        db.all(`
            SELECT 
                status,
                type,
                COUNT(*) as count,
                MIN(createdAt) as oldest_job,
                MAX(createdAt) as newest_job
            FROM jobs 
            GROUP BY status, type 
            ORDER BY status, count DESC
        `, [], (err, jobStats) => {
            if (err) {
                db.close();
                reject(err);
                return;
            }

            // Get active node status
            db.all(`
                SELECT 
                    nodeId,
                    name,
                    capabilities,
                    SUBSTR(nodeId, 1, 8) as short_id,
                    ROUND((julianday('now') - julianday(lastSeen/1000, 'unixepoch')) * 24 * 60, 1) as minutes_ago,
                    jobsCompleted
                FROM nodes 
                WHERE lastSeen > (strftime('%s', 'now') - 900) * 1000
                ORDER BY lastSeen DESC
            `, [], (err, activeNodes) => {
                if (err) {
                    db.close();
                    reject(err);
                    return;
                }

                // Get recent completions (last 10 minutes)
                db.all(`
                    SELECT 
                        type,
                        COUNT(*) as completed_recently,
                        ROUND(AVG(computeMs), 0) as avg_processing_ms
                    FROM jobs 
                    WHERE status = 'completed' 
                    AND completedAt > (strftime('%s', 'now') - 600) * 1000
                    GROUP BY type
                    ORDER BY completed_recently DESC
                `, [], (err, recentCompletions) => {
                    db.close();
                    if (err) {
                        reject(err);
                        return;
                    }

                    // Calculate processing metrics
                    const pendingJobs = jobStats.filter(j => j.status === 'pending');
                    const claimedJobs = jobStats.filter(j => j.status === 'claimed'); 
                    const completedJobs = jobStats.filter(j => j.status === 'completed');
                    
                    const totalPending = pendingJobs.reduce((sum, j) => sum + j.count, 0);
                    const totalClaimed = claimedJobs.reduce((sum, j) => sum + j.count, 0);
                    const totalCompleted = completedJobs.reduce((sum, j) => sum + j.count, 0);
                    
                    const recentlyCompleted = recentCompletions.reduce((sum, j) => sum + j.completed_recently, 0);
                    
                    resolve({
                        timestamp: new Date().toISOString(),
                        activeNodes: activeNodes.length,
                        totalPending,
                        totalClaimed,
                        totalCompleted,
                        recentlyCompleted,
                        processingRate: recentlyCompleted > 0 ? `${recentlyCompleted} jobs/10min` : '0 jobs/10min',
                        queueStatus: totalPending > 50 ? 'HIGH BACKLOG' : totalPending > 10 ? 'MODERATE' : 'LOW',
                        nodes: activeNodes,
                        pendingByType: pendingJobs,
                        recentCompletions
                    });
                });
            });
        });
    });
}

async function main() {
    try {
        const progress = await checkRecoveryProgress();
        
        console.log('🔄 RECOVERY PROGRESS MONITOR');
        console.log('═'.repeat(40));
        console.log(`Time: ${progress.timestamp.substring(11, 19)} UTC`);
        console.log(`Status: ${progress.queueStatus}`);
        console.log();
        
        console.log('📊 QUEUE STATUS:');
        console.log(`  Pending: ${progress.totalPending}`);
        console.log(`  Claimed: ${progress.totalClaimed}`);
        console.log(`  Processing rate: ${progress.processingRate}`);
        console.log(`  Recent completions: ${progress.recentlyCompleted} jobs (last 10min)`);
        console.log();

        if (progress.pendingByType.length > 0) {
            console.log('📋 PENDING BY TYPE:');
            progress.pendingByType.forEach(job => {
                const oldestTime = new Date(job.oldest_job).toISOString().substring(11, 19);
                console.log(`  ${job.type}: ${job.count} jobs (oldest: ${oldestTime})`);
            });
            console.log();
        }

        console.log('🖥️  ACTIVE NODES:');
        if (progress.nodes.length === 0) {
            console.log('  ❌ No active nodes');
        } else {
            progress.nodes.forEach(node => {
                const capabilities = JSON.parse(node.capabilities || '[]').join(', ');
                console.log(`  🟢 ${node.name} (${node.short_id}) - ${capabilities} (${node.minutes_ago}m ago)`);
            });
        }
        console.log();

        if (progress.recentCompletions.length > 0) {
            console.log('⚡ RECENT COMPLETIONS:');
            progress.recentCompletions.forEach(comp => {
                console.log(`  ${comp.type}: ${comp.completed_recently} jobs (avg: ${comp.avg_processing_ms}ms)`);
            });
            console.log();
        }

        // Recovery assessment
        if (progress.activeNodes === 0) {
            console.log('🚨 CRISIS: No active nodes');
        } else if (progress.totalPending > 50) {
            console.log('⚠️  HIGH BACKLOG: Queue clearing slowly');
        } else if (progress.recentlyCompleted > 0) {
            console.log('✅ RECOVERY: Jobs processing normally');
        } else {
            console.log('🔄 MONITORING: No recent activity');
        }

    } catch (error) {
        console.error('❌ Recovery monitoring error:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = { checkRecoveryProgress };