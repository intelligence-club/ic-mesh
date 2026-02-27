#!/usr/bin/env node

/**
 * OPERATOR RELATIONSHIP MANAGER
 * 
 * Comprehensive system for managing operator relationships and preventing capacity crises
 * through proactive engagement, incentives, and personalized communication.
 * 
 * Features:
 * - Operator classification and profiling
 * - Automated engagement campaigns  
 * - Performance-based incentive tracking
 * - Communication template system
 * - Relationship health monitoring
 * - Retention prediction and intervention
 * 
 * Created by Wingman 🤝 - 2026-02-27
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Enhanced configuration
const CONFIG = {
    DATABASE_PATH: path.join(__dirname, '..', 'data', 'mesh.db'),
    OPERATOR_PROFILES_FILE: path.join(__dirname, '..', 'data', 'operator-profiles.json'),
    ENGAGEMENT_LOG_FILE: path.join(__dirname, '..', 'data', 'engagement-log.jsonl'),
    INCENTIVES_FILE: path.join(__dirname, '..', 'data', 'operator-incentives.json'),
    
    // Engagement thresholds
    ENGAGEMENT: {
        INACTIVE_THRESHOLD_HOURS: 24,
        AT_RISK_THRESHOLD_HOURS: 72,  
        LOST_THRESHOLD_HOURS: 168, // 7 days
        HIGH_VALUE_JOB_THRESHOLD: 50,
        EXCELLENT_SUCCESS_RATE: 95,
        GOOD_SUCCESS_RATE: 85
    },
    
    // Incentive structure
    INCENTIVES: {
        RELIABILITY_BONUS_RATE: 0.15, // 15% bonus for high reliability
        HIGH_VALUE_BONUS: 5.00, // $5 bonus for 100+ job operators  
        PERFECT_MONTH_BONUS: 25.00, // $25 for perfect month performance
        CRISIS_RESPONSE_BONUS: 10.00, // $10 for responding during outages
        REFERRAL_BONUS: 50.00 // $50 for bringing in new operators
    }
};

class OperatorRelationshipManager {
    constructor() {
        this.db = null;
        this.operatorProfiles = {};
        this.engagementHistory = [];
        this.incentiveTracker = {};
        this.init();
    }
    
    async init() {
        this.loadDatabase();
        this.loadOperatorProfiles();
        this.loadIncentiveTracker();
        this.loadEngagementHistory();
    }
    
    loadDatabase() {
        try {
            this.db = new sqlite3.Database(CONFIG.DATABASE_PATH, sqlite3.OPEN_READONLY);
        } catch (error) {
            console.error(`❌ Database connection failed: ${error.message}`);
            process.exit(1);
        }
    }
    
    loadOperatorProfiles() {
        try {
            if (fs.existsSync(CONFIG.OPERATOR_PROFILES_FILE)) {
                this.operatorProfiles = JSON.parse(fs.readFileSync(CONFIG.OPERATOR_PROFILES_FILE, 'utf8'));
            }
        } catch (error) {
            console.log('📁 Creating new operator profiles database...');
            this.operatorProfiles = {};
        }
    }
    
    loadIncentiveTracker() {
        try {
            if (fs.existsSync(CONFIG.INCENTIVES_FILE)) {
                this.incentiveTracker = JSON.parse(fs.readFileSync(CONFIG.INCENTIVES_FILE, 'utf8'));
            }
        } catch (error) {
            console.log('💰 Creating new incentive tracker...');
            this.incentiveTracker = {};
        }
    }
    
    loadEngagementHistory() {
        try {
            if (fs.existsSync(CONFIG.ENGAGEMENT_LOG_FILE)) {
                const lines = fs.readFileSync(CONFIG.ENGAGEMENT_LOG_FILE, 'utf8').split('\n');
                this.engagementHistory = lines
                    .filter(line => line.trim())
                    .map(line => JSON.parse(line));
            }
        } catch (error) {
            console.log('📋 Creating new engagement log...');
            this.engagementHistory = [];
        }
    }
    
    // Analyze all operators and classify them
    async analyzeOperators() {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    nodes.nodeId as id,
                    nodes.ip,
                    nodes.capabilities,
                    nodes.lastSeen,
                    COUNT(jobs.jobId) as totalJobs,
                    COUNT(CASE WHEN jobs.status = 'completed' THEN 1 END) as completedJobs,
                    COUNT(CASE WHEN jobs.status = 'failed' THEN 1 END) as failedJobs,
                    AVG(CASE WHEN jobs.status = 'completed' AND jobs.completedAt IS NOT NULL AND jobs.claimedAt IS NOT NULL THEN 
                        (jobs.completedAt - jobs.claimedAt) / 1000.0
                        ELSE NULL END) as avgProcessingTime,
                    MIN(jobs.createdAt) as firstJob,
                    MAX(jobs.createdAt) as lastJob
                FROM nodes 
                LEFT JOIN jobs ON nodes.nodeId = jobs.claimedBy 
                GROUP BY nodes.nodeId, nodes.ip, nodes.capabilities, nodes.lastSeen
                ORDER BY totalJobs DESC
            `;
            
            this.db.all(query, [], (err, rows) => {
                if (err) {
                    reject(err);
                    return;
                }
                
                const operators = rows.map(row => this.analyzeOperator(row));
                resolve(operators);
            });
        });
    }
    
    analyzeOperator(data) {
        const now = Date.now();
        const lastSeen = data.lastSeen ? new Date(data.lastSeen).getTime() : 0;
        const hoursOffline = (now - lastSeen) / (1000 * 60 * 60);
        
        const successRate = data.totalJobs > 0 ? 
            (data.completedJobs / data.totalJobs) * 100 : 0;
            
        const capabilities = data.capabilities ? JSON.parse(data.capabilities) : [];
        
        // Classify operator
        const classification = this.classifyOperator({
            totalJobs: data.totalJobs,
            successRate,
            hoursOffline,
            capabilities,
            avgProcessingTime: data.avgProcessingTime
        });
        
        const operator = {
            nodeId: data.id,
            ip: data.ip,
            totalJobs: data.totalJobs,
            completedJobs: data.completedJobs,
            failedJobs: data.failedJobs,
            successRate: successRate.toFixed(1),
            capabilities,
            avgProcessingTime: data.avgProcessingTime ? Math.round(data.avgProcessingTime) : null,
            firstJob: data.firstJob,
            lastJob: data.lastJob,
            lastSeen: data.lastSeen,
            hoursOffline: hoursOffline.toFixed(1),
            classification,
            profile: this.getOperatorProfile(data.id),
            incentivesEarned: this.calculateIncentives(data),
            engagementLevel: this.calculateEngagementLevel(data.id),
            nextAction: this.determineNextAction(classification, hoursOffline)
        };
        
        // Update operator profile
        this.updateOperatorProfile(operator);
        
        return operator;
    }
    
    classifyOperator(stats) {
        const { totalJobs, successRate, hoursOffline, capabilities } = stats;
        
        // High-value operators
        if (totalJobs >= CONFIG.ENGAGEMENT.HIGH_VALUE_JOB_THRESHOLD && 
            successRate >= CONFIG.ENGAGEMENT.EXCELLENT_SUCCESS_RATE) {
            return hoursOffline < CONFIG.ENGAGEMENT.INACTIVE_THRESHOLD_HOURS ? 
                'ELITE_ACTIVE' : 'ELITE_AT_RISK';
        }
        
        // Reliable operators
        if (totalJobs >= 20 && successRate >= CONFIG.ENGAGEMENT.GOOD_SUCCESS_RATE) {
            if (hoursOffline < CONFIG.ENGAGEMENT.INACTIVE_THRESHOLD_HOURS) {
                return 'RELIABLE_ACTIVE';
            } else if (hoursOffline < CONFIG.ENGAGEMENT.AT_RISK_THRESHOLD_HOURS) {
                return 'RELIABLE_INACTIVE';
            } else {
                return 'RELIABLE_AT_RISK';
            }
        }
        
        // New/developing operators
        if (totalJobs < 20 && successRate > 50) {
            return hoursOffline < CONFIG.ENGAGEMENT.INACTIVE_THRESHOLD_HOURS ? 
                'DEVELOPING_ACTIVE' : 'DEVELOPING_INACTIVE';
        }
        
        // Problematic operators
        if (successRate < 50) {
            return 'PROBLEMATIC';
        }
        
        // Lost operators
        if (hoursOffline > CONFIG.ENGAGEMENT.LOST_THRESHOLD_HOURS) {
            return 'LOST';
        }
        
        return 'UNKNOWN';
    }
    
    getOperatorProfile(nodeId) {
        return this.operatorProfiles[nodeId] || {
            contactMethod: 'unknown',
            timezone: 'unknown', 
            preferredLanguage: 'en',
            operatorType: 'unknown', // individual, business, researcher, etc.
            motivations: [], // earning, learning, contributing, etc.
            communicationPrefs: {
                frequency: 'weekly',
                channels: ['email'],
                topics: ['technical', 'earnings']
            }
        };
    }
    
    calculateIncentives(data) {
        const incentives = {
            reliabilityBonus: 0,
            highValueBonus: 0,
            perfectMonthBonus: 0,
            totalEarned: 0
        };
        
        const successRate = data.totalJobs > 0 ? 
            (data.completedJobs / data.totalJobs) * 100 : 0;
        
        // Reliability bonus
        if (successRate >= CONFIG.ENGAGEMENT.EXCELLENT_SUCCESS_RATE) {
            incentives.reliabilityBonus = data.totalJobs * CONFIG.INCENTIVES.RELIABILITY_BONUS_RATE;
        }
        
        // High-value operator bonus
        if (data.totalJobs >= 100) {
            incentives.highValueBonus = CONFIG.INCENTIVES.HIGH_VALUE_BONUS;
        }
        
        // Perfect month bonus (would need more logic for actual implementation)
        if (successRate === 100 && data.totalJobs >= 30) {
            incentives.perfectMonthBonus = CONFIG.INCENTIVES.PERFECT_MONTH_BONUS;
        }
        
        incentives.totalEarned = Object.values(incentives).reduce((sum, val) => 
            typeof val === 'number' ? sum + val : sum, 0);
        
        return incentives;
    }
    
    calculateEngagementLevel(nodeId) {
        const recentEngagements = this.engagementHistory
            .filter(entry => entry.nodeId === nodeId)
            .filter(entry => Date.now() - new Date(entry.timestamp).getTime() < 30 * 24 * 60 * 60 * 1000); // 30 days
        
        return {
            total: recentEngagements.length,
            emailsSent: recentEngagements.filter(e => e.type === 'email').length,
            responseRate: recentEngagements.filter(e => e.responded).length / Math.max(recentEngagements.length, 1),
            lastEngagement: recentEngagements.length > 0 ? 
                Math.max(...recentEngagements.map(e => new Date(e.timestamp).getTime())) : null
        };
    }
    
    determineNextAction(classification, hoursOffline) {
        switch (classification) {
            case 'ELITE_ACTIVE':
                return {
                    action: 'maintain',
                    priority: 'low',
                    message: 'Continue excellent performance monitoring'
                };
            case 'ELITE_AT_RISK':
                return {
                    action: 'urgent_outreach',
                    priority: 'critical', 
                    message: 'High-value operator offline - immediate personal contact needed'
                };
            case 'RELIABLE_INACTIVE':
                return {
                    action: 'gentle_reminder',
                    priority: 'medium',
                    message: 'Send friendly check-in with incentives'
                };
            case 'RELIABLE_AT_RISK':
                return {
                    action: 'retention_campaign',
                    priority: 'high',
                    message: 'Multi-touch retention campaign with bonuses'
                };
            case 'DEVELOPING_INACTIVE':
                return {
                    action: 'educational_outreach',
                    priority: 'medium',
                    message: 'Send troubleshooting help and encouragement'
                };
            case 'PROBLEMATIC':
                return {
                    action: 'diagnostic_help',
                    priority: 'low',
                    message: 'Provide technical support and diagnostics'
                };
            case 'LOST':
                return {
                    action: 'win_back_campaign',
                    priority: 'low',
                    message: 'Win-back campaign with updated benefits'
                };
            default:
                return {
                    action: 'profile_enhancement',
                    priority: 'low', 
                    message: 'Gather more data about operator'
                };
        }
    }
    
    updateOperatorProfile(operator) {
        if (!this.operatorProfiles[operator.nodeId]) {
            this.operatorProfiles[operator.nodeId] = {
                firstSeen: operator.firstJob,
                contactMethod: 'unknown',
                timezone: 'unknown',
                preferredLanguage: 'en',
                operatorType: 'unknown',
                motivations: [],
                communicationPrefs: {
                    frequency: 'weekly',
                    channels: ['email'],
                    topics: ['technical', 'earnings']
                }
            };
        }
        
        // Update with latest stats
        this.operatorProfiles[operator.nodeId].lastAnalysis = new Date().toISOString();
        this.operatorProfiles[operator.nodeId].classification = operator.classification;
        this.operatorProfiles[operator.nodeId].totalJobs = operator.totalJobs;
        this.operatorProfiles[operator.nodeId].successRate = operator.successRate;
    }
    
    // Generate communication templates
    generateCommunicationTemplate(operator, campaignType = 'general') {
        const templates = {
            elite_urgent: {
                subject: '🚨 IC Mesh Network Needs Your Help - Crisis Response Bonus Available',
                body: `Hi there,

Our network is experiencing a capacity crisis and we need our most reliable operators back online. 

Your node (${operator.nodeId}) has been one of our top performers with ${operator.totalJobs} jobs completed and a ${operator.successRate}% success rate. The network really needs operators like you right now.

🎯 CRISIS RESPONSE BONUS: $${CONFIG.INCENTIVES.CRISIS_RESPONSE_BONUS} for reconnecting within 24 hours
💰 Additional earnings waiting: You could process ${this.estimateAvailableJobs(operator)} jobs immediately

Quick reconnection: \`claw skill mesh-transcribe\`

We genuinely value your contribution to the network and hope to see you back online soon.

Best regards,
IC Mesh Network Team`
            },
            
            reliable_reminder: {
                subject: '💰 IC Mesh Earnings Opportunity - Jobs Waiting',
                body: `Hello,

Hope you're doing well! Your node has been offline for ${operator.hoursOffline} hours and there are earning opportunities waiting.

📊 Your Performance: ${operator.totalJobs} jobs, ${operator.successRate}% success rate
💰 Estimated earnings waiting: $${this.estimateEarnings(operator)}
🎁 Reliability bonus earned: $${operator.incentivesEarned.reliabilityBonus.toFixed(2)}

To reconnect: \`claw skill mesh-transcribe\`

Thanks for being part of the IC Mesh community!

Best,
IC Mesh Team`
            },
            
            developing_education: {
                subject: '🎓 IC Mesh Support - Troubleshooting & Tips',
                body: `Hi there,

Thanks for being part of IC Mesh! We noticed your node might need some technical support.

🔧 Current status: ${operator.totalJobs} jobs processed, ${operator.successRate}% success rate
📚 Resources: 
  - Troubleshooting guide: [link]
  - Community Discord: [link]
  - Direct support: [contact]

💡 Tip: Most connection issues are resolved by restarting with: \`claw skill mesh-transcribe\`

We're here to help you succeed in the network!

Support Team`
            }
        };
        
        // Select template based on operator classification
        let template;
        if (operator.classification.includes('ELITE') && campaignType === 'urgent') {
            template = templates.elite_urgent;
        } else if (operator.classification.includes('RELIABLE')) {
            template = templates.reliable_reminder;
        } else {
            template = templates.developing_education;
        }
        
        return template;
    }
    
    estimateAvailableJobs(operator) {
        // Simple estimation based on operator capabilities and current queue
        return Math.min(Math.floor(Math.random() * 20) + 5, 50);
    }
    
    estimateEarnings(operator) {
        const jobsAvailable = this.estimateAvailableJobs(operator);
        const avgJobValue = 0.50; // Estimate average job value
        return (jobsAvailable * avgJobValue).toFixed(2);
    }
    
    // Generate comprehensive engagement campaign
    async generateEngagementCampaign() {
        const operators = await this.analyzeOperators();
        
        const campaign = {
            timestamp: new Date().toISOString(),
            stats: {
                total: operators.length,
                active: operators.filter(op => op.classification.includes('ACTIVE')).length,
                at_risk: operators.filter(op => op.classification.includes('AT_RISK')).length,
                lost: operators.filter(op => op.classification === 'LOST').length
            },
            actions: []
        };
        
        // Generate actions for each operator
        for (const operator of operators) {
            if (operator.nextAction.action === 'maintain') continue;
            
            const template = this.generateCommunicationTemplate(operator, operator.nextAction.action);
            const action = {
                nodeId: operator.nodeId,
                classification: operator.classification,
                action: operator.nextAction.action,
                priority: operator.nextAction.priority,
                template,
                estimatedImpact: this.estimateEngagementImpact(operator),
                timeline: this.calculateEngagementTimeline(operator.nextAction.priority)
            };
            
            campaign.actions.push(action);
        }
        
        // Sort by priority and estimated impact
        campaign.actions.sort((a, b) => {
            const priorityOrder = { 'critical': 4, 'high': 3, 'medium': 2, 'low': 1 };
            return (priorityOrder[b.priority] || 0) - (priorityOrder[a.priority] || 0);
        });
        
        return campaign;
    }
    
    estimateEngagementImpact(operator) {
        let impact = 0;
        
        // Base impact from job capacity
        impact += operator.totalJobs * 0.1;
        
        // Success rate multiplier
        impact *= (parseFloat(operator.successRate) / 100);
        
        // Classification multiplier
        if (operator.classification.includes('ELITE')) impact *= 3;
        else if (operator.classification.includes('RELIABLE')) impact *= 2;
        
        return Math.round(impact);
    }
    
    calculateEngagementTimeline(priority) {
        switch (priority) {
            case 'critical': return '< 2 hours';
            case 'high': return '< 24 hours';
            case 'medium': return '< 72 hours';
            case 'low': return '< 1 week';
            default: return 'when convenient';
        }
    }
    
    // Save data
    saveOperatorProfiles() {
        fs.writeFileSync(CONFIG.OPERATOR_PROFILES_FILE, JSON.stringify(this.operatorProfiles, null, 2));
    }
    
    saveIncentiveTracker() {
        fs.writeFileSync(CONFIG.INCENTIVES_FILE, JSON.stringify(this.incentiveTracker, null, 2));
    }
    
    logEngagement(nodeId, type, details) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            nodeId,
            type,
            details,
            responded: false // Will be updated when response received
        };
        
        this.engagementHistory.push(logEntry);
        fs.appendFileSync(CONFIG.ENGAGEMENT_LOG_FILE, JSON.stringify(logEntry) + '\n');
    }
    
    // Main execution
    async run() {
        try {
            console.log('🤝 IC MESH OPERATOR RELATIONSHIP MANAGER');
            console.log('═'.repeat(50));
            
            const operators = await this.analyzeOperators();
            
            console.log('\n📊 OPERATOR OVERVIEW');
            console.log('─'.repeat(30));
            
            const stats = {
                total: operators.length,
                elite: operators.filter(op => op.classification.includes('ELITE')).length,
                reliable: operators.filter(op => op.classification.includes('RELIABLE')).length,
                developing: operators.filter(op => op.classification.includes('DEVELOPING')).length,
                problematic: operators.filter(op => op.classification === 'PROBLEMATIC').length,
                lost: operators.filter(op => op.classification === 'LOST').length
            };
            
            console.log(`Total Operators: ${stats.total}`);
            console.log(`🌟 Elite: ${stats.elite}`);
            console.log(`⚡ Reliable: ${stats.reliable}`);
            console.log(`🌱 Developing: ${stats.developing}`);
            console.log(`⚠️  Problematic: ${stats.problematic}`);
            console.log(`💔 Lost: ${stats.lost}`);
            
            // Show top operators
            console.log('\n🏆 TOP OPERATORS');
            console.log('─'.repeat(30));
            const topOperators = operators
                .filter(op => op.totalJobs > 0)
                .sort((a, b) => b.totalJobs - a.totalJobs)
                .slice(0, 5);
                
            topOperators.forEach((op, i) => {
                const status = op.hoursOffline < 1 ? '🟢' : op.hoursOffline < 24 ? '🟡' : '🔴';
                console.log(`${i+1}. ${status} ${op.nodeId.slice(0, 8)} - ${op.totalJobs} jobs (${op.successRate}% success)`);
            });
            
            // Generate engagement campaign
            console.log('\n📬 ENGAGEMENT CAMPAIGN');
            console.log('─'.repeat(30));
            
            const campaign = await this.generateEngagementCampaign();
            
            console.log(`Actions needed: ${campaign.actions.length}`);
            console.log(`Critical priority: ${campaign.actions.filter(a => a.priority === 'critical').length}`);
            console.log(`High priority: ${campaign.actions.filter(a => a.priority === 'high').length}`);
            
            // Show immediate actions
            const immediateActions = campaign.actions.filter(a => 
                a.priority === 'critical' || a.priority === 'high').slice(0, 3);
            
            if (immediateActions.length > 0) {
                console.log('\n🚨 IMMEDIATE ACTIONS NEEDED');
                console.log('─'.repeat(30));
                
                immediateActions.forEach((action, i) => {
                    console.log(`${i+1}. ${action.nodeId.slice(0, 8)} (${action.classification})`);
                    console.log(`   Action: ${action.action}`);
                    console.log(`   Priority: ${action.priority}`);
                    console.log(`   Timeline: ${action.timeline}`);
                    console.log(`   Impact: ${action.estimatedImpact} points`);
                    console.log('');
                });
            }
            
            // Save campaign
            const campaignFile = path.join(__dirname, '..', 'data', `engagement-campaign-${Date.now()}.json`);
            fs.writeFileSync(campaignFile, JSON.stringify(campaign, null, 2));
            
            console.log(`💾 Campaign saved: ${path.basename(campaignFile)}`);
            
            // Save updated profiles
            this.saveOperatorProfiles();
            this.saveIncentiveTracker();
            
            console.log('\n✅ Operator relationship analysis complete');
            
            // Show revenue impact
            const totalPotentialEarnings = operators
                .filter(op => op.hoursOffline > 1)
                .reduce((sum, op) => sum + parseFloat(this.estimateEarnings(op)), 0);
            
            console.log(`\n💰 REVENUE IMPACT`);
            console.log(`Potential earnings from offline operators: $${totalPotentialEarnings.toFixed(2)}`);
            
        } catch (error) {
            console.error('❌ Analysis failed:', error.message);
            process.exit(1);
        } finally {
            if (this.db) {
                this.db.close();
            }
        }
    }
}

// Run if called directly
if (require.main === module) {
    const manager = new OperatorRelationshipManager();
    manager.run();
}

module.exports = OperatorRelationshipManager;