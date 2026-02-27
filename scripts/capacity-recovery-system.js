#!/usr/bin/env node
/**
 * IC Mesh Capacity Recovery System
 * 
 * Autonomous system for recovering from capacity crises:
 * - Analyzes job backlog and node capacity
 * - Attempts automated recovery strategies  
 * - Generates actionable recovery plans
 * - Provides immediate mitigation options
 */

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// Configuration
const CONFIG = {
    dbPath: 'data/mesh.db',
    maxPendingThreshold: 50,
    minActiveNodesThreshold: 2,
    staleJobThresholdHours: 2,
    outputDir: '../',
    logFile: '../logs/capacity-recovery.log'
};

class CapacityRecoverySystem {
    constructor() {
        this.db = null;
        this.startTime = Date.now();
        this.recoveryActions = [];
    }

    async init() {
        console.log('🔧 IC Mesh Capacity Recovery System');
        console.log('=====================================');
        console.log(`Started: ${new Date().toISOString()}`);
        console.log('');

        // Connect to database
        this.db = new sqlite3.Database(CONFIG.dbPath, (err) => {
            if (err) {
                console.error('❌ Database connection failed:', err.message);
                process.exit(1);
            }
        });

        await this.runRecoveryAnalysis();
    }

    async runRecoveryAnalysis() {
        try {
            const capacityStatus = await this.analyzeCapacity();
            const jobAnalysis = await this.analyzeJobBacklog();
            const nodeHealth = await this.analyzeNodeHealth();

            console.log('📊 CAPACITY CRISIS ANALYSIS');
            console.log('──────────────────────────────────');
            this.displayCapacityStatus(capacityStatus);
            this.displayJobAnalysis(jobAnalysis);
            this.displayNodeHealth(nodeHealth);

            // Determine recovery strategy
            const recoveryPlan = this.generateRecoveryPlan(capacityStatus, jobAnalysis, nodeHealth);
            this.displayRecoveryPlan(recoveryPlan);

            // Execute automated recovery actions
            const results = await this.executeRecoveryActions(recoveryPlan);
            this.displayRecoveryResults(results);

            // Generate detailed recovery report
            await this.generateRecoveryReport(capacityStatus, jobAnalysis, nodeHealth, recoveryPlan, results);

        } catch (error) {
            console.error('❌ Recovery analysis failed:', error);
            process.exit(1);
        }
    }

    async analyzeCapacity() {
        return new Promise((resolve, reject) => {
            this.db.all(`
                SELECT 
                    COUNT(*) as totalJobs,
                    SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pendingJobs,
                    SUM(CASE WHEN status = 'claimed' THEN 1 ELSE 0 END) as claimedJobs,
                    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completedJobs,
                    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failedJobs,
                    (SELECT COUNT(*) FROM nodes WHERE lastSeen > strftime('%s', 'now') - 300) as activeNodes,
                    (SELECT COUNT(*) FROM nodes) as totalNodes,
                    (SELECT COUNT(DISTINCT type) FROM jobs WHERE status = 'pending') as pendingJobTypes
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows[0]);
            });
        });
    }

    async analyzeJobBacklog() {
        return new Promise((resolve, reject) => {
            this.db.all(`
                SELECT 
                    type as jobType,
                    COUNT(*) as count,
                    AVG(CASE WHEN completedAt IS NOT NULL AND claimedAt IS NOT NULL 
                        THEN (completedAt - claimedAt) / 60.0
                        ELSE NULL END) as avgProcessingMinutes,
                    MIN(createdAt) as oldestJob,
                    MAX(createdAt) as newestJob
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

    async analyzeNodeHealth() {
        return new Promise((resolve, reject) => {
            this.db.all(`
                SELECT 
                    nodeId,
                    capabilities,
                    lastSeen,
                    CASE 
                        WHEN lastSeen > strftime('%s', 'now') - 300 THEN 'active'
                        WHEN lastSeen > strftime('%s', 'now') - 3600 THEN 'recent' 
                        ELSE 'inactive'
                    END as status,
                    (SELECT COUNT(*) FROM jobs WHERE claimedBy = nodes.nodeId AND status = 'completed') as completedJobs,
                    (SELECT COUNT(*) FROM jobs WHERE claimedBy = nodes.nodeId AND status = 'failed') as failedJobs,
                    (SELECT COUNT(*) FROM jobs WHERE claimedBy = nodes.nodeId AND status = 'claimed') as currentJobs
                FROM nodes
                ORDER BY lastSeen DESC
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    displayCapacityStatus(status) {
        console.log(`📋 Jobs: ${status.totalJobs} total, ${status.pendingJobs} pending, ${status.claimedJobs} claimed`);
        console.log(`🖥️  Nodes: ${status.activeNodes} active / ${status.totalNodes} total`);
        console.log(`📊 Success Rate: ${Math.round(status.completedJobs / Math.max(status.totalJobs, 1) * 100)}%`);

        const capacityHealth = this.assessCapacityHealth(status);
        console.log(`🚨 Capacity Status: ${capacityHealth.level} ${capacityHealth.emoji}`);
        console.log('');
    }

    displayJobAnalysis(jobAnalysis) {
        console.log('📋 JOB BACKLOG ANALYSIS');
        console.log('──────────────────────────────────');
        
        if (jobAnalysis.length === 0) {
            console.log('✅ No pending jobs');
            console.log('');
            return;
        }

        jobAnalysis.forEach(job => {
            const age = this.getJobAge(job.oldestJob);
            console.log(`• ${job.jobType}: ${job.count} jobs (oldest: ${age})`);
            if (job.avgProcessingMinutes) {
                console.log(`  Avg processing: ${Math.round(job.avgProcessingMinutes)}min`);
            }
        });
        console.log('');
    }

    displayNodeHealth(nodeHealth) {
        console.log('🖥️  NODE HEALTH ANALYSIS');
        console.log('──────────────────────────────────');
        
        if (nodeHealth.length === 0) {
            console.log('❌ No nodes registered');
            console.log('');
            return;
        }

        nodeHealth.forEach(node => {
            const nodeIdShort = node.nodeId.substring(0, 8);
            const capabilities = JSON.parse(node.capabilities || '[]').join(', ');
            const lastSeen = this.getTimeDifference(node.lastHeartbeat);
            const successRate = node.completedJobs + node.failedJobs > 0 ? 
                Math.round(node.completedJobs / (node.completedJobs + node.failedJobs) * 100) : 0;

            console.log(`• ${nodeIdShort}: ${node.status} (${lastSeen})`);
            console.log(`  Capabilities: ${capabilities}`);
            console.log(`  Performance: ${node.completedJobs} completed, ${node.failedJobs} failed (${successRate}%)`);
            if (node.currentJobs > 0) {
                console.log(`  Currently processing: ${node.currentJobs} jobs`);
            }
        });
        console.log('');
    }

    assessCapacityHealth(status) {
        if (status.pendingJobs > CONFIG.maxPendingThreshold && status.activeNodes < CONFIG.minActiveNodesThreshold) {
            return { level: 'CRITICAL CRISIS', emoji: '🔴' };
        } else if (status.pendingJobs > CONFIG.maxPendingThreshold) {
            return { level: 'HIGH BACKLOG', emoji: '🟡' };
        } else if (status.activeNodes < CONFIG.minActiveNodesThreshold) {
            return { level: 'LOW CAPACITY', emoji: '🟡' };
        } else {
            return { level: 'HEALTHY', emoji: '✅' };
        }
    }

    generateRecoveryPlan(capacity, jobs, nodes) {
        const plan = {
            priority: 'high',
            actions: [],
            timeline: 'immediate',
            expectedImpact: 'high'
        };

        // Determine crisis level
        if (capacity.pendingJobs > CONFIG.maxPendingThreshold && capacity.activeNodes === 0) {
            plan.priority = 'critical';
            plan.actions.push({
                type: 'emergency_contact',
                description: 'Contact all known node operators immediately',
                automated: false,
                impact: 'complete service restoration'
            });
        }

        // Check for stuck jobs
        plan.actions.push({
            type: 'cleanup_stale_jobs',
            description: 'Clean up stale/stuck jobs older than 2 hours',
            automated: true,
            impact: 'free up queue capacity'
        });

        // Node revival strategies
        if (capacity.activeNodes < CONFIG.minActiveNodesThreshold) {
            const inactiveNodes = nodes.filter(n => n.status === 'inactive' && n.completedJobs > 5);
            if (inactiveNodes.length > 0) {
                plan.actions.push({
                    type: 'node_revival_outreach',
                    description: `Contact ${inactiveNodes.length} proven node operators`,
                    automated: true,
                    impact: 'restore proven capacity'
                });
            }
        }

        // Capability gap analysis
        const missingCapabilities = this.identifyMissingCapabilities(jobs, nodes);
        if (missingCapabilities.length > 0) {
            plan.actions.push({
                type: 'capability_recruitment',
                description: `Recruit nodes with: ${missingCapabilities.join(', ')}`,
                automated: false,
                impact: 'resolve capability gaps'
            });
        }

        return plan;
    }

    identifyMissingCapabilities(jobs, nodes) {
        const activeCapabilities = new Set();
        nodes.filter(n => n.status === 'active').forEach(node => {
            const caps = JSON.parse(node.capabilities || '[]');
            caps.forEach(cap => activeCapabilities.add(cap));
        });

        const neededCapabilities = new Set();
        jobs.forEach(job => neededCapabilities.add(job.jobType));

        const missing = [];
        neededCapabilities.forEach(needed => {
            if (!activeCapabilities.has(needed)) {
                missing.push(needed);
            }
        });

        return missing;
    }

    displayRecoveryPlan(plan) {
        console.log('🛠️  RECOVERY PLAN');
        console.log('──────────────────────────────────');
        console.log(`Priority: ${plan.priority.toUpperCase()}`);
        console.log(`Timeline: ${plan.timeline}`);
        console.log(`Expected Impact: ${plan.expectedImpact}`);
        console.log('');

        console.log('Actions:');
        plan.actions.forEach((action, i) => {
            const autoFlag = action.automated ? '🤖' : '👤';
            console.log(`${i + 1}. ${autoFlag} ${action.description}`);
            console.log(`   Impact: ${action.impact}`);
        });
        console.log('');
    }

    async executeRecoveryActions(plan) {
        console.log('⚡ EXECUTING AUTOMATED RECOVERY ACTIONS');
        console.log('──────────────────────────────────────────');
        
        const results = [];

        for (const action of plan.actions) {
            if (action.automated) {
                try {
                    console.log(`🔧 ${action.description}...`);
                    const result = await this.executeAction(action);
                    results.push({ action: action.type, success: true, result });
                    console.log(`✅ ${action.type}: ${result.message}`);
                } catch (error) {
                    results.push({ action: action.type, success: false, error: error.message });
                    console.log(`❌ ${action.type}: ${error.message}`);
                }
            } else {
                console.log(`👤 ${action.description} (manual action required)`);
                results.push({ action: action.type, success: 'manual', result: { message: 'Manual intervention required' }});
            }
        }

        console.log('');
        return results;
    }

    async executeAction(action) {
        switch (action.type) {
            case 'cleanup_stale_jobs':
                return await this.cleanupStaleJobs();
            
            case 'node_revival_outreach':
                return await this.generateNodeRevivalMessages();

            default:
                throw new Error(`Unknown action type: ${action.type}`);
        }
    }

    async cleanupStaleJobs() {
        return new Promise((resolve, reject) => {
            const cutoffTime = Math.floor(Date.now() / 1000) - CONFIG.staleJobThresholdHours * 60 * 60;
            
            this.db.run(`
                UPDATE jobs 
                SET status = 'failed', 
                    result = '{"error": "Cleaned up stale job (no node response for 2+ hours)"}',
                    completedAt = strftime('%s', 'now')
                WHERE status = 'claimed' 
                AND claimedAt < ?
            `, [cutoffTime], function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ 
                        message: `Cleaned up ${this.changes} stale jobs`,
                        count: this.changes
                    });
                }
            });
        });
    }

    async generateNodeRevivalMessages() {
        // Generate outreach messages for inactive but proven nodes
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `NODE-REVIVAL-MESSAGES-${timestamp}.md`;
        
        return new Promise((resolve, reject) => {
            this.db.all(`
                SELECT 
                    nodeId,
                    capabilities,
                    lastSeen,
                    (SELECT COUNT(*) FROM jobs WHERE claimedBy = nodes.nodeId AND status = 'completed') as completedJobs
                FROM nodes 
                WHERE lastSeen < strftime('%s', 'now') - 3600
                AND nodeId IN (SELECT claimedBy FROM jobs WHERE status = 'completed')
                ORDER BY completedJobs DESC
            `, (err, nodes) => {
                if (err) {
                    reject(err);
                    return;
                }

                const messages = this.generateRevivalContent(nodes);
                fs.writeFileSync(path.join(CONFIG.outputDir, fileName), messages);
                
                resolve({
                    message: `Generated revival messages for ${nodes.length} proven nodes`,
                    file: fileName,
                    nodes: nodes.length
                });
            });
        });
    }

    generateRevivalContent(nodes) {
        const timestamp = new Date().toISOString();
        
        let content = `# Node Revival Outreach Messages\n\n`;
        content += `Generated: ${timestamp}\n`;
        content += `Target: ${nodes.length} proven but offline nodes\n\n`;
        
        content += `## Crisis Context\n\n`;
        content += `🚨 **IC Mesh is experiencing a capacity crisis**\n`;
        content += `- High job backlog with insufficient active nodes\n`;
        content += `- Customer requests are being delayed\n`;
        content += `- Revenue impact: lost processing opportunities\n\n`;
        
        content += `## Outreach Strategy\n\n`;
        content += `Target proven node operators who have successfully processed jobs but are currently offline.\n\n`;
        
        nodes.forEach(node => {
            const nodeIdShort = node.nodeId.substring(0, 8);
            const capabilities = JSON.parse(node.capabilities || '[]');
            const lastSeen = this.getTimeDifference(node.lastSeen);
            
            content += `### Node ${nodeIdShort}\n\n`;
            content += `**Performance History:**\n`;
            content += `- Completed: ${node.completedJobs} jobs ✅\n`;
            content += `- Capabilities: ${capabilities.join(', ')}\n`;
            content += `- Last seen: ${lastSeen}\n\n`;
            
            content += `**Suggested Message:**\n`;
            content += `"Hi! Your IC Mesh node (${nodeIdShort}) was a great contributor with ${node.completedJobs} completed jobs. `;
            content += `We're currently experiencing high demand and could really use your ${capabilities.join('/')} capacity back online. `;
            content += `Any chance you could restart your node? Thanks!"\n\n`;
            content += `**Technical Help:**\n`;
            content += `- Restart command: \`claw skill mesh-transcribe\`\n`;
            content += `- Check logs: \`pm2 logs\`\n`;
            content += `- Contact: Intelligence Club Discord\n\n`;
            content += `---\n\n`;
        });
        
        return content;
    }

    displayRecoveryResults(results) {
        console.log('📈 RECOVERY RESULTS');
        console.log('─────────────────────');
        
        let automatedSuccess = 0;
        let manualRequired = 0;
        let failures = 0;

        results.forEach(result => {
            if (result.success === true) {
                automatedSuccess++;
            } else if (result.success === 'manual') {
                manualRequired++;
            } else {
                failures++;
            }
        });

        console.log(`✅ Automated actions completed: ${automatedSuccess}`);
        console.log(`👤 Manual actions required: ${manualRequired}`);
        console.log(`❌ Failed actions: ${failures}`);
        console.log('');

        // Show specific results
        results.forEach(result => {
            if (result.success === true && result.result.count > 0) {
                console.log(`🔧 ${result.action}: ${result.result.message}`);
            }
        });
        console.log('');
    }

    async generateRecoveryReport(capacity, jobs, nodes, plan, results) {
        const timestamp = new Date().toISOString();
        const reportFile = `CAPACITY-RECOVERY-REPORT-${timestamp.split('T')[0]}-${timestamp.split('T')[1].split(':').slice(0,2).join('')}.md`;
        
        let report = `# Capacity Recovery Report\n\n`;
        report += `**Generated:** ${timestamp}\n`;
        report += `**Status:** Recovery actions executed\n`;
        report += `**Duration:** ${Math.round((Date.now() - this.startTime) / 1000)}s\n\n`;
        
        report += `## Crisis Summary\n\n`;
        report += `- **Pending jobs:** ${capacity.pendingJobs}\n`;
        report += `- **Active nodes:** ${capacity.activeNodes}\n`;
        report += `- **Success rate:** ${Math.round(capacity.completedJobs / Math.max(capacity.totalJobs, 1) * 100)}%\n\n`;
        
        report += `## Recovery Actions Taken\n\n`;
        results.forEach(result => {
            report += `- **${result.action}:** `;
            if (result.success === true) {
                report += `✅ ${result.result.message}\n`;
            } else if (result.success === 'manual') {
                report += `👤 Manual intervention required\n`;
            } else {
                report += `❌ Failed - ${result.error}\n`;
            }
        });
        
        report += `\n## Next Steps\n\n`;
        if (capacity.activeNodes === 0) {
            report += `🔴 **CRITICAL:** Zero active nodes - immediate human intervention required\n`;
            report += `- Contact known node operators via all channels\n`;
            report += `- Post recruitment messages in Discord\n`;
            report += `- Consider emergency capacity deployment\n\n`;
        }
        
        const missingCaps = this.identifyMissingCapabilities(jobs, nodes.filter(n => n.status === 'active'));
        if (missingCaps.length > 0) {
            report += `⚠️ **Missing capabilities:** ${missingCaps.join(', ')}\n`;
            report += `- Recruit nodes with these specific capabilities\n`;
            report += `- Consider capability bounties or incentives\n\n`;
        }
        
        report += `## Monitoring\n\n`;
        report += `- Continue monitoring job backlog\n`;
        report += `- Watch for node reconnections\n`;
        report += `- Alert if pending jobs exceed ${CONFIG.maxPendingThreshold} again\n\n`;
        
        fs.writeFileSync(path.join(CONFIG.outputDir, reportFile), report);
        console.log(`📄 Recovery report saved: ${reportFile}`);
    }

    getJobAge(createdAt) {
        const now = Math.floor(Date.now() / 1000);
        const created = parseInt(createdAt);
        const diffMinutes = Math.floor((now - created) / 60);
        
        if (diffMinutes < 60) {
            return `${diffMinutes}min ago`;
        } else if (diffMinutes < 1440) {
            return `${Math.floor(diffMinutes / 60)}h ago`;
        } else {
            return `${Math.floor(diffMinutes / 1440)}d ago`;
        }
    }

    getTimeDifference(timestamp) {
        const now = Math.floor(Date.now() / 1000);
        const past = parseInt(timestamp);
        const diffMinutes = Math.floor((now - past) / 60);
        
        if (diffMinutes < 1) return 'just now';
        if (diffMinutes < 60) return `${diffMinutes}min ago`;
        if (diffMinutes < 1440) return `${Math.floor(diffMinutes / 60)}h ago`;
        return `${Math.floor(diffMinutes / 1440)}d ago`;
    }

    close() {
        if (this.db) {
            this.db.close();
        }
    }
}

// CLI execution
if (require.main === module) {
    const recovery = new CapacityRecoverySystem();
    
    recovery.init().then(() => {
        recovery.close();
        console.log('🏁 Capacity recovery analysis complete');
        process.exit(0);
    }).catch((error) => {
        console.error('❌ Recovery system failed:', error);
        recovery.close();
        process.exit(1);
    });
}

module.exports = CapacityRecoverySystem;