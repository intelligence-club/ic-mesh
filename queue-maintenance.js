#!/usr/bin/env node

/**
 * Queue Maintenance Tool
 * 
 * Performs safe queue optimization while waiting for frigg node recovery
 * - Removes test pollution
 * - Identifies stuck jobs
 * - Optimizes queue health without affecting real customer jobs
 */

const Database = require('better-sqlite3');
const fs = require('fs');

function performQueueMaintenance() {
    const dbPath = './data/mesh.db';
    if (!fs.existsSync(dbPath)) {
        console.error('❌ Database not found');
        return;
    }

    const db = new Database(dbPath);
    
    console.log('🧹 IC MESH QUEUE MAINTENANCE');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`Started: ${new Date().toISOString()}\n`);
    
    // 1. Identify test job pollution
    console.log('🔍 CHECKING FOR TEST JOB POLLUTION');
    console.log('─────────────────────────────────────────');
    
    const testJobs = db.prepare(`
        SELECT jobId, type, payload, createdAt
        FROM jobs 
        WHERE status = 'pending' 
        AND (
            payload LIKE '%example.com%' OR
            payload LIKE '%test%' OR
            payload LIKE '%demo%' OR
            requester LIKE '%test%'
        )
        ORDER BY createdAt DESC
    `).all();
    
    if (testJobs.length > 0) {
        console.log(`Found ${testJobs.length} test jobs:`);
        testJobs.forEach(job => {
            console.log(`   • ${job.jobId.substring(0, 8)}... (${job.type}) - ${new Date(job.createdAt).toISOString()}`);
        });
        
        // Ask before removing (safe mode)
        console.log('\n⚠️  Test jobs found but NOT automatically removed (safety)');
        console.log('   To remove: DELETE FROM jobs WHERE jobId IN (...test job ids...)');
    } else {
        console.log('✅ No test job pollution detected');
    }
    
    // 2. Check for very old stuck jobs (>7 days pending)
    console.log('\n🔍 CHECKING FOR VERY OLD STUCK JOBS');
    console.log('─────────────────────────────────────────');
    
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const oldJobs = db.prepare(`
        SELECT jobId, type, createdAt, claimedBy
        FROM jobs 
        WHERE status = 'pending' 
        AND createdAt < ?
        ORDER BY createdAt ASC
    `).all(sevenDaysAgo);
    
    if (oldJobs.length > 0) {
        console.log(`Found ${oldJobs.length} jobs older than 7 days:`);
        oldJobs.forEach(job => {
            const ageHours = Math.floor((Date.now() - job.createdAt) / (1000 * 60 * 60));
            console.log(`   • ${job.jobId.substring(0, 8)}... (${job.type}) - ${Math.floor(ageHours/24)}d ${ageHours%24}h old`);
        });
        console.log('\n⚠️  Old jobs found but NOT automatically removed (customer data safety)');
    } else {
        console.log('✅ No excessively old stuck jobs found');
    }
    
    // 3. Check queue health metrics  
    console.log('\n📊 QUEUE HEALTH METRICS');
    console.log('─────────────────────────────────────────');
    
    const queueStats = db.prepare(`
        SELECT 
            status,
            type,
            COUNT(*) as count
        FROM jobs 
        GROUP BY status, type
        ORDER BY status, count DESC
    `).all();
    
    const summary = {};
    queueStats.forEach(stat => {
        if (!summary[stat.status]) summary[stat.status] = {};
        summary[stat.status][stat.type] = stat.count;
    });
    
    Object.keys(summary).forEach(status => {
        const total = Object.values(summary[status]).reduce((a, b) => a + b, 0);
        console.log(`${status.toUpperCase()}: ${total} jobs`);
        Object.keys(summary[status]).forEach(type => {
            console.log(`   • ${type}: ${summary[status][type]}`);
        });
    });
    
    // 4. Check for jobs claimed by offline nodes
    console.log('\n🔍 CHECKING JOBS CLAIMED BY OFFLINE NODES');
    console.log('─────────────────────────────────────────');
    
    const claimedJobs = db.prepare(`
        SELECT j.jobId, j.type, j.claimedBy, j.claimedAt, n.lastSeen
        FROM jobs j
        LEFT JOIN nodes n ON j.claimedBy = n.nodeId
        WHERE j.status = 'claimed' OR j.status = 'processing'
        ORDER BY j.claimedAt DESC
    `).all();
    
    const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
    const stuckClaims = claimedJobs.filter(job => 
        job.lastSeen < fiveMinutesAgo || !job.lastSeen
    );
    
    if (stuckClaims.length > 0) {
        console.log(`Found ${stuckClaims.length} jobs claimed by offline nodes:`);
        stuckClaims.forEach(job => {
            const claimAge = Math.floor((Date.now() - job.claimedAt) / (1000 * 60));
            console.log(`   • ${job.jobId.substring(0, 8)}... (${job.type}) claimed ${claimAge}m ago by ${job.claimedBy?.substring(0, 8) || 'unknown'}`);
        });
        console.log('\n🔧 SAFE RECOVERY SUGGESTION:');
        console.log('   Reset stuck jobs to pending with:');
        console.log('   UPDATE jobs SET status="pending", claimedBy=NULL, claimedAt=NULL WHERE status IN ("claimed","processing") AND claimedBy IN (offline_node_ids)');
    } else {
        console.log('✅ No jobs stuck with offline nodes');
    }
    
    // 5. Overall health assessment
    console.log('\n💊 OVERALL QUEUE HEALTH');
    console.log('─────────────────────────────────────────');
    
    const totalPending = summary.pending ? Object.values(summary.pending).reduce((a, b) => a + b, 0) : 0;
    const totalCompleted = summary.completed ? Object.values(summary.completed).reduce((a, b) => a + b, 0) : 0;
    const totalJobs = totalPending + totalCompleted + (summary.claimed ? Object.values(summary.claimed).reduce((a, b) => a + b, 0) : 0);
    
    console.log(`Queue size: ${totalPending} pending, ${totalCompleted} completed`);
    console.log(`Test pollution: ${testJobs.length} test jobs detected`);
    console.log(`Stuck claims: ${stuckClaims.length} jobs with offline nodes`);
    console.log(`Old jobs: ${oldJobs.length} jobs >7 days old`);
    
    if (totalPending > 100) {
        console.log('🔴 Status: QUEUE OVERLOADED');
        console.log('   Recommendation: Frigg node revival critical for queue health');
    } else if (totalPending > 50) {
        console.log('🟡 Status: QUEUE STRESSED'); 
        console.log('   Recommendation: Monitor for frigg node recovery');
    } else {
        console.log('🟢 Status: QUEUE HEALTHY');
    }
    
    db.close();
    
    return {
        testJobs: testJobs.length,
        oldJobs: oldJobs.length,
        stuckClaims: stuckClaims.length,
        totalPending,
        healthStatus: totalPending > 100 ? 'overloaded' : totalPending > 50 ? 'stressed' : 'healthy'
    };
}

// Run maintenance check
const result = performQueueMaintenance();

console.log('\n🎯 MAINTENANCE COMPLETE');
console.log('─────────────────────────────────────────');
console.log(`Summary: ${result.totalPending} pending jobs, ${result.testJobs} test pollution, ${result.stuckClaims} stuck claims`);
console.log(`Queue health: ${result.healthStatus.toUpperCase()}`);
console.log('\nNo automatic changes made - safety first! 🛡️');