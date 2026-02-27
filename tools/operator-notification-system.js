#!/usr/bin/env node

/**
 * Operator Notification System
 * Proactively notifies node operators about health, performance, and earnings
 * Part of node retention improvement strategy
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs').promises;

class OperatorNotificationSystem {
    constructor() {
        this.db = new Database(path.join(__dirname, '..', 'data', 'mesh.db'), { readonly: true });
        this.notificationHistory = path.join(__dirname, '..', 'notifications.json');
        this.templates = this.initializeTemplates();
    }

    async analyzeAndNotify() {
        console.log('📬 Operator Notification System');
        console.log('================================\n');

        try {
            const nodes = this.getAllNodes();
            const history = await this.loadNotificationHistory();
            
            for (const node of nodes) {
                const analysis = await this.analyzeNode(node);
                const notifications = this.determineNotifications(analysis, history);
                
                if (notifications.length > 0) {
                    await this.sendNotifications(node, notifications);
                    await this.updateNotificationHistory(node.nodeId, notifications);
                }
            }

            console.log('\n✅ Notification analysis complete');
            
        } catch (error) {
            console.error('❌ Notification system error:', error);
        } finally {
            this.db.close();
        }
    }

    async analyzeNode(node) {
        const jobs = this.getNodeJobs(node.nodeId, 7); // Last 7 days
        const earnings = await this.calculateEarnings(node.nodeId);
        
        const analysis = {
            nodeId: node.nodeId,
            owner: node.owner || 'unknown',
            isActive: this.isNodeActive(node),
            lastSeen: node.lastSeen,
            sessionLength: this.calculateSessionLength(node),
            performance: this.analyzePerformance(jobs),
            earnings: earnings,
            issues: await this.detectIssues(node, jobs),
            capabilities: this.parseCapabilities(node.capabilities),
            registeredDaysAgo: Math.floor((Date.now() - node.registeredAt) / (1000 * 60 * 60 * 24))
        };

        return analysis;
    }

    determineNotifications(analysis, history) {
        const notifications = [];
        const nodeHistory = history[analysis.nodeId] || {};
        const now = Date.now();
        
        // Critical: Node offline for extended period
        if (!analysis.isActive && this.getTimeSinceLastNotification(nodeHistory, 'offline') > 24 * 60 * 60 * 1000) {
            const hoursOffline = Math.round((now - analysis.lastSeen) / (1000 * 60 * 60));
            if (hoursOffline > 2) {
                notifications.push({
                    type: 'offline',
                    priority: 'critical',
                    title: `Node ${analysis.nodeId.substring(0, 8)} is offline`,
                    details: {
                        hoursOffline,
                        lastEarnings: analysis.earnings.last24h,
                        potentialLoss: this.calculatePotentialLoss(analysis.earnings)
                    }
                });
            }
        }

        // High priority: Performance degradation
        if (analysis.performance.successRate < 50 && analysis.performance.total > 5 && 
            this.getTimeSinceLastNotification(nodeHistory, 'performance') > 12 * 60 * 60 * 1000) {
            notifications.push({
                type: 'performance',
                priority: 'high',
                title: `Node ${analysis.nodeId.substring(0, 8)} performance issues`,
                details: {
                    successRate: analysis.performance.successRate,
                    failedJobs: analysis.performance.total - analysis.performance.completed,
                    issues: analysis.issues
                }
            });
        }

        // Medium priority: Missing capabilities
        const criticalMissing = ['whisper', 'ffmpeg'].filter(cap => !analysis.capabilities.includes(cap));
        if (criticalMissing.length > 0 && 
            this.getTimeSinceLastNotification(nodeHistory, 'capabilities') > 7 * 24 * 60 * 60 * 1000) {
            notifications.push({
                type: 'capabilities',
                priority: 'medium',
                title: `Optimize ${analysis.nodeId.substring(0, 8)} for more earnings`,
                details: {
                    missingCapabilities: criticalMissing,
                    potentialIncrease: this.calculateCapabilityEarningsIncrease(criticalMissing)
                }
            });
        }

        // Positive: Earnings milestone
        if (analysis.earnings.total > 0 && analysis.earnings.total % 10 === 0 && 
            this.getTimeSinceLastNotification(nodeHistory, 'milestone') > 30 * 24 * 60 * 60 * 1000) {
            notifications.push({
                type: 'milestone',
                priority: 'positive',
                title: `Milestone: $${analysis.earnings.total} earned!`,
                details: {
                    totalEarnings: analysis.earnings.total,
                    jobsCompleted: analysis.performance.completed,
                    successRate: analysis.performance.successRate
                }
            });
        }

        // Educational: New operator welcome
        if (analysis.registeredDaysAgo <= 1 && 
            !nodeHistory.welcome) {
            notifications.push({
                type: 'welcome',
                priority: 'educational',
                title: `Welcome to IC Mesh Network!`,
                details: {
                    setupTips: true,
                    optimizationGuide: true,
                    communityLinks: true
                }
            });
        }

        return notifications;
    }

    async sendNotifications(node, notifications) {
        console.log(`📤 Node ${node.nodeId.substring(0, 8)} (${node.owner}): ${notifications.length} notifications`);
        
        for (const notification of notifications) {
            console.log(`   ${this.getPriorityEmoji(notification.priority)} ${notification.title}`);
            
            // Generate notification content
            const content = this.generateNotificationContent(notification, node);
            
            // Log notification (in real system, this would send email/Discord/etc.)
            await this.logNotification(node, notification, content);
        }
    }

    generateNotificationContent(notification, node) {
        const template = this.templates[notification.type];
        if (!template) {
            return `${notification.title}\n\nNode: ${node.nodeId}\nOwner: ${node.owner}`;
        }

        let content = template.content;
        
        // Replace placeholders
        content = content.replace(/\{nodeId\}/g, node.nodeId.substring(0, 8));
        content = content.replace(/\{owner\}/g, node.owner || 'unknown');
        
        // Replace detail-specific placeholders
        for (const [key, value] of Object.entries(notification.details || {})) {
            content = content.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
        }

        return {
            subject: notification.title,
            content: content,
            priority: notification.priority,
            template: notification.type
        };
    }

    async logNotification(node, notification, content) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            nodeId: node.nodeId,
            owner: node.owner,
            type: notification.type,
            priority: notification.priority,
            title: notification.title,
            content: content
        };

        // In a real system, this would integrate with email service, Discord webhooks, etc.
        console.log(`     📝 Logged ${notification.type} notification for operator`);
        
        // Save to file for reference
        const logFile = path.join(__dirname, '..', 'notification-log.jsonl');
        await fs.appendFile(logFile, JSON.stringify(logEntry) + '\n').catch(() => {});
    }

    async updateNotificationHistory(nodeId, notifications) {
        const history = await this.loadNotificationHistory();
        
        if (!history[nodeId]) {
            history[nodeId] = {};
        }

        for (const notification of notifications) {
            history[nodeId][notification.type] = Date.now();
        }

        await fs.writeFile(this.notificationHistory, JSON.stringify(history, null, 2)).catch(() => {});
    }

    async loadNotificationHistory() {
        try {
            const data = await fs.readFile(this.notificationHistory, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            return {};
        }
    }

    initializeTemplates() {
        return {
            offline: {
                content: `Hi {owner},

Your IC Mesh node ({nodeId}) has been offline for {hoursOffline} hours.

While offline, you're missing potential earnings. Based on your recent activity, 
you could be earning approximately ${this.formatCurrency('{potentialLoss}')} per day.

To get back online:
1. Check your internet connection
2. Restart the IC Mesh client
3. Verify your node configuration

Need help? Check our troubleshooting guide or contact support.

Best regards,
IC Mesh Network Team`
            },

            performance: {
                content: `Hi {owner},

Your IC Mesh node ({nodeId}) is experiencing performance issues:
• Success rate: {successRate}%
• Failed jobs: {failedJobs}

This affects both your earnings and the network's reliability. 
Common fixes include:
1. Updating job handlers
2. Installing missing dependencies
3. Checking system resources

Run our diagnostic tool for detailed guidance:
node tools/comprehensive-node-diagnosis.js {nodeId}

Best regards,
IC Mesh Network Team`
            },

            capabilities: {
                content: `Hi {owner},

Your IC Mesh node ({nodeId}) could earn more with additional capabilities!

Missing capabilities: {missingCapabilities}
Potential earnings increase: +{potentialIncrease}% per month

Installation guides:
• Whisper (audio transcription): [setup guide link]
• FFmpeg (media processing): [setup guide link]

These capabilities are in high demand and could significantly 
boost your monthly earnings.

Best regards,
IC Mesh Network Team`
            },

            milestone: {
                content: `Congratulations {owner}!

Your IC Mesh node ({nodeId}) has reached a milestone:
🎉 Total earnings: ${this.formatCurrency('{totalEarnings}')}
📊 Jobs completed: {jobsCompleted}
✅ Success rate: {successRate}%

Thank you for being a valuable part of our network. 
Your reliable service helps businesses worldwide access 
affordable, distributed computing power.

Keep up the great work!

IC Mesh Network Team`
            },

            welcome: {
                content: `Welcome to IC Mesh Network, {owner}!

Your node ({nodeId}) has successfully joined our distributed computing network.

Getting started:
1. ✅ Node registration complete
2. 📋 Install additional capabilities for more earnings
3. 📊 Monitor performance in your operator dashboard
4. 💬 Join our community for tips and support

Optimization tips:
• Install Whisper for audio transcription jobs (high demand)
• Enable multiple capabilities to handle diverse job types
• Keep your node online for consistent earnings

Questions? Check our documentation or reach out to support.

Happy computing!
IC Mesh Network Team`
            }
        };
    }

    // Helper methods
    isNodeActive(node) {
        const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
        return node.lastSeen > fiveMinutesAgo;
    }

    calculateSessionLength(node) {
        return Math.round((node.lastSeen - node.registeredAt) / 1000 / 60);
    }

    analyzePerformance(jobs) {
        if (jobs.length === 0) {
            return { successRate: 0, completed: 0, total: 0 };
        }

        const completed = jobs.filter(job => job.status === 'completed').length;
        return {
            successRate: Math.round((completed / jobs.length) * 100),
            completed,
            total: jobs.length
        };
    }

    async calculateEarnings(nodeId) {
        // Simplified earnings calculation - in real system would use actual pricing
        const jobs = this.getNodeJobs(nodeId, 30); // Last 30 days
        const completedJobs = jobs.filter(job => job.status === 'completed');
        
        const earnings = {
            total: completedJobs.length * 0.10, // $0.10 per job estimate
            last24h: completedJobs.filter(job => 
                job.completedAt > Date.now() - 24 * 60 * 60 * 1000
            ).length * 0.10,
            last7d: completedJobs.filter(job => 
                job.completedAt > Date.now() - 7 * 24 * 60 * 60 * 1000
            ).length * 0.10
        };

        return earnings;
    }

    async detectIssues(node, jobs) {
        const issues = [];
        const failedJobs = jobs.filter(job => job.status === 'failed');
        
        if (failedJobs.length > jobs.length * 0.5) {
            issues.push('High failure rate');
        }
        
        const capabilities = this.parseCapabilities(node.capabilities);
        if (capabilities.length < 2) {
            issues.push('Limited capabilities');
        }
        
        return issues;
    }

    parseCapabilities(capabilities) {
        if (!capabilities) return [];
        try {
            return JSON.parse(capabilities);
        } catch (e) {
            return [];
        }
    }

    getTimeSinceLastNotification(nodeHistory, type) {
        const lastNotification = nodeHistory[type];
        return lastNotification ? Date.now() - lastNotification : Infinity;
    }

    calculatePotentialLoss(earnings) {
        return earnings.last24h || 0.5; // Default estimate
    }

    calculateCapabilityEarningsIncrease(missingCapabilities) {
        return missingCapabilities.length * 25; // 25% increase per capability
    }

    getPriorityEmoji(priority) {
        const emojis = {
            critical: '🚨',
            high: '⚠️',
            medium: '📋',
            positive: '🎉',
            educational: '📚'
        };
        return emojis[priority] || '📬';
    }

    formatCurrency(amount) {
        return `$${Number(amount).toFixed(2)}`;
    }

    // Database helper methods
    getAllNodes() {
        const stmt = this.db.prepare('SELECT * FROM nodes ORDER BY lastSeen DESC');
        return stmt.all();
    }

    getNodeJobs(nodeId, days = 7) {
        const cutoffTime = Date.now() - (days * 24 * 60 * 60 * 1000);
        const stmt = this.db.prepare('SELECT * FROM jobs WHERE claimedBy = ? AND claimedAt > ? ORDER BY claimedAt DESC');
        return stmt.all(nodeId, cutoffTime);
    }
}

// CLI Usage
if (require.main === module) {
    const notificationSystem = new OperatorNotificationSystem();
    
    notificationSystem.analyzeAndNotify()
        .then(() => {
            console.log('\n✅ Notification system complete');
        })
        .catch(error => {
            console.error('❌ Notification system failed:', error);
            process.exit(1);
        });
}

module.exports = OperatorNotificationSystem;