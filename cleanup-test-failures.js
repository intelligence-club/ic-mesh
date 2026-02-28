#!/usr/bin/env node

/**
 * Cleanup Test Job Failures
 * 
 * Removes failed jobs that are actually test pollution:
 * - Jobs with example.com URLs
 * - Jobs with "Test error condition"
 * - Other obvious test artifacts
 * 
 * This improves system health metrics and removes noise
 * from failure analysis.
 */

const Database = require('better-sqlite3');
const path = require('path');

function cleanupTestFailures() {
    const dbPath = path.join(__dirname, 'data', 'mesh.db');
    const db = new Database(dbPath);
    
    console.log('🧹 IC Mesh Test Failure Cleanup');
    console.log('================================');
    
    try {
        // Get current counts
        const totalFailed = db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'failed'").get();
        console.log(`Total failed jobs before cleanup: ${totalFailed.count}`);
        
        // Find test pollution jobs
        const testJobs = db.prepare(`
            SELECT jobId, type, payload, result 
            FROM jobs 
            WHERE status = 'failed' 
            AND (
                payload LIKE '%example.com%' 
                OR result LIKE '%Test error condition%'
                OR payload LIKE '%test%wav%'
                OR payload LIKE '%fail-test%'
                OR result LIKE '%ta name="viewport"%'
            )
            ORDER BY createdAt DESC
        `).all();
        
        console.log(`\nFound ${testJobs.length} test pollution jobs:`);
        
        const typeCounts = {};
        const errorCounts = {};
        
        testJobs.forEach((job, i) => {
            // Count by type
            typeCounts[job.type] = (typeCounts[job.type] || 0) + 1;
            
            // Count by error pattern
            let result;
            try {
                result = JSON.parse(job.result || '{}');
            } catch {
                result = { error: job.result };
            }
            
            const errorMsg = result.error || 'Unknown';
            const errorPattern = errorMsg.split(' ').slice(0,3).join(' ');
            errorCounts[errorPattern] = (errorCounts[errorPattern] || 0) + 1;
            
            if (i < 5) { // Show first 5
                console.log(`  ${job.jobId.substring(0,8)}: ${job.type} - ${errorMsg.substring(0,50)}`);
            }
        });
        
        if (testJobs.length > 5) {
            console.log(`  ... and ${testJobs.length - 5} more`);
        }
        
        console.log('\\nBreakdown by job type:');
        Object.entries(typeCounts).forEach(([type, count]) => {
            console.log(`  ${type}: ${count}`);
        });
        
        console.log('\\nBreakdown by error pattern:');
        Object.entries(errorCounts).forEach(([pattern, count]) => {
            console.log(`  ${pattern}: ${count}`);
        });
        
        if (testJobs.length === 0) {
            console.log('\\n✅ No test pollution found to clean up.');
            return;
        }
        
        // Archive the jobs first
        console.log(`\\n📁 Archiving ${testJobs.length} test jobs...`);
        
        const archiveData = {
            timestamp: new Date().toISOString(),
            reason: 'Test pollution cleanup',
            jobs: testJobs.map(job => ({
                jobId: job.jobId,
                type: job.type,
                payload: job.payload,
                result: job.result
            }))
        };
        
        // Create archive directory
        const fs = require('fs');
        const archiveDir = path.join(__dirname, 'data', 'archive');
        if (!fs.existsSync(archiveDir)) {
            fs.mkdirSync(archiveDir, { recursive: true });
        }
        
        const archiveFile = path.join(archiveDir, `test-failures-${Date.now()}.json`);
        fs.writeFileSync(archiveFile, JSON.stringify(archiveData, null, 2));
        console.log(`Archived to: ${archiveFile}`);
        
        // Delete the test jobs
        const jobIds = testJobs.map(job => job.jobId);
        const placeholders = jobIds.map(() => '?').join(',');
        
        const deleteResult = db.prepare(`
            DELETE FROM jobs 
            WHERE jobId IN (${placeholders})
        `).run(...jobIds);
        
        console.log(`🗑️  Deleted ${deleteResult.changes} test failure jobs`);
        
        // Get new counts
        const newTotalFailed = db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'failed'").get();
        const totalJobs = db.prepare('SELECT COUNT(*) as count FROM jobs').get();
        
        const oldSuccessRate = ((totalJobs.count - totalFailed.count) / totalJobs.count * 100).toFixed(1);
        const newSuccessRate = ((totalJobs.count - newTotalFailed.count) / totalJobs.count * 100).toFixed(1);
        
        console.log(`\\n📊 Results:`);
        console.log(`  Failed jobs: ${totalFailed.count} → ${newTotalFailed.count} (-${deleteResult.changes})`);
        console.log(`  Success rate: ${oldSuccessRate}% → ${newSuccessRate}% (+${(newSuccessRate - oldSuccessRate).toFixed(1)}%)`);
        console.log(`\\n✅ Test pollution cleanup completed!`);
        
    } catch (error) {
        console.error('❌ Error during cleanup:', error.message);
        throw error;
    } finally {
        db.close();
    }
}

if (require.main === module) {
    cleanupTestFailures();
}

module.exports = { cleanupTestFailures };