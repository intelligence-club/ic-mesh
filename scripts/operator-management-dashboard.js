#!/usr/bin/env node

/**
 * OPERATOR MANAGEMENT DASHBOARD
 * 
 * Integrated dashboard combining relationship management and acquisition engine
 * for comprehensive operator lifecycle management and capacity optimization.
 * 
 * Features:
 * - Real-time operator health monitoring
 * - Automated engagement recommendations
 * - Acquisition campaign management
 * - Revenue impact analysis
 * - Crisis response automation
 * - Operator performance optimization
 * 
 * Created by Wingman 🤝 - 2026-02-27
 */

const OperatorRelationshipManager = require('./operator-relationship-manager');
const OperatorAcquisitionEngine = require('./operator-acquisition-engine');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

class OperatorManagementDashboard {
    constructor() {
        this.relationshipManager = new OperatorRelationshipManager();
        this.acquisitionEngine = new OperatorAcquisitionEngine();
        this.dashboardData = {};
        this.recommendations = [];
    }
    
    async generateComprehensiveDashboard() {
        try {
            console.log('🎯 IC MESH OPERATOR MANAGEMENT DASHBOARD');
            console.log('═'.repeat(60));
            console.log(`Generated: ${new Date().toISOString()}`);
            
            // 1. Current Network Status
            const networkStatus = await this.analyzeNetworkStatus();
            this.displayNetworkStatus(networkStatus);
            
            // 2. Operator Health Analysis
            const operatorHealth = await this.analyzeOperatorHealth();
            this.displayOperatorHealth(operatorHealth);
            
            // 3. Acquisition Opportunities
            const acquisitionAnalysis = await this.analyzeAcquisitionOpportunities();
            this.displayAcquisitionAnalysis(acquisitionAnalysis);
            
            // 4. Crisis Response Plan
            const crisisAnalysis = this.analyzeCrisisResponseNeeded(networkStatus, operatorHealth);
            this.displayCrisisResponse(crisisAnalysis);
            
            // 5. Revenue Impact & Optimization
            const revenueAnalysis = this.analyzeRevenueOptimization(networkStatus, operatorHealth);
            this.displayRevenueAnalysis(revenueAnalysis);
            
            // 6. Automated Recommendations
            const recommendations = this.generateActionableRecommendations(
                networkStatus, operatorHealth, acquisitionAnalysis, crisisAnalysis
            );
            this.displayRecommendations(recommendations);
            
            // 7. Export comprehensive report
            await this.exportDashboardReport({
                networkStatus, operatorHealth, acquisitionAnalysis, 
                crisisAnalysis, revenueAnalysis, recommendations
            });
            
            return {
                networkStatus, operatorHealth, acquisitionAnalysis,
                crisisAnalysis, revenueAnalysis, recommendations
            };
            
        } catch (error) {
            console.error('❌ Dashboard generation failed:', error.message);
            throw error;
        }
    }
    
    async analyzeNetworkStatus() {
        return new Promise((resolve, reject) => {
            const db = new sqlite3.Database(path.join(__dirname, '..', 'data', 'mesh.db'), sqlite3.OPEN_READONLY);
            
            const queries = {
                nodeStats: `
                    SELECT 
                        COUNT(*) as totalNodes,
                        COUNT(CASE WHEN (strftime('%s', 'now') - lastSeen/1000) < 3600 THEN 1 END) as activeNodes,
                        COUNT(CASE WHEN (strftime('%s', 'now') - lastSeen/1000) < 86400 THEN 1 END) as recentNodes,
                        AVG(jobsCompleted) as avgJobsPerNode
                    FROM nodes
                `,
                jobStats: `
                    SELECT 
                        COUNT(*) as totalJobs,
                        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pendingJobs,
                        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completedJobs,
                        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failedJobs
                    FROM jobs
                `,
                capacityStats: `
                    SELECT 
                        SUM(cpuCores) as totalCpuCores,
                        SUM(ramMB) as totalRamMB,
                        COUNT(CASE WHEN capabilities LIKE '%whisper%' THEN 1 END) as whisperCapable,
                        COUNT(CASE WHEN capabilities LIKE '%tesseract%' THEN 1 END) as ocrCapable
                    FROM nodes
                `
            };
            
            let results = {};
            let completed = 0;
            
            Object.keys(queries).forEach(queryName => {
                db.get(queries[queryName], [], (err, row) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    results[queryName] = row;
                    completed++;
                    
                    if (completed === Object.keys(queries).length) {
                        db.close();
                        resolve(this.processNetworkStatus(results));
                    }
                });
            });
        });
    }
    
    processNetworkStatus(rawData) {
        const { nodeStats, jobStats, capacityStats } = rawData;
        
        const successRate = jobStats.totalJobs > 0 ? 
            (jobStats.completedJobs / jobStats.totalJobs * 100).toFixed(1) : 0;
        
        const capacityUtilization = nodeStats.totalNodes > 0 ? 
            (nodeStats.activeNodes / nodeStats.totalNodes * 100).toFixed(1) : 0;
        
        return {
            nodes: {
                total: nodeStats.totalNodes,
                active: nodeStats.activeNodes,
                recent: nodeStats.recentNodes,
                offline: nodeStats.totalNodes - nodeStats.activeNodes,
                utilization: parseFloat(capacityUtilization)
            },
            jobs: {
                total: jobStats.totalJobs,
                pending: jobStats.pendingJobs,
                completed: jobStats.completedJobs,
                failed: jobStats.failedJobs,
                successRate: parseFloat(successRate)
            },
            capacity: {
                cpuCores: capacityStats.totalCpuCores || 0,
                ramMB: capacityStats.totalRamMB || 0,
                whisperCapable: capacityStats.whisperCapable || 0,
                ocrCapable: capacityStats.ocrCapable || 0
            },
            health: this.calculateNetworkHealth(nodeStats, jobStats),
            status: this.determineNetworkStatus(nodeStats, jobStats)
        };
    }
    
    calculateNetworkHealth(nodeStats, jobStats) {
        let healthScore = 100;
        
        // Node availability penalty
        const nodeUtilization = nodeStats.totalNodes > 0 ? nodeStats.activeNodes / nodeStats.totalNodes : 0;
        if (nodeUtilization < 0.2) healthScore -= 40; // Less than 20% active
        else if (nodeUtilization < 0.5) healthScore -= 20; // Less than 50% active
        
        // Job processing penalty
        const successRate = jobStats.totalJobs > 0 ? jobStats.completedJobs / jobStats.totalJobs : 1;
        if (successRate < 0.5) healthScore -= 30; // Less than 50% success rate
        else if (successRate < 0.8) healthScore -= 15; // Less than 80% success rate
        
        // Pending jobs penalty
        if (jobStats.pendingJobs > 50) healthScore -= 20;
        else if (jobStats.pendingJobs > 20) healthScore -= 10;
        
        return Math.max(0, healthScore);
    }
    
    determineNetworkStatus(nodeStats, jobStats) {
        if (nodeStats.activeNodes === 0) return 'CRITICAL_OUTAGE';
        if (nodeStats.activeNodes < 3 && jobStats.pendingJobs > 20) return 'CAPACITY_CRISIS';
        if (nodeStats.activeNodes < 5) return 'LOW_CAPACITY';
        if (nodeStats.activeNodes < 10) return 'MODERATE_CAPACITY';
        return 'HEALTHY_CAPACITY';
    }
    
    async analyzeOperatorHealth() {
        const operators = await this.relationshipManager.analyzeOperators();
        
        const healthMetrics = {
            total: operators.length,
            classifications: {
                elite: operators.filter(op => op.classification.includes('ELITE')).length,
                reliable: operators.filter(op => op.classification.includes('RELIABLE')).length,
                developing: operators.filter(op => op.classification.includes('DEVELOPING')).length,
                problematic: operators.filter(op => op.classification === 'PROBLEMATIC').length,
                lost: operators.filter(op => op.classification === 'LOST').length
            },
            engagement: {
                needsUrgentAttention: operators.filter(op => op.nextAction.priority === 'critical').length,
                needsAttention: operators.filter(op => op.nextAction.priority === 'high').length,
                routine: operators.filter(op => op.nextAction.priority === 'medium' || op.nextAction.priority === 'low').length
            },
            performance: {
                averageJobs: operators.reduce((sum, op) => sum + op.totalJobs, 0) / Math.max(operators.length, 1),
                averageSuccessRate: operators.reduce((sum, op) => sum + parseFloat(op.successRate), 0) / Math.max(operators.length, 1),
                topPerformers: operators.filter(op => op.totalJobs > 20 && parseFloat(op.successRate) > 90).length
            }
        };
        
        return {
            operators,
            metrics: healthMetrics,
            insights: this.generateOperatorInsights(operators, healthMetrics)
        };
    }
    
    generateOperatorInsights(operators, metrics) {
        const insights = [];
        
        if (metrics.classifications.elite === 0) {
            insights.push({
                type: 'warning',
                message: 'No elite operators - network lacks high-reliability anchors',
                impact: 'high'
            });
        }
        
        if (metrics.classifications.lost > metrics.total * 0.3) {
            insights.push({
                type: 'critical',
                message: `High operator churn rate: ${metrics.classifications.lost}/${metrics.total} operators lost`,
                impact: 'critical'
            });
        }
        
        if (metrics.performance.averageSuccessRate < 80) {
            insights.push({
                type: 'warning',
                message: `Low average success rate: ${metrics.performance.averageSuccessRate.toFixed(1)}%`,
                impact: 'medium'
            });
        }
        
        return insights;
    }
    
    async analyzeAcquisitionOpportunities() {
        const strategy = this.acquisitionEngine.generateAcquisitionStrategy();
        
        return {
            strategy,
            priorityCampaigns: strategy.recommended_campaigns.slice(0, 3),
            urgencyLevel: strategy.current_state.urgency,
            timeline: strategy.timeline,
            insights: this.generateAcquisitionInsights(strategy)
        };
    }
    
    generateAcquisitionInsights(strategy) {
        const insights = [];
        
        if (strategy.current_state.urgency === 'critical') {
            insights.push({
                type: 'critical',
                message: 'Network in critical state - immediate operator recruitment needed',
                action: 'Deploy all emergency acquisition campaigns immediately'
            });
        }
        
        const highROICampaigns = strategy.recommended_campaigns.filter(c => c.roi_projection > 10);
        if (highROICampaigns.length > 0) {
            insights.push({
                type: 'opportunity',
                message: `${highROICampaigns.length} high-ROI acquisition opportunities available`,
                action: 'Prioritize campaigns with >10x ROI for maximum impact'
            });
        }
        
        return insights;
    }
    
    analyzeCrisisResponseNeeded(networkStatus, operatorHealth) {
        const crisisLevel = this.determineCrisisLevel(networkStatus, operatorHealth);
        
        return {
            level: crisisLevel,
            triggers: this.identifyCrisisTriggers(networkStatus, operatorHealth),
            response: this.generateCrisisResponse(crisisLevel, networkStatus, operatorHealth),
            timeline: this.getCrisisTimeline(crisisLevel)
        };
    }
    
    determineCrisisLevel(networkStatus, operatorHealth) {
        if (networkStatus.status === 'CRITICAL_OUTAGE') return 'CRITICAL';
        if (networkStatus.status === 'CAPACITY_CRISIS') return 'HIGH';
        if (networkStatus.health < 60) return 'MEDIUM';
        if (operatorHealth.metrics.engagement.needsUrgentAttention > 0) return 'LOW';
        return 'NONE';
    }
    
    identifyCrisisTriggers(networkStatus, operatorHealth) {
        const triggers = [];
        
        if (networkStatus.nodes.active === 0) triggers.push('Zero active nodes');
        if (networkStatus.jobs.pending > 50) triggers.push(`High job backlog: ${networkStatus.jobs.pending} pending`);
        if (networkStatus.jobs.successRate < 50) triggers.push(`Low success rate: ${networkStatus.jobs.successRate}%`);
        if (operatorHealth.metrics.classifications.lost > 3) triggers.push(`High operator loss: ${operatorHealth.metrics.classifications.lost} lost`);
        
        return triggers;
    }
    
    generateCrisisResponse(crisisLevel, networkStatus, operatorHealth) {
        const responses = {
            'CRITICAL': [
                'Activate emergency operator contact protocol',
                'Deploy crisis recruitment campaigns immediately',
                'Offer emergency incentive bonuses',
                'Contact all recently offline operators',
                'Consider manual intervention for stuck jobs'
            ],
            'HIGH': [
                'Accelerate operator outreach campaigns',
                'Activate retention bonuses for at-risk operators',
                'Deploy capacity crisis messaging',
                'Review and optimize job processing'
            ],
            'MEDIUM': [
                'Increase operator engagement frequency',
                'Launch proactive retention campaigns',
                'Optimize job distribution algorithms'
            ],
            'LOW': [
                'Standard operator health monitoring',
                'Routine engagement campaigns'
            ],
            'NONE': [
                'Continue normal operations',
                'Focus on growth and optimization'
            ]
        };
        
        return responses[crisisLevel] || responses['LOW'];
    }
    
    getCrisisTimeline(crisisLevel) {
        const timelines = {
            'CRITICAL': '< 2 hours',
            'HIGH': '< 24 hours',
            'MEDIUM': '< 72 hours',
            'LOW': '< 1 week',
            'NONE': 'Ongoing'
        };
        
        return timelines[crisisLevel] || 'Ongoing';
    }
    
    analyzeRevenueOptimization(networkStatus, operatorHealth) {
        const potentialEarnings = this.calculatePotentialEarnings(networkStatus);
        const lostRevenue = this.calculateLostRevenue(networkStatus, operatorHealth);
        
        return {
            potential: potentialEarnings,
            lost: lostRevenue,
            optimization: this.generateRevenueOptimizations(networkStatus, operatorHealth),
            projections: this.generateRevenueProjections(networkStatus, operatorHealth)
        };
    }
    
    calculatePotentialEarnings(networkStatus) {
        const avgJobValue = 0.50;
        return {
            immediate: (networkStatus.jobs.pending * avgJobValue).toFixed(2),
            daily: ((networkStatus.jobs.pending + 100) * avgJobValue).toFixed(2), // Estimate daily flow
            monthly: ((networkStatus.jobs.pending + 3000) * avgJobValue).toFixed(2)
        };
    }
    
    calculateLostRevenue(networkStatus, operatorHealth) {
        const lostOperators = operatorHealth.metrics.classifications.lost;
        const avgOperatorValue = 200; // Estimated monthly value
        
        return {
            fromLostOperators: (lostOperators * avgOperatorValue).toFixed(2),
            fromPendingJobs: ((networkStatus.jobs.pending * 0.5) * 0.8).toFixed(2), // 80% of pending job value lost to delays
            fromLowUtilization: ((100 - networkStatus.nodes.utilization) * 2).toFixed(2) // Estimate utilization impact
        };
    }
    
    generateRevenueOptimizations(networkStatus, operatorHealth) {
        return [
            {
                action: 'Reduce pending job backlog',
                impact: `+$${networkStatus.jobs.pending * 0.5}`,
                timeline: 'immediate'
            },
            {
                action: 'Retain at-risk operators',
                impact: `+$${operatorHealth.metrics.engagement.needsUrgentAttention * 50}`,
                timeline: '24-48 hours'
            },
            {
                action: 'Increase network capacity by 50%',
                impact: `+$${(networkStatus.nodes.total * 100).toFixed(0)}`,
                timeline: '1-2 weeks'
            }
        ];
    }
    
    generateRevenueProjections(networkStatus, operatorHealth) {
        const baseMonthlyRevenue = networkStatus.jobs.completed * 0.5 * 30;
        
        return {
            current: baseMonthlyRevenue.toFixed(0),
            optimized: (baseMonthlyRevenue * 1.5).toFixed(0), // 50% improvement
            potential: (baseMonthlyRevenue * 3).toFixed(0) // 3x with full optimization
        };
    }
    
    generateActionableRecommendations(networkStatus, operatorHealth, acquisitionAnalysis, crisisAnalysis) {
        const recommendations = [];
        
        // Critical actions based on crisis level
        if (crisisAnalysis.level === 'CRITICAL' || crisisAnalysis.level === 'HIGH') {
            recommendations.push({
                priority: 'critical',
                action: 'Deploy emergency operator recruitment',
                description: 'Network in crisis - immediate operator acquisition needed',
                timeline: crisisAnalysis.timeline,
                impact: 'Network stability restoration',
                automated: true
            });
        }
        
        // Operator engagement actions
        if (operatorHealth.metrics.engagement.needsUrgentAttention > 0) {
            recommendations.push({
                priority: 'high',
                action: 'Contact at-risk high-value operators',
                description: `${operatorHealth.metrics.engagement.needsUrgentAttention} operators need immediate attention`,
                timeline: '< 24 hours',
                impact: 'Prevent operator churn',
                automated: true
            });
        }
        
        // Acquisition opportunities
        acquisitionAnalysis.priorityCampaigns.forEach(campaign => {
            recommendations.push({
                priority: campaign.priority,
                action: `Deploy ${campaign.id} campaign`,
                description: `Expected ${campaign.estimated_signups} signups, ROI: ${campaign.roi_projection}x`,
                timeline: '1-2 weeks',
                impact: `+${campaign.estimated_signups} operators`,
                automated: false
            });
        });
        
        // Performance optimization
        if (networkStatus.jobs.successRate < 80) {
            recommendations.push({
                priority: 'medium',
                action: 'Optimize job processing pipeline',
                description: `Success rate at ${networkStatus.jobs.successRate}% - investigate failures`,
                timeline: '1 week',
                impact: 'Improved job completion rate',
                automated: false
            });
        }
        
        return recommendations.sort((a, b) => {
            const priorityOrder = { 'critical': 4, 'high': 3, 'medium': 2, 'low': 1 };
            return (priorityOrder[b.priority] || 0) - (priorityOrder[a.priority] || 0);
        });
    }
    
    // Display methods
    displayNetworkStatus(status) {
        console.log('\n🌐 NETWORK STATUS');
        console.log('─'.repeat(40));
        
        const statusIcon = {
            'CRITICAL_OUTAGE': '🚨',
            'CAPACITY_CRISIS': '⚠️',
            'LOW_CAPACITY': '🟡',
            'MODERATE_CAPACITY': '🟢',
            'HEALTHY_CAPACITY': '💚'
        }[status.status] || '❓';
        
        console.log(`Status: ${statusIcon} ${status.status}`);
        console.log(`Health Score: ${status.health}/100`);
        console.log(`Active Nodes: ${status.nodes.active}/${status.nodes.total} (${status.nodes.utilization}%)`);
        console.log(`Pending Jobs: ${status.jobs.pending}`);
        console.log(`Success Rate: ${status.jobs.successRate}%`);
    }
    
    displayOperatorHealth(health) {
        console.log('\n👥 OPERATOR HEALTH');
        console.log('─'.repeat(40));
        console.log(`Total Operators: ${health.metrics.total}`);
        console.log(`🌟 Elite: ${health.metrics.classifications.elite}`);
        console.log(`⚡ Reliable: ${health.metrics.classifications.reliable}`);
        console.log(`🌱 Developing: ${health.metrics.classifications.developing}`);
        console.log(`⚠️  Problematic: ${health.metrics.classifications.problematic}`);
        console.log(`💔 Lost: ${health.metrics.classifications.lost}`);
        console.log(`Avg Success Rate: ${health.metrics.performance.averageSuccessRate.toFixed(1)}%`);
        
        if (health.insights.length > 0) {
            console.log('\n📊 Operator Insights:');
            health.insights.forEach(insight => {
                const icon = insight.type === 'critical' ? '🚨' : insight.type === 'warning' ? '⚠️' : 'ℹ️';
                console.log(`${icon} ${insight.message}`);
            });
        }
    }
    
    displayAcquisitionAnalysis(analysis) {
        console.log('\n🎯 ACQUISITION OPPORTUNITIES');
        console.log('─'.repeat(40));
        console.log(`Urgency: ${analysis.urgencyLevel.toUpperCase()}`);
        console.log(`Operators Needed: ${analysis.strategy.current_state.gap}`);
        
        console.log('\nTop Campaigns:');
        analysis.priorityCampaigns.forEach((campaign, i) => {
            const priorityIcon = campaign.priority === 'critical' ? '🚨' : campaign.priority === 'high' ? '⚡' : '🎯';
            console.log(`${i+1}. ${priorityIcon} ${campaign.id} (${campaign.estimated_signups} signups, ${campaign.roi_projection}x ROI)`);
        });
    }
    
    displayCrisisResponse(crisis) {
        if (crisis.level === 'NONE') return;
        
        console.log('\n🚨 CRISIS RESPONSE PLAN');
        console.log('─'.repeat(40));
        console.log(`Crisis Level: ${crisis.level}`);
        console.log(`Timeline: ${crisis.timeline}`);
        
        if (crisis.triggers.length > 0) {
            console.log('\nTriggers:');
            crisis.triggers.forEach(trigger => console.log(`• ${trigger}`));
        }
        
        console.log('\nResponse Actions:');
        crisis.response.slice(0, 3).forEach((action, i) => {
            console.log(`${i+1}. ${action}`);
        });
    }
    
    displayRevenueAnalysis(revenue) {
        console.log('\n💰 REVENUE ANALYSIS');
        console.log('─'.repeat(40));
        console.log(`Immediate Potential: $${revenue.potential.immediate}`);
        console.log(`Lost from Offline Operators: $${revenue.lost.fromLostOperators}`);
        console.log(`Current Monthly: $${revenue.projections.current}`);
        console.log(`Optimized Potential: $${revenue.projections.optimized}`);
    }
    
    displayRecommendations(recommendations) {
        console.log('\n🎯 ACTIONABLE RECOMMENDATIONS');
        console.log('─'.repeat(40));
        
        const immediate = recommendations.filter(r => r.priority === 'critical' || r.priority === 'high').slice(0, 5);
        
        immediate.forEach((rec, i) => {
            const priorityIcon = rec.priority === 'critical' ? '🚨' : rec.priority === 'high' ? '⚡' : '🎯';
            const autoIcon = rec.automated ? '🤖' : '👤';
            console.log(`${i+1}. ${priorityIcon}${autoIcon} ${rec.action}`);
            console.log(`   ${rec.description}`);
            console.log(`   Timeline: ${rec.timeline} | Impact: ${rec.impact}`);
            console.log('');
        });
    }
    
    async exportDashboardReport(data) {
        const reportDir = path.join(__dirname, '..', 'data', 'dashboard-reports');
        if (!fs.existsSync(reportDir)) {
            fs.mkdirSync(reportDir, { recursive: true });
        }
        
        const timestamp = Date.now();
        const reportFile = path.join(reportDir, `dashboard-report-${timestamp}.json`);
        
        const report = {
            timestamp: new Date().toISOString(),
            ...data,
            summary: {
                networkHealth: data.networkStatus.health,
                operatorCount: data.operatorHealth.metrics.total,
                crisisLevel: data.crisisAnalysis.level,
                immediateActions: data.recommendations.filter(r => r.priority === 'critical').length,
                revenueImpact: data.revenueAnalysis.potential.immediate
            }
        };
        
        fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
        
        console.log('\n📄 DASHBOARD REPORT');
        console.log('─'.repeat(40));
        console.log(`Report saved: ${path.basename(reportFile)}`);
        console.log(`Network Health: ${report.summary.networkHealth}/100`);
        console.log(`Crisis Level: ${report.summary.crisisLevel}`);
        console.log(`Immediate Actions: ${report.summary.immediateActions}`);
        console.log(`Revenue at Risk: $${report.summary.revenueImpact}`);
    }
    
    async run() {
        try {
            const dashboardData = await this.generateComprehensiveDashboard();
            
            console.log('\n✅ OPERATOR MANAGEMENT DASHBOARD COMPLETE');
            console.log('─'.repeat(40));
            console.log('Next: Review recommendations and execute high-priority actions');
            
            return dashboardData;
        } catch (error) {
            console.error('❌ Dashboard failed:', error.message);
            process.exit(1);
        }
    }
}

// Run if called directly
if (require.main === module) {
    const dashboard = new OperatorManagementDashboard();
    dashboard.run();
}

module.exports = OperatorManagementDashboard;