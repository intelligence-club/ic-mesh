#!/usr/bin/env node

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Customer satisfaction tracking dashboard
function generateCustomerSatisfactionReport() {
    const db = new sqlite3.Database(path.join(__dirname, 'data/mesh.db'));
    
    // Get overall service metrics for last 24 hours
    const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
    
    db.all(`
        SELECT 
            type,
            COUNT(*) as total_jobs,
            AVG(CASE WHEN status = 'completed' THEN 1.0 ELSE 0.0 END) as success_rate,
            AVG(CASE WHEN status = 'completed' AND computeMs > 0 THEN computeMs/1000.0 END) as avg_processing_time,
            COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
            COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
            COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending
        FROM jobs 
        WHERE createdAt > ?
        GROUP BY type
        ORDER BY total_jobs DESC
    `, [oneDayAgo], (err, serviceMetrics) => {
        if (err) {
            console.error('❌ Database error:', err);
            db.close();
            return;
        }

        // Get processing time distribution for transcription jobs (most common)
        db.all(`
            SELECT 
                CASE 
                    WHEN computeMs/1000 <= 10 THEN '≤10s'
                    WHEN computeMs/1000 <= 30 THEN '11-30s'
                    WHEN computeMs/1000 <= 60 THEN '31-60s'
                    WHEN computeMs/1000 <= 120 THEN '1-2min'
                    ELSE '>2min'
                END as time_bucket,
                COUNT(*) as count
            FROM jobs 
            WHERE type = 'transcribe' 
              AND status = 'completed' 
              AND computeMs > 0 
              AND createdAt > ?
            GROUP BY time_bucket
            ORDER BY count DESC
        `, [oneDayAgo], (err, timeDistribution) => {
            if (err) {
                console.error('❌ Database error:', err);
                db.close();
                return;
            }

            // Get current queue wait times (time since job creation for pending jobs)
            db.all(`
                SELECT 
                    type,
                    AVG((strftime('%s', 'now') * 1000 - createdAt) / 1000 / 60) as avg_wait_minutes,
                    MAX((strftime('%s', 'now') * 1000 - createdAt) / 1000 / 60) as max_wait_minutes,
                    COUNT(*) as waiting_jobs
                FROM jobs 
                WHERE status = 'pending'
                GROUP BY type
                ORDER BY avg_wait_minutes DESC
            `, [], (err, queueTimes) => {
                if (err) {
                    console.error('❌ Database error:', err);
                    db.close();
                    return;
                }

                console.log('👥 CUSTOMER SATISFACTION DASHBOARD');
                console.log('════════════════════════════════════════════════════');
                console.log('📊 SERVICE PERFORMANCE (Last 24h)');
                console.log('════════════════════════════════════════════════════');
                
                serviceMetrics.forEach(service => {
                    const successPercent = (service.success_rate * 100).toFixed(1);
                    const avgTime = service.avg_processing_time ? service.avg_processing_time.toFixed(1) : 'N/A';
                    
                    console.log(`\n🎯 ${service.type.toUpperCase()} Service:`);
                    console.log(`   Success Rate: ${successPercent}% (${service.completed}/${service.total_jobs})`);
                    console.log(`   Avg Processing: ${avgTime}s`);
                    console.log(`   Queue: ${service.pending} pending, ${service.failed} failed`);
                    
                    // Service health indicator
                    if (service.success_rate >= 0.95) console.log('   Status: 🟢 EXCELLENT');
                    else if (service.success_rate >= 0.8) console.log('   Status: 🟡 GOOD');
                    else if (service.success_rate >= 0.5) console.log('   Status: 🟠 DEGRADED');
                    else console.log('   Status: 🔴 POOR');
                });

                if (timeDistribution.length > 0) {
                    console.log('\n⏱️  TRANSCRIPTION SPEED DISTRIBUTION (Last 24h)');
                    console.log('════════════════════════════════════════════════════');
                    timeDistribution.forEach(bucket => {
                        const bar = '█'.repeat(Math.ceil(bucket.count / 2));
                        console.log(`   ${bucket.time_bucket.padEnd(8)}: ${bucket.count.toString().padStart(3)} jobs ${bar}`);
                    });
                }

                if (queueTimes.length > 0) {
                    console.log('\n⏳ CURRENT QUEUE WAIT TIMES');
                    console.log('════════════════════════════════════════════════════');
                    queueTimes.forEach(queue => {
                        const avgWait = queue.avg_wait_minutes.toFixed(1);
                        const maxWait = queue.max_wait_minutes.toFixed(1);
                        
                        console.log(`   ${queue.type.toUpperCase()}: ${queue.waiting_jobs} jobs waiting`);
                        console.log(`   Average wait: ${avgWait}min | Longest wait: ${maxWait}min`);
                        
                        // Wait time assessment
                        if (queue.avg_wait_minutes < 5) console.log('   Wait Status: 🟢 FAST');
                        else if (queue.avg_wait_minutes < 30) console.log('   Wait Status: 🟡 ACCEPTABLE');
                        else if (queue.avg_wait_minutes < 120) console.log('   Wait Status: 🟠 SLOW');
                        else console.log('   Wait Status: 🔴 VERY SLOW');
                    });
                } else {
                    console.log('\n⏳ CURRENT QUEUE: 🟢 Empty - No customer wait times!');
                }

                // Overall customer satisfaction score
                const overallSuccessRate = serviceMetrics.reduce((sum, s) => sum + s.success_rate * s.total_jobs, 0) / 
                                         serviceMetrics.reduce((sum, s) => sum + s.total_jobs, 0);
                const avgWaitTime = queueTimes.reduce((sum, q) => sum + q.avg_wait_minutes * q.waiting_jobs, 0) /
                                  queueTimes.reduce((sum, q) => sum + q.waiting_jobs, 0) || 0;

                console.log('\n🏆 OVERALL CUSTOMER SATISFACTION SCORE');
                console.log('════════════════════════════════════════════════════');
                
                let satisfactionScore = 100;
                satisfactionScore *= overallSuccessRate; // Reduce by failure rate
                if (avgWaitTime > 60) satisfactionScore *= 0.8; // Penalize long waits
                if (avgWaitTime > 120) satisfactionScore *= 0.6;
                
                console.log(`   Score: ${satisfactionScore.toFixed(0)}/100`);
                if (satisfactionScore >= 90) console.log('   Rating: 🟢 EXCELLENT - Customers very happy!');
                else if (satisfactionScore >= 75) console.log('   Rating: 🟡 GOOD - Customers mostly satisfied');
                else if (satisfactionScore >= 50) console.log('   Rating: 🟠 FAIR - Room for improvement');
                else console.log('   Rating: 🔴 POOR - Customer satisfaction at risk');

                db.close();
            });
        });
    });
}

// Run the dashboard
generateCustomerSatisfactionReport();