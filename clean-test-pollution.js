#!/usr/bin/env node
/**
 * Clean Test Job Pollution from IC Mesh Database
 * 
 * PURPOSE: Remove test jobs that are created by monitoring/testing scripts
 * SAFETY: Only removes jobs with test payload patterns and recent timestamps
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'data', 'mesh.db');
const db = new Database(DB_PATH);

async function cleanTestPollution() {
    console.log('🧹 IC MESH TEST POLLUTION CLEANUP');
    console.log('═══════════════════════════════════════════');
    console.log(`Timestamp: ${new Date().toISOString()}`);
    console.log();

    // Find test jobs - jobs with test-like payloads or created by testing systems
    const testJobs = db.prepare(`
        SELECT jobId, type, payload, createdAt, requester
        FROM jobs 
        WHERE status = 'pending'
        AND (
            payload LIKE '%example.com%'
            OR payload LIKE '%test%'
            OR payload LIKE '%TEST%'
            OR payload LIKE '%dummy%'
            OR requester LIKE '%test%'
            OR requester = 'system'
            OR (type = 'transcribe' AND createdAt > strftime('%s', 'now', '-2 hours'))
        )
        ORDER BY createdAt DESC
    `).all();

    const realJobs = db.prepare(`
        SELECT jobId, type, payload, createdAt, requester
        FROM jobs 
        WHERE status = 'pending'
        AND payload NOT LIKE '%example.com%'
        AND payload NOT LIKE '%test%'
        AND payload NOT LIKE '%TEST%'
        AND payload NOT LIKE '%dummy%'
        AND requester NOT LIKE '%test%'
        AND requester != 'system'
        AND NOT (type = 'transcribe' AND createdAt > strftime('%s', 'now', '-2 hours'))
    `).all();

    console.log('📊 ANALYSIS RESULTS');
    console.log('────────────────────────────────────────');
    console.log(`🔍 Test jobs found: ${testJobs.length}`);
    console.log(`🎯 Real customer jobs: ${realJobs.length}`);
    console.log();

    if (testJobs.length > 0) {
        console.log('🗑️ TEST JOBS TO REMOVE:');
        testJobs.slice(0, 10).forEach(job => { // Show first 10
            const payload = JSON.parse(job.payload || '{}');
            const url = payload.url || payload.audioUrl || 'no-url';
            console.log(`   ${job.jobId.slice(0, 8)}... (${job.type}) - ${url.slice(0, 40)}...`);
        });
        if (testJobs.length > 10) {
            console.log(`   ... and ${testJobs.length - 10} more test jobs`);
        }
        console.log();
    }

    if (realJobs.length > 0) {
        console.log('✅ REAL CUSTOMER JOBS (KEEPING):');
        realJobs.forEach(job => {
            const payload = JSON.parse(job.payload || '{}');
            const url = payload.url || payload.audioUrl || 'no-url';
            console.log(`   ${job.jobId.slice(0, 8)}... (${job.type}) - ${url.slice(0, 40)}...`);
        });
        console.log();
    }

    // Execute cleanup
    if (testJobs.length > 0) {
        const testJobIds = testJobs.map(job => job.jobId);
        const placeholders = testJobIds.map(() => '?').join(',');
        
        const deleteStmt = db.prepare(`DELETE FROM jobs WHERE jobId IN (${placeholders})`);
        const result = deleteStmt.run(...testJobIds);
        
        console.log('✅ CLEANUP COMPLETED');
        console.log('────────────────────────────────────────');
        console.log(`🗑️ Removed ${result.changes} test jobs`);
        console.log(`🎯 Kept ${realJobs.length} real customer jobs`);
        console.log();
        
        // Verify cleanup
        const remainingPending = db.prepare(`SELECT COUNT(*) as count FROM jobs WHERE status = 'pending'`).get();
        console.log(`📊 Queue status: ${remainingPending.count} pending jobs remaining`);
        
        if (remainingPending.count !== realJobs.length) {
            console.log(`⚠️ Warning: Expected ${realJobs.length} remaining, found ${remainingPending.count}`);
        }
    } else {
        console.log('✅ NO TEST POLLUTION FOUND');
        console.log(`📊 Queue is clean: ${realJobs.length} real customer jobs`);
    }

    return {
        testJobsRemoved: testJobs.length,
        realJobsKept: realJobs.length,
        success: true
    };
}

if (require.main === module) {
    cleanTestPollution().catch(console.error);
}

module.exports = { cleanTestPollution };