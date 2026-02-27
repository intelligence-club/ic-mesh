#!/usr/bin/env node

/**
 * Intelligent Node Retention System
 * 
 * Advanced retention management with:
 * - Predictive disconnection detection
 * - Automated retention interventions
 * - Operator engagement scoring
 * - Personalized retention strategies
 * - Health trend analysis
 * - Proactive outreach campaigns
 */

const fs = require('fs');
const Database = require('better-sqlite3');

class IntelligentRetentionSystem {
    constructor() {
        this.db = new Database('data/mesh.db');
        this.setupRetentionDatabase();
        
        // Retention configuration
        this.config = {
            riskThresholds: {
                disconnectionWarning: 300, // 5 minutes offline
                retentionRisk: 3600,       // 1 hour offline
                criticalRisk: 86400        // 24 hours offline
            },
            interventionStrategies: {
                early: ['status_check', 'performance_tips'],
                moderate: ['personal_outreach', 'troubleshooting_help'],
                urgent: ['priority_support', 'retention_incentive']
            },
            engagementMetrics: {
                jobCompletionWeight: 0.4,
                uptimeWeight: 0.3,
                recentActivityWeight: 0.3
            }
        };
        
        this.retentionData = this.loadRetentionData();
    }
    
    setupRetentionDatabase() {
        // Node retention tracking
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS retention_events (
                id TEXT PRIMARY KEY,
                nodeId TEXT,
                eventType TEXT,
                eventData TEXT,
                riskScore REAL,
                interventionApplied TEXT,
                timestamp INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        
        // Retention interventions
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS retention_interventions (
                id TEXT PRIMARY KEY,
                nodeId TEXT,
                strategy TEXT,
                applied_at INTEGER,
                success INTEGER DEFAULT 0,
                response_time INTEGER,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        
        // Engagement scores
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS engagement_scores (
                nodeId TEXT PRIMARY KEY,
                score REAL,
                jobCompletion REAL,
                uptimeScore REAL,
                recentActivity REAL,
                lastUpdated INTEGER,
                trend TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        
        // Retention campaigns
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS retention_campaigns (
                id TEXT PRIMARY KEY,
                name TEXT,
                targetSegment TEXT,
                strategy TEXT,
                startDate INTEGER,
                endDate INTEGER,
                targetNodeIds TEXT,
                results TEXT,
                status TEXT DEFAULT 'active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
    }
    
    async analyzeRetentionRisks() {
        console.log('🎯 Analyzing node retention risks...\n');
        
        const nodes = this.getActiveAndRecentNodes();
        const riskAssessment = {
            timestamp: Date.now(),
            totalNodes: nodes.length,
            riskCategories: {
                low: [],
                moderate: [],
                high: [],
                critical: []
            },
            interventionsNeeded: []
        };
        
        for (const node of nodes) {
            const riskScore = await this.calculateNodeRiskScore(node);
            const riskLevel = this.categorizeRisk(riskScore);
            
            riskAssessment.riskCategories[riskLevel].push({
                nodeId: node.nodeId,
                owner: node.owner,
                riskScore: riskScore.overall,
                factors: riskScore.factors,
                lastSeen: node.lastSeen
            });
            
            // Record retention event
            this.recordRetentionEvent(node.nodeId, 'risk_assessment', riskScore);
            
            // Determine needed interventions
            if (riskLevel !== 'low') {
                const interventions = this.recommendInterventions(node, riskScore);
                riskAssessment.interventionsNeeded.push({
                    nodeId: node.nodeId,
                    riskLevel,
                    interventions
                });
            }
        }
        
        this.printRiskReport(riskAssessment);
        return riskAssessment;
    }
    
    async calculateNodeRiskScore(node) {
        const now = Date.now();
        const lastSeen = node.lastSeen;
        const timeSinceLastSeen = (now - lastSeen) / 1000; // Convert to seconds
        
        // Risk factors
        const factors = {
            offline_duration: Math.min(timeSinceLastSeen / 86400, 1), // Days offline (capped at 1)
            session_consistency: this.calculateSessionConsistency(node.nodeId),
            job_performance: this.calculateJobPerformance(node.nodeId),
            historical_disconnects: this.calculateDisconnectHistory(node.nodeId),
            engagement_decline: this.calculateEngagementDecline(node.nodeId)
        };
        
        // Weighted risk calculation
        const weights = {
            offline_duration: 0.35,
            session_consistency: 0.25,
            job_performance: 0.15,
            historical_disconnects: 0.15,
            engagement_decline: 0.10
        };
        
        const overall = Object.entries(factors).reduce((sum, [factor, value]) => {
            return sum + (value * weights[factor]);
        }, 0);
        
        return {
            overall: Math.round(overall * 100) / 100,
            factors,
            weights,
            timestamp: now
        };
    }
    
    calculateSessionConsistency(nodeId) {
        try {
            const sessions = this.db.prepare(`
                SELECT nodeId, lastSeen, jobsCompleted 
                FROM nodes 
                WHERE nodeId = ? 
                ORDER BY lastSeen DESC 
                LIMIT 10
            `).all(nodeId);
            
            if (sessions.length < 2) return 0.5; // Neutral for new nodes
            
            // Calculate session length variance (higher variance = inconsistent)
            const sessionLengths = sessions.map((s, i) => 
                i < sessions.length - 1 ? sessions[i].lastSeen - sessions[i + 1].lastSeen : 0
            ).filter(len => len > 0);
            
            if (sessionLengths.length === 0) return 0.5;
            
            const avgLength = sessionLengths.reduce((a, b) => a + b, 0) / sessionLengths.length;
            const variance = sessionLengths.reduce((sum, len) => sum + Math.pow(len - avgLength, 2), 0) / sessionLengths.length;
            const coefficient = Math.sqrt(variance) / avgLength;
            
            return Math.min(coefficient, 1); // Higher = more inconsistent = higher risk
            
        } catch (error) {
            return 0.5; // Neutral on error
        }
    }
    
    calculateJobPerformance(nodeId) {
        try {
            const performance = this.db.prepare(`
                SELECT 
                    COUNT(*) as total,
                    COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
                    COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed
                FROM jobs 
                WHERE nodeId = ?
            `).get(nodeId);
            
            if (performance.total === 0) return 0.3; // New nodes get benefit of doubt
            
            const successRate = performance.completed / performance.total;
            return 1 - successRate; // Higher failure rate = higher risk
            
        } catch (error) {
            return 0.3;
        }
    }
    
    calculateDisconnectHistory(nodeId) {
        try {
            const disconnects = this.db.prepare(`
                SELECT COUNT(*) as count 
                FROM retention_events 
                WHERE nodeId = ? AND eventType = 'disconnection'
                AND timestamp > ?
            `).get(nodeId, Date.now() - (7 * 24 * 60 * 60 * 1000)); // Last 7 days
            
            return Math.min(disconnects.count / 10, 1); // Normalize to 0-1
            
        } catch (error) {
            return 0;
        }
    }
    
    calculateEngagementDecline(nodeId) {
        try {
            const recentActivity = this.db.prepare(`
                SELECT COUNT(*) as recent 
                FROM jobs 
                WHERE nodeId = ? AND created_at > datetime('now', '-24 hours')
            `).get(nodeId);
            
            const weekActivity = this.db.prepare(`
                SELECT COUNT(*) as week 
                FROM jobs 
                WHERE nodeId = ? AND created_at > datetime('now', '-7 days')
            `).get(nodeId);
            
            const expectedDaily = weekActivity.week / 7;
            const engagementRatio = expectedDaily > 0 ? recentActivity.recent / expectedDaily : 0;
            
            return Math.max(0, 1 - engagementRatio); // Lower engagement = higher risk
            
        } catch (error) {
            return 0.5;
        }
    }
    
    categorizeRisk(riskScore) {
        const score = riskScore.overall;
        if (score < 0.3) return 'low';
        if (score < 0.6) return 'moderate';  
        if (score < 0.8) return 'high';
        return 'critical';
    }
    
    recommendInterventions(node, riskScore) {
        const riskLevel = this.categorizeRisk(riskScore);
        const baseStrategies = this.config.interventionStrategies;
        
        let interventions = [];
        
        // Base interventions by risk level
        switch (riskLevel) {
            case 'moderate':
                interventions = [...baseStrategies.early];
                break;
            case 'high':
                interventions = [...baseStrategies.moderate];
                break;
            case 'critical':
                interventions = [...baseStrategies.urgent];
                break;
        }
        
        // Add specific interventions based on risk factors
        if (riskScore.factors.job_performance > 0.7) {
            interventions.push('performance_troubleshooting');
        }
        
        if (riskScore.factors.session_consistency > 0.8) {
            interventions.push('stability_optimization');
        }
        
        if (riskScore.factors.offline_duration > 0.5) {
            interventions.push('reconnection_assistance');
        }
        
        return interventions;
    }
    
    async executeRetentionInterventions(nodeId, interventions) {
        console.log(`🎯 Executing retention interventions for ${nodeId}`);
        
        const results = [];
        
        for (const intervention of interventions) {
            try {
                const result = await this.executeIntervention(nodeId, intervention);
                results.push(result);
                
                // Record intervention
                this.db.prepare(`
                    INSERT INTO retention_interventions (id, nodeId, strategy, applied_at, success, notes)
                    VALUES (?, ?, ?, ?, ?, ?)
                `).run(
                    this.generateId(),
                    nodeId,
                    intervention,
                    Date.now(),
                    result.success ? 1 : 0,
                    JSON.stringify(result.details)
                );
                
                console.log(`  ${result.success ? '✅' : '❌'} ${intervention}: ${result.message}`);
                
            } catch (error) {
                console.log(`  ❌ ${intervention}: Failed - ${error.message}`);
                results.push({ success: false, intervention, error: error.message });
            }
        }
        
        return results;
    }
    
    async executeIntervention(nodeId, strategy) {
        const node = this.getNodeInfo(nodeId);
        
        switch (strategy) {
            case 'status_check':
                return await this.sendStatusCheck(node);
                
            case 'performance_tips':
                return await this.sendPerformanceTips(node);
                
            case 'personal_outreach':
                return await this.sendPersonalOutreach(node);
                
            case 'troubleshooting_help':
                return await this.sendTroubleshootingHelp(node);
                
            case 'priority_support':
                return await this.escalateToPrioritySupport(node);
                
            case 'retention_incentive':
                return await this.offerRetentionIncentive(node);
                
            case 'performance_troubleshooting':
                return await this.diagnosePerformanceIssues(node);
                
            case 'stability_optimization':
                return await this.suggestStabilityImprovements(node);
                
            case 'reconnection_assistance':
                return await this.provideReconnectionHelp(node);
                
            default:
                throw new Error(`Unknown intervention strategy: ${strategy}`);
        }
    }
    
    async sendStatusCheck(node) {
        // Generate status check message
        const message = `
Hey ${node.owner || 'there'}! 👋

We noticed your node ${node.nodeId} has been offline for a bit. Just checking in to see if everything's okay!

• Last seen: ${this.formatTimestamp(node.lastSeen)}
• Jobs completed: ${node.jobsCompleted || 0}
• Current status: ${this.getNodeStatus(node)}

If you're having any issues, we're here to help. Reply to this message or check our troubleshooting guide.

Happy computing! 🚀
        `.trim();
        
        return {
            success: true,
            intervention: 'status_check',
            message: 'Status check message prepared',
            details: { message, recipient: node.owner }
        };
    }
    
    async sendPerformanceTips(node) {
        const tips = this.generatePerformanceTips(node);
        
        return {
            success: true,
            intervention: 'performance_tips',
            message: 'Performance tips generated',
            details: { tips, nodeId: node.nodeId }
        };
    }
    
    async sendPersonalOutreach(node) {
        const personalizedMessage = this.generatePersonalizedMessage(node);
        
        return {
            success: true,
            intervention: 'personal_outreach',
            message: 'Personalized outreach message created',
            details: { message: personalizedMessage }
        };
    }
    
    generatePerformanceTips(node) {
        const tips = [
            "💡 Keep your node online 24/7 for maximum earnings",
            "🔧 Regular restarts can improve stability",
            "📊 Monitor system resources during job execution",
            "🚀 Update your capabilities as you install new tools",
            "🤝 Join our community for tips and support"
        ];
        
        // Add specific tips based on node history
        const jobsCompleted = node.jobsCompleted || 0;
        if (jobsCompleted < 5) {
            tips.unshift("🎯 Your first few jobs are important for building reputation");
        }
        
        return tips;
    }
    
    generatePersonalizedMessage(node) {
        const jobsCompleted = node.jobsCompleted || 0;
        const daysSinceRegistration = Math.floor((Date.now() - node.lastSeen) / (86400 * 1000));
        
        return `
Hi ${node.owner || 'there'}!

I noticed your node ${node.nodeId} has been a ${jobsCompleted > 10 ? 'valuable' : 'promising'} part of our network${jobsCompleted > 0 ? ` with ${jobsCompleted} jobs completed` : ''}.

${jobsCompleted > 10 ? 
    "Your contributions have been really appreciated by the community!" :
    "We'd love to see you become more active in our network!"}

Is there anything we can do to help you get the most out of your participation? Whether it's technical support, performance optimization, or just answering questions - we're here for you.

Looking forward to seeing your node back online soon! 🚀

Best regards,
The Intelligence Club Team
        `.trim();
    }
    
    async createRetentionCampaign(name, targetSegment, strategy) {
        const campaignId = this.generateId();
        const now = Date.now();
        
        // Get target nodes based on segment
        const targetNodes = this.getNodesBySegment(targetSegment);
        
        // Create campaign record
        this.db.prepare(`
            INSERT INTO retention_campaigns (id, name, targetSegment, strategy, startDate, targetNodeIds, status)
            VALUES (?, ?, ?, ?, ?, ?, 'active')
        `).run(campaignId, name, targetSegment, strategy, now, JSON.stringify(targetNodes.map(n => n.nodeId)));
        
        console.log(`🎯 Created retention campaign: ${name}`);
        console.log(`📊 Target segment: ${targetSegment} (${targetNodes.length} nodes)`);
        console.log(`🎪 Strategy: ${strategy}`);
        
        // Execute campaign
        const results = [];
        for (const node of targetNodes) {
            const interventions = this.recommendInterventions(node, await this.calculateNodeRiskScore(node));
            const result = await this.executeRetentionInterventions(node.nodeId, [strategy]);
            results.push({ nodeId: node.nodeId, result });
        }
        
        // Update campaign with results
        this.db.prepare(`
            UPDATE retention_campaigns 
            SET results = ?, status = 'completed'
            WHERE id = ?
        `).run(JSON.stringify(results), campaignId);
        
        return {
            campaignId,
            targetNodes: targetNodes.length,
            results
        };
    }
    
    getNodesBySegment(segment) {
        const now = Date.now();
        let query = '';
        
        switch (segment) {
            case 'at_risk':
                query = `
                    SELECT * FROM nodes 
                    WHERE (${now} - lastSeen) > ${3600 * 1000}
                    AND (${now} - lastSeen) < ${86400 * 1000}
                `;
                break;
                
            case 'inactive':
                query = `
                    SELECT * FROM nodes 
                    WHERE (${now} - lastSeen) > ${86400 * 1000}
                `;
                break;
                
            case 'new_operators':
                query = `
                    SELECT * FROM nodes 
                    WHERE jobsCompleted < 5
                `;
                break;
                
            case 'high_performers':
                query = `
                    SELECT * FROM nodes 
                    WHERE jobsCompleted > 20
                    AND (${now} - lastSeen) > ${7200 * 1000}
                `;
                break;
                
            default:
                query = 'SELECT * FROM nodes';
        }
        
        return this.db.prepare(query).all();
    }
    
    recordRetentionEvent(nodeId, eventType, eventData) {
        this.db.prepare(`
            INSERT INTO retention_events (id, nodeId, eventType, eventData, timestamp)
            VALUES (?, ?, ?, ?, ?)
        `).run(
            this.generateId(),
            nodeId,
            eventType,
            JSON.stringify(eventData),
            Date.now()
        );
    }
    
    printRiskReport(assessment) {
        console.log('📊 Node Retention Risk Assessment');
        console.log('=====================================\n');
        
        console.log(`🎯 Total nodes analyzed: ${assessment.totalNodes}`);
        console.log(`📅 Assessment time: ${new Date(assessment.timestamp).toLocaleString()}\n`);
        
        const categories = Object.entries(assessment.riskCategories);
        for (const [level, nodes] of categories) {
            if (nodes.length > 0) {
                const emoji = { low: '🟢', moderate: '🟡', high: '🟠', critical: '🔴' }[level];
                console.log(`${emoji} ${level.toUpperCase()} RISK: ${nodes.length} nodes`);
                
                nodes.forEach(node => {
                    const minutesOffline = Math.floor((Date.now() - node.lastSeen) / (60 * 1000));
                    console.log(`   • ${node.nodeId} (${node.owner || 'unknown'}) - Risk: ${node.riskScore} - Offline: ${minutesOffline}m`);
                });
                console.log('');
            }
        }
        
        if (assessment.interventionsNeeded.length > 0) {
            console.log('🎯 Recommended Interventions:');
            assessment.interventionsNeeded.forEach(item => {
                console.log(`   • ${item.nodeId} (${item.riskLevel}): ${item.interventions.join(', ')}`);
            });
        }
    }
    
    // Helper methods
    getActiveAndRecentNodes() {
        const threeDaysAgo = Date.now() - (3 * 24 * 60 * 60 * 1000);
        return this.db.prepare(`
            SELECT * FROM nodes 
            WHERE lastSeen > ?
            ORDER BY lastSeen DESC
        `).all(threeDaysAgo);
    }
    
    getNodeInfo(nodeId) {
        return this.db.prepare('SELECT * FROM nodes WHERE nodeId = ?').get(nodeId);
    }
    
    getNodeStatus(node) {
        const now = Date.now();
        const offlineMinutes = Math.floor((now - node.lastSeen) / (60 * 1000));
        
        if (offlineMinutes < 5) return 'Online';
        if (offlineMinutes < 60) return `Offline ${offlineMinutes}m`;
        if (offlineMinutes < 1440) return `Offline ${Math.floor(offlineMinutes/60)}h`;
        return `Offline ${Math.floor(offlineMinutes/1440)}d`;
    }
    
    formatTimestamp(timestamp) {
        return new Date(timestamp * 1000).toLocaleString();
    }
    
    generateId() {
        return 'ret_' + Math.random().toString(36).substr(2, 9);
    }
    
    loadRetentionData() {
        // Load existing retention data
        return {};
    }
    
    // Export methods
    exportRetentionReport() {
        const report = {
            timestamp: Date.now(),
            riskAssessment: null, // Will be filled by analyzeRetentionRisks
            recentInterventions: this.getRecentInterventions(),
            activeCampaigns: this.getActiveCampaigns(),
            retentionStats: this.getRetentionStats()
        };
        
        const filename = `retention-report-${Date.now()}.json`;
        fs.writeFileSync(filename, JSON.stringify(report, null, 2));
        console.log(`📊 Retention report exported: ${filename}`);
        
        return report;
    }
    
    getRecentInterventions() {
        return this.db.prepare(`
            SELECT * FROM retention_interventions 
            ORDER BY applied_at DESC 
            LIMIT 20
        `).all();
    }
    
    getActiveCampaigns() {
        return this.db.prepare(`
            SELECT * FROM retention_campaigns 
            WHERE status = 'active'
        `).all();
    }
    
    getRetentionStats() {
        const totalNodes = this.db.prepare('SELECT COUNT(*) as count FROM nodes').get().count;
        const activeNodes = this.db.prepare(`
            SELECT COUNT(*) as count FROM nodes 
            WHERE (${Date.now()} - lastSeen) < ${3600 * 1000}
        `).get().count;
        
        const retentionRate = totalNodes > 0 ? ((activeNodes / totalNodes) * 100).toFixed(1) : 0;
        
        return {
            totalNodes,
            activeNodes,
            retentionRate: retentionRate + '%',
            atRiskNodes: totalNodes - activeNodes
        };
    }
}

// CLI interface
if (require.main === module) {
    const args = process.argv.slice(2);
    const command = args[0];
    
    const system = new IntelligentRetentionSystem();
    
    if (command === 'analyze') {
        system.analyzeRetentionRisks();
        
    } else if (command === 'campaign') {
        const name = args[1] || 'Retention Campaign';
        const segment = args[2] || 'at_risk';
        const strategy = args[3] || 'status_check';
        
        system.createRetentionCampaign(name, segment, strategy)
            .then(result => {
                console.log('\n✅ Campaign completed');
                console.log(`Target nodes: ${result.targetNodes}`);
                console.log(`Results: ${JSON.stringify(result.results, null, 2)}`);
            });
            
    } else if (command === 'intervene') {
        const nodeId = args[1];
        const interventions = args.slice(2);
        
        if (!nodeId) {
            console.log('Error: Node ID required');
            process.exit(1);
        }
        
        if (interventions.length === 0) {
            interventions.push('status_check');
        }
        
        system.executeRetentionInterventions(nodeId, interventions);
        
    } else if (command === 'report') {
        system.exportRetentionReport();
        
    } else {
        console.log('Intelligent Node Retention System');
        console.log('=================================');
        console.log('');
        console.log('Usage:');
        console.log('  node intelligent-retention-system.js analyze                    - Analyze retention risks');
        console.log('  node intelligent-retention-system.js campaign [name] [segment]  - Create retention campaign');
        console.log('  node intelligent-retention-system.js intervene <nodeId> [...]   - Execute interventions');
        console.log('  node intelligent-retention-system.js report                     - Export detailed report');
        console.log('');
        console.log('Segments: at_risk, inactive, new_operators, high_performers');
        console.log('Strategies: status_check, performance_tips, personal_outreach, troubleshooting_help');
    }
}

module.exports = IntelligentRetentionSystem;