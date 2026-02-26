#!/usr/bin/env node

/**
 * Quick Queue Analysis - Rapid capacity diagnostics for IC Mesh
 * Provides immediate insight into queue health, capacity bottlenecks, and processing status
 */

const Database = require('better-sqlite3');
const path = require('path');

function analyzeQueue() {
    const dbPath = path.join(__dirname, '../data/mesh.db');
    const db = new Database(dbPath, { readonly: true });
    
    try {
        console.log('🔍 IC MESH - QUICK QUEUE ANALYSIS');
        console.log('═'.repeat(50));
        console.log(`Analysis time: ${new Date().toISOString()}`);
        console.log();
        
        // Queue Status Overview
        console.log('📊 QUEUE STATUS');
        console.log('─'.repeat(30));
        
        const queueStats = db.prepare(`
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
                COUNT(CASE WHEN status = 'claimed' THEN 1 END) as claimed,
                COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
                COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed
            FROM jobs
        `).get();
        
        console.log(`Total Jobs:     ${queueStats.total}`);
        console.log(`Pending:        ${queueStats.pending} ${getPendingIndicator(queueStats.pending)}`);
        console.log(`Claimed:        ${queueStats.claimed} ${getClaimedIndicator(queueStats.claimed)}`);
        console.log(`Completed:      ${queueStats.completed}`);
        console.log(`Failed:         ${queueStats.failed} ${getFailureIndicator(queueStats.failed, queueStats.total)}`);
        
        // Success Rate
        if (queueStats.total > 0) {
            const successRate = ((queueStats.completed / queueStats.total) * 100).toFixed(1);
            console.log(`Success Rate:   ${successRate}% ${getSuccessRateIndicator(successRate)}`);
        }
        console.log();
        
        // Node Capacity Analysis
        console.log('🖥️  NODE CAPACITY');
        console.log('─'.repeat(30));
        
        const nodeStats = db.prepare(`
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN lastSeen > (strftime('%s', 'now') - 300) * 1000 THEN 1 END) as active,
                COUNT(CASE WHEN JSON_EXTRACT(flags, '$.quarantined') = 1 THEN 1 END) as quarantined
            FROM nodes
        `).get();
        
        console.log(`Total Nodes:    ${nodeStats.total}`);
        console.log(`Active (5min):  ${nodeStats.active} ${getActiveNodesIndicator(nodeStats.active)}`);
        console.log(`Quarantined:    ${nodeStats.quarantined} ${nodeStats.quarantined > 0 ? '⚠️' : '✅'}`);
        
        if (nodeStats.active > 0) {
            const activeNodes = db.prepare(`
                SELECT nodeId, capabilities, jobsCompleted, 0 as jobsFailed, 
                       CASE WHEN jobsCompleted > 0 THEN 1.0 ELSE 0.0 END as successRate
                FROM nodes 
                WHERE lastSeen > (strftime('%s', 'now') - 300) * 1000
                ORDER BY jobsCompleted DESC
            `).all();
            
            console.log('\nActive Nodes:');
            activeNodes.forEach(node => {
                const caps = JSON.parse(node.capabilities || '[]').slice(0, 3).join(', ');
                const rate = node.successRate ? `${(node.successRate * 100).toFixed(1)}%` : 'N/A';
                console.log(`  • ${node.nodeId.slice(0,8)}: ${caps} (${rate} success)`);
            });
        }
        console.log();
        
        // Capacity Bottleneck Analysis
        console.log('🚨 BOTTLENECK ANALYSIS');
        console.log('─'.repeat(30));
        
        if (queueStats.pending > 10 && nodeStats.active === 0) {
            console.log('❌ CRITICAL: High pending jobs with NO active nodes');
            console.log('   → All nodes offline or quarantined');
        } else if (queueStats.pending > 20 && nodeStats.active < 2) {
            console.log('⚠️  WARNING: High pending jobs with limited capacity');
            console.log('   → Need more active nodes or faster processing');
        } else if (queueStats.claimed > queueStats.pending * 0.5) {
            console.log('⚠️  WARNING: Many claimed but incomplete jobs');
            console.log('   → Possible node reliability issues');
        } else if (nodeStats.quarantined > nodeStats.active) {
            console.log('⚠️  WARNING: More quarantined than active nodes');
            console.log('   → Network health degraded');
        } else {
            console.log('✅ No critical capacity bottlenecks detected');
        }
        
        // Recent Job Types
        const recentJobs = db.prepare(`
            SELECT type, COUNT(*) as count
            FROM jobs 
            WHERE createdAt > (strftime('%s', 'now') - 3600) * 1000
            GROUP BY type
            ORDER BY count DESC
            LIMIT 5
        `).all();
        
        if (recentJobs.length > 0) {
            console.log('\nRecent Job Types (1h):');
            recentJobs.forEach(job => {
                console.log(`  • ${job.type}: ${job.count} jobs`);
            });
        }
        
        console.log();
        console.log('⚡ QUICK RECOMMENDATIONS');
        console.log('─'.repeat(30));
        
        if (nodeStats.active === 0) {
            console.log('• Start or unquarantine healthy nodes immediately');
        } else if (queueStats.pending > nodeStats.active * 5) {
            console.log('• Scale up node capacity to match demand');
        }
        
        if (queueStats.failed > queueStats.completed * 0.1) {
            console.log('• Investigate high failure rate - check node health');
        }
        
        if (nodeStats.quarantined > 0) {
            console.log('• Review quarantined nodes - fix issues or remove');
        }
        
        console.log('• Run node-health-analyzer.js for detailed node analysis');
        console.log('• Use system-dashboard.js for comprehensive health overview');
        
    } catch (error) {
        console.error('❌ Error analyzing queue:', error.message);
        process.exit(1);
    } finally {
        db.close();
    }
}

function getPendingIndicator(count) {
    if (count === 0) return '✅';
    if (count < 5) return '🟡';
    if (count < 20) return '🟠';
    return '🔴';
}

function getClaimedIndicator(count) {
    if (count === 0) return '✅';
    if (count < 3) return '🟡';
    return '🟠';
}

function getFailureIndicator(failed, total) {
    if (failed === 0) return '✅';
    const rate = failed / total;
    if (rate < 0.05) return '🟡';
    if (rate < 0.15) return '🟠';
    return '🔴';
}

function getSuccessRateIndicator(rate) {
    if (rate >= 95) return '✅';
    if (rate >= 80) return '🟡';
    if (rate >= 60) return '🟠';
    return '🔴';
}

function getActiveNodesIndicator(count) {
    if (count === 0) return '🔴';
    if (count === 1) return '🟡';
    return '✅';
}

if (require.main === module) {
    analyzeQueue();
}

module.exports = { analyzeQueue };