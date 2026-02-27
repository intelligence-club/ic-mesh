#!/usr/bin/env node

/**
 * Node Retention Analysis - Deep Dive into Connection Patterns
 * 
 * Analyzes why nodes disconnect and identifies retention improvement opportunities.
 */

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

class NodeRetentionAnalyzer {
    constructor() {
        this.dbPath = './data/mesh.db';
    }

    async init() {
        return new Promise((resolve, reject) => {
            this.db = new sqlite3.Database(this.dbPath, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    async analyzeConnectionPatterns() {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    nodeId,
                    name,
                    owner,
                    registeredAt,
                    lastSeen,
                    datetime(registeredAt/1000, 'unixepoch') as registered_time,
                    datetime(lastSeen/1000, 'unixepoch') as last_active_time,
                    CAST((lastSeen - registeredAt) / 1000.0 / 60 AS INTEGER) as total_active_minutes,
                    CAST((julianday('now') - julianday(datetime(lastSeen/1000, 'unixepoch'))) * 1440 AS INTEGER) as minutes_offline,
                    capabilities,
                    jobsCompleted,
                    computeMinutes
                FROM nodes 
                ORDER BY lastSeen DESC
            `;
            
            this.db.all(query, (err, nodes) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(nodes);
                }
            });
        });
    }

    async analyzeJobHistory(nodeId) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    jobId,
                    status,
                    type,
                    createdAt,
                    claimedAt,
                    completedAt,
                    datetime(createdAt/1000, 'unixepoch') as created_time,
                    datetime(claimedAt/1000, 'unixepoch') as claimed_time,
                    datetime(completedAt/1000, 'unixepoch') as completed_time,
                    CASE 
                        WHEN completedAt IS NOT NULL THEN (completedAt - claimedAt) / 1000.0 / 60
                        ELSE NULL 
                    END as processing_minutes
                FROM jobs 
                WHERE claimedBy = ?
                ORDER BY claimedAt DESC
                LIMIT 20
            `;
            
            this.db.all(query, [nodeId], (err, jobs) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(jobs);
                }
            });
        });
    }

    categorizeRetentionPattern(node) {
        const totalActiveMinutes = node.total_active_minutes;
        const minutesOffline = node.minutes_offline;
        const jobsCompleted = node.jobsCompleted;

        if (totalActiveMinutes < 5) {
            return 'immediate_disconnect'; // Connected and left within 5 minutes
        } else if (totalActiveMinutes < 60) {
            return 'short_session'; // Less than 1 hour of activity
        } else if (totalActiveMinutes < 1440) {
            return 'single_session'; // Less than 1 day, single work session
        } else if (minutesOffline < 60 && totalActiveMinutes > 60) {
            return 'recent_disconnect'; // Recently disconnected, was active
        } else if (minutesOffline < 1440) {
            return 'daily_churn'; // Disconnected within last day
        } else {
            return 'long_term_churn'; // Gone for days/weeks
        }
    }

    async generateRetentionReport(nodes) {
        console.log('🔍 NODE RETENTION ANALYSIS');
        console.log('════════════════════════════════════════\n');

        const patterns = {};
        const detailedAnalysis = [];

        for (let node of nodes) {
            const pattern = this.categorizeRetentionPattern(node);
            if (!patterns[pattern]) patterns[pattern] = [];
            patterns[pattern].push(node);

            // Get job history for detailed analysis
            const jobHistory = await this.analyzeJobHistory(node.nodeId);
            
            detailedAnalysis.push({
                ...node,
                pattern,
                jobHistory,
                avgJobDuration: this.calculateAvgJobDuration(jobHistory),
                lastJobTime: jobHistory.length > 0 ? jobHistory[0].claimed_time : null
            });
        }

        // Display pattern summary
        console.log('📊 RETENTION PATTERNS');
        console.log('────────────────────────────────────────');
        Object.entries(patterns).forEach(([pattern, nodeList]) => {
            console.log(`${pattern.replace('_', ' ').toUpperCase()}: ${nodeList.length} nodes`);
        });
        console.log();

        // Detailed analysis for each pattern
        Object.entries(patterns).forEach(([pattern, nodeList]) => {
            console.log(`\n🔍 ${pattern.replace('_', ' ').toUpperCase()} NODES (${nodeList.length})`);
            console.log('─'.repeat(50));

            nodeList.forEach(node => {
                const detail = detailedAnalysis.find(d => d.nodeId === node.nodeId);
                console.log(`\n📱 ${node.name || node.nodeId.substring(0, 8)} (${node.owner})`);
                console.log(`   Registered: ${node.registered_time}`);
                console.log(`   Last active: ${node.last_active_time}`);
                console.log(`   Total active: ${node.total_active_minutes} minutes`);
                console.log(`   Offline for: ${node.minutes_offline} minutes`);
                console.log(`   Jobs completed: ${node.jobsCompleted}`);
                console.log(`   Capabilities: ${node.capabilities || '[]'}`);
                
                if (detail.jobHistory.length > 0) {
                    console.log(`   Last job: ${detail.lastJobTime}`);
                    console.log(`   Avg job duration: ${detail.avgJobDuration?.toFixed(1) || 'N/A'} min`);
                }
            });
        });

        // Generate retention insights
        console.log('\n\n💡 RETENTION INSIGHTS');
        console.log('════════════════════════════════════════');

        this.generateRetentionInsights(patterns, detailedAnalysis);

        // Actionable recommendations
        console.log('\n🎯 RETENTION IMPROVEMENT RECOMMENDATIONS');
        console.log('════════════════════════════════════════');
        this.generateRetentionRecommendations(patterns, detailedAnalysis);

        return { patterns, detailedAnalysis };
    }

    calculateAvgJobDuration(jobHistory) {
        const completedJobs = jobHistory.filter(job => job.processing_minutes !== null);
        if (completedJobs.length === 0) return null;
        
        const totalMinutes = completedJobs.reduce((sum, job) => sum + job.processing_minutes, 0);
        return totalMinutes / completedJobs.length;
    }

    generateRetentionInsights(patterns, analysis) {
        const totalNodes = analysis.length;
        
        // Immediate disconnect analysis
        if (patterns.immediate_disconnect) {
            const count = patterns.immediate_disconnect.length;
            const percentage = (count / totalNodes * 100).toFixed(1);
            console.log(`⚠️  ${percentage}% of nodes (${count}/${totalNodes}) disconnect immediately after connecting`);
            console.log(`   This suggests onboarding friction or technical issues`);
        }

        // Short session analysis
        if (patterns.short_session) {
            const count = patterns.short_session.length;
            const percentage = (count / totalNodes * 100).toFixed(1);
            console.log(`⏱️  ${percentage}% of nodes (${count}/${totalNodes}) disconnect within 1 hour`);
            console.log(`   This indicates either testing behavior or setup problems`);
        }

        // Success pattern analysis
        const successfulNodes = analysis.filter(n => n.jobsCompleted > 0);
        if (successfulNodes.length > 0) {
            const avgJobs = (successfulNodes.reduce((sum, n) => sum + n.jobsCompleted, 0) / successfulNodes.length).toFixed(1);
            const avgActiveTime = (successfulNodes.reduce((sum, n) => sum + n.total_active_minutes, 0) / successfulNodes.length).toFixed(0);
            console.log(`✅ ${successfulNodes.length} nodes successfully completed jobs`);
            console.log(`   Average: ${avgJobs} jobs, ${avgActiveTime} minutes active`);
        }

        // Owner analysis
        const ownerStats = {};
        analysis.forEach(node => {
            if (!ownerStats[node.owner]) ownerStats[node.owner] = { total: 0, successful: 0 };
            ownerStats[node.owner].total++;
            if (node.jobsCompleted > 0) ownerStats[node.owner].successful++;
        });

        console.log(`\n👥 Owner retention rates:`);
        Object.entries(ownerStats).forEach(([owner, stats]) => {
            const rate = (stats.successful / stats.total * 100).toFixed(1);
            console.log(`   ${owner}: ${stats.successful}/${stats.total} nodes successful (${rate}%)`);
        });
    }

    generateRetentionRecommendations(patterns, analysis) {
        // Immediate disconnect solutions
        if (patterns.immediate_disconnect && patterns.immediate_disconnect.length > 0) {
            console.log(`1. 🚨 Address immediate disconnect problem (${patterns.immediate_disconnect.length} nodes)`);
            console.log(`   • Improve onboarding documentation`);
            console.log(`   • Add connection troubleshooting guide`);
            console.log(`   • Implement connection health checks`);
            console.log(`   • Consider automated welcome messages`);
        }

        // Recent disconnect recovery
        if (patterns.recent_disconnect && patterns.recent_disconnect.length > 0) {
            console.log(`\n2. 🔄 Immediate revival opportunity (${patterns.recent_disconnect.length} nodes)`);
            console.log(`   • Send reconnection reminders to recently disconnected nodes`);
            console.log(`   • Offer technical support for connection issues`);
            console.log(`   • Highlight current network earnings opportunity`);
        }

        // Long-term engagement
        const productiveNodes = analysis.filter(n => n.jobsCompleted >= 3);
        if (productiveNodes.length > 0) {
            console.log(`\n3. 💪 Leverage successful operators (${productiveNodes.length} nodes)`);
            console.log(`   • Request testimonials from high-performing nodes`);
            console.log(`   • Invite them to test new features`);
            console.log(`   • Ask for referrals to other potential operators`);
        }

        // Technical improvements
        console.log(`\n4. 🔧 Technical retention improvements`);
        console.log(`   • Implement automatic reconnection logic`);
        console.log(`   • Add "connection lost" notifications`);
        console.log(`   • Create health monitoring dashboard for operators`);
        console.log(`   • Implement gradual job ramping for new nodes`);

        // Incentive improvements  
        console.log(`\n5. 💰 Economic retention improvements`);
        console.log(`   • Implement node operator rewards program`);
        console.log(`   • Add performance bonuses for reliable nodes`);
        console.log(`   • Create network health contribution incentives`);
        console.log(`   • Offer operator-exclusive features/access`);
    }

    close() {
        if (this.db) {
            this.db.close();
        }
    }
}

// CLI execution
async function main() {
    const analyzer = new NodeRetentionAnalyzer();
    
    try {
        await analyzer.init();
        const nodes = await analyzer.analyzeConnectionPatterns();
        await analyzer.generateRetentionReport(nodes);
    } catch (error) {
        console.error('❌ Error running retention analysis:', error.message);
        process.exit(1);
    } finally {
        analyzer.close();
    }
}

if (require.main === module) {
    main();
}

module.exports = NodeRetentionAnalyzer;