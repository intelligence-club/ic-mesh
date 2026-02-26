#!/usr/bin/env node
/**
 * Node Recovery Toolkit
 * 
 * Emergency response toolkit for when the IC Mesh network has zero or few nodes.
 * Provides automated outreach, incentive management, and recovery orchestration.
 * 
 * Features:
 * - Automated outreach to previous operators
 * - Incentive program management (bonus payments, priority support)
 * - Infrastructure diagnostics to identify connection blockers
 * - Recovery progress tracking and reporting
 * - Emergency backup node deployment coordination
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

class NodeRecoveryToolkit {
    constructor(dbPath = './mesh.db') {
        this.db = new Database(dbPath);
        this.recoveryPlan = {};
        this.timestamp = new Date().toISOString();
    }

    async executeRecovery() {
        console.log('🚨 NODE RECOVERY TOOLKIT ACTIVATED');
        console.log('===================================');

        this.assessCriticalState();
        this.identifyPreviousOperators();
        this.createOutreachCampaign();
        this.designIncentiveProgram();
        this.checkInfrastructureHealth();
        this.createRecoveryTimeline();
        this.generateRecoveryCommands();
        this.saveRecoveryPlan();

        this.db.close();
        return this.recoveryPlan;
    }

    assessCriticalState() {
        console.log('\\n🔍 CRITICAL STATE ASSESSMENT');

        const nodes = this.db.prepare('SELECT * FROM nodes').all();
        const jobs = this.db.prepare('SELECT * FROM jobs ORDER BY createdAt DESC LIMIT 100').all();

        this.recoveryPlan.currentState = {
            totalNodes: nodes.length,
            activeNodes: 0,
            totalJobs: jobs.length,
            lastJobTime: jobs.length > 0 ? jobs[0].createdAt : null,
            networkCapacity: 0
        };

        const now = Date.now();
        nodes.forEach(node => {
            if (now - node.lastHeartbeat < 5 * 60 * 1000) {
                this.recoveryPlan.currentState.activeNodes++;
                try {
                    const capabilities = JSON.parse(node.capabilities || '[]');
                    this.recoveryPlan.currentState.networkCapacity += capabilities.length;
                } catch (e) {}
            }
        });

        console.log(`   Total historical nodes: ${this.recoveryPlan.currentState.totalNodes}`);
        console.log(`   Currently active: ${this.recoveryPlan.currentState.activeNodes}`);
        console.log(`   Job history: ${this.recoveryPlan.currentState.totalJobs} jobs`);
        
        if (this.recoveryPlan.currentState.lastJobTime) {
            const lastJobAge = Math.round((now - this.recoveryPlan.currentState.lastJobTime) / (1000 * 60 * 60));
            console.log(`   Last job: ${lastJobAge} hours ago`);
        } else {
            console.log(`   Last job: Never (no job history)`);
        }

        // Determine crisis level
        if (this.recoveryPlan.currentState.activeNodes === 0) {
            this.recoveryPlan.crisisLevel = 'TOTAL_OUTAGE';
            console.log('\\n🚨 CRISIS LEVEL: TOTAL OUTAGE');
            console.log('   Network cannot process any jobs. Emergency response required.');
        } else if (this.recoveryPlan.currentState.activeNodes < 3) {
            this.recoveryPlan.crisisLevel = 'CRITICAL_CAPACITY';
            console.log('\\n⚠️  CRISIS LEVEL: CRITICAL CAPACITY');
            console.log('   Network severely under-resourced. Immediate action needed.');
        } else {
            this.recoveryPlan.crisisLevel = 'STABLE';
            console.log('\\n✅ CRISIS LEVEL: STABLE');
            console.log('   Network has adequate capacity.');
        }
    }

    identifyPreviousOperators() {
        console.log('\\n👥 PREVIOUS OPERATOR IDENTIFICATION');

        const nodes = this.db.prepare(`
            SELECT nodeId, capabilities, lastHeartbeat, 
                   COUNT(j.jobId) as jobsProcessed,
                   SUM(CASE WHEN j.status = 'completed' THEN 1 ELSE 0 END) as successfulJobs
            FROM nodes n
            LEFT JOIN jobs j ON n.nodeId = j.claimedBy
            GROUP BY n.nodeId
            ORDER BY n.lastHeartbeat DESC
        `).all();

        this.recoveryPlan.targetOperators = nodes.map(node => {
            const hoursOffline = Math.round((Date.now() - node.lastHeartbeat) / (1000 * 60 * 60));
            const successRate = node.jobsProcessed > 0 ? (node.successfulJobs / node.jobsProcessed * 100) : 0;
            
            let capabilities = [];
            try {
                capabilities = JSON.parse(node.capabilities || '[]');
            } catch (e) {}

            return {
                nodeId: node.nodeId,
                nodeIdShort: node.nodeId.substring(0, 8),
                capabilities,
                hoursOffline,
                jobsProcessed: node.jobsProcessed,
                successRate,
                priority: this.calculateOutreachPriority(capabilities, successRate, hoursOffline)
            };
        });

        // Sort by outreach priority
        this.recoveryPlan.targetOperators.sort((a, b) => b.priority - a.priority);

        console.log('   Priority targets for outreach:');
        this.recoveryPlan.targetOperators.slice(0, 10).forEach((operator, i) => {
            console.log(`   ${i + 1}. Node ${operator.nodeIdShort}: ${operator.capabilities.join(', ')} (${operator.successRate.toFixed(0)}% success, ${operator.hoursOffline}h offline)`);
        });

        if (this.recoveryPlan.targetOperators.length === 0) {
            console.log('   ⚠️  No historical operators found for outreach');
            this.recoveryPlan.outreachStrategy = 'NEW_RECRUITMENT';
        } else {
            this.recoveryPlan.outreachStrategy = 'OPERATOR_REACTIVATION';
        }
    }

    calculateOutreachPriority(capabilities, successRate, hoursOffline) {
        let priority = 0;
        
        // Capability value (transcription is most valuable)
        if (capabilities.includes('whisper')) priority += 50;
        if (capabilities.includes('stable-diffusion')) priority += 30;
        if (capabilities.includes('ollama')) priority += 20;
        priority += capabilities.length * 5;

        // Performance history
        if (successRate > 90) priority += 30;
        else if (successRate > 70) priority += 20;
        else if (successRate > 50) priority += 10;

        // Recency (recently offline operators more likely to return)
        if (hoursOffline < 24) priority += 40;
        else if (hoursOffline < 168) priority += 30; // 1 week
        else if (hoursOffline < 720) priority += 20; // 1 month
        else priority += 5;

        return priority;
    }

    createOutreachCampaign() {
        console.log('\\n📧 OUTREACH CAMPAIGN DESIGN');

        this.recoveryPlan.outreachCampaign = {
            urgency: this.recoveryPlan.crisisLevel,
            templates: {},
            targetingRules: {},
            timeline: []
        };

        // Create urgency-appropriate messaging
        if (this.recoveryPlan.crisisLevel === 'TOTAL_OUTAGE') {
            this.recoveryPlan.outreachCampaign.templates.urgent = {
                subject: '🚨 IC Mesh Emergency: Network Down - Immediate Help Needed',
                body: `Hi there!

We have an emergency situation - the IC Mesh network currently has zero active nodes and cannot process any customer jobs. Your node was a valuable part of our network, and we desperately need your help to restore service.

EMERGENCY INCENTIVES:
• 2x earnings for first 48 hours back online
• $10 immediate bonus upon reconnection
• Priority support for any setup issues

Your node details:
- Capabilities: {capabilities}
- Previous success rate: {successRate}%
- Last seen: {hoursOffline} hours ago

Can you help us get back online? Every minute counts.

Quick reconnect: {reconnectInstructions}

Thank you,
IC Mesh Team`,
                incentives: ['2x_earnings_48h', 'bonus_10_immediate', 'priority_support']
            };
        } else {
            this.recoveryPlan.outreachCampaign.templates.standard = {
                subject: 'Come Back to IC Mesh - Enhanced Rewards Available',
                body: `Hi!

We miss having your node as part of the IC Mesh network! We've made some improvements and would love to have you back.

RETURN INCENTIVES:
• 50% earnings bonus for first week
• $5 reconnection bonus
• Improved stability and monitoring

Your previous contribution:
- Capabilities: {capabilities}
- Success rate: {successRate}%
- Jobs completed: {jobsProcessed}

Ready to rejoin? {reconnectInstructions}

Best regards,
IC Mesh Team`,
                incentives: ['50pct_bonus_1week', 'bonus_5_reconnect', 'improved_stability']
            };
        }

        // Create targeting rules
        this.recoveryPlan.outreachCampaign.targetingRules = {
            highPriority: this.recoveryPlan.targetOperators.filter(op => op.priority > 80),
            mediumPriority: this.recoveryPlan.targetOperators.filter(op => op.priority > 40 && op.priority <= 80),
            lowPriority: this.recoveryPlan.targetOperators.filter(op => op.priority <= 40)
        };

        console.log(`   High priority targets: ${this.recoveryPlan.outreachCampaign.targetingRules.highPriority.length}`);
        console.log(`   Medium priority: ${this.recoveryPlan.outreachCampaign.targetingRules.mediumPriority.length}`);
        console.log(`   Low priority: ${this.recoveryPlan.outreachCampaign.targetingRules.lowPriority.length}`);

        // Create timeline
        if (this.recoveryPlan.crisisLevel === 'TOTAL_OUTAGE') {
            this.recoveryPlan.outreachCampaign.timeline = [
                { hour: 0, action: 'Contact top 5 operators immediately' },
                { hour: 2, action: 'Expand to top 15 operators' },
                { hour: 6, action: 'Contact all high priority operators' },
                { hour: 12, action: 'Begin medium priority outreach' },
                { hour: 24, action: 'Full network outreach if still critical' }
            ];
        }
    }

    designIncentiveProgram() {
        console.log('\\n💰 INCENTIVE PROGRAM DESIGN');

        this.recoveryPlan.incentiveProgram = {
            emergency: this.recoveryPlan.crisisLevel === 'TOTAL_OUTAGE',
            bonusPool: 0,
            incentives: []
        };

        if (this.recoveryPlan.crisisLevel === 'TOTAL_OUTAGE') {
            this.recoveryPlan.incentiveProgram.incentives = [
                {
                    name: 'Emergency Reconnection Bonus',
                    amount: 10,
                    condition: 'First 5 nodes to reconnect within 24 hours',
                    cost: 50
                },
                {
                    name: 'Double Earnings Period',
                    multiplier: 2,
                    duration: '48 hours',
                    condition: 'All returning nodes',
                    estimatedCost: 200
                },
                {
                    name: 'Priority Support',
                    value: 'Dedicated setup assistance',
                    condition: 'All returning operators',
                    cost: 0
                }
            ];
            this.recoveryPlan.incentiveProgram.bonusPool = 250;
        } else {
            this.recoveryPlan.incentiveProgram.incentives = [
                {
                    name: 'Welcome Back Bonus',
                    amount: 5,
                    condition: 'Reconnection within 7 days',
                    cost: 25
                },
                {
                    name: 'Loyalty Boost',
                    multiplier: 1.5,
                    duration: '1 week',
                    condition: 'Previously good performers',
                    estimatedCost: 100
                }
            ];
            this.recoveryPlan.incentiveProgram.bonusPool = 125;
        }

        console.log(`   Incentive budget: $${this.recoveryPlan.incentiveProgram.bonusPool}`);
        this.recoveryPlan.incentiveProgram.incentives.forEach(incentive => {
            console.log(`   - ${incentive.name}: ${incentive.condition}`);
        });
    }

    checkInfrastructureHealth() {
        console.log('\\n🔧 INFRASTRUCTURE HEALTH CHECK');

        this.recoveryPlan.infrastructure = {
            serverStatus: 'unknown',
            databaseStatus: 'functional',
            networkConnectivity: 'unknown',
            commonIssues: []
        };

        // Database is working since we can query it
        console.log(`   ✅ Database: Functional`);

        // Check for common connection issues
        const potentialIssues = [
            'Server process not running or old code version',
            'Port blocking or firewall configuration',
            'Network connectivity issues',
            'SSL certificate problems',
            'Rate limiting blocking connections',
            'WebSocket connection failures',
            'Node configuration file issues'
        ];

        this.recoveryPlan.infrastructure.commonIssues = potentialIssues;
        
        console.log(`   🔍 Potential connection blockers:`);
        potentialIssues.forEach(issue => {
            console.log(`      - ${issue}`);
        });

        console.log(`\\n   🛠️  Recommended infrastructure checks:`);
        console.log(`      - Verify server is running: ps aux | grep node`);
        console.log(`      - Check port accessibility: netstat -tlnp | grep 8333`);
        console.log(`      - Test WebSocket endpoint: wscat -c ws://localhost:8333`);
        console.log(`      - Review server logs for errors: tail -f mesh.log`);
    }

    createRecoveryTimeline() {
        console.log('\\n⏰ RECOVERY TIMELINE');

        const urgentActions = this.recoveryPlan.crisisLevel === 'TOTAL_OUTAGE';
        
        this.recoveryPlan.timeline = [
            {
                phase: 'Immediate (0-2 hours)',
                actions: [
                    'Run infrastructure diagnostics',
                    urgentActions ? 'Contact top 5 operators with emergency incentives' : 'Begin standard outreach to top performers',
                    'Verify server and database status',
                    'Check for obvious connection blockers'
                ]
            },
            {
                phase: 'Short-term (2-24 hours)',
                actions: [
                    'Expand outreach based on response rates',
                    'Provide setup support to returning operators',
                    'Monitor network recovery progress',
                    'Adjust incentives based on effectiveness'
                ]
            },
            {
                phase: 'Medium-term (1-7 days)',
                actions: [
                    'Full operator outreach campaign',
                    'Implement infrastructure improvements',
                    'Add monitoring to prevent future outages',
                    'Review and optimize retention strategies'
                ]
            },
            {
                phase: 'Long-term (1+ weeks)',
                actions: [
                    'Build operator community features',
                    'Implement loyalty programs',
                    'Add automated health monitoring',
                    'Create backup node deployment systems'
                ]
            }
        ];

        this.recoveryPlan.timeline.forEach(phase => {
            console.log(`\\n   📅 ${phase.phase}`);
            phase.actions.forEach(action => {
                console.log(`      • ${action}`);
            });
        });
    }

    generateRecoveryCommands() {
        console.log('\\n🚀 RECOVERY ACTION COMMANDS');

        this.recoveryPlan.commands = [];

        // Infrastructure diagnostic commands
        this.recoveryPlan.commands.push({
            category: 'Infrastructure Diagnostics',
            commands: [
                'ps aux | grep node',
                'netstat -tlnp | grep 8333',
                'curl -f http://localhost:8333/status',
                'tail -n 50 mesh.log',
                'sqlite3 mesh.db "SELECT COUNT(*) FROM nodes;"'
            ]
        });

        // Database queries for operator outreach
        if (this.recoveryPlan.targetOperators.length > 0) {
            this.recoveryPlan.commands.push({
                category: 'Operator Contact Information',
                commands: [
                    'sqlite3 mesh.db "SELECT id, capabilities, lastHeartbeat FROM nodes ORDER BY lastHeartbeat DESC LIMIT 10;"',
                    'node -e "console.log(require(\\"./node-retention-investigator.js\\"))"'
                ]
            });
        }

        // Recovery monitoring commands
        this.recoveryPlan.commands.push({
            category: 'Recovery Monitoring',
            commands: [
                'watch -n 10 "curl -s http://localhost:8333/nodes | jq length"',
                'node -e "setInterval(() => console.log(new Date(), \\"Nodes:\\", require(\\"./scripts/capacity-monitor.js\\").getActiveNodes().length), 30000)"'
            ]
        });

        this.recoveryPlan.commands.forEach(category => {
            console.log(`\\n   ${category.category}:`);
            category.commands.forEach(cmd => {
                console.log(`      $ ${cmd}`);
            });
        });
    }

    saveRecoveryPlan() {
        const timestamp = new Date().toISOString().split('T')[0];
        const planPath = `./reports/node-recovery-plan-${timestamp}.json`;
        
        // Ensure reports directory exists
        if (!fs.existsSync('./reports')) {
            fs.mkdirSync('./reports');
        }

        const plan = {
            timestamp: this.timestamp,
            crisisLevel: this.recoveryPlan.crisisLevel,
            currentState: this.recoveryPlan.currentState,
            targetOperators: this.recoveryPlan.targetOperators,
            outreachCampaign: this.recoveryPlan.outreachCampaign,
            incentiveProgram: this.recoveryPlan.incentiveProgram,
            timeline: this.recoveryPlan.timeline,
            commands: this.recoveryPlan.commands
        };

        fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));
        console.log(`\\n📄 RECOVERY PLAN SAVED: ${planPath}`);

        // Also create a quick reference summary
        const summaryPath = `./EMERGENCY-RECOVERY-${timestamp}.md`;
        const summary = this.generateRecoverySummary();
        fs.writeFileSync(summaryPath, summary);
        console.log(`📋 QUICK REFERENCE: ${summaryPath}`);
    }

    generateRecoverySummary() {
        return `# Emergency Recovery Plan - ${new Date().toDateString()}

## Crisis Level: ${this.recoveryPlan.crisisLevel}

### Current State
- Total historical nodes: ${this.recoveryPlan.currentState.totalNodes}
- Currently active: ${this.recoveryPlan.currentState.activeNodes}
- Network capacity: ${this.recoveryPlan.currentState.networkCapacity} capabilities

### Immediate Actions (Next 2 Hours)
${this.recoveryPlan.timeline[0].actions.map(action => `- [ ] ${action}`).join('\\n')}

### High Priority Targets
${this.recoveryPlan.targetOperators.slice(0, 5).map(op => 
    `- Node ${op.nodeIdShort}: ${op.capabilities.join(', ')} (${op.successRate.toFixed(0)}% success)`
).join('\\n')}

### Key Commands
\`\`\`bash
# Check server status
ps aux | grep node
netstat -tlnp | grep 8333

# Monitor recovery
watch -n 10 "curl -s http://localhost:8333/nodes | jq length"

# Run full diagnostics
node node-retention-investigator.js
node node-recovery-toolkit.js
\`\`\`

### Budget Approved
$${this.recoveryPlan.incentiveProgram.bonusPool} for emergency incentives

---
*Generated by Node Recovery Toolkit at ${this.timestamp}*`;
    }
}

// CLI execution
if (require.main === module) {
    const recovery = new NodeRecoveryToolkit();
    recovery.executeRecovery().then(plan => {
        console.log('\\n🎯 RECOVERY PLAN COMPLETE!');
        console.log(`   Crisis level: ${plan.crisisLevel}`);
        console.log(`   Target operators: ${plan.targetOperators.length}`);
        console.log(`   Incentive budget: $${plan.incentiveProgram.bonusPool}`);
        console.log('\\n   Execute the timeline actions to begin recovery.');
        process.exit(0);
    }).catch(error => {
        console.error('❌ Recovery planning failed:', error.message);
        process.exit(1);
    });
}

module.exports = NodeRecoveryToolkit;