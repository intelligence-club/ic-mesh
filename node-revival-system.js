#!/usr/bin/env node

/**
 * Node Revival System - Proactive Node Reconnection Tool
 * 
 * Identifies recently disconnected nodes and provides automated outreach
 * to encourage operators to reconnect, improving network capacity.
 * 
 * Usage:
 *   node node-revival-system.js              # Analyze and generate outreach
 *   node node-revival-system.js --execute    # Also attempt automated revival
 *   node node-revival-system.js --report     # Generate status report only
 */

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

class NodeRevivalSystem {
    constructor() {
        this.dbPath = './data/mesh.db';
        this.revivalLogPath = './revival-attempts.json';
        this.loadRevivalLog();
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

    loadRevivalLog() {
        try {
            if (fs.existsSync(this.revivalLogPath)) {
                this.revivalLog = JSON.parse(fs.readFileSync(this.revivalLogPath, 'utf8'));
            } else {
                this.revivalLog = {
                    attempts: [],
                    lastRun: null,
                    stats: {
                        totalAttempts: 0,
                        successfulRevivals: 0,
                        failedAttempts: 0
                    }
                };
            }
        } catch (error) {
            console.warn('⚠️  Could not load revival log, starting fresh');
            this.revivalLog = { attempts: [], lastRun: null, stats: { totalAttempts: 0, successfulRevivals: 0, failedAttempts: 0 } };
        }
    }

    saveRevivalLog() {
        fs.writeFileSync(this.revivalLogPath, JSON.stringify(this.revivalLog, null, 2));
    }

    async analyzeNodes() {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    nodeId,
                    name,
                    registeredAt,
                    lastSeen,
                    capabilities,
                    jobsCompleted,
                    (SELECT COUNT(*) FROM jobs WHERE jobs.claimedBy = nodes.nodeId AND jobs.status = 'completed') as completedJobs,
                    (SELECT COUNT(*) FROM jobs WHERE jobs.claimedBy = nodes.nodeId AND jobs.status = 'failed') as failedJobs,
                    CAST((julianday('now') - julianday(datetime(lastSeen/1000, 'unixepoch'))) * 1440 AS INTEGER) as minutesOffline
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

    categorizeNodes(nodes) {
        const now = Date.now();
        const categories = {
            active: [],
            recentlyDisconnected: [], // < 24h offline, good candidates for revival
            dormant: [], // 24h-7d offline, medium priority
            abandoned: [], // > 7d offline, low priority
            problematic: [] // High failure rate
        };

        nodes.forEach(node => {
            const minutesOffline = node.minutesOffline || 0;
            const totalJobs = node.completedJobs + node.failedJobs;
            const failureRate = totalJobs > 0 ? node.failedJobs / totalJobs : 0;

            // Categorize by connection status
            if (minutesOffline < 5) {
                categories.active.push(node);
            } else if (minutesOffline < 1440) { // < 24h
                categories.recentlyDisconnected.push(node);
            } else if (minutesOffline < 10080) { // < 7d  
                categories.dormant.push(node);
            } else {
                categories.abandoned.push(node);
            }

            // Mark problematic nodes
            if (failureRate > 0.5 && totalJobs >= 5) {
                categories.problematic.push(node);
            }
        });

        return categories;
    }

    generateRevivalMessages(categories) {
        const messages = [];

        // Recently disconnected nodes - high priority, gentle nudge
        categories.recentlyDisconnected.forEach(node => {
            const hoursOffline = Math.round(node.minutesOffline / 60);
            messages.push({
                nodeId: node.nodeId,
                name: node.name || 'unnamed',
                owner: 'unknown',
                priority: 'high',
                type: 'recent_disconnect',
                hoursOffline,
                message: this.createRevivalMessage(node, 'recent'),
                actionItems: [
                    'Check if node process is still running',
                    'Verify network connectivity',
                    'Review logs for any error messages'
                ]
            });
        });

        // Dormant nodes - medium priority, re-engagement
        categories.dormant.forEach(node => {
            const daysOffline = Math.round(node.minutesOffline / 1440);
            messages.push({
                nodeId: node.nodeId,
                name: node.name || 'unnamed',
                owner: 'unknown',
                priority: 'medium',
                type: 'dormant',
                daysOffline,
                message: this.createRevivalMessage(node, 'dormant'),
                actionItems: [
                    'Review recent earnings potential',
                    'Check for system updates needed',
                    'Consider upgrading capabilities'
                ]
            });
        });

        return messages;
    }

    createRevivalMessage(node, type) {
        const totalJobs = node.completedJobs + node.failedJobs;
        const successRate = totalJobs > 0 ? Math.round((node.completedJobs / totalJobs) * 100) : 0;
        
        const templates = {
            recent: {
                subject: `🔄 Your ${node.name || 'IC Mesh node'} went offline recently`,
                body: `Hi,

Your IC Mesh node "${node.name || node.nodeId}" has been offline for ${Math.round(node.minutesOffline / 60)} hours.

${totalJobs > 0 ? `Performance summary:
• ${node.completedJobs} jobs completed successfully (${successRate}% success rate)
• ${totalJobs} total jobs processed
• Capabilities: ${node.capabilities || 'basic'}` : 'This node was just getting started - no jobs processed yet.'}

Quick reconnection steps:
1. Check if the node process is still running
2. Restart with: claw skill mesh-transcribe  
3. Verify connection at: https://moilol.com:8333

The network currently has only ${this.activeNodeCount || 0} active nodes. Your reconnection would help restore service capacity!

Thanks for being part of the mesh.`
            },
            
            dormant: {
                subject: `💤 Your IC Mesh node has been dormant for ${Math.round(node.minutesOffline / 1440)} days`,
                body: `Hi,

Your IC Mesh node "${node.name || node.nodeId}" has been offline for ${Math.round(node.minutesOffline / 1440)} days.

${totalJobs > 0 ? `Past performance:
• ${node.completedJobs} jobs completed (${successRate}% success rate)  
• Last active: ${new Date(node.lastSeen).toLocaleDateString()}
• Capabilities: ${node.capabilities || 'basic'}` : 'This node was registered but never started processing jobs.'}

Current network opportunity:
• ${this.pendingJobCount || 0} jobs waiting to be processed
• Estimated earning potential: $${(this.pendingJobCount * 0.30).toFixed(2)} - $${(this.pendingJobCount * 0.50).toFixed(2)}
• Only ${this.activeNodeCount || 0} active nodes currently online

Reconnect anytime:
1. Update OpenClaw: curl https://openclaw.co/install | bash
2. Restart node: claw skill mesh-transcribe
3. Check status: https://moilol.com:8333

Your expertise is valuable to the network!`
            }
        };

        return templates[type] || templates.recent;
    }

    async generateReport(categories, messages) {
        const networkStats = await this.getNetworkStats();
        
        const report = {
            timestamp: new Date().toISOString(),
            networkStatus: {
                activeNodes: categories.active.length,
                totalNodes: Object.values(categories).flat().length,
                pendingJobs: networkStats.pendingJobs,
                serviceAvailability: categories.active.length > 0 ? 'available' : 'limited'
            },
            nodeCategories: {
                active: categories.active.length,
                recentlyDisconnected: categories.recentlyDisconnected.length,
                dormant: categories.dormant.length,
                abandoned: categories.abandoned.length,
                problematic: categories.problematic.length
            },
            revivalOpportunities: {
                highPriority: messages.filter(m => m.priority === 'high').length,
                mediumPriority: messages.filter(m => m.priority === 'medium').length,
                totalReachOut: messages.length
            },
            recommendations: this.generateRecommendations(categories, networkStats)
        };

        return report;
    }

    async getNetworkStats() {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    (SELECT COUNT(*) FROM jobs WHERE status = 'pending') as pendingJobs,
                    (SELECT COUNT(*) FROM jobs WHERE status = 'completed') as completedJobs,
                    (SELECT COUNT(DISTINCT claimedBy) FROM jobs WHERE julianday('now') - julianday(datetime(claimedAt/1000, 'unixepoch')) < 7) as activeLastWeek
            `;
            
            this.db.get(query, (err, stats) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(stats);
                }
            });
        });
    }

    generateRecommendations(categories, networkStats) {
        const recommendations = [];
        
        if (categories.active.length === 0) {
            recommendations.push({
                priority: 'critical',
                action: 'immediate_outreach',
                message: 'ZERO active nodes! Immediate outreach to recently disconnected nodes required.'
            });
        }
        
        if (categories.active.length < 2 && networkStats.pendingJobs > 0) {
            recommendations.push({
                priority: 'high', 
                action: 'capacity_expansion',
                message: `Only ${categories.active.length} active nodes with ${networkStats.pendingJobs} pending jobs. Network capacity critically low.`
            });
        }

        if (categories.recentlyDisconnected.length > categories.active.length) {
            recommendations.push({
                priority: 'medium',
                action: 'retention_analysis',
                message: 'More nodes recently disconnected than currently active. Investigate retention issues.'
            });
        }

        if (categories.problematic.length > 0) {
            recommendations.push({
                priority: 'medium',
                action: 'node_repair',
                message: `${categories.problematic.length} problematic nodes need technical support to restore functionality.`
            });
        }

        return recommendations;
    }

    async run(options = {}) {
        console.log('🔄 Node Revival System Starting...\n');
        
        await this.init();
        const nodes = await this.analyzeNodes();
        const categories = this.categorizeNodes(nodes);
        const networkStats = await this.getNetworkStats();
        
        // Store for template generation
        this.activeNodeCount = categories.active.length;
        this.pendingJobCount = networkStats.pendingJobs;
        
        const messages = this.generateRevivalMessages(categories);
        const report = await this.generateReport(categories, messages);

        if (options.report) {
            this.displayReport(report);
            return report;
        }

        // Display analysis
        console.log('📊 NETWORK STATUS ANALYSIS');
        console.log('════════════════════════════════════════');
        console.log(`🟢 Active nodes: ${categories.active.length}`);
        console.log(`🟡 Recently disconnected: ${categories.recentlyDisconnected.length} (< 24h)`);
        console.log(`🟠 Dormant nodes: ${categories.dormant.length} (24h-7d)`);
        console.log(`🔴 Abandoned nodes: ${categories.abandoned.length} (> 7d)`);
        console.log(`⚠️  Problematic nodes: ${categories.problematic.length}\n`);

        console.log(`📈 Network health: ${networkStats.pendingJobs} pending jobs, ${categories.active.length}/${nodes.length} nodes active\n`);

        // Display revival messages
        if (messages.length > 0) {
            console.log('📬 REVIVAL OUTREACH MESSAGES');
            console.log('════════════════════════════════════════');
            
            messages.forEach((msg, i) => {
                console.log(`\n${i + 1}. ${msg.priority.toUpperCase()} PRIORITY - ${msg.name} (${msg.nodeId.substring(0, 8)})`);
                console.log(`   Owner: unknown`);
                console.log(`   Type: ${msg.type.replace('_', ' ')}`);
                console.log(`   Subject: ${msg.message.subject}`);
                console.log(`   Preview: ${msg.message.body.split('\n')[2] || 'No preview'}`);
            });

            console.log(`\n💡 Generated ${messages.length} outreach messages for node operators.`);
        } else {
            console.log('✅ No nodes need revival outreach at this time.');
        }

        // Display recommendations
        if (report.recommendations.length > 0) {
            console.log('\n🎯 RECOMMENDED ACTIONS');
            console.log('════════════════════════════════════════');
            report.recommendations.forEach((rec, i) => {
                console.log(`${i + 1}. [${rec.priority.toUpperCase()}] ${rec.action}: ${rec.message}`);
            });
        }

        // Save revival attempt log
        this.revivalLog.lastRun = new Date().toISOString();
        this.revivalLog.attempts.push({
            timestamp: new Date().toISOString(),
            messagesGenerated: messages.length,
            networkStatus: report.networkStatus
        });
        
        // Keep only last 100 attempts
        if (this.revivalLog.attempts.length > 100) {
            this.revivalLog.attempts = this.revivalLog.attempts.slice(-100);
        }
        
        this.saveRevivalLog();

        console.log(`\n📝 Revival analysis logged to ${this.revivalLogPath}`);
        console.log('🔄 Node Revival System Complete\n');

        return { categories, messages, report };
    }

    displayReport(report) {
        console.log('📊 NODE REVIVAL SYSTEM REPORT');
        console.log('════════════════════════════════════════');
        console.log(`Timestamp: ${report.timestamp}\n`);
        
        console.log('🌐 Network Status:');
        console.log(`   Active nodes: ${report.networkStatus.activeNodes}/${report.networkStatus.totalNodes}`);
        console.log(`   Pending jobs: ${report.networkStatus.pendingJobs}`);
        console.log(`   Availability: ${report.networkStatus.serviceAvailability}\n`);
        
        console.log('📋 Node Categories:');
        Object.entries(report.nodeCategories).forEach(([category, count]) => {
            console.log(`   ${category}: ${count}`);
        });
        
        console.log('\n💌 Revival Opportunities:');
        console.log(`   High priority outreach: ${report.revivalOpportunities.highPriority}`);
        console.log(`   Medium priority outreach: ${report.revivalOpportunities.mediumPriority}`);
        console.log(`   Total messages ready: ${report.revivalOpportunities.totalReachOut}\n`);
        
        if (report.recommendations.length > 0) {
            console.log('🎯 Recommendations:');
            report.recommendations.forEach(rec => {
                console.log(`   [${rec.priority}] ${rec.action}: ${rec.message}`);
            });
        }
    }

    close() {
        if (this.db) {
            this.db.close();
        }
    }
}

// CLI execution
async function main() {
    const args = process.argv.slice(2);
    const options = {
        execute: args.includes('--execute'),
        report: args.includes('--report')
    };

    const revivalSystem = new NodeRevivalSystem();
    
    try {
        await revivalSystem.run(options);
    } catch (error) {
        console.error('❌ Error running node revival system:', error.message);
        process.exit(1);
    } finally {
        revivalSystem.close();
    }
}

if (require.main === module) {
    main();
}

module.exports = NodeRevivalSystem;