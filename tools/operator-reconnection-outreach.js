#!/usr/bin/env node

/**
 * Operator Reconnection Outreach Tool
 * Identifies and creates outreach templates for re-engaging healthy but offline nodes
 * Part of node retention improvement strategy
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs').promises;

class OperatorReconnectionOutreach {
    constructor() {
        this.db = new Database(path.join(__dirname, '..', 'data', 'mesh.db'), { readonly: true });
    }

    async generateOutreachCampaign() {
        console.log('🔄 Operator Reconnection Outreach Campaign');
        console.log('==========================================\n');

        try {
            const disconnectedNodes = await this.findDisconnectedNodes();
            const prioritizedTargets = this.prioritizeOutreach(disconnectedNodes);
            
            console.log(`📊 Analysis Results:`);
            console.log(`   Total disconnected nodes: ${disconnectedNodes.length}`);
            console.log(`   High-priority targets: ${prioritizedTargets.high.length}`);
            console.log(`   Medium-priority targets: ${prioritizedTargets.medium.length}`);
            console.log(`   Low-priority targets: ${prioritizedTargets.low.length}\n`);

            await this.generateOutreachMaterials(prioritizedTargets);
            await this.createActionPlan(prioritizedTargets);

            console.log('\n✅ Reconnection outreach campaign generated');
            
        } catch (error) {
            console.error('❌ Outreach generation failed:', error);
        } finally {
            this.db.close();
        }
    }

    async findDisconnectedNodes() {
        const oneHourAgo = Date.now() - (60 * 60 * 1000);
        const nodes = await this.getAllNodes();
        const disconnected = [];

        for (const node of nodes) {
            if (node.lastSeen < oneHourAgo) {
                const analysis = await this.analyzeDisconnectedNode(node);
                disconnected.push({
                    ...node,
                    analysis
                });
            }
        }

        return disconnected;
    }

    async analyzeDisconnectedNode(node) {
        const jobs = await this.getNodeJobs(node.nodeId);
        const performance = this.analyzePerformance(jobs);
        const capabilities = this.parseCapabilities(node.capabilities);
        
        const analysis = {
            hoursOffline: Math.round((Date.now() - node.lastSeen) / (1000 * 60 * 60)),
            daysRegistered: Math.round((Date.now() - node.registeredAt) / (1000 * 60 * 60 * 24)),
            sessionLength: Math.round((node.lastSeen - node.registeredAt) / (1000 * 60)),
            performance,
            capabilities,
            estimatedEarnings: this.calculateEstimatedEarnings(performance),
            reconnectionValue: this.calculateReconnectionValue(performance, capabilities)
        };

        return analysis;
    }

    prioritizeOutreach(disconnectedNodes) {
        const priorities = { high: [], medium: [], low: [] };

        for (const node of disconnectedNodes) {
            const score = this.calculateOutreachPriority(node);
            
            if (score >= 80) {
                priorities.high.push({ ...node, score });
            } else if (score >= 60) {
                priorities.medium.push({ ...node, score });
            } else {
                priorities.low.push({ ...node, score });
            }
        }

        // Sort by score within each priority
        for (const priority of Object.values(priorities)) {
            priority.sort((a, b) => b.score - a.score);
        }

        return priorities;
    }

    calculateOutreachPriority(node) {
        let score = 0;
        const analysis = node.analysis;

        // Performance factor (0-40 points)
        if (analysis.performance.successRate >= 90) score += 40;
        else if (analysis.performance.successRate >= 75) score += 30;
        else if (analysis.performance.successRate >= 50) score += 20;
        else score += 10;

        // Job volume factor (0-20 points)
        if (analysis.performance.total >= 20) score += 20;
        else if (analysis.performance.total >= 10) score += 15;
        else if (analysis.performance.total >= 5) score += 10;
        else score += 5;

        // Capability value (0-20 points)
        const criticalCaps = ['whisper', 'ffmpeg', 'ollama'].filter(cap => 
            analysis.capabilities.includes(cap)
        ).length;
        score += criticalCaps * 7; // Up to 21 points for 3 critical capabilities

        // Session length factor (0-10 points)
        if (analysis.sessionLength > 1440) score += 10; // >24 hours
        else if (analysis.sessionLength > 240) score += 7; // >4 hours
        else if (analysis.sessionLength > 60) score += 5; // >1 hour
        else score += 2;

        // Recent activity factor (0-10 points)
        if (analysis.hoursOffline < 24) score += 10;
        else if (analysis.hoursOffline < 72) score += 7;
        else if (analysis.hoursOffline < 168) score += 5; // 1 week
        else score += 2;

        return Math.min(score, 100);
    }

    async generateOutreachMaterials(prioritizedTargets) {
        console.log('📝 Generating Outreach Materials\n');

        const outreachData = {
            campaign: {
                generated: new Date().toISOString(),
                totalTargets: Object.values(prioritizedTargets).flat().length,
                estimatedValue: this.calculateCampaignValue(prioritizedTargets)
            },
            targets: prioritizedTargets,
            templates: this.createOutreachTemplates(),
            instructions: this.createOutreachInstructions()
        };

        const outputFile = path.join(__dirname, '..', 'reconnection-outreach-campaign.json');
        await fs.writeFile(outputFile, JSON.stringify(outreachData, null, 2));

        console.log(`💾 Saved campaign data to: ${outputFile}`);

        // Generate individual outreach messages
        await this.generateIndividualOutreach(prioritizedTargets);
    }

    async generateIndividualOutreach(prioritizedTargets) {
        const outreachDir = path.join(__dirname, '..', 'outreach');
        await fs.mkdir(outreachDir, { recursive: true });

        const allTargets = Object.entries(prioritizedTargets).flatMap(([priority, nodes]) => 
            nodes.map(node => ({ ...node, priority }))
        );

        for (const target of allTargets) {
            const message = this.generatePersonalizedMessage(target);
            const filename = `${target.nodeId.substring(0, 8)}-${target.priority}.md`;
            const filepath = path.join(outreachDir, filename);
            
            await fs.writeFile(filepath, message);
        }

        console.log(`📧 Generated ${allTargets.length} personalized outreach messages in outreach/`);
    }

    generatePersonalizedMessage(target) {
        const template = this.selectTemplate(target);
        const node = target;
        const analysis = node.analysis;

        return `# Reconnection Outreach - Node ${node.nodeId.substring(0, 8)}

## Target Analysis
- **Priority:** ${target.priority.toUpperCase()}
- **Score:** ${target.score}/100
- **Owner:** ${node.owner || 'unknown'}
- **Offline:** ${analysis.hoursOffline} hours
- **Success Rate:** ${analysis.performance.successRate}%
- **Jobs Completed:** ${analysis.performance.completed}
- **Capabilities:** ${analysis.capabilities.join(', ')}

## Personalized Message

### Subject: ${template.subject}

${template.content
    .replace('{nodeId}', node.nodeId.substring(0, 8))
    .replace('{owner}', node.owner || 'Operator')
    .replace('{hoursOffline}', analysis.hoursOffline)
    .replace('{successRate}', analysis.performance.successRate)
    .replace('{jobsCompleted}', analysis.performance.completed)
    .replace('{estimatedEarnings}', this.formatCurrency(analysis.estimatedEarnings))
    .replace('{missedEarnings}', this.formatCurrency(this.calculateMissedEarnings(analysis)))
    .replace('{capabilities}', analysis.capabilities.join(', '))}

## Follow-up Actions
1. Send initial outreach within 24 hours
2. If no response in 3 days, send technical support offer
3. If no response in 1 week, send final re-engagement attempt
4. Track response and update campaign metrics

## Technical Support Ready
- Diagnostic command: \`node tools/comprehensive-node-diagnosis.js ${node.nodeId}\`
- Common issues: ${this.identifyLikelyIssues(analysis).join(', ')}
- Setup assistance available

---
*Generated on ${new Date().toISOString()} by Operator Reconnection Outreach Tool*`;
    }

    selectTemplate(target) {
        const templates = this.createOutreachTemplates();
        
        if (target.priority === 'high' && target.analysis.performance.successRate >= 90) {
            return templates.highValueReconnect;
        } else if (target.priority === 'high') {
            return templates.highPriorityReconnect;
        } else if (target.analysis.hoursOffline < 48) {
            return templates.recentDisconnect;
        } else {
            return templates.standardReconnect;
        }
    }

    createOutreachTemplates() {
        return {
            highValueReconnect: {
                subject: "IC Mesh: Your high-performing node is missed!",
                content: `Hi {owner},

I noticed your IC Mesh node ({nodeId}) went offline {hoursOffline} hours ago. 

Your node was one of our top performers:
• {successRate}% success rate
• {jobsCompleted} jobs completed successfully
• Valuable capabilities: {capabilities}

The network has been missing your reliable capacity. While offline, 
you've potentially missed ${this.formatCurrency('{missedEarnings}')} in earnings.

Would you like help getting back online? I can provide:
✅ Personal technical support
✅ Setup verification
✅ Performance optimization tips

Your node made a real difference to our network quality. 
Let's get you back up and earning!

Best regards,
IC Mesh Network Team`
            },

            highPriorityReconnect: {
                subject: "IC Mesh: Let's get your node back online",
                content: `Hi {owner},

Your IC Mesh node ({nodeId}) has been offline for {hoursOffline} hours.

Your contribution to the network:
• {jobsCompleted} jobs completed
• {successRate}% success rate
• Total estimated earnings: ${this.formatCurrency('{estimatedEarnings}')}

I'd like to help you reconnect and optimize your setup. 
Common reconnection steps:
1. Restart the IC Mesh client
2. Check internet connectivity
3. Verify configuration settings

Need assistance? I can provide personalized support to 
get you back online quickly.

Best regards,
IC Mesh Network Team`
            },

            recentDisconnect: {
                subject: "IC Mesh: Quick reconnection help",
                content: `Hi {owner},

Your IC Mesh node ({nodeId}) disconnected recently.

Quick reconnection checklist:
□ Internet connection stable
□ IC Mesh client running
□ No firewall blocking connections

Your node was performing well ({successRate}% success rate) 
and the network would benefit from your return.

Need help troubleshooting? Our diagnostic tools can identify 
issues quickly.

Best regards,
IC Mesh Network Team`
            },

            standardReconnect: {
                subject: "IC Mesh: We'd love to have you back",
                content: `Hi {owner},

Your IC Mesh node ({nodeId}) has been offline for {hoursOffline} hours.

Since you've been away:
• Network capacity has been reduced
• You've missed potential earnings
• Other operators are handling additional load

Reconnection is usually straightforward:
1. Restart the client application
2. Check for any error messages
3. Verify your configuration

The distributed computing space is growing rapidly, 
and reliable operators like you are valuable to the ecosystem.

Ready to rejoin? I'm here to help.

Best regards,
IC Mesh Network Team`
            }
        };
    }

    createOutreachInstructions() {
        return {
            overview: "Re-engage disconnected operators who previously contributed value to the network",
            prioritization: "Focus on high-performing nodes first, then recent disconnects",
            timing: "Send outreach within 24-48 hours of disconnect detection",
            followUp: "3-day intervals: initial → technical support → final attempt",
            success_metrics: ["Response rate >20%", "Reconnection rate >10%", "Sustained operation >7 days"],
            personalization: [
                "Use actual performance data",
                "Reference specific capabilities",
                "Calculate real earnings impact",
                "Acknowledge their contribution"
            ],
            technical_support: [
                "Offer diagnostic tool runs",
                "Provide setup verification",
                "Share troubleshooting guides",
                "Schedule assistance calls if needed"
            ]
        };
    }

    async createActionPlan(prioritizedTargets) {
        console.log('📋 Reconnection Action Plan\n');
        
        const plan = {
            immediate: [],
            shortTerm: [],
            longTerm: []
        };

        // High priority targets - immediate action
        for (const target of prioritizedTargets.high) {
            plan.immediate.push({
                action: `Contact ${target.owner || target.nodeId.substring(0, 8)} about high-value node`,
                priority: 'high',
                estimatedTime: '15 min',
                expectedReturn: this.formatCurrency(target.analysis.reconnectionValue)
            });
        }

        // Recent disconnects - short term
        const recentDisconnects = prioritizedTargets.medium.filter(n => n.analysis.hoursOffline < 72);
        for (const target of recentDisconnects) {
            plan.shortTerm.push({
                action: `Follow up with ${target.owner || target.nodeId.substring(0, 8)}`,
                priority: 'medium',
                estimatedTime: '10 min',
                expectedReturn: this.formatCurrency(target.analysis.reconnectionValue * 0.7)
            });
        }

        // Long-term disconnects - batch outreach
        plan.longTerm.push({
            action: `Batch outreach to ${prioritizedTargets.low.length} long-term disconnected nodes`,
            priority: 'low',
            estimatedTime: '2 hours',
            expectedReturn: this.formatCurrency(
                prioritizedTargets.low.reduce((sum, n) => sum + n.analysis.reconnectionValue, 0) * 0.3
            )
        });

        const actionPlanFile = path.join(__dirname, '..', 'reconnection-action-plan.md');
        const planContent = this.formatActionPlan(plan, prioritizedTargets);
        await fs.writeFile(actionPlanFile, planContent);

        console.log(`📋 Saved action plan to: ${actionPlanFile}`);
        console.log(`\n📊 Campaign Summary:`);
        console.log(`   Total potential value: ${this.formatCurrency(this.calculateCampaignValue(prioritizedTargets))}`);
        console.log(`   Immediate actions: ${plan.immediate.length}`);
        console.log(`   Short-term actions: ${plan.shortTerm.length}`);
        console.log(`   Long-term actions: ${plan.longTerm.length}`);
    }

    formatActionPlan(plan, prioritizedTargets) {
        return `# Operator Reconnection Action Plan
Generated: ${new Date().toISOString()}

## Campaign Overview
- **Total targets:** ${Object.values(prioritizedTargets).flat().length}
- **High priority:** ${prioritizedTargets.high.length}
- **Medium priority:** ${prioritizedTargets.medium.length}  
- **Low priority:** ${prioritizedTargets.low.length}
- **Estimated campaign value:** ${this.formatCurrency(this.calculateCampaignValue(prioritizedTargets))}

## Immediate Actions (Next 24 Hours)
${plan.immediate.map(action => 
`- [ ] ${action.action} (${action.estimatedTime}, expected return: ${action.expectedReturn})`
).join('\n')}

## Short-term Actions (Next 3 Days)
${plan.shortTerm.map(action => 
`- [ ] ${action.action} (${action.estimatedTime}, expected return: ${action.expectedReturn})`
).join('\n')}

## Long-term Actions (Next Week)
${plan.longTerm.map(action => 
`- [ ] ${action.action} (${action.estimatedTime}, expected return: ${action.expectedReturn})`
).join('\n')}

## Success Tracking
- [ ] Track email open rates
- [ ] Monitor reconnection responses
- [ ] Measure sustained operation (>7 days)
- [ ] Calculate ROI of outreach effort

## Templates and Materials
- Individual outreach messages: \`outreach/\` directory
- Campaign data: \`reconnection-outreach-campaign.json\`
- Diagnostic tools: \`tools/comprehensive-node-diagnosis.js\`

---
*Reconnection outreach is most effective within 48 hours of disconnect detection*`;
    }

    calculateCampaignValue(prioritizedTargets) {
        return Object.values(prioritizedTargets)
            .flat()
            .reduce((sum, node) => sum + node.analysis.reconnectionValue, 0);
    }

    // Helper methods
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

    calculateEstimatedEarnings(performance) {
        return performance.completed * 0.10; // $0.10 per completed job estimate
    }

    calculateMissedEarnings(analysis) {
        const dailyRate = analysis.performance.total > 0 ? 
            (analysis.performance.completed / analysis.daysRegistered) * 0.10 : 0.50;
        return Math.max(0, (analysis.hoursOffline / 24) * dailyRate);
    }

    calculateReconnectionValue(performance, capabilities) {
        const baseValue = performance.completed * 0.10;
        const capabilityMultiplier = 1 + (capabilities.length * 0.1);
        const performanceMultiplier = performance.successRate > 90 ? 1.5 : 
                                    performance.successRate > 75 ? 1.2 : 1.0;
        
        return baseValue * capabilityMultiplier * performanceMultiplier;
    }

    identifyLikelyIssues(analysis) {
        const issues = [];
        
        if (analysis.performance.successRate < 70) {
            issues.push('handler configuration');
        }
        if (analysis.capabilities.length < 2) {
            issues.push('missing dependencies');
        }
        if (analysis.sessionLength < 60) {
            issues.push('connection stability');
        }
        
        return issues.length > 0 ? issues : ['general connectivity'];
    }

    parseCapabilities(capabilities) {
        if (!capabilities) return [];
        try {
            return JSON.parse(capabilities);
        } catch (e) {
            return [];
        }
    }

    formatCurrency(amount) {
        return `$${Number(amount).toFixed(2)}`;
    }

    // Database helper methods
    getAllNodes() {
        const stmt = this.db.prepare('SELECT * FROM nodes ORDER BY lastSeen DESC');
        return stmt.all();
    }

    getNodeJobs(nodeId) {
        const stmt = this.db.prepare('SELECT * FROM jobs WHERE claimedBy = ? ORDER BY claimedAt DESC');
        return stmt.all(nodeId);
    }
}

// CLI Usage
if (require.main === module) {
    const outreach = new OperatorReconnectionOutreach();
    
    outreach.generateOutreachCampaign()
        .then(() => {
            console.log('\n✅ Reconnection outreach campaign complete');
        })
        .catch(error => {
            console.error('❌ Outreach generation failed:', error);
            process.exit(1);
        });
}

module.exports = OperatorReconnectionOutreach;