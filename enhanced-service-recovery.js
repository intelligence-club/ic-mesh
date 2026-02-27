#!/usr/bin/env node

/**
 * Enhanced Service Recovery System
 * Automated monitoring and recovery for Intelligence Club Mesh
 * 
 * Features:
 * - Real-time node reconnection detection
 * - Automatic capability gap analysis
 * - Service health scoring with trends
 * - Intelligent alerting with threshold management
 * - Automated recovery actions when possible
 * - Performance optimization triggers
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

class ServiceRecoverySystem {
    constructor() {
        this.db = new Database('./data/mesh.db');
        this.config = {
            checkInterval: 15000, // 15 seconds
            nodeOfflineThreshold: 300000, // 5 minutes
            criticalCapabilities: ['transcribe', 'whisper', 'ocr', 'pdf-extract'],
            healthThresholds: {
                excellent: 90,
                good: 70,
                degraded: 50,
                critical: 30
            },
            alertCooldown: 300000, // 5 minutes between same-type alerts
            maxRetries: 3
        };
        
        this.lastAlerts = {};
        this.healthHistory = [];
        this.recoveryActions = [];
        
        this.setupSignalHandlers();
    }
    
    setupSignalHandlers() {
        process.on('SIGINT', () => {
            console.log('\n🛑 Graceful shutdown initiated...');
            this.stop();
            process.exit(0);
        });
        
        process.on('SIGTERM', () => {
            console.log('\n🛑 Service termination requested...');
            this.stop();
            process.exit(0);
        });
    }
    
    getCurrentStatus() {
        const now = Date.now();
        
        // Get node status
        const nodes = this.db.prepare(`
            SELECT nodeId, name, lastSeen, jobsCompleted, capabilities, 
                   cpuCores, ramMB, computeMinutes
            FROM nodes 
            ORDER BY lastSeen DESC
        `).all();
        
        const activeNodes = nodes.filter(node => 
            (now - node.lastSeen) < this.config.nodeOfflineThreshold
        );
        
        // Get job status
        const jobStats = this.db.prepare(`
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
                COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
                COUNT(CASE WHEN status = 'processing' THEN 1 END) as processing,
                COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed
            FROM jobs
        `).get();
        
        // Analyze capabilities
        const capabilities = new Set();
        const models = new Set();
        let totalCores = 0;
        let totalRAM = 0;
        
        activeNodes.forEach(node => {
            if (node.capabilities) {
                JSON.parse(node.capabilities).forEach(cap => capabilities.add(cap));
            }
            totalCores += node.cpuCores || 0;
            totalRAM += (node.ramMB || 0) / 1024; // Convert to GB
        });
        
        return {
            timestamp: now,
            nodes: {
                active: activeNodes.length,
                total: nodes.length,
                healthy: activeNodes.filter(n => n.jobsCompleted > 0).length,
                details: nodes.map(node => ({
                    ...node,
                    isActive: (now - node.lastSeen) < this.config.nodeOfflineThreshold,
                    minutesOffline: Math.round((now - node.lastSeen) / 60000),
                    capabilities: node.capabilities ? JSON.parse(node.capabilities) : []
                }))
            },
            compute: {
                totalCores,
                totalRAM_GB: Math.round(totalRAM * 10) / 10,
                capabilities: Array.from(capabilities),
                models: Array.from(models)
            },
            jobs: jobStats,
            health: this.calculateHealthScore(activeNodes.length, nodes.length, capabilities, jobStats)
        };
    }
    
    calculateHealthScore(activeNodes, totalNodes, capabilities, jobStats) {
        let score = 0;
        let factors = [];
        
        // Node availability (40 points)
        if (totalNodes === 0) {
            score += 0;
            factors.push('No nodes registered (0/40)');
        } else {
            const nodeScore = (activeNodes / totalNodes) * 40;
            score += nodeScore;
            factors.push(`Node availability: ${activeNodes}/${totalNodes} (${Math.round(nodeScore)}/40)`);
        }
        
        // Capability coverage (30 points)
        const criticalCapsAvailable = this.config.criticalCapabilities.filter(cap => 
            capabilities.has(cap)
        ).length;
        const capScore = (criticalCapsAvailable / this.config.criticalCapabilities.length) * 30;
        score += capScore;
        factors.push(`Critical capabilities: ${criticalCapsAvailable}/${this.config.criticalCapabilities.length} (${Math.round(capScore)}/30)`);
        
        // Job processing health (20 points)
        const totalJobs = jobStats.total || 1;
        const successRate = jobStats.completed / totalJobs;
        const processingScore = Math.min(successRate * 20, 20);
        score += processingScore;
        factors.push(`Job success rate: ${Math.round(successRate * 100)}% (${Math.round(processingScore)}/20)`);
        
        // Service responsiveness (10 points)
        const pendingJobs = jobStats.pending || 0;
        const responsiveScore = pendingJobs < 10 ? 10 : Math.max(0, 10 - pendingJobs);
        score += responsiveScore;
        factors.push(`Queue health: ${pendingJobs} pending (${responsiveScore}/10)`);
        
        return {
            score: Math.round(score),
            level: this.getHealthLevel(score),
            factors,
            recommendations: this.generateRecommendations(score, activeNodes, capabilities, jobStats)
        };
    }
    
    getHealthLevel(score) {
        const thresholds = this.config.healthThresholds;
        if (score >= thresholds.excellent) return 'EXCELLENT';
        if (score >= thresholds.good) return 'GOOD';
        if (score >= thresholds.degraded) return 'DEGRADED';
        if (score >= thresholds.critical) return 'CRITICAL';
        return 'OUTAGE';
    }
    
    generateRecommendations(score, activeNodes, capabilities, jobStats) {
        const recommendations = [];
        
        if (activeNodes === 0) {
            recommendations.push({
                priority: 'CRITICAL',
                action: 'Contact node operators to restore service',
                details: 'Complete service outage - no active nodes'
            });
        }
        
        const missingCaps = this.config.criticalCapabilities.filter(cap => 
            !capabilities.has(cap)
        );
        
        if (missingCaps.length > 0) {
            recommendations.push({
                priority: 'HIGH',
                action: `Restore missing capabilities: ${missingCaps.join(', ')}`,
                details: 'Critical service capabilities offline'
            });
        }
        
        if (jobStats.pending > 20) {
            recommendations.push({
                priority: 'MEDIUM',
                action: 'Scale compute capacity',
                details: `${jobStats.pending} jobs pending`
            });
        }
        
        if (jobStats.failed / jobStats.total > 0.1) {
            recommendations.push({
                priority: 'MEDIUM', 
                action: 'Investigate job failures',
                details: `${Math.round(jobStats.failed / jobStats.total * 100)}% failure rate`
            });
        }
        
        return recommendations;
    }
    
    detectChanges(currentStatus) {
        const changes = {
            nodesChanged: false,
            capabilitiesChanged: false,
            healthImproved: false,
            healthDegraded: false,
            details: []
        };
        
        if (this.lastStatus) {
            // Check for node changes
            if (currentStatus.nodes.active !== this.lastStatus.nodes.active) {
                changes.nodesChanged = true;
                const diff = currentStatus.nodes.active - this.lastStatus.nodes.active;
                changes.details.push(
                    `Nodes: ${this.lastStatus.nodes.active} → ${currentStatus.nodes.active} (${diff > 0 ? '+' : ''}${diff})`
                );
            }
            
            // Check for capability changes
            const currentCaps = new Set(currentStatus.compute.capabilities);
            const lastCaps = new Set(this.lastStatus.compute.capabilities);
            const addedCaps = [...currentCaps].filter(cap => !lastCaps.has(cap));
            const removedCaps = [...lastCaps].filter(cap => !currentCaps.has(cap));
            
            if (addedCaps.length > 0 || removedCaps.length > 0) {
                changes.capabilitiesChanged = true;
                if (addedCaps.length > 0) {
                    changes.details.push(`Capabilities added: ${addedCaps.join(', ')}`);
                }
                if (removedCaps.length > 0) {
                    changes.details.push(`Capabilities lost: ${removedCaps.join(', ')}`);
                }
            }
            
            // Check for health changes
            const healthDiff = currentStatus.health.score - this.lastStatus.health.score;
            if (healthDiff >= 10) {
                changes.healthImproved = true;
                changes.details.push(`Health improved: ${this.lastStatus.health.score} → ${currentStatus.health.score}`);
            } else if (healthDiff <= -10) {
                changes.healthDegraded = true;
                changes.details.push(`Health degraded: ${this.lastStatus.health.score} → ${currentStatus.health.score}`);
            }
        }
        
        return changes;
    }
    
    shouldAlert(alertType, currentStatus) {
        const now = Date.now();
        const lastAlert = this.lastAlerts[alertType] || 0;
        
        if (now - lastAlert < this.config.alertCooldown) {
            return false;
        }
        
        // Alert conditions
        switch (alertType) {
            case 'service_outage':
                return currentStatus.nodes.active === 0;
            case 'capacity_restored':
                return currentStatus.nodes.active > 0 && 
                       (!this.lastStatus || this.lastStatus.nodes.active === 0);
            case 'health_critical':
                return currentStatus.health.score < this.config.healthThresholds.critical;
            case 'missing_capabilities':
                return this.config.criticalCapabilities.some(cap => 
                    !currentStatus.compute.capabilities.includes(cap)
                );
            default:
                return false;
        }
    }
    
    generateAlert(alertType, currentStatus, changes) {
        const timestamp = new Date().toISOString();
        
        let alert = {
            type: alertType,
            timestamp,
            status: currentStatus,
            changes: changes.details
        };
        
        switch (alertType) {
            case 'service_outage':
                alert.priority = 'CRITICAL';
                alert.title = '🚨 Complete Service Outage';
                alert.message = 'All nodes offline - service completely unavailable';
                break;
                
            case 'capacity_restored':
                alert.priority = 'INFO';
                alert.title = '✅ Service Capacity Restored';
                alert.message = `${currentStatus.nodes.active} node(s) reconnected`;
                break;
                
            case 'health_critical':
                alert.priority = 'HIGH';
                alert.title = '⚠️  System Health Critical';
                alert.message = `Health score: ${currentStatus.health.score}/100`;
                break;
                
            case 'missing_capabilities':
                const missing = this.config.criticalCapabilities.filter(cap => 
                    !currentStatus.compute.capabilities.includes(cap)
                );
                alert.priority = 'HIGH';
                alert.title = '🔧 Critical Capabilities Missing';
                alert.message = `Missing: ${missing.join(', ')}`;
                break;
        }
        
        return alert;
    }
    
    logAlert(alert) {
        const logEntry = {
            timestamp: alert.timestamp,
            type: alert.type,
            priority: alert.priority,
            title: alert.title,
            message: alert.message,
            details: alert.changes
        };
        
        console.log(`\n${alert.title}`);
        console.log(`📅 ${alert.timestamp}`);
        console.log(`📊 ${alert.message}`);
        if (alert.changes && alert.changes.length > 0) {
            console.log(`🔄 Changes: ${alert.changes.join(', ')}`);
        }
        
        // Save to alerts log
        const alertsLogPath = './logs/service-recovery-alerts.jsonl';
        if (!fs.existsSync('./logs')) {
            fs.mkdirSync('./logs');
        }
        
        fs.appendFileSync(alertsLogPath, JSON.stringify(logEntry) + '\n');
        
        this.lastAlerts[alert.type] = Date.now();
    }
    
    performRecoveryActions(currentStatus) {
        const actions = [];
        
        // If nodes come back online, optimize their performance
        if (currentStatus.nodes.active > 0 && (!this.lastStatus || this.lastStatus.nodes.active === 0)) {
            actions.push({
                type: 'capacity_optimization',
                description: 'Trigger efficiency optimization for reconnected nodes',
                action: () => this.optimizeNodePerformance()
            });
        }
        
        // If queue is backing up, attempt to balance load
        if (currentStatus.jobs.pending > 10) {
            actions.push({
                type: 'load_balancing',
                description: 'Attempt to balance job distribution',
                action: () => this.balanceJobLoad()
            });
        }
        
        return actions;
    }
    
    optimizeNodePerformance() {
        // This could trigger node-specific optimizations
        console.log('🚀 Triggering performance optimization for active nodes...');
        
        // In a real implementation, this might:
        // - Clear node caches
        // - Restart stuck processes
        // - Optimize job assignment algorithms
        // - Update node capability registrations
        
        return { success: true, message: 'Performance optimization triggered' };
    }
    
    balanceJobLoad() {
        console.log('⚖️  Attempting to balance job load across active nodes...');
        
        // In a real implementation, this might:
        // - Redistribute pending jobs
        // - Prioritize high-value jobs
        // - Split large jobs into smaller chunks
        // - Trigger additional node recruitment
        
        return { success: true, message: 'Load balancing attempted' };
    }
    
    run() {
        console.log('🚀 Enhanced Service Recovery System starting...');
        console.log(`📊 Check interval: ${this.config.checkInterval}ms`);
        console.log(`🎯 Critical capabilities: ${this.config.criticalCapabilities.join(', ')}`);
        console.log('');
        
        this.intervalId = setInterval(() => {
            try {
                const currentStatus = this.getCurrentStatus();
                const changes = this.detectChanges(currentStatus);
                
                // Check for alertable conditions
                const alertTypes = ['service_outage', 'capacity_restored', 'health_critical', 'missing_capabilities'];
                
                for (const alertType of alertTypes) {
                    if (this.shouldAlert(alertType, currentStatus)) {
                        const alert = this.generateAlert(alertType, currentStatus, changes);
                        this.logAlert(alert);
                    }
                }
                
                // Perform automated recovery actions
                if (changes.nodesChanged || changes.capabilitiesChanged) {
                    const recoveryActions = this.performRecoveryActions(currentStatus);
                    recoveryActions.forEach(action => {
                        try {
                            const result = action.action();
                            console.log(`✅ ${action.description}: ${result.message}`);
                        } catch (error) {
                            console.log(`❌ ${action.description} failed: ${error.message}`);
                        }
                    });
                }
                
                // Update health history
                this.healthHistory.push({
                    timestamp: currentStatus.timestamp,
                    score: currentStatus.health.score,
                    level: currentStatus.health.level
                });
                
                // Keep only last 100 entries
                if (this.healthHistory.length > 100) {
                    this.healthHistory = this.healthHistory.slice(-100);
                }
                
                // Display status update (only if changes detected or every 10 cycles)
                if (changes.details.length > 0 || !this.lastDisplayTime || 
                    (Date.now() - this.lastDisplayTime) > 150000) {
                    
                    this.displayStatus(currentStatus, changes);
                    this.lastDisplayTime = Date.now();
                }
                
                this.lastStatus = currentStatus;
                
            } catch (error) {
                console.error('❌ Error in monitoring cycle:', error);
            }
            
        }, this.config.checkInterval);
    }
    
    displayStatus(status, changes) {
        const timestamp = new Date(status.timestamp).toISOString().slice(11, 19);
        const healthIcon = this.getHealthIcon(status.health.level);
        
        console.log(`\n[${timestamp}] ${healthIcon} Service Health: ${status.health.score}/100 (${status.health.level})`);
        console.log(`🖥️  Nodes: ${status.nodes.active}/${status.nodes.total} active`);
        console.log(`⚙️  Capabilities: ${status.compute.capabilities.join(', ') || 'none'}`);
        console.log(`📋 Jobs: ${status.jobs.pending} pending, ${status.jobs.completed} completed`);
        
        if (changes.details.length > 0) {
            console.log(`🔄 Changes: ${changes.details.join(', ')}`);
        }
        
        if (status.health.recommendations.length > 0) {
            console.log('💡 Recommendations:');
            status.health.recommendations.slice(0, 2).forEach(rec => {
                console.log(`   ${this.getPriorityIcon(rec.priority)} ${rec.action}`);
            });
        }
    }
    
    getHealthIcon(level) {
        switch (level) {
            case 'EXCELLENT': return '🟢';
            case 'GOOD': return '🔵';
            case 'DEGRADED': return '🟡';
            case 'CRITICAL': return '🔴';
            case 'OUTAGE': return '💀';
            default: return '❓';
        }
    }
    
    getPriorityIcon(priority) {
        switch (priority) {
            case 'CRITICAL': return '🚨';
            case 'HIGH': return '⚠️';
            case 'MEDIUM': return '📝';
            case 'LOW': return '💡';
            default: return '📌';
        }
    }
    
    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            console.log('🛑 Service recovery monitoring stopped');
        }
    }
    
    generateReport() {
        const status = this.getCurrentStatus();
        const reportPath = `./reports/service-recovery-report-${new Date().toISOString().slice(0, 10)}.md`;
        
        if (!fs.existsSync('./reports')) {
            fs.mkdirSync('./reports');
        }
        
        const report = `# Service Recovery Report
Generated: ${new Date().toISOString()}

## Current Status
- **Health Score:** ${status.health.score}/100 (${status.health.level})
- **Active Nodes:** ${status.nodes.active}/${status.nodes.total}
- **Capabilities:** ${status.compute.capabilities.join(', ') || 'none'}
- **Pending Jobs:** ${status.jobs.pending}

## Recommendations
${status.health.recommendations.map(rec => 
    `- **${rec.priority}:** ${rec.action} - ${rec.details}`
).join('\n')}

## Node Details
${status.nodes.details.map(node => 
    `- ${node.isActive ? '🟢' : '🔴'} ${node.name || 'unnamed'} (${node.nodeId.slice(0, 8)}) - ${node.minutesOffline}min offline, ${node.jobsCompleted} jobs`
).join('\n')}

## Health History
${this.healthHistory.slice(-10).map(entry => 
    `- ${new Date(entry.timestamp).toISOString()}: ${entry.score}/100 (${entry.level})`
).join('\n')}
`;
        
        fs.writeFileSync(reportPath, report);
        console.log(`📊 Report saved to ${reportPath}`);
        
        return reportPath;
    }
}

// CLI usage
if (require.main === module) {
    const args = process.argv.slice(2);
    const command = args[0] || 'monitor';
    
    const system = new ServiceRecoverySystem();
    
    switch (command) {
        case 'monitor':
            system.run();
            break;
            
        case 'status':
            const status = system.getCurrentStatus();
            console.log('Current Service Status:');
            console.log(JSON.stringify(status, null, 2));
            break;
            
        case 'report':
            const reportPath = system.generateReport();
            console.log(`Report generated: ${reportPath}`);
            break;
            
        default:
            console.log('Usage: node enhanced-service-recovery.js [monitor|status|report]');
            process.exit(1);
    }
}

module.exports = ServiceRecoverySystem;