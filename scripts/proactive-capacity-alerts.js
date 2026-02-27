#!/usr/bin/env node

/**
 * Proactive Capacity Alerts System
 * 
 * Monitors IC Mesh capacity in real-time and generates immediate alerts
 * when nodes go offline that could impact customer service.
 * 
 * Features:
 * - Real-time node monitoring with configurable thresholds
 * - Capability-aware impact assessment (only alerts for critical losses)
 * - Revenue impact calculation for business context
 * - Multi-channel alerting (console, file, future: email/slack)
 * - Rate limiting to prevent alert spam
 * - Automatic recovery detection and all-clear notifications
 * 
 * Usage:
 *   node proactive-capacity-alerts.js [--config=alerts.json] [--test]
 */

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

// Default configuration
const defaultConfig = {
    // Monitoring settings
    checkInterval: 60000, // 1 minute
    offlineThreshold: 5 * 60 * 1000, // 5 minutes
    
    // Alert thresholds
    minJobsForAlert: 5, // Only alert if >= 5 jobs would be affected
    minRevenueForAlert: 15, // Only alert if >= $15 revenue at risk
    
    // Rate limiting
    alertCooldown: 30 * 60 * 1000, // 30 minutes between same-node alerts
    
    // Critical capabilities that require immediate attention
    criticalCapabilities: [
        'transcription', 'transcribe', 'whisper',
        'tesseract', 'ocr', 'pdf-extract',
        'ollama', 'stable-diffusion'
    ],
    
    // Alert channels
    channels: {
        console: true,
        file: 'data/capacity-alerts.log',
        webhook: null // Future: Slack/Discord webhooks
    }
};

class ProactiveCapacityAlerts {
    constructor(options = {}) {
        this.config = { ...defaultConfig, ...options.config };
        this.databasePath = options.databasePath || 'data/mesh.db';
        this.testMode = options.test || false;
        
        // Alert state tracking
        this.lastAlerts = new Map(); // nodeId -> timestamp
        this.lastState = new Map();  // nodeId -> { online, capabilities }
        this.alertHistory = [];
        
        this.log('🚨 Proactive Capacity Alerts starting...', 'SYSTEM');
        if (this.testMode) {
            this.log('⚗️ Running in TEST MODE', 'SYSTEM');
        }
    }
    
    log(message, level = 'INFO', channel = 'console') {
        const timestamp = new Date().toISOString();
        const logMessage = `${timestamp} [${level}] ${message}`;
        
        if (this.config.channels.console && (channel === 'console' || channel === 'all')) {
            console.log(logMessage);
        }
        
        if (this.config.channels.file && (channel === 'file' || channel === 'all')) {
            try {
                const logDir = path.dirname(this.config.channels.file);
                if (!fs.existsSync(logDir)) {
                    fs.mkdirSync(logDir, { recursive: true });
                }
                fs.appendFileSync(this.config.channels.file, logMessage + '\\n');
            } catch (error) {
                console.error('Failed to write to log file:', error.message);
            }
        }
    }
    
    async getDatabase() {
        return new Promise((resolve, reject) => {
            const db = new sqlite3.Database(this.databasePath, (err) => {
                if (err) reject(err);
                else resolve(db);
            });
        });
    }
    
    async getCurrentNodes() {
        const db = await this.getDatabase();
        
        return new Promise((resolve, reject) => {
            db.all(`
                SELECT 
                    nodeId,
                    name,
                    capabilities,
                    lastSeen,
                    owner,
                    jobsCompleted,
                    ROUND((julianday('now') - julianday(datetime(lastSeen/1000, 'unixepoch'))) * 24 * 60) AS minutes_offline
                FROM nodes 
                ORDER BY lastSeen DESC
            `, (err, rows) => {
                db.close();
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }
    
    async getPendingJobsByCapability() {
        const db = await this.getDatabase();
        
        return new Promise((resolve, reject) => {
            db.all(`
                SELECT type, COUNT(*) as count 
                FROM jobs 
                WHERE status = 'pending' 
                GROUP BY type 
                ORDER BY count DESC
            `, (err, rows) => {
                db.close();
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }
    
    parseCapabilities(capabilitiesJson) {
        try {
            return JSON.parse(capabilitiesJson || '[]');
        } catch {
            return [];
        }
    }
    
    calculateRevenue(jobType, count) {
        const rates = {
            'transcribe': { min: 3, max: 5 },
            'transcription': { min: 3, max: 5 },
            'pdf-extract': { min: 3, max: 5 },
            'ocr': { min: 3, max: 5 }
        };
        
        const rate = rates[jobType] || { min: 1, max: 3 };
        return {
            min: count * rate.min,
            max: count * rate.max
        };
    }
    
    assessNodeImpact(nodeCapabilities, pendingJobs) {
        const affectedJobs = [];
        let totalRevenue = { min: 0, max: 0 };
        let totalJobs = 0;
        
        for (const job of pendingJobs) {
            const canHandle = nodeCapabilities.some(cap => {
                return job.type === cap || 
                       (job.type === 'transcribe' && cap === 'transcription') ||
                       (job.type === 'transcription' && cap === 'transcribe') ||
                       (job.type === 'transcribe' && cap === 'whisper');
            });
            
            if (canHandle) {
                const revenue = this.calculateRevenue(job.type, job.count);
                affectedJobs.push({
                    type: job.type,
                    count: job.count,
                    revenue
                });
                totalRevenue.min += revenue.min;
                totalRevenue.max += revenue.max;
                totalJobs += job.count;
            }
        }
        
        return { 
            affectedJobs, 
            totalRevenue, 
            totalJobs,
            isSignificant: totalJobs >= this.config.minJobsForAlert || 
                          totalRevenue.min >= this.config.minRevenueForAlert
        };
    }
    
    isNodeCritical(capabilities) {
        return this.config.criticalCapabilities.some(cap => capabilities.includes(cap));
    }
    
    shouldSendAlert(nodeId, impact) {
        // Check rate limiting
        const lastAlert = this.lastAlerts.get(nodeId);
        if (lastAlert && (Date.now() - lastAlert) < this.config.alertCooldown) {
            return false;
        }
        
        // Check significance thresholds
        return impact.isSignificant;
    }
    
    async sendCapacityAlert(node, impact, alertType = 'OFFLINE') {
        const nodeId = node.nodeId;
        const nodeName = node.name || nodeId.substring(0, 8);
        const capabilities = this.parseCapabilities(node.capabilities);
        
        // Rate limiting check
        if (!this.shouldSendAlert(nodeId, impact)) {
            return false;
        }
        
        // Create alert message
        const severity = impact.totalRevenue.min >= 50 ? 'CRITICAL' : 
                        impact.totalRevenue.min >= 20 ? 'HIGH' : 'MEDIUM';
        
        const alertMessage = this.formatAlert({
            type: alertType,
            severity,
            node: {
                id: nodeId,
                name: nodeName,
                owner: node.owner,
                capabilities: capabilities.filter(cap => this.config.criticalCapabilities.includes(cap)),
                offlineMinutes: node.minutes_offline
            },
            impact: {
                jobs: impact.totalJobs,
                revenue: impact.totalRevenue,
                affectedTypes: impact.affectedJobs.map(j => `${j.count} ${j.type}`).join(', ')
            }
        });
        
        // Send alert through all configured channels
        this.log(alertMessage, severity, 'all');
        
        // Record alert
        this.lastAlerts.set(nodeId, Date.now());
        this.alertHistory.push({
            timestamp: new Date().toISOString(),
            nodeId,
            nodeName,
            type: alertType,
            severity,
            impact: impact.totalRevenue,
            jobs: impact.totalJobs
        });
        
        return true;
    }
    
    formatAlert(data) {
        const { type, severity, node, impact } = data;
        
        if (type === 'OFFLINE') {
            return `🚨 ${severity} CAPACITY ALERT: ${node.name} Node Offline

Node: ${node.name} (${node.owner})
Capabilities Lost: ${node.capabilities.join(', ')}
Offline Duration: ${node.offlineMinutes} minutes

Customer Impact:
• ${impact.jobs} jobs blocked (${impact.affectedTypes})
• Revenue at risk: $${impact.revenue.min}-${impact.revenue.max}

Action Required: Contact ${node.owner} to restore ${node.name} node
Contact: ${node.owner === 'drake' ? 'Discord @drake, claw skill mesh-transcribe' : 'See node owner contact info'}`;

        } else if (type === 'RECOVERY') {
            return `✅ CAPACITY RECOVERED: ${node.name} Node Online

Node: ${node.name} (${node.owner}) back online!
Capabilities Restored: ${node.capabilities.join(', ')}

Customer Service Restored:
• ${impact.jobs} jobs can now be processed
• Revenue unblocked: $${impact.revenue.min}-${impact.revenue.max}

Status: Crisis resolved for ${node.name}`;
        }
        
        return `📊 ${type}: ${node.name} (${severity})`;
    }
    
    async checkCapacityStatus() {
        try {
            const nodes = await this.getCurrentNodes();
            const pendingJobs = await this.getPendingJobsByCapability();
            
            let newOfflineNodes = 0;
            let recoveredNodes = 0;
            
            for (const node of nodes) {
                const nodeId = node.nodeId;
                const capabilities = this.parseCapabilities(node.capabilities);
                
                // Skip non-critical nodes (test-only, etc.)
                if (!this.isNodeCritical(capabilities)) {
                    continue;
                }
                
                const isOnline = node.minutes_offline <= (this.config.offlineThreshold / 60000);
                const lastState = this.lastState.get(nodeId);
                
                // Detect state changes
                if (lastState) {
                    // Node went offline
                    if (lastState.online && !isOnline) {
                        const impact = this.assessNodeImpact(capabilities, pendingJobs);
                        if (await this.sendCapacityAlert(node, impact, 'OFFLINE')) {
                            newOfflineNodes++;
                        }
                    }
                    // Node came back online  
                    else if (!lastState.online && isOnline) {
                        const impact = this.assessNodeImpact(capabilities, pendingJobs);
                        if (impact.isSignificant) {
                            await this.sendCapacityAlert(node, impact, 'RECOVERY');
                            recoveredNodes++;
                        }
                    }
                } else {
                    // First time seeing this node - check if it's offline
                    if (!isOnline) {
                        const impact = this.assessNodeImpact(capabilities, pendingJobs);
                        if (impact.isSignificant) {
                            // Don't spam on startup, just log
                            this.log(`📊 Found offline node: ${node.name || nodeId.substring(0, 8)} (${node.minutes_offline}m offline, $${impact.totalRevenue.min}-${impact.totalRevenue.max} at risk)`, 'INFO');
                        }
                    }
                }
                
                // Update state tracking
                this.lastState.set(nodeId, {
                    online: isOnline,
                    capabilities,
                    lastSeen: node.lastSeen
                });
            }
            
            // Summary logging
            if (newOfflineNodes > 0 || recoveredNodes > 0) {
                this.log(`📊 Capacity changes: ${newOfflineNodes} new offline, ${recoveredNodes} recovered`, 'INFO');
            }
            
        } catch (error) {
            this.log(`❌ Error checking capacity: ${error.message}`, 'ERROR');
        }
    }
    
    async monitor() {
        this.log(`🔍 Starting capacity monitoring (${this.config.checkInterval/1000}s intervals)...`, 'SYSTEM');
        
        // Initial state capture
        await this.checkCapacityStatus();
        
        if (this.testMode) {
            this.log('✅ Test complete - single check performed', 'SYSTEM');
            return;
        }
        
        // Continuous monitoring
        const interval = setInterval(async () => {
            await this.checkCapacityStatus();
        }, this.config.checkInterval);
        
        // Graceful shutdown
        process.on('SIGINT', () => {
            this.log('🛑 Stopping capacity monitoring...', 'SYSTEM');
            this.log(`📊 Alert summary: ${this.alertHistory.length} alerts sent during this session`, 'SYSTEM');
            clearInterval(interval);
            process.exit(0);
        });
        
        // Keep alive
        process.on('uncaughtException', (error) => {
            this.log(`💥 Uncaught error: ${error.message}`, 'ERROR');
            this.log('🔄 Continuing monitoring...', 'SYSTEM');
        });
    }
    
    // Manual testing methods
    async generateTestAlert() {
        const testNode = {
            nodeId: 'test-node-123',
            name: 'test-node',
            owner: 'test-owner',
            capabilities: '["transcription", "whisper"]',
            minutes_offline: 10
        };
        
        const testImpact = {
            totalJobs: 25,
            totalRevenue: { min: 75, max: 125 },
            affectedJobs: [
                { type: 'transcribe', count: 25, revenue: { min: 75, max: 125 } }
            ],
            isSignificant: true
        };
        
        await this.sendCapacityAlert(testNode, testImpact, 'OFFLINE');
        this.log('✅ Test alert sent', 'SYSTEM');
    }
}

// CLI execution
if (require.main === module) {
    const args = process.argv.slice(2);
    
    // Parse arguments
    const options = {
        config: {},
        test: args.includes('--test')
    };
    
    const configArg = args.find(arg => arg.startsWith('--config='));
    if (configArg) {
        const configFile = configArg.split('=')[1];
        try {
            const configData = fs.readFileSync(configFile, 'utf8');
            options.config = JSON.parse(configData);
        } catch (error) {
            console.error(`Failed to load config file ${configFile}:`, error.message);
            process.exit(1);
        }
    }
    
    const monitor = new ProactiveCapacityAlerts(options);
    
    if (args.includes('--test-alert')) {
        monitor.generateTestAlert().then(() => process.exit(0));
    } else {
        monitor.monitor().catch(error => {
            console.error('Fatal error:', error);
            process.exit(1);
        });
    }
}

module.exports = ProactiveCapacityAlerts;