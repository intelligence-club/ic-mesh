#!/usr/bin/env node

/**
 * Crisis Prevention Monitor
 * 
 * Continuous monitoring for critical service outages with aggressive alerting.
 * Designed to prevent revenue-blocking outages from going unnoticed.
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

class CrisisPreventionMonitor {
    constructor() {
        this.dbPath = 'data/mesh.db';
        this.logPath = 'data/crisis-prevention.log';
        this.alertsPath = 'data/crisis-alerts.json';
        this.checkInterval = 30000; // 30 seconds during potential crisis
        this.normalInterval = 300000; // 5 minutes during normal ops
        
        this.thresholds = {
            minActiveNodes: 2,
            maxPendingJobs: 20,
            criticalPendingJobs: 50,
            maxOfflineMinutes: 60
        };
    }

    async sendCrisisNotifications(status) {
        const alertData = {
            timestamp: new Date().toISOString(),
            severity: status.severity,
            message: status.message,
            actions: status.actions,
            urgency: 'IMMEDIATE_HUMAN_INTERVENTION_REQUIRED'
        };

        // Create highly visible file alert
        fs.writeFileSync('URGENT-SERVICE-OUTAGE.json', JSON.stringify(alertData, null, 2));
        
        // Write human-readable alert file
        const alertMessage = `🚨 CRITICAL SERVICE OUTAGE ALERT 🚨

${status.message}

Actions Required:
${status.actions.map(action => `- ${action}`).join('\n')}

Time: ${alertData.timestamp}
Severity: ${status.severity}

This is an automated alert from Crisis Prevention Monitor.
`;
        fs.writeFileSync('CRISIS-ALERT.txt', alertMessage);

        // Console notification (high visibility)
        console.error('\n' + '🚨'.repeat(20));
        console.error('CRITICAL SERVICE OUTAGE DETECTED');
        console.error('🚨'.repeat(20));
        console.error(status.message);
        console.error('\nActions Required:');
        status.actions.forEach(action => console.error(`- ${action}`));
        console.error('🚨'.repeat(20) + '\n');

        // Future: Add webhook notifications, Telegram bot, email alerts
        // Can be configured via environment variables
        if (process.env.CRISIS_WEBHOOK_URL) {
            try {
                const response = await fetch(process.env.CRISIS_WEBHOOK_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(alertData)
                });
                this.log(`Webhook notification sent: ${response.status}`);
            } catch (error) {
                this.log(`Webhook notification failed: ${error.message}`);
            }
        }

        if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
            try {
                const telegramMessage = `🚨 IC MESH CRISIS ALERT\n\n${status.message}\n\nActions:\n${status.actions.map(a => `• ${a}`).join('\n')}`;
                const telegramUrl = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
                const response = await fetch(telegramUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: process.env.TELEGRAM_CHAT_ID,
                        text: telegramMessage,
                        parse_mode: 'Markdown'
                    })
                });
                this.log(`Telegram notification sent: ${response.status}`);
            } catch (error) {
                this.log(`Telegram notification failed: ${error.message}`);
            }
        }
    }

    log(message) {
        const timestamp = new Date().toISOString();
        const logEntry = `${timestamp} - ${message}\\n`;
        fs.appendFileSync(this.logPath, logEntry);
        console.log(`[${timestamp}] ${message}`);
    }

    async checkCrisisConditions() {
        try {
            const db = new Database(this.dbPath, { readonly: true });
            
            // Get current node and job status
            const nodes = db.prepare('SELECT nodeId, owner, capabilities, lastSeen FROM nodes ORDER BY lastSeen DESC').all();
            const pendingJobs = db.prepare('SELECT COUNT(*) as count FROM jobs WHERE status = ?').get('pending');
            
            const now = Date.now();
            const activeNodes = nodes.filter(node => (now - node.lastSeen) <= 5 * 60 * 1000); // 5 minutes
            
            db.close();

            const status = this.assessCrisisLevel(activeNodes, pendingJobs.count, nodes);
            await this.handleCrisisLevel(status);
            
            return status;
            
        } catch (error) {
            this.log(`ERROR: Crisis assessment failed - ${error.message}`);
            return { level: 'ERROR', message: error.message };
        }
    }

    assessCrisisLevel(activeNodes, pendingCount, allNodes) {
        const customerCapableNodes = activeNodes.filter(node => {
            const capabilities = JSON.parse(node.capabilities || '[]');
            return !capabilities.includes('test') || capabilities.length > 1;
        });

        // CRITICAL: Complete service outage
        if (customerCapableNodes.length === 0 && pendingCount > 0) {
            return {
                level: 'CRITICAL',
                severity: 'COMPLETE_OUTAGE',
                message: `COMPLETE SERVICE OUTAGE: ${pendingCount} jobs pending, 0 customer-capable nodes`,
                pendingJobs: pendingCount,
                activeNodes: customerCapableNodes.length,
                totalNodes: allNodes.length,
                actions: ['IMMEDIATE_OPERATOR_CONTACT', 'HUMAN_ESCALATION']
            };
        }

        // HIGH: Single point of failure with high load
        if (customerCapableNodes.length === 1 && pendingCount > this.thresholds.criticalPendingJobs) {
            return {
                level: 'HIGH',
                severity: 'SINGLE_POINT_FAILURE',
                message: `CRITICAL: Only 1 capable node, ${pendingCount} jobs pending`,
                pendingJobs: pendingCount,
                activeNodes: customerCapableNodes.length,
                actions: ['RECRUIT_NODES', 'CONTACT_OFFLINE_OPERATORS']
            };
        }

        // MEDIUM: Capacity strain
        if (activeNodes.length < this.thresholds.minActiveNodes || pendingCount > this.thresholds.maxPendingJobs) {
            return {
                level: 'MEDIUM',
                severity: 'CAPACITY_STRAIN',
                message: `Capacity concern: ${activeNodes.length} active nodes, ${pendingCount} pending jobs`,
                pendingJobs: pendingCount,
                activeNodes: activeNodes.length,
                actions: ['MONITOR_CLOSELY', 'PREPARE_OUTREACH']
            };
        }

        // LOW: Normal operations
        return {
            level: 'LOW',
            severity: 'NORMAL',
            message: `Normal operations: ${activeNodes.length} active nodes, ${pendingCount} pending jobs`,
            pendingJobs: pendingCount,
            activeNodes: activeNodes.length,
            actions: ['ROUTINE_MONITORING']
        };
    }

    async handleCrisisLevel(status) {
        const alertKey = `${status.level}_${status.severity}`;
        
        // Load existing alerts
        let alerts = {};
        if (fs.existsSync(this.alertsPath)) {
            alerts = JSON.parse(fs.readFileSync(this.alertsPath, 'utf8'));
        }

        const now = Date.now();
        
        // Check if this alert level is new or recurring
        if (!alerts[alertKey]) {
            alerts[alertKey] = {
                firstDetected: now,
                lastAlert: now,
                count: 1,
                resolved: false
            };
            
            this.log(`NEW ${status.level} CRISIS: ${status.message}`);
            
            if (status.level === 'CRITICAL') {
                await this.sendCriticalAlert(status);
            }
        } else {
            alerts[alertKey].count += 1;
            alerts[alertKey].lastSeen = now;
            
            // Escalate if crisis persists
            if (status.level === 'CRITICAL') {
                const persistentMinutes = (now - alerts[alertKey].firstDetected) / (1000 * 60);
                this.log(`PERSISTENT CRITICAL CRISIS: ${persistentMinutes.toFixed(1)} minutes - ${status.message}`);
                
                if (persistentMinutes > 5) {
                    await this.sendEscalatedAlert(status, persistentMinutes);
                }
            }
        }

        // Save updated alerts
        fs.writeFileSync(this.alertsPath, JSON.stringify(alerts, null, 2));
        
        // Return monitoring interval recommendation
        return status.level === 'CRITICAL' || status.level === 'HIGH' 
            ? this.checkInterval 
            : this.normalInterval;
    }

    async sendCriticalAlert(status) {
        this.log(`🚨 SENDING CRITICAL ALERT: ${status.message}`);
        
        // Create urgent alert file for external monitoring
        const alertData = {
            timestamp: new Date().toISOString(),
            level: status.level,
            severity: status.severity,
            message: status.message,
            pendingJobs: status.pendingJobs,
            activeNodes: status.activeNodes,
            actions: status.actions,
            urgency: 'IMMEDIATE_HUMAN_INTERVENTION_REQUIRED'
        };
        
        fs.writeFileSync('URGENT-SERVICE-OUTAGE.json', JSON.stringify(alertData, null, 2));
        
        // Send notifications via multiple channels
        await this.sendCrisisNotifications(status);
        const alertMessage = `🚨 CRITICAL SERVICE OUTAGE ALERT 🚨

${status.message}

Actions Required:
${status.actions.map(action => `- ${action}`).join('\\n')}

Generated: ${new Date().toLocaleString()}
`;
        
        fs.writeFileSync('SERVICE-OUTAGE-ALERT.txt', alertMessage);
    }

    async sendEscalatedAlert(status, persistentMinutes) {
        this.log(`🚨🚨 ESCALATED CRITICAL ALERT: ${persistentMinutes.toFixed(1)} minutes persistent outage`);
        
        // Additional escalation actions for persistent outages
        const escalationData = {
            timestamp: new Date().toISOString(),
            persistentMinutes: persistentMinutes,
            status: status,
            escalationLevel: persistentMinutes > 30 ? 'EMERGENCY' : 'URGENT',
            recommendedActions: [
                'Contact all known operators via all channels',
                'Consider emergency operator recruitment',
                'Prepare customer communication',
                'Escalate to system administrator'
            ]
        };
        
        fs.writeFileSync('ESCALATED-OUTAGE-ALERT.json', JSON.stringify(escalationData, null, 2));
    }

    async runContinuous() {
        this.log('Crisis Prevention Monitor starting...');
        
        const checkCycle = async () => {
            const status = await this.checkCrisisConditions();
            const nextInterval = await this.handleCrisisLevel(status);
            
            // Schedule next check based on crisis level
            setTimeout(checkCycle, nextInterval);
        };
        
        checkCycle();
    }

    async runOnce() {
        const status = await this.checkCrisisConditions();
        return status;
    }
}

// CLI handling
if (require.main === module) {
    const monitor = new CrisisPreventionMonitor();
    
    const args = process.argv.slice(2);
    if (args.includes('--once')) {
        monitor.runOnce().then(status => {
            console.log(JSON.stringify(status, null, 2));
            process.exit(0);
        });
    } else {
        monitor.runContinuous();
    }
}

module.exports = CrisisPreventionMonitor;