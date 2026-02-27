#!/usr/bin/env node

/**
 * IC Mesh Recovery Assistant
 * 
 * Automated recovery assistance system that helps streamline crisis resolution
 * by providing actionable recovery steps, contact information, and system health
 * verification after recovery actions.
 * 
 * Features:
 * - Automated crisis assessment and prioritization
 * - Contact information lookup for offline nodes
 * - Recovery step generation with specific commands
 * - Post-recovery verification
 * - Integration with existing monitoring systems
 * 
 * Usage:
 *   node recovery-assistant.js --assess        # Assess current crisis severity
 *   node recovery-assistant.js --plan         # Generate recovery action plan
 *   node recovery-assistant.js --contacts     # Show node operator contacts
 *   node recovery-assistant.js --verify       # Verify post-recovery health
 *   node recovery-assistant.js --full         # Complete recovery workflow
 */

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

class RecoveryAssistant {
    constructor() {
        this.dbPath = './data/mesh.db';
        this.contactsPath = './config/node-contacts.json';
        this.recoveryLogPath = './recovery-log.json';
        this.timestamp = new Date().toISOString();
        
        // Recovery severity thresholds
        this.severityThresholds = {
            CRITICAL: { pendingJobs: 50, offlineHours: 1, criticalNodesOffline: 2 },
            HIGH: { pendingJobs: 20, offlineHours: 6, criticalNodesOffline: 1 },
            MEDIUM: { pendingJobs: 10, offlineHours: 24, criticalNodesOffline: 0 },
            LOW: { pendingJobs: 5, offlineHours: 72, criticalNodesOffline: 0 }
        };
        
        // Known node operator contacts
        this.nodeContacts = {
            'miniclaw': {
                operator: 'drake',
                contact: 'Drake via telegram/signal',
                command: 'claw skill mesh-transcribe',
                capabilities: ['transcription', 'whisper', 'ffmpeg', 'gpu-metal']
            },
            'frigg': {
                operator: 'drake', 
                contact: 'Drake via telegram/signal',
                command: 'Contact needed - frigg nodes offline 8+ days',
                capabilities: ['tesseract', 'ollama', 'stable-diffusion', 'pdf-extract', 'ocr']
            },
            'unnamed': {
                operator: 'anonymous',
                contact: 'No contact method available',
                command: 'Monitor for auto-reconnection',
                capabilities: ['transcription']
            }
        };
        
        this.loadRecoveryLog();
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

    loadRecoveryLog() {
        try {
            if (fs.existsSync(this.recoveryLogPath)) {
                this.recoveryLog = JSON.parse(fs.readFileSync(this.recoveryLogPath, 'utf8'));
            } else {
                this.recoveryLog = {
                    sessions: [],
                    lastAssessment: null,
                    criticalAlerts: []
                };
            }
        } catch (error) {
            console.error('Failed to load recovery log:', error.message);
            this.recoveryLog = { sessions: [], lastAssessment: null, criticalAlerts: [] };
        }
    }

    saveRecoveryLog() {
        try {
            fs.writeFileSync(this.recoveryLogPath, JSON.stringify(this.recoveryLog, null, 2));
        } catch (error) {
            console.error('Failed to save recovery log:', error.message);
        }
    }

    async assessCrisisSeverity() {
        const assessment = {
            timestamp: this.timestamp,
            severity: 'LOW',
            metrics: {},
            blockers: [],
            recommendations: []
        };

        try {
            // Get pending jobs
            const pendingJobs = await this.queryDatabase("SELECT type as task, COUNT(*) as count FROM jobs WHERE status = 'pending' GROUP BY type");
            assessment.metrics.pendingJobs = pendingJobs;
            const totalPending = pendingJobs.reduce((sum, job) => sum + job.count, 0);
            assessment.metrics.totalPending = totalPending;

            // Get active nodes
            const activeNodes = await this.queryDatabase(`
                SELECT nodeId, name, capabilities, 
                       ROUND((strftime('%s', 'now') - lastSeen) / 60.0, 1) as minutesAgo
                FROM nodes 
                WHERE (strftime('%s', 'now') - lastSeen) < 300
                ORDER BY lastSeen DESC
            `);
            assessment.metrics.activeNodes = activeNodes;

            // Get offline critical nodes
            const offlineNodes = await this.queryDatabase(`
                SELECT nodeId, name, capabilities,
                       ROUND((strftime('%s', 'now') - lastSeen) / 3600.0, 1) as hoursAgo,
                       jobsCompleted as completedJobs
                FROM nodes 
                WHERE (strftime('%s', 'now') - lastSeen) > 300
                ORDER BY jobsCompleted DESC, lastSeen DESC
            `);
            assessment.metrics.offlineNodes = offlineNodes;

            // Assess severity
            const criticalNodesOffline = offlineNodes.filter(n => n.completedJobs > 10).length;
            const shortestOfflineHours = offlineNodes.length > 0 ? Math.min(...offlineNodes.map(n => n.hoursAgo)) : 0;

            if (totalPending >= this.severityThresholds.CRITICAL.pendingJobs || 
                criticalNodesOffline >= this.severityThresholds.CRITICAL.criticalNodesOffline ||
                activeNodes.length === 0) {
                assessment.severity = 'CRITICAL';
                assessment.blockers.push('Service outage - no processing capacity available');
            } else if (totalPending >= this.severityThresholds.HIGH.pendingJobs ||
                      shortestOfflineHours < this.severityThresholds.HIGH.offlineHours) {
                assessment.severity = 'HIGH';
                assessment.blockers.push('High job backlog with reduced capacity');
            } else if (totalPending >= this.severityThresholds.MEDIUM.pendingJobs) {
                assessment.severity = 'MEDIUM';
                assessment.blockers.push('Moderate capacity constraints');
            }

            // Generate specific blockers
            const capabilities = new Set();
            activeNodes.forEach(node => {
                if (node.capabilities) {
                    JSON.parse(node.capabilities).forEach(cap => capabilities.add(cap));
                }
            });

            pendingJobs.forEach(job => {
                if (!capabilities.has(job.task) && !this.hasCapabilityAlias(job.task, capabilities)) {
                    assessment.blockers.push(`${job.count} ${job.task} jobs blocked - no active nodes with capability`);
                }
            });

            this.recoveryLog.lastAssessment = assessment;
            this.saveRecoveryLog();

            return assessment;
        } catch (error) {
            console.error('Crisis assessment failed:', error.message);
            assessment.error = error.message;
            return assessment;
        }
    }

    hasCapabilityAlias(task, capabilities) {
        const aliases = {
            'transcribe': 'transcription',
            'transcription': 'whisper',
            'ocr': 'tesseract'
        };
        return capabilities.has(aliases[task]);
    }

    async generateRecoveryPlan() {
        const assessment = await this.assessCrisisSeverity();
        const plan = {
            timestamp: this.timestamp,
            severity: assessment.severity,
            actions: [],
            contacts: [],
            estimatedRecoveryTime: '1-2 hours',
            successMetrics: []
        };

        // Analyze offline nodes and generate recovery actions
        const offlineNodes = assessment.metrics.offlineNodes || [];
        const criticalNodes = offlineNodes.filter(node => node.completedJobs > 5)
                                         .sort((a, b) => b.completedJobs - a.completedJobs);

        criticalNodes.forEach(node => {
            const nodeName = node.name || node.nodeId.substring(0, 8);
            const contact = this.nodeContacts[nodeName];
            
            if (contact) {
                plan.actions.push({
                    priority: node.completedJobs > 50 ? 'URGENT' : 'HIGH',
                    action: `Contact ${contact.operator} to restore ${nodeName} node`,
                    command: contact.command,
                    capabilities: contact.capabilities,
                    blockedJobs: this.calculateBlockedJobs(assessment.metrics.pendingJobs, contact.capabilities),
                    potentialRevenue: this.estimateRevenue(contact.capabilities, assessment.metrics.pendingJobs)
                });
                
                if (!plan.contacts.some(c => c.operator === contact.operator)) {
                    plan.contacts.push({
                        operator: contact.operator,
                        contact: contact.contact,
                        nodes: [nodeName]
                    });
                } else {
                    const existingContact = plan.contacts.find(c => c.operator === contact.operator);
                    existingContact.nodes.push(nodeName);
                }
            } else {
                plan.actions.push({
                    priority: 'MEDIUM',
                    action: `Investigate ${nodeName} node recovery options`,
                    command: 'Manual investigation needed',
                    capabilities: ['unknown'],
                    blockedJobs: 0,
                    potentialRevenue: 'unknown'
                });
            }
        });

        // Add system health checks
        plan.actions.push({
            priority: 'LOW',
            action: 'Verify system health post-recovery',
            command: 'node recovery-assistant.js --verify',
            capabilities: ['monitoring'],
            blockedJobs: 0,
            potentialRevenue: 'preventive'
        });

        // Define success metrics
        plan.successMetrics = [
            `Active nodes: ${assessment.metrics.activeNodes.length} → ${assessment.metrics.activeNodes.length + criticalNodes.length}`,
            `Pending jobs: ${assessment.metrics.totalPending} → <20`,
            `Blocked capabilities restored: ${this.getBlockedCapabilities(assessment).join(', ')}`
        ];

        return plan;
    }

    calculateBlockedJobs(pendingJobs, capabilities) {
        return pendingJobs.filter(job => capabilities.includes(job.task) || 
                                       capabilities.includes(this.getCapabilityAlias(job.task)))
                         .reduce((sum, job) => sum + job.count, 0);
    }

    getCapabilityAlias(task) {
        const aliases = {
            'transcribe': 'transcription',
            'transcription': 'whisper',
            'ocr': 'tesseract'
        };
        return aliases[task] || task;
    }

    estimateRevenue(capabilities, pendingJobs) {
        const pricing = { transcribe: 0.30, ocr: 0.50, 'pdf-extract': 0.50, generate: 2.00 };
        let revenue = 0;
        
        pendingJobs.forEach(job => {
            if (capabilities.includes(job.task) || capabilities.includes(this.getCapabilityAlias(job.task))) {
                revenue += (pricing[job.task] || 1.00) * job.count;
            }
        });
        
        return `$${revenue.toFixed(2)}`;
    }

    getBlockedCapabilities(assessment) {
        const activeCapabilities = new Set();
        assessment.metrics.activeNodes.forEach(node => {
            if (node.capabilities) {
                JSON.parse(node.capabilities).forEach(cap => activeCapabilities.add(cap));
            }
        });

        return assessment.metrics.pendingJobs
            .filter(job => !activeCapabilities.has(job.task) && !activeCapabilities.has(this.getCapabilityAlias(job.task)))
            .map(job => job.task);
    }

    async verifyRecovery() {
        console.log('🔍 RECOVERY VERIFICATION');
        console.log('========================');
        
        const currentStatus = await this.assessCrisisSeverity();
        const previousAssessment = this.recoveryLog.lastAssessment;
        
        if (!previousAssessment) {
            console.log('❓ No previous assessment found for comparison');
            return this.displayCurrentHealth(currentStatus);
        }

        // Compare metrics
        const improvements = [];
        const concerns = [];
        
        const prevActive = previousAssessment.metrics.activeNodes?.length || 0;
        const currActive = currentStatus.metrics.activeNodes?.length || 0;
        const prevPending = previousAssessment.metrics.totalPending || 0;
        const currPending = currentStatus.metrics.totalPending || 0;
        
        if (currActive > prevActive) {
            improvements.push(`✅ Active nodes increased: ${prevActive} → ${currActive}`);
        } else if (currActive < prevActive) {
            concerns.push(`⚠️ Active nodes decreased: ${prevActive} → ${currActive}`);
        }
        
        if (currPending < prevPending) {
            improvements.push(`✅ Pending jobs reduced: ${prevPending} → ${currPending}`);
        } else if (currPending > prevPending) {
            concerns.push(`⚠️ Pending jobs increased: ${prevPending} → ${currPending}`);
        }

        // Check severity improvement
        const severityLevels = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
        const prevSeverityLevel = severityLevels.indexOf(previousAssessment.severity);
        const currSeverityLevel = severityLevels.indexOf(currentStatus.severity);
        
        if (currSeverityLevel < prevSeverityLevel) {
            improvements.push(`✅ Severity improved: ${previousAssessment.severity} → ${currentStatus.severity}`);
        } else if (currSeverityLevel > prevSeverityLevel) {
            concerns.push(`⚠️ Severity worsened: ${previousAssessment.severity} → ${currentStatus.severity}`);
        }

        // Display results
        if (improvements.length > 0) {
            console.log('\n✨ IMPROVEMENTS DETECTED:');
            improvements.forEach(improvement => console.log(`  ${improvement}`));
        }
        
        if (concerns.length > 0) {
            console.log('\n⚠️ ONGOING CONCERNS:');
            concerns.forEach(concern => console.log(`  ${concern}`));
        }
        
        if (improvements.length === 0 && concerns.length === 0) {
            console.log('\n➡️ No significant changes detected');
        }

        this.displayCurrentHealth(currentStatus);
        
        return { improvements, concerns, currentStatus };
    }

    displayCurrentHealth(assessment) {
        console.log(`\n🏥 CURRENT HEALTH: ${assessment.severity}`);
        console.log(`Active nodes: ${assessment.metrics.activeNodes?.length || 0}`);
        console.log(`Pending jobs: ${assessment.metrics.totalPending || 0}`);
        
        if (assessment.blockers?.length > 0) {
            console.log('\n🚫 BLOCKERS:');
            assessment.blockers.forEach(blocker => console.log(`  • ${blocker}`));
        }
    }

    async displayContacts() {
        console.log('📞 NODE OPERATOR CONTACTS');
        console.log('==========================');
        
        Object.entries(this.nodeContacts).forEach(([nodeName, contact]) => {
            console.log(`\n🖥️  ${nodeName.toUpperCase()}`);
            console.log(`  Operator: ${contact.operator}`);
            console.log(`  Contact: ${contact.contact}`);
            console.log(`  Command: ${contact.command}`);
            console.log(`  Capabilities: ${contact.capabilities.join(', ')}`);
        });
    }

    async runFullRecoveryWorkflow() {
        console.log('🚀 IC MESH RECOVERY ASSISTANT');
        console.log('==============================');
        
        const assessment = await this.assessCrisisSeverity();
        console.log(`\n🔍 CRISIS ASSESSMENT: ${assessment.severity}`);
        console.log(`Pending jobs: ${assessment.metrics.totalPending || 0}`);
        console.log(`Active nodes: ${assessment.metrics.activeNodes?.length || 0}`);
        
        if (assessment.blockers?.length > 0) {
            console.log('\n🚫 CRITICAL BLOCKERS:');
            assessment.blockers.forEach(blocker => console.log(`  • ${blocker}`));
        }

        const plan = await this.generateRecoveryPlan();
        console.log('\n📋 RECOVERY PLAN:');
        plan.actions.forEach(action => {
            console.log(`\n${action.priority === 'URGENT' ? '🔥' : action.priority === 'HIGH' ? '⚡' : '📝'} ${action.action}`);
            console.log(`   Command: ${action.command}`);
            if (action.blockedJobs > 0) {
                console.log(`   Impact: ${action.blockedJobs} jobs, ${action.potentialRevenue} revenue`);
            }
        });

        if (plan.contacts.length > 0) {
            console.log('\n📞 REQUIRED CONTACTS:');
            plan.contacts.forEach(contact => {
                console.log(`  • ${contact.operator}: ${contact.contact}`);
                console.log(`    Nodes: ${contact.nodes.join(', ')}`);
            });
        }

        console.log(`\n⏱️  Estimated recovery time: ${plan.estimatedRecoveryTime}`);
        console.log('\n✅ SUCCESS METRICS:');
        plan.successMetrics.forEach(metric => console.log(`  • ${metric}`));
        
        // Log this session
        this.recoveryLog.sessions.push({
            timestamp: this.timestamp,
            assessment,
            plan
        });
        this.saveRecoveryLog();

        return { assessment, plan };
    }

    async queryDatabase(sql) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    close() {
        if (this.db) {
            this.db.close();
        }
    }
}

// Command line interface
async function main() {
    const assistant = new RecoveryAssistant();
    
    try {
        await assistant.init();
        
        const args = process.argv.slice(2);
        const command = args[0];

        switch (command) {
            case '--assess':
                const assessment = await assistant.assessCrisisSeverity();
                console.log('🔍 CRISIS ASSESSMENT');
                console.log('===================');
                console.log(`Severity: ${assessment.severity}`);
                console.log(`Pending jobs: ${assessment.metrics.totalPending || 0}`);
                console.log(`Active nodes: ${assessment.metrics.activeNodes?.length || 0}`);
                if (assessment.blockers?.length > 0) {
                    console.log('\nBlockers:');
                    assessment.blockers.forEach(b => console.log(`  • ${b}`));
                }
                break;
                
            case '--plan':
                const plan = await assistant.generateRecoveryPlan();
                console.log('📋 RECOVERY PLAN');
                console.log('================');
                plan.actions.forEach(action => {
                    console.log(`\n${action.priority}: ${action.action}`);
                    console.log(`  Command: ${action.command}`);
                });
                break;
                
            case '--contacts':
                await assistant.displayContacts();
                break;
                
            case '--verify':
                await assistant.verifyRecovery();
                break;
                
            case '--full':
            default:
                await assistant.runFullRecoveryWorkflow();
                break;
        }
    } catch (error) {
        console.error('Recovery assistant failed:', error.message);
        process.exit(1);
    } finally {
        assistant.close();
    }
}

if (require.main === module) {
    main();
}

module.exports = RecoveryAssistant;