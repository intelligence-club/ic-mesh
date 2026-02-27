#!/usr/bin/env node

/**
 * Reset Expired Jobs - Reset jobs that failed due to no available nodes
 * These jobs failed not due to processing errors, but due to missing capabilities
 * They can be safely reset to pending when the required nodes come back online
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'mesh.db');

function resetExpiredJobs() {
    console.log('🔄 IC Mesh Expired Jobs Recovery');
    console.log('══════════════════════════════════════');
    
    const db = new Database(DB_PATH, { readonly: false });
    
    try {
        // Find jobs that failed due to expiration (no node available)
        console.log('📊 Analyzing expired jobs...');
        
        const expiredJobs = db.prepare(`
            SELECT jobId, type, status, result, createdAt 
            FROM jobs 
            WHERE status = 'failed' 
            AND result LIKE '%no node claimed this job%'
            ORDER BY createdAt DESC
        `).all();
        
        console.log(`Found ${expiredJobs.length} jobs that expired due to missing nodes`);
        
        if (expiredJobs.length === 0) {
            console.log('✅ No expired jobs to reset');
            return;
        }
        
        // Group by job type
        const byType = {};
        for (const job of expiredJobs) {
            byType[job.type] = (byType[job.type] || 0) + 1;
        }
        
        console.log('\n📋 Expired jobs by type:');
        for (const [type, count] of Object.entries(byType)) {
            console.log(`   ${type}: ${count}`);
        }
        
        // Show what will be reset
        console.log('\n🎯 These jobs will be reset to pending status when nodes come online');
        console.log('   They failed due to missing capabilities, not processing errors');
        
        // Ask for confirmation before reset
        if (process.argv.includes('--dry-run')) {
            console.log('\n✅ Dry run complete. Use --confirm to actually reset expired jobs.');
            return;
        }
        
        if (!process.argv.includes('--confirm')) {
            console.log('\n⚠️  Add --confirm to actually reset jobs, or --dry-run to preview');
            return;
        }
        
        // Reset expired jobs to pending
        console.log('\n🔄 Resetting expired jobs to pending...');
        
        const resetResult = db.prepare(`
            UPDATE jobs 
            SET status = 'pending', 
                result = NULL,
                claimedBy = NULL,
                claimedAt = NULL,
                completedAt = NULL
            WHERE status = 'failed' 
            AND result LIKE '%no node claimed this job%'
        `).run();
        
        console.log(`✅ Reset ${resetResult.changes} expired jobs to pending`);
        
        // Show updated queue status
        const stats = db.prepare(`
            SELECT status, COUNT(*) as count 
            FROM jobs 
            GROUP BY status
        `).all();
        
        console.log('\n📊 Updated job queue status:');
        for (const stat of stats) {
            console.log(`   ${stat.status}: ${stat.count}`);
        }
        
    } catch (error) {
        console.error('❌ Error during reset:', error);
    } finally {
        db.close();
    }
}

if (require.main === module) {
    resetExpiredJobs();
}

module.exports = { resetExpiredJobs };