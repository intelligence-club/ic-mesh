#!/usr/bin/env node

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'mesh.db');

class TestJobCleaner {
    constructor() {
        this.db = new Database(DB_PATH);
        
        this.statements = {
            findTestJobs: this.db.prepare(`
                SELECT jobId, type, payload, requirements, status, createdAt
                FROM jobs 
                WHERE 
                    JSON_EXTRACT(requirements, '$.capability') = 'TEST_MODE'
                    OR payload LIKE '%example.com%'
                    OR payload LIKE '%test%'
                    OR type = 'test'
                ORDER BY createdAt DESC
            `),
            
            deleteJob: this.db.prepare(`
                DELETE FROM jobs WHERE jobId = ?
            `),
            
            countJobs: this.db.prepare(`
                SELECT status, COUNT(*) as count FROM jobs GROUP BY status
            `)
        };
    }

    async cleanTestJobs(options = {}) {
        const { dryRun = false, verbose = true } = options;
        
        if (verbose) {
            console.log('🧹 IC Mesh Test Job Cleanup');
            console.log('═'.repeat(40));
            console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE CLEANUP'}`);
            console.log('');
        }

        // Get current job counts
        const beforeCounts = this.statements.countJobs.all();
        if (verbose) {
            console.log('📊 Current Job Status:');
            for (const row of beforeCounts) {
                console.log(`   ${row.status}: ${row.count} jobs`);
            }
            console.log('');
        }

        // Find test jobs
        const testJobs = this.statements.findTestJobs.all();
        
        if (testJobs.length === 0) {
            if (verbose) {
                console.log('✅ No test jobs found - queue is clean!');
            }
            this.db.close();
            return { cleaned: 0, beforeCounts, afterCounts: beforeCounts };
        }

        if (verbose) {
            console.log(`🎯 Found ${testJobs.length} test jobs to clean:`);
            for (const job of testJobs) {
                const age = Math.round((Date.now() - job.createdAt) / 1000 / 60);
                const payloadPreview = job.payload.substring(0, 50) + (job.payload.length > 50 ? '...' : '');
                const requirements = JSON.parse(job.requirements);
                console.log(`   ${job.jobId.substring(0, 8)}... ${job.type.padEnd(12)} ${job.status.padEnd(9)} (${age}m old)`);
                if (requirements.capability) {
                    console.log(`     Requires: ${requirements.capability}`);
                }
                if (payloadPreview.includes('example.com') || payloadPreview.includes('test')) {
                    console.log(`     Payload: ${payloadPreview}`);
                }
            }
            console.log('');
        }

        if (!dryRun) {
            // Delete test jobs
            let cleaned = 0;
            for (const job of testJobs) {
                try {
                    this.statements.deleteJob.run(job.jobId);
                    cleaned++;
                    if (verbose) {
                        console.log(`   🗑️  Deleted ${job.jobId.substring(0, 8)}... (${job.type})`);
                    }
                } catch (error) {
                    console.error(`   ❌ Failed to delete ${job.jobId}: ${error.message}`);
                }
            }
            
            if (verbose) {
                console.log('');
                console.log(`✅ Cleanup complete: ${cleaned} test jobs removed`);
                console.log('');
            }
        } else {
            if (verbose) {
                console.log('🔍 DRY RUN: Would delete these jobs in live mode');
                console.log('   Run without --dry-run to actually clean');
                console.log('');
            }
        }

        // Get updated counts
        const afterCounts = this.statements.countJobs.all();
        if (verbose && !dryRun) {
            console.log('📊 Updated Job Status:');
            for (const row of afterCounts) {
                console.log(`   ${row.status}: ${row.count} jobs`);
            }
        }

        this.db.close();
        return { 
            cleaned: dryRun ? 0 : testJobs.length, 
            found: testJobs.length,
            beforeCounts, 
            afterCounts: dryRun ? beforeCounts : afterCounts 
        };
    }
}

// CLI mode
if (require.main === module) {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run') || args.includes('-n');
    const quiet = args.includes('--quiet') || args.includes('-q');
    
    const cleaner = new TestJobCleaner();
    
    cleaner.cleanTestJobs({ dryRun, verbose: !quiet })
        .then(result => {
            if (result.cleaned > 0) {
                process.exit(0);
            } else if (result.found > 0 && dryRun) {
                console.log('Run without --dry-run to clean test jobs');
                process.exit(1);
            } else {
                process.exit(0);
            }
        })
        .catch(err => {
            console.error('❌ Cleanup failed:', err);
            process.exit(1);
        });
}

module.exports = TestJobCleaner;