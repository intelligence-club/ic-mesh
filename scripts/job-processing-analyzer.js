#!/usr/bin/env node
/**
 * Job Processing Analyzer
 * 
 * Investigates why active nodes aren't processing pending jobs
 * Identifies capability mismatches, quarantines, and processing bottlenecks
 */

const sqlite3 = require('sqlite3').verbose();

class JobProcessingAnalyzer {
    constructor() {
        this.db = null;
    }

    async init() {
        console.log('🔍 Job Processing Analyzer');
        console.log('==========================');
        console.log(`Started: ${new Date().toISOString()}\n`);

        this.db = new sqlite3.Database('data/mesh.db', (err) => {
            if (err) {
                console.error('❌ Database connection failed:', err.message);
                process.exit(1);
            }
        });

        await this.analyze();
    }

    async analyze() {
        const summary = await this.getSystemSummary();
        const nodeDetails = await this.getNodeDetails();
        const jobDetails = await this.getJobDetails();
        const capabilityGaps = await this.analyzeCapabilityGaps(nodeDetails, jobDetails);
        const quarantineStatus = await this.checkQuarantineStatus();

        this.displaySummary(summary);
        this.displayNodeDetails(nodeDetails);
        this.displayJobDetails(jobDetails);
        this.displayCapabilityGaps(capabilityGaps);
        this.displayQuarantineStatus(quarantineStatus);
        this.generateRecommendations(summary, nodeDetails, jobDetails, capabilityGaps, quarantineStatus);
    }

    async getSystemSummary() {
        return new Promise((resolve, reject) => {
            this.db.get(`
                SELECT 
                    (SELECT COUNT(*) FROM jobs WHERE status = 'pending') as pendingJobs,
                    (SELECT COUNT(*) FROM jobs WHERE status = 'claimed') as claimedJobs,
                    (SELECT COUNT(*) FROM jobs WHERE status = 'completed') as completedJobs,
                    (SELECT COUNT(*) FROM jobs WHERE status = 'failed') as failedJobs,
                    (SELECT COUNT(*) FROM nodes) as totalNodes,
                    (SELECT COUNT(*) FROM nodes WHERE lastSeen > strftime('%s', 'now') - 300) as activeNodes
            `, (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    async getNodeDetails() {
        return new Promise((resolve, reject) => {
            this.db.all(`
                SELECT 
                    nodeId,
                    capabilities,
                    lastSeen,
                    flags,
                    (SELECT COUNT(*) FROM jobs WHERE claimedBy = nodes.nodeId AND status = 'completed') as completedJobs,
                    (SELECT COUNT(*) FROM jobs WHERE claimedBy = nodes.nodeId AND status = 'failed') as failedJobs,
                    (SELECT COUNT(*) FROM jobs WHERE claimedBy = nodes.nodeId AND status = 'claimed') as currentJobs,
                    CASE 
                        WHEN lastSeen > strftime('%s', 'now') - 300 THEN 'active'
                        WHEN lastSeen > strftime('%s', 'now') - 3600 THEN 'recent' 
                        ELSE 'inactive'
                    END as status
                FROM nodes
                ORDER BY lastSeen DESC
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    async getJobDetails() {
        return new Promise((resolve, reject) => {
            this.db.all(`
                SELECT 
                    type,
                    COUNT(*) as count,
                    MIN(createdAt) as oldestTimestamp,
                    MAX(createdAt) as newestTimestamp
                FROM jobs 
                WHERE status = 'pending'
                GROUP BY type
                ORDER BY count DESC
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    async analyzeCapabilityGaps(nodeDetails, jobDetails) {
        const activeNodes = nodeDetails.filter(node => node.status === 'active');
        const activeCapabilities = new Set();
        
        activeNodes.forEach(node => {
            try {
                const caps = JSON.parse(node.capabilities || '[]');
                caps.forEach(cap => activeCapabilities.add(cap));
            } catch (e) {
                // Skip nodes with invalid JSON capabilities
            }
        });

        const gaps = [];
        jobDetails.forEach(job => {
            if (!activeCapabilities.has(job.type)) {
                gaps.push({
                    jobType: job.type,
                    count: job.count,
                    hasCapability: false
                });
            } else {
                gaps.push({
                    jobType: job.type,
                    count: job.count,
                    hasCapability: true
                });
            }
        });

        return gaps;
    }

    async checkQuarantineStatus() {
        return new Promise((resolve, reject) => {
            this.db.all(`
                SELECT 
                    nodeId,
                    flags,
                    (SELECT COUNT(*) FROM jobs WHERE claimedBy = nodes.nodeId AND status = 'completed') as completedJobs,
                    (SELECT COUNT(*) FROM jobs WHERE claimedBy = nodes.nodeId AND status = 'failed') as failedJobs
                FROM nodes
                WHERE flags IS NOT NULL AND flags != '{}'
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    displaySummary(summary) {
        console.log('📊 SYSTEM SUMMARY');
        console.log('─────────────────');
        console.log(`Jobs: ${summary.pendingJobs} pending, ${summary.claimedJobs} claimed, ${summary.completedJobs} completed, ${summary.failedJobs} failed`);
        console.log(`Nodes: ${summary.activeNodes} active / ${summary.totalNodes} total`);
        
        if (summary.activeNodes > 0 && summary.pendingJobs > 0) {
            console.log('🚨 ALERT: Active nodes but high pending backlog - investigating...');
        }
        console.log('');
    }

    displayNodeDetails(nodeDetails) {
        console.log('🖥️  ACTIVE NODE ANALYSIS');
        console.log('─────────────────────────');
        
        const activeNodes = nodeDetails.filter(node => node.status === 'active');
        
        if (activeNodes.length === 0) {
            console.log('❌ No active nodes found');
            console.log('');
            return;
        }

        activeNodes.forEach(node => {
            const nodeIdShort = node.nodeId.substring(0, 8);
            const capabilities = JSON.parse(node.capabilities || '[]');
            const lastSeenMin = Math.floor((Date.now() / 1000 - parseInt(node.lastSeen)) / 60);
            const successRate = node.completedJobs + node.failedJobs > 0 ? 
                Math.round(node.completedJobs / (node.completedJobs + node.failedJobs) * 100) : 0;

            console.log(`• ${nodeIdShort}:`);
            console.log(`  Last seen: ${lastSeenMin}min ago`);
            console.log(`  Capabilities: ${capabilities.join(', ')}`);
            console.log(`  Performance: ${node.completedJobs} completed, ${node.failedJobs} failed (${successRate}%)`);
            console.log(`  Current jobs: ${node.currentJobs}`);
            
            if (node.flags && node.flags !== '{}') {
                console.log(`  Flags: ${node.flags}`);
            }
        });
        console.log('');
    }

    displayJobDetails(jobDetails) {
        console.log('📋 PENDING JOB ANALYSIS');
        console.log('────────────────────────');
        
        if (jobDetails.length === 0) {
            console.log('✅ No pending jobs');
            console.log('');
            return;
        }

        jobDetails.forEach(job => {
            const oldestAge = this.formatAge(job.oldestTimestamp);
            console.log(`• ${job.type}: ${job.count} jobs (oldest: ${oldestAge})`);
        });
        console.log('');
    }

    displayCapabilityGaps(gaps) {
        console.log('🔍 CAPABILITY ANALYSIS');
        console.log('───────────────────────');
        
        const blocked = gaps.filter(gap => !gap.hasCapability);
        const processable = gaps.filter(gap => gap.hasCapability);
        
        if (blocked.length > 0) {
            console.log('❌ BLOCKED (no capable nodes):');
            blocked.forEach(gap => {
                console.log(`  ${gap.jobType}: ${gap.count} jobs`);
            });
        }
        
        if (processable.length > 0) {
            console.log('⚠️  PROCESSABLE (has capable nodes):');
            processable.forEach(gap => {
                console.log(`  ${gap.jobType}: ${gap.count} jobs`);
            });
        }
        console.log('');
    }

    displayQuarantineStatus(quarantineNodes) {
        console.log('🚫 QUARANTINE STATUS');
        console.log('────────────────────');
        
        if (quarantineNodes.length === 0) {
            console.log('✅ No nodes in quarantine');
        } else {
            quarantineNodes.forEach(node => {
                const nodeIdShort = node.nodeId.substring(0, 8);
                const flags = JSON.parse(node.flags || '{}');
                console.log(`• ${nodeIdShort}: ${JSON.stringify(flags)}`);
                console.log(`  Performance: ${node.completedJobs} completed, ${node.failedJobs} failed`);
            });
        }
        console.log('');
    }

    generateRecommendations(summary, nodeDetails, jobDetails, capabilityGaps, quarantineNodes) {
        console.log('💡 RECOMMENDATIONS');
        console.log('──────────────────');
        
        const activeNodes = nodeDetails.filter(node => node.status === 'active');
        const blocked = capabilityGaps.filter(gap => !gap.hasCapability);
        const processable = capabilityGaps.filter(gap => gap.hasCapability);
        
        let urgency = 0;
        
        if (summary.activeNodes === 0) {
            console.log('🔴 CRITICAL: No active nodes - immediate recruitment needed');
            urgency = 3;
        }
        
        if (blocked.length > 0) {
            console.log('🟡 HIGH: Missing capabilities detected:');
            blocked.forEach(gap => {
                console.log(`   - Need node with '${gap.jobType}' capability (${gap.count} jobs blocked)`);
            });
            urgency = Math.max(urgency, 2);
        }
        
        if (processable.length > 0) {
            console.log('🟡 MEDIUM: Active nodes not processing available jobs:');
            processable.forEach(gap => {
                console.log(`   - ${gap.jobType}: ${gap.count} jobs should be processable`);
            });
            console.log('   Potential causes:');
            console.log('   - Server not properly distributing jobs');
            console.log('   - Nodes experiencing internal errors');
            console.log('   - WebSocket connection issues');
            console.log('   - Check server logs and node logs');
            urgency = Math.max(urgency, 1);
        }
        
        if (quarantineNodes.length > 0) {
            console.log('🟠 REVIEW: Quarantined nodes may need rehabilitation:');
            quarantineNodes.forEach(node => {
                const nodeIdShort = node.nodeId.substring(0, 8);
                console.log(`   - ${nodeIdShort}: Check if issues resolved, consider unquarantine`);
            });
        }
        
        if (urgency === 0) {
            console.log('✅ System appears healthy - monitor for job processing rate');
        }
        
        console.log('');
        console.log('📋 NEXT ACTIONS:');
        console.log('1. Check server logs for job distribution errors');
        console.log('2. Verify WebSocket connections are working');
        console.log('3. Test manual job claiming by nodes');
        console.log('4. Review node error logs for processing failures');
    }

    formatAge(timestamp) {
        const now = Math.floor(Date.now() / 1000);
        const created = parseInt(timestamp);
        const diffMinutes = Math.floor((now - created) / 60);
        
        if (diffMinutes < 60) {
            return `${diffMinutes}min ago`;
        } else if (diffMinutes < 1440) {
            return `${Math.floor(diffMinutes / 60)}h ago`;
        } else {
            return `${Math.floor(diffMinutes / 1440)}d ago`;
        }
    }

    close() {
        if (this.db) {
            this.db.close();
        }
    }
}

// CLI execution
if (require.main === module) {
    const analyzer = new JobProcessingAnalyzer();
    
    analyzer.init().then(() => {
        analyzer.close();
        console.log('🏁 Analysis complete');
        process.exit(0);
    }).catch((error) => {
        console.error('❌ Analysis failed:', error);
        analyzer.close();
        process.exit(1);
    });
}

module.exports = JobProcessingAnalyzer;