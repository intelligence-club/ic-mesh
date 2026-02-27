#!/usr/bin/env node

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'mesh.db');

class JobProcessingMonitor {
    constructor() {
        this.db = new Database(DB_PATH);
        
        // Prepare statements for efficiency
        this.statements = {
            jobsByStatus: this.db.prepare(`
                SELECT status, type, COUNT(*) as count, AVG(creditAmount) as avg_credits
                FROM jobs 
                GROUP BY status, type 
                ORDER BY status, type
            `),
            
            claimedJobs: this.db.prepare(`
                SELECT 
                    j.jobId, j.type, j.claimedBy, n.name as nodeName,
                    ROUND((? - j.claimedAt) / 1000 / 60, 1) as minutes_claimed,
                    j.creditAmount
                FROM jobs j
                LEFT JOIN nodes n ON j.claimedBy = n.nodeId
                WHERE j.status = 'claimed'
                ORDER BY j.claimedAt DESC
            `),
            
            recentCompletions: this.db.prepare(`
                SELECT 
                    j.jobId, j.type, j.claimedBy, n.name as nodeName,
                    ROUND((j.completedAt - j.claimedAt) / 1000 / 60, 1) as processing_minutes,
                    j.creditAmount,
                    datetime(j.completedAt / 1000, 'unixepoch') as completed_time
                FROM jobs j
                LEFT JOIN nodes n ON j.claimedBy = n.nodeId
                WHERE j.status = 'completed' AND j.completedAt > ? 
                ORDER BY j.completedAt DESC
                LIMIT 10
            `),
            
            nodeCapacityAnalysis: this.db.prepare(`
                SELECT 
                    n.nodeId, n.name, n.capabilities,
                    n.jobsCompleted,
                    ROUND((? - n.lastSeen) / 1000 / 60, 1) as minutes_ago,
                    COUNT(cj.jobId) as currently_processing
                FROM nodes n
                LEFT JOIN jobs cj ON n.nodeId = cj.claimedBy AND cj.status = 'claimed'
                GROUP BY n.nodeId, n.name, n.capabilities, n.jobsCompleted, n.lastSeen
                ORDER BY minutes_ago ASC
            `),
            
            jobBacklogAnalysis: this.db.prepare(`
                SELECT 
                    j.type,
                    JSON_EXTRACT(j.requirements, '$.capability') as required_capability,
                    COUNT(*) as pending_count,
                    AVG(j.creditAmount) as avg_value,
                    ROUND((? - MIN(j.createdAt)) / 1000 / 60, 1) as oldest_pending_minutes
                FROM jobs j
                WHERE j.status = 'pending'
                GROUP BY j.type, JSON_EXTRACT(j.requirements, '$.capability')
                ORDER BY pending_count DESC
            `),
            
            processingRateAnalysis: this.db.prepare(`
                SELECT 
                    ROUND((? - j.createdAt) / 1000 / 3600, 1) as hours_ago,
                    COUNT(*) as jobs_completed
                FROM jobs j
                WHERE j.status = 'completed' AND j.completedAt > ?
                GROUP BY ROUND((? - j.createdAt) / 1000 / 3600, 1)
                ORDER BY hours_ago ASC
            `),

            capabilityGapAnalysis: this.db.prepare(`
                WITH required_caps AS (
                    SELECT 
                        JSON_EXTRACT(requirements, '$.capability') as capability,
                        COUNT(*) as pending_jobs
                    FROM jobs 
                    WHERE status = 'pending' 
                    GROUP BY JSON_EXTRACT(requirements, '$.capability')
                ),
                available_caps AS (
                    SELECT DISTINCT 
                        REPLACE(REPLACE(value, '[', ''), ']', '') as capability
                    FROM nodes n,
                    JSON_EACH(n.capabilities) 
                    WHERE (strftime('%s', 'now') * 1000 - n.lastSeen) < 300000  -- Active in last 5min
                )
                SELECT 
                    rc.capability,
                    rc.pending_jobs,
                    CASE WHEN ac.capability IS NOT NULL THEN 'Available' ELSE 'MISSING' END as status
                FROM required_caps rc
                LEFT JOIN available_caps ac ON rc.capability = ac.capability
                ORDER BY rc.pending_jobs DESC
            `)
        };
    }

    async analyzeProcessingPipeline() {
        const now = Date.now();
        const oneHourAgo = now - (60 * 60 * 1000);
        
        console.log('🔍 IC Mesh Job Processing Pipeline Analysis');
        console.log('═'.repeat(60));
        console.log(`📅 Analysis time: ${new Date().toISOString()}`);
        console.log('');

        // Overall job status breakdown
        console.log('📊 Job Status Overview:');
        const jobsByStatus = this.statements.jobsByStatus.all();
        for (const row of jobsByStatus) {
            const credits = row.avg_credits ? row.avg_credits.toFixed(2) : '0.00';
            console.log(`   ${row.status.padEnd(10)} ${row.type.padEnd(12)} ${String(row.count).padStart(3)} jobs (avg: ${credits} credits)`);
        }
        console.log('');

        // Currently claimed/processing jobs
        console.log('⚡ Currently Processing:');
        const claimedJobs = this.statements.claimedJobs.all(now);
        if (claimedJobs.length === 0) {
            console.log('   No jobs currently being processed');
        } else {
            for (const job of claimedJobs) {
                const nodeName = job.nodeName || 'unnamed';
                console.log(`   ${job.type} → ${nodeName} (${job.minutes_claimed}m ago) [${job.creditAmount} credits]`);
            }
        }
        console.log('');

        // Recent completions
        console.log('✅ Recent Completions (last hour):');
        const recentCompletions = this.statements.recentCompletions.all(oneHourAgo);
        if (recentCompletions.length === 0) {
            console.log('   No jobs completed in the last hour');
        } else {
            for (const job of recentCompletions) {
                const nodeName = job.nodeName || 'unnamed';
                console.log(`   ${job.type} → ${nodeName} (${job.processing_minutes}m) [${job.creditAmount} credits] @ ${job.completed_time}`);
            }
        }
        console.log('');

        // Node capacity analysis
        console.log('🖥️ Node Capacity Analysis:');
        const nodeCapacity = this.statements.nodeCapacityAnalysis.all(now);
        for (const node of nodeCapacity) {
            const nodeName = node.name || 'unnamed';
            const isActive = node.minutes_ago < 5;
            const status = isActive ? '🟢 ACTIVE' : `⚪ offline ${node.minutes_ago}m`;
            const capabilities = JSON.parse(node.capabilities || '[]').join(', ');
            console.log(`   ${nodeName.padEnd(15)} ${status.padEnd(15)} ${String(node.jobsCompleted).padStart(3)} jobs done, ${node.currently_processing} processing`);
            console.log(`   ${''.padEnd(15)} Capabilities: ${capabilities}`);
        }
        console.log('');

        // Job backlog analysis
        console.log('📋 Backlog Analysis:');
        const backlogAnalysis = this.statements.jobBacklogAnalysis.all(now);
        if (backlogAnalysis.length === 0) {
            console.log('   No pending jobs - queue is clear! 🎉');
        } else {
            for (const row of backlogAnalysis) {
                const capability = row.required_capability || 'unknown';
                const value = row.avg_value ? row.avg_value.toFixed(2) : '0.00';
                console.log(`   ${row.type.padEnd(12)} needs ${capability.padEnd(15)} ${String(row.pending_count).padStart(3)} jobs (oldest: ${row.oldest_pending_minutes}m, avg: ${value} credits)`);
            }
        }
        console.log('');

        // Capability gap analysis
        console.log('🔧 Capability Gap Analysis:');
        const capabilityGaps = this.statements.capabilityGapAnalysis.all();
        if (capabilityGaps.length === 0) {
            console.log('   No pending jobs require capabilities');
        } else {
            for (const gap of capabilityGaps) {
                const statusIcon = gap.status === 'Available' ? '✅' : '❌';
                console.log(`   ${statusIcon} ${gap.capability.padEnd(20)} ${String(gap.pending_jobs).padStart(3)} jobs ${gap.status}`);
            }
        }
        console.log('');

        // Processing rate analysis
        console.log('📈 Processing Rate (last 6 hours):');
        const sixHoursAgo = now - (6 * 60 * 60 * 1000);
        const processingRates = this.statements.processingRateAnalysis.all(now, sixHoursAgo, now);
        if (processingRates.length === 0) {
            console.log('   No jobs completed in the last 6 hours');
        } else {
            for (const rate of processingRates) {
                const hoursAgoText = rate.hours_ago === 0 ? 'Last hour' : `${rate.hours_ago}h ago`;
                console.log(`   ${hoursAgoText.padEnd(15)} ${rate.jobs_completed} jobs completed`);
            }
        }
        console.log('');

        // Generate recommendations
        this.generateRecommendations(claimedJobs, backlogAnalysis, capabilityGaps, nodeCapacity);
    }

    generateRecommendations(claimedJobs, backlogAnalysis, capabilityGaps, nodeCapacity) {
        console.log('💡 Recommendations:');
        
        const activeNodes = nodeCapacity.filter(n => n.minutes_ago < 5);
        const pendingJobs = backlogAnalysis.reduce((sum, b) => sum + b.pending_count, 0);
        
        if (pendingJobs === 0) {
            console.log('   🎉 Queue is healthy - no pending jobs!');
            console.log('   🔄 System ready for new work');
            return;
        }

        if (activeNodes.length === 0) {
            console.log('   🚨 CRITICAL: No active nodes - complete service outage');
            console.log('   📞 Contact node operators immediately');
            console.log('   🔌 Check node connectivity and restart processes');
            return;
        }

        if (activeNodes.length === 1) {
            console.log('   ⚠️  Single point of failure - only 1 active node');
            console.log('   📈 Consider adding backup nodes for reliability');
        }

        // Check for stuck jobs
        const stuckJobs = claimedJobs.filter(j => j.minutes_claimed > 10);
        if (stuckJobs.length > 0) {
            console.log('   ⏰ Stuck jobs detected (claimed >10min):');
            for (const job of stuckJobs) {
                console.log(`      - ${job.type} claimed by ${job.nodeName || 'unnamed'} ${job.minutes_claimed}m ago`);
            }
            console.log('   🔧 Consider resetting stuck jobs or restarting nodes');
        }

        // Check for capability gaps
        const missingCapabilities = capabilityGaps.filter(g => g.status === 'MISSING');
        if (missingCapabilities.length > 0) {
            console.log('   📋 Missing capabilities blocking jobs:');
            for (const missing of missingCapabilities) {
                console.log(`      - ${missing.capability}: ${missing.pending_jobs} jobs blocked`);
            }
            console.log('   🚀 Deploy nodes with missing capabilities');
        }

        // Check processing speed
        const totalProcessing = claimedJobs.length;
        const processingCapacity = activeNodes.reduce((sum, n) => sum + (n.currently_processing || 0), 0);
        
        if (pendingJobs > 20 && totalProcessing === 0) {
            console.log('   🐌 Processing appears stalled - no jobs being claimed');
            console.log('   🔍 Check node logs and server connectivity');
        }

        if (pendingJobs > processingCapacity * 10) {
            console.log(`   📊 High backlog ratio: ${pendingJobs} pending, ${processingCapacity} processing`);
            console.log('   ⚡ Consider scaling up processing capacity');
        }

        console.log('');
    }

    close() {
        this.db.close();
    }
}

// CLI mode
if (require.main === module) {
    const monitor = new JobProcessingMonitor();
    
    monitor.analyzeProcessingPipeline()
        .then(() => {
            monitor.close();
        })
        .catch(err => {
            console.error('❌ Analysis failed:', err);
            monitor.close();
            process.exit(1);
        });
}

module.exports = JobProcessingMonitor;