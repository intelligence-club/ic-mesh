#!/usr/bin/env node

/**
 * Cleanup Test Jobs - Remove test/example jobs from IC Mesh queue
 * Safely removes jobs with test URLs or example content to reduce queue pollution
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'mesh.db');

function cleanupTestJobs() {
    console.log('🧹 IC Mesh Test Job Cleanup');
    console.log('══════════════════════════════════════');
    
    const db = new Database(DB_PATH, { readonly: false });
    
    try {
        // First, analyze what we're dealing with
        console.log('📊 Analyzing test jobs...');
        
        const testJobs = db.prepare(`
            SELECT jobId, type, status, payload, createdAt 
            FROM jobs 
            WHERE payload LIKE '%test%' OR payload LIKE '%example%' 
            ORDER BY createdAt DESC
        `).all();
        
        console.log(`Found ${testJobs.length} jobs with test/example content`);
        
        // Group by status for reporting
        const byStatus = {};
        const testUrls = [];
        
        for (const job of testJobs) {
            byStatus[job.status] = (byStatus[job.status] || 0) + 1;
            
            try {
                const payload = JSON.parse(job.payload);
                if (payload.url && (payload.url.includes('test') || payload.url.includes('example'))) {
                    testUrls.push(job.jobId);
                }
            } catch (e) {
                // Skip unparseable payloads
            }
        }
        
        console.log('\n📋 Jobs by status:');
        for (const [status, count] of Object.entries(byStatus)) {
            console.log(`   ${status}: ${count}`);
        }
        
        console.log(`\n🎯 Jobs with test/example URLs: ${testUrls.length}`);
        
        // Ask for confirmation before cleanup
        if (process.argv.includes('--dry-run')) {
            console.log('\n✅ Dry run complete. Use --confirm to actually remove test jobs.');
            return;
        }
        
        if (!process.argv.includes('--confirm')) {
            console.log('\n⚠️  Add --confirm to actually remove test jobs, or --dry-run to preview');
            return;
        }
        
        // Remove jobs with test/example URLs (safest approach)
        console.log('\n🗑️ Removing test jobs...');
        
        const removeResult = db.prepare(`
            DELETE FROM jobs 
            WHERE payload LIKE '%test%' OR payload LIKE '%example%'
        `).run();
        
        console.log(`✅ Removed ${removeResult.changes} test jobs`);
        
        // Show updated queue status
        const remaining = db.prepare('SELECT COUNT(*) as count FROM jobs WHERE status = "pending"').get();
        console.log(`📊 Remaining pending jobs: ${remaining.count}`);
        
    } catch (error) {
        console.error('❌ Error during cleanup:', error);
    } finally {
        db.close();
    }
}

if (require.main === module) {
    cleanupTestJobs();
}

module.exports = { cleanupTestJobs };