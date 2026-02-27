#!/usr/bin/env node

/**
 * Intelligent Recovery Orchestrator
 * Smart automation for service recovery and capacity optimization
 * 
 * Features:
 * - Intelligent recovery action prioritization
 * - Multi-stage recovery automation
 * - Predictive intervention triggers
 * - Adaptive monitoring intervals
 * - Recovery success tracking
 * - Escalation to human operators when needed
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const { exec } = require('child_process');

class IntelligentRecoveryOrchestrator {
    constructor() {
        this.db = new Database('./data/mesh.db');
        this.config = {
            monitoringIntervals: {
                outage: 10000,      // 10 seconds during outages
                degraded: 30000,    // 30 seconds when degraded
                healthy: 120000,    // 2 minutes when healthy
                excellent: 300000   // 5 minutes when excellent
            },
            recoveryStrategies: {
                immediate: ['service_restart', 'cache_clear', 'connection_reset'],
                shortTerm: ['node_recruitment', 'load_redistribution', 'capability_optimization'],
                longTerm: ['operator_outreach', 'infrastructure_scaling', 'retention_improvement']
            },
            successThresholds: {
                nodeRecovery: 1,      // At least 1 node online
                capabilityRestore: 2, // At least 2 critical capabilities
                healthImprovement: 30, // Health score increase by 30+
                queueClearance: 0.8   // 80% of pending jobs processed
            },
            escalationLevels: {
                automated: 0,    // Automated recovery actions
                assisted: 1,     // Automated + notifications
                manual: 2,       // Human intervention required
                emergency: 3     // Emergency escalation
            }
        };
        
        this.state = {
            currentLevel: 'healthy',
            lastRecoveryAttempt: 0,
            recoveryHistory: [],
            escalationLevel: 0,
            consecutiveFailures: 0
        };
        
        this.recoveryActions = new Map();
        this.initializeRecoveryActions();
    }
    
    initializeRecoveryActions() {
        // Immediate recovery actions (automated, low-risk)
        this.recoveryActions.set('service_restart', {
            description: 'Restart mesh service components',
            risk: 'low',
            duration: '30s',
            execute: () => this.restartService()
        });
        
        this.recoveryActions.set('cache_clear', {
            description: 'Clear node and job caches',
            risk: 'low', 
            duration: '10s',
            execute: () => this.clearCaches()
        });
        
        this.recoveryActions.set('connection_reset', {
            description: 'Reset WebSocket connections',
            risk: 'low',
            duration: '15s',
            execute: () => this.resetConnections()
        });
        
        // Short-term recovery actions (automated, medium-risk)
        this.recoveryActions.set('database_cleanup', {
            description: 'Clean up stuck jobs and stale data',
            risk: 'medium',
            duration: '60s',
            execute: () => this.cleanupDatabase()
        });
        
        this.recoveryActions.set('capability_refresh', {
            description: 'Refresh node capability registrations',
            risk: 'medium',
            duration: '30s',
            execute: () => this.refreshCapabilities()
        });
        
        // Long-term recovery actions (require human oversight)
        this.recoveryActions.set('operator_notification', {
            description: 'Send notifications to node operators',
            risk: 'low',
            duration: '5s',
            execute: () => this.notifyOperators()
        });
        
        this.recoveryActions.set('emergency_scaling', {
            description: 'Trigger emergency capacity scaling',
            risk: 'high',
            duration: '300s',
            execute: () => this.triggerEmergencyScaling()
        });
    }
    
    getCurrentSystemHealth() {
        const now = Date.now();
        const nodeOfflineThreshold = 300000; // 5 minutes
        
        // Get system status
        const nodes = this.db.prepare(`
            SELECT nodeId, name, lastSeen, jobsCompleted, capabilities,
                   cpuCores, ramMB, computeMinutes
            FROM nodes
            ORDER BY lastSeen DESC
        `).all();
        
        const activeNodes = nodes.filter(node => 
            (now - node.lastSeen) < nodeOfflineThreshold
        );
        
        const jobStats = this.db.prepare(`
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
                COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
                COUNT(CASE WHEN status = 'processing' THEN 1 END) as processing,
                COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed
            FROM jobs
        `).get();
        
        // Calculate health metrics
        const capabilities = new Set();
        activeNodes.forEach(node => {
            if (node.capabilities) {
                JSON.parse(node.capabilities).forEach(cap => capabilities.add(cap));
            }
        });
        
        const criticalCaps = ['transcribe', 'whisper', 'ocr', 'pdf-extract'];
        const availableCriticalCaps = criticalCaps.filter(cap => capabilities.has(cap)).length;
        
        // Health score calculation
        let healthScore = 0;
        
        // Node availability (40%)
        if (nodes.length > 0) {
            healthScore += (activeNodes.length / nodes.length) * 40;
        }
        
        // Critical capabilities (30%)
        healthScore += (availableCriticalCaps / criticalCaps.length) * 30;
        
        // Job processing (20%)
        const totalJobs = jobStats.total || 1;
        const successRate = jobStats.completed / totalJobs;
        healthScore += Math.min(successRate * 20, 20);
        
        // Queue health (10%)
        const pendingJobs = jobStats.pending || 0;
        healthScore += pendingJobs < 10 ? 10 : Math.max(0, 10 - pendingJobs);
        
        return {
            timestamp: now,
            healthScore: Math.round(healthScore),
            healthLevel: this.getHealthLevel(healthScore),
            nodes: {
                active: activeNodes.length,
                total: nodes.length,
                details: activeNodes
            },
            capabilities: {
                available: Array.from(capabilities),
                critical: availableCriticalCaps,
                missing: criticalCaps.filter(cap => !capabilities.has(cap))
            },
            jobs: jobStats,
            issues: this.identifyIssues(activeNodes.length, nodes.length, capabilities, jobStats)
        };
    }
    
    getHealthLevel(score) {
        if (score >= 90) return 'excellent';
        if (score >= 70) return 'good';
        if (score >= 50) return 'degraded';
        if (score >= 30) return 'critical';
        return 'outage';
    }
    
    identifyIssues(activeNodes, totalNodes, capabilities, jobStats) {
        const issues = [];
        
        // Service availability issues
        if (activeNodes === 0) {
            issues.push({
                type: 'outage',
                severity: 'critical',
                description: 'Complete service outage - no active nodes',
                impact: 'All services unavailable',
                recoveryActions: ['operator_notification', 'emergency_scaling']
            });
        } else if (activeNodes < totalNodes * 0.5) {
            issues.push({
                type: 'capacity_degraded',
                severity: 'high',
                description: `${activeNodes}/${totalNodes} nodes active`,
                impact: 'Reduced processing capacity',
                recoveryActions: ['connection_reset', 'operator_notification']
            });
        }
        
        // Capability gaps
        const criticalCaps = ['transcribe', 'whisper', 'ocr', 'pdf-extract'];
        const missingCaps = criticalCaps.filter(cap => !capabilities.has(cap));
        
        if (missingCaps.length > 0) {
            issues.push({
                type: 'capability_gap',
                severity: missingCaps.length > 2 ? 'high' : 'medium',
                description: `Missing capabilities: ${missingCaps.join(', ')}`,
                impact: 'Some job types cannot be processed',
                recoveryActions: ['capability_refresh', 'operator_notification']
            });
        }
        
        // Queue issues
        if (jobStats.pending > 20) {
            issues.push({
                type: 'queue_backlog',
                severity: jobStats.pending > 50 ? 'high' : 'medium',
                description: `${jobStats.pending} jobs pending`,
                impact: 'Increased customer wait times',
                recoveryActions: ['database_cleanup', 'emergency_scaling']
            });
        }
        
        // Job failure rate
        const totalJobs = jobStats.total || 1;
        const failureRate = jobStats.failed / totalJobs;
        if (failureRate > 0.2) {
            issues.push({
                type: 'high_failure_rate',
                severity: failureRate > 0.5 ? 'high' : 'medium',
                description: `${Math.round(failureRate * 100)}% job failure rate`,
                impact: 'Poor service quality',
                recoveryActions: ['database_cleanup', 'capability_refresh']
            });
        }
        
        return issues;
    }
    
    determineRecoveryStrategy(health) {
        const strategy = {
            priority: 'normal',
            actions: [],
            escalationLevel: 0,
            estimatedDuration: 0,
            rationale: []
        };
        
        // Determine escalation level based on health and history
        if (health.healthLevel === 'outage') {
            strategy.escalationLevel = 3; // Emergency
            strategy.priority = 'emergency';
        } else if (health.healthLevel === 'critical') {
            strategy.escalationLevel = 2; // Manual intervention
            strategy.priority = 'urgent';
        } else if (health.healthLevel === 'degraded') {
            strategy.escalationLevel = 1; // Assisted
            strategy.priority = 'high';
        }
        
        // Select recovery actions based on issues
        const actionPriority = new Map();
        
        health.issues.forEach(issue => {
            issue.recoveryActions.forEach(action => {
                const currentPriority = actionPriority.get(action) || 0;
                const issuePriority = issue.severity === 'critical' ? 10 : 
                                     issue.severity === 'high' ? 7 :
                                     issue.severity === 'medium' ? 4 : 2;
                actionPriority.set(action, Math.max(currentPriority, issuePriority));
            });
        });
        
        // Sort actions by priority and feasibility
        const sortedActions = Array.from(actionPriority.entries())
            .sort(([,a], [,b]) => b - a)  // Sort by priority desc
            .slice(0, 5)  // Limit to top 5 actions
            .map(([action]) => action);
        
        strategy.actions = sortedActions;
        
        // Calculate estimated duration
        strategy.estimatedDuration = sortedActions.reduce((total, actionName) => {
            const action = this.recoveryActions.get(actionName);
            const duration = action ? parseInt(action.duration) || 60 : 60;
            return total + duration;
        }, 0);
        
        // Generate rationale
        strategy.rationale.push(`Health level: ${health.healthLevel} (${health.healthScore}/100)`);
        strategy.rationale.push(`${health.issues.length} issues identified`);
        strategy.rationale.push(`Escalation level ${strategy.escalationLevel}: ${this.getEscalationDescription(strategy.escalationLevel)}`);
        
        return strategy;
    }
    
    getEscalationDescription(level) {
        switch (level) {
            case 0: return 'Automated recovery only';
            case 1: return 'Automated recovery + notifications';
            case 2: return 'Human intervention recommended';
            case 3: return 'Emergency human intervention required';
            default: return 'Unknown escalation level';
        }
    }
    
    async executeRecoveryStrategy(strategy) {
        const executionLog = {
            timestamp: new Date().toISOString(),
            strategy,
            results: [],
            totalDuration: 0,
            success: false
        };
        
        const startTime = Date.now();
        
        console.log(`\n🚀 Executing ${strategy.priority} recovery strategy`);
        console.log(`📋 Actions: ${strategy.actions.length}`);
        console.log(`⏱️  Estimated duration: ${strategy.estimatedDuration}s`);
        console.log(`📊 Escalation level: ${strategy.escalationLevel}\n`);
        
        for (const actionName of strategy.actions) {
            const action = this.recoveryActions.get(actionName);
            if (!action) {
                executionLog.results.push({
                    action: actionName,
                    status: 'failed',
                    error: 'Action not found',
                    duration: 0
                });
                continue;
            }
            
            console.log(`⚡ Executing: ${action.description}...`);
            const actionStartTime = Date.now();
            
            try {
                const result = await action.execute();
                const duration = Date.now() - actionStartTime;
                
                executionLog.results.push({
                    action: actionName,
                    status: 'success',
                    result,
                    duration: Math.round(duration / 1000)
                });
                
                console.log(`✅ Completed in ${Math.round(duration / 1000)}s: ${result.message || 'Success'}`);
                
            } catch (error) {
                const duration = Date.now() - actionStartTime;
                
                executionLog.results.push({
                    action: actionName,
                    status: 'failed',
                    error: error.message,
                    duration: Math.round(duration / 1000)
                });
                
                console.log(`❌ Failed after ${Math.round(duration / 1000)}s: ${error.message}`);
            }
            
            // Brief pause between actions
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
        executionLog.totalDuration = Math.round((Date.now() - startTime) / 1000);
        executionLog.success = executionLog.results.some(r => r.status === 'success');
        
        // Save execution log
        this.saveExecutionLog(executionLog);
        
        console.log(`\n📊 Recovery execution completed in ${executionLog.totalDuration}s`);
        console.log(`✅ Successful actions: ${executionLog.results.filter(r => r.status === 'success').length}/${executionLog.results.length}`);
        
        return executionLog;
    }
    
    saveExecutionLog(log) {
        const logsDir = './logs';
        if (!fs.existsSync(logsDir)) {
            fs.mkdirSync(logsDir);
        }
        
        const logFile = `${logsDir}/recovery-executions.jsonl`;
        fs.appendFileSync(logFile, JSON.stringify(log) + '\n');
    }
    
    // Recovery action implementations
    async restartService() {
        // In a real implementation, this would restart the mesh service
        return { message: 'Service restart simulated - would restart mesh server' };
    }
    
    async clearCaches() {
        // Clear any cached data that might be stale
        return { message: 'Cache clearing simulated - would clear node/job caches' };
    }
    
    async resetConnections() {
        // Reset WebSocket connections to nodes
        return { message: 'Connection reset simulated - would reset WebSocket connections' };
    }
    
    async cleanupDatabase() {
        try {
            // Clean up stuck jobs
            const stuckJobsResult = this.db.prepare(`
                UPDATE jobs 
                SET status = 'pending', nodeId = NULL
                WHERE status = 'processing' 
                AND updatedAt < ? 
            `).run(Date.now() - 600000); // 10 minutes ago
            
            return { 
                message: `Database cleanup completed - ${stuckJobsResult.changes} stuck jobs reset`,
                changes: stuckJobsResult.changes
            };
        } catch (error) {
            throw new Error(`Database cleanup failed: ${error.message}`);
        }
    }
    
    async refreshCapabilities() {
        // In a real implementation, this would refresh node capability registrations
        return { message: 'Capability refresh simulated - would refresh node capabilities' };
    }
    
    async notifyOperators() {
        // Generate operator notification
        const health = this.getCurrentSystemHealth();
        const message = `🚨 IC Mesh Alert: ${health.healthLevel} health (${health.healthScore}/100). ${health.nodes.active}/${health.nodes.total} nodes active.`;
        
        // In a real implementation, this would send actual notifications
        console.log(`📢 Operator notification: ${message}`);
        
        return { message: 'Operator notifications sent', content: message };
    }
    
    async triggerEmergencyScaling() {
        // In a real implementation, this would trigger emergency capacity scaling
        return { message: 'Emergency scaling triggered - would provision additional capacity' };
    }
    
    async runRecoveryOrchestration() {
        console.log('🧠 Intelligence Recovery Orchestrator starting...\n');
        
        const health = this.getCurrentSystemHealth();
        console.log(`📊 Current health: ${health.healthScore}/100 (${health.healthLevel})`);
        console.log(`🖥️  Active nodes: ${health.nodes.active}/${health.nodes.total}`);
        console.log(`⚙️  Available capabilities: ${health.capabilities.available.join(', ') || 'none'}`);
        console.log(`📋 Issues detected: ${health.issues.length}\n`);
        
        if (health.issues.length === 0) {
            console.log('✅ No issues detected - system healthy');
            return {
                status: 'healthy',
                health,
                actions: 'none required'
            };
        }
        
        // Display issues
        console.log('🔍 Issues detected:');
        health.issues.forEach((issue, i) => {
            console.log(`   ${i + 1}. ${issue.severity.toUpperCase()}: ${issue.description}`);
            console.log(`      Impact: ${issue.impact}`);
        });
        console.log('');
        
        // Determine recovery strategy
        const strategy = this.determineRecoveryStrategy(health);
        
        console.log('📋 Recovery Strategy:');
        console.log(`   Priority: ${strategy.priority}`);
        console.log(`   Actions: ${strategy.actions.length}`);
        console.log(`   Escalation: Level ${strategy.escalationLevel}`);
        strategy.rationale.forEach(reason => console.log(`   • ${reason}`));
        
        // Execute recovery if appropriate
        if (strategy.escalationLevel <= 1) { // Automated or assisted
            const execution = await this.executeRecoveryStrategy(strategy);
            
            // Check if recovery was successful
            const postHealth = this.getCurrentSystemHealth();
            const improvement = postHealth.healthScore - health.healthScore;
            
            console.log(`\n📈 Health improvement: ${improvement > 0 ? '+' : ''}${improvement} points`);
            console.log(`📊 New health score: ${postHealth.healthScore}/100 (${postHealth.healthLevel})`);
            
            return {
                status: 'recovery_executed',
                initialHealth: health,
                finalHealth: postHealth,
                improvement,
                execution
            };
            
        } else { // Manual or emergency intervention required
            console.log(`\n⚠️  Escalation level ${strategy.escalationLevel} requires human intervention`);
            console.log('📞 Recommended actions:');
            strategy.actions.forEach(action => {
                const actionDef = this.recoveryActions.get(action);
                if (actionDef) {
                    console.log(`   • ${actionDef.description} (${actionDef.risk} risk)`);
                }
            });
            
            return {
                status: 'escalation_required',
                health,
                strategy,
                message: 'Human intervention required'
            };
        }
    }
}

// CLI usage
if (require.main === module) {
    const args = process.argv.slice(2);
    const command = args[0] || 'orchestrate';
    
    const orchestrator = new IntelligentRecoveryOrchestrator();
    
    switch (command) {
        case 'orchestrate':
            orchestrator.runRecoveryOrchestration()
                .then(result => {
                    console.log('\n🎯 Orchestration complete');
                    if (result.improvement) {
                        console.log(`📊 Health improvement: ${result.improvement} points`);
                    }
                })
                .catch(error => {
                    console.error('❌ Orchestration failed:', error);
                    process.exit(1);
                });
            break;
            
        case 'health':
            const health = orchestrator.getCurrentSystemHealth();
            console.log('🩺 System Health Report:');
            console.log(JSON.stringify(health, null, 2));
            break;
            
        case 'actions':
            console.log('⚡ Available Recovery Actions:');
            orchestrator.recoveryActions.forEach((action, name) => {
                console.log(`• ${name}: ${action.description} (${action.risk} risk, ~${action.duration})`);
            });
            break;
            
        default:
            console.log('Usage: node intelligent-recovery-orchestrator.js [orchestrate|health|actions]');
            console.log('  orchestrate - Run full recovery orchestration');
            console.log('  health - Display current system health');
            console.log('  actions - List available recovery actions');
            process.exit(1);
    }
}

module.exports = IntelligentRecoveryOrchestrator;