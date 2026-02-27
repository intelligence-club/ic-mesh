#!/usr/bin/env node
/**
 * Job Queue Analysis Tool
 * Analyzes the current job queue to understand what types of jobs are pending
 * and provides insights for operational decisions
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, '../data/mesh.db');

function analyzeJobQueue() {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                reject(`Database connection error: ${err.message}`);
                return;
            }
        });

        const results = {};
        
        // Get overall job statistics
        db.get(`
            SELECT 
                COUNT(*) as total_jobs,
                SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_jobs,
                SUM(CASE WHEN status = 'claimed' THEN 1 ELSE 0 END) as claimed_jobs,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_jobs,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_jobs
            FROM jobs
        `, (err, stats) => {
            if (err) {
                reject(`Stats query error: ${err.message}`);
                return;
            }
            results.stats = stats;

            // Get pending jobs by type
            db.all(`
                SELECT 
                    type,
                    COUNT(*) as count,
                    MIN(createdAt) as oldest_job,
                    MAX(createdAt) as newest_job
                FROM jobs 
                WHERE status = 'pending'
                GROUP BY type
                ORDER BY count DESC
            `, (err, pendingByType) => {
                if (err) {
                    reject(`Pending by type query error: ${err.message}`);
                    return;
                }
                results.pendingByType = pendingByType;

                // Get sample of recent pending jobs
                db.all(`
                    SELECT 
                        jobId, type, createdAt, payload
                    FROM jobs 
                    WHERE status = 'pending'
                    ORDER BY createdAt DESC
                    LIMIT 10
                `, (err, recentPending) => {
                    if (err) {
                        reject(`Recent pending query error: ${err.message}`);
                        return;
                    }
                    results.recentPending = recentPending;

                    // Check for test jobs (URLs containing example.com)
                    db.all(`
                        SELECT 
                            type,
                            COUNT(*) as count
                        FROM jobs 
                        WHERE status = 'pending' 
                        AND (payload LIKE '%example.com%' OR payload LIKE '%test%')
                        GROUP BY type
                    `, (err, testJobs) => {
                        if (err) {
                            reject(`Test jobs query error: ${err.message}`);
                            return;
                        }
                        results.testJobs = testJobs;

                        // Get job age distribution
                        db.all(`
                            SELECT 
                                type,
                                CASE 
                                    WHEN (strftime('%s', 'now') - createdAt) < 3600 THEN 'last_hour'
                                    WHEN (strftime('%s', 'now') - createdAt) < 86400 THEN 'last_day'
                                    WHEN (strftime('%s', 'now') - createdAt) < 604800 THEN 'last_week'
                                    ELSE 'older_than_week'
                                END as age_group,
                                COUNT(*) as count
                            FROM jobs 
                            WHERE status = 'pending'
                            GROUP BY type, age_group
                            ORDER BY type, age_group
                        `, (err, ageDistribution) => {
                            if (err) {
                                reject(`Age distribution query error: ${err.message}`);
                                return;
                            }
                            results.ageDistribution = ageDistribution;

                            db.close();
                            resolve(results);
                        });
                    });
                });
            });
        });
    });
}

function formatResults(results) {
    console.log('📊 IC Mesh Job Queue Analysis');
    console.log('================================\n');

    // Overall statistics
    console.log('📈 Overall Statistics:');
    console.log(`   Total jobs: ${results.stats.total_jobs}`);
    console.log(`   Pending: ${results.stats.pending_jobs}`);
    console.log(`   Claimed: ${results.stats.claimed_jobs}`);
    console.log(`   Completed: ${results.stats.completed_jobs}`);
    console.log(`   Failed: ${results.stats.failed_jobs}\n`);

    // Pending jobs by type
    if (results.pendingByType.length > 0) {
        console.log('📋 Pending Jobs by Type:');
        results.pendingByType.forEach(item => {
            const oldestDate = new Date(item.oldest_job * 1000).toISOString().slice(0, 19);
            const newestDate = new Date(item.newest_job * 1000).toISOString().slice(0, 19);
            console.log(`   ${item.type}: ${item.count} jobs (${oldestDate} → ${newestDate})`);
        });
        console.log();
    }

    // Test job pollution
    if (results.testJobs.length > 0) {
        console.log('🧪 Test Job Pollution Detected:');
        results.testJobs.forEach(item => {
            console.log(`   ${item.type}: ${item.count} test jobs`);
        });
        console.log('   ⚠️  Consider running cleanup-test-jobs.js\n');
    }

    // Age distribution
    if (results.ageDistribution.length > 0) {
        console.log('⏰ Job Age Distribution:');
        const ageGroups = {};
        results.ageDistribution.forEach(item => {
            if (!ageGroups[item.type]) ageGroups[item.type] = {};
            ageGroups[item.type][item.age_group] = item.count;
        });
        
        Object.keys(ageGroups).forEach(type => {
            console.log(`   ${type}:`);
            const ages = ageGroups[type];
            if (ages.last_hour) console.log(`      Last hour: ${ages.last_hour}`);
            if (ages.last_day) console.log(`      Last day: ${ages.last_day}`);
            if (ages.last_week) console.log(`      Last week: ${ages.last_week}`);
            if (ages.older_than_week) console.log(`      Older than week: ${ages.older_than_week}`);
        });
        console.log();
    }

    // Recent pending jobs sample
    if (results.recentPending.length > 0) {
        console.log('🔍 Recent Pending Jobs (sample):');
        results.recentPending.forEach((job, idx) => {
            const date = new Date(job.createdAt * 1000).toISOString().slice(0, 19);
            const payloadPreview = job.payload ? job.payload.substring(0, 60) : 'No payload';
            console.log(`   ${idx + 1}. ${job.type} (${date}) - ${payloadPreview}...`);
        });
        console.log();
    }

    // Operational recommendations
    console.log('💡 Operational Recommendations:');
    if (results.stats.pending_jobs === 0) {
        console.log('   ✅ Queue is clean - all jobs processed');
    } else {
        console.log(`   📋 ${results.stats.pending_jobs} jobs awaiting processing`);
        
        // Check for stuck jobs
        const hasOldJobs = results.ageDistribution.some(item => item.age_group === 'older_than_week');
        if (hasOldJobs) {
            console.log('   ⚠️  Old jobs detected - consider investigating stuck jobs');
        }
        
        // Check for capability gaps
        const needsTranscription = results.pendingByType.some(item => 
            item.type === 'transcribe' || item.type === 'transcription'
        );
        const needsOCR = results.pendingByType.some(item => 
            item.type === 'ocr' || item.type === 'pdf-extract'
        );
        
        if (needsTranscription) {
            console.log('   🎵 Transcription jobs pending - need nodes with whisper/transcribe capability');
        }
        if (needsOCR) {
            console.log('   🔍 OCR/PDF jobs pending - need nodes with tesseract capability');
        }
        
        // Test pollution check
        if (results.testJobs.length > 0) {
            const testCount = results.testJobs.reduce((sum, item) => sum + item.count, 0);
            console.log(`   🧪 ${testCount} test jobs found - run cleanup for accurate metrics`);
        }
    }
}

// Run the analysis
if (require.main === module) {
    analyzeJobQueue()
        .then(formatResults)
        .catch(error => {
            console.error('❌ Analysis failed:', error);
            process.exit(1);
        });
}

module.exports = { analyzeJobQueue };